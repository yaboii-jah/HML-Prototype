-- Quote-only suppliers retain their own request-scoped history. A directory
-- supplier becomes mandatory only when an award is converted to an order.
alter table private.quotation_families alter column supplier_id drop not null;
alter table private.quotation_families add column intake_name text;
alter table private.quotation_families add constraint quotation_family_has_supplier_name
  check (supplier_id is not null or coalesce(intake_name ~ '[^[:space:]]',false));
create unique index quotation_family_intake_name on private.quotation_families
  (request_id,lower(btrim(regexp_replace(intake_name,'[[:space:]]+',' ','g'))))
  where intake_name is not null;
alter table private.quotation_drafts alter column supplier_id drop not null;
alter table private.purchasing_records alter column supplier_id drop not null;
alter table private.purchasing_records add constraint purchase_order_requires_supplier
  check (kind <> 'po' or supplier_id is not null);
alter table private.purchasing_records add column family_id uuid references private.quotation_families(id);
update private.purchasing_records p set family_id=q.family_id from private.quotation_drafts q where q.id=p.quote_id;
alter table private.purchasing_records alter column family_id set not null;
create unique index purchasing_one_active_family on private.purchasing_records(request_id,family_id) where state='active';

create or replace function private.quotation_assign_family() returns trigger language plpgsql security definer set search_path='' as $$
declare f private.quotation_families; supplied uuid:=new.family_id;
begin
  if supplied is not null then
    select * into f from private.quotation_families where id=supplied and request_id=new.request_id for update;
    if not found then raise exception 'Quotation history is unavailable' using errcode='23514'; end if;
  elsif new.supplier_id is null then
    insert into private.quotation_families(request_id,intake_name) values(new.request_id,btrim(new.body->>'supplierName')) returning * into f;
  else
    insert into private.quotation_families(request_id,supplier_id) values(new.request_id,new.supplier_id) on conflict do nothing;
    select * into f from private.quotation_families where request_id=new.request_id and supplier_id=new.supplier_id for update;
  end if;
  if f.pending_quote_id is not null or (supplied is null and (f.current_quote_id is not null or exists(select 1 from private.quotation_revisions r where r.family_id=f.id)))
    or (new.supplier_id is not null and new.supplier_id is distinct from f.supplier_id) then raise exception 'Use the current family revision; one replacement only' using errcode='23505'; end if;
  new.family_id:=f.id;
  update private.quotation_families set pending_quote_id=new.id,version=version+1 where id=f.id;
  return new;
end $$;

create or replace function private.quotation_frozen_source() returns trigger language plpgsql set search_path='' as $$
begin
  if old.state='finalized' then raise exception 'Finalized quotation source is immutable' using errcode='23514'; end if;
  if tg_op='DELETE' then raise exception 'Quotation history is retained' using errcode='23514'; end if;
  if row(old.family_id,old.request_id,old.supplier_id,old.copied_from_revision)
    is distinct from row(new.family_id,new.request_id,new.supplier_id,new.copied_from_revision) then
    raise exception 'Quotation ownership is fixed' using errcode='23514';
  end if;
  return new;
end $$;

create or replace function private.quotation_capture_command(actor jsonb,command jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
<<cmd>>
declare caller uuid; operation uuid:=(command->>'requestId')::uuid; kind text:=command->>'type';
  target uuid:=(command->>'quoteId')::uuid; receipt private.quotation_operations;
  q private.quotation_drafts; existing_family private.quotation_families; before_value jsonb; body jsonb; result jsonb; changed boolean:=false; line jsonb; reason text; next_state text;
begin
  perform set_config('lock_timeout','5s',true); update private.account_guard set revision=revision+1 where id;
  caller:=private.quotation_actor(actor,true);
  if operation is null or kind is null or kind not in('create','save','status','checkSource','confirmMatch') then raise exception 'Invalid quotation command' using errcode='23514'; end if;
  insert into private.quotation_operations(id,actor_id,payload) values(operation,caller,command) on conflict do nothing;
  select * into receipt from private.quotation_operations where id=operation for update;
  if receipt.actor_id<>caller or receipt.payload<>command then raise exception 'Retry identity reused' using errcode='P4503'; end if;
  if receipt.result is not null then return receipt.result; end if;
  if kind='create' then
    body:=private.quotation_body(command->'body',(command->>'mrfId')::uuid);
    if command->>'supplierId' is null then
      if not coalesce((body->>'supplierName') ~ '[^[:space:]]',false) then
        raise exception 'Enter the supplier name from the quotation' using errcode='P4508';
      end if;
      if not exists(select 1 from public.material_requests m where m.id=(command->>'mrfId')::uuid
        and private.request_project_allowed(actor,m.project_id)) then
        raise exception 'MRF access denied' using errcode='42501';
      end if;
      select * into existing_family from private.quotation_families f
        where f.request_id=(command->>'mrfId')::uuid and f.intake_name is not null
        and lower(btrim(regexp_replace(f.intake_name,'[[:space:]]+',' ','g')))=
            lower(btrim(regexp_replace(body->>'supplierName','[[:space:]]+',' ','g')));
      if found then
        target:=coalesce(existing_family.pending_quote_id,existing_family.current_quote_id,
          (select d.id from private.quotation_drafts d where d.family_id=existing_family.id order by d.created_at desc,d.id limit 1));
        result:=jsonb_build_object('quoteId',target,'changed',false,'quote',private.quotation_view(target));
        update private.quotation_operations set result=cmd.result where id=operation;
        return result;
      end if;
    else
      perform 1 from private.suppliers where id=(command->>'supplierId')::uuid and is_active for share;
      if not found then raise exception 'Choose an active supplier' using errcode='23514'; end if;
    end if;
    target:=gen_random_uuid();
    perform private.mrf_register_downstream((command->>'mrfId')::uuid,'quotation',target);
    if exists(select 1 from jsonb_array_elements(body->'lines') l where l->'sourceFileId'<>'null'::jsonb) then
      raise exception 'Save originals before linking source files' using errcode='23514'; end if;
    insert into private.quotation_drafts(id,request_id,supplier_id,body,creator_id,creator_name)
      select target,(command->>'mrfId')::uuid,(command->>'supplierId')::uuid,body,caller,p.display_name from public.profiles p where p.user_id=caller;
    changed:=true;
  else
    q:=private.quotation_lock(target,kind<>'status'); before_value:=private.quotation_view(target);
    if q.version::text is distinct from command->>'expectedVersion' then raise exception 'Quotation changed; review again' using errcode='40001'; end if;
    if kind='save' then
      body:=private.quotation_body(command->'body',q.request_id);
      if q.supplier_id is null and not coalesce((body->>'supplierName') ~ '[^[:space:]]',false) then
        raise exception 'Enter the supplier name from the quotation' using errcode='P4508';
      end if;
      if exists(select 1 from jsonb_array_elements(body->'lines') l where l->'sourceFileId'<>'null' and not (l->>'sourceFileId')::uuid=any(q.current_files)) then
        raise exception 'Choose a current quotation source file' using errcode='23514'; end if;
      update private.quotation_drafts set body=cmd.body,version=version+1,content_version=content_version+1,checked=null,
        matches=coalesce((select jsonb_object_agg(stamp.key,stamp.value) from jsonb_each(q.matches) stamp
          join jsonb_array_elements(cmd.body->'lines') offered on offered->>'id'=stamp.key where stamp.value->'line'=offered),'{}')
        where id=target and quotation_drafts.body is distinct from cmd.body;
      changed:=found;
    elsif kind='status' then
      reason:=btrim(command->>'reason'); next_state:=command->>'state';
      if reason is null or length(reason) not between 5 and 2000 or next_state is null or next_state not in('draft','cancelled') then raise exception 'Status and reason required' using errcode='23514'; end if;
      update private.quotation_drafts set state=next_state,version=version+1 where id=target and state<>next_state; changed:=found;
      if changed and next_state='cancelled' then
        update private.quotation_groups set state='cancelled' where quote_id=target and state in('uploading','conflict');
        update private.quotation_jobs j set state='complete',lease=null,lease_until=null,
          checkpoint=checkpoint||'{"cancelled":true}'::jsonb
          from private.quotation_files f join private.quotation_groups g on g.id=f.group_id
          where j.file_id=f.id and f.quote_id=target and g.state='cancelled' and j.kind='validate' and j.state<>'complete';
      end if;
    else
      if q.file_version::text is distinct from command->>'expectedFiles' then raise exception 'Originals changed; review again' using errcode='40001'; end if;
      if not private.quotation_ready_files(q) then raise exception 'Save and verify originals first' using errcode='23514'; end if;
      if kind='checkSource' then
        result:=jsonb_build_object('contentVersion',q.content_version::text,'fileVersion',q.file_version::text,'actor',private.document_actor_snapshot(actor));
        if q.checked->>'contentVersion' is distinct from q.content_version::text or q.checked->>'fileVersion' is distinct from q.file_version::text then
          update private.quotation_drafts set checked=result,version=version+1 where id=target; changed:=true; end if;
      else
        select l into line from jsonb_array_elements(q.body->'lines') l where l->>'id'=command->>'lineId';
        if line is null or line->'requestItemId'='null' or btrim(line->>'description')='' or btrim(line->>'unit')='' or line->>'conversionFactor'='' then
          raise exception 'Complete the material link, unit and conversion factor first' using errcode='23514'; end if;
        if line->>'unit' is distinct from (select m.data->>'unit' from public.material_request_items m where m.id=(line->>'requestItemId')::uuid) and btrim(line->>'varianceReason')='' then raise exception 'Explain unit differences before confirming' using errcode='23514'; end if;
        result:=jsonb_build_object('line',line,'fileVersion',q.file_version::text,'actor',private.document_actor_snapshot(actor));
        if q.matches->(line->>'id')->'line' is distinct from line or q.matches->(line->>'id')->>'fileVersion' is distinct from q.file_version::text then
          update private.quotation_drafts set matches=jsonb_set(matches,array[line->>'id'],result),version=version+1 where id=target; changed:=true; end if;
      end if;
    end if;
  end if;
  if changed then perform private.quotation_audit(actor,'quotation.'||kind,target,operation,jsonb_build_object('before',before_value,'after',private.quotation_view(target),'reason',reason)); end if;
  result:=jsonb_build_object('quoteId',target,'changed',changed,'quote',private.quotation_view(target));
  update private.quotation_operations set result=cmd.result where id=operation;
  if changed then perform private.quotation_notify(); end if;
  return result;
end $$;

create or replace function private.quotation_revision_blockers(target uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r private.quotation_revisions; q private.quotation_drafts; current_mrf uuid; linked_supplier uuid; reasons jsonb:='[]';
begin
  select * into r from private.quotation_revisions where id=target;
  if not found then return '["Revision unavailable"]'; end if;
  select * into q from private.quotation_drafts where id=r.quote_id;
  if exists(select 1 from private.quotation_revision_events where revision_id=target and kind='withdraw') then reasons:=reasons||'"Withdrawn permanently"'::jsonb; end if;
  select supplier_id into linked_supplier from private.quotation_families where id=q.family_id;
  if linked_supplier is not null and not exists(select 1 from private.suppliers s where s.id=linked_supplier and s.is_active) then
    reasons:=reasons||'"Supplier is inactive"'::jsonb;
  end if;
  if nullif(q.body->>'validUntil','')::date<(now() at time zone 'Asia/Manila')::date then reasons:=reasons||'"Offer has expired"'::jsonb; end if;
  current_mrf:=private.quotation_mrf_archive(q.request_id);
  if current_mrf is null then reasons:=reasons||'"Current MRF approval/archive is unavailable"'::jsonb;
  elsif current_mrf<>r.mrf_archive_id and not exists(select 1 from private.quotation_revision_events e where e.revision_id=target and e.kind='reconfirmMrf' and e.mrf_archive_id=current_mrf) then reasons:=reasons||'"Review the corrected MRF and reconfirm applicability"'::jsonb; end if;
  if not exists(select 1 from private.quotation_archives where revision_id=target) then reasons:=reasons||'"Quotation archive is incomplete"'::jsonb; end if;
  return reasons;
end $$;

create or replace function private.quotation_view(target uuid) returns jsonb language sql stable security definer set search_path='' as $$
  select private.quotation_capture_view(target)||jsonb_build_object('supplierId',f.supplier_id,'contentVersion',q.content_version::text,
    'checked',coalesce(q.checked->>'contentVersion'=q.content_version::text and q.checked->>'fileVersion'=q.file_version::text and private.quotation_ready_files(q),false),
    'family',jsonb_build_object('id',f.id,'version',f.version::text,'currentQuoteId',f.current_quote_id,'pendingQuoteId',f.pending_quote_id,
      'currentMrfArchiveId',private.quotation_mrf_archive(q.request_id),'supplierActive',(select s.is_active from private.suppliers s where s.id=f.supplier_id)),
    'financial',case when v.quote_id is null then jsonb_build_object('version','1','sourceVersion',q.content_version::text,'filesVersion',q.file_version::text,'review',null,'calculation',null,'checked',false)
      else jsonb_build_object('version',v.version::text,'sourceVersion',v.source_version::text,'filesVersion',v.file_version::text,'review',v.review,'calculation',v.calculation,
        'checked',coalesce(v.source_version=q.content_version and v.file_version=q.file_version and v.checked->>'version'=v.version::text and v.checked->>'sourceVersion'=q.content_version::text and v.checked->>'filesVersion'=q.file_version::text,false)) end,
    'revision',case when r.id is null then null else jsonb_build_object('id',r.id,'number',r.number::text,'finalizedBy',r.finalized_name,'finalizedAt',r.finalized_at,'mrfArchiveId',r.mrf_archive_id,
      'withdrawn',exists(select 1 from private.quotation_revision_events e where e.revision_id=r.id and e.kind='withdraw'),
      'current',coalesce(f.current_quote_id=q.id,false),'eligible',coalesce(f.current_quote_id=q.id and private.quotation_revision_blockers(r.id)='[]'::jsonb,false),
      'blockers',private.quotation_revision_blockers(r.id),'archiveState',coalesce(j.state,'pending'),'archiveMessage',j.message,
      'pdfAvailable',exists(select 1 from private.quotation_archives a where a.revision_id=r.id)) end)
  from private.quotation_drafts q join private.quotation_families f on f.id=q.family_id
    left join private.quotation_financial_reviews v on v.quote_id=q.id left join private.quotation_revisions r on r.quote_id=q.id
    left join private.quotation_archive_jobs j on j.revision_id=r.id where q.id=target;
$$;

create or replace function private.quotation_financial_command(actor jsonb,command jsonb,calculation jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
<<finance>>
declare caller uuid; operation uuid:=(command->>'requestId')::uuid; kind text:=command->>'type'; target uuid:=(command->>'quoteId')::uuid;
  q private.quotation_drafts; f private.quotation_families; v private.quotation_financial_reviews; r private.quotation_revisions;
  receipt private.quotation_operations; result jsonb; review jsonb; next_quote uuid; snap uuid; mapping uuid; original uuid; current_mrf uuid;
  actor_snapshot jsonb; reason text:=btrim(coalesce(command->>'reason','')); changed boolean:=true; did_activate boolean:=false; review_row jsonb; matched integer:=0; key text;
begin
  perform set_config('lock_timeout','5s',true); update private.account_guard set revision=revision+1 where id;
  caller:=private.quotation_actor(actor,true); actor_snapshot:=private.document_actor_snapshot(actor);
  if operation is null or kind is null or kind not in('saveFinancial','checkFinancial','finalize','startRevision','withdraw','reconfirmMrf','activateRevision','retryArchive') then raise exception 'Invalid financial action' using errcode='23514'; end if;
  insert into private.quotation_operations(id,actor_id,payload) values(operation,caller,command) on conflict do nothing;
  select * into receipt from private.quotation_operations where id=operation for update;
  if receipt.actor_id<>caller or receipt.payload<>command then raise exception 'Retry identity reused' using errcode='P4503'; end if;
  if receipt.result is not null then return receipt.result; end if;
  select * into q from private.quotation_drafts where id=target;
  if not found then raise exception 'Quotation unavailable' using errcode='P4501'; end if;
  perform 1 from public.material_requests where id=q.request_id for update;
  select * into f from private.quotation_families where id=q.family_id for update;
  select * into q from private.quotation_drafts where id=target for update;
  if q.version::text is distinct from command->>'expectedVersion' or (command ? 'expectedFamily' and f.version::text is distinct from command->>'expectedFamily')
    or (command ? 'expectedFiles' and q.file_version::text is distinct from command->>'expectedFiles') then raise exception 'Review the latest saved versions' using errcode='40001'; end if;
  select * into v from private.quotation_financial_reviews where quote_id=target for update;
  select * into r from private.quotation_revisions where quote_id=target;
  current_mrf:=private.quotation_mrf_archive(q.request_id);
  if kind in('saveFinancial','checkFinancial','finalize') then
    if q.state<>'draft' or current_mrf is null then raise exception 'Current MRF and editable draft required' using errcode='P4502'; end if;
    if kind='saveFinancial' then
      review:=command->'review';
      if jsonb_typeof(review) is distinct from 'object' or jsonb_typeof(review->'rows') is distinct from 'array' or jsonb_typeof(review->'adjustments') is distinct from 'array'
        or review->>'vatStatus' not in('','VAT','NON-VAT') or review->>'priceBasis' not in('','inclusive','exclusive')
        or review->>'subtotalBasis' not in('materials','subtotal') or review->>'totalBasis' not in('gross','net')
        or jsonb_array_length(review->'rows')<>jsonb_array_length(q.body->'lines') or jsonb_array_length(review->'adjustments')<>jsonb_array_length(q.body->'adjustments')
        or calculation->>'ruleVersion' is distinct from 'hml-quotation-2026-11-05-v1' or jsonb_typeof(calculation->'issues') is distinct from 'array' then raise exception 'Invalid reviewed calculation' using errcode='23514'; end if;
      if exists(select 1 from jsonb_array_elements(review->'rows') x where not exists(select 1 from jsonb_array_elements(q.body->'lines') l where l->>'id'=x->>'id'))
        or exists(select 1 from jsonb_array_elements(review->'adjustments') x where not exists(select 1 from jsonb_array_elements(q.body->'adjustments') a where a->>'id'=x->>'id')) then raise exception 'Source classification changed' using errcode='40001'; end if;
      foreach key in array array['materials','subtotal','vat','gross','ewtGoods','ewtServices','net'] loop
        if jsonb_typeof(calculation->key) is distinct from 'string' or calculation->>key !~ '^-?[0-9]{1,250}\.[0-9]{2}$' then raise exception 'Exact calculated amount required' using errcode='23514'; end if;
      end loop;
      if v.quote_id is not null and v.review=review and v.calculation=calculation and v.source_version=q.content_version and v.file_version=q.file_version then changed:=false;
      else
        insert into private.quotation_financial_reviews(quote_id,source_version,file_version,review,calculation)
          values(target,q.content_version,q.file_version,review,calculation)
          on conflict(quote_id) do update set version=quotation_financial_reviews.version+1,source_version=excluded.source_version,file_version=excluded.file_version,review=excluded.review,calculation=excluded.calculation,checked=null;
        update private.quotation_drafts set version=version+1 where id=target;
      end if;
    else
      if v.quote_id is null or v.version::text is distinct from command->>'expectedFinancial' or v.source_version<>q.content_version or v.file_version<>q.file_version then raise exception 'Save and review current financial inputs' using errcode='40001'; end if;
      if v.calculation->'issues'<>'[]'::jsonb then raise exception 'Reconcile calculation issues' using errcode='P4504'; end if;
      if not private.quotation_ready_files(q) or q.checked->>'contentVersion' is distinct from q.content_version::text or q.checked->>'fileVersion' is distinct from q.file_version::text then raise exception 'Review verified originals and saved source' using errcode='P4504'; end if;
      if kind='checkFinancial' then
        if v.checked->>'version'=v.version::text then changed:=false;
        else
          update private.quotation_financial_reviews set checked=jsonb_build_object('version',v.version::text,'sourceVersion',q.content_version::text,'filesVersion',q.file_version::text,'actor',actor_snapshot) where quote_id=target;
          update private.quotation_drafts set version=version+1 where id=target;
        end if;
      else
        if f.pending_quote_id is distinct from target or v.checked->>'version' is distinct from v.version::text
          or v.checked->>'sourceVersion' is distinct from q.content_version::text or v.checked->>'filesVersion' is distinct from q.file_version::text
          or calculation is distinct from v.calculation then raise exception 'Confirm the current saved financial review' using errcode='P4504'; end if;
        if f.supplier_id is not null and not exists(select 1 from private.suppliers where id=f.supplier_id and is_active) then raise exception 'Supplier is inactive' using errcode='P4504'; end if;
        foreach key in array array['ref','date','paymentTerms','deliveryTerms'] loop
          if btrim(q.body->>key)='' then raise exception 'Supplier reference/date/terms required' using errcode='P4504'; end if;
        end loop;
        if upper(btrim(q.body->>'currency')) not in('','PHP','₱','PESO','PESOS','PHILIPPINE PESO','PHILIPPINE PESOS')
          or (nullif(q.body->>'validUntil','')::date<(now() at time zone 'Asia/Manila')::date or nullif(q.body->>'validUntil','')::date<(q.body->>'date')::date)
          or (calculation->>'gross')::numeric<=0 or (calculation->>'net')::numeric<0 then raise exception 'Review PHP, validity and positive gross/nonnegative net' using errcode='P4504'; end if;
        for review_row in select * from jsonb_array_elements(v.review->'rows') where value->>'role'='material' loop
          if exists(select 1 from jsonb_array_elements(q.body->'lines') l where l->>'id'=review_row->>'id' and l->'requestItemId'<>'null') then
            if not exists(select 1 from jsonb_array_elements(q.body->'lines') l where l->>'id'=review_row->>'id' and q.matches->(l->>'id')->'line'=l and q.matches->(l->>'id')->>'fileVersion'=q.file_version::text) then raise exception 'Confirm every linked material match' using errcode='P4504'; end if;
            matched:=matched+1;
          end if;
        end loop;
        if matched=0 then raise exception 'Confirm at least one MRF material match' using errcode='P4504'; end if;
        select d.id into mapping from private.project_document_folders d join public.material_requests m on m.project_id=d.project_id where m.id=q.request_id and d.current;
        if mapping is null then raise exception 'Project document folder required' using errcode='P4201'; end if;
        perform file.id from private.quotation_files file where file.id=any(q.current_files) order by file.id for update;
        if exists(select 1 from unnest(q.current_files) selected(id) where not exists(select 1 from private.quotation_files file where file.id=selected.id and file.state='verified')) then raise exception 'Original changed during finalization' using errcode='40001'; end if;
        insert into private.quotation_revisions(family_id,quote_id,number,mrf_archive_id,source_version,file_version,financial_version,snapshot,finalized_by,finalized_name)
          select f.id,target,coalesce((select max(number) from private.quotation_revisions where family_id=f.id),0)+1,current_mrf,q.content_version,q.file_version,v.version,
            jsonb_build_object('source',q.body,'review',v.review,'calculation',v.calculation,'sourceCheck',q.checked,'matches',q.matches,'financialCheck',v.checked,
              'mrfRef',(select ref from public.material_requests where id=q.request_id),'supplierId',f.supplier_id,'actor',actor_snapshot,'copiedFromRevisionId',q.copied_from_revision,
              'predecessorRevisionId',(select id from private.quotation_revisions where quote_id=f.current_quote_id)),caller,p.display_name from public.profiles p where p.user_id=caller returning id into snap;
        insert into private.quotation_revision_files(revision_id,file_id,metadata)
          select snap,file.id,jsonb_build_object('id',file.id,'quoteId',file.quote_id,'name',file.name,'mime',file.mime,'size',file.size,'sha256',file.sha256,'driveFileId',file.drive_file_id,'folderMappingId',file.folder_mapping_id)
          from private.quotation_files file where file.id=any(q.current_files);
        update private.quotation_files set retained=true where id=any(q.current_files);
        update private.quotation_drafts set state='finalized',version=version+1 where id=target;
        update private.quotation_families set version=version+1 where id=f.id;
        insert into private.quotation_archive_jobs(revision_id,folder_mapping_id,actor,original_actor) values(snap,mapping,actor_snapshot,actor_snapshot);
      end if;
    end if;
  elsif kind='startRevision' then
    if r.id is null or f.pending_quote_id is not null or current_mrf is null or length(reason) not between 5 and 2000 then raise exception 'Finish the existing replacement and record a revision reason' using errcode='P4504'; end if;
    next_quote:=gen_random_uuid();
    perform private.mrf_register_downstream(q.request_id,'quotation',next_quote);
    insert into private.quotation_drafts(id,request_id,supplier_id,family_id,body,current_files,creator_id,creator_name,copied_from_revision)
      select next_quote,q.request_id,q.supplier_id,q.family_id,q.body,q.current_files,caller,p.display_name,r.id from public.profiles p where p.user_id=caller;
    if v.quote_id is not null then insert into private.quotation_financial_reviews(quote_id,source_version,file_version,review,calculation) values(next_quote,1,1,v.review,v.calculation); end if;
    target:=next_quote;
  else
    if r.id is null then raise exception 'Finalized revision required' using errcode='P4504'; end if;
    if kind='withdraw' then
      if length(reason) not between 5 and 2000 then raise exception 'Withdrawal reason required' using errcode='23514'; end if;
      if exists(select 1 from private.quotation_revision_events e where e.revision_id=r.id and e.kind='withdraw') then changed:=false;
      else
        insert into private.quotation_revision_events(revision_id,kind,actor,reason) values(r.id,'withdraw',actor_snapshot,reason);
        update private.quotation_families set pending_quote_id=case when pending_quote_id=q.id then null else pending_quote_id end,version=version+1 where id=f.id;
      end if;
    elsif kind in('reconfirmMrf','activateRevision') then
      if current_mrf is null or current_mrf::text is distinct from command->>'expectedMrf' or length(reason) not between 5 and 2000 then raise exception 'Review the exact current MRF archive' using errcode='40001'; end if;
      if exists(select 1 from private.quotation_revision_events e where e.revision_id=r.id and e.kind='withdraw') then raise exception 'Withdrawn revisions cannot be restored' using errcode='P4504'; end if;
      if kind='reconfirmMrf' then
        insert into private.quotation_revision_events(revision_id,kind,mrf_archive_id,actor,reason) values(r.id,'reconfirmMrf',current_mrf,actor_snapshot,reason);
        update private.quotation_families set version=version+1 where id=f.id;
        did_activate:=private.quotation_try_activate(r.id,actor_snapshot,reason);
      else
        did_activate:=private.quotation_try_activate(r.id,actor_snapshot,reason);
        if not did_activate then raise exception 'Replacement still has eligibility blockers' using errcode='P4504'; end if;
      end if;
    elsif kind='retryArchive' then
      select d.id into mapping from private.project_document_folders d join public.material_requests m on m.project_id=d.project_id where m.id=q.request_id and d.current;
      if mapping is null then raise exception 'Project document folder required' using errcode='P4201'; end if;
      update private.quotation_archive_jobs j set state='pending',actor=actor_snapshot,lease=null,lease_until=null,dispatched_at=null,message=null,
        attempts=j.attempts||jsonb_build_array(jsonb_build_object('folderMappingId',j.folder_mapping_id,'checkpoint',j.checkpoint,'actor',j.actor,'retriedBy',actor_snapshot,'state',j.state,'message',j.message,'retriedAt',clock_timestamp())),
        checkpoint=case when j.folder_mapping_id=mapping then j.checkpoint else '{}'::jsonb end,folder_mapping_id=mapping
        where j.revision_id=r.id and j.state in('failed','paused');
      if not found then raise exception 'Choose a failed archive' using errcode='P4504'; end if;
    end if;
  end if;
  if changed then perform private.quotation_audit(actor,'quotation.'||kind,target,operation,jsonb_build_object('revisionId',coalesce(snap,r.id),'fromQuoteId',q.id,'reason',reason,'activated',did_activate,'review',case when kind='saveFinancial' then command->'review' else null end)); end if;
  result:=jsonb_build_object('quoteId',target,'changed',changed,'quote',private.quotation_view(target));
  update private.quotation_operations set result=finance.result where id=operation;
  if changed then perform private.quotation_notify(); end if;
  return result;
end $$;

create or replace function private.admit_request_drive_file() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  kind text := tg_argv[0];
  request_id uuid;
  parent_id uuid;
  parent_name text;
  child_id uuid;
  child_name text;
  path jsonb;
begin
  case kind
    when 'mrf-original' then
      request_id := new.request_id;
      path := private.drive_path_segment('support','Supporting Documents')
        || private.drive_path_segment('support/originals','Originals');
    when 'mrf-archive' then
      insert into private.request_drive_admissions(kind,resource_id,request_id,path) values
        ('mrf-form',new.id,new.request_id,private.drive_path_segment('mrf','MRF Form')),
        ('mrf-support',new.id,new.request_id,private.drive_path_segment('support','Supporting Documents'));
      return null;
    when 'quotation-original' then
      select q.request_id,case when f.intake_name is null then f.supplier_id else f.id end,
        coalesce(f.intake_name,s.profile->>'name') into request_id,parent_id,parent_name
      from private.quotation_drafts q join private.quotation_families f on f.id=q.family_id
      left join private.suppliers s on s.id=f.supplier_id where q.id=new.quote_id;
    when 'quotation-review' then
      select q.request_id,case when f.intake_name is null then f.supplier_id else f.id end,
        coalesce(f.intake_name,s.profile->>'name') into request_id,parent_id,parent_name
      from private.quotation_revisions v join private.quotation_families f on f.id=v.family_id
      join private.quotation_drafts q on q.id=v.quote_id
      left join private.suppliers s on s.id=f.supplier_id where v.id=new.revision_id;
    when 'comparison' then
      select r.request_id into request_id from private.comparison_reports r where r.id=new.report_id;
      path := private.drive_path_segment('comparisons','Bid Comparisons');
    when 'po' then
      select a.request_id into request_id from private.po_approvals a where a.id=new.approval_id;
      path := private.drive_path_segment('po','Purchase Orders');
    when 'payment' then
      select p.request_id,p.id,p.ref into request_id,parent_id,parent_name
      from private.payment_drafts d join private.purchasing_records p on p.id=d.po_id where d.id=new.draft_id;
      path := private.drive_path_segment('accounting','Accounting Documents')
        || private.drive_path_segment('accounting/'||parent_id,parent_name)
        || private.drive_path_segment('accounting/'||parent_id||'/proof','Payment Proof');
    when 'delivery' then
      select p.request_id,p.id,p.ref,d.id,d.ref into request_id,parent_id,parent_name,child_id,child_name
      from private.delivery_receipt_versions v join private.deliveries d on d.id=v.delivery_id
      join private.purchasing_records p on p.id=d.po_id where v.id=new.version_id;
      path := private.drive_path_segment('delivery','Delivery Receipts')
        || private.drive_path_segment('delivery/'||parent_id,parent_name)
        || private.drive_path_segment('delivery/'||parent_id||'/'||child_id,child_name);
    when 'transfer' then
      select t.request_id,t.id,t.ref,d.id,d.ref into request_id,parent_id,parent_name,child_id,child_name
      from private.transfer_receipt_versions v join private.transfer_trips d on d.id=v.trip_id
      join private.transfers t on t.id=d.transfer_id where v.id=new.version_id;
      path := private.drive_path_segment('transfer','Stock Transfers')
        || private.drive_path_segment('transfer/'||parent_id,parent_name)
        || private.drive_path_segment('transfer/'||parent_id||'/'||child_id,child_name);
  end case;
  if kind in ('quotation-original','quotation-review') then
    path := private.drive_path_segment('quotations','Supplier Quotations')
      || private.drive_path_segment('quotations/'||parent_id,parent_name);
  end if;
  insert into private.request_drive_admissions values(kind,new.id,request_id,path);
  return null;
end $$;

create or replace function private.purchasing_retained_identity() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception 'Purchasing history is retained' using errcode='23514'; end if;
  if row(old.id,old.request_id,old.project_id,old.supplier_id,old.kind,old.ref,old.family_id) is distinct from row(new.id,new.request_id,new.project_id,new.supplier_id,new.kind,new.ref,new.family_id) then raise exception 'Purchasing ownership and numbering are fixed' using errcode='23514'; end if;
  return new;
end $$;

create or replace function private.purchasing_preparation_view(target uuid) returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',r.id,'kind',r.kind,'mrfId',r.request_id,'supplierId',r.supplier_id,'familyId',r.family_id,'quoteId',r.quote_id,'revisionId',r.revision_id,
    'version',r.version::text,'state',r.state,'ref',r.ref,'body',r.body,'calculation',r.calculation,'updatedAt',r.updated_at,
    'checked',coalesce(r.checked->>'version'=r.version::text and r.checked->>'archiveId'=private.quotation_mrf_archive(r.request_id)::text
      and r.checked->>'supplierVersion'=(select version::text from private.suppliers where id=r.supplier_id) and private.purchasing_blockers(r.id)='[]'::jsonb,false),
    'blockers',private.purchasing_blockers(r.id)) from private.purchasing_records r where r.id=target;
$$;

create or replace function private.purchasing_preparation_command(actor jsonb,command jsonb,calculation jsonb default null,snapshot jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare caller uuid; operation uuid:=(command->>'requestId')::uuid; target uuid:=(command->>'mrfId')::uuid; selected uuid:=(command->>'targetId')::uuid;
  kind text:=command->>'type'; receipt private.purchasing_operations; payload jsonb; r private.purchasing_records; before_value jsonb;
  q private.quotation_drafts; revision private.quotation_revisions; family private.quotation_families; parent public.material_requests; project public.projects;
  current_version text; body jsonb; row jsonb; oldrow jsonb; changed boolean:=true; number bigint; po uuid; reason text; eligible boolean; folder uuid;
  result jsonb; artifact_row private.comparison_artifacts; report_number bigint; created timestamptz:=clock_timestamp(); actor_snapshot jsonb;
begin
  perform set_config('lock_timeout','5s',true);
  update private.account_guard g set revision=g.revision+1 where g.id;
  caller:=private.quotation_actor(actor,true);
  perform 1 from auth.sessions s where s.id=(actor->>'sessionId')::uuid and s.user_id=caller for share;
  if not found then raise exception 'Current session required' using errcode='42501'; end if;
  payload:=jsonb_build_object('command',command,'role',actor->>'activeRole');
  select * into receipt from private.purchasing_operations where id=operation;
  if found then
    if receipt.actor_id<>caller or receipt.payload<>payload then raise exception 'Retry identity reused' using errcode='P4803'; end if;
    return receipt.result;
  end if;
  if operation is null or selected is null or command->>'expectedVersion' !~ '^(0|[1-9][0-9]{0,18})$' or command->>'expectedDemand' !~ '^(0|[1-9][0-9]{0,18})$' then raise exception 'Invalid purchasing command' using errcode='23514'; end if;
  select * into parent from public.material_requests where id=target;
  if not found then raise exception 'MRF not found' using errcode='P4801'; end if;
  select * into project from public.projects where id=parent.project_id for update;
  perform 1 from public.material_requests where id=target for update;
  if not private.request_project_allowed(actor,parent.project_id) then raise exception 'MRF access denied' using errcode='42501'; end if;
  current_version:=coalesce((select version::text from private.purchasing_heads where request_id=target),'0');
  if current_version is distinct from command->>'expectedVersion' or (private.demand_snapshot(target)->>'version') is distinct from command->>'expectedDemand' then raise exception 'Purchasing or demand changed' using errcode='40001'; end if;
  actor_snapshot:=private.document_actor_snapshot(actor);
  select * into r from private.purchasing_records where id=selected for update;
  if r.id is not null and r.request_id<>target then raise exception 'Foreign purchasing record' using errcode='42501'; end if;
  before_value:=case when r.id is null then null else private.purchasing_record_view(r.id) end;
  reason:=coalesce(nullif(btrim(command->>'reason'),''),command->'body'->>'reason',r.body->>'reason','Purchasing preparation');

  if kind='saveComparison' then
    if not private.mrf_ready(target) or snapshot is null or snapshot->>'mrfId'<>target::text or jsonb_typeof(command->'sources') is distinct from 'array'
      or jsonb_array_length(command->'sources')=0 then raise exception 'Eligible archived sources required' using errcode='P4802'; end if;
    if snapshot->>'mrfArchiveId' is distinct from private.quotation_mrf_archive(target)::text
      or snapshot->>'demandVersion' is distinct from command->>'expectedDemand'
      or jsonb_array_length(command->'sources')<>(select count(*) from private.quotation_families f join private.quotation_revisions v on v.quote_id=f.current_quote_id
        where f.request_id=target and private.quotation_revision_blockers(v.id)='[]'::jsonb)
      then raise exception 'Comparison basis changed' using errcode='40001'; end if;
    for row in select * from jsonb_array_elements(command->'sources') loop
      select * into q from private.quotation_drafts where id=(row->>'quoteId')::uuid and request_id=target;
      select * into family from private.quotation_families where id=q.family_id for update;
      select * into revision from private.quotation_revisions where quote_id=q.id;
      if family.current_quote_id is distinct from q.id or family.version::text is distinct from row->>'familyVersion' or private.quotation_revision_blockers(revision.id)<>'[]'::jsonb then raise exception 'Comparison source changed' using errcode='40001'; end if;
    end loop;
    if (select count(*) from jsonb_array_elements(snapshot->'sources'))<>jsonb_array_length(command->'sources') or exists(select 1 from jsonb_array_elements(snapshot->'sources') s where not exists(select 1 from jsonb_array_elements(command->'sources') c where c->>'quoteId'=s->>'quoteId')) then raise exception 'Comparison source set changed' using errcode='40001'; end if;
    select id into folder from private.project_document_folders where project_id=parent.project_id and current;
    if folder is null then raise exception 'Project document folder required' using errcode='P4201'; end if;
    select coalesce(max(version),0)+1 into report_number from private.comparison_reports where request_id=target;
    insert into private.comparison_reports(id,request_id,version,snapshot,actor,created_at)
      values(selected,target,report_number,snapshot||jsonb_build_object('createdAt',created,'createdBy',(select display_name from public.profiles where user_id=caller)),actor_snapshot,created);
    insert into private.comparison_artifacts(report_id,format,actor,original_actor,folder_mapping_id)
      select selected,format,actor,actor,folder from unnest(array['pdf','xlsx']) format;
  elsif kind='retryArtifact' then
    select x.* into artifact_row from private.comparison_artifacts x join private.comparison_reports rp on rp.id=x.report_id where x.id=selected and rp.request_id=target for update of x;
    if artifact_row.id is null or artifact_row.state not in('failed','paused') then raise exception 'Artifact is processing or complete' using errcode='P4804'; end if;
    select id into folder from private.project_document_folders where project_id=parent.project_id and current;
    if folder is null then raise exception 'Project document folder required' using errcode='P4201'; end if;
    update private.comparison_artifacts set attempts=attempts||jsonb_build_array(jsonb_build_object('actor',artifact_row.actor,'folder',artifact_row.folder_mapping_id,'checkpoint',artifact_row.checkpoint,'state',artifact_row.state,'message',artifact_row.message,'retriedAt',created,'retriedBy',actor_snapshot)),
      actor=actor,folder_mapping_id=folder,checkpoint=case when folder=artifact_row.folder_mapping_id then artifact_row.checkpoint else '{}' end,state='pending',lease=null,lease_until=null,dispatched_at=null,message=null where id=selected;
  elsif kind in('saveAward','savePo','rebind') then
    select * into q from private.quotation_drafts where id=(command->>'quoteId')::uuid and request_id=target;
    select * into family from private.quotation_families where id=q.family_id for update;
    select * into revision from private.quotation_revisions where quote_id=q.id;
    if revision.id is null or family.version::text is distinct from command->>'expectedFamily' then raise exception 'Quotation changed' using errcode='40001'; end if;
    eligible:=family.current_quote_id=q.id and private.quotation_revision_blockers(revision.id)='[]'::jsonb;
    if r.id is null and kind<>'saveAward' then raise exception 'Create a PO from saved awards' using errcode='23514'; end if;
    if r.id is not null and (r.family_id<>q.family_id or (kind='saveAward' and r.kind<>'award') or (kind='savePo' and r.kind<>'po') or r.state='converted' or (r.state='cancelled' and kind<>'rebind')) then raise exception 'Invalid purchasing transition' using errcode='23514'; end if;
    if kind<>'rebind' and r.id is not null and r.quote_id<>q.id then raise exception 'Explicit source rebinding required' using errcode='23514'; end if;
    if not eligible then
      if r.id is null or kind='rebind' or command->'body'->'fields' is distinct from r.body->'fields'
        or (select jsonb_agg(a-'confirmed' order by a->>'sourceKind',a->>'id') from jsonb_array_elements(command->'body'->'adjustments') a)
          is distinct from (select jsonb_agg(a-'confirmed' order by a->>'sourceKind',a->>'id') from jsonb_array_elements(r.body->'adjustments') a) then raise exception 'Current eligible quotation required' using errcode='P4802'; end if;
      for row in select * from jsonb_array_elements(command->'body'->'lines') loop
        select l into oldrow from jsonb_array_elements(r.body->'lines') l where l->>'id'=row->>'id';
        if oldrow is null or (oldrow-array['quantity','offeredQuantity','discountConfirmed']) is distinct from (row-array['quantity','offeredQuantity','discountConfirmed']) or (row->>'quantity')::numeric>(oldrow->>'quantity')::numeric then raise exception 'Blocked work permits reductions or cancellation only' using errcode='P4802'; end if;
        if row->>'discountConfirmed'='true' and oldrow->>'discountConfirmed' is distinct from 'true' then raise exception 'Blocked work cannot establish a pricing review' using errcode='P4802'; end if;
      end loop;
      if exists(select 1 from jsonb_array_elements(command->'body'->'adjustments') a where a->>'confirmed'='true' and not exists(select 1 from jsonb_array_elements(r.body->'adjustments') old where old->>'id'=a->>'id' and old->>'sourceKind'=a->>'sourceKind' and old->>'confirmed'='true')) then raise exception 'Blocked work cannot establish an adjustment review' using errcode='P4802'; end if;
    end if;
    body:=private.purchasing_validate_body(target,q.id,command->'body',case when kind='rebind' then null else r.body end);
    if r.id is null then
      insert into private.purchasing_records(id,request_id,project_id,supplier_id,family_id,quote_id,revision_id,kind,body)
        values(selected,target,parent.project_id,family.supplier_id,family.id,q.id,revision.id,'award',body);
    elsif r.body=body and r.quote_id=q.id then changed:=false;
    else update private.purchasing_records set body=body,quote_id=q.id,revision_id=revision.id,version=version+1,checked=null,calculation=calculation,updated_at=created where id=selected;
    end if;
  elsif kind in('convert','cancel','reopen','checkPo') then
    if r.id is null then raise exception 'Purchasing record not found' using errcode='P4801'; end if;
    select * into q from private.quotation_drafts where id=r.quote_id;
    select * into family from private.quotation_families where id=q.family_id for update;
    eligible:=family.current_quote_id=q.id and private.quotation_revision_blockers(r.revision_id)='[]'::jsonb;
    if kind='cancel' then
      if r.state<>'active' or length(btrim(command->>'reason'))<5 then raise exception 'Active record and cancellation reason required' using errcode='23514'; end if;
      update private.purchasing_records set state='cancelled',checked=null,version=version+1,updated_at=created where id=selected;
    elsif kind='reopen' then
      if r.state<>'cancelled' or not eligible or length(btrim(command->>'reason'))<5 then raise exception 'Current eligible source and reopening reason required' using errcode='P4802'; end if;
      update private.purchasing_records set state='active',checked=null,version=version+1,updated_at=created where id=selected;
    elsif kind='convert' then
      if r.kind<>'award' or r.state<>'active' or not eligible then raise exception 'Current eligible saved award required' using errcode='P4802'; end if;
      if family.supplier_id is null then
        if family.version::text is distinct from command->>'expectedFamily' then
          raise exception 'Quotation changed' using errcode='40001';
        end if;
        select s.id into family.supplier_id from private.suppliers s where s.id=(command->>'supplierId')::uuid and s.is_active for share;
        if not found then raise exception 'Select an active directory supplier before creating the PO' using errcode='P4810'; end if;
        if exists(select 1 from private.quotation_families f where f.request_id=target and f.supplier_id=family.supplier_id and f.id<>family.id) then
          raise exception 'This supplier is already linked to another quotation history on the MRF' using errcode='P4811';
        end if;
        update private.quotation_families set supplier_id=family.supplier_id,version=version+1 where id=family.id;
      elsif command->>'supplierId' is not null and family.supplier_id::text<>command->>'supplierId' then
        raise exception 'Quotation supplier changed' using errcode='40001';
      end if;
      po:=gen_random_uuid();
      insert into private.document_counters(project_id,series,last_value) values(parent.project_id,'PO',1)
        on conflict on constraint document_counters_pkey do update set last_value=private.document_counters.last_value+1 returning last_value into number;
      update private.purchasing_records set state='converted',version=version+1,updated_at=created where id=selected;
      body:=private.purchasing_po_body(target,q.id,r.body);
      body:=jsonb_set(body,'{fields,date}',to_jsonb((now() at time zone 'Asia/Manila')::date::text));
      body:=jsonb_set(body,'{fields,shipTo}',to_jsonb(project.name));
      body:=jsonb_set(body,'{fields,shipAddress}',to_jsonb(project.location));
      body:=jsonb_set(body,'{fields,requisitioner}',to_jsonb(coalesce(parent.data->>'requestedBy','')));
      insert into private.purchasing_records(id,request_id,project_id,supplier_id,family_id,quote_id,revision_id,kind,ref,body,calculation)
        values(po,target,parent.project_id,family.supplier_id,family.id,r.quote_id,r.revision_id,'po',project.document_code||'-PO-'||lpad(number::text,greatest(4,length(number::text)),'0'),body,calculation);
      perform private.mrf_register_downstream(target,'purchase_order',po); selected:=po;
    else
      if r.kind<>'po' or r.state<>'active' or not eligible or calculation is null or jsonb_typeof(calculation->'issues') is distinct from 'array' or calculation->'issues'<>'[]'::jsonb or (calculation->>'gross')::numeric<=0 then raise exception 'Resolve pricing, source and zero-value policy blockers first' using errcode='P4804'; end if;
      foreach reason in array array['date','vendorName','shipTo','requisitioner','paymentTerms','shippingTerms'] loop
        if coalesce(length(btrim(r.body->'fields'->>reason)),0)=0 then raise exception 'Complete the required order details' using errcode='P4804'; end if;
      end loop;
      if exists(select 1 from jsonb_array_elements(r.body->'lines') l join private.quotation_revisions rv on rv.id=r.revision_id
        cross join lateral jsonb_array_elements(rv.snapshot->'review'->'rows') config where config->>'id'=l->>'sourceLineId' and config->>'discountType'='fixed' and l->>'discountConfirmed' is distinct from 'true')
        or exists(select 1 from jsonb_array_elements(r.body->'adjustments') a where a->>'confirmed' is distinct from 'true') then raise exception 'Confirm saved line discounts and adjustments' using errcode='P4804'; end if;
      changed:=not coalesce(r.checked->>'version'=r.version::text and r.checked->>'archiveId'=private.quotation_mrf_archive(target)::text and r.checked->>'supplierVersion'=(select version::text from private.suppliers where id=r.supplier_id),false);
      if changed then update private.purchasing_records set calculation=calculation,checked=jsonb_build_object('version',r.version::text,'archiveId',private.quotation_mrf_archive(target),'supplierVersion',(select version::text from private.suppliers where id=r.supplier_id),'actor',actor_snapshot) where id=selected; end if;
      reason:=r.body->>'reason';
    end if;
  else raise exception 'Unsupported purchasing action' using errcode='23514'; end if;

  if changed then
    -- A source revision cannot manufacture additional capacity; all active supplier
    -- work uses the same bound revision (the partial unique index also prevents queues).
    if exists(select 1 from private.purchasing_records p cross join lateral jsonb_array_elements(p.body->'lines') l
      join private.quotation_drafts sourceq on sourceq.id=p.quote_id
      cross join lateral jsonb_array_elements(sourceq.body->'lines') s
      where p.request_id=target and p.state='active' and s->>'id'=l->>'sourceLineId'
      group by p.quote_id,l->>'sourceLineId',s->>'quantity' having sum((l->>'offeredQuantity')::numeric)>(s->>'quantity')::numeric) then raise exception 'Quoted supplier capacity exceeded' using errcode='23514'; end if;
    if kind not in('saveComparison','retryArtifact','checkPo') then perform private.purchasing_apply_claims(actor,target,operation,command->>'expectedDemand',coalesce(reason,'Purchasing preparation')); end if;
    if kind in('savePo','rebind','reopen','convert') then
      insert into private.po_preparers(po_id,actor_id,actor)
        select p.id,caller,actor_snapshot from private.purchasing_records p where p.id=selected and p.kind='po' on conflict do nothing;
    end if;
    insert into private.purchasing_heads(request_id,version) values(target,1) on conflict(request_id) do update set version=private.purchasing_heads.version+1;
    insert into private.audit_events(actor_user_id,actor_name,actor_role,action,entity_type,entity_id,request_id,details)
      select caller,p.display_name,actor->>'activeRole','purchasing.'||kind,'purchasing',target,operation,
        jsonb_build_object('targetId',selected,'reason',reason,'before',before_value,'after',private.purchasing_record_view(selected)) from public.profiles p where p.user_id=caller;
    perform private.quotation_notify();
  end if;
  result:=jsonb_build_object('targetId',selected,'changed',changed);
  insert into private.purchasing_operations values(operation,caller,target,payload,result);
  return result;
end $$;

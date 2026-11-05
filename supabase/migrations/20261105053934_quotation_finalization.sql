-- 4.5b. Source capture remains separate from reviewed calculations and frozen revisions.
create table private.quotation_families (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.material_requests(id),
  supplier_id uuid not null references private.suppliers(id),
  version bigint not null default 1,
  current_quote_id uuid, pending_quote_id uuid,
  unique(request_id,supplier_id)
);
create index quotation_families_supplier on private.quotation_families(supplier_id);
alter table private.quotation_drafts add column family_id uuid references private.quotation_families(id);
insert into private.quotation_families(request_id,supplier_id)
  select distinct request_id,supplier_id from private.quotation_drafts;
update private.quotation_drafts q set family_id=f.id from private.quotation_families f
  where f.request_id=q.request_id and f.supplier_id=q.supplier_id;
update private.quotation_families f set pending_quote_id=q.id from private.quotation_drafts q
  where q.family_id=f.id and q.state='draft';
alter table private.quotation_drafts alter column family_id set not null;
create index quotation_drafts_family on private.quotation_drafts(family_id);
alter table private.quotation_families add foreign key(current_quote_id) references private.quotation_drafts(id) deferrable initially deferred,
  add foreign key(pending_quote_id) references private.quotation_drafts(id) deferrable initially deferred;
create index quotation_families_current on private.quotation_families(current_quote_id);
create index quotation_families_pending on private.quotation_families(pending_quote_id);
alter table private.quotation_drafts drop constraint quotation_drafts_state_check;
alter table private.quotation_drafts add check(state in('draft','cancelled','finalized'));

create table private.quotation_financial_reviews (
  quote_id uuid primary key references private.quotation_drafts(id),
  version bigint not null default 1,
  source_version bigint not null, file_version bigint not null,
  review jsonb not null, calculation jsonb not null, checked jsonb
);
create table private.quotation_revisions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references private.quotation_families(id),
  quote_id uuid not null unique references private.quotation_drafts(id),
  number bigint not null check(number>0),
  mrf_archive_id uuid not null references private.mrf_archive_snapshots(id),
  source_version bigint not null, file_version bigint not null, financial_version bigint not null,
  snapshot jsonb not null,
  finalized_by uuid not null references public.profiles(user_id), finalized_name text not null,
  finalized_at timestamptz not null default clock_timestamp(),
  unique(family_id,number)
);
create index quotation_revisions_mrf_archive on private.quotation_revisions(mrf_archive_id);
create index quotation_revisions_actor on private.quotation_revisions(finalized_by);
alter table private.quotation_drafts add column copied_from_revision uuid references private.quotation_revisions(id);
create index quotation_drafts_copied_from on private.quotation_drafts(copied_from_revision);
create table private.quotation_revision_files (
  revision_id uuid not null references private.quotation_revisions(id),
  file_id uuid not null references private.quotation_files(id),
  metadata jsonb not null,
  primary key(revision_id,file_id)
);
create index quotation_revision_files_file on private.quotation_revision_files(file_id);
create table private.quotation_revision_events (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references private.quotation_revisions(id),
  kind text not null check(kind in('withdraw','reconfirmMrf','activate')),
  mrf_archive_id uuid references private.mrf_archive_snapshots(id),
  actor jsonb not null, reason text not null default '',
  created_at timestamptz not null default clock_timestamp()
);
create index quotation_revision_events_revision on private.quotation_revision_events(revision_id,kind);
create index quotation_revision_events_mrf on private.quotation_revision_events(mrf_archive_id);
create table private.quotation_archive_jobs (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null unique references private.quotation_revisions(id),
  folder_mapping_id uuid not null references private.project_document_folders(id),
  actor jsonb not null, original_actor jsonb not null,
  state text not null default 'pending' check(state in('pending','running','failed','paused','complete')),
  checkpoint jsonb not null default '{}', attempts jsonb not null default '[]',
  lease uuid, lease_until timestamptz, dispatched_at timestamptz,
  message text
);
create index quotation_archive_jobs_folder on private.quotation_archive_jobs(folder_mapping_id);
create index quotation_archive_dispatch on private.quotation_archive_jobs(dispatched_at,id) where state in('pending','running');
create table private.quotation_archives (
  revision_id uuid primary key references private.quotation_revisions(id),
  folder_mapping_id uuid not null references private.project_document_folders(id),
  file_id text not null, sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
  size bigint not null check(size>0), manifest jsonb not null,
  completed_at timestamptz not null default clock_timestamp()
);
create index quotation_archives_folder on private.quotation_archives(folder_mapping_id);

do $$ declare t text; begin
  foreach t in array array['quotation_families','quotation_financial_reviews','quotation_revisions','quotation_revision_files','quotation_revision_events','quotation_archive_jobs','quotation_archives'] loop
    execute format('alter table private.%I enable row level security',t);
    execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
  end loop;
  foreach t in array array['quotation_revisions','quotation_revision_files','quotation_revision_events','quotation_archives'] loop
    execute format('create trigger immutable before update or delete on private.%I for each row execute function private.document_immutable()',t);
  end loop;
end $$;

create function private.quotation_assign_family() returns trigger language plpgsql security definer set search_path='' as $$
declare f private.quotation_families; supplied uuid:=new.family_id;
begin
  insert into private.quotation_families(request_id,supplier_id) values(new.request_id,new.supplier_id) on conflict do nothing;
  select * into f from private.quotation_families where request_id=new.request_id and supplier_id=new.supplier_id for update;
  if f.pending_quote_id is not null or (f.current_quote_id is not null and supplied is null)
    or (supplied is not null and supplied<>f.id) then raise exception 'Use the current family revision; one replacement only' using errcode='23505'; end if;
  new.family_id:=f.id;
  update private.quotation_families set pending_quote_id=new.id,version=version+1 where id=f.id;
  return new;
end $$;
create trigger quotation_assign_family before insert on private.quotation_drafts for each row execute function private.quotation_assign_family();
create function private.quotation_frozen_source() returns trigger language plpgsql set search_path='' as $$
begin
  if old.state='finalized' then raise exception 'Finalized quotation source is immutable' using errcode='23514'; end if;
  if tg_op='DELETE' then raise exception 'Quotation history is retained' using errcode='23514'; end if;
  if old.family_id<>new.family_id or old.request_id<>new.request_id or old.supplier_id<>new.supplier_id or old.copied_from_revision is distinct from new.copied_from_revision then
    raise exception 'Quotation ownership is fixed' using errcode='23514'; end if;
  return new;
end $$;
create trigger quotation_frozen_source before update or delete on private.quotation_drafts for each row execute function private.quotation_frozen_source();
create function private.quotation_frozen_review() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from private.quotation_drafts where id=old.quote_id and state='finalized') then raise exception 'Finalized financial review is immutable' using errcode='23514'; end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger quotation_frozen_review before update or delete on private.quotation_financial_reviews for each row execute function private.quotation_frozen_review();
create function private.quotation_retained_original() returns trigger language plpgsql set search_path='' as $$
begin
  if old.retained then
    if tg_op='DELETE' then raise exception 'Finalized original is retained' using errcode='23514'; end if;
    if not new.retained or (to_jsonb(old)-array['lease','lease_until','encrypted_session','offset_bytes']) is distinct from (to_jsonb(new)-array['lease','lease_until','encrypted_session','offset_bytes']) then raise exception 'Finalized original metadata is immutable' using errcode='23514'; end if;
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger quotation_retained_original before update or delete on private.quotation_files for each row execute function private.quotation_retained_original();

create function private.quotation_mrf_archive(target uuid) returns uuid language sql stable security definer set search_path='' as $$
  select s.id from private.mrf_archive_snapshots s join private.mrf_archives a on a.snapshot_id=s.id
    where s.request_id=target and private.mrf_ready(target) order by s.version desc limit 1;
$$;
create function private.quotation_revision_blockers(target uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r private.quotation_revisions; q private.quotation_drafts; current_mrf uuid; reasons jsonb:='[]';
begin
  select * into r from private.quotation_revisions where id=target;
  if not found then return '["Revision unavailable"]'; end if;
  select * into q from private.quotation_drafts where id=r.quote_id;
  if exists(select 1 from private.quotation_revision_events where revision_id=target and kind='withdraw') then reasons:=reasons||'"Withdrawn permanently"'::jsonb; end if;
  if not exists(select 1 from private.suppliers s where s.id=q.supplier_id and s.is_active) then reasons:=reasons||'"Supplier is inactive"'::jsonb; end if;
  if nullif(q.body->>'validUntil','')::date<(now() at time zone 'Asia/Manila')::date then reasons:=reasons||'"Offer has expired"'::jsonb; end if;
  current_mrf:=private.quotation_mrf_archive(q.request_id);
  if current_mrf is null then reasons:=reasons||'"Current MRF approval/archive is unavailable"'::jsonb;
  elsif current_mrf<>r.mrf_archive_id and not exists(select 1 from private.quotation_revision_events e where e.revision_id=target and e.kind='reconfirmMrf' and e.mrf_archive_id=current_mrf) then reasons:=reasons||'"Review the corrected MRF and reconfirm applicability"'::jsonb; end if;
  if not exists(select 1 from private.quotation_archives where revision_id=target) then reasons:=reasons||'"Quotation archive is incomplete"'::jsonb; end if;
  return reasons;
end $$;
create function private.quotation_try_activate(target uuid,actor jsonb,operation uuid default null,reason text default 'Archive complete and current eligibility verified') returns boolean
language plpgsql security definer set search_path='' as $$
declare r private.quotation_revisions; f private.quotation_families;
begin
  select * into r from private.quotation_revisions where id=target;
  select * into f from private.quotation_families where id=r.family_id for update;
  if f.pending_quote_id is distinct from r.quote_id or private.quotation_revision_blockers(target)<>'[]'::jsonb then return false; end if;
  update private.quotation_families set current_quote_id=r.quote_id,pending_quote_id=null,version=version+1 where id=f.id;
  insert into private.quotation_revision_events(revision_id,kind,actor,reason) values(target,'activate',actor,reason);
  perform private.quotation_audit(actor,'quotation.activateRevision',r.quote_id,operation,jsonb_build_object('revisionId',r.id,'previousQuoteId',f.current_quote_id,'reason',reason));
  return true;
end $$;

alter function private.quotation_view(uuid) rename to quotation_capture_view;
create function private.quotation_view(target uuid) returns jsonb language sql stable security definer set search_path='' as $$
  select private.quotation_capture_view(target)||jsonb_build_object('contentVersion',q.content_version::text,
    'family',jsonb_build_object('id',f.id,'version',f.version::text,'currentQuoteId',f.current_quote_id,'pendingQuoteId',f.pending_quote_id,
      'currentMrfArchiveId',private.quotation_mrf_archive(q.request_id),'supplierActive',exists(select 1 from private.suppliers s where s.id=q.supplier_id and s.is_active)),
    'financial',case when v.quote_id is null then jsonb_build_object('version','1','sourceVersion',q.content_version::text,'filesVersion',q.file_version::text,'review',null,'calculation',null,'checked',false)
      else jsonb_build_object('version',v.version::text,'sourceVersion',v.source_version::text,'filesVersion',v.file_version::text,'review',v.review,'calculation',v.calculation,
        'checked',coalesce(v.source_version=q.content_version and v.file_version=q.file_version and v.checked->>'version'=v.version::text and v.checked->>'sourceVersion'=q.content_version::text and v.checked->>'filesVersion'=q.file_version::text,false)) end,
    'revision',case when r.id is null then null else jsonb_build_object('id',r.id,'number',r.number::text,'finalizedBy',r.finalized_name,'finalizedAt',r.finalized_at,'mrfArchiveId',r.mrf_archive_id,
      'withdrawn',exists(select 1 from private.quotation_revision_events e where e.revision_id=r.id and e.kind='withdraw'),
      'current',f.current_quote_id=q.id,'eligible',f.current_quote_id=q.id and private.quotation_revision_blockers(r.id)='[]'::jsonb,
      'blockers',private.quotation_revision_blockers(r.id),'archiveState',coalesce(j.state,'pending'),'archiveMessage',j.message,
      'pdfAvailable',exists(select 1 from private.quotation_archives a where a.revision_id=r.id)) end)
  from private.quotation_drafts q join private.quotation_families f on f.id=q.family_id
    left join private.quotation_financial_reviews v on v.quote_id=q.id left join private.quotation_revisions r on r.quote_id=q.id
    left join private.quotation_archive_jobs j on j.revision_id=r.id where q.id=target;
$$;

-- Capture commands still own their existing retry receipts. Guard family reopening
-- and lock finalized sources without changing the public capture contract.
alter function private.quotation_command(jsonb,jsonb) rename to quotation_capture_command;
create function private.quotation_command(actor jsonb,command jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
<<capture_guard>>
declare result jsonb; q private.quotation_drafts; f private.quotation_families; before_state text;
begin
  perform set_config('lock_timeout','5s',true); update private.account_guard set revision=revision+1 where id;
  perform private.quotation_actor(actor,true);
  if command->>'type'='status' then
    select * into q from private.quotation_drafts where id=(command->>'quoteId')::uuid;
    perform 1 from public.material_requests where id=q.request_id for update;
    select * into f from private.quotation_families where id=q.family_id for update;
    before_state:=q.state;
    if q.state='finalized' then raise exception 'Use withdrawal or a new revision' using errcode='23514'; end if;
    if command->>'state'='draft' and f.pending_quote_id is not null and f.pending_quote_id<>q.id then raise exception 'One replacement only' using errcode='23505'; end if;
  end if;
  result:=private.quotation_capture_command(actor,command);
  select * into q from private.quotation_drafts where id=(result->>'quoteId')::uuid;
  if command->>'type'='status' and coalesce((result->>'changed')::boolean,false) then
    if q.state='cancelled' then update private.quotation_families set pending_quote_id=null,version=version+1 where id=q.family_id and pending_quote_id=q.id;
    elsif before_state='cancelled' then
      update private.quotation_families set pending_quote_id=q.id,version=version+1 where id=q.family_id;
      update private.quotation_drafts set checked=null,matches='{}' where id=q.id;
      update private.quotation_financial_reviews set checked=null,version=version+1 where quote_id=q.id;
    end if;
    result:=result||jsonb_build_object('quote',private.quotation_view(q.id));
    update private.quotation_operations set result=capture_guard.result where id=(command->>'requestId')::uuid;
  end if;
  return result;
end $$;

create function private.quotation_financial_command(actor jsonb,command jsonb,calculation jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
<<finance>>
declare caller uuid; operation uuid:=(command->>'requestId')::uuid; kind text:=command->>'type'; target uuid:=(command->>'quoteId')::uuid;
  q private.quotation_drafts; f private.quotation_families; v private.quotation_financial_reviews; r private.quotation_revisions;
  receipt private.quotation_operations; result jsonb; review jsonb; next_quote uuid; snap uuid; mapping uuid; original uuid; current_mrf uuid;
  actor_snapshot jsonb; reason text:=btrim(coalesce(command->>'reason','')); changed boolean:=true; review_row jsonb; matched integer:=0; key text;
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
        if not exists(select 1 from private.suppliers where id=q.supplier_id and is_active) then raise exception 'Supplier is inactive' using errcode='P4504'; end if;
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
              'mrfRef',(select ref from public.material_requests where id=q.request_id),'supplierId',q.supplier_id,'actor',actor_snapshot,'copiedFromRevisionId',q.copied_from_revision,
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
      if exists(select 1 from private.quotation_revision_events where revision_id=r.id and kind='withdraw') then changed:=false;
      else
        insert into private.quotation_revision_events(revision_id,kind,actor,reason) values(r.id,'withdraw',actor_snapshot,reason);
        update private.quotation_families set pending_quote_id=case when pending_quote_id=q.id then null else pending_quote_id end,version=version+1 where id=f.id;
      end if;
    elsif kind in('reconfirmMrf','activateRevision') then
      if current_mrf is null or current_mrf::text is distinct from command->>'expectedMrf' or length(reason) not between 5 and 2000 then raise exception 'Review the exact current MRF archive' using errcode='40001'; end if;
      if exists(select 1 from private.quotation_revision_events where revision_id=r.id and kind='withdraw') then raise exception 'Withdrawn revisions cannot be restored' using errcode='P4504'; end if;
      if kind='reconfirmMrf' then
        insert into private.quotation_revision_events(revision_id,kind,mrf_archive_id,actor,reason) values(r.id,'reconfirmMrf',current_mrf,actor_snapshot,reason);
        update private.quotation_families set version=version+1 where id=f.id;
        perform private.quotation_try_activate(r.id,actor_snapshot,operation,reason);
      elsif not private.quotation_try_activate(r.id,actor_snapshot,operation,reason) then raise exception 'Replacement still has eligibility blockers' using errcode='P4504'; end if;
    elsif kind='retryArchive' then
      select d.id into mapping from private.project_document_folders d join public.material_requests m on m.project_id=d.project_id where m.id=q.request_id and d.current;
      if mapping is null then raise exception 'Project document folder required' using errcode='P4201'; end if;
      update private.quotation_archive_jobs set state='pending',actor=actor_snapshot,lease=null,lease_until=null,dispatched_at=null,message=null,
        attempts=attempts||jsonb_build_array(jsonb_build_object('folderMappingId',folder_mapping_id,'checkpoint',checkpoint,'actor',actor,'retriedBy',actor_snapshot)),
        checkpoint=case when folder_mapping_id=mapping then checkpoint else '{}'::jsonb end,folder_mapping_id=mapping
        where revision_id=r.id and state in('failed','paused');
      if not found then raise exception 'Choose a failed archive' using errcode='P4504'; end if;
    end if;
  end if;
  if changed then perform private.quotation_audit(actor,'quotation.'||kind,target,operation,jsonb_build_object('revisionId',snap,'fromQuoteId',q.id,'reason',reason,'review',case when kind='saveFinancial' then command->'review' else null end)); end if;
  result:=jsonb_build_object('quoteId',target,'changed',changed,'quote',private.quotation_view(target));
  update private.quotation_operations set result=finance.result where id=operation;
  if changed then perform private.quotation_notify(); end if;
  return result;
end $$;

create or replace function private.quotation_commit_group(target uuid) returns void
language plpgsql security definer set search_path='' as $$
declare g private.quotation_groups; q private.quotation_drafts; previous uuid[]; old_file uuid;
begin
  select * into g from private.quotation_groups where id=target for update;
  if g.state<>'uploading' or not private.quotation_job_allowed(g.actor,g.quote_id) then return; end if;
  select * into q from private.quotation_drafts where id=g.quote_id for update;
  if q.state<>'draft' then return; end if;
  if q.file_version<>g.expected_version then update private.quotation_groups set state='conflict' where id=target; return; end if;
  if exists(select 1 from unnest(g.files) selected(id) where not exists(
    select 1 from private.quotation_files f where f.id=selected.id and f.state='verified' and
      (f.quote_id=q.id or exists(select 1 from private.quotation_revision_files rf join private.quotation_revisions r on r.id=rf.revision_id where rf.file_id=f.id and r.family_id=q.family_id)))) then return; end if;
  previous:=q.current_files;
  if previous=g.files then update private.quotation_groups set state='committed' where id=target; return; end if;
  update private.quotation_drafts set current_files=g.files,file_version=file_version+1,checked=null,matches='{}' where id=q.id;
  update private.quotation_groups set state='committed' where id=target;
  perform private.quotation_audit(g.actor,'quotation.files',q.id,target,jsonb_build_object('before',previous,'after',g.files,'originalActor',g.original_actor,
    'beforeFiles',coalesce((select jsonb_agg(jsonb_build_object('name',f.name,'mime',f.mime,'size',f.size,'sha256',f.sha256) order by f.id) from private.quotation_files f where f.id=any(previous)),'[]'),
    'afterFiles',coalesce((select jsonb_agg(jsonb_build_object('name',f.name,'mime',f.mime,'size',f.size,'sha256',f.sha256) order by f.id) from private.quotation_files f where f.id=any(g.files)),'[]')));
  foreach old_file in array previous loop
    if not old_file=any(g.files) then perform private.quotation_enqueue(old_file,'cleanup',g.actor); end if;
  end loop;
end $$;
create or replace function private.quotation_file(actor jsonb,file_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare f private.quotation_files;
begin
  perform private.quotation_actor(actor);
  select * into f from private.quotation_files where id=file_id and state='verified';
  if f.id is null or not (exists(select 1 from private.quotation_drafts q where f.id=any(q.current_files))
    or exists(select 1 from private.quotation_revision_files rf where rf.file_id=f.id)) then raise exception 'Original unavailable' using errcode='42501'; end if;
  return jsonb_build_object('id',f.id,'fileId',f.drive_file_id,'name',f.name,'mime',f.mime,'size',f.size);
end $$;

create function private.quotation_archive_allowed(actor jsonb) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles p join auth.users u on u.id=p.user_id join public.role_grants g on g.user_id=p.user_id and g.role='Procurement'
    where p.user_id=(actor->>'userId')::uuid and p.is_active and p.access_revision::text=actor->>'revision' and actor->>'activeRole'='Procurement'
      and not u.is_anonymous and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now()));
$$;
create function private.quotation_archive_dispatch() returns jsonb language plpgsql security definer set search_path='' as $$
declare ids uuid[];
begin
  with pending as (select id from private.quotation_archive_jobs where state in('pending','running')
    and (lease_until is null or lease_until<now()) and (dispatched_at is null or dispatched_at<now()-interval '2 minutes')
    order by id for update skip locked limit 10), admitted as (
    update private.quotation_archive_jobs set dispatched_at=clock_timestamp() where id in(select id from pending) returning id)
  select array_agg(id) into ids from admitted;
  -- Return only durable IDs; no snapshot or document bytes enter Workflow payloads.
  return to_jsonb(coalesce(ids,'{}'::uuid[]));
end $$;

create function private.quotation_archive_worker(job_id uuid,action text,lease_id uuid default null,patch jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare j private.quotation_archive_jobs; r private.quotation_revisions; q private.quotation_drafts; acquired uuid; k text; new_checkpoint jsonb;
begin
  perform set_config('lock_timeout','5s',true); update private.account_guard set revision=revision+1 where id;
  select * into j from private.quotation_archive_jobs where id=job_id;
  if not found then return null; end if;
  select * into r from private.quotation_revisions where id=j.revision_id;
  select * into q from private.quotation_drafts where id=r.quote_id;
  perform 1 from public.material_requests where id=q.request_id for update;
  perform 1 from private.quotation_families where id=r.family_id for update;
  select * into j from private.quotation_archive_jobs where id=job_id for update;
  if j.state='complete' then return null; end if;
  if not private.quotation_archive_allowed(j.actor) then
    update private.quotation_archive_jobs set state='paused',lease=null,lease_until=null,message='Procurement access changed. A current Procurement colleague can retry.' where id=job_id;
    perform private.quotation_notify(); return null;
  end if;
  if action='claim' then
    if j.state not in('pending','running') or (j.lease_until is not null and j.lease_until>now()) then return null; end if;
    acquired:=gen_random_uuid();
    update private.quotation_archive_jobs set state='running',lease=acquired,lease_until=now()+interval '5 minutes',message=null where id=job_id;
  else
    if j.state<>'running' or j.lease is distinct from lease_id or j.lease_until<=now() then return null; end if;
    acquired:=j.lease;
    if action='checkpoint' then
      if jsonb_typeof(patch) is distinct from 'object' or octet_length(patch::text)>20000 then raise exception 'Invalid archive checkpoint' using errcode='23514'; end if;
      for k in select jsonb_object_keys(patch) loop
        if k not in('folderId','pdfFileId','pdfSha256','pdfSize','manifest','verified') then raise exception 'Unexpected archive checkpoint field' using errcode='23514'; end if;
      end loop;
      update private.quotation_archive_jobs set checkpoint=checkpoint||patch,lease_until=now()+interval '5 minutes' where id=job_id;
    elsif action='fail' then
      update private.quotation_archive_jobs set state='failed',lease=null,lease_until=null,message='The quotation archive could not be verified. Retry the archive; the frozen revision and originals are retained.' where id=job_id;
      perform private.quotation_notify(); return null;
    elsif action='complete' then
      new_checkpoint:=j.checkpoint;
      if new_checkpoint->>'verified' is distinct from 'true' or new_checkpoint->>'pdfFileId' is null
        or new_checkpoint->>'pdfSha256' !~ '^[a-f0-9]{64}$' or new_checkpoint->>'pdfSize' !~ '^[0-9]+$'
        or (new_checkpoint->>'pdfSize')::bigint not between 5 and 52428800 or jsonb_typeof(new_checkpoint->'manifest') is distinct from 'array'
        or jsonb_array_length(new_checkpoint->'manifest')<>(select count(*) from private.quotation_revision_files where revision_id=r.id)
        or exists(select 1 from private.quotation_revision_files rf where rf.revision_id=r.id and not exists(
          select 1 from jsonb_array_elements(new_checkpoint->'manifest') proof where proof->>'id'=rf.file_id::text
            and proof->>'sha256'=rf.metadata->>'sha256' and proof->'size'=rf.metadata->'size')) then raise exception 'Archive proof does not match frozen source' using errcode='23514'; end if;
      insert into private.quotation_archives(revision_id,folder_mapping_id,file_id,sha256,size,manifest)
        values(r.id,j.folder_mapping_id,new_checkpoint->>'pdfFileId',new_checkpoint->>'pdfSha256',(new_checkpoint->>'pdfSize')::bigint,new_checkpoint->'manifest');
      update private.quotation_archive_jobs set state='complete',lease=null,lease_until=null where id=job_id;
      perform private.quotation_audit(j.actor,'quotation.archiveComplete',r.quote_id,j.id,jsonb_build_object('revisionId',r.id,'originalActor',j.original_actor,'retryingActor',j.actor));
      perform private.quotation_try_activate(r.id,j.actor,j.id);
      perform private.quotation_notify(); return null;
    else raise exception 'Invalid archive worker action' using errcode='23514'; end if;
  end if;
  return (select to_jsonb(x)||jsonb_build_object('lease',acquired,'revision',to_jsonb(r)||jsonb_build_object('number',r.number::text),
    'folder',(select to_jsonb(d) from private.project_document_folders d where d.id=x.folder_mapping_id),
    'files',coalesce((select jsonb_agg(rf.metadata||jsonb_build_object('folder',(select to_jsonb(d) from private.project_document_folders d where d.id=(rf.metadata->>'folderMappingId')::uuid)) order by rf.file_id)
      from private.quotation_revision_files rf where rf.revision_id=r.id),'[]')) from private.quotation_archive_jobs x where x.id=job_id);
end $$;

create function private.quotation_review_pdf(actor jsonb,revision_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a private.quotation_archives; r private.quotation_revisions;
begin
  perform private.quotation_actor(actor);
  select * into a from private.quotation_archives where quotation_archives.revision_id=quotation_review_pdf.revision_id;
  select * into r from private.quotation_revisions where id=quotation_review_pdf.revision_id;
  if a.revision_id is null then raise exception 'Review PDF unavailable' using errcode='P4501'; end if;
  return jsonb_build_object('fileId',a.file_id,'name','Quotation-review-r'||r.number||'.pdf','size',a.size,'mime','application/pdf');
end $$;

create function public.quotation_financial_command(actor jsonb,command jsonb,calculation jsonb default null) returns jsonb language sql security invoker set search_path='' as $$ select private.quotation_financial_command(actor,command,calculation); $$;
create function private.quotation_financial_source(actor jsonb,quote_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare parent uuid;
begin
  perform private.quotation_actor(actor,true);
  select request_id into parent from private.quotation_drafts where id=quote_id;
  if parent is null then raise exception 'Quotation unavailable' using errcode='P4501'; end if;
  return jsonb_build_object('request',null,'suppliers','[]'::jsonb,'quotes',jsonb_build_array(private.quotation_view(quote_id)),'history','[]'::jsonb);
end $$;
create function public.quotation_financial_source(actor jsonb,quote_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.quotation_financial_source(actor,quote_id); $$;
create function public.quotation_archive_dispatch() returns jsonb language sql security invoker set search_path='' as $$ select private.quotation_archive_dispatch(); $$;
create function public.quotation_archive_worker(job_id uuid,action text,lease_id uuid default null,patch jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$ select private.quotation_archive_worker(job_id,action,lease_id,patch); $$;
create function public.quotation_review_pdf(actor jsonb,revision_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.quotation_review_pdf(actor,revision_id); $$;
do $$ declare fn record; begin
  for fn in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('private','public') and p.proname like 'quotation%' loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',fn.signature);
  end loop;
end $$;
grant execute on function private.quotations_read(jsonb,uuid),public.quotations_read(jsonb,uuid),private.quotation_command(jsonb,jsonb),public.quotation_command(jsonb,jsonb),
  private.quotation_files_command(jsonb,jsonb),public.quotation_files_command(jsonb,jsonb),private.quotation_transfer(jsonb,uuid,text,uuid,jsonb),public.quotation_transfer(jsonb,uuid,text,uuid,jsonb),
  private.quotation_worker(uuid,text,uuid,jsonb),public.quotation_worker(uuid,text,uuid,jsonb),private.quotation_dispatch(),public.quotation_dispatch(),private.quotation_file(jsonb,uuid),public.quotation_file(jsonb,uuid),
  private.quotation_financial_command(jsonb,jsonb,jsonb),public.quotation_financial_command(jsonb,jsonb,jsonb),private.quotation_archive_dispatch(),public.quotation_archive_dispatch(),
  private.quotation_financial_source(jsonb,uuid),public.quotation_financial_source(jsonb,uuid),
  private.quotation_archive_worker(uuid,text,uuid,jsonb),public.quotation_archive_worker(uuid,text,uuid,jsonb),private.quotation_review_pdf(jsonb,uuid),public.quotation_review_pdf(jsonb,uuid) to service_role;

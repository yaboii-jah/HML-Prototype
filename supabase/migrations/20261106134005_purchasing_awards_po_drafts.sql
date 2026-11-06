-- 4.8 owning purchasing transactions; no browser access to private records/helpers.
alter table private.document_counters drop constraint document_counters_series_check;
alter table private.document_counters add constraint document_counters_series_check check(series in('MRF','PO'));

create table private.purchasing_heads (
  request_id uuid primary key references public.material_requests(id), version bigint not null default 0 check(version>=0)
);
create table private.purchasing_records (
  id uuid primary key, request_id uuid not null references public.material_requests(id),
  project_id uuid not null references public.projects(id), supplier_id uuid not null references private.suppliers(id),
  quote_id uuid not null references private.quotation_drafts(id), revision_id uuid not null references private.quotation_revisions(id),
  kind text not null check(kind in('award','po')), state text not null default 'active' check(state in('active','cancelled','converted')),
  version bigint not null default 1, ref text unique, body jsonb not null, calculation jsonb, checked jsonb,
  updated_at timestamptz not null default clock_timestamp(),
  check(jsonb_typeof(body)='object'), check(kind='po' or ref is null), check(kind='award' or state<>'converted')
);
create unique index purchasing_one_active_supplier on private.purchasing_records(request_id,supplier_id) where state='active';
create index purchasing_records_request on private.purchasing_records(request_id);
create index purchasing_records_project on private.purchasing_records(project_id);
create index purchasing_records_supplier on private.purchasing_records(supplier_id);
create index purchasing_records_quote on private.purchasing_records(quote_id);
create index purchasing_records_revision on private.purchasing_records(revision_id);
create table private.purchasing_claims (
  id uuid primary key references private.demand_claims(id) deferrable initially deferred,
  record_id uuid not null references private.purchasing_records(id), line_id uuid not null,
  item_id uuid not null references public.material_request_items(id), unique(record_id,line_id)
);
create index purchasing_claims_item on private.purchasing_claims(item_id);
create table private.po_preparers (
  po_id uuid not null references private.purchasing_records(id), actor_id uuid not null references public.profiles(user_id),
  actor jsonb not null, first_prepared_at timestamptz not null default clock_timestamp(), primary key(po_id,actor_id)
);
create index po_preparers_actor on private.po_preparers(actor_id);
create table private.purchasing_operations (
  id uuid primary key, actor_id uuid not null references public.profiles(user_id), request_id uuid not null references public.material_requests(id),
  payload jsonb not null, result jsonb not null
);
create index purchasing_operations_request on private.purchasing_operations(request_id);
create index purchasing_operations_actor on private.purchasing_operations(actor_id);
create table private.comparison_reports (
  id uuid primary key, request_id uuid not null references public.material_requests(id), version bigint not null check(version>0),
  snapshot jsonb not null, actor jsonb not null, created_at timestamptz not null default clock_timestamp(), unique(request_id,version)
);
create table private.comparison_artifacts (
  id uuid primary key default gen_random_uuid(), report_id uuid not null references private.comparison_reports(id),
  format text not null check(format in('pdf','xlsx')), actor jsonb not null, original_actor jsonb not null,
  folder_mapping_id uuid not null references private.project_document_folders(id),
  state text not null default 'pending' check(state in('pending','running','failed','paused','complete')),
  checkpoint jsonb not null default '{}', attempts jsonb not null default '[]', lease uuid, lease_until timestamptz,
  dispatched_at timestamptz, message text, unique(report_id,format)
);
create index comparison_artifacts_folder on private.comparison_artifacts(folder_mapping_id);
create index comparison_artifacts_dispatch on private.comparison_artifacts(dispatched_at,id) where state in('pending','running');
create table private.comparison_archives (
  artifact_id uuid primary key references private.comparison_artifacts(id), folder_mapping_id uuid not null references private.project_document_folders(id),
  file_id text not null, sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'), size bigint not null check(size between 5 and 52428800),
  completed_at timestamptz not null default clock_timestamp()
);
create index comparison_archives_folder on private.comparison_archives(folder_mapping_id);
do $$ declare t text; begin
  foreach t in array array['purchasing_heads','purchasing_records','purchasing_claims','po_preparers','purchasing_operations','comparison_reports','comparison_artifacts','comparison_archives'] loop
    execute format('alter table private.%I enable row level security',t);
    execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
  end loop;
  foreach t in array array['po_preparers','purchasing_claims','purchasing_operations','comparison_reports','comparison_archives'] loop
    execute format('create trigger immutable before update or delete on private.%I for each row execute function private.document_immutable()',t);
  end loop;
end $$;

create function private.purchasing_blockers(target uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r private.purchasing_records; result jsonb;
begin
  select * into r from private.purchasing_records where id=target;
  result:=private.quotation_revision_blockers(r.revision_id);
  if not exists(select 1 from private.quotation_families f where f.current_quote_id=r.quote_id) then result:=result||'"A newer supplier quotation must be reviewed and rebound"'::jsonb; end if;
  if r.kind='po' and r.calculation->>'gross'='0.00' then result:=result||'"Zero-value order: Accounting policy is required before submission"'::jsonb; end if;
  return result;
end $$;

create function private.purchasing_record_view(target uuid) returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',r.id,'kind',r.kind,'mrfId',r.request_id,'supplierId',r.supplier_id,'quoteId',r.quote_id,'revisionId',r.revision_id,
    'version',r.version::text,'state',r.state,'ref',r.ref,'body',r.body,'calculation',r.calculation,'updatedAt',r.updated_at,
    'checked',coalesce(r.checked->>'version'=r.version::text and r.checked->>'archiveId'=private.quotation_mrf_archive(r.request_id)::text
      and r.checked->>'supplierVersion'=(select version::text from private.suppliers where id=r.supplier_id) and private.purchasing_blockers(r.id)='[]'::jsonb,false),
    'blockers',private.purchasing_blockers(r.id)) from private.purchasing_records r where r.id=target;
$$;
create function private.purchasing_read(actor jsonb,target_request uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare parent jsonb; demand jsonb;
begin
  perform private.quotation_actor(actor);
  if target_request is null then
    return jsonb_build_object('records',coalesce((select jsonb_agg(private.purchasing_record_view(r.id) order by r.updated_at desc,r.id) from private.purchasing_records r where r.kind='po'),'[]'));
  end if;
  parent:=private.quotations_read(actor,target_request)||jsonb_build_object('role',actor->>'activeRole');
  demand:=private.demand_snapshot(target_request);
  return jsonb_build_object('role',actor->>'activeRole','version',coalesce((select version::text from private.purchasing_heads where request_id=target_request),'0'),
    'demandVersion',demand->>'version','claims',demand->'claims','quotations',parent,
    'records',coalesce((select jsonb_agg(private.purchasing_record_view(r.id) order by r.updated_at,r.id) from private.purchasing_records r where r.request_id=target_request),'[]'),
    'reports',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'version',r.version::text,'createdAt',r.created_at,
      'artifacts',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'format',a.format,'state',a.state,'message',a.message) order by a.format) from private.comparison_artifacts a where a.report_id=r.id),'[]')) order by r.version desc) from private.comparison_reports r where r.request_id=target_request),'[]'),
    'history',coalesce((select jsonb_agg(h.entry order by h.occurred_at desc,h.id) from (
      select a.id,a.occurred_at,jsonb_build_object('id',a.id,'actorName',a.actor_name,'actorRole',a.actor_role,'action',a.action,'at',a.occurred_at,'details',a.details) entry
      from private.audit_events a where a.entity_type='purchasing' and a.entity_id=target_request order by a.occurred_at desc,a.id limit 30) h),'[]'));
end $$;

-- Reconcile all retained owner-line claims in one final-state demand batch.
create function private.purchasing_apply_claims(actor jsonb,target uuid,operation uuid,expected text,reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r private.purchasing_records; old_claim private.purchasing_claims; line jsonb; changes jsonb:='[]'; claim uuid; amount text; result jsonb;
begin
  for r in select * from private.purchasing_records where request_id=target order by id loop
    for old_claim in select * from private.purchasing_claims where record_id=r.id order by id loop
      select l into line from jsonb_array_elements(r.body->'lines') l where l->>'id'=old_claim.line_id::text;
      amount:=case when r.state='active' and line is not null then line->>'quantity' else '0' end;
      if line is not null and (line->>'itemId')::uuid<>old_claim.item_id then raise exception 'Saved material identity is fixed' using errcode='23514'; end if;
      if exists(select 1 from private.demand_claims c where c.id=old_claim.id and c.quantity=amount::numeric) then continue; end if;
      changes:=changes||jsonb_build_array(jsonb_build_object('claimId',old_claim.id,'itemId',old_claim.item_id,'ownerKind',case when r.kind='award' then 'award' else 'purchase_order' end,'ownerId',r.id,'ownerLineId',old_claim.line_id,'quantity',amount));
    end loop;
    if r.state='active' then
      for line in select * from jsonb_array_elements(r.body->'lines') loop
        if not exists(select 1 from private.purchasing_claims c where c.record_id=r.id and c.line_id=(line->>'id')::uuid) then
          claim:=gen_random_uuid();
          insert into private.purchasing_claims(id,record_id,line_id,item_id) values(claim,r.id,(line->>'id')::uuid,(line->>'itemId')::uuid);
          changes:=changes||jsonb_build_array(jsonb_build_object('claimId',claim,'itemId',line->>'itemId','ownerKind',case when r.kind='award' then 'award' else 'purchase_order' end,'ownerId',r.id,'ownerLineId',line->>'id','quantity',line->>'quantity'));
        end if;
      end loop;
    end if;
  end loop;
  if jsonb_array_length(changes)>0 then result:=private.demand_apply(actor,operation,target,expected,changes,reason); end if;
  return result;
end $$;

-- Prices/classifications are never accepted from the browser; normalize review stamps
-- against the last saved payload, and validate every source/demand/capacity identity.
create function private.purchasing_validate_body(target uuid,quote uuid,body jsonb,previous jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare q private.quotation_drafts; revision private.quotation_revisions; line jsonb; source jsonb; config jsonb; prior jsonb; adjusted jsonb:='[]'; ids text[]:='{}'; expected_adjustments bigint; basis_changed boolean;
begin
  select * into q from private.quotation_drafts where id=quote and request_id=target;
  select * into revision from private.quotation_revisions where quote_id=q.id;
  if revision.id is null or jsonb_typeof(body->'lines') is distinct from 'array' or jsonb_array_length(body->'lines') not between 1 and 1000
    or jsonb_typeof(body->'fields') is distinct from 'object' or jsonb_typeof(body->'adjustments') is distinct from 'array'
    or length(btrim(body->>'reason')) not between 5 and 2000 then raise exception 'Review the supplier reason and order fields' using errcode='23514'; end if;
  basis_changed:=coalesce((select jsonb_agg(l-array['discountReason','discountConfirmed'] order by l->>'id') from jsonb_array_elements(coalesce(previous->'lines','[]')) l),'[]')
    is distinct from coalesce((select jsonb_agg(l-array['discountReason','discountConfirmed'] order by l->>'id') from jsonb_array_elements(body->'lines') l),'[]');
  for line in select * from jsonb_array_elements(body->'lines') loop
    if line->>'id'=any(ids) or line->>'sourceLineId'=any(ids) then raise exception 'Duplicate order row' using errcode='23514'; end if;
    ids:=ids||array[line->>'id',line->>'sourceLineId'];
    select l into source from jsonb_array_elements(revision.snapshot->'source'->'lines') l where l->>'id'=line->>'sourceLineId';
    select c into config from jsonb_array_elements(revision.snapshot->'review'->'rows') c where c->>'id'=line->>'sourceLineId';
    if source is null or config->>'role' is distinct from 'material' or source->>'requestItemId' is distinct from line->>'itemId'
      or not exists(select 1 from public.material_request_items i where i.id=(line->>'itemId')::uuid and i.request_id=target)
      or revision.snapshot->'matches'->(source->>'id')->'line' is distinct from source
      or revision.snapshot->'matches'->(source->>'id')->>'fileVersion' is distinct from revision.file_version::text then raise exception 'Confirmed matched source material required' using errcode='23514'; end if;
    if config->>'discountType'<>'fixed' and coalesce(line->>'fixedDiscount','')<>'' then raise exception 'Quoted percentage rates and discount classification are fixed' using errcode='23514'; end if;
    if jsonb_typeof(line->'quantity') is distinct from 'string' or jsonb_typeof(line->'offeredQuantity') is distinct from 'string'
      or length(line->>'quantity')>80 or length(line->>'offeredQuantity')>80 or line->>'quantity' !~ '^[0-9]+(\.[0-9]+)?$' or line->>'offeredQuantity' !~ '^[0-9]+(\.[0-9]+)?$'
      or (line->>'quantity')::numeric<=0 or (line->>'offeredQuantity')::numeric<=0
      or (line->>'offeredQuantity')::numeric*(source->>'conversionFactor')::numeric<>(line->>'quantity')::numeric
      or (line->>'offeredQuantity')::numeric>(source->>'quantity')::numeric then raise exception 'Exact positive source quantity required' using errcode='23514'; end if;
    select p into prior from jsonb_array_elements(coalesce(previous->'lines','[]')) p where p->>'id'=line->>'id';
    if prior is null or (prior-array['discountConfirmed','discountReason']) is distinct from (line-array['discountConfirmed','discountReason']) then line:=line||'{"discountConfirmed":false}'; end if;
    adjusted:=adjusted||jsonb_build_array(line);
  end loop;
  body:=jsonb_set(body,'{lines}',adjusted); adjusted:='[]';
  select (select count(*) from jsonb_array_elements(revision.snapshot->'review'->'rows') c where c->>'role' in('shipping','other','discount'))+
    (select count(*) from jsonb_array_elements(revision.snapshot->'review'->'adjustments') c where c->>'kind' in('shipping','other','discount')) into expected_adjustments;
  if jsonb_array_length(body->'adjustments')<>expected_adjustments then raise exception 'Review every quoted adjustment; no invented charges' using errcode='23514'; end if;
  ids:='{}';
  for line in select * from jsonb_array_elements(body->'adjustments') loop
    if (line->>'sourceKind')||':'||(line->>'id')=any(ids) or line->>'sourceKind' not in('line','adjustment') then raise exception 'Invalid adjustment identity' using errcode='23514'; end if;
    ids:=array_append(ids,(line->>'sourceKind')||':'||(line->>'id'));
    if line->>'sourceKind'='line' then
      select c into config from jsonb_array_elements(revision.snapshot->'review'->'rows') c where c->>'id'=line->>'id' and c->>'role' in('shipping','other','discount');
    else
      select c into config from jsonb_array_elements(revision.snapshot->'review'->'adjustments') c where c->>'id'=line->>'id' and c->>'kind' in('shipping','other','discount');
      if config->>'calculation'='percentage' then
        select s into source from jsonb_array_elements(revision.snapshot->'source'->'adjustments') s where s->>'id'=line->>'id';
        if nullif(line->>'amount','')::numeric is distinct from abs((source->>'value')::numeric) then raise exception 'Quoted percentage rates cannot change' using errcode='23514'; end if;
      end if;
    end if;
    if config is null then raise exception 'Unquoted adjustment cannot be added' using errcode='23514'; end if;
    select p into prior from jsonb_array_elements(coalesce(previous->'adjustments','[]')) p where p->>'id'=line->>'id' and p->>'sourceKind'=line->>'sourceKind';
    if basis_changed or prior is null or (prior-array['confirmed','reason']) is distinct from (line-array['confirmed','reason']) then line:=line||'{"confirmed":false}'; end if;
    adjusted:=adjusted||jsonb_build_array(line);
  end loop;
  return jsonb_set(body,'{adjustments}',adjusted);
end $$;

-- Conversion defaults come from the immutable source, never award-side reviews.
create function private.purchasing_po_body(target uuid,quote uuid,body jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare revision private.quotation_revisions; line jsonb; source jsonb; config jsonb; value text; lines jsonb:='[]'; adjustments jsonb:='[]';
begin
  select * into revision from private.quotation_revisions where quote_id=quote;
  for line in select * from jsonb_array_elements(body->'lines') loop
    select s into source from jsonb_array_elements(revision.snapshot->'source'->'lines') s where s->>'id'=line->>'sourceLineId';
    select c into config from jsonb_array_elements(revision.snapshot->'review'->'rows') c where c->>'id'=line->>'sourceLineId';
    value:=case when config->>'discountType'='fixed' and (line->>'offeredQuantity')::numeric=(source->>'quantity')::numeric then regexp_replace(source->>'discountValue','^-','') else '' end;
    lines:=lines||jsonb_build_array(line||jsonb_build_object('fixedDiscount',value,'discountReason','','discountConfirmed',false));
  end loop;
  for config in select * from jsonb_array_elements(revision.snapshot->'review'->'rows') c where c->>'role' in('shipping','other','discount') loop
    select c->>'input' into value from jsonb_array_elements(revision.snapshot->'calculation'->'rows') c where c->>'id'=config->>'id';
    adjustments:=adjustments||jsonb_build_array(jsonb_build_object('id',config->>'id','sourceKind','line','include',true,'amount',regexp_replace(value,'^-',''),'reason','','confirmed',false));
  end loop;
  for config in select * from jsonb_array_elements(revision.snapshot->'review'->'adjustments') c where c->>'kind' in('shipping','other','discount') loop
    select s->>'value' into value from jsonb_array_elements(revision.snapshot->'source'->'adjustments') s where s->>'id'=config->>'id';
    adjustments:=adjustments||jsonb_build_array(jsonb_build_object('id',config->>'id','sourceKind','adjustment','include',true,'amount',regexp_replace(value,'^-',''),'reason','','confirmed',false));
  end loop;
  return private.purchasing_validate_body(target,quote,body||jsonb_build_object('lines',lines,'adjustments',adjustments),null);
end $$;

create function private.purchasing_command(actor jsonb,command jsonb,calculation jsonb default null,snapshot jsonb default null) returns jsonb
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
    if r.id is not null and (r.supplier_id<>q.supplier_id or (kind='saveAward' and r.kind<>'award') or (kind='savePo' and r.kind<>'po') or r.state='converted' or (r.state='cancelled' and kind<>'rebind')) then raise exception 'Invalid purchasing transition' using errcode='23514'; end if;
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
      insert into private.purchasing_records(id,request_id,project_id,supplier_id,quote_id,revision_id,kind,body)
        values(selected,target,parent.project_id,q.supplier_id,q.id,revision.id,'award',body);
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
      po:=gen_random_uuid();
      insert into private.document_counters(project_id,series,last_value) values(parent.project_id,'PO',1)
        on conflict on constraint document_counters_pkey do update set last_value=private.document_counters.last_value+1 returning last_value into number;
      update private.purchasing_records set state='converted',version=version+1,updated_at=created where id=selected;
      body:=private.purchasing_po_body(target,q.id,r.body);
      body:=jsonb_set(body,'{fields,date}',to_jsonb((now() at time zone 'Asia/Manila')::date::text));
      body:=jsonb_set(body,'{fields,shipTo}',to_jsonb(project.name));
      body:=jsonb_set(body,'{fields,shipAddress}',to_jsonb(project.location));
      body:=jsonb_set(body,'{fields,requisitioner}',to_jsonb(coalesce(parent.data->>'requestedBy','')));
      insert into private.purchasing_records(id,request_id,project_id,supplier_id,quote_id,revision_id,kind,ref,body,calculation)
        values(po,target,parent.project_id,r.supplier_id,r.quote_id,r.revision_id,'po',project.document_code||'-PO-'||lpad(number::text,greatest(4,length(number::text)),'0'),body,calculation);
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

create function public.purchasing_read(actor jsonb,target_request uuid default null) returns jsonb language sql security invoker set search_path='' as $$ select private.purchasing_read(actor,target_request); $$;
create function public.purchasing_command(actor jsonb,command jsonb,calculation jsonb default null,snapshot jsonb default null) returns jsonb language sql security invoker set search_path='' as $$ select private.purchasing_command(actor,command,calculation,snapshot); $$;
revoke all on function private.purchasing_blockers(uuid),private.purchasing_record_view(uuid),private.purchasing_read(jsonb,uuid),private.purchasing_apply_claims(jsonb,uuid,uuid,text,text),private.purchasing_validate_body(uuid,uuid,jsonb,jsonb),private.purchasing_po_body(uuid,uuid,jsonb),private.purchasing_command(jsonb,jsonb,jsonb,jsonb),public.purchasing_read(jsonb,uuid),public.purchasing_command(jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.purchasing_read(jsonb,uuid),private.purchasing_command(jsonb,jsonb,jsonb,jsonb),public.purchasing_read(jsonb,uuid),public.purchasing_command(jsonb,jsonb,jsonb,jsonb) to service_role;

create function private.purchasing_retained_identity() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception 'Purchasing history is retained' using errcode='23514'; end if;
  if row(old.id,old.request_id,old.project_id,old.supplier_id,old.kind,old.ref) is distinct from row(new.id,new.request_id,new.project_id,new.supplier_id,new.kind,new.ref) then raise exception 'Purchasing ownership and numbering are fixed' using errcode='23514'; end if;
  return new;
end $$;
create trigger retained_identity before update or delete on private.purchasing_records for each row execute function private.purchasing_retained_identity();

create function public.purchasing_po_request(actor jsonb,po_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
begin
  perform private.quotation_actor(actor);
  return (select request_id from private.purchasing_records where id=po_id and kind='po');
end $$;
create function private.comparison_dispatch() returns jsonb language plpgsql security definer set search_path='' as $$
declare ids uuid[];
begin
  with candidates as (select id from private.comparison_artifacts where state in('pending','running') and (lease_until is null or lease_until<now())
    and (dispatched_at is null or dispatched_at<now()-interval '2 minutes') order by id for update skip locked limit 10), admitted as (
      update private.comparison_artifacts set dispatched_at=clock_timestamp() where id in(select id from candidates) returning id)
  select array_agg(id) into ids from admitted;
  return to_jsonb(coalesce(ids,'{}'::uuid[]));
end $$;
create function private.comparison_worker(job_id uuid,action text,lease_id uuid default null,patch jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare a private.comparison_artifacts; r private.comparison_reports; acquired uuid; key text; oldcheckpoint jsonb;
begin
  perform set_config('lock_timeout','5s',true);
  update private.account_guard set revision=revision+1 where id;
  select * into a from private.comparison_artifacts where id=job_id;
  if not found then return null; end if;
  select * into r from private.comparison_reports where id=a.report_id;
  perform 1 from public.material_requests where id=r.request_id for update;
  select * into a from private.comparison_artifacts where id=job_id for update;
  if a.state='complete' then return null; end if;
  if not private.quotation_archive_allowed(a.actor) then
    update private.comparison_artifacts set state='paused',lease=null,lease_until=null,message='Procurement access changed. A current Procurement colleague can retry.' where id=job_id;
    perform private.quotation_notify(); return null;
  end if;
  if action='claim' then
    if a.state not in('pending','running') or a.lease_until>now() then return null; end if;
    acquired:=gen_random_uuid();
    update private.comparison_artifacts set state='running',lease=acquired,lease_until=now()+interval '5 minutes',message=null where id=job_id;
  else
    if a.state<>'running' or a.lease is distinct from lease_id or a.lease_until<=now() then return null; end if;
    acquired:=a.lease;
    if action='checkpoint' then
      if jsonb_typeof(patch) is distinct from 'object' or octet_length(patch::text)>2000 then raise exception 'Invalid artifact checkpoint' using errcode='23514'; end if;
      for key in select jsonb_object_keys(patch) loop
        if key not in('fileId','sha256','size','verified') then raise exception 'Unexpected artifact checkpoint' using errcode='23514'; end if;
        if key<>'verified' and a.checkpoint ? key and a.checkpoint->key is distinct from patch->key then raise exception 'Stable artifact identity/hash cannot change' using errcode='23514'; end if;
      end loop;
      update private.comparison_artifacts set checkpoint=checkpoint||patch,lease_until=now()+interval '5 minutes' where id=job_id;
    elsif action='fail' then
      update private.comparison_artifacts set state='failed',lease=null,lease_until=null,message='Artifact verification did not complete. Retry this frozen version; other completed artifacts are retained.' where id=job_id;
      perform private.quotation_notify(); return null;
    elsif action='complete' then
      if a.checkpoint->>'verified' is distinct from 'true' or coalesce(a.checkpoint->>'fileId','') !~ '^[A-Za-z0-9_-]+$' or coalesce(a.checkpoint->>'sha256','') !~ '^[a-f0-9]{64}$'
        or coalesce(a.checkpoint->>'size','') !~ '^[0-9]+$' or (a.checkpoint->>'size')::bigint not between 5 and 52428800 then raise exception 'Exact artifact verification required' using errcode='23514'; end if;
      insert into private.comparison_archives(artifact_id,folder_mapping_id,file_id,sha256,size)
        values(a.id,a.folder_mapping_id,a.checkpoint->>'fileId',a.checkpoint->>'sha256',(a.checkpoint->>'size')::bigint);
      update private.comparison_artifacts set state='complete',lease=null,lease_until=null,message=null where id=job_id;
      insert into private.audit_events(actor_user_id,actor_name,actor_role,action,entity_type,entity_id,request_id,details)
        select p.user_id,p.display_name,'Procurement','purchasing.artifactComplete','purchasing',r.request_id,a.id,
          jsonb_build_object('reportId',r.id,'format',a.format,'originalActor',a.original_actor,'retryingActor',a.actor) from public.profiles p where p.user_id=(a.actor->>'userId')::uuid;
      perform private.quotation_notify(); return null;
    else raise exception 'Unsupported artifact action' using errcode='23514'; end if;
  end if;
  return (select to_jsonb(x)||jsonb_build_object('report',to_jsonb(r)||jsonb_build_object('version',r.version::text),
    'folder',(select to_jsonb(f) from private.project_document_folders f where f.id=x.folder_mapping_id)) from private.comparison_artifacts x where x.id=job_id);
end $$;
create function public.comparison_dispatch() returns jsonb language sql security invoker set search_path='' as $$ select private.comparison_dispatch(); $$;
create function public.comparison_worker(job_id uuid,action text,lease_id uuid default null,patch jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$ select private.comparison_worker(job_id,action,lease_id,patch); $$;
create function public.comparison_document(actor jsonb,artifact_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a private.comparison_artifacts; r private.comparison_reports; archive private.comparison_archives;
begin
  perform private.quotation_actor(actor);
  select * into a from private.comparison_artifacts where id=artifact_id;
  select * into r from private.comparison_reports where id=a.report_id;
  select * into archive from private.comparison_archives where comparison_archives.artifact_id=a.id;
  if archive.artifact_id is null then raise exception 'Artifact is unavailable' using errcode='P4801'; end if;
  return jsonb_build_object('fileId',archive.file_id,'size',archive.size,'name','Comparison-v'||r.version||'.'||a.format,
    'mime',case when a.format='pdf' then 'application/pdf' else 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' end);
end $$;
revoke all on function public.purchasing_po_request(jsonb,uuid),private.comparison_dispatch(),private.comparison_worker(uuid,text,uuid,jsonb),public.comparison_dispatch(),public.comparison_worker(uuid,text,uuid,jsonb),public.comparison_document(jsonb,uuid),private.purchasing_retained_identity() from public,anon,authenticated,service_role;
grant execute on function public.purchasing_po_request(jsonb,uuid),private.comparison_dispatch(),private.comparison_worker(uuid,text,uuid,jsonb),public.comparison_dispatch(),public.comparison_worker(uuid,text,uuid,jsonb),public.comparison_document(jsonb,uuid) to service_role;

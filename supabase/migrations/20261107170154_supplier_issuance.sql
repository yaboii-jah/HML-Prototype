-- 4.10: immutable admission/issuance facts. No provider calls run in SQL.
create table private.po_send_preparations (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references private.purchasing_records(id),
  approval_id uuid not null references private.po_approvals(id),
  mrf_archive_id uuid not null references private.mrf_archive_snapshots(id),
  po_archive_id uuid not null references private.po_archives(job_id),
  files jsonb not null,
  actor jsonb not null,
  prepared_at timestamptz not null default clock_timestamp()
);
create index po_send_preparations_po on private.po_send_preparations(po_id);
create index po_send_preparations_approval on private.po_send_preparations(approval_id);
create index po_send_preparations_mrf on private.po_send_preparations(mrf_archive_id);
create index po_send_preparations_archive on private.po_send_preparations(po_archive_id);
create table private.po_send_cancellations (
  preparation_id uuid primary key references private.po_send_preparations(id),
  reason text not null check(length(btrim(reason)) between 5 and 2000),
  actor jsonb not null, recorded_at timestamptz not null default clock_timestamp()
);
create table private.po_issuances (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null unique references private.purchasing_records(id),
  preparation_id uuid not null unique references private.po_send_preparations(id),
  details jsonb not null, blockers jsonb not null,
  actor jsonb not null, recorded_at timestamptz not null default clock_timestamp()
);
create table private.po_issuance_corrections (
  id uuid primary key default gen_random_uuid(),
  issuance_id uuid not null references private.po_issuances(id),
  version bigint not null check(version>0),
  before_details jsonb not null, details jsonb not null,
  reason text not null check(length(btrim(reason)) between 5 and 2000),
  actor jsonb not null, recorded_at timestamptz not null default clock_timestamp(),
  unique(issuance_id,version)
);
create table private.issuance_operations (
  id uuid primary key, actor_id uuid not null references public.profiles(user_id),
  po_id uuid not null references private.purchasing_records(id),
  payload jsonb not null, result jsonb not null
);
create index issuance_operations_actor on private.issuance_operations(actor_id);
create index issuance_operations_po on private.issuance_operations(po_id);
do $$ declare t text; begin
  foreach t in array array['po_send_preparations','po_send_cancellations','po_issuances','po_issuance_corrections','issuance_operations'] loop
    execute format('alter table private.%I enable row level security',t);
    execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
    execute format('create trigger immutable before update or delete on private.%I for each row execute function private.document_immutable()',t);
  end loop;
end $$;

create function private.po_active_preparation(target uuid) returns uuid
language sql stable security definer set search_path='' as $$
  select p.id from private.po_send_preparations p where p.po_id=target
    and not exists(select 1 from private.po_send_cancellations c where c.preparation_id=p.id)
    and not exists(select 1 from private.po_issuances i where i.preparation_id=p.id)
  order by p.prepared_at desc,p.id desc limit 1;
$$;
-- This trigger also covers old checked endpoints and rolls back any earlier release.
create function private.po_issuance_lock() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if old.kind='po' and (private.po_active_preparation(old.id) is not null
    or exists(select 1 from private.po_issuances i where i.po_id=old.id))
    and (new.approval_id is distinct from old.approval_id or new.po_status is distinct from old.po_status
      or new.body is distinct from old.body or new.calculation is distinct from old.calculation
      or new.quote_id is distinct from old.quote_id or new.revision_id is distinct from old.revision_id
      or new.state is distinct from old.state) then
    raise exception 'PO is prepared for sending or permanently issued' using errcode='P4101';
  end if;
  return new;
end $$;
create trigger po_issuance_lock before update on private.purchasing_records
for each row execute function private.po_issuance_lock();

create function private.issuance_files(target uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r private.purchasing_records; m uuid; a private.mrf_archives; f private.po_archives;
begin
  select * into r from private.purchasing_records where id=target;
  m:=private.quotation_mrf_archive(r.request_id);
  select * into a from private.mrf_archives where snapshot_id=m;
  select x.* into f from private.po_archives x join private.po_archive_jobs j on j.id=x.job_id where j.approval_id=r.approval_id;
  if r.po_status<>'approved' or r.state<>'active' or a.snapshot_id is null or f.job_id is null then
    raise exception 'Complete current MRF and approved PO archives required' using errcode='P4102';
  end if;
  return jsonb_build_object('approvalId',r.approval_id,'mrfArchiveId',m,'poArchiveId',f.job_id,
    'files',jsonb_build_array(
      jsonb_build_object('id',a.form_file_id,'sha256',a.form_sha256,
        'size',(select size::text from private.mrf_archive_files where snapshot_id=m and kind='form'),
        'tags',jsonb_build_object('hmlSnapshotId',m,'hmlKind','approved-mrf')),
      jsonb_build_object('id',a.supporting_file_id,'sha256',a.supporting_sha256,
        'size',(select size::text from private.mrf_archive_files where snapshot_id=m and kind='supporting'),
        'tags',jsonb_build_object('hmlSnapshotId',m,'hmlKind','approved-support')),
      jsonb_build_object('id',f.file_id,'sha256',f.sha256,'size',f.size::text,
        'parent',(select folder_id from private.project_document_folders where id=f.folder_mapping_id),
        'tags',jsonb_build_object('hmlPoArchive',f.job_id,'hmlPoApproval',r.approval_id,'hmlKind','approved-po'))));
end $$;

create function private.po_issuance_view(target uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('status',case when i.id is not null then 'issued'
      when private.po_active_preparation(r.id) is not null then 'prepared' else 'notIssued' end,
    'preparation',case when p.id is null then null else jsonb_build_object('id',p.id,'approvalId',p.approval_id,
      'mrfArchiveId',p.mrf_archive_id,'poArchiveId',p.po_archive_id,'actor',p.actor,'at',p.prepared_at,
      'formId',(select id from private.mrf_archive_files where snapshot_id=p.mrf_archive_id and kind='form'),
      'supportingId',(select id from private.mrf_archive_files where snapshot_id=p.mrf_archive_id and kind='supporting')) end,
    'issuance',case when i.id is null then null else jsonb_build_object('id',i.id,'actor',i.actor,'at',i.recorded_at,
      'originalDetails',i.details,'details',coalesce((select c.details from private.po_issuance_corrections c where c.issuance_id=i.id order by c.version desc limit 1),i.details),
      'blockersAtRecording',i.blockers) end,
    'cancellations',coalesce((select jsonb_agg(jsonb_build_object('preparationId',c.preparation_id,'actor',c.actor,'at',c.recorded_at,'reason',c.reason,
      'preparedBy',x.actor,'preparedAt',x.prepared_at) order by c.recorded_at)
      from private.po_send_cancellations c join private.po_send_preparations x on x.id=c.preparation_id where x.po_id=r.id),'[]'),
    'corrections',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'version',c.version::text,'actor',c.actor,'at',c.recorded_at,
      'before',c.before_details,'details',c.details,'reason',c.reason) order by c.version) from private.po_issuance_corrections c where c.issuance_id=i.id),'[]'))
  from private.purchasing_records r
  left join private.po_issuances i on i.po_id=r.id
  left join private.po_send_preparations p on p.id=coalesce(i.preparation_id,private.po_active_preparation(r.id))
  where r.id=target and r.kind='po';
$$;
alter function private.purchasing_record_view(uuid) rename to purchasing_before_issuance_view;
create function private.purchasing_record_view(target uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select private.purchasing_before_issuance_view(target)||jsonb_build_object('issuance',private.po_issuance_view(target));
$$;

create function private.issuance_actor(actor jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare caller uuid;
begin
  caller:=private.quotation_actor(actor);
  if actor->>'activeRole'<>'Procurement' then raise exception 'Procurement required' using errcode='42501'; end if;
  perform 1 from auth.sessions where id=(actor->>'sessionId')::uuid and user_id=caller for share;
  if not found then raise exception 'Current session required' using errcode='42501'; end if;
  return caller;
end $$;
create function public.issuance_receipt(actor jsonb,command jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare caller uuid; receipt private.issuance_operations;
begin
  caller:=private.issuance_actor(actor);
  select * into receipt from private.issuance_operations where id=(command->>'requestId')::uuid;
  if not found then return null; end if;
  if receipt.actor_id<>caller or receipt.payload<>command then raise exception 'Retry identity reused' using errcode='P4803'; end if;
  return receipt.result;
end $$;
create function public.issuance_prepare_files(actor jsonb,target uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r private.purchasing_records;
begin
  perform private.issuance_actor(actor);
  select * into r from private.purchasing_records where id=target and kind='po';
  if r.id is null or r.po_status<>'approved' or private.po_active_preparation(target) is not null
    or exists(select 1 from private.po_issuances where po_id=target)
    or private.approved_po_blockers(target)<>'[]'::jsonb or not private.po_terms_ready(r.body)
    or r.body->'payment'->>'mode'='credit' and (r.body->'payment'->>'dueDate')::date<(clock_timestamp() at time zone 'Asia/Manila')::date then
    raise exception 'Review approval, source, current MRF and Credit terms' using errcode='P4102';
  end if;
  return private.issuance_files(target);
end $$;

create function private.issuance_details(value jsonb,preparation private.po_send_preparations) returns jsonb
language plpgsql stable set search_path='' as $$
declare sent timestamptz; payment jsonb;
begin
  if jsonb_typeof(value) is distinct from 'object' or jsonb_typeof(value->'channel') is distinct from 'string'
    or jsonb_typeof(value->'recipient') is distinct from 'string' or jsonb_typeof(value->'sentAt') is distinct from 'string'
    or coalesce(value->>'channel','') not in ('email','chat','physical','other')
    or coalesce(length(btrim(value->>'recipient')),0) not between 1 and 500
    or jsonb_typeof(value->'notes') is distinct from 'string' or length(value->>'notes')>2000
    or jsonb_typeof(value->'other') is distinct from 'string' or length(value->>'other')>2000
    or value->>'channel'='other' and coalesce(length(btrim(value->>'other')),0)<5
    or coalesce(value->>'sentAt','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,3})?Z$' then
    raise exception 'Complete channel, recipient, actual sending time and Other explanation' using errcode='23514';
  end if;
  sent:=(value->>'sentAt')::timestamptz;
  select snapshot->'po'->'body'->'payment' into payment from private.po_approvals where id=preparation.approval_id;
  if sent<preparation.prepared_at or sent>clock_timestamp()
    or payment->>'mode'='credit' and (sent at time zone 'Asia/Manila')::date>(payment->>'dueDate')::date then
    raise exception 'Sending outside preparation or valid Credit terms requires external escalation' using errcode='P4103';
  end if;
  return jsonb_build_object('channel',value->>'channel','recipient',btrim(value->>'recipient'),
    'sentAt',value->>'sentAt','notes',value->>'notes','other',value->>'other');
end $$;

create function public.issuance_command(actor jsonb,command jsonb,proof jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare caller uuid; r private.purchasing_records; p public.projects; parent public.material_requests;
  prepared private.po_send_preparations; issued private.po_issuances; result jsonb; files jsonb;
  action text:=command->>'type'; sending_value jsonb; before_value jsonb; action_reason text:=btrim(coalesce(command->>'reason',''));
begin
  perform set_config('lock_timeout','5s',true);
  update private.account_guard set revision=revision+1 where id;
  caller:=private.issuance_actor(actor);
  result:=public.issuance_receipt(actor,command);
  if result is not null then return result; end if;
  if action not in ('prepareSend','cancelSend','confirmSent','correctSent') or action is null then raise exception 'Unsupported issuance action' using errcode='23514'; end if;
  select * into r from private.purchasing_records where id=(command->>'targetId')::uuid and kind='po';
  if r.id is null or r.request_id::text is distinct from command->>'mrfId' then raise exception 'PO unavailable' using errcode='P4801'; end if;
  select * into p from public.projects where id=r.project_id for update;
  select * into parent from public.material_requests where id=r.request_id for update;
  select * into r from private.purchasing_records where id=r.id for update;
  if r.version::text is distinct from command->>'expectedPoVersion'
    or coalesce((select version::text from private.purchasing_heads where request_id=r.request_id),'0') is distinct from command->>'expectedVersion'
    or p.version::text is distinct from command->>'expectedProjectVersion'
    or private.demand_snapshot(r.request_id)->>'version' is distinct from command->>'expectedDemand'
    or (select f.version::text from private.quotation_families f join private.quotation_drafts q on q.family_id=f.id where q.id=r.quote_id) is distinct from command->>'expectedFamily'
    or coalesce(private.quotation_mrf_archive(r.request_id)::text,'') is distinct from command->>'expectedMrfArchive' then
    raise exception 'PO, source, MRF or project changed' using errcode='40001';
  end if;
  if r.po_status<>'approved' or r.state<>'active' then raise exception 'Current approval required' using errcode='P4102'; end if;
  select * into prepared from private.po_send_preparations where id=private.po_active_preparation(r.id);
  select * into issued from private.po_issuances where po_id=r.id;
  before_value:=private.po_issuance_view(r.id);
  if action='prepareSend' then
    if prepared.id is not null or issued.id is not null then raise exception 'Already prepared or issued' using errcode='P4101'; end if;
    files:=public.issuance_prepare_files(actor,r.id);
    if proof is distinct from files then raise exception 'Exact live archive verification required' using errcode='P4102'; end if;
    insert into private.po_send_preparations(po_id,approval_id,mrf_archive_id,po_archive_id,files,actor)
      values(r.id,r.approval_id,(files->>'mrfArchiveId')::uuid,(files->>'poArchiveId')::uuid,files,private.document_actor_snapshot(actor));
  elsif action in ('cancelSend','confirmSent') then
    if prepared.id is null or issued.id is not null or prepared.id::text is distinct from command->>'preparationId'
      or prepared.approval_id<>r.approval_id then raise exception 'Current preparation required' using errcode='P4101'; end if;
    if action='cancelSend' then
      if command->'notSent' is distinct from 'true'::jsonb or length(action_reason) not between 5 and 2000 then
        raise exception 'Explicit Not sent declaration and reason required' using errcode='23514'; end if;
      insert into private.po_send_cancellations(preparation_id,reason,actor) values(prepared.id,action_reason,private.document_actor_snapshot(actor));
    else
      sending_value:=private.issuance_details(command->'details',prepared);
      insert into private.po_issuances(po_id,preparation_id,details,blockers,actor)
        values(r.id,prepared.id,sending_value,private.approved_po_blockers(r.id),private.document_actor_snapshot(actor));
    end if;
  else
    if issued.id is null or issued.id::text is distinct from command->>'issuanceId' or length(action_reason) not between 5 and 2000 then
      raise exception 'Issued PO and correction reason required' using errcode='23514'; end if;
    select * into prepared from private.po_send_preparations where id=issued.preparation_id;
    sending_value:=private.issuance_details(command->'details',prepared);
    insert into private.po_issuance_corrections(issuance_id,version,before_details,details,reason,actor)
      values(issued.id,(select coalesce(max(c.version),0)+1 from private.po_issuance_corrections c where c.issuance_id=issued.id),
        coalesce((select x.details from private.po_issuance_corrections x where x.issuance_id=issued.id order by x.version desc limit 1),issued.details),
        sending_value,action_reason,private.document_actor_snapshot(actor));
  end if;
  update private.purchasing_records set version=version+1,updated_at=clock_timestamp() where id=r.id;
  insert into private.purchasing_heads(request_id,version) values(r.request_id,1)
    on conflict(request_id) do update set version=private.purchasing_heads.version+1;
  insert into private.audit_events(actor_user_id,actor_name,actor_role,action,entity_type,entity_id,request_id,details)
    select caller,display_name,'Procurement','purchasing.'||action,'purchasing',r.request_id,(command->>'requestId')::uuid,
      jsonb_build_object('targetId',r.id,'reason',action_reason,'before',before_value,'after',private.po_issuance_view(r.id))
      from public.profiles where user_id=caller;
  result:=jsonb_build_object('targetId',r.id,'changed',true);
  insert into private.issuance_operations values((command->>'requestId')::uuid,caller,r.id,command,result);
  perform private.quotation_notify();
  return result;
end $$;

revoke all on function private.po_active_preparation(uuid),private.po_issuance_lock(),private.issuance_files(uuid),
  private.po_issuance_view(uuid),private.purchasing_before_issuance_view(uuid),private.purchasing_record_view(uuid),
  private.issuance_actor(jsonb),private.issuance_details(jsonb,private.po_send_preparations),
  public.issuance_receipt(jsonb,jsonb),public.issuance_prepare_files(jsonb,uuid),public.issuance_command(jsonb,jsonb,jsonb)
from public,anon,authenticated,service_role;
grant execute on function public.issuance_receipt(jsonb,jsonb),public.issuance_prepare_files(jsonb,uuid),public.issuance_command(jsonb,jsonb,jsonb) to service_role;

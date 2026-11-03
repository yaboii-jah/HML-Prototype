-- Checked lifecycle commands share the existing foundation guard/publication boundary.
alter table public.material_requests
  add column status text not null default 'draft' check(status in('draft','submitted','returned','approved','rejected')),
  add column correction_kind text check(correction_kind in('full','documents')),
  add column correction_state text check(correction_state in('editing','submitted','returned')),
  add column submission_id uuid,
  add constraint correction_pair check((correction_kind is null)=(correction_state is null));

create table private.mrf_submissions (
  id uuid primary key, request_id uuid not null references public.material_requests(id),
  actor_id uuid not null references public.profiles(user_id), actor_name text not null,
  request_version bigint not null, attachment_revision bigint not null,
  source_document uuid not null references private.request_documents(id),
  snapshot jsonb not null, created_at timestamptz not null default clock_timestamp()
);
create index mrf_submissions_request on private.mrf_submissions(request_id);
create index mrf_submissions_actor on private.mrf_submissions(actor_id);
create index mrf_submissions_source on private.mrf_submissions(source_document);
alter table public.material_requests add foreign key(submission_id) references private.mrf_submissions(id);
create index material_requests_submission on public.material_requests(submission_id);
create table private.mrf_review_events (
  id uuid primary key default gen_random_uuid(), request_id uuid not null references public.material_requests(id),
  submission_id uuid references private.mrf_submissions(id),
  actor_id uuid not null references public.profiles(user_id), actor_name text not null, actor_role text not null,
  action text not null, reason text not null default '', created_at timestamptz not null default clock_timestamp()
);
create index mrf_review_events_request on private.mrf_review_events(request_id);
create index mrf_review_events_actor on private.mrf_review_events(actor_id);
create index mrf_review_events_submission on private.mrf_review_events(submission_id);
-- Future checked quotation/PO/transfer writers insert their permanent reference under
-- the MRF lock, in the SAME transaction as the dependent record. No public writer.
create table private.mrf_downstream_references (
  request_id uuid not null references public.material_requests(id),
  kind text not null check(kind in('quotation','purchase_order','transfer')),
  record_id uuid not null, primary key(request_id,kind,record_id)
);
do $$ declare t text; begin
  foreach t in array array['mrf_submissions','mrf_review_events','mrf_downstream_references'] loop
    execute format('alter table private.%I enable row level security',t);
    execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
    execute format('create trigger immutable before update or delete on private.%I for each row execute function private.document_immutable()',t);
  end loop;
end $$;

create function private.mrf_editable(target uuid) returns boolean language sql stable security definer set search_path='' as $$
  select coalesce((select status in('draft','returned') or status='approved' and correction_state in('editing','returned')
    from public.material_requests where id=target),false);
$$;
create function private.mrf_ready(target uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.material_requests r where r.id=target and r.status='approved' and r.correction_kind is null
    and exists(select 1 from private.mrf_archive_snapshots s join private.mrf_archives a on a.snapshot_id=s.id
      where s.request_id=r.id and s.version=(select max(v.version) from private.mrf_archive_snapshots v where v.request_id=r.id)));
$$;
create function private.mrf_register_downstream(target uuid,kind text,record_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.material_requests where id=target for update;
  if not private.mrf_ready(target) then raise exception 'Current approved archive required' using errcode='23514'; end if;
  insert into private.mrf_downstream_references values(target,kind,record_id) on conflict do nothing;
end $$;

alter function private.request_snapshot(uuid) rename to request_draft_snapshot;
create function private.request_snapshot(target uuid) returns jsonb language sql stable security definer set search_path='' as $$
  select private.request_draft_snapshot(target)||jsonb_build_object(
    'status',r.status,'correctionKind',r.correction_kind,'correctionState',r.correction_state,'submissionId',r.submission_id,
    'submitted',s.snapshot,'procurementReady',private.mrf_ready(target),
    'submitterIds',coalesce((select jsonb_agg(distinct x.actor_id) from private.mrf_submissions x where x.request_id=target),'[]'::jsonb),
    'history',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'action',e.action,'reason',e.reason,'actorId',e.actor_id,
      'actorName',e.actor_name,'actorRole',e.actor_role,'createdAt',e.created_at) order by e.created_at,e.id)
      from private.mrf_review_events e where e.request_id=target),'[]'::jsonb))
    from public.material_requests r left join private.mrf_submissions s on s.id=r.submission_id where r.id=target;
$$;

alter function private.request_command(jsonb,jsonb) rename to request_draft_command;
create function private.request_command(actor jsonb,command jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
<<review>>
declare caller uuid; target uuid:=(command->>'mrfId')::uuid; operation uuid:=(command->>'requestId')::uuid;
  kind text:=command->>'type'; r public.material_requests; p public.projects; receipt private.request_operations;
  form jsonb; saved jsonb; result jsonb; actor_name text; reason text:=btrim(coalesce(command->>'reason',''));
  state private.request_document_state; sub private.mrf_submissions; snap uuid; mapping uuid; revision bigint;
  item jsonb; key text; decision text:=command->>'decision'; before_value jsonb;
begin
  caller:=private.project_actor(actor,false);
  if kind in('createDraft','saveDraft') then
    if kind='saveDraft' then
      select * into r from public.material_requests where id=target;
      if actor->>'activeRole'<>'Site Personnel' or not coalesce(private.request_project_allowed(actor,r.project_id),false) then raise exception 'Current project access required' using errcode='42501'; end if;
      select * into receipt from private.request_operations o where o.id=operation;
      if found and receipt.actor_id=caller and receipt.payload=command and receipt.result is not null then return receipt.result; end if;
      if not private.mrf_editable(target) or r.correction_kind='documents' then raise exception 'MRF form is locked' using errcode='P4301'; end if;
    end if;
    return private.request_draft_command(actor,command);
  end if;
  if operation is null or target is null or kind is null or kind not in('submitMrf','reviewMrf','openCorrection') then raise exception 'Invalid MRF action' using errcode='23514'; end if;
  insert into private.request_operations(id,actor_id,request_id,payload) values(operation,caller,target,command) on conflict do nothing;
  select * into receipt from private.request_operations o where o.id=operation for update;
  if receipt.actor_id<>caller or receipt.payload<>command then raise exception 'Operation identity reused' using errcode='P3406'; end if;
  select * into p from public.projects where id=(select project_id from public.material_requests where id=target) for update;
  if not found or not private.request_project_allowed(actor,p.id) then raise exception 'Current project access required' using errcode='42501'; end if;
  if receipt.result is not null then return receipt.result; end if;
  select * into r from public.material_requests where id=target for update;
  if r.version::text is distinct from command->>'expectedVersion' then raise exception 'MRF changed' using errcode='40001'; end if;
  before_value:=private.request_snapshot(target);
  select display_name into actor_name from public.profiles where user_id=caller;
  if kind='submitMrf' then
    if actor->>'activeRole'<>'Site Personnel' then raise exception 'Assigned Site Personnel required' using errcode='42501'; end if;
    if not private.mrf_editable(target) then raise exception 'MRF is locked' using errcode='P4301'; end if;
    form:=private.request_draft(command->'draft');
    if r.correction_kind='documents' and form is distinct from before_value->'draft' then raise exception 'Only supporting PDF may change' using errcode='P4301'; end if;
    if form->>'requestDate'='' or jsonb_array_length(form->'items')=0 then raise exception 'Complete request date and materials' using errcode='P4302'; end if;
    foreach key in array array['requestedBy','approvedBy','purchaser','financeOfficer'] loop
      if form->>key='' then raise exception 'Complete printed signatory names' using errcode='P4302'; end if;
    end loop;
    for item in select * from jsonb_array_elements(form->'items') loop
      if item->>'quantity' is null or item->>'name'='' or item->>'unit'='' or item->>'neededDate'='' or item->>'location'='' then raise exception 'Complete each material requirement' using errcode='P4302'; end if;
    end loop;
    if r.correction_kind is distinct from 'documents' and not exists(select 1 from public.scopes s join public.scope_budgets b on b.scope_id=s.id
      where s.id=(form->>'scopeId')::uuid and s.project_id=p.id and b.amount>0) then raise exception 'Select a funded project scope' using errcode='P4303'; end if;
    select * into state from private.request_document_state where request_id=target for update;
    if state.current_document is null or state.revision::text is distinct from command->>'attachmentRevision' then raise exception 'Supporting PDF changed or missing' using errcode='40001'; end if;
    if exists(select 1 from private.document_uploads u where u.request_id=target and u.state not in('complete','cancelled')) then raise exception 'Finish or cancel unfinished uploads' using errcode='P4304'; end if;
    perform private.request_draft_command(actor,jsonb_build_object('type','saveDraft','requestId',gen_random_uuid(),'mrfId',target,'expectedVersion',r.version::text,'draft',form));
    sub.id:=gen_random_uuid();
    -- Submission captures exactly the form/labels reviewed. Document-only changes
    -- retain the earlier approved labels as well as all substantive form fields.
    saved:=jsonb_build_object('ref',r.ref,'projectName',p.name,'projectLocation',p.location,'draft',form);
    if r.correction_kind='documents' then
      select s.snapshot into saved from private.mrf_archive_snapshots s where s.request_id=target order by s.version desc limit 1;
    end if;
    insert into private.mrf_submissions(id,request_id,actor_id,actor_name,request_version,attachment_revision,source_document,snapshot)
      select sub.id,target,caller,actor_name,version+1,state.revision,state.current_document,saved from public.material_requests where id=target;
    update public.material_requests set status=case when correction_kind is null then 'submitted' else status end,
      correction_state=case when correction_kind is not null then 'submitted' end,submission_id=sub.id,updater_id=caller,updater_name=actor_name where id=target;
  elsif kind='reviewMrf' then
    if actor->>'activeRole'<>'Project Manager' then raise exception 'Project Manager required' using errcode='42501'; end if;
    if not (r.status='submitted' or r.status='approved' and r.correction_state='submitted')
      or r.submission_id::text is distinct from command->>'submissionId' then raise exception 'Submission changed' using errcode='40001'; end if;
    if decision is null or decision not in('approve','return','reject') or r.correction_kind is not null and decision='reject' then raise exception 'Invalid decision' using errcode='23514'; end if;
    if decision<>'approve' and (length(reason)<5 or length(reason)>4000) then raise exception 'Give a reason of at least five characters' using errcode='P4305'; end if;
    if decision='approve' then
      if exists(select 1 from private.mrf_submissions s where s.request_id=target and s.actor_id=caller) then raise exception 'Submitters cannot approve this MRF' using errcode='P4306'; end if;
      if r.correction_kind is distinct from 'documents' and not exists(select 1 from public.scopes s join public.scope_budgets b on b.scope_id=s.id
        where s.id=r.scope_id and s.project_id=p.id and b.amount>0) then raise exception 'Scope must remain funded' using errcode='P4303'; end if;
      select * into sub from private.mrf_submissions where id=r.submission_id;
      select * into state from private.request_document_state where request_id=target for update;
      if state.current_document is distinct from sub.source_document or state.revision<>sub.attachment_revision then raise exception 'Reviewed PDF changed' using errcode='40001'; end if;
      snap:=gen_random_uuid();
      select coalesce(max(s.version),0)+1 into revision from private.mrf_archive_snapshots s where s.request_id=target;
      insert into private.mrf_archive_snapshots(id,request_id,version,source_document,request_version,attachment_revision,snapshot,approved_by,approved_name,approved_at)
        values(snap,target,revision,sub.source_document,sub.request_version,sub.attachment_revision,sub.snapshot,caller,actor_name,clock_timestamp());
      select id into mapping from private.project_document_folders where project_id=p.id and current;
      insert into private.document_jobs(kind,project_id,request_id,resource_id,actor,original_actor,payload)
        values('archive',p.id,target,snap,private.document_actor_snapshot(actor),private.document_actor_snapshot(actor),jsonb_build_object('folderMappingId',mapping));
      update public.material_requests set status='approved',correction_kind=null,correction_state=null,updater_id=caller,updater_name=actor_name where id=target;
    elsif r.correction_kind is not null then
      update public.material_requests set correction_state='returned',updater_id=caller,updater_name=actor_name where id=target;
    else
      update public.material_requests set status=case when decision='return' then 'returned' else 'rejected' end,updater_id=caller,updater_name=actor_name where id=target;
    end if;
  else
    if actor->>'activeRole'<>'Procurement' then raise exception 'Procurement required' using errcode='42501'; end if;
    if not private.mrf_ready(target) then raise exception 'Current approved archive required' using errcode='P4307'; end if;
    if length(reason)<5 or length(reason)>4000 then raise exception 'Give a correction reason' using errcode='P4305'; end if;
    update public.material_requests set correction_kind=case when exists(select 1 from private.mrf_downstream_references x where x.request_id=target) then 'documents' else 'full' end,
      correction_state='editing',updater_id=caller,updater_name=actor_name where id=target;
  end if;
  insert into private.mrf_review_events(request_id,submission_id,actor_id,actor_name,actor_role,action,reason)
    select target,submission_id,caller,actor_name,actor->>'activeRole',case when kind='reviewMrf' then decision when kind='submitMrf' then 'submitted' else 'correction_opened' end,reason
    from public.material_requests where id=target;
  saved:=private.request_snapshot(target);
  insert into private.audit_events(actor_user_id,actor_name,actor_role,action,entity_type,entity_id,request_id,details)
    values(caller,actor_name,actor->>'activeRole','mrf.'||kind,'mrf',target,operation,jsonb_build_object('before',before_value,'after',saved));
  result:=jsonb_build_object('record',saved,'projectId',p.id,'changed',true);
  update private.request_operations set result=review.result where id=operation;
  return result;
end $$;

-- Central state gates also cover already admitted upload/validation work.
create function private.mrf_attachment_guard() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_table_name='request_document_state' then
    if tg_op='UPDATE' and new.current_document is not distinct from old.current_document then return new; end if;
    if new.current_document is null and tg_op='INSERT' then return new; end if;
  elsif new.state not in('uploading','validating','complete') then return new;
  end if;
  if not private.mrf_editable(new.request_id) then raise exception 'Submitted/approved attachments are locked' using errcode='P4301'; end if;
  return new;
end $$;
create trigger mrf_attachment_guard before insert or update on private.request_document_state for each row execute function private.mrf_attachment_guard();
create trigger mrf_upload_guard before insert or update on private.document_uploads for each row execute function private.mrf_attachment_guard();

revoke all on function private.mrf_editable(uuid),private.mrf_ready(uuid),private.mrf_register_downstream(uuid,text,uuid),private.request_snapshot(uuid),private.request_command(jsonb,jsonb),private.mrf_attachment_guard() from public,anon,authenticated,service_role;

create function private.mrf_validation_guard() returns trigger language plpgsql set search_path='' as $$
begin
  if new.kind='validate' and new.state in('pending','running') and not private.mrf_editable(new.request_id) then
    raise exception 'MRF attachment is locked' using errcode='P4301';
  end if;
  return new;
end $$;
create trigger mrf_validation_guard before insert or update on private.document_jobs for each row execute function private.mrf_validation_guard();

-- Opaque file IDs share the existing authorized streaming/Range endpoint.
create table private.mrf_archive_files (
  id uuid primary key default gen_random_uuid(), snapshot_id uuid not null references private.mrf_archive_snapshots(id),
  kind text not null check(kind in('form','supporting')), size bigint not null check(size>0), unique(snapshot_id,kind)
);
alter table private.mrf_archive_files enable row level security;
revoke all on private.mrf_archive_files from public,anon,authenticated,service_role;
create trigger immutable before update or delete on private.mrf_archive_files for each row execute function private.document_immutable();
create function private.mrf_archive_files_ack() returns trigger language plpgsql set search_path='' as $$
declare checkpoint jsonb;
begin
  select j.checkpoint into checkpoint from private.document_jobs j where j.kind='archive' and j.resource_id=new.snapshot_id;
  insert into private.mrf_archive_files(snapshot_id,kind,size) values
    (new.snapshot_id,'form',(checkpoint->>'formSize')::bigint),(new.snapshot_id,'supporting',(checkpoint->>'supportingSize')::bigint);
  return new;
end $$;
create trigger mrf_archive_files_ack after insert on private.mrf_archives for each row execute function private.mrf_archive_files_ack();

alter function private.documents_read(jsonb,uuid,uuid) rename to documents_before_review;
create function private.documents_read(actor jsonb,target_request uuid default null,target_project uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  result:=private.documents_before_review(actor,target_request,target_project);
  return result||jsonb_build_object('editable',actor->>'activeRole'='Site Personnel' and private.mrf_editable(target_request),
    'archives',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'version',s.version::text,'approvedBy',s.approved_name,'approvedAt',s.approved_at,
      'complete',a.snapshot_id is not null,'files',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'kind',f.kind) order by f.kind) from private.mrf_archive_files f where f.snapshot_id=s.id),'[]'::jsonb)) order by s.version desc)
      from private.mrf_archive_snapshots s left join private.mrf_archives a on a.snapshot_id=s.id where s.request_id=target_request),'[]'::jsonb));
end $$;
alter function public.document_file(jsonb,uuid) rename to document_source_file;
create function public.document_file(actor jsonb,document_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare f private.mrf_archive_files; s private.mrf_archive_snapshots; a private.mrf_archives; project_id uuid;
begin
  perform private.project_actor(actor,false);
  select * into f from private.mrf_archive_files where id=document_id;
  if not found then return public.document_source_file(actor,document_id); end if;
  select * into s from private.mrf_archive_snapshots where id=f.snapshot_id;
  select r.project_id into project_id from public.material_requests r where r.id=s.request_id;
  if not coalesce(private.request_project_allowed(actor,project_id),false) then raise exception 'Document unavailable' using errcode='42501'; end if;
  select * into a from private.mrf_archives where snapshot_id=s.id;
  if not found then raise exception 'Archive incomplete' using errcode='23514'; end if;
  return jsonb_build_object('fileId',case when f.kind='form' then a.form_file_id else a.supporting_file_id end,
    'name',(s.snapshot->>'ref')||'-v'||s.version||'-'||f.kind||'.pdf','size',f.size,
    'sha256',case when f.kind='form' then a.form_sha256 else a.supporting_sha256 end);
end $$;
revoke all on function public.document_source_file(jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function public.document_file(jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.document_file(jsonb,uuid) to service_role;
revoke all on function private.documents_read(jsonb,uuid,uuid),private.mrf_validation_guard(),private.mrf_archive_files_ack() from public,anon,authenticated,service_role;

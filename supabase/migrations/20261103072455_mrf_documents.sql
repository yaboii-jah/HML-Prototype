-- Private document lifecycle. No client may write metadata or acknowledge Drive.
create table private.project_document_folders (
  id uuid primary key default gen_random_uuid(),
  -- Empty folder setup does not prevent deletion of an otherwise unused project.
  -- Operational MRF references still restrict deletion; mapping history is retained.
  project_id uuid not null,
  folder_id text not null,
  root_id text not null,
  name text not null,
  current boolean not null default true,
  created_at timestamptz not null default clock_timestamp()
);
create unique index project_document_folder_current on private.project_document_folders(project_id) where current;
create index project_document_folder_project on private.project_document_folders(project_id);
-- Ownership survives remapping; another project can never adopt this destination.
create table private.document_folder_owners (folder_id text primary key, project_id uuid not null);
create table private.request_document_state (
  request_id uuid primary key references public.material_requests(id) on delete restrict,
  revision bigint not null default 1,
  current_document uuid
);
create table private.request_documents (
  id uuid primary key,
  request_id uuid not null references public.material_requests(id) on delete restrict,
  folder_mapping_id uuid not null references private.project_document_folders(id),
  drive_file_id text not null unique,
  name text not null,
  size bigint not null check(size between 5 and 52428800),
  sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
  uploader_id uuid not null references public.profiles(user_id),
  uploader_name text not null,
  created_at timestamptz not null default clock_timestamp(),
  trashed_at timestamptz
);
alter table private.request_document_state add foreign key(current_document) references private.request_documents(id);
create index request_documents_request on private.request_documents(request_id);
create table private.document_uploads (
  id uuid primary key,
  request_id uuid not null references public.material_requests(id) on delete restrict,
  folder_mapping_id uuid not null references private.project_document_folders(id),
  base_revision bigint not null,
  name text not null,
  size bigint not null check(size between 5 and 52428800),
  sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
  actor jsonb not null,
  original_actor jsonb not null,
  uploader_id uuid not null references public.profiles(user_id),
  uploader_name text not null,
  state text not null default 'uploading' check(state in('uploading','validating','complete','failed','cancelled','expired','conflict')),
  drive_file_id text,
  encrypted_session text,
  offset_bytes bigint not null default 0,
  lease uuid,
  lease_until timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default clock_timestamp()+interval '7 days',
  check(offset_bytes between 0 and size)
);
create index document_uploads_request on private.document_uploads(request_id);
create table private.document_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check(kind in('folder','validate','cleanup','archive')),
  -- Jobs/receipts retain intent even if unused setup is subsequently deleted.
  project_id uuid not null,
  request_id uuid references public.material_requests(id) on delete restrict,
  resource_id uuid,
  actor jsonb not null,
  original_actor jsonb not null,
  state text not null default 'pending' check(state in('pending','running','failed','paused','complete')),
  payload jsonb not null default '{}',
  checkpoint jsonb not null default '{}',
  lease uuid,
  lease_until timestamptz,
  attempts integer not null default 0,
  message text,
  workflow_run_id text,
  dispatch_after timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create unique index document_job_resource on private.document_jobs(kind,resource_id) where resource_id is not null;
create index document_jobs_project on private.document_jobs(project_id);
create index document_jobs_dispatch on private.document_jobs(dispatch_after) where state in('pending','running');
create table private.document_operations (
  id uuid primary key, actor_id uuid not null, payload jsonb not null, result jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
-- Future approval code is the only writer of immutable snapshots. No public enqueue API.
create table private.mrf_archive_snapshots (
  id uuid primary key, request_id uuid not null references public.material_requests(id),
  version bigint not null check(version>0),
  source_document uuid not null references private.request_documents(id),
  request_version bigint not null check(request_version>0),
  attachment_revision bigint not null check(attachment_revision>0),
  snapshot jsonb not null, approved_by uuid not null references public.profiles(user_id),
  approved_name text not null check(length(btrim(approved_name)) between 1 and 100),
  approved_at timestamptz not null, created_at timestamptz not null default clock_timestamp(),
  unique(request_id,version)
);
create table private.mrf_archives (
  snapshot_id uuid primary key references private.mrf_archive_snapshots(id),
  folder_mapping_id uuid not null references private.project_document_folders(id),
  form_file_id text not null, form_sha256 text not null,
  supporting_file_id text not null, supporting_sha256 text not null,
  completed_at timestamptz not null default clock_timestamp()
);
create index request_documents_mapping on private.request_documents(folder_mapping_id);
create index request_documents_uploader on private.request_documents(uploader_id);
create index document_state_current on private.request_document_state(current_document);
create index document_uploads_mapping on private.document_uploads(folder_mapping_id);
create index document_uploads_uploader on private.document_uploads(uploader_id);
create index document_jobs_request on private.document_jobs(request_id);
create index archive_source on private.mrf_archive_snapshots(source_document);
create index archive_approver on private.mrf_archive_snapshots(approved_by);
create index archives_mapping on private.mrf_archives(folder_mapping_id);
do $$ declare t text; begin
  foreach t in array array['project_document_folders','document_folder_owners','request_document_state','request_documents','document_uploads','document_jobs','document_operations','mrf_archive_snapshots','mrf_archives'] loop
    execute format('alter table private.%I enable row level security',t);
    execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
  end loop;
end $$;
create function private.document_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Approved document history is immutable' using errcode='23514'; end $$;
create trigger archive_snapshot_immutable before update or delete on private.mrf_archive_snapshots for each row execute function private.document_immutable();
create trigger archive_immutable before update or delete on private.mrf_archives for each row execute function private.document_immutable();
create function private.document_version_guard() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' or (to_jsonb(new)-'trashed_at') is distinct from (to_jsonb(old)-'trashed_at')
    or old.trashed_at is not null and new.trashed_at is distinct from old.trashed_at then
    raise exception 'Document version metadata is immutable' using errcode='23514';
  end if;
  return new;
end $$;
create trigger document_version_guard before update or delete on private.request_documents for each row execute function private.document_version_guard();

create function private.document_notify(target uuid) returns void language plpgsql security definer set search_path='' as $$
declare recipient record;
begin
  -- Publication is last, after all record locks; order native logout against send.
  perform s.id from auth.sessions s join private.session_bindings b on b.session_id=s.id order by s.id for share of s;
  for recipient in select b.* from private.session_bindings b
    join auth.sessions s on s.id=b.session_id and s.user_id=b.user_id
    join public.profiles p on p.user_id=b.user_id join auth.users u on u.id=p.user_id
    where p.is_active and p.access_revision=b.access_revision and (s.not_after is null or s.not_after>now())
      and not u.is_anonymous and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now())
      and (exists(select 1 from public.role_grants g where g.user_id=p.user_id and g.role<>'Site Personnel')
        or exists(select 1 from public.project_assignments a where a.user_id=p.user_id and a.project_id=target))
  loop
    perform realtime.send('{}','foundation_changed',private.foundation_topic(recipient.user_id,recipient.access_revision,recipient.session_id),true);
  end loop;
end $$;
create function private.document_audit(actor jsonb,action text,target uuid,operation uuid,details jsonb default '{}') returns void
language sql security definer set search_path='' as $$
  insert into private.audit_events(actor_user_id,actor_name,actor_role,action,entity_type,entity_id,request_id,details)
  select p.user_id,p.display_name,actor->>'activeRole',action,'document',target,operation,details
  from public.profiles p where p.user_id=(actor->>'userId')::uuid;
$$;
create function private.document_job_allowed(actor jsonb,target uuid,kind text) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles p join auth.users u on u.id=p.user_id
    join public.role_grants g on g.user_id=p.user_id and g.role=actor->>'activeRole'
    where p.user_id=(actor->>'userId')::uuid and p.is_active and p.access_revision::text=actor->>'revision'
      and not u.is_anonymous and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now())
      and exists(select 1 from public.projects where id=target)
      and ((kind='folder' and g.role in('Administrator','Project Manager'))
        or (kind in('validate','cleanup') and g.role='Site Personnel' and exists(select 1 from public.project_assignments a where a.user_id=p.user_id and a.project_id=target))
        or (kind='archive' and g.role='Project Manager')));
$$;
create function private.documents_read(actor jsonb,target_request uuid default null,target_project uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare project_id uuid; result jsonb; rev text;
begin
  perform private.project_actor(actor,false);
  project_id:=target_project;
  if target_request is not null then select r.project_id into project_id from public.material_requests r where r.id=target_request; end if;
  if project_id is null or not private.request_project_allowed(actor,project_id) then raise exception 'Project access required' using errcode='42501'; end if;
  select coalesce(s.revision,1)::text into rev from (select 1) x left join private.request_document_state s on s.request_id=target_request;
  result:=jsonb_build_object('projectId',project_id,'revision',rev,'current',(
    select jsonb_build_object('id',d.id,'name',d.name,'size',d.size,'sha256',d.sha256,'uploaderName',d.uploader_name,'createdAt',d.created_at)
    from private.request_document_state s join private.request_documents d on d.id=s.current_document where s.request_id=target_request),
    'uploads',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'name',u.name,'size',u.size,'sha256',u.sha256,'offset',u.offset_bytes,'state',
      case when u.state='uploading' and u.expires_at<clock_timestamp() then 'expired' else u.state end,'expiresAt',u.expires_at,'uploaderName',u.uploader_name) order by u.created_at desc)
      from private.document_uploads u where u.request_id=target_request and u.state not in('complete','cancelled')),'[]'::jsonb),
    'folder',(select jsonb_build_object('id',f.id,'name',f.name) from private.project_document_folders f where f.project_id=documents_read.project_id and f.current),
    'jobs',coalesce((select jsonb_agg(jsonb_build_object('id',j.id,'kind',j.kind,'state',j.state,'message',j.message,'attempts',j.attempts) order by j.created_at desc)
      from private.document_jobs j where j.project_id=documents_read.project_id and (j.kind='folder' or j.request_id=target_request) and j.state<>'complete'),'[]'::jsonb));
  return result;
end $$;

create function private.document_command(actor jsonb,command jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
<<cmd>>
declare caller uuid; target uuid:=(command->>'mrfId')::uuid; project_id uuid:=(command->>'projectId')::uuid;
  operation uuid:=(command->>'operationId')::uuid; kind text:=command->>'type'; receipt private.document_operations;
  state private.request_document_state; mapping private.project_document_folders; upload private.document_uploads; job private.document_jobs;
  result jsonb; resource uuid; folder text;
begin
  perform set_config('lock_timeout','5s',true);
  update private.account_guard set revision=revision+1 where id;
  caller:=private.project_actor(actor,false);
  if target is not null then select r.project_id into project_id from public.material_requests r where r.id=target; end if;
  if project_id is null or not private.request_project_allowed(actor,project_id) then raise exception 'Project access required' using errcode='42501'; end if;
  perform 1 from public.projects p where p.id=project_id for update;
  if kind in('setupFolder','retryFolder') then
    if actor->>'activeRole' not in('Administrator','Project Manager') then raise exception 'Folder management role required' using errcode='42501'; end if;
  elsif kind in('startUpload','resumeUpload','cancelUpload','remove','retryFile') then
    if target is null or actor->>'activeRole'<>'Site Personnel' then raise exception 'Assigned Site Personnel required' using errcode='42501'; end if;
  else raise exception 'Unknown document command' using errcode='23514'; end if;
  if operation is null then raise exception 'Operation identity required' using errcode='23514'; end if;
  select * into receipt from private.document_operations o where o.id=operation;
  if found then
    if receipt.actor_id<>caller or receipt.payload<>command then raise exception 'Operation identity reused' using errcode='P3406'; end if;
    return receipt.result;
  end if;
  if target is not null then
    perform 1 from public.material_requests r where r.id=target for update;
    insert into private.request_document_state(request_id) values(target) on conflict do nothing;
    select * into state from private.request_document_state s where s.request_id=target for update;
  end if;
  if kind in('startUpload','remove') and (command->>'expectedRevision' is null or command->>'expectedRevision'<>state.revision::text) then
    raise exception 'Attachment changed; review current file' using errcode='40001'; end if;
  if kind='startUpload' then
    if command->>'name' is null or length(command->>'name') not between 5 and 240 or lower(command->>'name') not like '%.pdf'
      or (command->>'size')::bigint not between 5 and 52428800 or command->>'sha256' !~ '^[a-f0-9]{64}$'
      or command->>'sha256' is null or command->>'size' is null then raise exception 'Invalid PDF metadata' using errcode='23514'; end if;
    select * into mapping from private.project_document_folders f where f.project_id=cmd.project_id and f.current;
    if not found then raise exception 'Set up the project document folder first' using errcode='P4201'; end if;
    resource:=gen_random_uuid();
    insert into private.document_uploads(id,request_id,folder_mapping_id,base_revision,name,size,sha256,actor,original_actor,uploader_id,uploader_name)
      select resource,target,mapping.id,state.revision,command->>'name',(command->>'size')::bigint,command->>'sha256',actor,actor,caller,p.display_name from public.profiles p where p.user_id=caller;
    result:=jsonb_build_object('uploadId',resource);
  elsif kind='remove' then
    if state.current_document is not null then
      insert into private.document_jobs(kind,project_id,request_id,resource_id,actor,original_actor) values('cleanup',project_id,target,state.current_document,actor,actor) on conflict do nothing;
      update private.request_document_state set current_document=null,revision=revision+1 where request_id=target;
    end if;
    result:=jsonb_build_object('removed',true);
  elsif kind in('resumeUpload','cancelUpload') then
    select * into upload from private.document_uploads u where u.id=(command->>'uploadId')::uuid and u.request_id=target for update;
    if not found then raise exception 'Upload unavailable' using errcode='42501'; end if;
    if kind='cancelUpload' then
      if upload.state='complete' then raise exception 'Remove the saved attachment instead' using errcode='23514'; end if;
      update private.document_uploads set state='cancelled' where id=upload.id;
      insert into private.document_jobs(kind,project_id,request_id,resource_id,actor,original_actor,payload)
        values('cleanup',project_id,target,upload.id,actor,upload.original_actor,jsonb_build_object('upload',true)) on conflict do nothing;
    else
      if upload.sha256 is distinct from command->>'sha256' or upload.size::text is distinct from command->>'size' then raise exception 'Reselect the same PDF' using errcode='23514'; end if;
      if upload.expires_at<clock_timestamp() then raise exception 'Upload expired; select a new upload' using errcode='P4202'; end if;
      if upload.base_revision<>state.revision then raise exception 'Attachment changed' using errcode='40001'; end if;
      if upload.state<>'uploading' then raise exception 'Upload cannot resume' using errcode='23514'; end if;
      if upload.lease_until>clock_timestamp() then raise exception 'Upload is busy; retry shortly' using errcode='55P03'; end if;
      update private.document_uploads set actor=document_command.actor where id=upload.id;
    end if;
    result:=jsonb_build_object('uploadId',upload.id);
  elsif kind='setupFolder' then
    if exists(select 1 from private.document_jobs j where j.project_id=cmd.project_id and j.kind='folder' and j.state in('pending','running')) then
      raise exception 'Folder setup is already pending' using errcode='55P03'; end if;
    resource:=gen_random_uuid();
    insert into private.document_jobs(id,kind,project_id,actor,original_actor,payload)
      values(resource,'folder',project_id,actor,actor,jsonb_build_object('linkedFolder',command->>'folderId','expectedMapping',command->>'expectedMapping'));
    result:=jsonb_build_object('jobId',resource);
  else
    select * into job from private.document_jobs j where j.id=(command->>'jobId')::uuid and j.project_id=cmd.project_id for update;
    if not found or (kind='retryFolder' and job.kind<>'folder') or (kind='retryFile' and (job.kind not in('validate','cleanup') or job.request_id<>target)) then raise exception 'Job unavailable' using errcode='42501'; end if;
    if job.state not in('failed','paused') then raise exception 'Job is not retryable' using errcode='23514'; end if;
    if command->>'useCurrentMapping'='true' then
      if job.kind<>'validate' then raise exception 'Destination retry unavailable' using errcode='23514'; end if;
      -- Validation uses the upload's frozen location; replacing the upload is the explicit relocation path.
      raise exception 'Start a new upload to use the current destination' using errcode='23514';
    end if;
    update private.document_jobs set state='pending',actor=document_command.actor,lease=null,lease_until=null,message=null,dispatch_after=clock_timestamp(),updated_at=clock_timestamp() where id=job.id;
    result:=jsonb_build_object('jobId',job.id);
  end if;
  perform private.document_audit(actor,'document.'||kind,coalesce(target,project_id),operation,jsonb_build_object('projectId',project_id,'result',result));
  insert into private.document_operations values(operation,caller,command,result,clock_timestamp());
  perform private.document_notify(project_id);
  return result;
end $$;

-- The original project command keeps all existing numbering, allocation and retry rules.
alter function private.project_command(jsonb,jsonb) rename to project_command_before_documents;
create function private.project_command(actor jsonb,command jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; prior boolean;
begin
  prior:=exists(select 1 from private.project_operations where id=(command->>'requestId')::uuid);
  result:=private.project_command_before_documents(actor,command);
  if not prior and command->>'type'='createProject' then
    insert into private.document_jobs(kind,project_id,actor,original_actor) values('folder',(result->>'projectId')::uuid,actor,actor);
  end if;
  return result;
end $$;

create function private.document_transfer(actor jsonb,upload_id uuid,action text,lease_id uuid default null,patch jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare upload private.document_uploads; project_id uuid; acquired uuid;
begin
  perform set_config('lock_timeout','5s',true);
  update private.account_guard set revision=revision+1 where id;
  perform private.project_actor(actor,false);
  select r.project_id into project_id from private.document_uploads u join public.material_requests r on r.id=u.request_id where u.id=upload_id;
  if actor->>'activeRole'<>'Site Personnel' or not coalesce(private.request_project_allowed(actor,project_id),false) then raise exception 'Assigned Site Personnel required' using errcode='42501'; end if;
  perform 1 from public.projects where id=project_id for update;
  select * into upload from private.document_uploads where id=upload_id for update;
  if not found or upload.actor->>'userId' is distinct from actor->>'userId' or upload.actor->>'sessionId' is distinct from actor->>'sessionId'
    or upload.actor->>'revision' is distinct from actor->>'revision' then raise exception 'Resume this upload first' using errcode='42501'; end if;
  if upload.state='complete' then return jsonb_build_object('complete',true); end if;
  if upload.expires_at<clock_timestamp() then raise exception 'Upload expired' using errcode='P4202'; end if;
  if upload.state<>'uploading' then raise exception 'Upload is no longer writable' using errcode='23514'; end if;
  if (select revision from private.request_document_state where request_id=upload.request_id)<>upload.base_revision then raise exception 'Attachment changed' using errcode='40001'; end if;
  if action='claim' then
    if upload.lease_until>clock_timestamp() then raise exception 'Upload in progress' using errcode='55P03'; end if;
    acquired:=gen_random_uuid();
    update private.document_uploads set lease=acquired,lease_until=clock_timestamp()+interval '2 minutes' where id=upload_id;
  else
    if upload.lease is distinct from lease_id or upload.lease_until<clock_timestamp() then raise exception 'Transfer lease lost' using errcode='40001'; end if;
    acquired:=lease_id;
    if action='checkpoint' then
      if patch ? 'driveFileId' then
        if upload.drive_file_id is not null and upload.drive_file_id<>patch->>'driveFileId' then raise exception 'File identity is immutable' using errcode='23514'; end if;
        update private.document_uploads set drive_file_id=patch->>'driveFileId' where id=upload_id;
      end if;
      if patch ? 'session' then update private.document_uploads set encrypted_session=patch->>'session' where id=upload_id; end if;
      if patch ? 'offset' then
        if (patch->>'offset')::bigint<upload.offset_bytes then raise exception 'Upload offset cannot decrease' using errcode='23514'; end if;
        update private.document_uploads set offset_bytes=(patch->>'offset')::bigint where id=upload_id;
      end if;
    elsif action='finish' then
      if upload.drive_file_id is null then raise exception 'Provider file missing' using errcode='23514'; end if;
      update private.document_uploads set state='validating',offset_bytes=size,encrypted_session=null,lease=null,lease_until=null where id=upload_id;
      insert into private.document_jobs(kind,project_id,request_id,resource_id,actor,original_actor)
        values('validate',project_id,upload.request_id,upload.id,actor,upload.original_actor) on conflict do nothing;
      perform private.document_notify(project_id);
      return jsonb_build_object('validating',true);
    elsif action='release' then
      update private.document_uploads set lease=null,lease_until=null where id=upload_id;
    else raise exception 'Invalid transfer action' using errcode='23514'; end if;
  end if;
  select * into upload from private.document_uploads where id=upload_id;
  return to_jsonb(upload)||jsonb_build_object('lease',acquired,'folder',(select to_jsonb(f) from private.project_document_folders f where f.id=upload.folder_mapping_id));
end $$;

create function private.document_worker(job_id uuid,action text,lease_id uuid default null,patch jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
<<work>>
declare job private.document_jobs; upload private.document_uploads; state private.request_document_state;
  mapping uuid; folder text; old_document uuid; source private.request_documents; snap private.mrf_archive_snapshots;
begin
  perform set_config('lock_timeout','5s',true);
  update private.account_guard set revision=revision+1 where id;
  select * into job from private.document_jobs where id=job_id;
  if not found then return null; end if;
  -- Lock Auth/profile before project/job records. Logout is deliberately not required.
  perform 1 from auth.users where id=(job.actor->>'userId')::uuid for share;
  perform 1 from public.profiles where user_id=(job.actor->>'userId')::uuid for share;
  perform 1 from public.projects where id=job.project_id for update;
  select * into job from private.document_jobs where id=job_id for update;
  if job.state='complete' then return null; end if;
  if not private.document_job_allowed(job.actor,job.project_id,job.kind) then
    update private.document_jobs set state='paused',message='Required authority changed. An authorized person must retry.',lease=null,lease_until=null,updated_at=clock_timestamp() where id=job_id;
    perform private.document_notify(job.project_id);
    return null;
  end if;
  if action='claim' then
    if job.state not in('pending','running') or job.lease_until>clock_timestamp() then return null; end if;
    update private.document_jobs set state='running',lease=gen_random_uuid(),lease_until=clock_timestamp()+interval '5 minutes',attempts=attempts+1,updated_at=clock_timestamp() where id=job_id returning * into job;
  else
    if job.state<>'running' or job.lease is distinct from lease_id or job.lease_until<clock_timestamp() then return null; end if;
    if action='checkpoint' then
      update private.document_jobs set checkpoint=checkpoint||patch,lease_until=clock_timestamp()+interval '5 minutes',updated_at=clock_timestamp() where id=job_id returning * into job;
    elsif action='fail' then
      update private.document_jobs set state='failed',message=case when patch->>'reason'='invalid-pdf' then 'The PDF is corrupt, encrypted or unreadable. Choose a readable, unencrypted PDF.' else 'Document processing failed. Retry when the connection and folder permissions are available.' end,
        lease=null,lease_until=null,updated_at=clock_timestamp() where id=job_id;
      if job.kind='validate' and patch->>'reason'='invalid-pdf' then
        update private.document_uploads set state='failed' where id=job.resource_id;
        insert into private.document_jobs(kind,project_id,request_id,resource_id,actor,original_actor,payload)
          values('cleanup',job.project_id,job.request_id,job.resource_id,job.actor,job.original_actor,'{"upload":true}') on conflict do nothing;
      end if;
      perform private.document_notify(job.project_id);
      return null;
    elsif action='complete' then
      if job.kind='folder' then
        select f.id into mapping from private.project_document_folders f where f.project_id=job.project_id and f.current;
        if mapping::text is distinct from job.payload->>'expectedMapping' then
          -- An automatic job cannot supersede a mapping set while it was running.
          if mapping is not null then raise exception 'Folder mapping changed' using errcode='40001'; end if;
        end if;
        folder:=job.checkpoint->>'folderId';
        if folder is null or folder=job.checkpoint->>'rootId' or job.checkpoint->>'verified'<>'true' then raise exception 'Verified project folder required' using errcode='23514'; end if;
        insert into private.document_folder_owners values(folder,job.project_id) on conflict do nothing;
        if not exists(select 1 from private.document_folder_owners o where o.folder_id=folder and o.project_id=job.project_id) then raise exception 'Folder belongs to another project' using errcode='23505'; end if;
        update private.project_document_folders set current=false where project_id=job.project_id and current;
        insert into private.project_document_folders(project_id,folder_id,root_id,name) values(job.project_id,folder,job.checkpoint->>'rootId',job.checkpoint->>'name');
      elsif job.kind='validate' then
        select * into upload from private.document_uploads where id=job.resource_id for update;
        select * into state from private.request_document_state where request_id=job.request_id for update;
        if upload.state<>'validating' or state.revision<>upload.base_revision then
          if upload.state<>'complete' then
            update private.document_uploads set state=case when upload.state='cancelled' then 'cancelled' else 'conflict' end where id=upload.id;
            insert into private.document_jobs(kind,project_id,request_id,resource_id,actor,original_actor,payload)
              values('cleanup',job.project_id,job.request_id,upload.id,job.actor,job.original_actor,'{"upload":true}') on conflict do nothing;
          end if;
        else
          if job.checkpoint->>'sha256' is distinct from upload.sha256 or job.checkpoint->>'size' is distinct from upload.size::text
            or job.checkpoint->>'fileId' is distinct from upload.drive_file_id or job.checkpoint->>'readable'<>'true' then raise exception 'Verified PDF required' using errcode='23514'; end if;
          insert into private.request_documents(id,request_id,folder_mapping_id,drive_file_id,name,size,sha256,uploader_id,uploader_name)
            values(upload.id,upload.request_id,upload.folder_mapping_id,upload.drive_file_id,upload.name,upload.size,upload.sha256,upload.uploader_id,upload.uploader_name);
          old_document:=state.current_document;
          update private.request_document_state set current_document=upload.id,revision=revision+1 where request_id=upload.request_id;
          update private.document_uploads set state='complete' where id=upload.id;
          if old_document is not null then
            insert into private.document_jobs(kind,project_id,request_id,resource_id,actor,original_actor) values('cleanup',job.project_id,job.request_id,old_document,job.actor,job.original_actor) on conflict do nothing;
          end if;
        end if;
      elsif job.kind='cleanup' then
        if exists(select 1 from private.request_document_state where current_document=job.resource_id)
          or exists(select 1 from private.mrf_archive_snapshots where source_document=job.resource_id) then raise exception 'Document is retained' using errcode='23514'; end if;
        if job.checkpoint->>'trashed'='true' then update private.request_documents set trashed_at=clock_timestamp() where id=job.resource_id; end if;
      elsif job.kind='archive' then
        select * into snap from private.mrf_archive_snapshots where id=job.resource_id;
        select * into source from private.request_documents where id=snap.source_document;
        if not found or job.checkpoint->>'supportingSha256' is distinct from source.sha256
          or job.checkpoint->>'formSha256' !~ '^[a-f0-9]{64}$' or job.checkpoint->>'verified'<>'true'
          or job.checkpoint->>'formFileId' is null or job.checkpoint->>'supportingFileId' is null then raise exception 'Verified archive pair required' using errcode='23514'; end if;
        insert into private.mrf_archives(snapshot_id,folder_mapping_id,form_file_id,form_sha256,supporting_file_id,supporting_sha256)
          values(snap.id,(job.payload->>'folderMappingId')::uuid,job.checkpoint->>'formFileId',job.checkpoint->>'formSha256',job.checkpoint->>'supportingFileId',job.checkpoint->>'supportingSha256') on conflict do nothing;
      end if;
      update private.document_jobs set state='complete',message=null,lease=null,lease_until=null,updated_at=clock_timestamp() where id=job_id;
      perform private.document_audit(job.actor,'document.'||job.kind||'_completed',coalesce(job.request_id,job.project_id),job.id,jsonb_build_object('projectId',job.project_id,'originalActor',job.original_actor));
      perform private.document_notify(job.project_id);
      return null;
    else raise exception 'Unknown worker operation' using errcode='23514'; end if;
  end if;
  if job.kind='cleanup' and (exists(select 1 from private.request_document_state where current_document=job.resource_id)
    or exists(select 1 from private.mrf_archive_snapshots where source_document=job.resource_id)) then
    update private.document_jobs set state='complete',lease=null,lease_until=null where id=job_id;
    return null;
  end if;
  return to_jsonb(job)||jsonb_build_object(
    'project',(select jsonb_build_object('id',p.id,'name',p.name) from public.projects p where p.id=job.project_id),
    'upload',(select to_jsonb(u)||jsonb_build_object('folder',(select to_jsonb(f) from private.project_document_folders f where f.id=u.folder_mapping_id)) from private.document_uploads u where u.id=job.resource_id),
    'document',(select to_jsonb(d) from private.request_documents d where d.id=job.resource_id),
    'snapshot',(select to_jsonb(s) from private.mrf_archive_snapshots s where s.id=job.resource_id),
    'source',(select to_jsonb(d) from private.mrf_archive_snapshots s join private.request_documents d on d.id=s.source_document where s.id=job.resource_id),
    'folder',(select to_jsonb(f) from private.project_document_folders f where f.id=(job.payload->>'folderMappingId')::uuid));
end $$;

create function public.documents_read(actor jsonb,target_request uuid default null,target_project uuid default null) returns jsonb language sql security definer set search_path='' as $$ select private.documents_read(actor,target_request,target_project); $$;
create function public.document_command(actor jsonb,command jsonb) returns jsonb language sql security definer set search_path='' as $$ select private.document_command(actor,command); $$;
create function public.document_transfer(actor jsonb,upload_id uuid,action text,lease_id uuid default null,patch jsonb default '{}') returns jsonb language sql security definer set search_path='' as $$ select private.document_transfer(actor,upload_id,action,lease_id,patch); $$;
create function public.document_worker(job_id uuid,action text,lease_id uuid default null,patch jsonb default '{}') returns jsonb language sql security definer set search_path='' as $$ select private.document_worker(job_id,action,lease_id,patch); $$;
create function public.document_dispatch(target_project uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare ids uuid[];
begin
  with selected as (select id from private.document_jobs where state in('pending','running') and dispatch_after<=clock_timestamp()
    and (target_project is null or project_id=target_project) and (lease_until is null or lease_until<clock_timestamp()) order by created_at limit 20 for update skip locked),
  updated as (update private.document_jobs j set dispatch_after=clock_timestamp()+interval '2 minutes' from selected s where j.id=s.id returning j.id)
  select array_agg(id) into ids from updated;
  return coalesce(to_jsonb(ids),'[]'::jsonb);
end $$;
create function public.document_file(actor jsonb,document_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare doc private.request_documents; project_id uuid;
begin
  perform private.project_actor(actor,false);
  select * into doc from private.request_documents where id=document_id and trashed_at is null;
  select r.project_id into project_id from public.material_requests r where r.id=doc.request_id;
  if not coalesce(private.request_project_allowed(actor,project_id),false) or not exists(select 1 from private.request_document_state where current_document=doc.id)
    and not exists(select 1 from private.mrf_archive_snapshots where source_document=doc.id) then raise exception 'Document unavailable' using errcode='42501'; end if;
  return jsonb_build_object('fileId',doc.drive_file_id,'name',doc.name,'size',doc.size,'sha256',doc.sha256);
end $$;

-- Explicit grants: private helpers are not a Data API, even for service_role.
do $$ declare signature text; begin
  for signature in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and (p.proname like 'document_%' or p.proname='documents_read' or p.proname in('project_command','project_command_before_documents'))
  loop execute 'revoke all on function '||signature||' from public,anon,authenticated,service_role'; end loop;
  foreach signature in array array['public.documents_read(jsonb,uuid,uuid)','public.document_command(jsonb,jsonb)','public.document_transfer(jsonb,uuid,text,uuid,jsonb)',
    'public.document_worker(uuid,text,uuid,jsonb)','public.document_dispatch(uuid)','public.document_file(jsonb,uuid)'] loop
    execute 'revoke all on function '||signature||' from public,anon,authenticated,service_role';
    execute 'grant execute on function '||signature||' to service_role';
  end loop;
end $$;

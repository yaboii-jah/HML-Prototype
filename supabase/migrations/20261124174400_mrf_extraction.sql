create table private.mrf_extraction_jobs (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.material_requests(id),
  owner_id uuid not null references public.profiles(user_id),
  access_revision text not null,
  request_version bigint not null,
  attachment_revision bigint not null,
  document_id uuid not null references private.request_documents(id),
  sha256 text not null,
  attempt_id uuid not null,
  state text not null default 'pending' check (state in ('pending','running','ready','failed','unusable','expired')),
  reason text,
  proposal jsonb,
  expires_at timestamptz,
  lease uuid,
  lease_until timestamptz,
  dispatch_after timestamptz not null default clock_timestamp(),
  unique (request_id, owner_id, access_revision, request_version, attachment_revision, document_id)
);
alter table private.mrf_extraction_jobs enable row level security;
revoke all on private.mrf_extraction_jobs from public,anon,authenticated,service_role;
create index mrf_extraction_owner on private.mrf_extraction_jobs(owner_id);
create index mrf_extraction_document on private.mrf_extraction_jobs(document_id);

create function private.mrf_extraction_current(target uuid) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('version',r.version::text,'revision',s.revision::text,'documentId',d.id,
    'sha256',d.sha256,'size',d.size,'driveId',d.drive_file_id,'folderId',f.folder_id)
  from public.material_requests r
  join private.request_document_state s on s.request_id=r.id
  join private.request_documents d on d.id=s.current_document and d.request_id=r.id and d.trashed_at is null
  join private.project_document_folders f on f.id=d.folder_mapping_id
  where r.id=target and r.correction_kind is distinct from 'documents' and private.mrf_editable(target);
$$;

create function private.mrf_extraction_matches(job private.mrf_extraction_jobs, source jsonb) returns boolean
language sql immutable set search_path='' as $$
  select coalesce(job.request_version::text=source->>'version' and job.attachment_revision::text=source->>'revision'
    and job.document_id::text=source->>'documentId' and job.sha256=source->>'sha256',false);
$$;

create function private.mrf_extraction_command(actor jsonb, command jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  target uuid := (command->>'mrfId')::uuid;
  action text := command->>'type';
  caller uuid;
  project uuid;
  source jsonb;
  job private.mrf_extraction_jobs;
  dispatch boolean := false;
begin
  perform set_config('lock_timeout','5s',true);
  perform 1 from private.account_guard where id for share;
  caller := private.project_actor(actor,false);
  select project_id into project from public.material_requests where id=target;
  if actor->>'activeRole' is distinct from 'Site Personnel' or not private.request_project_allowed(actor,project) then
    raise exception 'Assigned Site Personnel required' using errcode='42501';
  end if;
  perform 1 from public.projects where id=project for share;
  perform 1 from public.material_requests where id=target for share;
  perform 1 from private.request_document_state where request_id=target for share;
  source := private.mrf_extraction_current(target);
  update private.mrf_extraction_jobs j set state='expired',proposal=null,lease=null,lease_until=null
    where j.request_id=target and j.owner_id=caller and j.state<>'expired'
      and (not private.mrf_extraction_matches(j,source) or j.access_revision<>actor->>'revision'
        or j.expires_at<=clock_timestamp());

  if source is null or source->>'version' is distinct from command->>'version'
    or source->>'revision' is distinct from command->>'attachmentRevision' then
    return jsonb_build_object('state','stale');
  end if;
  if (source->>'size')::bigint>10000000 then return jsonb_build_object('state','unusable','reason','limit'); end if;

  if action='start' then
    insert into private.mrf_extraction_jobs(request_id,owner_id,access_revision,request_version,attachment_revision,document_id,sha256,attempt_id)
      values(target,caller,actor->>'revision',(source->>'version')::bigint,(source->>'revision')::bigint,
        (source->>'documentId')::uuid,source->>'sha256',(command->>'operationId')::uuid)
      on conflict do nothing;
  end if;
  select * into job from private.mrf_extraction_jobs j
    where j.request_id=target and j.owner_id=caller and j.access_revision=actor->>'revision'
      and j.request_version=(source->>'version')::bigint and j.attachment_revision=(source->>'revision')::bigint
      and j.document_id=(source->>'documentId')::uuid for update;
  if action='apply' and (job.id::text is distinct from command->>'proposalId' or job.state is distinct from 'ready') then
    return jsonb_build_object('state','stale');
  end if;
  if job.id is null then return jsonb_build_object('state','idle'); end if;

  if action='retry' and job.id::text=command->>'proposalId' and job.attempt_id::text=command->>'attemptId'
    and job.attempt_id::text<>command->>'operationId' and job.state in ('failed','expired') then
    update private.mrf_extraction_jobs set attempt_id=(command->>'operationId')::uuid,
      state='pending',reason=null,proposal=null,expires_at=null,dispatch_after=clock_timestamp()
      where id=job.id returning * into job;
  end if;
  if job.state in ('pending','running') and job.dispatch_after<=clock_timestamp()
    and (job.lease_until is null or job.lease_until<=clock_timestamp()) then
    update private.mrf_extraction_jobs set dispatch_after=clock_timestamp()+interval '15 seconds' where id=job.id;
    dispatch := true;
  end if;
  return jsonb_strip_nulls(jsonb_build_object('id',job.id,'attemptId',job.attempt_id,'state',job.state,
    'reason',job.reason,'expiresAt',job.expires_at,'proposal',job.proposal,'dispatch',dispatch));
end;
$$;

create function private.mrf_extraction_worker(job_id uuid, action text, lease_id uuid, patch jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  job private.mrf_extraction_jobs;
  project uuid;
  source jsonb;
  valid_until timestamptz;
begin
  perform set_config('lock_timeout','5s',true);
  if action='purge' then
    update private.mrf_extraction_jobs set state='expired',proposal=null
      where id=job_id and state='ready' and expires_at<=clock_timestamp();
    return null;
  end if;
  perform 1 from private.account_guard where id for share;
  select * into job from private.mrf_extraction_jobs where id=job_id;
  if not found then return null; end if;
  perform 1 from auth.users where id=job.owner_id for share;
  perform 1 from public.profiles where user_id=job.owner_id for share;
  select project_id into project from public.material_requests where id=job.request_id;
  perform 1 from public.projects where id=project for share;
  perform 1 from public.material_requests where id=job.request_id for share;
  perform 1 from private.request_document_state where request_id=job.request_id for share;
  select * into job from private.mrf_extraction_jobs where id=job_id for update;
  source := private.mrf_extraction_current(job.request_id);
  if not private.document_job_allowed(jsonb_build_object('userId',job.owner_id,'revision',job.access_revision,'activeRole','Site Personnel'),project,'validate')
    or not private.mrf_extraction_matches(job,source) then
    update private.mrf_extraction_jobs set state='expired',proposal=null,lease=null,lease_until=null where id=job_id;
    return null;
  end if;
  if job.state='ready' and action in ('claim','complete') then
    return jsonb_build_object('expiresAt',job.expires_at);
  end if;
  if action='claim' then
    if job.state not in ('pending','running') or job.lease_until>clock_timestamp() then return null; end if;
    update private.mrf_extraction_jobs set state='running',lease=gen_random_uuid(),
      lease_until=clock_timestamp()+interval '4 minutes' where id=job_id returning * into job;
    return source||jsonb_build_object('lease',job.lease,'requestId',job.request_id);
  end if;
  if job.state<>'running' or job.lease is distinct from lease_id or job.lease_until<=clock_timestamp() then return null; end if;
  if action='check' then return jsonb_build_object('current',true); end if;
  if action='complete' and jsonb_typeof(patch)='object' and octet_length(patch::text)<=500000 then
    valid_until := clock_timestamp()+interval '7 days';
    update private.mrf_extraction_jobs set state='ready',proposal=patch,expires_at=valid_until,
      lease=null,lease_until=null where id=job_id;
    return jsonb_build_object('expiresAt',valid_until);
  end if;
  if action='fail' and patch->>'reason' in ('limit','no-mrf','multiple-mrfs','empty','source','provider') then
    update private.mrf_extraction_jobs set state=case when patch->>'reason'='provider' then 'failed' else 'unusable' end,
      reason=patch->>'reason',lease=null,lease_until=null where id=job_id;
    return null;
  end if;
  raise exception 'Invalid extraction worker action' using errcode='23514';
end;
$$;

alter function private.request_command(jsonb,jsonb) rename to request_without_extraction_command;
create function private.request_command(actor jsonb,command jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  caller uuid;
  target uuid;
  project uuid;
  source jsonb;
  job private.mrf_extraction_jobs;
  receipt private.request_operations;
begin
  if not command ? 'extractionProposalId' then return private.request_without_extraction_command(actor,command); end if;
  if command->>'type' is distinct from 'saveDraft' then
    raise exception 'Save extracted changes before submission' using errcode='23514';
  end if;
  caller := private.project_actor(actor,false);
  target := (command->>'mrfId')::uuid;
  select project_id into project from public.material_requests where id=target;
  if actor->>'activeRole' is distinct from 'Site Personnel' or not private.request_project_allowed(actor,project) then
    raise exception 'Current project access required' using errcode='42501';
  end if;
  select * into receipt from private.request_operations where id=(command->>'requestId')::uuid;
  if found and receipt.actor_id=caller and receipt.payload=command and receipt.result is not null then return receipt.result; end if;
  perform 1 from public.projects where id=project for update;
  perform 1 from public.material_requests where id=target for update;
  perform 1 from private.request_document_state where request_id=target for update;
  select * into job from private.mrf_extraction_jobs where id=(command->>'extractionProposalId')::uuid
    and owner_id=caller and request_id=target and access_revision=actor->>'revision' for share;
  source := private.mrf_extraction_current(target);
  if job.state is distinct from 'ready' or job.expires_at<=clock_timestamp()
    or job.request_version::text is distinct from command->>'expectedVersion'
    or not private.mrf_extraction_matches(job,source) then
    raise exception 'Extraction proposal is stale' using errcode='P4350';
  end if;
  return private.request_without_extraction_command(actor,command);
end;
$$;

create function public.mrf_extraction_command(actor jsonb,command jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select private.mrf_extraction_command(actor,command); $$;
create function public.mrf_extraction_worker(job_id uuid,action text,lease_id uuid,patch jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select private.mrf_extraction_worker(job_id,action,lease_id,patch); $$;
revoke all on function private.mrf_extraction_current(uuid),private.mrf_extraction_matches(private.mrf_extraction_jobs,jsonb),
  private.request_command(jsonb,jsonb),private.mrf_extraction_command(jsonb,jsonb),
  private.mrf_extraction_worker(uuid,text,uuid,jsonb),public.mrf_extraction_command(jsonb,jsonb),
  public.mrf_extraction_worker(uuid,text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.mrf_extraction_command(jsonb,jsonb),private.mrf_extraction_worker(uuid,text,uuid,jsonb),
  public.mrf_extraction_command(jsonb,jsonb),public.mrf_extraction_worker(uuid,text,uuid,jsonb) to service_role;

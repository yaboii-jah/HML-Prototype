create table private.quotation_extraction_jobs (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references private.quotation_drafts(id),
  owner_id uuid not null references public.profiles(user_id),
  access_revision text not null,
  source_hash bytea not null,
  attempt_id uuid not null,
  state text not null default 'pending' check(state in ('pending','running','ready','failed','unusable','expired')),
  reason text,
  proposal jsonb,
  expires_at timestamptz,
  lease uuid,
  lease_until timestamptz,
  dispatch_after timestamptz not null default clock_timestamp(),
  unique(quote_id,owner_id,access_revision,source_hash)
);
alter table private.quotation_extraction_jobs enable row level security;
revoke all on private.quotation_extraction_jobs from public,anon,authenticated,service_role;
create index quotation_extraction_owner on private.quotation_extraction_jobs(owner_id);

create function private.quotation_extraction_source(q private.quotation_drafts) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('version',q.version::text,'contentVersion',q.content_version::text,
    'fileVersion',q.file_version::text,'archiveId',archive.id,'files',originals.files)
  from (select private.quotation_mrf_archive(q.request_id) as id) archive
  cross join lateral (
    select jsonb_agg(jsonb_build_object('id',f.id,'quoteId',f.quote_id,'mime',f.mime,'size',f.size,
      'sha256',f.sha256,'driveId',f.drive_file_id,'folderId',folder.folder_id) order by selected.position) as files,
      count(*) as count
    from unnest(q.current_files) with ordinality selected(id,position)
    join private.quotation_files f on f.id=selected.id and f.drive_file_id is not null
    join private.project_document_folders folder on folder.id=f.folder_mapping_id
  ) originals
  where q.state='draft' and archive.id is not null and private.mrf_ready(q.request_id)
    and private.quotation_ready_files(q) and originals.count=cardinality(q.current_files);
$$;

-- Serialize against quote edits, original-group commits and MRF archive changes.
create function private.quotation_extraction_current(target uuid) returns jsonb
language plpgsql set search_path='' as $$
declare parent uuid; q private.quotation_drafts;
begin
  select request_id into parent from private.quotation_drafts where id=target;
  perform 1 from public.material_requests where id=parent for share;
  select * into q from private.quotation_drafts where id=target for share;
  return private.quotation_extraction_source(q);
end;
$$;

create function private.quotation_extraction_command(actor jsonb,command jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  target uuid := (command->>'quoteId')::uuid;
  action text := command->>'type';
  caller uuid;
  source jsonb;
  fingerprint bytea;
  job private.quotation_extraction_jobs;
  dispatch boolean := false;
begin
  perform set_config('lock_timeout','5s',true);
  perform 1 from private.account_guard where id for share;
  caller := private.quotation_actor(actor,true);
  source := private.quotation_extraction_current(target);
  fingerprint := sha256(convert_to(source::text,'UTF8'));
  update private.quotation_extraction_jobs j set state='expired',proposal=null,lease=null,lease_until=null
    where j.quote_id=target and j.owner_id=caller and j.state<>'expired'
      and (j.source_hash is distinct from fingerprint or j.access_revision<>actor->>'revision' or j.expires_at<=clock_timestamp());

  if source is null or source->>'version' is distinct from command->>'version'
    or source->>'fileVersion' is distinct from command->>'fileVersion' then
    return jsonb_build_object('state','stale');
  end if;
  if jsonb_array_length(source->'files')>12 or (
    select sum((f->>'size')::bigint) from jsonb_array_elements(source->'files') f
  )>47185920 then return jsonb_build_object('state','unusable','reason','limit'); end if;

  if action='start' then
    insert into private.quotation_extraction_jobs(quote_id,owner_id,access_revision,source_hash,attempt_id)
      values(target,caller,actor->>'revision',fingerprint,(command->>'operationId')::uuid)
      on conflict do nothing;
  end if;
  select * into job from private.quotation_extraction_jobs j
    where j.quote_id=target and j.owner_id=caller and j.access_revision=actor->>'revision'
      and j.source_hash=fingerprint for update;
  if action='apply' and (job.id::text is distinct from command->>'proposalId' or job.state is distinct from 'ready') then
    return jsonb_build_object('state','stale');
  end if;
  if job.id is null then return jsonb_build_object('state','idle'); end if;

  if action='retry' and job.id::text=command->>'proposalId' and job.attempt_id::text=command->>'attemptId'
    and job.attempt_id::text<>command->>'operationId' and job.state in ('failed','expired') then
    update private.quotation_extraction_jobs set attempt_id=(command->>'operationId')::uuid,
      state='pending',reason=null,proposal=null,expires_at=null,dispatch_after=clock_timestamp()
      where id=job.id returning * into job;
  end if;
  if job.state in ('pending','running') and job.dispatch_after<=clock_timestamp()
    and (job.lease_until is null or job.lease_until<=clock_timestamp()) then
    update private.quotation_extraction_jobs set dispatch_after=clock_timestamp()+interval '15 seconds' where id=job.id;
    dispatch := true;
  end if;
  return jsonb_strip_nulls(jsonb_build_object('id',job.id,'attemptId',job.attempt_id,'state',job.state,
    'reason',job.reason,'expiresAt',job.expires_at,'dispatch',dispatch))
    || case when action='apply' then jsonb_build_object('proposal',job.proposal) else '{}'::jsonb end;
end;
$$;

create function private.quotation_extraction_worker(job_id uuid,action text,lease_id uuid,patch jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job private.quotation_extraction_jobs; source jsonb; valid_until timestamptz;
begin
  perform set_config('lock_timeout','5s',true);
  if action='purge' then
    update private.quotation_extraction_jobs set state='expired',proposal=null
      where id=job_id and state='ready' and expires_at<=clock_timestamp();
    return null;
  end if;
  perform 1 from private.account_guard where id for share;
  select * into job from private.quotation_extraction_jobs where id=job_id;
  if not found then return null; end if;
  perform 1 from auth.users where id=job.owner_id for share;
  perform 1 from public.profiles where user_id=job.owner_id for share;
  source := private.quotation_extraction_current(job.quote_id);
  select * into job from private.quotation_extraction_jobs where id=job_id for update;
  if not private.quotation_job_allowed(jsonb_build_object('userId',job.owner_id,'revision',job.access_revision,'activeRole','Procurement'),job.quote_id)
    or job.source_hash is distinct from sha256(convert_to(source::text,'UTF8')) then
    update private.quotation_extraction_jobs set state='expired',proposal=null,lease=null,lease_until=null where id=job_id;
    return null;
  end if;
  if job.state='ready' and action in ('claim','complete') then
    return jsonb_build_object('expiresAt',job.expires_at);
  end if;
  if action='claim' then
    if job.state not in ('pending','running') or job.lease_until>clock_timestamp() then return null; end if;
    update private.quotation_extraction_jobs set state='running',lease=gen_random_uuid(),
      lease_until=clock_timestamp()+interval '4 minutes' where id=job_id returning * into job;
    return source||jsonb_build_object('lease',job.lease);
  end if;
  if job.state<>'running' or job.lease is distinct from lease_id or job.lease_until<=clock_timestamp() then return null; end if;
  if action='check' then return jsonb_build_object('current',true); end if;
  if action='complete' and jsonb_typeof(patch)='object' and octet_length(patch::text)<=500000 then
    valid_until := clock_timestamp()+interval '7 days';
    update private.quotation_extraction_jobs set state='ready',proposal=patch,expires_at=valid_until,
      lease=null,lease_until=null where id=job_id;
    return jsonb_build_object('expiresAt',valid_until);
  end if;
  if action='fail' and patch->>'reason' in ('limit','no-offer','multiple-offers','empty','source','provider') then
    update private.quotation_extraction_jobs set state=case when patch->>'reason'='provider' then 'failed' else 'unusable' end,
      reason=patch->>'reason',lease=null,lease_until=null where id=job_id;
    return null;
  end if;
  raise exception 'Invalid quotation extraction action' using errcode='23514';
end;
$$;

alter function private.quotation_capture_command(jsonb,jsonb) rename to quotation_capture_before_extraction;
create function private.quotation_capture_command(actor jsonb,command jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare caller uuid; target uuid; q private.quotation_drafts; source jsonb;
  receipt private.quotation_operations; job private.quotation_extraction_jobs;
begin
  if not command ? 'extractionProposalId' then return private.quotation_capture_before_extraction(actor,command); end if;
  if command->>'type' is distinct from 'save' then raise exception 'Quotation save required' using errcode='23514'; end if;
  perform set_config('lock_timeout','5s',true);
  perform 1 from private.account_guard where id for update;
  caller := private.quotation_actor(actor,true);
  select * into receipt from private.quotation_operations where id=(command->>'requestId')::uuid;
  if found and (receipt.result is not null or receipt.actor_id<>caller or receipt.payload<>command) then
    return private.quotation_capture_before_extraction(actor,command);
  end if;
  target := (command->>'quoteId')::uuid;
  q := private.quotation_lock(target,true);
  source := private.quotation_extraction_source(q);
  select * into job from private.quotation_extraction_jobs where id=(command->>'extractionProposalId')::uuid
    and quote_id=target and owner_id=caller and access_revision=actor->>'revision' for share;
  if job.state is distinct from 'ready' or job.expires_at<=clock_timestamp()
    or q.version::text is distinct from command->>'expectedVersion'
    or job.source_hash is distinct from sha256(convert_to(source::text,'UTF8')) then
    raise exception 'Quotation extraction is stale' using errcode='P4550';
  end if;
  return private.quotation_capture_before_extraction(actor,command);
end;
$$;

create function public.quotation_extraction_command(actor jsonb,command jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select private.quotation_extraction_command(actor,command); $$;
create function public.quotation_extraction_worker(job_id uuid,action text,lease_id uuid,patch jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select private.quotation_extraction_worker(job_id,action,lease_id,patch); $$;
revoke all on function private.quotation_extraction_source(private.quotation_drafts),private.quotation_extraction_current(uuid),
  private.quotation_capture_command(jsonb,jsonb),private.quotation_capture_before_extraction(jsonb,jsonb),
  private.quotation_extraction_command(jsonb,jsonb),private.quotation_extraction_worker(uuid,text,uuid,jsonb),
  public.quotation_extraction_command(jsonb,jsonb),public.quotation_extraction_worker(uuid,text,uuid,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function private.quotation_extraction_command(jsonb,jsonb),private.quotation_extraction_worker(uuid,text,uuid,jsonb),
  public.quotation_extraction_command(jsonb,jsonb),public.quotation_extraction_worker(uuid,text,uuid,jsonb) to service_role;

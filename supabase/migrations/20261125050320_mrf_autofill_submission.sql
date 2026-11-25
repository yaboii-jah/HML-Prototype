-- Bind autofilled submissions to the checked draft and PDF in the existing transaction.
create or replace function private.request_command(actor jsonb,command jsonb) returns jsonb
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
  if coalesce(command->>'type','') not in ('saveDraft','submitMrf') then
    raise exception 'Autofill belongs to a draft save or submission' using errcode='23514';
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
    or not private.mrf_extraction_matches(job,source)
    or (command->>'type'='submitMrf' and job.attachment_revision::text is distinct from command->>'attachmentRevision') then
    raise exception 'Extraction proposal is stale' using errcode='P4350';
  end if;
  return private.request_without_extraction_command(actor,command);
end;
$$;

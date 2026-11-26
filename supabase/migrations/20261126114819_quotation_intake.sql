create table private.quotation_intakes (
  id uuid primary key,
  request_id uuid not null references public.material_requests(id),
  archive_id uuid not null,
  owner_id uuid not null references public.profiles(user_id),
  actor jsonb not null,
  folder_id text not null,
  descriptors jsonb not null,
  state text not null default 'open' check(state in('open','pending','running','ready','failed','unusable','saved','closed')),
  verified boolean not null default false,
  proposal jsonb,
  reason text,
  quote_id uuid references private.quotation_drafts(id),
  quote_version bigint,
  expires_at timestamptz not null default clock_timestamp()+interval '24 hours',
  cleanup_scheduled boolean not null default false,
  lease uuid,
  lease_until timestamptz,
  dispatch_after timestamptz not null default clock_timestamp()
);
create unique index quotation_open_intake on private.quotation_intakes(request_id,owner_id) where state not in('saved','closed');
create index quotation_intake_owner on private.quotation_intakes(owner_id);
create index quotation_intake_quote on private.quotation_intakes(quote_id) where quote_id is not null;

create table private.quotation_intake_files (
  id uuid primary key default gen_random_uuid(),
  intake_id uuid not null references private.quotation_intakes(id),
  position integer not null,
  name text not null,
  mime text not null,
  size bigint not null,
  sha256 text not null,
  drive_id text,
  session text,
  offset_bytes bigint not null default 0,
  uploaded boolean not null default false,
  trashed boolean not null default false,
  lease uuid,
  lease_until timestamptz,
  unique(intake_id,position)
);
alter table private.quotation_intakes enable row level security;
alter table private.quotation_intake_files enable row level security;
revoke all on private.quotation_intakes,private.quotation_intake_files from public,anon,authenticated,service_role;

create function private.quotation_intake_current(i private.quotation_intakes) returns boolean
language sql stable set search_path='' as $$
  select coalesce(i.archive_id=private.quotation_mrf_archive(i.request_id) and private.mrf_ready(i.request_id)
    and i.expires_at>clock_timestamp() and i.state not in('saved','closed'),false);
$$;

create function private.quotation_intake_command(actor jsonb,command jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare target uuid:=(command->>'mrfId')::uuid; action text:=command->>'type'; caller uuid;
  i private.quotation_intakes; item jsonb; archive uuid; n integer:=0; total bigint:=0; dispatch boolean:=false;
begin
  perform set_config('lock_timeout','5s',true);
  perform 1 from private.account_guard where id for share;
  caller:=private.quotation_actor(actor,true);
  perform 1 from public.material_requests r where r.id=target and private.request_project_allowed(actor,r.project_id) for share;
  if not found then raise exception 'MRF access denied' using errcode='42501'; end if;
  archive:=private.quotation_mrf_archive(target);
  update private.quotation_intakes set state='closed',proposal=null
    where request_id=target and owner_id=caller and state not in('saved','closed') and expires_at<=clock_timestamp();
  select * into i from private.quotation_intakes x where x.request_id=target and x.owner_id=caller
    and (x.id::text=command->>'intakeId' or command->>'intakeId' is null and x.state not in('saved','closed'))
    order by x.expires_at desc limit 1 for update;
  if action='begin' and i.id is null then
    if archive is null or not private.mrf_ready(target) then raise exception 'Current archived MRF required' using errcode='P4502'; end if;
    if jsonb_typeof(command->'files') is distinct from 'array' or jsonb_array_length(command->'files') not between 1 and 12
      or not coalesce(command->>'folderId' ~ '^[A-Za-z0-9_-]{10,}$',false) then raise exception 'Invalid intake originals' using errcode='23514'; end if;
    insert into private.quotation_intakes(id,request_id,archive_id,owner_id,actor,folder_id,descriptors)
      values((command->>'operationId')::uuid,target,archive,caller,private.document_actor_snapshot(actor),command->>'folderId',command->'files') returning * into i;
    for item in select value from jsonb_array_elements(command->'files') loop
      if not coalesce(length(item->>'name') between 1 and 240 and item->>'mime' in('application/pdf','image/jpeg','image/png','image/webp')
        and jsonb_typeof(item->'size')='number' and item->>'size' ~ '^[0-9]+$' and (item->>'size')::bigint between 5 and 20971520
        and item->>'sha256' ~ '^[a-f0-9]{64}$',false) then raise exception 'Invalid intake original' using errcode='23514'; end if;
      n:=n+1; total:=total+(item->>'size')::bigint;
      insert into private.quotation_intake_files(intake_id,position,name,mime,size,sha256)
        values(i.id,n,item->>'name',item->>'mime',(item->>'size')::bigint,item->>'sha256');
    end loop;
    if total>47185920 then raise exception 'Intake exceeds file limit' using errcode='23514'; end if;
  elsif action='begin' and i.descriptors is distinct from command->'files' then
    raise exception 'An intake already exists' using errcode='P4551';
  end if;
  if i.id is null or i.state in('saved','closed') then return jsonb_build_object('state','idle'); end if;
  if action='cancel' then
    update private.quotation_intakes set state='closed',proposal=null where id=i.id;
    return jsonb_build_object('state','idle','cleanupId',i.id);
  end if;
  if i.actor->>'revision' is distinct from actor->>'revision' or not private.quotation_intake_current(i) then
    return jsonb_build_object('state','stale','id',i.id);
  end if;
  if action='start' and i.state in('open','failed') and not exists(select 1 from private.quotation_intake_files f where f.intake_id=i.id and not f.uploaded) then
    update private.quotation_intakes set state='pending',reason=null,dispatch_after=clock_timestamp() where id=i.id returning * into i;
  end if;
  if i.state in('pending','running') and i.dispatch_after<=clock_timestamp() and coalesce(i.lease_until<=clock_timestamp(),true) then
    update private.quotation_intakes set dispatch_after=clock_timestamp()+interval '15 seconds' where id=i.id;
    dispatch:=true;
  end if;
  return jsonb_build_object('id',i.id,'state',i.state,'reason',i.reason,'verified',i.verified,'expiresAt',i.expires_at,
    'schedule',not i.cleanup_scheduled,'dispatch',dispatch,
    'supplier',case when i.state='ready' then (select jsonb_object_agg(k,i.proposal->'body'->k)
      from unnest(array['supplierName','address','tin','contactName','email','phone']) k) end,
    'files',(select jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'mime',f.mime,'size',f.size,
      'sha256',f.sha256,'offset',f.offset_bytes,'uploaded',f.uploaded) order by f.position) from private.quotation_intake_files f where f.intake_id=i.id));
end;
$$;

create function private.quotation_intake_transfer(actor jsonb,file_id uuid,action text,lease_id uuid,patch jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare caller uuid; i private.quotation_intakes; f private.quotation_intake_files;
begin
  perform set_config('lock_timeout','5s',true);
  perform 1 from private.account_guard where id for share;
  caller:=private.quotation_actor(actor,true);
  select q.* into i from private.quotation_intakes q join private.quotation_intake_files x on x.intake_id=q.id where x.id=file_id;
  perform 1 from public.material_requests where id=i.request_id for share;
  select * into i from private.quotation_intakes where id=i.id for share;
  if i.owner_id is distinct from caller or i.actor->>'revision' is distinct from actor->>'revision' or not i.cleanup_scheduled
    or not private.quotation_intake_current(i) then raise exception 'Intake upload unavailable' using errcode='42501'; end if;
  select * into f from private.quotation_intake_files where id=file_id for update;
  if f.uploaded then return jsonb_build_object('complete',true,'offset',f.size); end if;
  if i.state<>'open' then raise exception 'Intake upload closed' using errcode='P4551'; end if;
  if action='claim' then
    if f.lease_until>clock_timestamp() then raise exception 'Upload in progress' using errcode='P4551'; end if;
    update private.quotation_intake_files set lease=gen_random_uuid(),lease_until=clock_timestamp()+interval '4 minutes' where id=f.id returning * into f;
  else
    if f.lease is distinct from lease_id or coalesce(f.lease_until<=clock_timestamp(),true) then raise exception 'Upload lease changed' using errcode='P4551'; end if;
    if action='checkpoint' then
      update private.quotation_intake_files set drive_id=coalesce(drive_id,patch->>'driveFileId'),session=coalesce(patch->>'session',session),
        offset_bytes=greatest(offset_bytes,coalesce((patch->>'offset')::bigint,0)) where id=f.id returning * into f;
    elsif action='finish' and f.drive_id is not null then
      update private.quotation_intake_files set uploaded=true,offset_bytes=size,session=null,lease=null,lease_until=null where id=f.id;
      return jsonb_build_object('complete',true,'offset',f.size);
    elsif action='release' then
      update private.quotation_intake_files set lease=null,lease_until=null where id=f.id;
      return null;
    else raise exception 'Invalid intake upload step' using errcode='23514'; end if;
  end if;
  return to_jsonb(f)||jsonb_build_object('folderId',i.folder_id);
end;
$$;

create function private.quotation_intake_worker(target uuid,action text,lease_id uuid,patch jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare i private.quotation_intakes; g private.quotation_groups; remaining jsonb; next_at timestamptz;
begin
  perform set_config('lock_timeout','5s',true);
  perform 1 from private.account_guard where id for share;
  select * into i from private.quotation_intakes where id=target;
  if i.id is null then return null; end if;
  if action not in('schedule','cleanup','trashed') then
    perform 1 from auth.users where id=i.owner_id for share;
    perform 1 from public.profiles where user_id=i.owner_id for share;
  end if;
  perform 1 from public.material_requests where id=i.request_id for share;
  select * into i from private.quotation_intakes where id=target for update;
  if action='schedule' then
    update private.quotation_intakes set cleanup_scheduled=true where id=i.id;
    return null;
  end if;
  if action='trashed' then
    update private.quotation_intake_files set trashed=true,session=null where intake_id=i.id and id::text=patch->>'fileId';
    return null;
  end if;
  if action='cleanup' then
    if i.state='saved' then select * into g from private.quotation_groups where id=i.id; end if;
    if i.state<>'closed' and coalesce(g.state not in('cancelled','committed'),true) and i.expires_at>clock_timestamp() then
      return jsonb_build_object('retryAt',i.expires_at);
    end if;
    select max(f.lease_until) into next_at from private.quotation_intake_files f where f.intake_id=i.id;
    next_at:=greatest(next_at,i.lease_until);
    if next_at>clock_timestamp() then return jsonb_build_object('retryAt',next_at); end if;
    if i.state='saved' and g.state not in('cancelled','committed') and exists(select 1 from private.quotation_jobs j
      join private.quotation_files f on f.id=j.file_id where f.group_id=g.id and j.lease_until>clock_timestamp()) then
      return jsonb_build_object('retryAt',clock_timestamp()+interval '4 minutes');
    end if;
    update private.quotation_intakes set state=case when i.state='saved' then 'saved' else 'closed' end,proposal=null where id=i.id;
    update private.quotation_extraction_jobs set state='expired',proposal=null
      where quote_id=i.quote_id and attempt_id=i.id and state='ready' and expires_at<=clock_timestamp();
    select max(expires_at) into next_at from private.quotation_extraction_jobs
      where quote_id=i.quote_id and attempt_id=i.id and state='ready';
    select jsonb_agg(jsonb_build_object('id',f.id,'driveId',f.drive_id,'mime',f.mime)) into remaining
      from private.quotation_intake_files f where f.intake_id=i.id and f.drive_id is not null and not f.trashed;
    return jsonb_build_object('files',coalesce(remaining,'[]'),'folderId',i.folder_id,'retryAt',next_at);
  end if;
  if not private.quotation_intake_current(i) or not exists(select 1 from public.profiles p join auth.users u on u.id=p.user_id
    join public.role_grants grant_row on grant_row.user_id=p.user_id and grant_row.role='Procurement' where p.user_id=i.owner_id and p.is_active
    and p.access_revision::text=i.actor->>'revision' and not u.is_anonymous and u.email_confirmed_at is not null
    and (u.banned_until is null or u.banned_until<=now())) then return null; end if;
  if action='claim' and i.state in('pending','running') and coalesce(i.lease_until<=clock_timestamp(),true) then
    update private.quotation_intakes set state='running',lease=gen_random_uuid(),lease_until=clock_timestamp()+interval '8 minutes'
      where id=i.id returning * into i;
    return jsonb_build_object('lease',i.lease,'folderId',i.folder_id,'files',
      (select jsonb_agg(to_jsonb(f)-'session' order by f.position) from private.quotation_intake_files f where f.intake_id=i.id));
  end if;
  if i.state<>'running' or i.lease is distinct from lease_id or i.lease_until<=clock_timestamp() then return null; end if;
  if action='verified' then
    update private.quotation_intakes set verified=true where id=i.id;
    return jsonb_build_object('current',true);
  elsif action='complete' and i.verified and jsonb_typeof(patch)='object' and octet_length(patch::text)<=500000 then
    update private.quotation_intakes set state='ready',proposal=patch,lease=null,lease_until=null where id=i.id;
  elsif action='fail' and patch->>'reason' in('provider','limit','source','no-offer','multiple-offers','empty') then
    update private.quotation_intakes set state=case when patch->>'reason'='provider' then 'failed' else 'unusable' end,
      reason=patch->>'reason',lease=null,lease_until=null where id=i.id;
  end if;
  return null;
end;
$$;

alter function private.quotation_capture_command(jsonb,jsonb) rename to quotation_capture_before_intake;
create function private.quotation_capture_command(actor jsonb,command jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare caller uuid; i private.quotation_intakes; q private.quotation_drafts; receipt private.quotation_operations;
  reply jsonb; target uuid; mapping uuid; snapshot jsonb; ids uuid[];
begin
  if not command ? 'intakeId' then return private.quotation_capture_before_intake(actor,command); end if;
  if command->>'type' is distinct from 'create' or jsonb_array_length(command->'body'->'lines')<>0
    or jsonb_array_length(command->'body'->'adjustments')<>0
    or exists(select 1 from jsonb_each((command->'body')-array['supplierName','address','tin','contactName','email','phone','lines','adjustments']) field
      where field.value is distinct from '""'::jsonb) then raise exception 'Save reviewed supplier details first' using errcode='23514'; end if;
  caller:=private.quotation_actor(actor,true);
  select * into receipt from private.quotation_operations where id=(command->>'requestId')::uuid;
  if found then
    if receipt.actor_id<>caller or receipt.payload<>command then raise exception 'Retry identity reused' using errcode='P4503'; end if;
    if receipt.result is not null then return receipt.result; end if;
  end if;
  perform 1 from public.material_requests where id=(command->>'mrfId')::uuid for update;
  select * into i from private.quotation_intakes where id=(command->>'intakeId')::uuid for update;
  if i.owner_id is distinct from caller or i.actor->>'revision' is distinct from actor->>'revision'
    or i.request_id::text is distinct from command->>'mrfId' or not private.quotation_intake_current(i)
    or not i.verified or i.state not in('ready','failed','unusable') then raise exception 'Intake originals or approval changed' using errcode='P4551'; end if;
  if command->>'supplierId' is not null then
    select d.id into target from private.quotation_drafts d where d.request_id=i.request_id
      and d.supplier_id=(command->>'supplierId')::uuid and d.state in('draft','finalized') order by (d.state='draft') desc,d.created_at desc limit 1;
  end if;
  if target is not null then
    reply:=jsonb_build_object('quoteId',target,'changed',false,'quote',private.quotation_view(target));
    insert into private.quotation_operations(id,actor_id,payload,result) values((command->>'requestId')::uuid,caller,command,reply);
    return reply;
  end if;
  reply:=private.quotation_capture_before_intake(actor,command);
  if not coalesce((reply->>'changed')::boolean,false) then return reply; end if;
  target:=(reply->>'quoteId')::uuid;
  select * into q from private.quotation_drafts where id=target;
  select f.id into mapping from private.project_document_folders f join public.material_requests r on r.project_id=f.project_id
    where r.id=q.request_id and f.current;
  if mapping is null then raise exception 'Set up the project document folder first' using errcode='P4201'; end if;
  snapshot:=private.document_actor_snapshot(actor);
  select array_agg(f.id order by f.position) into ids from private.quotation_intake_files f where f.intake_id=i.id;
  insert into private.quotation_groups(id,quote_id,expected_version,files,actor,original_actor) values(i.id,target,q.file_version,ids,snapshot,snapshot);
  insert into private.quotation_files(id,quote_id,group_id,folder_mapping_id,name,mime,size,sha256,state)
    select f.id,target,i.id,mapping,f.name,f.mime,f.size,f.sha256,'validating' from private.quotation_intake_files f where f.intake_id=i.id;
  perform private.quotation_enqueue(f.id,'validate',snapshot) from private.quotation_intake_files f where f.intake_id=i.id;
  update private.quotation_intakes set state='saved',quote_id=target,quote_version=q.version,expires_at=clock_timestamp()+interval '7 days' where id=i.id;
  reply:=jsonb_set(reply,'{quote}',private.quotation_view(target));
  update private.quotation_operations set result=reply where id=(command->>'requestId')::uuid;
  return reply;
end;
$$;

-- The ordinary original-group commit attaches the carried result to the exact new snapshot.
create function private.quotation_intake_handoff() returns trigger
language plpgsql security definer set search_path='' as $$
declare i private.quotation_intakes; q private.quotation_drafts; source jsonb; ready jsonb; job uuid;
begin
  select * into i from private.quotation_intakes where id=new.id and state='saved';
  if i.proposal is null or i.expires_at<=clock_timestamp() then return null; end if;
  select * into q from private.quotation_drafts where id=new.quote_id;
  if q.version is distinct from i.quote_version or q.current_files is distinct from new.files
    or i.archive_id is distinct from private.quotation_mrf_archive(i.request_id)
    or not private.quotation_job_allowed(i.actor,q.id) then return null; end if;
  source:=private.quotation_extraction_source(q);
  if source is null then return null; end if;
  ready:=jsonb_set(i.proposal,'{body}',(i.proposal->'body')||'{"supplierName":"","address":"","tin":"","contactName":"","email":"","phone":""}');
  insert into private.quotation_extraction_jobs(quote_id,owner_id,access_revision,source_hash,attempt_id,state,proposal,expires_at)
    values(q.id,i.owner_id,i.actor->>'revision',sha256(convert_to(source::text,'UTF8')),i.id,'ready',ready,i.expires_at)
    on conflict do nothing returning id into job;
  update private.quotation_intakes set proposal=null where id=i.id;
  return null;
end;
$$;
create trigger quotation_intake_handoff after update of state on private.quotation_groups
  for each row when (new.state='committed' and old.state is distinct from new.state) execute function private.quotation_intake_handoff();

alter function private.quotation_worker(uuid,text,uuid,jsonb) rename to quotation_worker_before_intake;
create function private.quotation_worker(job_id uuid,action text,lease_id uuid default null,patch jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; target_file uuid; staging jsonb;
begin
  result:=private.quotation_worker_before_intake(job_id,action,lease_id,patch);
  if result is null and action='complete' then
    select jsonb_build_object('intakeCleanup',i.id) into result from private.quotation_jobs j
      join private.quotation_files f on f.id=j.file_id join private.quotation_groups g on g.id=f.group_id
      join private.quotation_intakes i on i.id=g.id where j.id=job_id and j.state='complete' and g.state='committed';
    return result;
  end if;
  if result is null or result->>'kind' is distinct from 'validate' then return result; end if;
  target_file:=(result->'file'->>'id')::uuid;
  select jsonb_build_object('intakeId',i.id,'folderId',i.folder_id,'driveId',f.drive_id,'expiresAt',i.expires_at,'trashed',f.trashed)
    into staging from private.quotation_intake_files f join private.quotation_intakes i on i.id=f.intake_id
    where f.id=target_file and i.id::text=result->'file'->>'group_id' and i.state='saved';
  if staging is null then return result; end if;
  if action='checkpoint' and patch ? 'intakeDestination' then
    if not coalesce(patch->>'intakeDestination' ~ '^[A-Za-z0-9_-]+$',false) then raise exception 'Invalid destination identity' using errcode='23514'; end if;
    update private.quotation_files f set drive_file_id=coalesce(f.drive_file_id,patch->>'intakeDestination') where f.id=target_file
      returning jsonb_set(result,'{file,drive_file_id}',to_jsonb(f.drive_file_id)) into result;
  end if;
  return result||jsonb_build_object('intake',staging);
end;
$$;

create function public.quotation_intake_command(actor jsonb,command jsonb) returns jsonb language sql security invoker set search_path='' as $$
  select private.quotation_intake_command(actor,command);
$$;
create function public.quotation_intake_transfer(actor jsonb,file_id uuid,action text,lease_id uuid,patch jsonb) returns jsonb language sql security invoker set search_path='' as $$
  select private.quotation_intake_transfer(actor,file_id,action,lease_id,patch);
$$;
create function public.quotation_intake_worker(target uuid,action text,lease_id uuid,patch jsonb) returns jsonb language sql security invoker set search_path='' as $$
  select private.quotation_intake_worker(target,action,lease_id,patch);
$$;
create or replace function public.quotation_worker(job_id uuid,action text,lease_id uuid default null,patch jsonb default '{}') returns jsonb
  language sql security invoker set search_path='' as $$ select private.quotation_worker(job_id,action,lease_id,patch); $$;
revoke all on function private.quotation_intake_current(private.quotation_intakes),private.quotation_intake_handoff(),
  private.quotation_capture_before_intake(jsonb,jsonb),private.quotation_capture_command(jsonb,jsonb),
  private.quotation_worker_before_intake(uuid,text,uuid,jsonb),private.quotation_worker(uuid,text,uuid,jsonb),
  private.quotation_intake_command(jsonb,jsonb),private.quotation_intake_transfer(jsonb,uuid,text,uuid,jsonb),private.quotation_intake_worker(uuid,text,uuid,jsonb),
  public.quotation_intake_command(jsonb,jsonb),public.quotation_intake_transfer(jsonb,uuid,text,uuid,jsonb),public.quotation_intake_worker(uuid,text,uuid,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function private.quotation_worker(uuid,text,uuid,jsonb),
  private.quotation_intake_command(jsonb,jsonb),private.quotation_intake_transfer(jsonb,uuid,text,uuid,jsonb),private.quotation_intake_worker(uuid,text,uuid,jsonb),
  public.quotation_intake_command(jsonb,jsonb),public.quotation_intake_transfer(jsonb,uuid,text,uuid,jsonb),public.quotation_intake_worker(uuid,text,uuid,jsonb)
  to service_role;

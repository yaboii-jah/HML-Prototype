-- 4.5a: capture only. No financial calculation, finalization or award writer.
create table private.quotation_drafts (
  id uuid primary key, request_id uuid not null references public.material_requests(id) on delete restrict,
  supplier_id uuid not null references private.suppliers(id) on delete restrict,
  body jsonb not null, state text not null default 'draft' check(state in('draft','cancelled')),
  version bigint not null default 1, content_version bigint not null default 1,
  file_version bigint not null default 1, current_files uuid[] not null default '{}',
  checked jsonb, matches jsonb not null default '{}',
  creator_id uuid not null references public.profiles(user_id), creator_name text not null,
  created_at timestamptz not null default clock_timestamp()
);
create unique index quotation_one_draft on private.quotation_drafts(request_id,supplier_id) where state='draft';
create index quotation_supplier on private.quotation_drafts(supplier_id);
create index quotation_creator on private.quotation_drafts(creator_id);
create table private.quotation_operations (
  id uuid primary key, actor_id uuid not null references public.profiles(user_id),
  payload jsonb not null, result jsonb
);
create index quotation_operations_actor on private.quotation_operations(actor_id);
create table private.quotation_groups (
  id uuid primary key, quote_id uuid not null references private.quotation_drafts(id),
  expected_version bigint not null, files uuid[] not null default '{}',
  state text not null default 'uploading' check(state in('uploading','committed','cancelled','conflict')),
  actor jsonb not null, original_actor jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create unique index quotation_one_pending_group on private.quotation_groups(quote_id) where state='uploading';
create table private.quotation_files (
  id uuid primary key, quote_id uuid not null references private.quotation_drafts(id),
  group_id uuid not null references private.quotation_groups(id),
  folder_mapping_id uuid not null references private.project_document_folders(id),
  name text not null, mime text not null check(mime in('application/pdf','image/jpeg','image/png','image/webp')),
  size bigint not null check(size between 5 and 20971520), sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
  state text not null default 'uploading' check(state in('uploading','validating','verified','failed','cleaning','trashed')),
  drive_file_id text, encrypted_session text, offset_bytes bigint not null default 0,
  lease uuid, lease_until timestamptz, expires_at timestamptz not null default now()+interval '24 hours',
  -- Future finalization must protect files transactionally before referencing them.
  retained boolean not null default false,
  created_at timestamptz not null default clock_timestamp()
);
create index quotation_files_quote on private.quotation_files(quote_id);
create index quotation_files_group on private.quotation_files(group_id);
create index quotation_files_folder on private.quotation_files(folder_mapping_id);
create table private.quotation_jobs (
  id uuid primary key default gen_random_uuid(), file_id uuid not null references private.quotation_files(id),
  kind text not null check(kind in('validate','cleanup')),
  state text not null default 'pending' check(state in('pending','running','failed','paused','complete')),
  actor jsonb not null, original_actor jsonb not null,
  checkpoint jsonb not null default '{}', lease uuid, lease_until timestamptz,
  dispatched_at timestamptz, attempts integer not null default 0, message text,
  unique(file_id,kind)
);
do $$ declare t text; begin
  foreach t in array array['quotation_drafts','quotation_operations','quotation_groups','quotation_files','quotation_jobs'] loop
    execute format('alter table private.%I enable row level security',t);
    execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
  end loop;
end $$;
-- File-group operations use separate versions. Provider bytes never enter SQL.
create function private.quotation_job_allowed(actor jsonb,target uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles p join auth.users u on u.id=p.user_id
    join public.role_grants g on g.user_id=p.user_id and g.role='Procurement'
    where p.user_id=(actor->>'userId')::uuid and p.is_active and p.access_revision::text=actor->>'revision'
      and actor->>'activeRole'='Procurement' and not u.is_anonymous and u.email_confirmed_at is not null
      and (u.banned_until is null or u.banned_until<=now()))
    and exists(select 1 from private.quotation_drafts q where q.id=target and private.mrf_ready(q.request_id));
$$;
create function private.quotation_enqueue(file uuid,kind text,actor jsonb) returns void
language sql security definer set search_path='' as $$
  insert into private.quotation_jobs(file_id,kind,actor,original_actor) values(file,kind,actor,actor) on conflict(file_id,kind) do nothing;
$$;
create function private.quotation_commit_group(target uuid) returns void
language plpgsql security definer set search_path='' as $$
declare g private.quotation_groups; q private.quotation_drafts; previous uuid[]; old_file uuid;
begin
  select * into g from private.quotation_groups where id=target for update;
  if g.state<>'uploading' or not private.quotation_job_allowed(g.actor,g.quote_id) then return; end if;
  select * into q from private.quotation_drafts where id=g.quote_id for update;
  if q.state<>'draft' then return; end if;
  if q.file_version<>g.expected_version then update private.quotation_groups set state='conflict' where id=target; return; end if;
  if exists(select 1 from unnest(g.files) fid where not exists(select 1 from private.quotation_files f where f.id=fid and f.quote_id=q.id and f.state='verified')) then return; end if;
  previous:=q.current_files;
  if previous=g.files then
    update private.quotation_groups set state='committed' where id=target;
    return;
  end if;
  update private.quotation_drafts set current_files=g.files,file_version=file_version+1 where id=q.id;
  update private.quotation_groups set state='committed' where id=target;
  perform private.quotation_audit(g.actor,'quotation.files',q.id,target,jsonb_build_object('before',previous,'after',g.files,'originalActor',g.original_actor));
  foreach old_file in array previous loop
    if not old_file=any(g.files) then perform private.quotation_enqueue(old_file,'cleanup',g.actor); end if;
  end loop;
end $$;
create function private.quotation_files_command(actor jsonb,command jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
<<files>>
declare caller uuid; operation uuid:=(command->>'requestId')::uuid; kind text:=command->>'type';
  q private.quotation_drafts; g private.quotation_groups; receipt private.quotation_operations;
  target uuid:=(command->>'quoteId')::uuid; group_id uuid; file_id uuid; item jsonb; ids uuid[]:='{}';
  total bigint:=0; n integer:=0; mapping uuid; result jsonb; snapshot jsonb; job private.quotation_jobs;
begin
  perform set_config('lock_timeout','5s',true); update private.account_guard set revision=revision+1 where id;
  caller:=private.quotation_actor(actor,true);
  if operation is null or kind is null or kind not in('beginGroup','cancelGroup','retryJob') then raise exception 'Invalid original-file action' using errcode='23514'; end if;
  insert into private.quotation_operations(id,actor_id,payload) values(operation,caller,command) on conflict do nothing;
  select * into receipt from private.quotation_operations where id=operation for update;
  if receipt.actor_id<>caller or receipt.payload<>command then raise exception 'Retry identity reused' using errcode='P4503'; end if;
  if receipt.result is not null then return receipt.result; end if;
  q:=private.quotation_lock(target,kind<>'retryJob');
  snapshot:=private.document_actor_snapshot(actor);
  if kind='beginGroup' then
    if q.file_version::text is distinct from command->>'expectedFiles' then raise exception 'Originals changed; review again' using errcode='40001'; end if;
    if jsonb_typeof(command->'keep') is distinct from 'array' or jsonb_typeof(command->'uploads') is distinct from 'array' then raise exception 'Original group required' using errcode='23514'; end if;
    group_id:=gen_random_uuid();
    insert into private.quotation_groups(id,quote_id,expected_version,actor,original_actor) values(group_id,target,q.file_version,snapshot,snapshot);
    for item in select * from jsonb_array_elements(command->'keep') loop
      file_id:=(item#>>'{}')::uuid;
      if file_id is null or file_id=any(ids) or not file_id=any(q.current_files) then raise exception 'Choose current originals only' using errcode='23514'; end if;
      select size into total from private.quotation_files where id=file_id and state='verified';
      if not found then raise exception 'Original unavailable' using errcode='23514'; end if;
      ids:=array_append(ids,file_id);
    end loop;
    select coalesce(sum(size),0) into total from private.quotation_files where id=any(ids);
    if jsonb_array_length(command->'uploads')>0 then
      select f.id into mapping from private.project_document_folders f join public.material_requests r on r.project_id=f.project_id where r.id=q.request_id and f.current;
      if mapping is null then raise exception 'Set up the project document folder first' using errcode='P4201'; end if;
    end if;
    for item in select * from jsonb_array_elements(command->'uploads') loop
      if jsonb_typeof(item->'name') is distinct from 'string' or length(item->>'name') not between 1 and 240
        or jsonb_typeof(item->'mime') is distinct from 'string' or item->>'mime' not in('application/pdf','image/jpeg','image/png','image/webp')
        or jsonb_typeof(item->'size') is distinct from 'number' or item->>'size' !~ '^[0-9]+$'
        or (item->>'size')::bigint not between 5 and 20971520
        or jsonb_typeof(item->'sha256') is distinct from 'string' or item->>'sha256' !~ '^[a-f0-9]{64}$' then raise exception 'Invalid original file' using errcode='23514'; end if;
      file_id:=gen_random_uuid(); ids:=array_append(ids,file_id); total:=total+(item->>'size')::bigint;
      insert into private.quotation_files(id,quote_id,group_id,folder_mapping_id,name,mime,size,sha256)
        values(file_id,target,group_id,mapping,item->>'name',item->>'mime',(item->>'size')::bigint,item->>'sha256');
    end loop;
    if cardinality(ids)>12 or total>47185920 then raise exception 'Original group exceeds limits' using errcode='23514'; end if;
    update private.quotation_groups set files=ids where id=group_id;
    perform private.quotation_commit_group(group_id);
    result:=jsonb_build_object('groupId',group_id,'quoteId',target);
  elsif kind='cancelGroup' then
    group_id:=(command->>'groupId')::uuid;
    select * into g from private.quotation_groups where id=group_id and quote_id=target for update;
    if not found or g.state not in('uploading','conflict') then raise exception 'Group unavailable' using errcode='23514'; end if;
    update private.quotation_groups set state='cancelled' where id=group_id;
    for file_id in select id from private.quotation_files where quotation_files.group_id=files.group_id loop
      perform private.quotation_enqueue(file_id,'cleanup',snapshot);
    end loop;
    result:=jsonb_build_object('groupId',group_id,'quoteId',target);
  else
    select j.* into job from private.quotation_jobs j join private.quotation_files f on f.id=j.file_id where j.id=(command->>'jobId')::uuid and f.quote_id=target for update of j;
    if not found or job.state not in('failed','paused') then raise exception 'Choose a failed job' using errcode='23514'; end if;
    if job.kind='validate' and q.state<>'draft' then raise exception 'Reopen the draft first' using errcode='23514'; end if;
    update private.quotation_jobs set actor=snapshot,state='pending',lease=null,lease_until=null,dispatched_at=null,message=null where id=job.id;
    update private.quotation_groups set actor=snapshot where id=(select f.group_id from private.quotation_files f where f.id=job.file_id);
    result:=jsonb_build_object('quoteId',target,'jobId',job.id);
  end if;
  perform private.quotation_audit(actor,'quotation.'||kind,target,operation,jsonb_build_object('result',result));
  update private.quotation_operations set result=files.result where id=operation;
  perform private.quotation_notify(); return result;
end $$;
create function private.quotation_transfer(actor jsonb,file_id uuid,action text,lease_id uuid default null,patch jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
<<transfer>>
declare f private.quotation_files; q private.quotation_drafts; acquired uuid;
begin
  perform set_config('lock_timeout','5s',true); update private.account_guard set revision=revision+1 where id;
  perform private.quotation_actor(actor,true);
  select * into f from private.quotation_files where id=file_id;
  q:=private.quotation_lock(f.quote_id);
  select * into f from private.quotation_files where id=file_id for update;
  if not exists(select 1 from private.quotation_groups g where g.id=f.group_id and g.state='uploading') then raise exception 'Original group is no longer uploading' using errcode='40001'; end if;
  if f.state in('verified','validating') then return jsonb_build_object('complete',true,'offset',f.size); end if;
  if f.expires_at<now() then raise exception 'Upload expired; cancel group and start again' using errcode='P4202'; end if;
  if action='claim' then
    if f.lease_until>now() then raise exception 'Transfer in progress' using errcode='55P03'; end if;
    acquired:=gen_random_uuid(); update private.quotation_files set lease=acquired,lease_until=now()+interval '3 minutes' where id=file_id;
  else
    if f.lease is distinct from lease_id or f.lease_until<now() then raise exception 'Transfer lease changed' using errcode='40001'; end if;
    acquired:=f.lease;
    if action='checkpoint' then
      if patch ? 'offset' and ((patch->>'offset')::bigint<f.offset_bytes or (patch->>'offset')::bigint>f.size) then raise exception 'Invalid upload offset' using errcode='23514'; end if;
      update private.quotation_files set drive_file_id=coalesce(f.drive_file_id,patch->>'driveFileId'),
        encrypted_session=coalesce(patch->>'session',f.encrypted_session),offset_bytes=coalesce((patch->>'offset')::bigint,f.offset_bytes) where id=file_id;
    elsif action='finish' then
      if f.drive_file_id is null then raise exception 'Provider identity missing' using errcode='23514'; end if;
      update private.quotation_files set state='validating',offset_bytes=size where id=file_id;
      perform private.quotation_enqueue(file_id,'validate',(select g.actor from private.quotation_groups g where g.id=f.group_id));
    elsif action='release' then update private.quotation_files set lease=null,lease_until=null where id=file_id;
    else raise exception 'Invalid transfer action' using errcode='23514'; end if;
  end if;
  return (select to_jsonb(x)-'retained'||jsonb_build_object('lease',acquired,'folder',(select to_jsonb(m) from private.project_document_folders m where m.id=x.folder_mapping_id)) from private.quotation_files x where x.id=file_id);
end $$;
create function private.quotation_dispatch() returns jsonb language plpgsql security definer set search_path='' as $$
declare ids uuid[];
begin
  -- Reconcile abandoned candidate files, retaining current and protected files.
  insert into private.quotation_jobs(file_id,kind,actor,original_actor)
    select f.id,'cleanup',g.actor,g.original_actor from private.quotation_files f join private.quotation_groups g on g.id=f.group_id
    where g.state in('cancelled','conflict') and f.state not in('trashed','cleaning') and not f.retained
      and not exists(select 1 from private.quotation_drafts q where f.id=any(q.current_files)) on conflict(file_id,kind) do nothing;
  with candidates as (select id from private.quotation_jobs where state='pending' or state='running' and lease_until<now() order by id limit 20 for update skip locked),
  admitted as (update private.quotation_jobs j set dispatched_at=now() from candidates c where j.id=c.id and (j.dispatched_at is null or j.dispatched_at<now()-interval '2 minutes') returning j.id)
  select coalesce(array_agg(id),'{}') into ids from admitted;
  return to_jsonb(ids);
end $$;
create function private.quotation_worker(job_id uuid,action text,lease_id uuid default null,patch jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
<<worker>>
declare j private.quotation_jobs; f private.quotation_files; q private.quotation_drafts; g private.quotation_groups; acquired uuid; referenced boolean;
begin
  perform set_config('lock_timeout','5s',true); update private.account_guard set revision=revision+1 where id;
  select * into j from private.quotation_jobs where id=job_id;
  select * into f from private.quotation_files where id=j.file_id;
  if f.id is null then return null; end if;
  perform 1 from public.material_requests where id=(select request_id from private.quotation_drafts where id=f.quote_id) for update;
  select * into q from private.quotation_drafts where id=f.quote_id for update;
  select * into j from private.quotation_jobs where id=job_id for update;
  select * into f from private.quotation_files where id=j.file_id for update;
  select * into g from private.quotation_groups where id=f.group_id;
  if j.state='complete' then return null; end if;
  if not private.quotation_job_allowed(j.actor,q.id) then
    update private.quotation_jobs set state='paused',message='Current Procurement authority or approved MRF required',lease=null,lease_until=null where id=job_id; return null;
  end if;
  if j.kind='validate' and (q.state<>'draft' or g.state<>'uploading') then
    update private.quotation_jobs set state='paused',message='Draft or original group changed',lease=null,lease_until=null where id=job_id; return null;
  end if;
  referenced:=f.retained or f.id=any(q.current_files) or exists(select 1 from private.quotation_groups x where x.state='uploading' and f.id=any(x.files));
  if j.kind='cleanup' and referenced then update private.quotation_jobs set state='complete',message='File remains referenced' where id=job_id; return null; end if;
  if action='claim' then
    if j.state='running' and j.lease_until>now() then return null; end if;
    if j.state not in('pending','running') then return null; end if;
    if j.kind='cleanup' and f.lease_until>now() then update private.quotation_jobs set dispatched_at=null where id=job_id; return null; end if;
    acquired:=gen_random_uuid();
    update private.quotation_jobs set state='running',lease=acquired,lease_until=now()+interval '3 minutes',attempts=attempts+1,message=null where id=job_id;
    if j.kind='cleanup' then update private.quotation_files set state='cleaning' where id=f.id; end if;
  else
    if j.state<>'running' or j.lease is distinct from lease_id or j.lease_until<now() then return null; end if;
    acquired:=j.lease;
    if action='checkpoint' then
      update private.quotation_jobs set checkpoint=checkpoint||patch where id=job_id;
    elsif action='complete' then
      if j.kind='validate' then
        if j.checkpoint->>'verified' is distinct from 'true' then raise exception 'Original verification missing' using errcode='23514'; end if;
        update private.quotation_files set state='verified' where id=f.id;
        perform private.quotation_commit_group(f.group_id);
      else
        if j.checkpoint->>'trashed' is distinct from 'true' then raise exception 'Trash confirmation missing' using errcode='23514'; end if;
        update private.quotation_files set state='trashed' where id=f.id;
      end if;
      update private.quotation_jobs set state='complete',lease=null,lease_until=null where id=job_id;
      perform private.quotation_notify(); return null;
    elsif action='fail' then
      update private.quotation_jobs set state='failed',message=case when patch->>'invalid'='true' then 'Unreadable or mismatched original; cancel the group and choose a valid file' else 'File processing failed; retry when available' end,lease=null,lease_until=null where id=job_id;
      perform private.quotation_notify(); return null;
    else raise exception 'Invalid processing action' using errcode='23514'; end if;
  end if;
  return (select to_jsonb(x)||jsonb_build_object('lease',acquired,'file',to_jsonb(f),'folder',(select to_jsonb(m) from private.project_document_folders m where m.id=f.folder_mapping_id)) from private.quotation_jobs x where x.id=job_id);
end $$;
create function private.quotation_file(actor jsonb,file_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare f private.quotation_files;
begin
  perform private.quotation_actor(actor);
  select * into f from private.quotation_files where id=file_id and state='verified';
  if f.id is null or not exists(select 1 from private.quotation_drafts q where q.id=f.quote_id and f.id=any(q.current_files)) then raise exception 'Original unavailable' using errcode='42501'; end if;
  return jsonb_build_object('id',f.id,'fileId',f.drive_file_id,'name',f.name,'mime',f.mime,'size',f.size);
end $$;

create function private.quotation_actor(actor jsonb,writing boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare caller uuid;
begin
  caller:=private.project_actor(actor);
  if actor->>'activeRole'='Site Personnel' or (writing and actor->>'activeRole'<>'Procurement') then
    raise exception 'Quotation access denied' using errcode='42501'; end if;
  return caller;
end $$;
create function private.quotation_lock(target uuid,editing boolean default true) returns private.quotation_drafts
language plpgsql security definer set search_path='' as $$
declare q private.quotation_drafts; parent uuid;
begin
  select request_id into parent from private.quotation_drafts where id=target;
  perform 1 from public.material_requests where id=parent for update;
  select * into q from private.quotation_drafts where id=target for update;
  if not found then raise exception 'Quotation not found' using errcode='P4501'; end if;
  if not private.mrf_ready(q.request_id) or (editing and q.state<>'draft') then
    raise exception 'Current approved MRF and active draft required' using errcode='P4502'; end if;
  return q;
end $$;
create function private.quotation_decimal(value jsonb,mode text default 'signed') returns text
language plpgsql immutable set search_path='' as $$
declare v text;
begin
  if jsonb_typeof(value) is distinct from 'string' then raise exception 'Exact source text required' using errcode='23514'; end if;
  v:=btrim(value#>>'{}');
  if v='' then return v; end if;
  if length(v)>80 or v !~ '^-?[0-9]+(\.[0-9]+)?$' or (mode='quantity' and v::numeric<0)
    or (mode='factor' and v::numeric<=0) then raise exception 'Invalid source decimal' using errcode='23514'; end if;
  return v;
end $$;
create function private.quotation_body(value jsonb,parent uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb:='{}'; k text; row jsonb; item jsonb; rows jsonb; ids uuid[]; row_id uuid;
begin
  if jsonb_typeof(value) is distinct from 'object' or octet_length(value::text)>750000 then
    raise exception 'Invalid quotation data' using errcode='23514'; end if;
  foreach k in array array['supplierName','address','tin','contactName','email','phone','ref','date','validUntil','currency','paymentTerms','deliveryTerms','availability','leadDays','notes','taxStatus','priceBasis','financialNotes'] loop
    if jsonb_typeof(value->k) is distinct from 'string' or length(value->>k)>4000 then raise exception 'Invalid quotation text' using errcode='23514'; end if;
    result:=result||jsonb_build_object(k,btrim(value->>k));
  end loop;
  perform private.request_date(value->'date'); perform private.request_date(value->'validUntil');
  if value->>'leadDays'<>'' and value->>'leadDays' !~ '^[0-9]{1,6}$' then raise exception 'Invalid lead days' using errcode='23514'; end if;
  foreach k in array array['vatRate','printedSubtotal','printedTax','printedTotal'] loop
    result:=result||jsonb_build_object(k,private.quotation_decimal(value->k));
  end loop;
  if jsonb_typeof(value->'lines') is distinct from 'array' or jsonb_array_length(value->'lines')>1000
    or jsonb_typeof(value->'adjustments') is distinct from 'array' or jsonb_array_length(value->'adjustments')>100 then
    raise exception 'Invalid quotation rows' using errcode='23514'; end if;
  rows:='[]'; ids:='{}';
  for row in select * from jsonb_array_elements(value->'lines') loop
    row_id:=(row->>'id')::uuid;
    if row_id is null or row_id=any(ids) then raise exception 'Invalid line identity' using errcode='23514'; end if;
    ids:=array_append(ids,row_id); item:=jsonb_build_object('id',row_id);
    foreach k in array array['description','code','unit','brand','specification','varianceReason','discountType','taxLabel','discrepancyNote','leadTime','notes','sourcePage'] loop
      if jsonb_typeof(row->k) is distinct from 'string' or length(row->>k)>4000 then raise exception 'Invalid line text' using errcode='23514'; end if;
      item:=item||jsonb_build_object(k,btrim(row->>k));
    end loop;
    foreach k in array array['quantity','unitPrice','discountValue','taxRate','printedTotal','conversionFactor'] loop
      item:=item||jsonb_build_object(k,private.quotation_decimal(row->k,case k when 'quantity' then 'quantity' when 'conversionFactor' then 'factor' else 'signed' end));
    end loop;
    if not (row ? 'requestItemId') or not(row ? 'sourceFileId') then raise exception 'Line links required' using errcode='23514'; end if;
    if row->'requestItemId'<>'null'::jsonb and not exists(select 1 from public.material_request_items m where m.id=(row->>'requestItemId')::uuid and m.request_id=parent) then
      raise exception 'Material belongs to another MRF' using errcode='23514'; end if;
    perform (row->>'sourceFileId')::uuid;
    if row->>'sourcePage'<>'' and row->>'sourcePage' !~ '^[1-9][0-9]{0,5}$' then raise exception 'Invalid source page' using errcode='23514'; end if;
    item:=item||jsonb_build_object('requestItemId',row->'requestItemId','sourceFileId',row->'sourceFileId');
    rows:=rows||jsonb_build_array(item);
  end loop;
  result:=result||jsonb_build_object('lines',rows); rows:='[]'; ids:='{}';
  for row in select * from jsonb_array_elements(value->'adjustments') loop
    row_id:=(row->>'id')::uuid;
    if row_id is null or row_id=any(ids) then raise exception 'Invalid adjustment identity' using errcode='23514'; end if;
    ids:=array_append(ids,row_id); item:=jsonb_build_object('id',row_id,'value',private.quotation_decimal(row->'value'));
    foreach k in array array['label','kind','basis','taxable','sourceDetails'] loop
      if jsonb_typeof(row->k) is distinct from 'string' or length(row->>k)>4000 then raise exception 'Invalid adjustment source' using errcode='23514'; end if;
      item:=item||jsonb_build_object(k,btrim(row->>k));
    end loop;
    rows:=rows||jsonb_build_array(item);
  end loop;
  return result||jsonb_build_object('adjustments',rows);
end $$;

create function private.quotation_notify() returns void language plpgsql security definer set search_path='' as $$
declare recipient record;
begin
  perform s.id from auth.sessions s join private.session_bindings b on b.session_id=s.id order by s.id for share of s;
  for recipient in select b.* from private.session_bindings b
    join auth.sessions s on s.id=b.session_id and s.user_id=b.user_id
    join public.profiles p on p.user_id=b.user_id join auth.users u on u.id=p.user_id
    where p.is_active and p.access_revision=b.access_revision and (s.not_after is null or s.not_after>now())
      and not u.is_anonymous and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now())
      and exists(select 1 from public.role_grants g where g.user_id=p.user_id and g.role<>'Site Personnel')
  loop perform realtime.send('{}','foundation_changed',private.foundation_topic(recipient.user_id,recipient.access_revision,recipient.session_id),true); end loop;
end $$;
create function private.quotation_audit(actor jsonb,kind text,target uuid,operation uuid,details jsonb) returns void
language sql security definer set search_path='' as $$
  insert into private.audit_events(actor_user_id,actor_name,actor_role,action,entity_type,entity_id,request_id,details)
    select p.user_id,p.display_name,actor->>'activeRole',kind,'quotation',target,operation,details from public.profiles p where p.user_id=(actor->>'userId')::uuid;
$$;
create function private.quotation_ready_files(q private.quotation_drafts) returns boolean
language sql stable set search_path='' as $$
  select cardinality(q.current_files)>0 and not exists(select 1 from private.quotation_groups g where g.quote_id=q.id and g.state='uploading')
    and not exists(select 1 from unnest(q.current_files) as selected(file_id) where not exists(select 1 from private.quotation_files f where f.id=selected.file_id and f.state='verified'));
$$;
create function private.quotation_view(target uuid) returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',q.id,'mrfId',q.request_id,'supplierId',q.supplier_id,'body',q.body,'state',q.state,
    'version',q.version::text,'fileVersion',q.file_version::text,'creatorName',q.creator_name,'createdAt',q.created_at,
    'checked',q.checked->>'contentVersion'=q.content_version::text and q.checked->>'fileVersion'=q.file_version::text and private.quotation_ready_files(q),
    'matches',coalesce((select jsonb_agg(l->>'id') from jsonb_array_elements(q.body->'lines') l where q.matches->(l->>'id')->'line'=l and q.matches->(l->>'id')->>'fileVersion'=q.file_version::text),'[]'),
    'files',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'mime',f.mime,'size',f.size,'sha256',f.sha256)) from private.quotation_files f where f.id=any(q.current_files)),'[]'),
    'groups',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'state',g.state,'files',g.files,
      'uploads',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'mime',f.mime,'size',f.size,'sha256',f.sha256,'state',f.state,'offset',f.offset_bytes,'expiresAt',f.expires_at)) from private.quotation_files f where f.group_id=g.id),'[]')))
      from private.quotation_groups g where g.quote_id=q.id and g.state in('uploading','conflict')),'[]'),
    'jobs',coalesce((select jsonb_agg(jsonb_build_object('id',j.id,'kind',j.kind,'state',j.state,'message',j.message)) from private.quotation_jobs j join private.quotation_files f on f.id=j.file_id where f.quote_id=q.id and j.state<>'complete'),'[]'))
  from private.quotation_drafts q where q.id=target;
$$;
create function private.quotations_read(actor jsonb,target_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform private.quotation_actor(actor);
  return jsonb_build_object('request',private.request_snapshot(target_request),
    'suppliers',coalesce((select jsonb_agg(private.supplier_view(s.id) order by s.name_key) from private.suppliers s where s.is_active),'[]'),
    'quotes',coalesce((select jsonb_agg(private.quotation_view(q.id) order by q.created_at,q.id) from private.quotation_drafts q where q.request_id=target_request),'[]'),
    'history',coalesce((select jsonb_agg(h.entry order by h.occurred_at desc,h.id) from (
      select a.id,a.occurred_at,jsonb_build_object('id',a.id,'actorName',a.actor_name,'actorRole',a.actor_role,'action',a.action,'at',a.occurred_at,'quoteId',a.entity_id,'details',a.details) entry
      from private.audit_events a join private.quotation_drafts q on q.id=a.entity_id where a.entity_type='quotation' and q.request_id=target_request order by a.occurred_at desc,a.id limit 30) h),'[]'));
end $$;
create function private.quotation_command(actor jsonb,command jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
<<cmd>>
declare caller uuid; operation uuid:=(command->>'requestId')::uuid; kind text:=command->>'type';
  target uuid:=(command->>'quoteId')::uuid; receipt private.quotation_operations;
  q private.quotation_drafts; before_value jsonb; body jsonb; result jsonb; changed boolean:=false; line jsonb; reason text; next_state text;
begin
  perform set_config('lock_timeout','5s',true); update private.account_guard set revision=revision+1 where id;
  caller:=private.quotation_actor(actor,true);
  if operation is null or kind is null or kind not in('create','save','status','checkSource','confirmMatch') then raise exception 'Invalid quotation command' using errcode='23514'; end if;
  insert into private.quotation_operations(id,actor_id,payload) values(operation,caller,command) on conflict do nothing;
  select * into receipt from private.quotation_operations where id=operation for update;
  if receipt.actor_id<>caller or receipt.payload<>command then raise exception 'Retry identity reused' using errcode='P4503'; end if;
  if receipt.result is not null then return receipt.result; end if;
  if kind='create' then
    target:=gen_random_uuid();
    perform private.mrf_register_downstream((command->>'mrfId')::uuid,'quotation',target);
    perform 1 from private.suppliers where id=(command->>'supplierId')::uuid and is_active for share;
    if not found then raise exception 'Choose an active supplier' using errcode='23514'; end if;
    body:=private.quotation_body(command->'body',(command->>'mrfId')::uuid);
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
      if exists(select 1 from jsonb_array_elements(body->'lines') l where l->'sourceFileId'<>'null' and not (l->>'sourceFileId')::uuid=any(q.current_files)) then
        raise exception 'Choose a current quotation source file' using errcode='23514'; end if;
      update private.quotation_drafts set body=cmd.body,version=version+1,content_version=content_version+1 where id=target and quotation_drafts.body is distinct from cmd.body;
      changed:=found;
    elsif kind='status' then
      reason:=btrim(command->>'reason'); next_state:=command->>'state';
      if reason is null or length(reason) not between 5 and 2000 or next_state is null or next_state not in('draft','cancelled') then raise exception 'Status and reason required' using errcode='23514'; end if;
      update private.quotation_drafts set state=next_state,version=version+1 where id=target and state<>next_state; changed:=found;
      if changed and next_state='cancelled' then update private.quotation_groups set state='cancelled' where quote_id=target and state in('uploading','conflict'); end if;
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

create function public.quotations_read(actor jsonb,target_request uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.quotations_read(actor,target_request); $$;

create function public.quotation_command(actor jsonb,command jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.quotation_command(actor,command); $$;

create function public.quotation_files_command(actor jsonb,command jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.quotation_files_command(actor,command); $$;

create function public.quotation_transfer(actor jsonb,file_id uuid,action text,lease_id uuid default null,patch jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$ select private.quotation_transfer(actor,file_id,action,lease_id,patch); $$;

create function public.quotation_worker(job_id uuid,action text,lease_id uuid default null,patch jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$ select private.quotation_worker(job_id,action,lease_id,patch); $$;

create function public.quotation_dispatch() returns jsonb language sql security invoker set search_path='' as $$ select private.quotation_dispatch(); $$;

create function public.quotation_file(actor jsonb,file_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.quotation_file(actor,file_id); $$;

do $$ declare f record; begin
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('private','public') and p.proname like 'quotation%' loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  end loop;
end $$;
grant execute on function private.quotations_read(jsonb,uuid),public.quotations_read(jsonb,uuid),private.quotation_command(jsonb,jsonb),public.quotation_command(jsonb,jsonb),
  private.quotation_files_command(jsonb,jsonb),public.quotation_files_command(jsonb,jsonb),private.quotation_transfer(jsonb,uuid,text,uuid,jsonb),public.quotation_transfer(jsonb,uuid,text,uuid,jsonb),
  private.quotation_worker(uuid,text,uuid,jsonb),public.quotation_worker(uuid,text,uuid,jsonb),private.quotation_dispatch(),public.quotation_dispatch(),private.quotation_file(jsonb,uuid),public.quotation_file(jsonb,uuid) to service_role;

-- Shared drafts. Only checked server RPCs may mutate these records.
alter table public.scopes add constraint scopes_id_project_key unique(id,project_id);
create table public.material_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete restrict,
  scope_id uuid,
  foreign key(scope_id,project_id) references public.scopes(id,project_id) on delete restrict,
  ref text not null unique,
  sequence bigint not null check(sequence>0),
  data jsonb not null check(jsonb_typeof(data)='object'),
  version bigint not null default 1 check(version>0),
  creator_id uuid not null references public.profiles(user_id) on delete restrict,
  creator_name text not null,
  updater_id uuid not null references public.profiles(user_id) on delete restrict,
  updater_name text not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(project_id,sequence)
);
create index material_requests_scope_idx on public.material_requests(scope_id,project_id);
create table public.material_request_items (
  id uuid primary key,
  request_id uuid not null references public.material_requests(id) on delete restrict,
  position integer not null check(position>=0),
  data jsonb not null check(jsonb_typeof(data)='object'),
  unique(request_id,position) deferrable initially deferred
);
create table private.document_counters (
  project_id uuid not null references public.projects(id) on delete restrict,
  series text not null check(series='MRF'),
  last_value bigint not null check(last_value>0),
  primary key(project_id,series)
);
create table private.request_operations (
  id uuid primary key,
  actor_id uuid not null references public.profiles(user_id) on delete restrict,
  request_id uuid not null,
  payload jsonb not null,
  result jsonb,
  created_at timestamptz not null default clock_timestamp()
);
create index request_operations_actor_idx on private.request_operations(actor_id);
create index request_operations_request_idx on private.request_operations(request_id);
alter table public.material_requests enable row level security;
alter table public.material_request_items enable row level security;
alter table private.document_counters enable row level security;
alter table private.request_operations enable row level security;
revoke all on public.material_requests,public.material_request_items,private.document_counters,private.request_operations from public,anon,authenticated,service_role;
grant select on public.material_requests,public.material_request_items to authenticated;
create policy requests_read on public.material_requests for select to authenticated using(private.can_read_project(project_id));
create policy request_items_read on public.material_request_items for select to authenticated using(exists(select 1 from public.material_requests r where r.id=request_id));

create function private.protect_request() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception 'MRF deletion is unavailable' using errcode='23514'; end if;
  if row(new.id,new.project_id,new.ref,new.sequence,new.creator_id,new.creator_name,new.created_at)
    is distinct from row(old.id,old.project_id,old.ref,old.sequence,old.creator_id,old.creator_name,old.created_at) then
    raise exception 'MRF ownership, numbering and creator are immutable' using errcode='23514';
  end if;
  new.version:=old.version+1; new.updated_at:=clock_timestamp(); return new;
end;
$$;
create trigger protect_request before update or delete on public.material_requests for each row execute function private.protect_request();

create function private.request_date(value jsonb) returns text language plpgsql immutable set search_path='' as $$
declare result text;
begin
  if jsonb_typeof(value) is distinct from 'string' then raise exception 'Invalid draft date' using errcode='23514'; end if;
  result:=value#>>'{}';
  if result<>'' and (result !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or to_char(result::date,'YYYY-MM-DD')<>result) then
    raise exception 'Invalid draft date' using errcode='23514'; end if;
  return result;
exception when invalid_datetime_format or datetime_field_overflow then raise exception 'Invalid draft date' using errcode='23514';
end;
$$;
create function private.request_draft(value jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare result jsonb; item jsonb; normalized jsonb; items jsonb:='[]'; key text; quantity text; ids uuid[]:='{}'; item_id uuid;
begin
  if jsonb_typeof(value) is distinct from 'object' or octet_length(value::text)>750000
    or jsonb_typeof(value->'items') is distinct from 'array'
    or not (value ? 'scopeId') or (value->'scopeId'<>'null' and jsonb_typeof(value->'scopeId') is distinct from 'string') then
    raise exception 'Invalid draft' using errcode='23514'; end if;
  perform (value->>'scopeId')::uuid;
  result:=jsonb_build_object('scopeId',value->'scopeId','requestDate',private.request_date(value->'requestDate'));
  foreach key in array array['sourceRef','requestedBy','approvedBy','purchaser','financeOfficer','specialInstructions'] loop
    if jsonb_typeof(value->key) is distinct from 'string' or length(value->>key)>4000 then raise exception 'Invalid draft text' using errcode='23514'; end if;
    result:=result||jsonb_build_object(key,btrim(value->>key));
  end loop;
  for item in select * from jsonb_array_elements(value->'items') loop
    item_id:=(item->>'id')::uuid;
    if item_id is null or item_id=any(ids) then raise exception 'Invalid material identity' using errcode='23514'; end if;
    ids:=array_append(ids,item_id);
    normalized:=jsonb_build_object('id',item_id,'neededDate',private.request_date(item->'neededDate'));
    if item->'quantity'='null'::jsonb then normalized:=normalized||'{"quantity":null}'::jsonb;
    else
      quantity:=item->>'quantity';
      if jsonb_typeof(item->'quantity') is distinct from 'string' or length(quantity)>80 or quantity !~ '^[0-9]+(\.[0-9]+)?$' or quantity::numeric<=0 then
        raise exception 'Supplied quantities must be positive decimal values' using errcode='23514'; end if;
      normalized:=normalized||jsonb_build_object('quantity',trim_scale(quantity::numeric)::text);
    end if;
    foreach key in array array['name','unit','purpose','location','remarks'] loop
      if jsonb_typeof(item->key) is distinct from 'string' or length(item->>key)>4000 then raise exception 'Invalid material text' using errcode='23514'; end if;
      normalized:=normalized||jsonb_build_object(key,btrim(item->>key));
    end loop;
    items:=items||jsonb_build_array(normalized);
  end loop;
  return result||jsonb_build_object('items',items);
end;
$$;
create function private.request_snapshot(target uuid) returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',r.id,'projectId',r.project_id,'ref',r.ref,'version',r.version::text,
    'creatorId',r.creator_id,'creatorName',r.creator_name,'updaterId',r.updater_id,'updaterName',r.updater_name,'createdAt',r.created_at,'updatedAt',r.updated_at,
    'draft',r.data||jsonb_build_object('scopeId',r.scope_id,'items',coalesce((select jsonb_agg(i.data||jsonb_build_object('id',i.id) order by i.position) from public.material_request_items i where i.request_id=r.id),'[]'::jsonb)))
  from public.material_requests r where r.id=target;
$$;
create function private.request_project_allowed(actor jsonb,target uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.projects p where p.id=target) and
    (actor->>'activeRole'<>'Site Personnel' or exists(select 1 from public.project_assignments a where a.user_id=(actor->>'userId')::uuid and a.project_id=target));
$$;
create function private.requests_read(actor jsonb,target_request uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform private.project_actor(actor,false);
  return jsonb_build_object('role',actor->>'activeRole',
    'requests',coalesce((select jsonb_agg(private.request_snapshot(r.id) order by r.updated_at desc,r.id) from public.material_requests r
      where (target_request is null or r.id=target_request) and private.request_project_allowed(actor,r.project_id)),'[]'::jsonb),
    'projects',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'code',p.document_code,'scopes',
      coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name) order by s.name) from public.scopes s where s.project_id=p.id),'[]'::jsonb)) order by p.name)
      from public.projects p where private.request_project_allowed(actor,p.id)),'[]'::jsonb));
end;
$$;

create function private.request_command(actor jsonb,command jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare caller uuid; operation uuid:=(command->>'requestId')::uuid; kind text:=command->>'type'; target uuid; project_id uuid; project public.projects;
  receipt private.request_operations; previous public.material_requests; draft jsonb; before_value jsonb; saved jsonb; result jsonb; number bigint; actor_name text; item jsonb; position integer:=0;
begin
  caller:=private.project_actor(actor,false);
  if actor->>'activeRole'<>'Site Personnel' then raise exception 'Assigned Site Personnel required' using errcode='42501'; end if;
  if operation is null or kind is null or kind not in('createDraft','saveDraft') then raise exception 'Invalid draft command' using errcode='23514'; end if;
  draft:=private.request_draft(command->'draft');
  target:=case when kind='createDraft' then gen_random_uuid() else (command->>'mrfId')::uuid end;
  if target is null then raise exception 'MRF identity required' using errcode='23514'; end if;
  insert into private.request_operations(id,actor_id,request_id,payload) values(operation,caller,target,command) on conflict do nothing;
  select * into receipt from private.request_operations o where o.id=operation for update;
  if receipt.actor_id<>caller or receipt.payload<>command then raise exception 'Request identity reused' using errcode='P3406'; end if;
  target:=receipt.request_id;
  if kind='createDraft' then project_id:=(command->>'projectId')::uuid;
  else select r.project_id into project_id from public.material_requests r where r.id=target; end if;
  select * into project from public.projects p where p.id=project_id for update;
  if not found or not private.request_project_allowed(actor,project_id) then raise exception 'Current project access required' using errcode='42501'; end if;
  if receipt.result is not null then return receipt.result; end if;
  if project.document_code is null then raise exception 'Configure the project document code first' using errcode='23514'; end if;
  if draft->>'scopeId' is not null then
    perform 1 from public.scopes s where s.id=(draft->>'scopeId')::uuid and s.project_id=request_command.project_id for update;
    if not found then raise exception 'Scope must belong to the project' using errcode='23514'; end if;
  end if;
  select p.display_name into actor_name from public.profiles p where p.user_id=caller;
  if kind='saveDraft' then
    select * into previous from public.material_requests r where r.id=target for update;
    if command->>'expectedVersion' is null or previous.version::text<>command->>'expectedVersion' then raise exception 'MRF changed; review latest' using errcode='40001'; end if;
    before_value:=private.request_snapshot(target);
    if before_value->'draft'=draft then
      result:=jsonb_build_object('record',before_value,'projectId',project_id,'changed',false);
      update private.request_operations set result=request_command.result where id=operation;
      return result;
    end if;
    update public.material_requests set scope_id=(draft->>'scopeId')::uuid,data=draft-'scopeId'-'items',updater_id=caller,updater_name=actor_name where id=target;
  else
    insert into private.document_counters(project_id,series,last_value) values(project_id,'MRF',1)
      on conflict on constraint document_counters_pkey do update set last_value=private.document_counters.last_value+1 returning last_value into number;
    insert into public.material_requests(id,project_id,scope_id,ref,sequence,data,creator_id,creator_name,updater_id,updater_name)
      values(target,project_id,(draft->>'scopeId')::uuid,project.document_code||'-MRF-'||lpad(number::text,greatest(4,length(number::text)),'0'),number,draft-'scopeId'-'items',caller,actor_name,caller,actor_name);
    update public.projects set code_locked_at=clock_timestamp() where id=project_id and code_locked_at is null;
  end if;
  delete from public.material_request_items where request_id=target and id not in(select (v->>'id')::uuid from jsonb_array_elements(draft->'items') v);
  for item in select * from jsonb_array_elements(draft->'items') loop
    if exists(select 1 from public.material_request_items i where i.id=(item->>'id')::uuid and i.request_id<>target) then raise exception 'Material belongs to another MRF' using errcode='23514'; end if;
    insert into public.material_request_items(id,request_id,position,data) values((item->>'id')::uuid,target,position,item-'id')
      on conflict(id) do update set position=excluded.position,data=excluded.data;
    position:=position+1;
  end loop;
  saved:=private.request_snapshot(target);
  insert into private.audit_events(actor_user_id,actor_name,actor_role,action,entity_type,entity_id,request_id,details)
    values(caller,actor_name,'Site Personnel',case when kind='createDraft' then 'mrf.created' else 'mrf.draft_saved' end,'mrf',target,operation,
      jsonb_build_object('projectId',project_id,'before',before_value,'after',saved));
  result:=jsonb_build_object('record',saved,'projectId',project_id,'changed',true);
  update private.request_operations set result=request_command.result where id=operation;
  return result;
end;
$$;

revoke all on function private.protect_request(),private.request_date(jsonb),private.request_draft(jsonb),private.request_snapshot(uuid),private.request_project_allowed(jsonb,uuid),private.requests_read(jsonb,uuid),private.request_command(jsonb,jsonb) from public,anon,authenticated,service_role;
create function public.requests_read(actor jsonb,target_request uuid default null) returns jsonb language sql security definer set search_path='' as $$ select private.requests_read(actor,target_request); $$;
create function public.request_command(actor jsonb,command jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.foundation_write('request',jsonb_build_object('actor',actor,'command',command)); $$;
revoke all on function public.requests_read(jsonb,uuid),public.request_command(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.requests_read(jsonb,uuid),public.request_command(jsonb,jsonb) to service_role;
create or replace function private.foundation_write(kind text, args jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  result jsonb; before_value jsonb; after_value jsonb; old_bindings jsonb;
  operation uuid:=(args->>'operation')::uuid;
  target uuid:=(args->>'target')::uuid;
  affected_project uuid; changed boolean:=false; recipient record; prior jsonb;
begin
  perform set_config('lock_timeout','5s',true);
  -- A real write also rejects stale REPEATABLE READ snapshots.
  update private.account_guard set revision=revision+1 where id;
  select coalesce(jsonb_agg(to_jsonb(b)),'[]'::jsonb) into old_bindings
    from private.session_bindings b join public.profiles p on p.user_id=b.user_id
    join auth.sessions s on s.id=b.session_id and s.user_id=b.user_id
    where p.is_active and p.access_revision=b.access_revision and (s.not_after is null or s.not_after>now());
  if kind='project' then
    operation:=(args->'command'->>'requestId')::uuid;
    select to_jsonb(o) into before_value from private.project_operations o where o.id=operation;
    result:=private.project_command(args->'actor',args->'command');
    affected_project:=(result->>'projectId')::uuid;
    changed:=before_value is null and coalesce((result->>'changed')::boolean,false);
  elsif kind='request' then
    operation:=(args->'command'->>'requestId')::uuid;
    select to_jsonb(o) into before_value from private.request_operations o where o.id=operation;
    result:=private.request_command(args->'actor',args->'command');
    affected_project:=(result->>'projectId')::uuid;
    changed:=before_value is null and coalesce((result->>'changed')::boolean,false);
  elsif kind in('reserve','complete','save','message') then
    if kind='save' then
      before_value:=private.account_view(target);
    else
      select to_jsonb(o) into before_value from private.account_operations o where o.id=operation;
    end if;
    case kind
      when 'reserve' then result:=private.account_reserve(args->'actor',operation,args->'draft');
      when 'complete' then result:=private.account_complete(args->'actor',operation);
      when 'save' then result:=private.account_save(args->'actor',operation,target,args->>'expected_version',args->'draft');
      when 'message' then result:=private.account_message(args->'actor',operation,target,args->>'expected_version',args->>'message_kind',args->>'outcome');
    end case;
    if kind='save' then
      after_value:=private.account_view(target);
    else
      select to_jsonb(o),o.target_id into after_value,target from private.account_operations o where o.id=operation;
    end if;
    changed:=before_value is distinct from after_value;
  elsif kind='bind' then
    target:=(args->>'target_user')::uuid;
    select to_jsonb(p.first_signed_in_at) into before_value from public.profiles p where p.user_id=target;
    result:=to_jsonb(private.bind_session(target,(args->>'target_session')::uuid,args->>'expected_revision',args->>'expected_credential'));
    select to_jsonb(p.first_signed_in_at) into after_value from public.profiles p where p.user_id=target;
    changed:=before_value is distinct from after_value;
  elsif kind='unbind' then
    perform private.unbind_session((args->>'target_user')::uuid,(args->>'target_session')::uuid);
    result:='null'::jsonb;
  else
    raise exception 'Unsupported foundation write' using errcode='23514';
  end if;
  -- Enqueue last. Native Auth reset/logout never acquires the foundation guard.
  -- SHARE orders publication before native session DELETE, or rechecks after it.
  -- No further Auth/profile/project locks may be acquired after this point.
  perform s.id from auth.sessions s join private.session_bindings b on b.session_id=s.id
    order by s.id for share of s;
  for prior in select value from jsonb_array_elements(old_bindings) loop
    if not exists(select 1 from private.session_bindings b join public.profiles p on p.user_id=b.user_id
      where b.session_id=(prior->>'session_id')::uuid and b.access_revision=(prior->>'access_revision')::bigint
        and p.is_active and p.access_revision=b.access_revision) then
      perform realtime.send('{}'::jsonb,'access_changed',
        private.foundation_topic((prior->>'user_id')::uuid,(prior->>'access_revision')::bigint,(prior->>'session_id')::uuid),true);
    end if;
  end loop;
  if changed then
    for recipient in
      select b.* from private.session_bindings b
      join auth.sessions s on s.id=b.session_id and s.user_id=b.user_id
      join public.profiles p on p.user_id=b.user_id
      join auth.users u on u.id=p.user_id
      where p.is_active and p.access_revision=b.access_revision
        and (s.not_after is null or s.not_after>now())
        and not u.is_anonymous and u.email_confirmed_at is not null
        and (u.banned_until is null or u.banned_until<=now())
        and (
          (kind in('project','request') and (
            exists(select 1 from public.role_grants g where g.user_id=p.user_id and g.role<>'Site Personnel')
            or exists(select 1 from public.project_assignments a where a.user_id=p.user_id and a.project_id=affected_project)))
          or (kind not in('project','request') and (
            p.user_id=target
            or exists(select 1 from public.role_grants g where g.user_id=p.user_id and g.role='Administrator')
            or (kind='save' and before_value->'projectIds' is distinct from after_value->'projectIds'
              and exists(select 1 from public.role_grants g where g.user_id=p.user_id and g.role='Project Manager'))))
        )
    loop
      perform realtime.send('{}'::jsonb,'foundation_changed',
        private.foundation_topic(recipient.user_id,recipient.access_revision,recipient.session_id),true);
    end loop;
  end if;
  return result;
end;
$$;


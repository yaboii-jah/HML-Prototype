-- Account commands are service-only. Every transaction rechecks the verified
-- session context and serializes account decisions, including at REPEATABLE READ.
alter table public.profiles add column first_signed_in_at timestamptz;
update public.profiles p set first_signed_in_at = b.first_bound
from (select user_id, min(bound_at) first_bound from private.session_bindings group by user_id) b
where p.user_id = b.user_id;

create table private.account_guard (id boolean primary key default true check (id), revision bigint not null default 0);
insert into private.account_guard default values;
create table private.account_operations (
  id uuid primary key,
  actor_id uuid not null references public.profiles(user_id) on delete restrict,
  kind text not null check (kind in ('provision', 'change', 'message')),
  target_id uuid not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  state text not null check (state in ('reserved', 'complete', 'sending', 'accepted', 'failed', 'uncertain')),
  result jsonb,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create index account_operations_target_time_idx on private.account_operations(target_id, created_at desc);
alter table private.account_guard enable row level security;
alter table private.account_operations enable row level security;
revoke all on private.account_guard, private.account_operations from public, anon, authenticated, service_role;

create or replace function private.login_preflight(login_email text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('userId', p.user_id, 'revision', p.access_revision::text,
    'credential', encode(sha256(convert_to(u.encrypted_password, 'UTF8')), 'hex'))
  from public.profiles p join auth.users u on u.id = p.user_id
  where lower(u.email) = lower(btrim(login_email)) and p.is_active
    and not u.is_anonymous and u.email_confirmed_at is not null
    and (u.banned_until is null or u.banned_until <= now())
    and exists (select 1 from public.role_grants g where g.user_id = p.user_id);
$$;

drop function public.auth_bind_session(uuid,uuid,text);
drop function private.bind_session(uuid,uuid,text);
create function private.bind_session(target_user uuid, target_session uuid, expected_revision text, expected_credential text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare current_revision bigint; current_credential text;
begin
  -- SHARE conflicts with a native password UPDATE; KEY SHARE does not.
  -- Always take the Auth lock before the application profile lock.
  select encode(sha256(convert_to(u.encrypted_password, 'UTF8')), 'hex') into current_credential
    from auth.users u where u.id = target_user and not u.is_anonymous
      and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until <= now()) for share;
  if expected_credential is null or current_credential is distinct from expected_credential then return false; end if;
  select p.access_revision into current_revision from public.profiles p
    where p.user_id = target_user and p.is_active for update;
  if expected_revision is null or current_revision is null or current_revision::text <> expected_revision
    or not exists (select 1 from public.role_grants g where g.user_id = target_user)
    or not exists (select 1 from auth.sessions s where s.id = target_session and s.user_id = target_user
      and (s.not_after is null or s.not_after > now())) then return false; end if;
  insert into private.session_bindings(session_id, user_id, access_revision)
    values (target_session, target_user, current_revision) on conflict do nothing;
  if not exists (select 1 from private.session_bindings b where b.session_id = target_session
    and b.user_id = target_user and b.access_revision = current_revision) then return false; end if;
  update public.profiles set first_signed_in_at = clock_timestamp()
    where user_id = target_user and first_signed_in_at is null;
  return true;
end;
$$;
create function public.auth_bind_session(target_user uuid, target_session uuid, expected_revision text, expected_credential text) returns boolean
language sql security invoker set search_path = '' as $$
  select private.bind_session(target_user,target_session,expected_revision,expected_credential);
$$;
revoke all on function private.bind_session(uuid,uuid,text,text), public.auth_bind_session(uuid,uuid,text,text)
  from public, anon, authenticated, service_role;
grant execute on function private.bind_session(uuid,uuid,text,text), public.auth_bind_session(uuid,uuid,text,text) to service_role;

create function private.account_actor(actor jsonb, writing boolean default true) returns uuid
language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := (actor->>'userId')::uuid;
begin
  perform set_config('lock_timeout','5s',true);
  if writing then update private.account_guard set revision = revision + 1 where id; end if;
  perform 1 from auth.users u where u.id = actor_id and not u.is_anonymous
    and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until <= now()) for share;
  if not found then raise exception 'Administrator access required' using errcode = '42501'; end if;
  perform 1 from public.profiles p where p.user_id = actor_id for update;
  if actor->>'activeRole' is distinct from 'Administrator' or not exists (
    select 1 from public.profiles p join private.session_bindings b on b.user_id = p.user_id
      join auth.sessions s on s.id = b.session_id and s.user_id = p.user_id
    where p.user_id = actor_id and p.is_active and b.session_id = (actor->>'sessionId')::uuid
      and p.access_revision = b.access_revision and p.access_revision::text = actor->>'revision'
      and (s.not_after is null or s.not_after > now())
      and exists(select 1 from public.role_grants g where g.user_id = actor_id and g.role = 'Administrator')
  ) then raise exception 'Administrator access required' using errcode = '42501'; end if;
  return actor_id;
end;
$$;

create function private.account_view(target uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id',p.user_id,'name',p.display_name,'email',u.email,'active',p.is_active,
    'version',p.version::text,'firstSignedInAt',p.first_signed_in_at,'confirmed',u.email_confirmed_at is not null,
    'roles',coalesce((select jsonb_agg(g.role order by g.role) from public.role_grants g where g.user_id=p.user_id),'[]'::jsonb),
    'projectIds',coalesce((select jsonb_agg(a.project_id order by a.project_id) from public.project_assignments a where a.user_id=p.user_id),'[]'::jsonb),
    'messageStatus',coalesce((select case when o.state='sending' then 'uncertain' else o.state end
      from private.account_operations o where o.target_id=p.user_id and o.kind='message' order by o.created_at desc limit 1),'not_sent'))
  from public.profiles p join auth.users u on u.id=p.user_id where p.user_id=target;
$$;

create function private.account_validate(draft jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare roles text[]; projects uuid[];
begin
  if jsonb_typeof(draft->'name') is distinct from 'string' or length(btrim(draft->>'name')) not between 1 and 100
    or jsonb_typeof(draft->'roles') is distinct from 'array' or jsonb_typeof(draft->'projectIds') is distinct from 'array'
    then raise exception 'Invalid account details' using errcode='23514'; end if;
  select array_agg(value order by value) into roles from jsonb_array_elements_text(draft->'roles');
  select array_agg(value::uuid order by value::uuid) into projects from jsonb_array_elements_text(draft->'projectIds');
  if coalesce(cardinality(roles),0)=0 or cardinality(roles)<>(select count(distinct r) from unnest(roles) r)
    or not roles <@ array['Site Personnel','Project Manager','Procurement','Finance','Logistics','Accounting','Administrator']::text[]
    or ('Site Personnel'=any(roles) and cardinality(roles)<>1)
    or (coalesce(cardinality(projects),0)>0 and not 'Site Personnel'=any(roles))
    or coalesce(cardinality(projects),0)<>(select count(distinct p) from unnest(projects) p)
    or exists(select 1 from unnest(projects) assigned(id) where not exists(select 1 from public.projects p where p.id=assigned.id))
    then raise exception 'Invalid roles or project assignments' using errcode='23514'; end if;
end;
$$;

create function private.account_audit(actor_id uuid, target uuid, operation uuid, event text, details jsonb default '{}'::jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into private.audit_events(actor_user_id,actor_name,actor_role,action,entity_type,entity_id,request_id,details)
  select actor_id,p.display_name,'Administrator',event,'profile',target,operation,details from public.profiles p where p.user_id=actor_id;
$$;

create function private.accounts_directory(actor jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.account_actor(actor,false);
  return jsonb_build_object(
    'users',coalesce((select jsonb_agg(private.account_view(p.user_id) order by p.display_name,p.user_id) from public.profiles p),'[]'::jsonb),
    'projects',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name) order by p.name) from public.projects p),'[]'::jsonb),
    'history',coalesce((select jsonb_agg(h.entry order by h.occurred_at desc) from (
      select a.occurred_at,jsonb_build_object('id',a.id,'actorName',a.actor_name,'action',a.action,'targetId',a.entity_id,'at',a.occurred_at) entry
      from private.audit_events a where a.entity_type='profile' order by a.occurred_at desc limit 30) h),'[]'::jsonb));
end;
$$;

create function private.account_reserve(actor jsonb, operation uuid, draft jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor_id uuid; existing private.account_operations; target uuid;
begin
  actor_id := private.account_actor(actor);
  perform private.account_validate(draft);
  if jsonb_typeof(draft->'email') is distinct from 'string' or length(draft->>'email')>254
    or draft->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Invalid email' using errcode='23514'; end if;
  select * into existing from private.account_operations o where o.id=operation;
  if found then
    if existing.actor_id<>actor_id or existing.kind<>'provision' or existing.payload<>draft then
      raise exception 'Retry identity already used' using errcode='23514'; end if;
    return jsonb_build_object('id',existing.target_id,'state',existing.state);
  end if;
  if exists(select 1 from auth.users u where lower(u.email)=lower(draft->>'email'))
    or exists(select 1 from private.account_operations o where o.kind='provision' and lower(o.payload->>'email')=lower(draft->>'email')) then
    raise exception 'Email already registered; retry the original request or use another email' using errcode='23505'; end if;
  target := gen_random_uuid();
  insert into private.account_operations(id,actor_id,kind,target_id,payload,state) values(operation,actor_id,'provision',target,draft,'reserved');
  return jsonb_build_object('id',target,'state','reserved');
end;
$$;

create function private.account_complete(actor jsonb, operation uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor_id uuid; op private.account_operations;
begin
  actor_id:=private.account_actor(actor);
  select * into op from private.account_operations o where o.id=operation and o.kind='provision' and o.actor_id=account_complete.actor_id for update;
  if not found then raise exception 'Unknown provisioning request' using errcode='42501'; end if;
  if op.state='complete' then return private.account_view(op.target_id); end if;
  perform 1 from auth.users u where u.id=op.target_id
    and lower(u.email)=lower(op.payload->>'email') and not u.is_anonymous
    and u.raw_app_meta_data->>'account_request_id'=operation::text for share;
  if not found then raise exception 'Provisioning identity is not ready' using errcode='23514'; end if;
  perform private.account_validate(op.payload);
  insert into public.profiles(user_id,display_name,is_active) values(op.target_id,btrim(op.payload->>'name'),true);
  insert into public.role_grants(user_id,role) select op.target_id,value from jsonb_array_elements_text(op.payload->'roles');
  insert into public.project_assignments(user_id,project_id) select op.target_id,value::uuid from jsonb_array_elements_text(op.payload->'projectIds');
  perform private.account_audit(actor_id,op.target_id,operation,'account.created');
  update private.account_operations set state='complete',updated_at=clock_timestamp() where id=operation;
  return private.account_view(op.target_id);
end;
$$;

create function private.account_save(actor jsonb, operation uuid, target uuid, expected_version text, draft jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor_id uuid; old_view jsonb; new_view jsonb; existing private.account_operations; payload jsonb;
begin
  actor_id:=private.account_actor(actor);
  perform private.account_validate(draft);
  if jsonb_typeof(draft->'active') is distinct from 'boolean' then raise exception 'Invalid status' using errcode='23514'; end if;
  payload:=jsonb_build_object('draft',draft,'version',expected_version);
  select * into existing from private.account_operations o where o.id=operation;
  if found then
    if existing.actor_id<>actor_id or existing.kind<>'change' or existing.target_id<>target or existing.payload<>payload then
      raise exception 'Retry identity already used' using errcode='23514'; end if;
    return existing.result;
  end if;
  perform 1 from auth.users where id=target for share;
  perform 1 from public.profiles where user_id=target for update;
  old_view:=private.account_view(target);
  if old_view is null then raise exception 'Account not found' using errcode='23514'; end if;
  if expected_version is null or old_view->>'version'<>expected_version then raise exception 'Account changed; review the latest version and reapply your draft' using errcode='40001'; end if;
  if target=actor_id and (not (draft->>'active')::boolean or not (draft->'roles' ? 'Administrator')) then
    raise exception 'Another Administrator must deactivate you or remove your Administrator role' using errcode='23514'; end if;
  if old_view->'roles' ? 'Site Personnel' and not (draft->'roles' ? 'Site Personnel')
    and jsonb_array_length(old_view->'projectIds')>0 and draft->>'clearAssignments' is distinct from 'true' then
    raise exception 'Confirm clearing Site Personnel assignments' using errcode='23514'; end if;
  -- Reconcile sets without churning unchanged grants, revisions or versions.
  delete from public.project_assignments a where a.user_id=target and not (draft->'projectIds' ? a.project_id::text);
  delete from public.role_grants g where g.user_id=target and not (draft->'roles' ? g.role);
  insert into public.role_grants(user_id,role) select target,value from jsonb_array_elements_text(draft->'roles') r(value)
    where not exists(select 1 from public.role_grants g where g.user_id=target and g.role=r.value);
  insert into public.project_assignments(user_id,project_id) select target,value::uuid from jsonb_array_elements_text(draft->'projectIds') r(value)
    where not exists(select 1 from public.project_assignments a where a.user_id=target and a.project_id=r.value::uuid);
  update public.profiles set display_name=btrim(draft->>'name'),is_active=(draft->>'active')::boolean
    where user_id=target and (display_name is distinct from btrim(draft->>'name') or is_active is distinct from (draft->>'active')::boolean);
  new_view:=private.account_view(target);
  if not exists(select 1 from public.profiles p join auth.users u on u.id=p.user_id
    join public.role_grants g on g.user_id=p.user_id and g.role='Administrator'
    where p.is_active and p.first_signed_in_at is not null and u.email_confirmed_at is not null
      and not u.is_anonymous and (u.banned_until is null or u.banned_until<=now())) then
    raise exception 'Keep at least one active Administrator who has signed in' using errcode='23514'; end if;
  if old_view->>'version'<>new_view->>'version' then
    perform private.account_audit(actor_id,target,operation,'account.updated',jsonb_build_object(
      'roles',new_view->'roles','projectIds',new_view->'projectIds','active',new_view->'active'));
  end if;
  insert into private.account_operations(id,actor_id,kind,target_id,payload,state,result) values(operation,actor_id,'change',target,payload,'complete',new_view);
  return new_view;
end;
$$;

create function private.account_message(actor jsonb, operation uuid, target uuid, expected_version text, message_kind text, outcome text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor_id uuid; op private.account_operations; account jsonb;
begin
  actor_id:=private.account_actor(actor);
  select * into op from private.account_operations o where o.id=operation for update;
  if found then
    if op.actor_id<>actor_id or op.kind<>'message' or op.target_id<>target
      or op.payload<>jsonb_build_object('version',expected_version,'kind',message_kind) then
      raise exception 'Retry identity already used' using errcode='23514'; end if;
    if op.state<>'sending' or outcome is null then return jsonb_build_object('dispatch',false,'state',op.state); end if;
  elsif outcome is not null then raise exception 'Unknown message request' using errcode='23514';
  end if;
  perform 1 from auth.users where id=target for share;
  perform 1 from public.profiles where user_id=target for update;
  account:=private.account_view(target);
  if account is null or account->>'version' is distinct from expected_version then
    raise exception 'Account changed; review before sending' using errcode='40001'; end if;
  if account->>'active'<>'true' then raise exception 'Reactivate the account before sending a message' using errcode='23514'; end if;
  if message_kind not in ('invite','recovery') or (message_kind='invite' and (account->>'confirmed')::boolean) then
    raise exception 'Use recovery for an already confirmed account' using errcode='23514'; end if;
  if outcome is null then
    insert into private.account_operations(id,actor_id,kind,target_id,payload,state)
      values(operation,actor_id,'message',target,jsonb_build_object('version',expected_version,'kind',message_kind),'sending');
    return jsonb_build_object('dispatch',true,'state','sending','email',account->>'email');
  end if;
  if outcome not in ('accepted','failed','uncertain') then raise exception 'Invalid message outcome' using errcode='23514'; end if;
  update private.account_operations set state=outcome,updated_at=clock_timestamp() where id=operation;
  perform private.account_audit(actor_id,target,operation,'account.message.'||outcome,jsonb_build_object('kind',message_kind));
  return jsonb_build_object('dispatch',false,'state',outcome);
end;
$$;

create function public.accounts_directory(actor jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.accounts_directory(actor); $$;
create function public.account_reserve(actor jsonb, operation uuid, draft jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.account_reserve(actor,operation,draft); $$;
create function public.account_complete(actor jsonb, operation uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.account_complete(actor,operation); $$;
create function public.account_save(actor jsonb, operation uuid, target uuid, expected_version text, draft jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.account_save(actor,operation,target,expected_version,draft); $$;
create function public.account_message(actor jsonb, operation uuid, target uuid, expected_version text, message_kind text, outcome text default null) returns jsonb language sql security invoker set search_path='' as $$ select private.account_message(actor,operation,target,expected_version,message_kind,outcome); $$;

revoke all on function private.account_actor(jsonb,boolean),private.account_view(uuid),private.account_validate(jsonb),private.account_audit(uuid,uuid,uuid,text,jsonb),
  private.accounts_directory(jsonb),private.account_reserve(jsonb,uuid,jsonb),private.account_complete(jsonb,uuid),private.account_save(jsonb,uuid,uuid,text,jsonb),private.account_message(jsonb,uuid,uuid,text,text,text),
  public.accounts_directory(jsonb),public.account_reserve(jsonb,uuid,jsonb),public.account_complete(jsonb,uuid),public.account_save(jsonb,uuid,uuid,text,jsonb),public.account_message(jsonb,uuid,uuid,text,text,text)
  from public,anon,authenticated,service_role;
grant execute on function private.accounts_directory(jsonb),private.account_reserve(jsonb,uuid,jsonb),private.account_complete(jsonb,uuid),private.account_save(jsonb,uuid,uuid,text,jsonb),private.account_message(jsonb,uuid,uuid,text,text,text),
  public.accounts_directory(jsonb),public.account_reserve(jsonb,uuid,jsonb),public.account_complete(jsonb,uuid),public.account_save(jsonb,uuid,uuid,text,jsonb),public.account_message(jsonb,uuid,uuid,text,text,text) to service_role;

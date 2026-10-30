-- Private implementations; exposed wrappers are invoker functions granted only
-- to the server's service role. JWT refresh and browser RPC calls cannot bind.
create function private.login_preflight(login_email text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('userId', p.user_id, 'revision', p.access_revision::text)
  from public.profiles p join auth.users u on u.id = p.user_id
  where lower(u.email) = lower(btrim(login_email)) and p.is_active
    and not u.is_anonymous and u.email_confirmed_at is not null
    and (u.banned_until is null or u.banned_until <= now())
    and exists (select 1 from public.role_grants g where g.user_id = p.user_id);
$$;

create function private.bind_session(target_user uuid, target_session uuid, expected_revision text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  current_revision bigint;
begin
  select p.access_revision into current_revision from public.profiles p
    where p.user_id = target_user and p.is_active for update;
  if current_revision is null or current_revision::text <> expected_revision
    or not exists (select 1 from public.role_grants g where g.user_id = target_user)
    or not exists (
      select 1 from auth.sessions s join auth.users u on u.id = s.user_id
      where s.id = target_session and s.user_id = target_user
        and (s.not_after is null or s.not_after > now())
        and not u.is_anonymous and u.email_confirmed_at is not null
        and (u.banned_until is null or u.banned_until <= now())
    ) then
    return false;
  end if;
  -- Never replace a previously bound session, including an invalidated binding.
  insert into private.session_bindings(session_id, user_id, access_revision)
    values (target_session, target_user, current_revision) on conflict do nothing;
  return exists (select 1 from private.session_bindings b
    where b.session_id = target_session and b.user_id = target_user
      and b.access_revision = current_revision);
end;
$$;

create function private.unbind_session(target_user uuid, target_session uuid) returns void
language sql security definer set search_path = '' as $$
  delete from private.session_bindings where user_id = target_user and session_id = target_session;
$$;

-- Only the user's own projection is returned. The ordinary RLS/session helpers
-- continue to protect all application records independently of this projection.
create function private.session_context() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'userId', p.user_id, 'displayName', p.display_name, 'email', u.email,
    'revision', p.access_revision::text,
    'roles', (select jsonb_agg(g.role order by g.role) from public.role_grants g where g.user_id = p.user_id),
    'projectIds', coalesce((select jsonb_agg(a.project_id order by a.project_id)
      from public.project_assignments a where a.user_id = p.user_id), '[]'::jsonb)
  ) from public.profiles p join auth.users u on u.id = p.user_id
  where p.user_id = (select auth.uid()) and private.current_user_authorized();
$$;

create function private.bootstrap_administrator(target_user uuid, display_name text, request_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  -- All attempts share a lock, including attempts for different Auth identities.
  perform pg_advisory_xact_lock(208173, 32);
  if exists (select 1 from private.audit_events a where a.request_id = bootstrap_administrator.request_id
    and a.action = 'administrator.bootstrapped' and a.actor_user_id = target_user) then
    return target_user;
  end if;
  if exists (select 1 from public.profiles) then
    raise exception 'Workspace already initialized' using errcode = '23514';
  end if;
  if not exists (select 1 from auth.users u where u.id = target_user
    and u.email_confirmed_at is not null and not u.is_anonymous
    and u.encrypted_password is not null and u.encrypted_password <> ''
    and u.raw_app_meta_data->>'bootstrap_request_id' = request_id::text) then
    raise exception 'Invalid bootstrap identity' using errcode = '42501';
  end if;
  insert into public.profiles(user_id, display_name, is_active)
    values (target_user, btrim(display_name), true);
  insert into public.role_grants(user_id, role) values (target_user, 'Administrator');
  insert into private.audit_events(actor_user_id, actor_name, actor_role, action, entity_type, entity_id, request_id)
    values (target_user, btrim(display_name), 'Administrator', 'administrator.bootstrapped', 'profile', target_user, request_id);
  return target_user;
end;
$$;

create function public.auth_login_preflight(login_email text) returns jsonb
language sql security invoker set search_path = '' as $$ select private.login_preflight(login_email); $$;
create function public.auth_bind_session(target_user uuid, target_session uuid, expected_revision text) returns boolean
language sql security invoker set search_path = '' as $$ select private.bind_session(target_user, target_session, expected_revision); $$;
create function public.auth_unbind_session(target_user uuid, target_session uuid) returns void
language sql security invoker set search_path = '' as $$ select private.unbind_session(target_user, target_session); $$;
create function public.auth_session_context() returns jsonb
language sql security invoker set search_path = '' as $$ select private.session_context(); $$;
create function public.auth_bootstrap_administrator(target_user uuid, display_name text, request_id uuid) returns uuid
language sql security invoker set search_path = '' as $$ select private.bootstrap_administrator(target_user, display_name, request_id); $$;

revoke all on function private.login_preflight(text), private.bind_session(uuid,uuid,text),
  private.unbind_session(uuid,uuid), private.session_context(), private.bootstrap_administrator(uuid,text,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.auth_login_preflight(text), public.auth_bind_session(uuid,uuid,text),
  public.auth_unbind_session(uuid,uuid), public.auth_session_context(), public.auth_bootstrap_administrator(uuid,text,uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.login_preflight(text), private.bind_session(uuid,uuid,text),
  private.unbind_session(uuid,uuid), private.bootstrap_administrator(uuid,text,uuid),
  public.auth_login_preflight(text), public.auth_bind_session(uuid,uuid,text),
  public.auth_unbind_session(uuid,uuid), public.auth_bootstrap_administrator(uuid,text,uuid) to service_role;
grant execute on function private.session_context(), public.auth_session_context() to authenticated;

begin;
set local statement_timeout = '30s';
do $$
declare
  staff uuid := gen_random_uuid();
  session_a uuid := gen_random_uuid();
  session_b uuid := gen_random_uuid();
  before_login jsonb;
  after_change jsonb;
  signature text;
begin
  foreach signature in array array[
    'public.auth_login_preflight(text)', 'public.auth_bind_session(uuid,uuid,text)',
    'public.auth_unbind_session(uuid,uuid)', 'public.auth_bootstrap_administrator(uuid,text,uuid)'
  ] loop
    if has_function_privilege('anon', signature, 'execute') or has_function_privilege('authenticated', signature, 'execute')
      or not has_function_privilege('service_role', signature, 'execute') then
      raise exception 'Invalid privileged RPC grants: %', signature;
    end if;
  end loop;
  if has_function_privilege('anon','public.auth_session_context()','execute') then raise exception 'Anonymous session projection exposed'; end if;
  insert into auth.users(id,email,is_anonymous,email_confirmed_at)
    values (staff, staff::text || '@example.invalid',false,now());
  insert into auth.sessions(id,user_id,created_at,updated_at)
    values (session_a,staff,now(),now()),(session_b,staff,now(),now());
  insert into public.profiles(user_id,display_name,is_active) values (staff,'Session fixture',true);
  insert into public.role_grants values (staff,'Accounting');
  before_login := private.login_preflight(staff::text || '@example.invalid');
  if private.bind_session(staff,session_a,null) then raise exception 'Missing expected revision accepted'; end if;
  if before_login is null or not private.bind_session(staff,session_a,before_login->>'revision') then raise exception 'Fresh session binding failed'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',staff,'session_id',session_a,'role','authenticated')::text,true);
  if not private.current_user_authorized() or private.session_context()->>'userId' <> staff::text then raise exception 'Own session projection unavailable'; end if;
  insert into public.role_grants values (staff,'Finance');
  if private.current_user_authorized() or private.session_context() is not null then raise exception 'Revoked projection remained accessible'; end if;
  if private.bind_session(staff,session_b,before_login->>'revision') then raise exception 'Grant edit racing login was accepted'; end if;
  after_change := private.login_preflight(staff::text || '@example.invalid');
  if private.bind_session(staff,session_a,after_change->>'revision') then raise exception 'Invalidated binding was overwritten'; end if;
  if not private.bind_session(staff,session_b,after_change->>'revision') then raise exception 'Fresh replacement session denied'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',staff,'session_id',session_b,'role','authenticated')::text,true);
  perform private.unbind_session(staff,session_b);
  if private.current_user_authorized() then raise exception 'Sign-out binding survived'; end if;
  update public.profiles set is_active=false where user_id=staff;
  if private.login_preflight(staff::text || '@example.invalid') is not null then raise exception 'Inactive account preflight accepted'; end if;
end;
$$;
rollback;

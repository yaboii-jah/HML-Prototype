-- Run-owned synthetic records; every write, including Auth/session fixtures, is rolled back.
begin;
set local statement_timeout = '30s';
do $$
declare
  manager_id uuid := gen_random_uuid();
  site_id uuid := gen_random_uuid();
  inactive_id uuid := gen_random_uuid();
  manager_session uuid := gen_random_uuid();
  site_session uuid := gen_random_uuid();
  inactive_session uuid := gen_random_uuid();
  project_a uuid := gen_random_uuid();
  project_b uuid := gen_random_uuid();
  scope_a uuid := gen_random_uuid();
  scope_b uuid := gen_random_uuid();
  audit_id uuid := gen_random_uuid();
  table_name text;
  invalid_amount numeric;
begin
  insert into auth.users(id, email, is_anonymous) values
    (manager_id, manager_id::text || '@example.invalid', false),
    (site_id, site_id::text || '@example.invalid', false),
    (inactive_id, inactive_id::text || '@example.invalid', false);
  insert into auth.sessions(id, user_id, created_at, updated_at) values
    (manager_session, manager_id, now(), now()), (site_session, site_id, now(), now()),
    (inactive_session, inactive_id, now(), now());
  insert into public.profiles(user_id, display_name, is_active) values
    (manager_id, 'Foundation Manager', true), (site_id, 'Foundation Site', true),
    (inactive_id, 'Foundation Inactive', false);
  insert into public.role_grants(user_id, role) values
    (manager_id, 'Project Manager'), (site_id, 'Site Personnel'), (inactive_id, 'Administrator');
  insert into public.projects(id, name, document_code) values
    (project_a, 'Foundation ' || project_a, upper(left(replace(project_a::text, '-', ''), 20))),
    (project_b, 'Foundation ' || project_b, upper(left(replace(project_b::text, '-', ''), 20)));
  insert into public.project_budgets(project_id, amount) values (project_a, 100), (project_b, 100);
  insert into public.scopes(id, project_id, name) values (scope_a, project_a, 'Scope A'), (scope_b, project_a, 'Scope B');
  insert into public.scope_budgets(scope_id, amount) values (scope_a, 60), (scope_b, 20);
  insert into public.project_assignments(user_id, project_id) values (site_id, project_a);
  insert into private.session_bindings(session_id, user_id, access_revision)
    select s.id, s.user_id, p.access_revision from auth.sessions s join public.profiles p on p.user_id = s.user_id
    where s.id in (manager_session, site_session, inactive_session);

  foreach table_name in array array['profiles', 'role_grants', 'project_assignments', 'projects', 'scopes', 'project_budgets', 'scope_budgets'] loop
    if not (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname='public' and c.relname=table_name) then
      raise exception 'Missing RLS: %', table_name;
    end if;
    if has_table_privilege('anon', 'public.' || table_name, 'SELECT') or
       has_table_privilege('authenticated', 'public.' || table_name, 'INSERT,UPDATE,DELETE,TRUNCATE') then
      raise exception 'Overbroad table privileges: %', table_name;
    end if;
  end loop;
  if has_table_privilege('authenticated', 'private.session_bindings', 'SELECT,INSERT,UPDATE,DELETE') or
     has_table_privilege('authenticated', 'private.audit_events', 'SELECT,INSERT,UPDATE,DELETE') or
     has_table_privilege('service_role', 'private.audit_events', 'UPDATE,DELETE,TRUNCATE') then
    raise exception 'Private tables are overexposed';
  end if;

  begin
    insert into public.projects(name) values ('foundation ' || project_a);
    raise exception 'Case-insensitive project uniqueness failed';
  exception when unique_violation then null; end;
  begin
    insert into public.scopes(project_id, name) values (project_a, 'scope a');
    raise exception 'Case-insensitive scope uniqueness failed';
  exception when unique_violation then null; end;
  foreach invalid_amount in array array[-1::numeric, 0.001::numeric, 'NaN'::numeric, 'Infinity'::numeric] loop
    begin
      update public.project_budgets set amount = invalid_amount where project_id = project_b;
      raise exception 'Invalid money accepted';
    exception when check_violation then null; end;
  end loop;
  begin
    update public.scope_budgets set amount = 41 where scope_id = scope_b;
    raise exception 'Allocation overflow accepted';
  exception when check_violation then null; end;
  begin
    update public.project_budgets set amount = 79 where project_id = project_a;
    raise exception 'Budget reduction below allocation accepted';
  exception when check_violation then null; end;
  begin
    delete from public.project_budgets where project_id = project_a;
    raise exception 'Allocated project budget deletion accepted';
  exception when check_violation then null; end;
  begin
    update public.scopes set project_id = project_b where id = scope_a;
    raise exception 'Scope ownership change accepted';
  exception when check_violation then null; end;
  begin
    update public.projects set creation_request_id = gen_random_uuid() where id = project_a;
    raise exception 'Creation identity change accepted';
  exception when check_violation then null; end;
  update public.projects set code_locked_at = now() where id = project_a;
  begin
    update public.projects set document_code = 'CHANGED' where id = project_a;
    raise exception 'Locked project code change accepted';
  exception when check_violation then null; end;
  begin
    insert into public.role_grants(user_id, role) values (site_id, 'Accounting');
    raise exception 'Site Personnel role combination accepted';
  exception when check_violation then null; end;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', site_id, 'session_id', site_session, 'role', 'authenticated', 'user_metadata', jsonb_build_object('role', 'Administrator'))::text, true);
  set local role authenticated;
  if (select count(*) from public.projects where id in (project_a, project_b)) <> 1 then raise exception 'Assigned-project isolation failed'; end if;
  if exists (select 1 from public.project_budgets where project_id in (project_a, project_b)) or
     exists (select 1 from public.scope_budgets where scope_id in (scope_a, scope_b)) then raise exception 'Site Personnel financial leak'; end if;
  if (select count(*) from public.scopes where id in (scope_a, scope_b)) <> 2 then raise exception 'Scope metadata inaccessible'; end if;
  begin
    insert into public.projects(name) values ('Forged client write');
    raise exception 'Direct client write accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from private.session_bindings;
    raise exception 'Client accessed bindings';
  exception when insufficient_privilege then null; end;
  reset role;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', manager_id, 'session_id', manager_session, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if (select count(*) from public.projects where id in (project_a, project_b)) <> 2 then raise exception 'Manager project access failed'; end if;
  if (select count(*) from public.project_budgets where project_id in (project_a, project_b)) <> 2 then raise exception 'Manager budget access failed'; end if;
  reset role;

  insert into public.role_grants(user_id, role) values (manager_id, 'Accounting');
  set local role authenticated;
  if exists (select 1 from public.projects where id in (project_a, project_b)) then raise exception 'Grant change did not invalidate binding'; end if;
  -- Reusing/refreshing the same signed session does not renew the application binding.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', manager_id, 'session_id', manager_session, 'role', 'authenticated', 'exp', extract(epoch from now()) + 3600)::text, true);
  if private.current_user_authorized() then raise exception 'Refreshed claims renewed stale binding'; end if;
  reset role;
  update private.session_bindings set access_revision = (select access_revision from public.profiles where user_id=manager_id) where session_id=manager_session;
  update public.profiles set is_active=false where user_id=manager_id;
  set local role authenticated;
  if private.current_user_authorized() then raise exception 'Inactive profile retained access'; end if;
  reset role;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', inactive_id, 'session_id', inactive_session, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if exists (select 1 from public.projects where id in (project_a, project_b)) then raise exception 'Inactive Administrator retained access'; end if;
  reset role;

  delete from public.project_assignments where user_id=site_id and project_id=project_a;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', site_id, 'session_id', site_session, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if private.current_user_authorized() then raise exception 'Assignment change did not invalidate binding'; end if;
  reset role;
  update private.session_bindings set access_revision = (select access_revision from public.profiles where user_id=site_id) where session_id=site_session;
  delete from auth.sessions where id=site_session;
  set local role authenticated;
  if private.current_user_authorized() then raise exception 'Deleted Auth session retained access'; end if;
  reset role;

  insert into private.audit_events(id, actor_user_id, actor_name, actor_role, action, entity_type, entity_id, request_id)
    values (audit_id, manager_id, 'Historical Manager', 'Project Manager', 'test', 'project', project_a, gen_random_uuid());
  begin
    update private.audit_events set actor_name='Rewritten' where id=audit_id;
    raise exception 'Audit rewrite accepted';
  exception when insufficient_privilege then null; end;
  begin
    delete from private.audit_events where id=audit_id;
    raise exception 'Audit deletion accepted';
  exception when insufficient_privilege then null; end;
end;
$$;
select 'Foundation constraints, authorization, confidentiality and audit checks passed; synthetic writes rolled back.' as result;
rollback;

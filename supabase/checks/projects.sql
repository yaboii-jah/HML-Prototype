-- Successful commands/audits run in a rollback fixture transaction on staging.
begin;
set local statement_timeout='30s';
do $$
<<project_checks>>
declare
  admin_id uuid:=gen_random_uuid(); manager_id uuid:=gen_random_uuid(); reader_id uuid:=gen_random_uuid(); site_id uuid:=gen_random_uuid();
  admin_session uuid:=gen_random_uuid(); manager_session uuid:=gen_random_uuid(); reader_session uuid:=gen_random_uuid(); site_session uuid:=gen_random_uuid();
  caller uuid; session_id uuid; actor jsonb; manager jsonb; reader jsonb; site jsonb; proof jsonb;
  request_id uuid:=gen_random_uuid(); target uuid; scope_a uuid; scope_b uuid; extra uuid; pending uuid;
  command jsonb; created jsonb; detail jsonb; previous_version text; before_revision bigint; audit_count bigint; signature text;
begin
  foreach signature in array array['public.projects_read(jsonb,uuid)','public.project_command(jsonb,jsonb)'] loop
    if has_function_privilege('anon',signature,'execute') or has_function_privilege('authenticated',signature,'execute')
      or not has_function_privilege('service_role',signature,'execute') then raise exception 'Project RPC privilege leak'; end if;
  end loop;
  insert into auth.users(id,email,is_anonymous,email_confirmed_at,encrypted_password) values
    (admin_id,admin_id::text||'@example.invalid',false,now(),'fixture'),(manager_id,manager_id::text||'@example.invalid',false,now(),'fixture'),
    (reader_id,reader_id::text||'@example.invalid',false,now(),'fixture'),(site_id,site_id::text||'@example.invalid',false,now(),'fixture');
  insert into public.profiles(user_id,display_name,is_active) values(admin_id,'Project Administrator',true),(manager_id,'Project Manager',true),(reader_id,'Project Reader',true),(site_id,'Project Site',true);
  insert into public.role_grants values(admin_id,'Administrator'),(manager_id,'Project Manager'),(reader_id,'Accounting'),(site_id,'Site Personnel');
  insert into auth.sessions(id,user_id,created_at,updated_at) values(admin_session,admin_id,now(),now()),(manager_session,manager_id,now(),now()),(reader_session,reader_id,now(),now()),(site_session,site_id,now(),now());
  for caller,session_id in select * from (values(admin_id,admin_session),(manager_id,manager_session),(reader_id,reader_session),(site_id,site_session)) ids loop
    proof:=private.login_preflight(caller::text||'@example.invalid');
    if not private.bind_session(caller,session_id,proof->>'revision',proof->>'credential') then raise exception 'Project fixture binding failed'; end if;
  end loop;
  actor:=jsonb_build_object('userId',admin_id,'sessionId',admin_session,'revision','2','activeRole','Administrator');
  manager:=jsonb_build_object('userId',manager_id,'sessionId',manager_session,'revision','2','activeRole','Project Manager');
  reader:=jsonb_build_object('userId',reader_id,'sessionId',reader_session,'revision','2','activeRole','Accounting');
  site:=jsonb_build_object('userId',site_id,'sessionId',site_session,'revision','2','activeRole','Site Personnel');
  command:=jsonb_build_object('type','createProject','requestId',request_id,'name','Shared fixture '||request_id::text,'location','Test site','code','QA-'||upper(substr(replace(request_id::text,'-',''),1,12)),'budget','100.00');
  created:=private.project_command(actor,command); target:=(created->>'projectId')::uuid;
  if private.project_command(actor,command)<>created then raise exception 'Creation retry changed result'; end if;
  if (select count(*) from private.audit_events a where a.request_id=project_checks.request_id and a.entity_id=target)<>1 then raise exception 'Creation audit duplicated'; end if;
  begin perform private.project_command(reader,command||jsonb_build_object('requestId',gen_random_uuid())); raise exception 'Reader wrote project'; exception when insufficient_privilege then null; end;
  begin perform private.projects_read(actor||jsonb_build_object('sessionId',gen_random_uuid())); raise exception 'Forged session read projects'; exception when insufficient_privilege then null; end;
  begin perform private.project_command(actor,command||'{"name":"Changed retry"}'::jsonb); raise exception 'Retry payload substitution accepted'; exception when sqlstate 'P3406' then null; end;
  detail:=private.projects_read(actor,target)->'project'; previous_version:=detail->>'version';
  select count(*) into audit_count from private.audit_events;
  perform private.project_command(actor,command||jsonb_build_object('type','saveProject','requestId',gen_random_uuid(),'projectId',target,'projectVersion',previous_version));
  if private.projects_read(actor,target)->'project'->>'version'<>previous_version or (select count(*) from private.audit_events)<>audit_count then raise exception 'Unchanged project advanced version/audit'; end if;
  created:=private.project_command(manager,jsonb_build_object('type','createScope','requestId',gen_random_uuid(),'projectId',target,'projectVersion',previous_version,'name','Structural Works','budget','70.00'));
  scope_a:=(created->>'scopeId')::uuid;
  detail:=private.projects_read(actor,target)->'project';
  begin perform private.project_command(actor,jsonb_build_object('type','createScope','requestId',gen_random_uuid(),'projectId',target,'projectVersion',detail->>'version','name','Electrical','budget','40.00')); raise exception 'Over-allocation accepted'; exception when sqlstate 'P3401' then null; end;
  created:=private.project_command(actor,jsonb_build_object('type','createScope','requestId',gen_random_uuid(),'projectId',target,'projectVersion',detail->>'version','name','Electrical','budget','30.00'));
  scope_b:=(created->>'scopeId')::uuid;
  detail:=private.projects_read(actor,target)->'project';
  begin perform private.project_command(actor,command||jsonb_build_object('type','saveProject','requestId',gen_random_uuid(),'projectId',target,'projectVersion',detail->>'version','budget','99.99')); raise exception 'Budget reduction below allocations accepted'; exception when sqlstate 'P3401' then null; end;
  begin perform private.project_command(actor,command||jsonb_build_object('type','saveProject','requestId',gen_random_uuid(),'projectId',target,'projectVersion',previous_version)); raise exception 'Stale project version accepted'; exception when serialization_failure then null; end;
  begin perform private.project_command(actor,jsonb_build_object('type','createScope','requestId',gen_random_uuid(),'projectId',target,'projectVersion',detail->>'version','name','Custom scope','budget','0')); raise exception 'Custom scope accepted'; exception when check_violation then null; end;
  begin perform private.project_command(actor,command||jsonb_build_object('requestId',gen_random_uuid(),'name','Missing budget','code','MB-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)),'budget',null)); raise exception 'Missing budget became zero'; exception when check_violation then null; end;
  -- Metadata-only scope edits and explicit removals both advance the parent.
  previous_version:=detail->>'version';
  perform private.project_command(actor,jsonb_build_object('type','saveScope','requestId',gen_random_uuid(),'projectId',target,'projectVersion',previous_version,'scopeId',scope_b,
    'scopeVersion',(private.scope_snapshot(scope_b)->>'version'),'name','Mechanical','budget','30.00'));
  if private.projects_read(actor,target)->'project'->>'version'=previous_version then raise exception 'Scope rename left parent unchanged'; end if;
  detail:=private.projects_read(actor,target)->'project'; previous_version:=detail->>'version';
  perform private.project_command(actor,jsonb_build_object('type','deleteScope','requestId',gen_random_uuid(),'projectId',target,'projectVersion',previous_version,'scopeId',scope_b,'scopeVersion',private.scope_snapshot(scope_b)->>'version'));
  detail:=private.projects_read(actor,target)->'project';
  if detail->>'version'=previous_version or detail->'financial'->>'budget'<>'100.00' or (detail->'financial'->>'allocated')::numeric<>70 then raise exception 'Scope removal did not release allocation safely'; end if;
  -- Exact amount is returned as text, never JSON number.
  created:=private.project_command(actor,command||jsonb_build_object('requestId',gen_random_uuid(),'name','Large exact '||request_id::text,'code','LG-'||upper(substr(replace(request_id::text,'-',''),1,12)),'budget','9999999999999999.99'));
  extra:=(created->>'projectId')::uuid;
  if private.projects_read(reader,extra)->'project'->'financial'->>'budget'<>'9999999999999999.99'
    or jsonb_typeof(private.projects_read(reader,extra)->'project'->'financial'->'budget')<>'string' then raise exception 'Large budget lost precision'; end if;
  insert into public.project_assignments values(site_id,target),(site_id,extra);
  site:=site||jsonb_build_object('revision',(select access_revision::text from public.profiles where user_id=site_id));
  proof:=private.login_preflight(site_id::text||'@example.invalid');
  delete from private.session_bindings where session_id=site_session;
  if not private.bind_session(site_id,site_session,proof->>'revision',proof->>'credential') then raise exception 'Refresh Site fixture binding failed'; end if;
  detail:=private.projects_read(site,target);
  if detail->'project' ? 'financial' or detail->'project'->'scopes'->0 ? 'budget' or jsonb_array_length(detail->'history')<>0 then raise exception 'Site finance/history leak'; end if;
  if private.projects_read(site,gen_random_uuid())->'project'<>'null'::jsonb then raise exception 'Unassigned project visible'; end if;
  if jsonb_array_length(private.projects_read(reader,target)->'history')=0 then raise exception 'Non-Site history unavailable'; end if;
  detail:=private.projects_read(actor,target)->'project';
  begin perform private.project_command(manager,jsonb_build_object('type','deleteProject','requestId',gen_random_uuid(),'projectId',target,'projectVersion',detail->>'version','assignmentIds','[]'::jsonb,'clearAssignments',false)); raise exception 'PM removed assigned access'; exception when insufficient_privilege then null; end;
  begin perform private.project_command(actor,jsonb_build_object('type','deleteProject','requestId',gen_random_uuid(),'projectId',target,'projectVersion',detail->>'version','assignmentIds','[]'::jsonb,'clearAssignments',true)); raise exception 'Unreviewed assignment cleared'; exception when sqlstate 'P3404' then null; end;
  pending:=gen_random_uuid();
  perform private.account_reserve(actor,pending,jsonb_build_object('name','Pending project invite','email',pending::text||'@example.invalid','roles',jsonb_build_array('Site Personnel'),'projectIds',jsonb_build_array(target),'active',true,'clearAssignments',false));
  begin perform private.project_command(actor,jsonb_build_object('type','deleteProject','requestId',gen_random_uuid(),'projectId',target,'projectVersion',detail->>'version','assignmentIds',jsonb_build_array(site_id),'clearAssignments',true)); raise exception 'Pending provisioning stranded'; exception when sqlstate 'P3402' then null; end;
  -- Finish this owned provisioning fixture before deleting its referenced project.
  insert into auth.users(id,email,is_anonymous,encrypted_password,raw_app_meta_data)
    select o.target_id,o.payload->>'email',false,'unknown-random',jsonb_build_object('account_request_id',pending) from private.account_operations o where o.id=pending;
  perform private.account_complete(actor,pending);
  detail:=private.projects_read(actor,target)->'project';
  select access_revision into before_revision from public.profiles where user_id=site_id;
  command:=jsonb_build_object('type','deleteProject','requestId',gen_random_uuid(),'projectId',target,'projectVersion',detail->>'version',
    'assignmentIds',(select jsonb_agg(a.user_id order by a.user_id) from public.project_assignments a where a.project_id=target),'clearAssignments',true);
  created:=private.project_command(actor,command);
  if created->>'deleted'<>'true' or exists(select 1 from public.projects where id=target) or exists(select 1 from public.scopes where project_id=target) then raise exception 'Project removal incomplete'; end if;
  if (select access_revision from public.profiles where user_id=site_id)<=before_revision or not exists(select 1 from public.project_assignments where user_id=site_id and project_id=extra) then raise exception 'Deletion failed access invalidation or removed another assignment'; end if;
  begin perform private.projects_read(site); raise exception 'Old Site session survived deletion'; exception when insufficient_privilege then null; end;
  if private.project_command(actor,command)->>'deleted'<>'true' then raise exception 'Deletion retry failed'; end if;
  -- Original creation receipt must never resurrect a deleted project.
  command:=(select o.payload from private.project_operations o where o.id=request_id);
  if private.project_command(actor,command)->>'deleted'<>'true' or exists(select 1 from public.projects where id=target) then raise exception 'Creation replay resurrected project'; end if;
  update public.projects set code_locked_at=now() where id=extra;
  detail:=private.projects_read(actor,extra)->'project';
  begin perform private.project_command(actor,jsonb_build_object('type','saveProject','requestId',gen_random_uuid(),'projectId',extra,'projectVersion',detail->>'version','name',detail->>'name','location','Test site','code','CHANGED','budget','9999999999999999.99')); raise exception 'Locked code changed'; exception when sqlstate 'P3403' then null; end;
  begin perform private.project_command(actor,jsonb_build_object('type','deleteProject','requestId',gen_random_uuid(),'projectId',extra,'projectVersion',detail->>'version','assignmentIds',jsonb_build_array(site_id),'clearAssignments',true)); raise exception 'Document-used project deleted'; exception when sqlstate 'P3402' then null; end;
end;
$$;
rollback;

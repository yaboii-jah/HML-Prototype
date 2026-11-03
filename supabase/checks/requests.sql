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
  command:=jsonb_build_object('type','createProject','requestId',request_id,'name','MRF fixture '||request_id::text,'location','CI','code','MRF-'||upper(substr(replace(request_id::text,'-',''),1,10)),'budget','0');
  target:=(private.project_command(actor,command)->>'projectId')::uuid;
  scope_a:=gen_random_uuid(); insert into public.scopes(id,project_id,name) values(scope_a,target,'Structural Works');
  insert into public.project_assignments values(site_id,target);
  proof:=private.login_preflight(site_id::text||'@example.invalid');
  delete from private.session_bindings b where b.session_id=site_session;
  perform private.bind_session(site_id,site_session,proof->>'revision',proof->>'credential');
  site:=site||jsonb_build_object('revision',proof->>'revision');
  detail:=jsonb_build_object('scopeId',scope_a,'requestDate','','sourceRef','','requestedBy','','approvedBy','','purchaser','','financeOfficer','','specialInstructions','','items','[]'::jsonb);
  command:=jsonb_build_object('type','createDraft','requestId',gen_random_uuid(),'projectId',target,'draft',detail);
  created:=public.request_command(site,command);
  extra:=(created->'record'->>'id')::uuid;
  if created->'record'->>'ref' not like '%-MRF-0001' then raise exception 'Numbering failed'; end if;
  if public.request_command(site,command)<>created then raise exception 'Retry changed result'; end if;
  if (select last_value from private.document_counters where project_id=target)<>1 then raise exception 'Retry advanced counter'; end if;
  begin perform public.request_command(site,command||jsonb_build_object('draft',detail||'{"sourceRef":"changed"}')); raise exception 'Payload reuse accepted'; exception when sqlstate 'P3406' then null; end;
  begin perform public.request_command(reader,command||jsonb_build_object('requestId',gen_random_uuid())); raise exception 'Reader saved draft'; exception when insufficient_privilege then null; end;
  begin perform public.request_command(site,command||jsonb_build_object('requestId',gen_random_uuid(),'projectId',gen_random_uuid())); raise exception 'Foreign project accepted'; exception when insufficient_privilege then null; end;
  previous_version:=created->'record'->>'version';
  select count(*) into audit_count from private.audit_events;
  command:=jsonb_build_object('type','saveDraft','requestId',gen_random_uuid(),'mrfId',extra,'expectedVersion',previous_version,'draft',detail);
  created:=public.request_command(site,command);
  if created->>'changed'<>'false' or (select count(*) from private.audit_events)<>audit_count then raise exception 'No-op audited'; end if;
  detail:=detail||jsonb_build_object('items',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'name','Cement','unit','','quantity',null,'neededDate','','purpose','','location','','remarks','')));
  created:=public.request_command(site,command||jsonb_build_object('requestId',gen_random_uuid(),'draft',detail));
  if created->'record'->>'version'=previous_version or created->'record'->'draft'->'items'->0->'quantity'<>'null'::jsonb then raise exception 'Partial row save failed'; end if;
  begin perform public.request_command(site,command||jsonb_build_object('requestId',gen_random_uuid())); raise exception 'Stale save accepted'; exception when serialization_failure then null; end;
  if private.requests_read(reader,extra)->'requests'->0->>'id'<>extra::text then raise exception 'Reader cannot see MRF'; end if;
  begin delete from public.scopes where id=scope_a; raise exception 'Referenced scope deleted'; exception when foreign_key_violation then null; end;
  begin delete from public.projects where id=target; raise exception 'Referenced project deleted'; exception when foreign_key_violation then null; end;
  begin
    perform public.request_command(site,jsonb_build_object('type','createDraft','requestId',gen_random_uuid(),'projectId',target,'draft',detail||'{"items":[]}'::jsonb));
    raise exception 'Rollback sentinel' using errcode='P4101';
  exception when sqlstate 'P4101' then null; end;
  if (select last_value from private.document_counters where project_id=target)<>1 then raise exception 'Rollback consumed number'; end if;
  -- Invalid supplied values must fail without consuming numbers or effects.
  begin
    perform public.request_command(site,jsonb_build_object('type','createDraft','requestId',gen_random_uuid(),'projectId',target,'draft',jsonb_set(detail,'{items,0,quantity}','"0"')));
    raise exception 'Zero quantity accepted';
  exception when check_violation then null; end;
  begin
    perform public.request_command(site,jsonb_build_object('type','createDraft','requestId',gen_random_uuid(),'projectId',target,'draft',detail||'{"requestDate":"2026-02-29"}'));
    raise exception 'Invalid date accepted';
  exception when check_violation then null; end;
  begin
    perform public.request_command(site,jsonb_build_object('type','createDraft','requestId',gen_random_uuid(),'projectId',target,'draft',detail||jsonb_build_object('scopeId',gen_random_uuid())));
    raise exception 'Foreign scope accepted';
  exception when check_violation then null; end;
  begin update public.material_requests set creator_name='Forged' where id=extra; raise exception 'Creator rewritten'; exception when check_violation then null; end;
  begin update public.material_requests set ref='Forged' where id=extra; raise exception 'Number rewritten'; exception when check_violation then null; end;
  begin delete from public.material_requests where id=extra; raise exception 'MRF deleted'; exception when check_violation then null; end;
  if (select last_value from private.document_counters where project_id=target)<>1 then raise exception 'Rejected values consumed number'; end if;
  update private.document_counters set last_value=9999 where project_id=target;
  created:=public.request_command(site,jsonb_build_object('type','createDraft','requestId',gen_random_uuid(),'projectId',target,'draft',detail||'{"items":[]}'::jsonb));
  if created->'record'->>'ref' not like '%-MRF-10000' then raise exception 'Large sequence truncated'; end if;
  created:=public.request_command(site,jsonb_build_object('type','createDraft','requestId',gen_random_uuid(),'projectId',target,'draft',detail||'{"items":[],"requestDate":"2035-01-01"}'::jsonb));
  if created->'record'->>'ref' not like '%-MRF-10001' then raise exception 'Sequence reset for another year'; end if;
  foreach signature in array array['public.requests_read(jsonb,uuid)','public.request_command(jsonb,jsonb)'] loop
    if has_function_privilege('anon',signature,'execute') or has_function_privilege('authenticated',signature,'execute') then raise exception 'Request RPC privilege leak'; end if;
  end loop;
  foreach signature in array array['public.material_requests','public.material_request_items'] loop
    if has_table_privilege('anon',signature,'select') or has_table_privilege('authenticated',signature,'insert') or has_table_privilege('authenticated',signature,'update') or has_table_privilege('authenticated',signature,'delete') then raise exception 'Request table privilege leak'; end if;
  end loop;
  delete from private.session_bindings b where b.session_id=site_session;
  begin perform public.request_command(site,command); raise exception 'Revoked retry returned data'; exception when insufficient_privilege then null; end;
end;
$$;
rollback;

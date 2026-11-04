-- Rollback-only: retained hosted data is never changed by these checks.
begin;
set local statement_timeout='30s';
do $$
declare person uuid:=gen_random_uuid(); session uuid:=gen_random_uuid(); actor jsonb; proof jsonb;
  command jsonb; result jsonb; target uuid; snapshot jsonb; total bigint; reader jsonb; role text; signature text;
begin
  foreach signature in array array['public.suppliers_read(jsonb,uuid)','public.supplier_command(jsonb,jsonb)',
    'private.suppliers_read(jsonb,uuid)','private.supplier_command(jsonb,jsonb)'] loop
    if has_function_privilege('anon',signature,'execute') or has_function_privilege('authenticated',signature,'execute')
      or not has_function_privilege('service_role',signature,'execute') then raise exception 'Supplier RPC privilege leak'; end if;
  end loop;
  if has_table_privilege('authenticated','private.suppliers','select') or has_table_privilege('service_role','private.suppliers','update') then
    raise exception 'Direct supplier table access'; end if;
  insert into auth.users(id,email,is_anonymous,email_confirmed_at,encrypted_password) values(person,person::text||'@example.invalid',false,now(),'fixture');
  insert into public.profiles(user_id,display_name,is_active) values(person,'Supplier fixture',true);
  insert into public.role_grants values(person,'Procurement');
  insert into auth.sessions(id,user_id,created_at,updated_at) values(session,person,now(),now());
  proof:=private.login_preflight(person::text||'@example.invalid');
  perform private.bind_session(person,session,proof->>'revision',proof->>'credential');
  actor:=jsonb_build_object('userId',person,'sessionId',session,'revision',proof->>'revision','activeRole','Procurement');
  command:=jsonb_build_object('type','createSupplier','requestId',gen_random_uuid(),'profile',
    jsonb_build_object('name','Supplier fixture '||person,'address','','tin','001-234','contactName','','email','','phone','','accreditationNote','Informational'));
  result:=public.supplier_command(actor,command); target:=(result->>'supplierId')::uuid;
  if public.supplier_command(actor,command)<>result then raise exception 'Retry result changed'; end if;
  if (select count(*) from private.audit_events where entity_type='supplier' and entity_id=target)<>1 then raise exception 'Retry duplicated audit'; end if;
  begin perform public.supplier_command(actor,command||jsonb_build_object('profile',command->'profile'||'{"phone":"changed"}')); raise exception 'Reused payload accepted'; exception when sqlstate 'P4401' then null; end;
  snapshot:=private.supplier_view(target);
  select count(*) into total from private.audit_events;
  perform public.supplier_command(actor,jsonb_build_object('type','saveSupplier','requestId',gen_random_uuid(),'supplierId',target,'expectedVersion',snapshot->>'version','profile',command->'profile'));
  if private.supplier_view(target)<>snapshot or (select count(*) from private.audit_events)<>total then raise exception 'No-op mutated supplier'; end if;
  perform public.supplier_command(actor,jsonb_build_object('type','setSupplierStatus','requestId',gen_random_uuid(),'supplierId',target,'expectedVersion','1','active',false,'reason','No longer used'));
  begin perform public.supplier_command(actor,command||jsonb_build_object('requestId',gen_random_uuid(),'profile',command->'profile'||jsonb_build_object('name','  SUPPLIER   FIXTURE '||person||'  '))); raise exception 'Inactive duplicate accepted'; exception when unique_violation then null; end;
  begin perform public.supplier_command(actor,jsonb_build_object('type','saveSupplier','requestId',gen_random_uuid(),'supplierId',target,'expectedVersion','1','profile',command->'profile')); raise exception 'Stale update accepted'; exception when serialization_failure then null; end;
  begin perform public.supplier_command(actor,jsonb_build_object('type','setSupplierStatus','requestId',gen_random_uuid(),'supplierId',target,'expectedVersion','2','active',true,'reason','bad')); raise exception 'Short reason accepted'; exception when check_violation then null; end;
  perform public.supplier_command(actor,jsonb_build_object('type','setSupplierStatus','requestId',gen_random_uuid(),'supplierId',target,'expectedVersion','2','active',true,'reason','Details reviewed'));
  if (private.suppliers_read(actor,target)->'supplier'->>'version')<>'3' or jsonb_array_length(private.supplier_history(target))<>3 then raise exception 'Status/history missing'; end if;
  foreach role in array array['Administrator','Project Manager','Accounting','Finance','Logistics','Site Personnel'] loop
    -- Role changes revoke bindings; bind a fresh session proof for each role.
    delete from public.role_grants where user_id=person;
    insert into public.role_grants values(person,role);
    proof:=private.login_preflight(person::text||'@example.invalid');
    perform private.bind_session(person,session,proof->>'revision',proof->>'credential');
    reader:=actor||jsonb_build_object('activeRole',role,'revision',proof->>'revision');
    if role='Site Personnel' then
      begin perform public.suppliers_read(reader); raise exception 'Site read suppliers'; exception when insufficient_privilege then null; end;
    elsif private.suppliers_read(reader,target)->'supplier'->>'id'<>target::text then raise exception 'Reader lost supplier'; end if;
    begin perform public.supplier_command(reader,command||jsonb_build_object('requestId',gen_random_uuid())); raise exception 'Reader maintained suppliers'; exception when insufficient_privilege then null; end;
  end loop;
  begin perform public.suppliers_read(actor); raise exception 'Revoked Procurement session read'; exception when insufficient_privilege then null; end;
  if (select actor_name from private.audit_events where entity_type='supplier' and entity_id=target limit 1)<>'Supplier fixture' then raise exception 'Historical actor changed'; end if;
end;
$$;
rollback;

-- Rollback-only synthetic owning transactions. No provider/archive behavior is
-- asserted by these deliberately direct approved-record fixtures.
begin;
set local statement_timeout='60s';
create function pg_temp.demand_fixture() returns jsonb language plpgsql as $$
declare person uuid:=gen_random_uuid(); session uuid:=gen_random_uuid(); project uuid:=gen_random_uuid();
  request uuid:=gen_random_uuid(); item uuid:=gen_random_uuid(); other_item uuid:=gen_random_uuid();
  archive uuid:=gen_random_uuid(); document uuid:=gen_random_uuid(); mapping uuid:=gen_random_uuid(); proof jsonb; form jsonb;
begin
  insert into auth.users(id,email,is_anonymous,email_confirmed_at,encrypted_password) values(person,person||'@example.invalid',false,now(),'fixture');
  insert into public.profiles(user_id,display_name,is_active) values(person,'Demand fixture',true);
  insert into public.role_grants values(person,'Procurement');
  insert into auth.sessions(id,user_id,created_at,updated_at) values(session,person,now(),now());
  proof:=private.login_preflight(person||'@example.invalid');
  perform private.bind_session(person,session,proof->>'revision',proof->>'credential');
  insert into public.projects(id,name,document_code) values(project,'Demand fixture '||project,'DM-'||upper(substr(project::text,1,8)));
  form:=jsonb_build_object('items',jsonb_build_array(
    jsonb_build_object('id',item,'quantity','18','unit','bag'),jsonb_build_object('id',other_item,'quantity','0.3','unit','m')));
  insert into public.material_requests(id,project_id,ref,sequence,data,creator_id,creator_name,updater_id,updater_name,status)
    values(request,project,'DM-'||request||'-MRF-0001',1,'{}',person,'Demand fixture',person,'Demand fixture','approved');
  insert into public.material_request_items(id,request_id,position,data)
    values(item,request,0,form->'items'->0),(other_item,request,1,form->'items'->1);
  insert into private.project_document_folders(id,project_id,folder_id,root_id,name) values(mapping,project,'demand-'||mapping,'fixture-root','Fixture');
  insert into private.request_documents(id,request_id,folder_mapping_id,drive_file_id,name,size,sha256,uploader_id,uploader_name)
    values(document,request,mapping,'demand-'||document,'fixture.pdf',10,repeat('a',64),person,'Demand fixture');
  insert into private.mrf_archive_snapshots(id,request_id,version,source_document,request_version,attachment_revision,snapshot,approved_by,approved_name,approved_at)
    values(archive,request,1,document,1,1,jsonb_build_object('draft',form),person,'Demand fixture',now());
  insert into private.mrf_archives(snapshot_id,folder_mapping_id,form_file_id,form_sha256,supporting_file_id,supporting_sha256)
    values(archive,mapping,'demand-form-'||archive,repeat('a',64),'demand-support-'||archive,repeat('a',64));
  return jsonb_build_object('actor',jsonb_build_object('userId',person,'sessionId',session,'revision',proof->>'revision','activeRole','Procurement'),
    'request',request,'item',item,'otherItem',other_item,'archive',archive);
end $$;

-- Assertions (the race runner reuses only the fixture definition above).
do $$
declare f jsonb:=pg_temp.demand_fixture(); actor jsonb:=f->'actor'; target uuid:=(f->>'request')::uuid;
  item uuid:=(f->>'item')::uuid; other_item uuid:=(f->>'otherItem')::uuid;
  claim uuid:=gen_random_uuid(); replacement uuid:=gen_random_uuid(); operation uuid:=gen_random_uuid();
  a jsonb; b jsonb; result jsonb; original jsonb; count_before bigint; uid uuid:=(actor->>'userId')::uuid; foreign_fixture jsonb;
begin
  a:=jsonb_build_object('claimId',claim,'itemId',item,'ownerKind','award','ownerId',gen_random_uuid(),'ownerLineId',gen_random_uuid(),'quantity','18');
  result:=private.demand_apply(actor,operation,target,'0',jsonb_build_array(a),'Save quantity award');
  if result->>'version'<>'1' or result->'requirements'->0->>'unassigned'<>'0' then raise exception 'Initial demand totals failed'; end if;
  if private.demand_apply(actor,operation,target,'0',jsonb_build_array(a),'Save quantity award')<>result then raise exception 'Retry result changed'; end if;
  begin perform private.demand_apply(actor,operation,target,'0',jsonb_build_array(a||'{"quantity":"17"}'),'Save quantity award'); raise exception 'Retry identity reused'; exception when check_violation then null; end;
  if (select count(*) from private.demand_events where request_id=target)<>1 then raise exception 'Retry duplicated audit'; end if;
  b:=a||jsonb_build_object('claimId',replacement,'ownerKind','purchase_order','ownerId',gen_random_uuid());
  begin perform private.demand_apply(actor,gen_random_uuid(),target,'1',jsonb_build_array(b),'Overlapping purchase'); raise exception 'Over-allocation accepted'; exception when check_violation then null; end;
  if (private.demand_snapshot(target)->>'version')<>'1' or exists(select 1 from private.demand_claims where id=replacement) then raise exception 'Failed allocation persisted'; end if;
  -- Add before releasing in the batch: validate the final state, never a transient sum.
  result:=private.demand_apply(actor,gen_random_uuid(),target,'1',jsonb_build_array(b,a||'{"quantity":"0"}'),'Convert award to PO');
  if result->'requirements'->0->>'ordered'<>'18' or result->'requirements'->0->>'purchase'<>'0' then raise exception 'Conversion counted twice'; end if;
  count_before:=(select count(*) from private.demand_events where request_id=target);
  result:=private.demand_apply(actor,gen_random_uuid(),target,'2',jsonb_build_array(b),'Unchanged owning save');
  if result->>'changed'<>'false' or result->>'version'<>'2' or (select count(*) from private.demand_events where request_id=target)<>count_before then raise exception 'No-op mutated demand'; end if;
  begin perform private.demand_apply(actor,gen_random_uuid(),target,'1',jsonb_build_array(b),'Stale allocation save'); raise exception 'Stale save accepted'; exception when serialization_failure then null; end;
  begin perform private.demand_apply(actor,gen_random_uuid(),target,'2',jsonb_build_array(b,b),'Duplicate batch claim'); raise exception 'Duplicate accepted'; exception when check_violation then null; end;
  begin perform private.demand_apply(actor,gen_random_uuid(),target,'2',jsonb_build_array(b||jsonb_build_object('ownerId',gen_random_uuid())),'Rewrite claim ownership'); raise exception 'Ownership rewritten'; exception when check_violation then null; end;
  foreign_fixture:=pg_temp.demand_fixture();
  begin perform private.demand_apply(actor,gen_random_uuid(),target,'2',jsonb_build_array(a||jsonb_build_object('claimId',gen_random_uuid(),'itemId',foreign_fixture->>'item','quantity','1')),'Cross MRF material'); raise exception 'Foreign item accepted'; exception when check_violation then null; end;
  -- Actual checked correction command sees permanent demand references.
  perform public.request_command(actor,jsonb_build_object('type','openCorrection','requestId',gen_random_uuid(),'mrfId',target,
    'expectedVersion',(select version::text from public.material_requests where id=target),'reason','Correct source document'));
  if (select correction_kind from public.material_requests where id=target)<>'documents' then raise exception 'Claim did not restrict correction'; end if;
  if private.demand_snapshot(target)->'requirements'->0->>'ordered'<>'18' then raise exception 'Correction freed demand'; end if;
  begin perform private.demand_apply(actor,gen_random_uuid(),target,'2',jsonb_build_array(a||jsonb_build_object('quantity','1')),'Acquire during correction'); raise exception 'Correction allowed acquisition'; exception when check_violation then null; end;
  result:=private.demand_apply(actor,gen_random_uuid(),target,'2',jsonb_build_array(b||'{"quantity":"0"}'),'Explicit cancellation');
  if result->>'version'<>'3' or not exists(select 1 from private.mrf_downstream_references where request_id=target and kind='demand') then raise exception 'Release erased reference'; end if;
  -- Failed owning save rolls back receipt, claim, version and immutable history.
  original:=private.demand_snapshot(target);
  begin
    update public.material_requests set correction_kind=null,correction_state=null where id=target;
    perform private.demand_apply(actor,gen_random_uuid(),target,'3',jsonb_build_array(a),'Owning transaction');
    raise exception using errcode='P4601';
  exception when sqlstate 'P4601' then null; end;
  if private.demand_snapshot(target)<>original then raise exception 'Owning rollback leaked'; end if;
  update public.material_requests set correction_kind=null,correction_state=null where id=target;
  a:=a||jsonb_build_object('claimId',gen_random_uuid(),'itemId',other_item,'ownerId',gen_random_uuid(),'quantity','0.1');
  b:=b||jsonb_build_object('claimId',gen_random_uuid(),'itemId',other_item,'ownerId',gen_random_uuid(),'quantity','0.2');
  result:=private.demand_apply(actor,gen_random_uuid(),target,'3',jsonb_build_array(a,b),'Exact fractional demand');
  begin perform private.demand_apply(actor,gen_random_uuid(),target,'4',jsonb_build_array(a||jsonb_build_object('quantity','0.100000000000000000000000000000000001')),'No tolerance permitted'); raise exception 'Fraction rounded'; exception when check_violation then null; end;
  foreach original in array array['{"quantity":null}'::jsonb,'{"quantity":"NaN"}','{"quantity":"-1"}','{"quantity":1}','{"quantity":"1e2"}'] loop
    begin perform private.demand_apply(actor,gen_random_uuid(),target,'4',jsonb_build_array(a||original),'Invalid quantity save'); raise exception 'Invalid quantity accepted'; exception when check_violation then null; end;
  end loop;
  -- Session revocation is checked even on a previously successful retry.
  delete from private.session_bindings where session_id=(actor->>'sessionId')::uuid;
  begin perform private.demand_apply(actor,operation,target,'0',jsonb_build_array(a),'Save quantity award'); raise exception 'Revoked session accepted'; exception when insufficient_privilege then null; end;
  begin update private.demand_events set actor_name='Rewrite' where request_id=target; raise exception 'Audit rewritten'; exception when check_violation then null; end;
  begin update private.demand_requirements set quantity=99 where request_id=target; raise exception 'Requirement rewritten'; exception when check_violation then null; end;
end $$;
do $$ declare role_name text; table_name text; begin
  foreach role_name in array array['anon','authenticated','service_role'] loop
    foreach table_name in array array['demand_heads','demand_requirements','demand_claims','demand_operations','demand_events'] loop
      if has_table_privilege(role_name,'private.'||table_name,'SELECT,INSERT,UPDATE,DELETE') then raise exception 'Demand table exposed to %',role_name; end if;
    end loop;
    if has_function_privilege(role_name,'private.demand_apply(jsonb,uuid,uuid,text,jsonb,text)','EXECUTE')
      or has_function_privilege(role_name,'private.demand_snapshot(uuid)','EXECUTE') then raise exception 'Demand function exposed'; end if;
  end loop;
end $$;
rollback;

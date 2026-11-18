-- The owner prepends paymentCheckSql({definitionsOnly:true}); all effects roll back.
create function pg_temp.delivery_fixture() returns jsonb language plpgsql as $$
declare f jsonb:=pg_temp.payment_fixture();
begin
  return f||jsonb_build_object('logistics',pg_temp.po_person(array['Logistics']));
end $$;
create function pg_temp.delivery_input(f jsonb,kind text,target uuid,extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('type',kind,'requestId',gen_random_uuid(),'deliveryId',target,'poId',f->>'po',
    'expectedVersion',coalesce((select version::text from private.delivery_heads where po_id=(f->>'po')::uuid),'0'),
    'reason','Reasoned delivery decision')||extra;
$$;
create function pg_temp.delivery_plan(f jsonb,amount text default '3',route text default 'site') returns jsonb language sql as $$
  select jsonb_build_object('route',route,'plannedDate',(clock_timestamp() at time zone 'Asia/Manila')::date::text,
    'plannedTime','','pickup','Supplier loading bay','destination','Assigned project site','address','Project access road','note','Fixture load',
    'lines',jsonb_build_array(jsonb_build_object('lineId',body->'lines'->0->>'id','quantity',amount))) from private.purchasing_records where id=(f->>'po')::uuid;
$$;
create function pg_temp.delivery_clear(f jsonb) returns void language plpgsql as $$
declare draft uuid; net text;
begin
  if not private.payment_settled((f->>'po')::uuid) then
    select calculation->>'net' into net from private.purchasing_records where id=(f->>'po')::uuid;
    if net::numeric=0 then perform pg_temp.payment_action(f,'noCash');
    else
      draft:=pg_temp.payment_draft(f,net,'DEL-'||gen_random_uuid());
      perform pg_temp.payment_proof(f,draft,replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''));
      perform pg_temp.payment_action(f,'verify',jsonb_build_object('draftId',draft,'evidenceReviewed',true));
    end if;
  end if;
  perform pg_temp.payment_action(f,'clear');
end $$;
create function pg_temp.departure() returns jsonb language sql as $$
  select jsonb_build_object('at',clock_timestamp(),'carrier','','driver','','vehicle','','reference','','note','');
$$;
create function pg_temp.delivery_site_actor(project uuid) returns jsonb language plpgsql as $$
declare site jsonb:=pg_temp.po_person(array['Site Personnel']); session uuid:=gen_random_uuid(); proof jsonb;
begin
  insert into public.project_assignments(user_id,project_id) values((site->>'userId')::uuid,project);
  insert into auth.sessions(id,user_id,created_at,updated_at) values(session,(site->>'userId')::uuid,now(),now());
  proof:=private.login_preflight((site->>'userId')||'@example.invalid');
  perform private.bind_session((site->>'userId')::uuid,session,proof->>'revision',proof->>'credential');
  return site||jsonb_build_object('sessionId',session,'revision',proof->>'revision');
end $$;

-- Delivery assertions
do $$
declare f jsonb:=pg_temp.delivery_fixture(); a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); c uuid:=gen_random_uuid();
  cmd jsonb; receipt jsonb; value jsonb; at_departure jsonb; site jsonb; outsider jsonb; proof jsonb; session uuid;
begin
  cmd:=pg_temp.delivery_input(f,'schedule',a,jsonb_build_object('plan',pg_temp.delivery_plan(f)));
  receipt:=public.delivery_command(f->'logistics',cmd);
  if receipt<>public.delivery_command(f->'logistics',cmd) then raise exception 'Replay mismatch'; end if;
  if (select count(*) from private.delivery_events where delivery_id=a)<>1 then raise exception 'Duplicate event'; end if;
  begin
    perform public.delivery_command(f->'logistics',cmd||jsonb_build_object('reason','Changed retry payload'));
    raise exception 'Changed retry admitted'; exception when sqlstate 'P4803' then null;
  end;
  begin
    perform public.delivery_command(f->'actor',pg_temp.delivery_input(f,'cancel',a));
    raise exception 'Procurement delivery write admitted'; exception when insufficient_privilege then null;
  end;
  begin
    perform public.delivery_command(f->'logistics',pg_temp.delivery_input(f,'schedule',b,jsonb_build_object('plan',pg_temp.delivery_plan(f,'4','warehouse'))));
    raise exception 'Overlapping capacity admitted'; exception when sqlstate 'P4121' then null;
  end;
  begin
    perform public.delivery_command(f->'logistics',pg_temp.delivery_input(f,'dispatch',a,jsonb_build_object('departure',pg_temp.departure())));
    raise exception 'Uncleared departure admitted'; exception when sqlstate 'P4116' then null;
  end;
  perform public.delivery_command(f->'logistics',pg_temp.delivery_input(f,'revise',a,jsonb_build_object('plan',pg_temp.delivery_plan(f,'2'))));
  perform public.delivery_command(f->'logistics',pg_temp.delivery_input(f,'schedule',b,jsonb_build_object('plan',pg_temp.delivery_plan(f,'4','warehouse'))));
  perform public.delivery_command(f->'logistics',pg_temp.delivery_input(f,'cancel',b));
  perform public.delivery_command(f->'logistics',pg_temp.delivery_input(f,'schedule',c,jsonb_build_object('plan',pg_temp.delivery_plan(f,'4','warehouse'))));
  if (select count(distinct ref) from private.deliveries where po_id=(f->>'po')::uuid)<>3 then raise exception 'DEL reused'; end if;
  perform pg_temp.delivery_clear(f);
  begin
    perform public.delivery_command(f->'logistics',pg_temp.delivery_input(f,'dispatch',a,jsonb_build_object('departure',pg_temp.departure()||jsonb_build_object('at',clock_timestamp()-interval '1 day'))));
    raise exception 'Early departure admitted'; exception when sqlstate 'P4123' then null;
  end;
  at_departure:=pg_temp.departure();
  cmd:=pg_temp.delivery_input(f,'dispatch',a,jsonb_build_object('departure',at_departure));
  receipt:=public.delivery_command(f->'logistics',cmd);
  perform pg_temp.payment_action(f,'hold');
  if public.delivery_command(f->'logistics',cmd)<>receipt then raise exception 'Dispatch receipt lost after hold'; end if;
  if (select state from private.deliveries where id=a)<>'dispatched' then raise exception 'Hold rewound dispatch'; end if;
  perform public.delivery_command(f->'logistics',pg_temp.delivery_input(f,'correct',a,jsonb_build_object('departure',at_departure||'{"reference":"Corrected reference"}'::jsonb)));
  begin
    perform public.delivery_command(f->'logistics',pg_temp.delivery_input(f,'cancel',a));
    raise exception 'Dispatched load cancelled'; exception when sqlstate 'P4122' then null;
  end;
  site:=pg_temp.po_person(array['Site Personnel']); outsider:=pg_temp.po_person(array['Site Personnel']);
  insert into public.project_assignments(user_id,project_id) values((site->>'userId')::uuid,(f->>'project')::uuid);
  session:=gen_random_uuid();
  insert into auth.sessions(id,user_id,created_at,updated_at) values(session,(site->>'userId')::uuid,now(),now());
  proof:=private.login_preflight((site->>'userId')||'@example.invalid');
  perform private.bind_session((site->>'userId')::uuid,session,proof->>'revision',proof->>'credential');
  site:=site||jsonb_build_object('sessionId',session,'revision',proof->>'revision');
  value:=public.deliveries_read(site);
  if jsonb_array_length(value->'deliveries')<>3 then raise exception 'Assigned Site deliveries missing'; end if;
  if value::text ~ '"(gross|net|paid|proof|budget|unitPrice|calculation)"' then raise exception 'Financial leak'; end if;
  if jsonb_array_length(public.deliveries_read(outsider)->'deliveries')<>0 then raise exception 'Unassigned Site leak'; end if;
  if has_function_privilege('authenticated','public.delivery_command(jsonb,jsonb)','EXECUTE') or has_table_privilege('service_role','private.deliveries','SELECT') then raise exception 'Direct access admitted'; end if;
end $$;
create function pg_temp.receipt_counts(f jsonb,accepted text,missing text,rejected text) returns jsonb language sql as $$
  select jsonb_build_object('arrivalAt',clock_timestamp(),'extraGoods','',
    'receiptLines',jsonb_build_array(jsonb_build_object('lineId',body->'lines'->0->>'id',
    'accepted',accepted,'missing',missing,'rejected',rejected,'issue','Fixture delivery discrepancy')))
  from private.purchasing_records where id=(f->>'po')::uuid
$$;

do $$
<<receiving>>
declare
  f jsonb:=pg_temp.delivery_fixture(); warehouse uuid:=gen_random_uuid(); onward uuid:=gen_random_uuid();
  another uuid:=gen_random_uuid(); site jsonb; outsider jsonb; command jsonb; value jsonb; proof jsonb;
  session uuid; version_id uuid; generated uuid; signed uuid; lease uuid; file_data jsonb;
begin
  site:=pg_temp.po_person(array['Site Personnel']);
  outsider:=pg_temp.po_person(array['Site Personnel']);
  insert into public.project_assignments(user_id,project_id) values((site->>'userId')::uuid,(f->>'project')::uuid);
  session:=gen_random_uuid();
  insert into auth.sessions(id,user_id,created_at,updated_at) values(session,(site->>'userId')::uuid,now(),now());
  proof:=private.login_preflight((site->>'userId')||'@example.invalid');
  perform private.bind_session((site->>'userId')::uuid,session,proof->>'revision',proof->>'credential');
  site:=site||jsonb_build_object('sessionId',session,'revision',proof->>'revision');
  update public.projects set location='Fixture site address' where id=(f->>'project')::uuid;

  perform public.delivery_command(f->'logistics',pg_temp.delivery_input(f,'schedule',warehouse,
    jsonb_build_object('plan',pg_temp.delivery_plan(f,'6','warehouse'))));
  perform pg_temp.delivery_clear(f);
  perform public.delivery_command(f->'logistics',pg_temp.delivery_input(f,'dispatch',warehouse,jsonb_build_object('departure',pg_temp.departure())));
  begin
    perform public.delivery_command(site,pg_temp.delivery_input(f,'receive',warehouse,pg_temp.receipt_counts(f,'5','0.75','0.25')));
    raise exception 'Site wrote warehouse receipt'; exception when insufficient_privilege then null;
  end;
  begin
    perform public.delivery_command(f->'actor',pg_temp.delivery_input(f,'receive',warehouse,pg_temp.receipt_counts(f,'5','0','0')));
    raise exception 'Unaccounted line accepted'; exception when sqlstate 'P4130' then null;
  end;
  command:=pg_temp.delivery_input(f,'receive',warehouse,pg_temp.receipt_counts(f,'5','0.75','0.25'));
  value:=public.delivery_command(f->'actor',command);
  if value<>public.delivery_command(f->'actor',command) then raise exception 'Receipt replay changed'; end if;
  if exists(select 1 from private.stock_movements where source_id=warehouse) then raise exception 'Warehouse posted pooled stock'; end if;

  perform pg_temp.payment_action(f,'hold');
  perform public.delivery_command(f->'logistics',pg_temp.delivery_input(f,'scheduleForward',onward,
    jsonb_build_object('parentDeliveryId',warehouse,'plan',pg_temp.delivery_plan(f,'3'))));
  begin
    perform public.delivery_command(f->'logistics',pg_temp.delivery_input(f,'scheduleForward',another,
      jsonb_build_object('parentDeliveryId',warehouse,'plan',pg_temp.delivery_plan(f,'3'))));
    raise exception 'Overlapping warehouse reservation admitted'; exception when sqlstate 'P4121' then null;
  end;
  begin
    perform public.delivery_command(f->'actor',pg_temp.delivery_input(f,'recount',warehouse,pg_temp.receipt_counts(f,'2','4','0')));
    raise exception 'Recount consumed reserved custody'; exception when sqlstate 'P4121' then null;
  end;
  begin
    perform public.delivery_command(f->'logistics',pg_temp.delivery_input(f,'schedule',another,
      jsonb_build_object('plan',pg_temp.delivery_plan(f,'1'))));
    raise exception 'Supplier shortfall reopened purchase capacity'; exception when sqlstate 'P4121' then null;
  end;
  perform public.delivery_command(f->'logistics',pg_temp.delivery_input(f,'dispatch',onward,jsonb_build_object('departure',pg_temp.departure())));
  begin
    perform public.delivery_command(f->'actor',pg_temp.delivery_input(f,'recount',warehouse,pg_temp.receipt_counts(f,'5','1','0')));
    raise exception 'Warehouse recount after onward departure'; exception when sqlstate 'P4131' then null;
  end;
  value:=public.delivery_command(site,pg_temp.delivery_input(f,'receive',onward,pg_temp.receipt_counts(f,'0','3','0')));
  begin
    perform public.delivery_command(site,pg_temp.delivery_input(f,'post',onward));
    raise exception 'Zero accepted load posted'; exception when sqlstate 'P4131' then null;
  end;
  value:=public.delivery_command(site,pg_temp.delivery_input(f,'recount',onward,pg_temp.receipt_counts(f,'2.5','0.25','0.25')));
  version_id:=(value->>'receiptVersionId')::uuid;
  command:=pg_temp.delivery_input(f,'post',onward);
  value:=public.delivery_command(site,command);
  if public.delivery_command(site,command)<>value then raise exception 'Posting replay changed'; end if;
  if (select quantity from private.stock_movements where source_id=onward) is distinct from 2.5 then
    raise exception 'Exact site stock credit was not recorded';
  end if;
  if (select count(*) from private.stock_movements where source_id=onward)<>1
    or (select count(*) from private.delivery_receipt_versions where delivery_id=onward)<>2
    or private.delivery_warehouse_allocated(warehouse,pg_temp.delivery_plan(f)->'lines'->0->>'lineId')<>3 then
    raise exception 'Receipt history or custody is inconsistent';
  end if;
  begin
    perform public.delivery_command(site,pg_temp.delivery_input(f,'recount',onward,pg_temp.receipt_counts(f,'3','0','0')));
    raise exception 'Site recount after posting'; exception when sqlstate 'P4131' then null;
  end;
  begin
    perform public.delivery_command(f->'accountant',pg_temp.delivery_input(f,'approveEvidence',onward,jsonb_build_object('receiptVersionId',version_id)));
    raise exception 'Review completed without archived documents'; exception when sqlstate 'P4132' then null;
  end;

  -- Exercise the checked file transitions with synthetic provider identities.
  select id into generated from private.delivery_receipt_files g where g.version_id=receiving.version_id and g.kind='generated';
  file_data:=public.delivery_receipt_file(null,generated,null,'workerClaim',null,'{}');
  lease:=(file_data->>'lease_id')::uuid;
  perform public.delivery_receipt_file(null,generated,null,'workerId',lease,'{"driveId":"synthetic-receipt-pdf"}');
  perform public.delivery_receipt_file(null,generated,null,'workerComplete',lease,jsonb_build_object('size',100,'sha256',repeat('a',64)));
  file_data:=public.delivery_receipt_file(site,null,version_id,'begin',null,
    jsonb_build_object('name','signed.pdf','size',100,'mime','application/pdf','sha256',repeat('b',64)));
  signed:=(file_data->>'id')::uuid;
  file_data:=public.delivery_receipt_file(site,signed,null,'uploadClaim',null,'{}');
  lease:=(file_data->>'lease_id')::uuid;
  perform public.delivery_receipt_file(site,signed,null,'uploadCheckpoint',lease,'{"driveId":"synthetic-signed-proof"}');
  perform public.delivery_receipt_file(site,signed,null,'uploadFinish',lease,'{}');
  file_data:=public.delivery_receipt_file(null,signed,null,'workerClaim',null,'{}');
  perform public.delivery_receipt_file(null,signed,null,'workerComplete',(file_data->>'lease_id')::uuid,'{}');
  perform public.delivery_command(f->'accountant',pg_temp.delivery_input(f,'approveEvidence',onward,jsonb_build_object('receiptVersionId',version_id)));
  value:=public.deliveries_read(site);
  if value::text like '%'||signed::text||'%' then raise exception 'Signed original ID leaked to Site'; end if;
  perform public.delivery_receipt_file(site,generated,null,'read',null,'{}');
  perform public.delivery_receipt_file(f->'accountant',signed,null,'read',null,'{}');
  begin
    perform public.delivery_receipt_file(site,signed,null,'read',null,'{}');
    raise exception 'Site could open the signed original'; exception when insufficient_privilege then null;
  end;
  begin
    perform public.delivery_receipt_file(outsider,generated,null,'read',null,'{}');
    raise exception 'Unassigned Site could open generated evidence'; exception when insufficient_privilege then null;
  end;
  perform public.delivery_command(f->'accountant',pg_temp.delivery_input(f,'requestEvidence',onward,jsonb_build_object('receiptVersionId',version_id)));
  begin
    perform public.delivery_command(f->'accountant',pg_temp.delivery_input(f,'approveEvidence',onward,jsonb_build_object('receiptVersionId',version_id)));
    raise exception 'Requested replacement was bypassed'; exception when sqlstate 'P4132' then null;
  end;
  file_data:=public.delivery_receipt_file(f->'accountant',null,version_id,'begin',null,
    jsonb_build_object('name','replacement.pdf','size',100,'mime','application/pdf','sha256',repeat('c',64)));
  file_data:=public.delivery_receipt_file(f->'accountant',(file_data->>'id')::uuid,null,'uploadClaim',null,'{}');
  lease:=(file_data->>'lease_id')::uuid;
  perform public.delivery_receipt_file(f->'accountant',(file_data->>'id')::uuid,null,'uploadCheckpoint',lease,'{"driveId":"synthetic-signed-replacement"}');
  perform public.delivery_receipt_file(f->'accountant',(file_data->>'id')::uuid,null,'uploadFinish',lease,'{}');
  file_data:=public.delivery_receipt_file(null,(file_data->>'id')::uuid,null,'workerClaim',null,'{}');
  perform public.delivery_receipt_file(null,(file_data->>'id')::uuid,null,'workerComplete',(file_data->>'lease_id')::uuid,'{}');
  perform public.delivery_command(f->'accountant',pg_temp.delivery_input(f,'approveEvidence',onward,jsonb_build_object('receiptVersionId',version_id)));
  if not exists(select 1 from private.delivery_receipt_files where id=signed and state='complete' and not current_evidence) then
    raise exception 'Replacement discarded approved historic evidence';
  end if;
  if (select count(*) from private.stock_movements where source_id=onward)<>1 then raise exception 'Evidence affected stock'; end if;
  if has_function_privilege('authenticated','public.delivery_receipt_file(jsonb,uuid,uuid,text,uuid,jsonb)','EXECUTE')
    or has_table_privilege('service_role','private.delivery_receipt_files','SELECT') then
    raise exception 'Unchecked direct receipt evidence access';
  end if;
end $$;
rollback;

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
rollback;

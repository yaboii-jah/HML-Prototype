create function pg_temp.trip_fixture(amount text default '8') returns jsonb language plpgsql as $$
declare f jsonb:=pg_temp.transfer_fixture(); allocation uuid; line uuid;
begin
  update public.projects set location='Source fixture gate' where id=(f->>'source')::uuid;
  update public.projects set location='Destination fixture gate' where id=(f->>'destination')::uuid;
  allocation:=(public.transfer_command(f->'actor',pg_temp.transfer_input(f,'submit',null,jsonb_build_object('selections',
    jsonb_build_array(pg_temp.transfer_selection(f,'direct',amount)))))->'ids'->>0)::uuid;
  select id into line from private.transfer_lines where transfer_id=allocation;
  perform public.transfer_command(f->'sourceActor',pg_temp.transfer_input(f,'approveRelease',allocation,
    jsonb_build_object('quantities',jsonb_build_object(line,amount))));
  return f||jsonb_build_object('transfer',allocation,'line',line,'logistics',pg_temp.po_person(array['Logistics']));
end $$;

create function pg_temp.trip_input(f jsonb,kind text,trip uuid,extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('type',kind,'requestId',gen_random_uuid(),'transferId',f->>'transfer','tripId',trip,
    'reason','Verified trip decision','expectedVersion',(select version::text from private.transfers where id=(f->>'transfer')::uuid))||extra
$$;

create function pg_temp.trip_plan(f jsonb,route text,amount text) returns jsonb language sql as $$
  select jsonb_build_object('plan',jsonb_build_object('route',route,'plannedDate',(clock_timestamp() at time zone 'Asia/Manila')::date,
    'plannedTime','','directions','Use the loading gate','lines',jsonb_build_array(jsonb_build_object('lineId',f->>'line','quantity',amount))))
$$;

-- Trip assertions
do $$
declare f jsonb:=pg_temp.trip_fixture(); logistics jsonb:=f->'logistics'; procurement jsonb:=f->'actor';
  allocation uuid:=(f->>'transfer')::uuid; line uuid:=(f->>'line')::uuid; ledger uuid:=(f->>'direct')::uuid;
  request uuid:=(f->>'request')::uuid; direct uuid:=gen_random_uuid(); warehouse uuid:=gen_random_uuid();
  replacement uuid:=gen_random_uuid(); command jsonb; result jsonb; projection jsonb; paused_at timestamptz;
  initial_departure jsonb; original_date date; corrected_archive uuid:=gen_random_uuid();
begin
  command:=pg_temp.trip_input(f,'scheduleTrip',direct,pg_temp.trip_plan(f,'site-site','6'));
  begin
    perform public.transfer_trip_command(procurement,command);
    raise exception 'Procurement scheduled a trip'; exception when insufficient_privilege then null;
  end;
  result:=public.transfer_trip_command(logistics,command);
  if result<>public.transfer_trip_command(logistics,command) then raise exception 'Schedule replay changed outcome'; end if;
  perform public.transfer_trip_command(logistics,pg_temp.trip_input(f,'scheduleTrip',warehouse,pg_temp.trip_plan(f,'site-warehouse','2')));
  begin
    perform public.transfer_trip_command(logistics,pg_temp.trip_input(f,'scheduleTrip',replacement,pg_temp.trip_plan(f,'site-warehouse','0.01')));
    raise exception 'Load exceeded booking capacity'; exception when sqlstate 'P4152' then null;
  end;
  if (select ref from private.transfer_trips where id=direct) !~ '-DEL-0001$'
    or (select ref from private.transfer_trips where id=warehouse) !~ '-DEL-0002$'
    or (select destination_address from private.transfer_trips where id=warehouse)<>'155 M. Paterno St., San Juan City' then
    raise exception 'Trips must share the destination sequence and saved warehouse address';
  end if;
  update public.projects set location='Moved fixture gate' where id=(f->>'source')::uuid;
  begin
    perform public.transfer_trip_command(logistics,pg_temp.trip_input(f,'reviseTrip',direct,pg_temp.trip_plan(f,'site-warehouse','5')));
    raise exception 'Existing route changed'; exception when sqlstate 'P4150' then null;
  end;
  perform public.transfer_trip_command(logistics,pg_temp.trip_input(f,'cancelTrip',warehouse));
  if (select quantity from private.stock_reservations where id=line)<>8
    or (select quantity from private.demand_claims where id=line)<>8
    or (select sum(quantity) from private.stock_movements where account_id=ledger)<>10 then
    raise exception 'Cancelling a booking altered stock or demand';
  end if;

  update public.material_requests set correction_kind='documents',correction_state='editing' where id=request;
  paused_at:=clock_timestamp();
  update private.transfer_trips set planned_date=planned_date-1 where id=direct returning planned_date into original_date;
  command:=pg_temp.trip_input(f,'reviseTrip',direct,pg_temp.trip_plan(f,'site-site','4.125'));
  command:=jsonb_set(command,'{plan,plannedDate}',to_jsonb(original_date));
  perform public.transfer_trip_command(logistics,command);
  perform public.transfer_trip_command(logistics,pg_temp.trip_input(f,'scheduleTrip',replacement,pg_temp.trip_plan(f,'site-warehouse','3.875')));
  begin
    perform public.transfer_trip_command(logistics,pg_temp.trip_input(f,'dispatchTrip',direct,
      jsonb_build_object('departure',pg_temp.departure())));
    raise exception 'Departure proceeded during archive correction'; exception when sqlstate 'P4153' then null;
  end;
  update public.material_requests set correction_kind=null,correction_state=null where id=request;
  insert into private.mrf_archive_snapshots(id,request_id,version,source_document,request_version,attachment_revision,snapshot,approved_by,approved_name,approved_at)
    select corrected_archive,s.request_id,s.version+1,s.source_document,s.request_version+1,s.attachment_revision,s.snapshot,s.approved_by,s.approved_name,clock_timestamp()
    from private.mrf_archive_snapshots s where s.id=(f->>'archive')::uuid;
  begin
    perform public.transfer_trip_command(logistics,pg_temp.trip_input(f,'dispatchTrip',direct,
      jsonb_build_object('departure',pg_temp.departure())));
    raise exception 'Departure preceded the corrected archive'; exception when sqlstate 'P4153' then null;
  end;
  insert into private.document_jobs(kind,project_id,request_id,resource_id,actor,original_actor,state,checkpoint)
    values('archive',(f->>'destination')::uuid,request,corrected_archive,'{}','{}','complete','{"formSize":10,"supportingSize":10}');
  insert into private.mrf_archives(snapshot_id,folder_mapping_id,form_file_id,form_sha256,supporting_file_id,supporting_sha256)
    select corrected_archive,folder_mapping_id,'trip-form-'||corrected_archive,form_sha256,'trip-support-'||corrected_archive,supporting_sha256
    from private.mrf_archives where snapshot_id=(f->>'archive')::uuid;
  begin
    perform public.transfer_trip_command(logistics,pg_temp.trip_input(f,'dispatchTrip',direct,
      jsonb_build_object('departure',pg_temp.departure()||jsonb_build_object('at',paused_at))));
    raise exception 'Historical departure during the correction was accepted'; exception when sqlstate 'P4123' then null;
  end;
  initial_departure:=pg_temp.departure()||'{"driver":"Original driver"}';
  command:=pg_temp.trip_input(f,'dispatchTrip',direct,jsonb_build_object('departure',initial_departure));
  result:=public.transfer_trip_command(logistics,command);
  if result<>public.transfer_trip_command(logistics,command)
    or (select count(*) from private.stock_movements where source_id=direct)<>1
    or (select quantity from private.stock_movements where source_id=direct)<>-4.125
    or (select quantity from private.stock_reservations where id=line)<>3.875
    or (select quantity from private.demand_claims where id=line)<>8
    or (select planned_date from private.transfer_trips where id=direct)<>original_date then
    raise exception 'Late departure must debit and shrink the source reservation exactly once, preserving schedule and demand';
  end if;
  begin
    perform public.transfer_trip_command(logistics,pg_temp.trip_input(f,'correctTrip',direct,
      jsonb_build_object('departure',pg_temp.departure()||jsonb_build_object('at',clock_timestamp()+interval '1 day'))));
    raise exception 'Departure correction escaped its original window'; exception when sqlstate 'P4123' then null;
  end;
  perform public.transfer_trip_command(logistics,pg_temp.trip_input(f,'correctTrip',direct,
    jsonb_build_object('departure',initial_departure||'{"driver":"Corrected driver"}')));
  begin
    perform public.transfer_command(procurement,pg_temp.transfer_input(f,'cancel',allocation));
    raise exception 'Legacy cancellation unwound dispatched stock'; exception when sqlstate 'P4151' then null;
  end;
  projection:=public.transfer_read(f->'sourceActor',null,allocation)->'records'->0;
  if projection->'requestId'<>'null' or jsonb_array_length(projection->'trips')<>3
    or projection->'tripCounts'->>'dispatched'<>'1'
    or jsonb_array_length(public.transfer_read(pg_temp.po_person(array['Site Personnel']),null,allocation)->'records')<>0
    or public.transfer_read(pg_temp.po_person(array['Finance']),null,allocation)->'records'->0->>'id' is distinct from allocation::text
    or (select pickup_address from private.transfer_trips where id=direct)<>'Source fixture gate'
    or (select pickup_address from private.transfer_trips where id=replacement)<>'Moved fixture gate'
    or (select snapshot->'departure'->>'driver' from private.transfer_trip_events where trip_id=direct and action='dispatchTrip')<>'Original driver'
    or (select departure->>'driver' from private.transfer_trips where id=direct)<>'Corrected driver' then
    raise exception 'Visibility, frozen locations or retained departure history failed';
  end if;
  begin
    delete from private.transfer_trip_events where trip_id=direct;
    raise exception 'Trip history deleted'; exception when check_violation then null;
  end;
  update public.material_requests set correction_kind='documents',correction_state='editing' where id=request;
  command:=pg_temp.trip_input(f,'cancelRemaining',null);
  result:=public.transfer_trip_command(procurement,command);
  if result<>public.transfer_trip_command(procurement,command)
    or (select state from private.transfer_trips where id=replacement)<>'cancelled'
    or (select state from private.transfer_trips where id=direct)<>'dispatched'
    or (select status from private.transfers where id=allocation)<>'approved'
    or (select released from private.transfer_lines where id=line)<>3.875
    or coalesce((select quantity from private.stock_reservations where id=line),0)<>0
    or (select quantity from private.demand_claims where id=line)<>4.125
    or (select sum(quantity) from private.stock_movements where account_id=ledger)<>5.875
    or exists(select 1 from private.stock_movements m join private.stock_accounts s on s.id=m.account_id where s.project_id=(f->>'destination')::uuid) then
    raise exception 'Release of the undispatched balance changed a departed load, left a booking active or credited destination stock';
  end if;
  if has_function_privilege('authenticated','public.transfer_trip_command(jsonb,jsonb)','EXECUTE')
    or has_table_privilege('service_role','private.transfer_trips','SELECT')
    or has_function_privilege('service_role','private.transfer_trip_stock(jsonb,uuid,jsonb,jsonb,text)','EXECUTE') then
    raise exception 'Unrestricted access to trip authority';
  end if;
end $$;

do $$
declare f jsonb:=pg_temp.trip_fixture(); allocation uuid:=(f->>'transfer')::uuid; line uuid:=(f->>'line')::uuid;
begin
  perform public.transfer_trip_command(f->'actor',pg_temp.trip_input(f,'cancelRemaining',null));
  if (select status from private.transfers where id=allocation)<>'cancelled'
    or (select released from private.transfer_lines where id=line)<>8
    or coalesce((select quantity from private.stock_reservations where id=line),0)<>0
    or (select quantity from private.demand_claims where id=line)<>0 then
    raise exception 'An allocation with no departure must cancel and release all held quantities';
  end if;
end $$;
rollback;

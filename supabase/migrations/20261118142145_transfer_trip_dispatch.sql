alter table private.transfer_lines add column released numeric not null default 0
  check (released>=0 and released<=approved);

create table private.transfer_trips (
  id uuid primary key,
  transfer_id uuid not null references private.transfers(id),
  ref text not null unique,
  route text not null check (route in ('site-site','site-warehouse')),
  pickup_name text not null,
  pickup_address text not null,
  destination_name text not null,
  destination_address text not null,
  planned_date date not null,
  planned_time text not null,
  directions text not null,
  state text not null check (state in ('scheduled','dispatched','cancelled')),
  created_at timestamptz not null default clock_timestamp(),
  departure jsonb,
  departure_floor timestamptz,
  departure_ceiling timestamptz
);
create index transfer_trips_allocation on private.transfer_trips(transfer_id,state);
create table private.transfer_trip_lines (
  trip_id uuid not null references private.transfer_trips(id),
  line_id uuid not null references private.transfer_lines(id),
  quantity numeric not null check (quantity>0 and quantity<'Infinity'::numeric),
  primary key (trip_id,line_id)
);
create index transfer_trip_lines_allocation on private.transfer_trip_lines(line_id);
create table private.transfer_trip_events (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references private.transfer_trips(id),
  action text not null,
  reason text not null,
  actor jsonb not null,
  snapshot jsonb not null,
  recorded_at timestamptz not null default clock_timestamp()
);
create index transfer_trip_events_trip on private.transfer_trip_events(trip_id,recorded_at,id);
create trigger immutable before update or delete on private.transfer_trip_events
  for each row execute function private.document_immutable();

alter table private.transfer_trips enable row level security;
alter table private.transfer_trip_lines enable row level security;
alter table private.transfer_trip_events enable row level security;
revoke all on private.transfer_trips,private.transfer_trip_lines,private.transfer_trip_events from public,anon,authenticated,service_role;

create function private.transfer_trip_totals(target uuid, excluded uuid default null)
returns table (line_id uuid, approved numeric, released numeric, booked numeric, departed numeric)
language sql stable set search_path='' as $$
  select l.id,l.approved,case when t.status='cancelled' then l.approved else l.released end,
    coalesce(sum(tl.quantity) filter (where trip.state='scheduled'),0),
    coalesce(sum(tl.quantity) filter (where trip.state='dispatched'),0)
  from private.transfer_lines l
  join private.transfers t on t.id=l.transfer_id
  left join private.transfer_trip_lines tl on tl.line_id=l.id and tl.trip_id is distinct from excluded
  left join private.transfer_trips trip on trip.id=tl.trip_id
  where l.transfer_id=target
  group by l.id,t.status
$$;

create function private.transfer_trip_snapshot(target uuid) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('id',t.id,'ref',t.ref,'route',t.route,'state',t.state,
    'pickupName',t.pickup_name,'pickupAddress',t.pickup_address,
    'destinationName',t.destination_name,'destinationAddress',t.destination_address,
    'plannedDate',t.planned_date,'plannedTime',t.planned_time,'directions',t.directions,'departure',t.departure,
    'lines',coalesce((select jsonb_agg(jsonb_build_object('lineId',l.line_id,'quantity',trim_scale(l.quantity)::text)
      order by l.line_id) from private.transfer_trip_lines l where l.trip_id=t.id),'[]'))
  from private.transfer_trips t where t.id=target
$$;

create function private.transfer_trip_event(actor jsonb,target uuid,action text,reason text) returns void
language sql set search_path='' as $$
  insert into private.transfer_trip_events(trip_id,action,reason,actor,snapshot)
  values(target,action,reason,private.document_actor_snapshot(actor),private.transfer_trip_snapshot(target))
$$;

create function private.transfer_trip_plan_lines(target uuid, trip uuid, lines jsonb) returns void
language plpgsql set search_path='' as $$
declare entry jsonb; requested uuid; amount numeric; available numeric;
begin
  if jsonb_typeof(lines) is distinct from 'array' or jsonb_array_length(lines) not between 1 and 100
    or (select count(distinct e->>'lineId') from jsonb_array_elements(lines) e)<>jsonb_array_length(lines) then
    raise exception 'Choose distinct approved transfer lines' using errcode='P4150';
  end if;
  delete from private.transfer_trip_lines where trip_id=trip;
  for entry in select * from jsonb_array_elements(lines) loop
    requested:=(entry->>'lineId')::uuid;
    amount:=private.transfer_quantity(entry->'quantity');
    select t.approved-t.released-t.booked-t.departed into available
    from private.transfer_trip_totals(target,trip) t where t.line_id=requested;
    if available is null or amount<=0 or amount>available then
      raise exception 'Load exceeds approved unbooked quantity' using errcode='P4152';
    end if;
    insert into private.transfer_trip_lines(trip_id,line_id,quantity) values(trip,requested,amount);
  end loop;
end $$;

create function private.transfer_trip_stock(actor jsonb,operation uuid,reservations jsonb,postings jsonb,reason text)
returns void language plpgsql set search_path='' as $$
declare accounts jsonb;
begin
  select jsonb_agg(jsonb_build_object('accountId',a.id,'projectId',a.project_id,'description',a.description,
    'unit',a.unit,'expectedVersion',a.version::text) order by a.id) into accounts
  from private.stock_accounts a where a.id in (
    select (r->>'accountId')::uuid from jsonb_array_elements(reservations) r);
  perform private.stock_apply(actor,operation,accounts,postings,reservations,reason);
end $$;

create function private.transfer_trip_command(actor jsonb, command jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
<<trip_write>>
declare
  caller uuid; kind text:=command->>'type'; operation uuid:=(command->>'requestId')::uuid;
  target uuid:=(command->>'transferId')::uuid; selected uuid:=(command->>'tripId')::uuid;
  reason text:=btrim(coalesce(command->>'reason',''));
  allocation private.transfers; trip private.transfer_trips; previous private.transfer_operations;
  source_project public.projects; destination_project public.projects;
  payload jsonb; result jsonb; change jsonb; route text; directions text; planned_time text; planned_date date;
  code text; number bigint; departure jsonb; floor_time timestamptz; ceiling_time timestamptz;
  line private.transfer_lines; load_line record; amount numeric; reserve numeric; dispatched boolean;
  reservations jsonb:='[]'; postings jsonb:='[]'; claims jsonb:='[]'; demand_version text;
begin
  if operation is null or target is null or coalesce(kind,'') not in ('scheduleTrip','reviseTrip','cancelTrip','dispatchTrip','correctTrip','cancelRemaining')
    or (kind<>'cancelRemaining' and selected is null) or length(reason)>2000
    or (kind in ('reviseTrip','cancelTrip','correctTrip','cancelRemaining') and length(reason)<5) then
    raise exception 'Invalid trip command or reason' using errcode='P4150';
  end if;
  perform set_config('lock_timeout','5s',true);
  update private.account_guard set revision=revision+1 where id;
  caller:=private.delivery_actor(actor);
  if actor->>'activeRole' is distinct from (case when kind='cancelRemaining' then 'Procurement' else 'Logistics' end) then
    raise exception 'Current trip or allocation role required' using errcode='42501';
  end if;
  select * into allocation from private.transfers t where t.id=target;
  if allocation.id is null then raise exception 'Transfer unavailable' using errcode='42501'; end if;
  perform 1 from public.projects p where p.id in (allocation.source_id,allocation.destination_id) order by p.id for update;
  perform 1 from public.material_requests r where r.id=allocation.request_id for update;
  select * into allocation from private.transfers t where t.id=target for update;
  payload:=jsonb_build_object('command',command,'role',actor->>'activeRole');
  select * into previous from private.transfer_operations o where o.id=operation;
  if found then
    if previous.actor_id<>caller or previous.payload<>payload then raise exception 'Transfer retry identity reused' using errcode='P4803'; end if;
    return previous.result;
  end if;
  if allocation.version::text is distinct from command->>'expectedVersion' then
    raise exception 'Transfer bookings changed; review the current record' using errcode='40001';
  end if;
  if allocation.status<>'approved' then raise exception 'Approved release required' using errcode='P4151'; end if;

  if kind='cancelRemaining' then
    for load_line in select totals.*,l.stock_id from private.transfer_trip_totals(target) totals
      join private.transfer_lines l on l.id=totals.line_id order by l.stock_id,totals.line_id loop
      amount:=load_line.approved-load_line.released-load_line.departed;
      if amount=0 then continue; end if;
      select * into line from private.transfer_lines l where l.id=load_line.line_id;
      select r.quantity into reserve from private.stock_reservations r
        where r.id=line.id and r.account_id=line.stock_id and r.owner_id=target and r.owner_line_id=line.id;
      if reserve is distinct from amount then raise exception 'Transfer reservation changed' using errcode='P4152'; end if;
      reservations:=reservations||jsonb_build_array(private.transfer_reservation(line,0));
      claims:=claims||jsonb_build_array(private.transfer_claim(line,'transfer',load_line.departed));
      update private.transfer_lines l set released=l.released+amount where l.id=line.id;
    end loop;
    if jsonb_array_length(reservations)=0 then raise exception 'No undispatched quantities remain' using errcode='P4151'; end if;
    for trip in select * from private.transfer_trips t where t.transfer_id=target and t.state='scheduled' order by t.id for update loop
      update private.transfer_trips set state='cancelled' where id=trip.id;
      perform private.transfer_trip_event(actor,trip.id,kind,reason);
    end loop;
    select coalesce((select version::text from private.demand_heads where request_id=allocation.request_id),'0') into demand_version;
    perform private.demand_apply(actor,operation,allocation.request_id,demand_version,claims,reason);
    perform private.transfer_trip_stock(actor,operation,reservations,'[]',reason);
    select exists(select 1 from private.transfer_trips where transfer_id=target and state='dispatched') into dispatched;
    if not dispatched then update private.transfers set status='cancelled' where id=target; end if;
    perform private.transfer_event(actor,target,kind,reason);
  else
    select * into trip from private.transfer_trips t where t.id=selected for update;
    if kind='scheduleTrip' then
      if trip.id is not null then raise exception 'Trip identity already used' using errcode='P4151'; end if;
    elsif trip.transfer_id is distinct from target
      or trip.state is distinct from (case when kind='correctTrip' then 'dispatched' else 'scheduled' end) then
      raise exception 'Trip action unavailable' using errcode='P4151';
    end if;

    if kind in ('scheduleTrip','reviseTrip') then
      change:=command->'plan';
      route:=change->>'route';
      directions:=btrim(change->>'directions');
      planned_time:=change->>'plannedTime';
      if coalesce(change->>'plannedDate','') !~ '^\d{4}-\d{2}-\d{2}$'
        or coalesce(planned_time,'invalid') !~ '^(|([01]\d|2[0-3]):[0-5]\d)$'
        or directions is null or length(directions)>2000 then
        raise exception 'Valid Philippine schedule and directions required' using errcode='P4150';
      end if;
      planned_date:=(change->>'plannedDate')::date;
      if planned_date<(clock_timestamp() at time zone 'Asia/Manila')::date
        and (kind='scheduleTrip' or planned_date is distinct from trip.planned_date) then
        raise exception 'Choose a current or future scheduled date' using errcode='P4150';
      end if;
      if kind='scheduleTrip' then
        if coalesce(route,'') not in ('site-site','site-warehouse') then raise exception 'Choose a first-leg route' using errcode='P4150'; end if;
        select * into source_project from public.projects p where p.id=allocation.source_id;
        select * into destination_project from public.projects p where p.id=allocation.destination_id;
        if btrim(source_project.location)='' or (route='site-site' and btrim(destination_project.location)='') then
          raise exception 'Set the missing project location before scheduling' using errcode='P4154';
        end if;
        code:=destination_project.document_code;
        if code is null then raise exception 'Destination document code required' using errcode='P4154'; end if;
        insert into private.document_counters(project_id,series,last_value) values(allocation.destination_id,'DEL',1)
          on conflict on constraint document_counters_pkey do update set last_value=private.document_counters.last_value+1 returning last_value into number;
        insert into private.transfer_trips(id,transfer_id,ref,route,pickup_name,pickup_address,destination_name,destination_address,
          planned_date,planned_time,directions,state)
        values(selected,target,code||'-DEL-'||lpad(number::text,greatest(4,length(number::text)),'0'),route,source_project.name,source_project.location,
          case when route='site-site' then destination_project.name else 'Company Warehouse' end,
          case when route='site-site' then destination_project.location else '155 M. Paterno St., San Juan City' end,
          planned_date,planned_time,directions,'scheduled');
      else
        if route is not null and route<>trip.route then raise exception 'Cancel and rebook to change the route' using errcode='P4150'; end if;
        update private.transfer_trips set planned_date=trip_write.planned_date,planned_time=trip_write.planned_time,
          directions=trip_write.directions where id=selected;
      end if;
      perform private.transfer_trip_plan_lines(target,selected,change->'lines');
    elsif kind='cancelTrip' then
      update private.transfer_trips set state='cancelled' where id=selected;
    elsif kind='dispatchTrip' then
      if not private.mrf_ready(allocation.request_id) then raise exception 'Current MRF archive required' using errcode='P4153'; end if;
      select greatest(trip.created_at,
        (select max(e.recorded_at) from private.transfer_events e where e.transfer_id=target and e.action='approveRelease'),
        (select a.completed_at from private.mrf_archive_snapshots s join private.mrf_archives a on a.snapshot_id=s.id
          where s.request_id=allocation.request_id order by s.version desc limit 1))
      into floor_time;
      ceiling_time:=clock_timestamp();
      departure:=private.delivery_departure(command->'departure',floor_time,ceiling_time);
      for load_line in select totals.*,tl.quantity from private.transfer_trip_lines tl
        join private.transfer_trip_totals(target,selected) totals on totals.line_id=tl.line_id
        where tl.trip_id=selected order by totals.line_id loop
        amount:=load_line.approved-load_line.released-load_line.departed;
        select * into line from private.transfer_lines l where l.id=load_line.line_id;
        select r.quantity into reserve from private.stock_reservations r
          where r.id=line.id and r.account_id=line.stock_id and r.owner_id=target and r.owner_line_id=line.id;
        if reserve is distinct from amount or load_line.quantity+load_line.booked>amount then
          raise exception 'Booked load exceeds its remaining stock reservation' using errcode='P4152';
        end if;
        reservations:=reservations||jsonb_build_array(private.transfer_reservation(line,amount-load_line.quantity));
        postings:=postings||jsonb_build_array(jsonb_build_object('accountId',line.stock_id,'reservationId',line.id,
          'sourceKind','transfer_trip','sourceId',selected,'sourceLineId',line.id,'postingKind','dispatch',
          'quantity',trim_scale(-load_line.quantity)::text));
      end loop;
      if jsonb_array_length(postings)=0 then raise exception 'Select at least one load line' using errcode='P4150'; end if;
      perform private.transfer_trip_stock(actor,operation,reservations,postings,'Dispatched '||trip.ref);
      update private.transfer_trips set state='dispatched',departure=trip_write.departure,departure_floor=floor_time,departure_ceiling=ceiling_time where id=selected;
    else
      departure:=private.delivery_departure(command->'departure',trip.departure_floor,trip.departure_ceiling);
      update private.transfer_trips set departure=trip_write.departure where id=selected;
    end if;
    perform private.transfer_trip_event(actor,selected,kind,reason);
  end if;
  update private.transfers set version=version+1 where id=target;
  result:=jsonb_build_object('ids',jsonb_build_array(coalesce(selected,target)));
  insert into private.transfer_operations values(operation,allocation.request_id,caller,payload,result);
  perform private.document_notify(allocation.destination_id);
  perform private.document_notify(allocation.source_id);
  return result;
end $$;

create function public.transfer_trip_command(actor jsonb,command jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select private.transfer_trip_command(actor,command) $$;
revoke all on function private.transfer_trip_totals(uuid,uuid),private.transfer_trip_snapshot(uuid),
  private.transfer_trip_event(jsonb,uuid,text,text),private.transfer_trip_plan_lines(uuid,uuid,jsonb),
  private.transfer_trip_stock(jsonb,uuid,jsonb,jsonb,text),private.transfer_trip_command(jsonb,jsonb),
  public.transfer_trip_command(jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.transfer_trip_command(jsonb,jsonb),public.transfer_trip_command(jsonb,jsonb) to service_role;


create or replace function private.transfer_lines_view(target uuid) returns jsonb
language sql stable set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',l.id,'itemId',l.item_id,'stockId',l.stock_id,'requestedName',l.requested_name,
    'requestedUnit',l.requested_unit,'stockName',l.stock_name,'stockUnit',l.stock_unit,
    'proposed',trim_scale(l.proposed)::text,'approved',trim_scale(l.approved)::text,'released',trim_scale(l.released)::text,'explanation',l.explanation
  ) order by l.requested_name,l.id),'[]'::jsonb)
  from private.transfer_lines l where l.transfer_id=target
$$;

create or replace function private.transfer_command(actor jsonb, command jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
<<write_transfer>>
declare
  caller uuid; role_name text:=actor->>'activeRole'; operation uuid:=(command->>'requestId')::uuid;
  selected uuid:=(command->>'transferId')::uuid; action text:=command->>'type';
  reason text:=btrim(coalesce(command->>'reason','')); target uuid; source_id uuid; demand_version text;
  head private.transfers; previous private.transfer_operations; request_row public.material_requests; archive private.mrf_archive_snapshots;
  stock private.stock_accounts; line private.transfer_lines; entered jsonb; item jsonb;
  amount numeric; old_amount numeric; available numeric; match_kind text; next_state text;
  record_id uuid; direct_id uuid; affected uuid[]:='{}'; demand_changes jsonb:='[]'; reservations jsonb:='[]';
  accounts jsonb; result jsonb; payload jsonb; reducing boolean:=false; any_approved boolean:=false; source_context uuid;
begin
  if operation is null or length(reason)>2000
    or coalesce(action,'') not in ('submit','confirmSuitability','requestRelease','approveRelease','reject','cancel') then
    raise exception 'Invalid transfer action' using errcode='P4140';
  end if;
  perform set_config('lock_timeout','5s',true);
  update private.account_guard set revision=revision+1 where id;
  caller:=private.delivery_actor(actor);
  if action='submit' then
    target:=(command->>'mrfId')::uuid;
    source_id:=(command->>'sourceId')::uuid;
  else
    select * into head from private.transfers t where t.id=selected;
    target:=head.request_id;
    source_id:=head.source_id;
  end if;
  select * into request_row from public.material_requests r where r.id=target;
  if request_row.id is null or source_id is null or source_id=request_row.project_id then
    raise exception 'Choose a transfer between different projects' using errcode='42501';
  end if;
  if action in ('submit','requestRelease','cancel') then
    if role_name is distinct from 'Procurement' then raise exception 'Procurement required' using errcode='42501'; end if;
  else
    if role_name is distinct from 'Site Personnel' or not private.request_project_allowed(actor,
      case when action='confirmSuitability' or action='reject' and head.ref is null
        then request_row.project_id else source_id end) then
      raise exception 'Current project assignment required' using errcode='42501';
    end if;
  end if;
  payload:=jsonb_build_object('command',command,'role',role_name);
  select * into previous from private.transfer_operations o where o.id=operation;
  if found then
    if previous.actor_id<>caller or previous.payload<>payload then raise exception 'Transfer retry identity was reused' using errcode='P4803'; end if;
    return previous.result;
  end if;

  perform 1 from public.projects p where p.id in (source_id,request_row.project_id) order by p.id for update;
  perform 1 from public.material_requests r where r.id=target for update;
  if action<>'submit' then
    select * into head from private.transfers t where t.id=selected for update;
    if head.version::text is distinct from command->>'expectedVersion' then
      raise exception 'Transfer changed; review the current record' using errcode='40001';
    end if;
  end if;
  select coalesce((select h.version::text from private.demand_heads h where h.request_id=target),'0') into demand_version;
  if action in ('submit','requestRelease') and demand_version is distinct from command->>'expectedDemand' then
    raise exception 'Demand changed; review current sourcing' using errcode='40001';
  end if;
  if action not in ('reject','cancel') and not private.mrf_ready(target) then
    raise exception 'Wait for the current approved MRF archive' using errcode='P4141';
  end if;
  if action in ('submit','requestRelease') then
    select * into archive from private.mrf_archive_snapshots a where a.request_id=target order by a.version desc limit 1;
  end if;

  if action='submit' then
    if jsonb_typeof(command->'selections') is distinct from 'array'
      or jsonb_array_length(command->'selections') not between 1 and 100
      or (select count(distinct (e->>'itemId',e->>'stockId')) from jsonb_array_elements(command->'selections') e)
         <>jsonb_array_length(command->'selections') then
      raise exception 'Select distinct material and stock pairs' using errcode='P4140';
    end if;
    perform 1 from private.stock_accounts a
      where a.id in (select (e->>'stockId')::uuid from jsonb_array_elements(command->'selections') e) order by a.id for update;
    for entered in select * from jsonb_array_elements(command->'selections') loop
      amount:=private.transfer_quantity(entered->'quantity');
      match_kind:=entered->>'match';
      select * into stock from private.stock_accounts a where a.id=(entered->>'stockId')::uuid and a.project_id=write_transfer.source_id;
      select e into item from jsonb_array_elements(archive.snapshot->'draft'->'items') e where e->>'id'=entered->>'itemId';
      if amount<=0 or stock.id is null or item is null or private.transfer_unit(stock.unit) is distinct from private.transfer_unit(item->>'unit')
        or coalesce(match_kind,'') not in ('direct','alternative') or length(coalesce(entered->>'explanation',''))>2000 then
        raise exception 'Choose matching units and a positive quantity from this source' using errcode='P4140';
      end if;
      if match_kind='direct' and (entered->'verified' is distinct from 'true'::jsonb
        or regexp_replace(lower(btrim(stock.description)),'[[:space:]]+',' ','g')
          is distinct from regexp_replace(lower(btrim(item->>'name')),'[[:space:]]+',' ','g')) then
        raise exception 'Unverified matches need destination suitability review' using errcode='P4140';
      end if;
      if match_kind='alternative' and coalesce(length(btrim(entered->>'explanation')),0)<5 then
        raise exception 'Explain why the alternative meets the specifications' using errcode='P4140';
      end if;
      select (s->>'available')::numeric into available from jsonb_array_elements(private.stock_snapshot(array[stock.id])) s;
      if available<(select sum(private.transfer_quantity(e->'quantity'))
        from jsonb_array_elements(command->'selections') e where e->>'stockId'=stock.id::text) then
        raise exception 'Source stock availability changed' using errcode='P4142';
      end if;
      if match_kind='direct' and direct_id is not null then
        record_id:=direct_id;
      else
        record_id:=gen_random_uuid();
        insert into private.transfers (id,request_id,source_id,destination_id,basis_archive_id,ref,status,submitted_by,note)
          values(record_id,target,source_id,request_row.project_id,archive.id,
            case when match_kind='direct' then private.transfer_number(request_row.project_id) end,
            case when match_kind='direct' then 'release_pending' else 'review_pending' end,caller,reason);
        if match_kind='direct' then direct_id:=record_id; end if;
        affected:=array_append(affected,record_id);
      end if;
      insert into private.transfer_lines (id,transfer_id,item_id,stock_id,requested_name,requested_unit,stock_name,stock_unit,proposed,explanation)
        values(gen_random_uuid(),record_id,(item->>'id')::uuid,stock.id,item->>'name',item->>'unit',stock.description,stock.unit,
          amount,btrim(coalesce(entered->>'explanation',''))) returning * into line;
      demand_changes:=demand_changes||jsonb_build_array(private.transfer_claim(line,case when match_kind='direct' then 'transfer' else 'suitability' end,amount));
      if match_kind='direct' then
        reservations:=reservations||jsonb_build_array(private.transfer_reservation(line,amount));
      end if;
    end loop;
  elsif action='requestRelease' then
    if head.status<>'suitable' then raise exception 'Use a current approved suitability review' using errcode='P4141'; end if;
    select * into line from private.transfer_lines l where l.transfer_id=head.id;
    amount:=private.transfer_quantity(command->'quantity');
    select e into item from jsonb_array_elements(archive.snapshot->'draft'->'items') e where e->>'id'=line.item_id::text;
    if item is null or item->>'name' is distinct from line.requested_name or item->>'unit' is distinct from line.requested_unit
      or amount<=0 or amount>line.approved then
      raise exception 'Review current specifications and the approved quantity' using errcode='P4140';
    end if;
    perform 1 from private.stock_accounts a where a.id=line.stock_id for update;
    select (s->>'available')::numeric into available from jsonb_array_elements(private.stock_snapshot(array[line.stock_id])) s;
    if available<amount then raise exception 'Source stock availability changed' using errcode='P4142'; end if;
    demand_changes:=jsonb_build_array(private.transfer_claim(line,'suitability',0));
    record_id:=gen_random_uuid();
    insert into private.transfers (id,request_id,source_id,destination_id,basis_archive_id,ref,status,submitted_by,suitability_reviewer,origin_review_id,note)
      values(record_id,target,source_id,head.destination_id,archive.id,private.transfer_number(head.destination_id),
        'release_pending',caller,head.suitability_reviewer,head.id,head.note);
    insert into private.transfer_lines (id,transfer_id,item_id,stock_id,requested_name,requested_unit,stock_name,stock_unit,proposed,explanation)
      values(gen_random_uuid(),record_id,line.item_id,line.stock_id,line.requested_name,line.requested_unit,line.stock_name,line.stock_unit,amount,line.explanation)
      returning * into line;
    demand_changes:=demand_changes||jsonb_build_array(private.transfer_claim(line,'transfer',amount));
    reservations:=jsonb_build_array(private.transfer_reservation(line,amount));
    affected:=array[head.id,record_id];
    next_state:='converted';
  else
    if action='confirmSuitability' and head.status<>'review_pending'
      or action='approveRelease' and head.status<>'release_pending'
      or action='reject' and head.status not in ('review_pending','release_pending')
      or action='cancel' and head.status not in ('review_pending','suitable','release_pending','approved') then
      raise exception 'This action is unavailable for the current transfer' using errcode='P4141';
    end if;
    if action='cancel' and head.status='approved'
      and exists(select 1 from private.transfer_trips where transfer_id=head.id) then
      raise exception 'Cancel only the undispatched balance after a trip is booked' using errcode='P4151';
    end if;
    if action='approveRelease' and (caller=head.submitted_by or caller=head.suitability_reviewer) then
      raise exception 'A different assigned source reviewer must approve this release' using errcode='P4143';
    end if;
    if action='approveRelease' and (
      jsonb_typeof(command->'quantities') is distinct from 'object'
      or (select count(*) from jsonb_object_keys(command->'quantities'))<>(select count(*) from private.transfer_lines l where l.transfer_id=head.id)
    ) then raise exception 'Review all quantities in one decision' using errcode='P4140'; end if;
    for line in select * from private.transfer_lines l where l.transfer_id=head.id order by l.id loop
      old_amount:=case when head.status in ('approved','suitable') then line.approved else line.proposed end;
      amount:=case when action='approveRelease' then private.transfer_quantity(command->'quantities'->(line.id::text))
        when action='confirmSuitability' then private.transfer_quantity(command->'quantity') else 0 end;
      if amount>old_amount then raise exception 'Approval cannot exceed the requested quantity' using errcode='P4140'; end if;
      reducing:=reducing or amount<old_amount;
      any_approved:=any_approved or amount>0;
      demand_changes:=demand_changes||jsonb_build_array(private.transfer_claim(line,case when head.ref is null then 'suitability' else 'transfer' end,amount));
      if head.ref is not null then reservations:=reservations||jsonb_build_array(private.transfer_reservation(line,amount)); end if;
      if action in ('confirmSuitability','approveRelease') then
        update private.transfer_lines l set approved=amount where l.id=line.id;
      end if;
    end loop;
    if action in ('confirmSuitability','approveRelease') and not any_approved then
      raise exception 'Approve a positive quantity or reject the request' using errcode='P4140';
    end if;
    if (reducing or action in ('confirmSuitability','reject','cancel')) and length(reason)<5 then
      raise exception 'Record a reason or written specification confirmation' using errcode='P4140';
    end if;
    if action='confirmSuitability' and command->'specificationsConfirmed' is distinct from 'true'::jsonb then
      raise exception 'Confirm the alternative has the same specifications' using errcode='P4140';
    end if;
    next_state:=case action when 'confirmSuitability' then 'suitable' when 'approveRelease' then 'approved'
      when 'reject' then 'rejected' else 'cancelled' end;
    if role_name='Site Personnel' and head.ref is not null then source_context:=head.id; end if;
    affected:=array[head.id];
  end if;
  if length(reason)<5 then reason:='Transfer '||action; end if;

  perform private.demand_apply(actor,operation,target,demand_version,demand_changes,reason,source_context);
  if jsonb_array_length(reservations)>0 then
    select jsonb_agg(jsonb_build_object('accountId',a.id,'projectId',a.project_id,'description',a.description,
      'unit',a.unit,'expectedVersion',a.version::text) order by a.id)
    into accounts from private.stock_accounts a
    where a.id in (select (e->>'accountId')::uuid from jsonb_array_elements(reservations) e);
    perform private.stock_apply(actor,operation,accounts,'[]',reservations,reason);
  end if;
  if next_state is not null then
    update private.transfers t set status=next_state,version=version+1,
      suitability_reviewer=case when action='confirmSuitability' then caller else t.suitability_reviewer end
      where t.id=head.id;
  end if;
  foreach record_id in array affected loop
    perform private.transfer_event(actor,record_id,action,reason);
  end loop;
  result:=jsonb_build_object('ids',to_jsonb(affected));
  insert into private.transfer_operations values(operation,target,caller,payload,result);
  perform private.document_notify(request_row.project_id);
  perform private.document_notify(source_id);
  return result;
end $$;


create or replace function private.transfer_read(actor jsonb, target_request uuid, target_transfer uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  caller uuid:=private.delivery_actor(actor); role_name text:=actor->>'activeRole';
  request_row public.material_requests; archive private.mrf_archive_snapshots;
  ready boolean; demand jsonb; items jsonb:='[]'; candidates jsonb:='[]'; records jsonb;
begin
  if target_request is not null then
    select * into request_row from public.material_requests r where r.id=target_request;
    if request_row.id is null or not private.request_project_allowed(actor,request_row.project_id) then return null; end if;
  end if;
  if role_name='Procurement' and request_row.id is not null then
    ready:=private.mrf_ready(target_request);
    demand:=private.demand_snapshot(target_request);
    select * into archive from private.mrf_archive_snapshots a where a.request_id=target_request order by a.version desc limit 1;
    select coalesce(jsonb_agg(jsonb_build_object('id',i->>'id','name',i->>'name','unit',i->>'unit',
      'unassigned',coalesce(d->>'unassigned',i->>'quantity')) order by position),'[]')
    into items from jsonb_array_elements(archive.snapshot->'draft'->'items') with ordinality item(i,position)
    left join lateral (select x as d from jsonb_array_elements(demand->'requirements') x where x->>'itemId'=i->>'id') totals on true;
    if ready then
      select coalesce(jsonb_agg(jsonb_build_object('id',s->>'accountId','projectId',p.id,'project',p.name,
        'name',s->>'description','unit',s->>'unit','available',s->>'available') order by p.name,s->>'description',s->>'accountId'),'[]')
      into candidates
      from jsonb_array_elements(private.stock_snapshot(array(
        select a.id from private.stock_accounts a where a.project_id<>request_row.project_id
          and exists(select 1 from jsonb_array_elements(items) i
            where private.transfer_unit(i->>'unit')=private.transfer_unit(a.unit))
      ))) s join public.projects p on p.id=(s->>'projectId')::uuid
      where (s->>'available')::numeric>0;
    end if;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',t.id,'ref',t.ref,'requestRef',r.ref,
    'requestId',case when private.request_project_allowed(actor,t.destination_id) then r.id end,
    'source',source.name,'destination',destination.name,'status',t.status,'version',t.version::text,
    'note',t.note,'ready',private.mrf_ready(t.request_id),'demandVersion',
    case when role_name='Procurement' then coalesce((select version::text from private.demand_heads h where h.request_id=t.request_id),'0') end,
    'canReview',role_name='Site Personnel' and (
      t.status='review_pending' and private.request_project_allowed(actor,t.destination_id)
      or t.status='release_pending' and private.request_project_allowed(actor,t.source_id)),
    'canApprove',caller<>t.submitted_by and caller is distinct from t.suitability_reviewer,
    'canCancel',role_name='Procurement' and t.status in ('review_pending','suitable','release_pending'),
    'canManageTrips',role_name='Logistics' and t.status='approved',
    'canCancelRemaining',role_name='Procurement' and t.status='approved' and exists(
      select 1 from private.transfer_trip_totals(t.id) totals where totals.approved>totals.released+totals.departed),
    'tripCounts',(select jsonb_build_object('scheduled',count(*) filter(where trip.state='scheduled'),
      'dispatched',count(*) filter(where trip.state='dispatched'),'cancelled',count(*) filter(where trip.state='cancelled'))
      from private.transfer_trips trip where trip.transfer_id=t.id),
    'tripTotals',case when target_transfer is not null then coalesce((
      select jsonb_agg(jsonb_build_object('lineId',totals.line_id,'approved',trim_scale(totals.approved)::text,
        'released',trim_scale(totals.released)::text,'booked',trim_scale(totals.booked)::text,'departed',trim_scale(totals.departed)::text,
        'schedulable',trim_scale(totals.approved-totals.released-totals.booked-totals.departed)::text) order by totals.line_id)
      from private.transfer_trip_totals(t.id) totals),'[]') else '[]'::jsonb end,
    'trips',case when target_transfer is not null then coalesce((
      select jsonb_agg(private.transfer_trip_snapshot(trip.id)||jsonb_build_object('history',coalesce((
        select jsonb_agg(jsonb_build_object('id',e.id,'action',e.action,'reason',e.reason,'at',e.recorded_at,'actorName',e.actor->>'name',
          'snapshot',e.snapshot) order by e.recorded_at,e.id) from private.transfer_trip_events e where e.trip_id=trip.id),'[]'))
        order by trip.created_at,trip.id) from private.transfer_trips trip where trip.transfer_id=t.id),'[]') else '[]'::jsonb end,
    'canRequestRelease',role_name='Procurement' and t.status='suitable',
    'lines',private.transfer_lines_view(t.id),
    'history',case when target_transfer is not null then coalesce((
      select jsonb_agg(jsonb_build_object('id',e.id,'action',e.action,'reason',e.reason,'at',e.recorded_at,
        'actorName',e.actor->>'name','actorRole',e.actor->>'activeRole','snapshot',e.snapshot) order by e.recorded_at,e.id)
      from private.transfer_events e where e.transfer_id=t.id),'[]') else '[]'::jsonb end
  ) order by t.created_at desc,t.id),'[]')
  into records from private.transfers t join public.material_requests r on r.id=t.request_id
  join public.projects source on source.id=t.source_id join public.projects destination on destination.id=t.destination_id
  where (target_request is null or t.request_id=target_request) and (target_transfer is null or t.id=target_transfer)
    and (
      t.ref is not null and (private.request_project_allowed(actor,t.destination_id) or private.request_project_allowed(actor,t.source_id))
      or t.ref is null and (role_name='Procurement' or role_name='Site Personnel' and private.request_project_allowed(actor,t.destination_id))
    );
  return jsonb_build_object('records',records,'sourcing',
    case when role_name='Procurement' and request_row.id is not null then jsonb_build_object(
      'requestId',target_request,'requestRef',request_row.ref,'ready',ready,'demandVersion',demand->>'version',
      'items',items,'candidates',candidates) end);
end $$;

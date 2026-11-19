alter table private.transfer_trips
  add column parent_trip_id uuid references private.transfer_trips(id),
  drop constraint transfer_trips_route_check,
  add constraint transfer_trip_route check (
    (route in ('site-site','site-warehouse') and parent_trip_id is null)
    or (route='warehouse-site' and parent_trip_id is not null)
  );
create index transfer_trip_parent on private.transfer_trips(parent_trip_id) where parent_trip_id is not null;

create table private.transfer_receipts (
  trip_id uuid primary key references private.transfer_trips(id),
  arrival_at timestamptz not null,
  revision integer not null check (revision > 0),
  posted_at timestamptz,
  review_state text not null default 'pending' check (review_state in ('pending','needs_evidence','approved')),
  review_reason text not null default ''
);

create table private.transfer_receipt_versions (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references private.transfer_receipts(trip_id),
  revision integer not null,
  snapshot jsonb not null,
  actor jsonb not null,
  recorded_at timestamptz not null default clock_timestamp(),
  unique (trip_id,revision)
);

create table private.transfer_receipt_files (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references private.transfer_receipt_versions(id),
  kind text not null check (kind in ('generated','signed','supporting')),
  state text not null default 'pending' check (state in ('pending','uploading','processing','failed','complete')),
  current_evidence boolean not null default false,
  name text not null,
  mime text not null default 'application/pdf',
  size integer,
  sha256 text,
  drive_id text,
  folder_id text,
  root_id text,
  session_ticket text,
  offset_bytes integer not null default 0,
  lease_id uuid,
  lease_until timestamptz,
  created_by uuid references public.profiles(user_id),
  created_revision bigint,
  created_role text,
  created_actor jsonb,
  created_at timestamptz not null default clock_timestamp(),
  check (kind<>'generated' or not current_evidence)
);
create index transfer_receipt_files_version on private.transfer_receipt_files(version_id);
create index transfer_receipt_files_author on private.transfer_receipt_files(created_by) where created_by is not null;
create unique index transfer_receipt_generated on private.transfer_receipt_files(version_id) where kind='generated';

do $$
declare relation text;
begin
  foreach relation in array array['transfer_receipts','transfer_receipt_versions','transfer_receipt_files'] loop
    execute format('alter table private.%I enable row level security',relation);
    execute format('revoke all on private.%I from public,anon,authenticated,service_role',relation);
  end loop;
end $$;
create trigger immutable before update or delete on private.transfer_receipt_versions
  for each row execute function private.document_immutable();

create function private.delivery_post_stock(actor jsonb, operation uuid, target uuid, project uuid, lines jsonb, reason text, source_kind text)
returns void language plpgsql security definer set search_path='' as $$
declare
  line jsonb; account private.stock_accounts; account_id uuid; entry jsonb;
  accounts jsonb:='[]'; postings jsonb:='[]';
begin
  for line in select value from jsonb_array_elements(lines) where (value->>'stockQuantity')::numeric>0 loop
    select value into entry from jsonb_array_elements(accounts)
    where lower(btrim(value->>'description'))=lower(btrim(line->>'stockDescription'))
      and lower(btrim(value->>'unit'))=lower(btrim(line->>'stockUnit'));
    if found then
      account_id:=(entry->>'accountId')::uuid;
    else
      select * into account from private.stock_accounts a where a.project_id=project
        and a.description_key=lower(btrim(line->>'stockDescription'))
        and a.unit_key=lower(btrim(line->>'stockUnit'));
      account_id:=coalesce(account.id,gen_random_uuid());
      accounts:=accounts||jsonb_build_array(jsonb_build_object(
        'accountId',account_id,'projectId',project,'description',line->>'stockDescription',
        'unit',line->>'stockUnit','expectedVersion',coalesce(account.version,0)::text));
    end if;
    postings:=postings||jsonb_build_array(jsonb_build_object(
      'accountId',account_id,'sourceKind',source_kind,'sourceId',target,
      'sourceLineId',line->>'lineId','postingKind','receipt','quantity',line->>'stockQuantity'));
  end loop;
  if jsonb_array_length(postings)=0 then
    raise exception 'No stock to post' using errcode='P4131';
  end if;
  perform private.stock_apply(actor,operation,accounts,postings,'[]',reason);
end $$;

revoke all on function private.delivery_post_stock(jsonb,uuid,uuid,uuid,jsonb,text,text)
  from public,anon,authenticated,service_role;
create or replace function private.delivery_post_stock(actor jsonb, operation uuid, target uuid, project uuid, lines jsonb, reason text)
returns void language sql security definer set search_path='' as $$
  select private.delivery_post_stock(actor,operation,target,project,lines,reason,'purchase_receipt')
$$;

create function private.transfer_custody_used(parent uuid, material uuid, excluded uuid default null)
returns numeric language sql stable set search_path='' as $$
  select coalesce(sum(l.quantity),0)
  from private.transfer_trips t join private.transfer_trip_lines l on l.trip_id=t.id
  where t.parent_trip_id=parent and t.state<>'cancelled' and l.line_id=material
    and t.id is distinct from excluded
$$;

create function private.transfer_custody(parent uuid)
returns jsonb language sql stable set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('lineId',line->>'lineId',
    'available',trim_scale((line->>'accepted')::numeric-
      private.transfer_custody_used(parent,(line->>'lineId')::uuid))::text) order by line->>'lineId'),'[]')
  from private.transfer_receipts h
  join private.transfer_receipt_versions v on v.trip_id=h.trip_id and v.revision=h.revision
  cross join lateral jsonb_array_elements(v.snapshot->'lines') line
  where h.trip_id=parent
$$;

create function private.transfer_shortage(material uuid, excluded uuid default null)
returns numeric language sql stable set search_path='' as $$
  select coalesce(sum((line->>'missing')::numeric+(line->>'rejected')::numeric),0)
  from private.transfer_trip_lines l
  join private.transfer_receipts h on h.trip_id=l.trip_id
  join private.transfer_receipt_versions v on v.trip_id=h.trip_id and v.revision=h.revision
  cross join lateral jsonb_array_elements(v.snapshot->'lines') line
  where l.line_id=material and l.trip_id is distinct from excluded and line->>'lineId'=material::text
$$;

create or replace function private.transfer_trip_totals(target uuid, excluded uuid default null)
returns table (line_id uuid, approved numeric, released numeric, booked numeric, departed numeric)
language sql stable set search_path='' as $$
  select l.id,l.approved,case when t.status='cancelled' then l.approved else l.released end,
    coalesce(sum(tl.quantity) filter (where trip.state='scheduled'),0),
    coalesce(sum(tl.quantity) filter (where trip.state='dispatched'),0)
  from private.transfer_lines l
  join private.transfers t on t.id=l.transfer_id
  left join private.transfer_trip_lines tl on tl.line_id=l.id and tl.trip_id is distinct from excluded
  left join private.transfer_trips trip on trip.id=tl.trip_id and trip.parent_trip_id is null
  where l.transfer_id=target
  group by l.id,t.status
$$;

create or replace function private.transfer_trip_snapshot(target uuid) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('id',t.id,'ref',t.ref,'route',t.route,'state',t.state,'parentTripId',t.parent_trip_id,
    'pickupName',t.pickup_name,'pickupAddress',t.pickup_address,
    'destinationName',t.destination_name,'destinationAddress',t.destination_address,
    'plannedDate',t.planned_date,'plannedTime',t.planned_time,'directions',t.directions,'departure',t.departure,
    'lines',coalesce((select jsonb_agg(jsonb_build_object('lineId',l.line_id,'quantity',trim_scale(l.quantity)::text)
      order by l.line_id) from private.transfer_trip_lines l where l.trip_id=t.id),'[]'))
  from private.transfer_trips t where t.id=target
$$;

create or replace function private.transfer_trip_plan_lines(target uuid, trip uuid, lines jsonb) returns void
language plpgsql set search_path='' as $$
declare entry jsonb; requested uuid; amount numeric; available numeric; parent uuid;
begin
  if jsonb_typeof(lines) is distinct from 'array' or jsonb_array_length(lines) not between 1 and 100
    or (select count(distinct e->>'lineId') from jsonb_array_elements(lines) e)<>jsonb_array_length(lines) then
    raise exception 'Choose distinct approved transfer lines' using errcode='P4150';
  end if;
  select t.parent_trip_id into parent from private.transfer_trips t where t.id=trip;
  delete from private.transfer_trip_lines where trip_id=trip;
  for entry in select * from jsonb_array_elements(lines) loop
    requested:=(entry->>'lineId')::uuid;
    amount:=private.transfer_quantity(entry->'quantity');
    if parent is null then
      select t.approved-t.released-t.booked-t.departed into available
      from private.transfer_trip_totals(target,trip) t where t.line_id=requested;
    else
      select (l->>'accepted')::numeric-private.transfer_custody_used(parent,requested,trip)
      into available
      from private.transfer_receipts h
      join private.transfer_receipt_versions v on v.trip_id=h.trip_id and v.revision=h.revision
      cross join lateral jsonb_array_elements(v.snapshot->'lines') l
      where h.trip_id=parent and l->>'lineId'=requested::text;
    end if;
    if available is null or amount<=0 or amount>available then
      raise exception 'Load exceeds approved unbooked quantity' using errcode='P4152';
    end if;
    insert into private.transfer_trip_lines(trip_id,line_id,quantity) values(trip,requested,amount);
  end loop;
end $$;

create or replace function private.transfer_trip_command(actor jsonb, command jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
<<trip_write>>
declare
  caller uuid; kind text:=command->>'type'; operation uuid:=(command->>'requestId')::uuid;
  target uuid:=(command->>'transferId')::uuid; selected uuid:=(command->>'tripId')::uuid;
  reason text:=btrim(coalesce(command->>'reason',''));
  allocation private.transfers; trip private.transfer_trips; parent private.transfer_trips; previous private.transfer_operations;
  source_project public.projects; destination_project public.projects;
  payload jsonb; result jsonb; change jsonb; route text; directions text; planned_time text; planned_date date;
  code text; number bigint; arrival timestamptz; departure jsonb; floor_time timestamptz; ceiling_time timestamptz;
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
      claims:=claims||jsonb_build_array(private.transfer_claim(line,'transfer',load_line.departed-private.transfer_shortage(line.id)));
      update private.transfer_lines l set released=l.released+amount where l.id=line.id;
    end loop;
    if jsonb_array_length(reservations)=0 then raise exception 'No undispatched quantities remain' using errcode='P4151'; end if;
    for trip in select * from private.transfer_trips t where t.transfer_id=target and t.parent_trip_id is null and t.state='scheduled' order by t.id for update loop
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
        if coalesce(route,'') not in ('site-site','site-warehouse','warehouse-site') then
          raise exception 'Choose a transfer route' using errcode='P4150';
        end if;
        if route='warehouse-site' then
          select * into parent from private.transfer_trips t where t.id=(change->>'parentTripId')::uuid
            and t.transfer_id=target and t.route='site-warehouse' and t.state='dispatched';
          if parent.id is null or not exists(select 1 from private.transfer_receipts h where h.trip_id=parent.id) then
            raise exception 'Confirm the warehouse receipt before forwarding' using errcode='P4161';
          end if;
        elsif change->>'parentTripId' is not null then
          raise exception 'A first-leg trip has no warehouse receipt' using errcode='P4150';
        end if;
        select * into source_project from public.projects p where p.id=allocation.source_id;
        select * into destination_project from public.projects p where p.id=allocation.destination_id;
        if (parent.id is null and btrim(source_project.location)='') or (route<>'site-warehouse' and btrim(destination_project.location)='') then
          raise exception 'Set the missing project location before scheduling' using errcode='P4154';
        end if;
        code:=destination_project.document_code;
        if code is null then raise exception 'Destination document code required' using errcode='P4154'; end if;
        insert into private.document_counters(project_id,series,last_value) values(allocation.destination_id,'DEL',1)
          on conflict on constraint document_counters_pkey do update set last_value=private.document_counters.last_value+1 returning last_value into number;
        insert into private.transfer_trips(id,transfer_id,ref,route,pickup_name,pickup_address,destination_name,destination_address,
          planned_date,planned_time,directions,state,parent_trip_id)
        values(selected,target,code||'-DEL-'||lpad(number::text,greatest(4,length(number::text)),'0'),route,
          coalesce(parent.destination_name,source_project.name),coalesce(parent.destination_address,source_project.location),
          case when route<>'site-warehouse' then destination_project.name else 'Company Warehouse' end,
          case when route<>'site-warehouse' then destination_project.location else '155 M. Paterno St., San Juan City' end,
          planned_date,planned_time,directions,'scheduled',parent.id);
      else
        if route is distinct from trip.route or (change->>'parentTripId')::uuid is distinct from trip.parent_trip_id then raise exception 'Cancel and rebook to change the route' using errcode='P4150'; end if;
        update private.transfer_trips set planned_date=trip_write.planned_date,planned_time=trip_write.planned_time,
          directions=trip_write.directions where id=selected;
      end if;
      perform private.transfer_trip_plan_lines(target,selected,change->'lines');
    elsif kind='cancelTrip' then
      update private.transfer_trips set state='cancelled' where id=selected;
    elsif kind='dispatchTrip' then
      ceiling_time:=clock_timestamp();
      if trip.parent_trip_id is not null then
        select greatest(trip.created_at,h.arrival_at) into floor_time
        from private.transfer_receipts h where h.trip_id=trip.parent_trip_id;
        if floor_time is null then raise exception 'Warehouse custody unavailable' using errcode='P4161'; end if;
        departure:=private.delivery_departure(command->'departure',floor_time,ceiling_time);
      else
        if not private.mrf_ready(allocation.request_id) then raise exception 'Current MRF archive required' using errcode='P4153'; end if;
        select greatest(trip.created_at,
          (select max(e.recorded_at) from private.transfer_events e where e.transfer_id=target and e.action='approveRelease'),
          (select a.completed_at from private.mrf_archive_snapshots s join private.mrf_archives a on a.snapshot_id=s.id
            where s.request_id=allocation.request_id order by s.version desc limit 1))
        into floor_time;
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
      end if;
      update private.transfer_trips set state='dispatched',departure=trip_write.departure,departure_floor=floor_time,departure_ceiling=ceiling_time where id=selected;
    else
      select h.arrival_at into arrival from private.transfer_receipts h where h.trip_id=trip.id;
      departure:=private.delivery_departure(command->'departure',trip.departure_floor,least(trip.departure_ceiling,arrival));
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

create function private.transfer_receipt_lines(target uuid, load jsonb, submitted jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare
  planned jsonb; entered jsonb; material private.transfer_lines;
  result jsonb:='[]'; key text; expected numeric; accepted numeric; missing numeric; rejected numeric;
begin
  if jsonb_typeof(submitted) is distinct from 'array' or jsonb_array_length(submitted)<>jsonb_array_length(load)
    or (select count(distinct x->>'lineId') from jsonb_array_elements(submitted) x)<>jsonb_array_length(load) then
    raise exception 'Count every dispatched line once' using errcode='P4160';
  end if;
  for planned in select * from jsonb_array_elements(load) loop
    select x into entered from jsonb_array_elements(submitted) x where x->>'lineId'=planned->>'lineId';
    foreach key in array array['accepted','missing','rejected'] loop
      if jsonb_typeof(entered->key) is distinct from 'string' or length(entered->>key)>80
        or entered->>key !~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$' then
        raise exception 'Use exact nonnegative counts' using errcode='P4160';
      end if;
    end loop;
    expected:=(planned->>'quantity')::numeric;
    accepted:=(entered->>'accepted')::numeric;
    missing:=(entered->>'missing')::numeric;
    rejected:=(entered->>'rejected')::numeric;
    if accepted+missing+rejected<>expected or jsonb_typeof(entered->'issue') is distinct from 'string'
      or length(entered->>'issue')>2000 or (missing+rejected>0 and length(btrim(entered->>'issue'))<5) then
      raise exception 'Counts must equal the dispatched quantity; explain discrepancies' using errcode='P4160';
    end if;
    select * into strict material from private.transfer_lines l
    where l.transfer_id=target and l.id=(planned->>'lineId')::uuid;
    result:=result||jsonb_build_array(jsonb_build_object(
      'lineId',planned->>'lineId','expected',trim_scale(expected)::text,
      'accepted',trim_scale(accepted)::text,'missing',trim_scale(missing)::text,
      'rejected',trim_scale(rejected)::text,'issue',btrim(entered->>'issue'),
      'description',material.stock_name,'unit',material.stock_unit,
      'stockDescription',material.requested_name,'stockUnit',material.requested_unit,
      'stockQuantity',trim_scale(accepted)::text));
  end loop;
  return result;
end $$;

create function private.transfer_receipt_command(actor jsonb, command jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  kind text:=command->>'type'; role_name text:=actor->>'activeRole';
  operation uuid:=(command->>'requestId')::uuid; target uuid:=(command->>'transferId')::uuid;
  trip_id uuid:=(command->>'tripId')::uuid; reason text:=btrim(coalesce(command->>'reason',''));
  caller uuid; receiver text; allocation private.transfers; trip private.transfer_trips;
  previous private.transfer_operations; payload jsonb; result jsonb;
  head private.transfer_receipts; receipt private.transfer_receipt_versions; arrival timestamptz;
  load jsonb; lines jsonb; snapshot jsonb; line jsonb; material private.transfer_lines;
  next_revision integer; version_id uuid; archive_id uuid; claims jsonb:='[]'; claim_qty numeric; previous_qty numeric;
  reviewed_files jsonb;
begin
  if operation is null or target is null or trip_id is null
    or coalesce(kind,'') not in ('receiveTrip','recountTrip','postTrip','approveTripEvidence','requestTripEvidence')
    or length(reason)>2000 or (kind in ('recountTrip','requestTripEvidence') and length(reason)<5) then
    raise exception 'Invalid receipt action or reason' using errcode='P4160';
  end if;

  perform set_config('lock_timeout','5s',true);
  update private.account_guard set revision=revision+1 where id;
  caller:=private.delivery_actor(actor);
  select * into allocation from private.transfers t where t.id=target;
  if allocation.id is null or not private.request_project_allowed(actor,allocation.destination_id) then
    raise exception 'Transfer receipt unavailable' using errcode='42501';
  end if;
  perform 1 from public.projects p where p.id in (allocation.source_id,allocation.destination_id) order by p.id for update;
  perform 1 from public.material_requests r where r.id=allocation.request_id for update;
  select * into allocation from private.transfers t where t.id=target for update;
  select * into trip from private.transfer_trips t where t.id=trip_id and t.transfer_id=target for update;
  receiver:=case when trip.route='site-warehouse' then 'Procurement' else 'Site Personnel' end;
  if trip.id is null or role_name is distinct from (
    case when kind in ('approveTripEvidence','requestTripEvidence') then 'Accounting' else receiver end
  ) then raise exception 'Receiving or Accounting authorization required' using errcode='42501'; end if;

  payload:=jsonb_build_object('command',command,'role',role_name);
  select * into previous from private.transfer_operations o where o.id=operation;
  if found then
    if previous.actor_id<>caller or previous.payload<>payload then
      raise exception 'Transfer retry identity reused' using errcode='P4803';
    end if;
    return previous.result;
  end if;
  if allocation.version::text is distinct from command->>'expectedVersion' then
    raise exception 'Transfer changed; review the current receipt' using errcode='40001';
  end if;
  if trip.state<>'dispatched' then raise exception 'Dispatch the trip before receiving' using errcode='P4161'; end if;

  select * into head from private.transfer_receipts h where h.trip_id=trip.id for update;
  select * into receipt from private.transfer_receipt_versions v where v.trip_id=trip.id and v.revision=head.revision;
  if kind='receiveTrip' then
    if head.trip_id is not null then raise exception 'Trip already received' using errcode='P4161'; end if;
    if coalesce(command->>'arrivalAt','') !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$' then
      raise exception 'Actual Philippine arrival required' using errcode='P4160';
    end if;
    arrival:=(command->>'arrivalAt')::timestamptz;
    if not isfinite(arrival) or arrival<(trip.departure->>'at')::timestamptz or arrival>clock_timestamp() then
      raise exception 'Arrival must fall between departure and confirmation' using errcode='P4160';
    end if;
    next_revision:=1;
  elsif head.trip_id is null then
    raise exception 'Confirm receiving first' using errcode='P4161';
  elsif kind='postTrip' then
    if receiver<>'Site Personnel' or head.posted_at is not null or not exists(
      select 1 from jsonb_array_elements(receipt.snapshot->'lines') l where (l->>'accepted')::numeric>0
    ) then
      raise exception 'Only unposted site receipts with accepted stock can be posted' using errcode='P4161';
    end if;
    perform private.delivery_post_stock(actor,operation,trip.id,allocation.destination_id,
      receipt.snapshot->'lines','Posted transfer '||trip.ref,'transfer_receipt');
    update private.transfer_receipts h set posted_at=clock_timestamp() where h.trip_id=trip.id;
    snapshot:=jsonb_build_object('receiptVersionId',receipt.id);
  elsif kind in ('approveTripEvidence','requestTripEvidence') then
    if receipt.id is distinct from (command->>'receiptVersionId')::uuid then
      raise exception 'Receipt version changed' using errcode='40001';
    end if;
    if kind='approveTripEvidence' and (head.review_state<>'pending'
      or not exists(select 1 from private.transfer_receipt_files f where f.version_id=receipt.id and f.kind='generated' and f.state='complete')
      or not exists(select 1 from private.transfer_receipt_files f where f.version_id=receipt.id and f.kind='signed' and f.current_evidence and f.state='complete')
      or exists(select 1 from private.transfer_receipt_files f where f.version_id=receipt.id and f.current_evidence and f.state<>'complete')) then
      raise exception 'Verify the generated, signed and supporting evidence first' using errcode='P4162';
    end if;
    select coalesce(jsonb_agg(f.id order by f.id),'[]') into reviewed_files from private.transfer_receipt_files f
      where f.version_id=receipt.id and (f.kind='generated' or f.current_evidence) and f.state='complete';
    update private.transfer_receipts h set review_state=case when kind='approveTripEvidence' then 'approved' else 'needs_evidence' end,
      review_reason=reason where h.trip_id=trip.id;
    snapshot:=jsonb_build_object('receiptVersionId',receipt.id,'evidenceIds',reviewed_files);
  else
    if head.posted_at is not null or exists(select 1 from private.transfer_trips c where c.parent_trip_id=trip.id and c.state='dispatched') then
      raise exception 'Recount before posting or onward departure' using errcode='P4161';
    end if;
    arrival:=head.arrival_at;
    next_revision:=head.revision+1;
  end if;

  if next_revision is not null then
    load:=private.transfer_trip_snapshot(trip.id);
    lines:=private.transfer_receipt_lines(target,load->'lines',command->'receiptLines');
    if jsonb_typeof(command->'extraGoods') is distinct from 'string' or length(command->>'extraGoods')>2000 then
      raise exception 'Invalid extra goods note' using errcode='P4160';
    end if;

    for line in select value from jsonb_array_elements(lines) loop
      select * into strict material from private.transfer_lines l where l.id=(line->>'lineId')::uuid;
      if (line->>'accepted')::numeric<private.transfer_custody_used(trip.id,material.id) then
        raise exception 'Revise onward bookings before reducing accepted warehouse custody' using errcode='P4152';
      end if;
      claim_qty:=material.approved-material.released-private.transfer_shortage(material.id,trip.id)
        -(line->>'missing')::numeric-(line->>'rejected')::numeric;
      select d.quantity into strict previous_qty from private.demand_claims d where d.id=material.id;
      if claim_qty>previous_qty and not private.mrf_ready(allocation.request_id) then
        raise exception 'Current MRF archive required to reclaim demand' using errcode='P4163';
      end if;
      if claim_qty<>previous_qty then claims:=claims||jsonb_build_array(private.transfer_claim(material,'transfer',claim_qty)); end if;
    end loop;
    if jsonb_array_length(claims)>0 then
      begin
        perform private.demand_apply(actor,operation,allocation.request_id,
          (select h.version::text from private.demand_heads h where h.request_id=allocation.request_id),
          claims,'Transfer receipt '||trip.ref||case when reason='' then '' else ': '||reason end);
      exception when check_violation then
        raise exception 'The shortage demand may already be allocated; review current sourcing' using errcode='P4164';
      end;
    end if;

    insert into private.transfer_receipts as h(trip_id,arrival_at,revision)
      values(trip.id,arrival,next_revision)
      on conflict on constraint transfer_receipts_pkey do update
        set revision=excluded.revision,review_state='pending',review_reason='';
    snapshot:=jsonb_build_object('ref',trip.ref,'transferRef',allocation.ref,'revision',next_revision,
      'arrivalAt',arrival,'plan',load,'departure',trip.departure,'lines',lines,'extraGoods',btrim(command->>'extraGoods'),
      'mrfRef',(select r.ref from public.material_requests r where r.id=allocation.request_id),
      'warehouseRef',(select t.ref from private.transfer_trips t where t.id=trip.parent_trip_id));
    insert into private.transfer_receipt_versions(trip_id,revision,snapshot,actor)
      values(trip.id,next_revision,snapshot,private.document_actor_snapshot(actor)) returning id into version_id;
    insert into private.transfer_receipt_files(version_id,kind,name)
      values(version_id,'generated',trip.ref||'-receipt-v'||next_revision::text||'.pdf') returning id into archive_id;
    snapshot:=snapshot||jsonb_build_object('receiptVersionId',version_id);
  end if;

  insert into private.transfer_trip_events(trip_id,action,reason,actor,snapshot)
    values(trip.id,kind,reason,private.document_actor_snapshot(actor),private.transfer_trip_snapshot(trip.id)||jsonb_build_object('receiptEvent',snapshot));
  update private.transfers set version=version+1 where id=target;
  result:=jsonb_build_object('ids',jsonb_build_array(trip.id),'archiveFileId',archive_id);
  insert into private.transfer_operations values(operation,allocation.request_id,caller,payload,result);
  perform private.document_notify(allocation.destination_id);
  perform private.document_notify(allocation.source_id);
  return result;
end $$;

create function public.transfer_receipt_command(actor jsonb, command jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select private.transfer_receipt_command(actor,command)
$$;

revoke all on function private.transfer_custody_used(uuid,uuid,uuid),private.transfer_custody(uuid),
  private.transfer_shortage(uuid,uuid),private.transfer_receipt_lines(uuid,jsonb,jsonb),
  private.transfer_receipt_command(jsonb,jsonb),public.transfer_receipt_command(jsonb,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function private.transfer_receipt_command(jsonb,jsonb),public.transfer_receipt_command(jsonb,jsonb)
  to service_role;

alter table private.transfer_receipt_files
  add column replaces_id uuid references private.transfer_receipt_files(id);

create function private.transfer_evidence_changed(actor jsonb, allocation private.transfers, target uuid, action text, file uuid, replaced uuid)
returns void language sql set search_path='' as $$
  update private.transfer_receipts set review_state='pending',review_reason='' where trip_id=target;
  update private.transfers set version=version+1 where id=allocation.id;
  insert into private.transfer_trip_events(trip_id,action,reason,actor,snapshot)
    values(target,action,'',private.document_actor_snapshot(actor),
      private.transfer_trip_snapshot(target)||jsonb_build_object('receiptEvent',jsonb_build_object('evidenceId',file,'replacesId',replaced)));
  select private.document_notify(allocation.destination_id);
  select private.document_notify(allocation.source_id);
$$;
revoke all on function private.transfer_evidence_changed(jsonb,private.transfers,uuid,text,uuid,uuid)
  from public,anon,authenticated,service_role;

create function private.transfer_file_action(actor jsonb, file_id uuid, version_id uuid, action text, lease uuid, patch jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare
  caller uuid; role_name text:=actor->>'activeRole'; receiver text; project uuid;
  trip private.transfer_trips; allocation private.transfers; receipt_version private.transfer_receipt_versions; file private.transfer_receipt_files;
  folder private.project_document_folders; current_version boolean; verified_size integer; evidence_kind text:=patch->>'kind';
  replaced uuid:=(patch->>'replacesId')::uuid; resume_id uuid:=(patch->>'resumeId')::uuid;
  previous private.transfer_receipt_files;
  worker boolean:=action in ('workerClaim','workerId','workerComplete','workerFail');
begin
  if action <> 'read' then
    perform set_config('lock_timeout','5s',true);
    update private.account_guard set revision=revision+1 where id;
  end if;
  if not worker then caller:=private.delivery_actor(actor); end if;
  if file_id is not null then
    select * into file from private.transfer_receipt_files f where f.id=file_id;
    version_id:=file.version_id;
  end if;
  select * into receipt_version from private.transfer_receipt_versions v where v.id=version_id;
  select * into trip from private.transfer_trips t where t.id=receipt_version.trip_id;
  select * into allocation from private.transfers t where t.id=trip.transfer_id;
  project:=allocation.destination_id;
  if project is null or (not worker and not private.request_project_allowed(actor,project)) then
    raise exception 'Receipt unavailable' using errcode='42501';
  end if;
  receiver:=case when trip.route='site-warehouse' then 'Procurement' else 'Site Personnel' end;
  if action='read' then
    if file.state is distinct from 'complete' or (file.kind<>'generated' and role_name is distinct from 'Accounting'
      and not (receiver='Procurement' and role_name='Procurement'))
      or (file.kind='generated' and receiver='Procurement' and role_name='Site Personnel') then
      raise exception 'Receipt file unavailable' using errcode='42501';
    end if;
    return jsonb_build_object('driveId',file.drive_id,'size',file.size,'name',file.name,'mime',file.mime);
  end if;
  perform 1 from public.projects p where p.id in (allocation.source_id,project) order by p.id for update;
  perform 1 from public.material_requests r where r.id=allocation.request_id for update;
  perform 1 from private.transfers t where t.id=allocation.id for update;
  select revision=receipt_version.revision into current_version
  from private.transfer_receipts where trip_id=trip.id for update;
  if file.id is not null then
    select * into file from private.transfer_receipt_files f where f.id=file_id for update;
  end if;
  if not worker and role_name is distinct from receiver and role_name is distinct from 'Accounting' then
    raise exception 'Receiving or Accounting role required' using errcode='42501';
  end if;

  if action='begin' then
    if not current_version then raise exception 'Receipt version changed' using errcode='40001'; end if;
    if coalesce(evidence_kind,'') not in ('signed','supporting') or coalesce(length(btrim(patch->>'name')),0) not between 1 and 240
      or coalesce(patch->>'mime','') not in ('application/pdf','image/jpeg','image/png','image/webp')
      or coalesce(patch->>'size','') !~ '^[0-9]{1,8}$'
      or (patch->>'size')::integer not between 12 and 20971520
      or coalesce(patch->>'sha256','') !~ '^[0-9a-f]{64}$' then
      raise exception 'Invalid signed evidence metadata' using errcode='23514';
    end if;
    select * into file from private.transfer_receipt_files f
      where f.version_id=version_id and f.kind=evidence_kind and f.created_by=caller
        and (resume_id=f.id or resume_id is null and f.replaces_id is not distinct from replaced)
        and f.created_revision=(actor->>'revision')::bigint and f.created_role=role_name
        and f.sha256=patch->>'sha256' and f.size=(patch->>'size')::integer and f.mime=patch->>'mime'
        and f.current_evidence
      order by f.created_at desc,f.id desc limit 1;
    if resume_id is not null and file.id is null then
      raise exception 'Reselect the same current evidence file' using errcode='P4162';
    end if;
    if file.id is not null and file.state='failed' and file.offset_bytes<file.size then
      update private.transfer_receipt_files set state='uploading'
        where id=file.id returning * into file;
      perform private.document_notify(project);
      perform private.document_notify(allocation.source_id);
    end if;
    if file.id is null then
      if replaced is not null then
        select * into previous from private.transfer_receipt_files f
          where f.id=replaced and f.version_id=version_id and f.current_evidence;
        if previous.id is null or previous.kind<>evidence_kind then
          raise exception 'Evidence group changed' using errcode='40001';
        end if;
        if previous.lease_until>clock_timestamp() then
          raise exception 'An upload is already processing' using errcode='55P03';
        end if;
      end if;
      if exists(select 1 from private.transfer_receipt_files f
        where f.version_id=version_id and f.current_evidence and f.id is distinct from replaced
        having count(*)>=12 or coalesce(sum(f.size),0)+(patch->>'size')::integer>47185920) then
        raise exception 'Evidence group limit exceeded' using errcode='P4165';
      end if;
      select * into folder from private.project_document_folders f where f.project_id=project and f.current;
      if folder.folder_id is null then raise exception 'Project Drive folder required' using errcode='P4201'; end if;
      update private.transfer_receipt_files set current_evidence=false,lease_id=null,lease_until=null where id=replaced;
      insert into private.transfer_receipt_files(version_id,kind,state,name,mime,size,sha256,folder_id,root_id,
        created_by,created_revision,created_role,created_actor,current_evidence,replaces_id)
      values(version_id,evidence_kind,'uploading',btrim(patch->>'name'),patch->>'mime',(patch->>'size')::integer,patch->>'sha256',
        folder.folder_id,folder.root_id,caller,(actor->>'revision')::bigint,role_name,private.document_actor_snapshot(actor),true,replaced)
      returning * into file;
      perform private.transfer_evidence_changed(actor,allocation,trip.id,'attachTripEvidence',file.id,replaced);
    end if;
    return jsonb_build_object('id',file.id,'offset',file.offset_bytes,'state',file.state);
  elsif action='withdraw' then
    if not current_version or file.kind='generated' or not file.current_evidence
      or file.state not in ('uploading','failed') then
      raise exception 'Only unfinished current evidence can be withdrawn' using errcode='P4162';
    end if;
    if file.lease_until>clock_timestamp() then raise exception 'An upload is already processing' using errcode='55P03'; end if;
    update private.transfer_receipt_files set current_evidence=false,lease_id=null,lease_until=null where id=file.id;
    perform private.transfer_evidence_changed(actor,allocation,trip.id,'withdrawTripEvidence',file.id,null);
    return jsonb_build_object('id',file.id);
  elsif action='retryFile' then
    if not current_version or (file.kind<>'generated' and not file.current_evidence) then
      raise exception 'Receipt or evidence changed' using errcode='40001';
    end if;
    if file.state='failed' and (file.kind='generated' or file.offset_bytes=file.size) then
      update private.transfer_receipt_files set state=case when file.kind='generated' then 'pending' else 'processing' end
      where id=file.id;
      perform private.document_notify(project);
      perform private.document_notify(allocation.source_id);
    end if;
    return jsonb_build_object('id',file.id);
  elsif action='uploadClaim' then
    if file.kind='generated' or not file.current_evidence or file.created_by is distinct from caller
      or file.created_revision is distinct from (actor->>'revision')::bigint or file.created_role is distinct from role_name then
      raise exception 'Upload unavailable' using errcode='42501';
    end if;
    if file.state in ('processing','complete') then
      return jsonb_build_object('state',file.state,'offset_bytes',file.offset_bytes);
    end if;
    if file.state<>'uploading' or not current_version then raise exception 'Reselect evidence for the current receipt' using errcode='40001'; end if;
    if file.lease_until>clock_timestamp() then raise exception 'Upload is already processing' using errcode='55P03'; end if;
    update private.transfer_receipt_files set lease_id=gen_random_uuid(),lease_until=clock_timestamp()+interval '90 seconds'
      where id=file.id returning * into file;
    return to_jsonb(file);
  elsif action in ('uploadCheckpoint','uploadFinish','uploadRelease','uploadExpired') then
    if not current_version or not file.current_evidence or file.created_by is distinct from caller or file.created_revision is distinct from (actor->>'revision')::bigint
      or file.created_role is distinct from role_name or lease is null or file.lease_id is distinct from lease then
      raise exception 'Upload lease or authority changed' using errcode='42501';
    end if;
    if action='uploadCheckpoint' then
      update private.transfer_receipt_files set drive_id=coalesce(drive_id,patch->>'driveId'),
        session_ticket=coalesce(patch->>'ticket',session_ticket),offset_bytes=coalesce((patch->>'offset')::integer,offset_bytes)
        where id=file.id returning * into file;
      return to_jsonb(file);
    end if;
    if action='uploadFinish' then
      update private.transfer_receipt_files set state='processing',offset_bytes=size,session_ticket=null,lease_id=null,lease_until=null where id=file.id;
    elsif action='uploadExpired' then
      update private.transfer_receipt_files set state='failed',session_ticket=null,offset_bytes=0,lease_id=null,lease_until=null where id=file.id;
    else
      update private.transfer_receipt_files set lease_id=null,lease_until=null where id=file.id;
    end if;
    if action<>'uploadRelease' then
      perform private.document_notify(project);
      perform private.document_notify(allocation.source_id);
    end if;
    return null;
  elsif action='workerClaim' then
    if (file.kind<>'generated' and not file.current_evidence) or file.state not in ('pending','processing') or file.lease_until>clock_timestamp() then return null; end if;
    if file.kind<>'generated' and not exists(select 1 from public.profiles p where p.user_id=file.created_by
      and p.is_active and p.access_revision=file.created_revision) then
      update private.transfer_receipt_files set state='failed',lease_id=null,lease_until=null where id=file.id;
      perform private.document_notify(project);
      perform private.document_notify(allocation.source_id);
      return null;
    end if;
    if file.folder_id is null then
      select * into folder from private.project_document_folders f where f.project_id=project and f.current;
    end if;
    update private.transfer_receipt_files set lease_id=gen_random_uuid(),lease_until=clock_timestamp()+interval '90 seconds',
      folder_id=coalesce(folder_id,folder.folder_id),root_id=coalesce(root_id,folder.root_id)
      where id=file.id returning * into file;
    return to_jsonb(file)||jsonb_build_object('snapshot',receipt_version.snapshot,'receiverName',receipt_version.actor->>'name');
  elsif action in ('workerId','workerComplete','workerFail') then
    if lease is null or file.lease_id is distinct from lease then raise exception 'Archive lease changed' using errcode='40001'; end if;
    if action='workerId' then
      update private.transfer_receipt_files set drive_id=coalesce(drive_id,patch->>'driveId') where id=file.id returning * into file;
      return to_jsonb(file);
    end if;
    if action='workerFail' then
      update private.transfer_receipt_files set state='failed',lease_id=null,lease_until=null where id=file.id;
    else
      verified_size:=coalesce(file.size,(patch->>'size')::integer);
      if file.drive_id is null or verified_size is null or verified_size<5
        or coalesce(file.sha256,patch->>'sha256','') !~ '^[0-9a-f]{64}$' then
        raise exception 'Verified archive metadata required' using errcode='23514';
      end if;
      if file.kind<>'generated' and not exists(select 1 from public.profiles p where p.user_id=file.created_by
        and p.is_active and p.access_revision=file.created_revision) then
        raise exception 'Evidence uploader access changed' using errcode='42501';
      end if;
      update private.transfer_receipt_files set state='complete',size=verified_size,
        sha256=coalesce(file.sha256,patch->>'sha256'),offset_bytes=verified_size,lease_id=null,lease_until=null where id=file.id;
    end if;
    perform private.document_notify(project);
    perform private.document_notify(allocation.source_id);
    return null;
  end if;
  raise exception 'Invalid receipt file action' using errcode='23514';
end $$;

create function public.transfer_receipt_file(actor jsonb, file_id uuid, version_id uuid, action text, lease uuid, patch jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select private.transfer_file_action(actor,file_id,version_id,action,lease,patch)
$$;

revoke all on function private.transfer_file_action(jsonb,uuid,uuid,text,uuid,jsonb),
  public.transfer_receipt_file(jsonb,uuid,uuid,text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.transfer_file_action(jsonb,uuid,uuid,text,uuid,jsonb),
  public.transfer_receipt_file(jsonb,uuid,uuid,text,uuid,jsonb) to service_role;


create function private.transfer_receipt_view(target uuid, actor jsonb, assigned_destination boolean)
returns jsonb language sql stable set search_path='' as $$
  select v.snapshot-'plan'-'departure' || jsonb_build_object(
    'id',v.id,'postedAt',h.posted_at,'revision',v.revision,'actorName',v.actor->>'name',
    'reviewState',h.review_state,'reviewReason',h.review_reason,
    'canReceive',permissions.receiver,
    'canRecount',permissions.receiver and h.posted_at is null and not exists(
      select 1 from private.transfer_trips c where c.parent_trip_id=t.id and c.state='dispatched'),
    'canWriteEvidence',permissions.receiver or permissions.accounting,
    'canReview',permissions.accounting,
    'canPost',permissions.receiver and t.route<>'site-warehouse' and h.posted_at is null and exists(
      select 1 from jsonb_array_elements(v.snapshot->'lines') l where (l->>'accepted')::numeric>0),
    'custody',case when t.route='site-warehouse' then private.transfer_custody(target) else '[]'::jsonb end,
    'priorVersions',coalesce((select jsonb_agg(old.snapshot-'plan'-'departure'-'mrfRef'-'warehouseRef'
      order by old.revision desc) from private.transfer_receipt_versions old
      where old.trip_id=t.id and old.revision<v.revision),'[]'),
    'files',coalesce((select jsonb_agg(jsonb_build_object(
      'id',case when access.manage or access.read then f.id end,
      'readable',access.read and f.state='complete','kind',f.kind,'state',f.state,
      'name',case when access.read or access.manage and f.created_by=(actor->>'userId')::uuid then f.name end,
      'size',f.size,'current',old.id=v.id and (f.kind='generated' or f.current_evidence),
      'revision',old.revision,'resumable',coalesce(access.manage and f.created_by=(actor->>'userId')::uuid
        and f.created_revision=(actor->>'revision')::bigint and f.created_role=actor->>'activeRole',false),
      'uploaded',coalesce(f.offset_bytes=f.size,false)) order by old.revision desc,f.created_at,f.id)
      from private.transfer_receipt_files f join private.transfer_receipt_versions old on old.id=f.version_id
      cross join lateral (select
        permissions.receiver or permissions.accounting as manage,
        case when f.kind='generated' then permissions.generated else permissions.original end as read) access
      where old.trip_id=t.id and (old.id=v.id and (f.kind='generated' or f.current_evidence)
        or access.read and f.state='complete')),'[]'::jsonb)
  )
  from private.transfer_receipts h
  join private.transfer_trips t on t.id=h.trip_id
  join private.transfer_receipt_versions v on v.trip_id=h.trip_id and v.revision=h.revision
  cross join lateral (select
    actor->>'activeRole'='Accounting' as accounting,
    actor->>'activeRole'='Accounting' or (actor->>'activeRole'='Procurement' and t.route='site-warehouse') as original,
    actor->>'activeRole'<>'Site Personnel' or (assigned_destination and t.route<>'site-warehouse') as generated,
    actor->>'activeRole'=(case when t.route='site-warehouse' then 'Procurement' else 'Site Personnel' end)
      and assigned_destination as receiver) permissions
  where h.trip_id=target
$$;
revoke all on function private.transfer_receipt_view(uuid,jsonb,boolean) from public,anon,authenticated,service_role;

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
      select jsonb_agg(private.transfer_trip_snapshot(trip.id)||jsonb_build_object(
        'canReceive',trip.state='dispatched' and private.request_project_allowed(actor,t.destination_id)
          and role_name=case when trip.route='site-warehouse' then 'Procurement' else 'Site Personnel' end,
        'receipt',private.transfer_receipt_view(trip.id,actor,private.request_project_allowed(actor,t.destination_id)),
        'history',coalesce((
        select jsonb_agg(jsonb_build_object('id',e.id,'action',e.action,'reason',e.reason,'at',e.recorded_at,'actorName',e.actor->>'name',
          'snapshot',e.snapshot-'receiptEvent') order by e.recorded_at,e.id) from private.transfer_trip_events e where e.trip_id=trip.id),'[]'))
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

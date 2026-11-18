-- Purchased loads own delivery capacity, independently of demand, stock and settlement.
alter table private.document_counters drop constraint document_counters_series_check;
alter table private.document_counters add constraint document_counters_series_check check(series in('MRF','PO','DEL'));
create table private.delivery_heads (
  po_id uuid primary key references private.purchasing_records(id), version bigint not null default 0
);
create table private.deliveries (
  id uuid primary key, po_id uuid not null references private.purchasing_records(id),
  ref text not null unique, state text not null check(state in('scheduled','dispatched','cancelled')),
  plan jsonb not null, departure jsonb, created_at timestamptz not null default clock_timestamp(),
  departure_floor timestamptz, departure_ceiling timestamptz
);
create index deliveries_po on private.deliveries(po_id);
create table private.delivery_events (
  id uuid primary key default gen_random_uuid(), delivery_id uuid not null references private.deliveries(id),
  action text not null, reason text not null, actor jsonb not null, snapshot jsonb not null,
  recorded_at timestamptz not null default clock_timestamp()
);
create index delivery_events_delivery on private.delivery_events(delivery_id,recorded_at,id);
create table private.delivery_operations (
  id uuid primary key, actor_id uuid not null references public.profiles(user_id),
  po_id uuid not null references private.purchasing_records(id), payload jsonb not null, result jsonb not null
);
create index delivery_operations_actor on private.delivery_operations(actor_id);
create index delivery_operations_po on private.delivery_operations(po_id);

create function private.delivery_actor(actor jsonb,writing boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare caller uuid;
begin
  caller:=private.project_actor(actor,false);
  if writing and actor->>'activeRole'<>'Logistics' then raise exception 'Logistics required' using errcode='42501'; end if;
  perform 1 from auth.sessions where id=(actor->>'sessionId')::uuid and user_id=caller for share;
  if not found then raise exception 'Current session required' using errcode='42501'; end if;
  return caller;
end $$;

create function private.delivery_plan(value jsonb,target uuid,excluded uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare line jsonb; ordered jsonb; used numeric; field text; factor numeric;
begin
  if jsonb_typeof(value) is distinct from 'object' or coalesce(value->>'route','') not in('site','warehouse')
    or coalesce(value->>'plannedDate','') !~ '^\d{4}-\d{2}-\d{2}$'
    or (value->>'plannedDate')::date::text is distinct from value->>'plannedDate'
    or (value->>'plannedDate')::date<(clock_timestamp() at time zone 'Asia/Manila')::date
    or coalesce(value->>'plannedTime','invalid') !~ '^(|([01][0-9]|2[0-3]):[0-5][0-9])$'
    or jsonb_typeof(value->'lines') is distinct from 'array' then raise exception 'Invalid delivery plan' using errcode='23514'; end if;
  foreach field in array array['pickup','destination','address','note'] loop
    if jsonb_typeof(value->field) is distinct from 'string' or length(value->>field)>2000
      or field<>'note' and length(btrim(value->>field))=0 then raise exception 'Invalid location or note' using errcode='23514'; end if;
  end loop;
  if jsonb_array_length(value->'lines') not between 1 and 500 or
    (select count(distinct x->>'lineId') from jsonb_array_elements(value->'lines') x)<>jsonb_array_length(value->'lines') then
    raise exception 'Select distinct load lines' using errcode='23514'; end if;
  for line in select * from jsonb_array_elements(value->'lines') loop
    if jsonb_typeof(line->'quantity') is distinct from 'string' or length(line->>'quantity')>80
      or coalesce(line->>'quantity','') !~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$' or (line->>'quantity')::numeric<=0 then
      raise exception 'Exact positive quantities required' using errcode='23514'; end if;
    select x into ordered from private.purchasing_records r cross join lateral jsonb_array_elements(r.body->'lines') x
      where r.id=target and x->>'id'=line->>'lineId';
    if ordered is null then raise exception 'PO line required' using errcode='23514'; end if;
    select (s->>'conversionFactor')::numeric into factor from private.purchasing_records r
      join private.quotation_revisions q on q.id=r.revision_id
      cross join lateral jsonb_array_elements(q.snapshot->'source'->'lines') s
      where r.id=target and s->>'id'=ordered->>'sourceLineId';
    if factor is null or factor<=0 or length(trim_scale((line->>'quantity')::numeric*factor)::text)>80 then
      raise exception 'Requested-unit equivalent exceeds exact quantity bounds' using errcode='23514'; end if;
    select coalesce(sum((x->>'quantity')::numeric),0) into used from private.deliveries d
      cross join lateral jsonb_array_elements(d.plan->'lines') x
      where d.po_id=target and d.id<>excluded and d.state<>'cancelled' and x->>'lineId'=line->>'lineId';
    if used+(line->>'quantity')::numeric>(ordered->>'offeredQuantity')::numeric then
      raise exception 'Quantity already allocated to other deliveries' using errcode='P4121'; end if;
  end loop;
  return value;
end $$;

create function private.delivery_departure(value jsonb,lower_bound timestamptz,upper_bound timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare field text; actual timestamptz;
begin
  if jsonb_typeof(value) is distinct from 'object' or coalesce(value->>'at','') !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$' then
    raise exception 'Explicit departure time and zone required' using errcode='23514'; end if;
  actual:=(value->>'at')::timestamptz;
  if not isfinite(actual) or lower_bound is null or upper_bound is null or actual<lower_bound or actual>upper_bound then
    raise exception 'Departure must follow scheduling, issuance and current clearance; escalate invalid departures externally' using errcode='P4123'; end if;
  foreach field in array array['carrier','driver','vehicle','reference','note'] loop
    if jsonb_typeof(value->field) is distinct from 'string' or length(value->>field)>2000 then raise exception 'Invalid transport details' using errcode='23514'; end if;
  end loop;
  return value;
end $$;

create function private.delivery_command(actor jsonb,command jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
<<delivery_write>>
declare caller uuid; operation uuid:=(command->>'requestId')::uuid; target uuid:=(command->>'poId')::uuid;
  selected uuid:=(command->>'deliveryId')::uuid; kind text:=command->>'type'; reason text:=coalesce(command->>'reason','');
  receipt private.delivery_operations; r private.purchasing_records; d private.deliveries;
  payload jsonb; result jsonb; number bigint; code text; current_version bigint; plan jsonb; departure jsonb;
  floor_time timestamptz; ceiling_time timestamptz; sent_time timestamptz; clear_time timestamptz;
begin
  perform set_config('lock_timeout','5s',true);
  update private.account_guard set revision=revision+1 where id;
  caller:=private.delivery_actor(actor,true);
  payload:=jsonb_build_object('command',command,'role',actor->>'activeRole');
  select * into receipt from private.delivery_operations where id=operation;
  if found then
    if receipt.actor_id<>caller or receipt.payload<>payload then raise exception 'Retry identity reused' using errcode='P4803'; end if;
    return receipt.result;
  end if;
  if operation is null or target is null or selected is null or coalesce(kind,'') not in('schedule','revise','cancel','dispatch','correct')
    or coalesce(command->>'expectedVersion','') !~ '^(0|[1-9][0-9]{0,18})$'
    or length(reason)>2000 or kind in('revise','cancel','correct') and length(btrim(reason))<5 then raise exception 'Invalid delivery action or reason' using errcode='23514'; end if;
  select pr.* into r from private.purchasing_records pr where pr.id=target and pr.kind='po';
  if r.id is null or not exists(select 1 from private.po_issuances where po_id=target) then raise exception 'Issued PO required' using errcode='P4111'; end if;
  perform 1 from public.projects where id=r.project_id for update;
  perform 1 from public.material_requests where id=r.request_id for update;
  perform 1 from private.purchasing_records where id=target for update;
  insert into private.delivery_heads(po_id) values(target) on conflict do nothing;
  select version into current_version from private.delivery_heads where po_id=target for update;
  if current_version::text is distinct from command->>'expectedVersion' then raise exception 'Delivery capacity or record changed' using errcode='40001'; end if;
  select * into d from private.deliveries where id=selected for update;
  if kind='schedule' then
    if d.id is not null then raise exception 'Delivery already exists' using errcode='23505'; end if;
    plan:=private.delivery_plan(command->'plan',target,selected);
    select document_code into code from public.projects where id=r.project_id;
    if code is null then raise exception 'Project document code required' using errcode='23514'; end if;
    insert into private.document_counters(project_id,series,last_value) values(r.project_id,'DEL',1)
      on conflict on constraint document_counters_pkey do update set last_value=private.document_counters.last_value+1 returning last_value into number;
    insert into private.deliveries(id,po_id,ref,state,plan) values(selected,target,code||'-DEL-'||lpad(number::text,greatest(4,length(number::text)),'0'),'scheduled',plan);
  else
    if d.id is null or d.po_id<>target then raise exception 'Delivery unavailable' using errcode='42501'; end if;
    if kind in('revise','cancel','dispatch') and d.state<>'scheduled' or kind='correct' and d.state<>'dispatched' then raise exception 'Action unavailable in current state' using errcode='P4122'; end if;
    if kind='revise' then
      plan:=private.delivery_plan(command->'plan',target,selected);
      update private.deliveries set plan=delivery_write.plan where id=selected;
    elsif kind='cancel' then
      update private.deliveries set state='cancelled' where id=selected;
    elsif kind='dispatch' then
      if not private.payment_cleared(target) then raise exception 'Current Accounting clearance required' using errcode='P4116'; end if;
      -- Recheck capacity without requiring an overdue plan to be rescheduled first.
      perform private.delivery_plan(jsonb_set(d.plan,'{plannedDate}',to_jsonb((clock_timestamp() at time zone 'Asia/Manila')::date::text)),target,selected);
      select recorded_at into clear_time from private.payment_clearances where po_id=target order by recorded_at desc,id desc limit 1;
      select coalesce((select c.details->>'sentAt' from private.po_issuance_corrections c where c.issuance_id=i.id order by c.version desc limit 1),i.details->>'sentAt')::timestamptz
        into sent_time from private.po_issuances i where i.po_id=target;
      floor_time:=greatest(d.created_at,clear_time,sent_time); ceiling_time:=clock_timestamp();
      departure:=private.delivery_departure(command->'departure',floor_time,ceiling_time);
      update private.deliveries set state='dispatched',departure=delivery_write.departure,departure_floor=floor_time,departure_ceiling=ceiling_time where id=selected;
    elsif kind='correct' then
      departure:=private.delivery_departure(command->'departure',d.departure_floor,d.departure_ceiling);
      update private.deliveries set departure=delivery_write.departure where id=selected;
    end if;
  end if;
  update private.delivery_heads set version=version+1 where po_id=target;
  select * into d from private.deliveries where id=selected;
  insert into private.delivery_events(delivery_id,action,reason,actor,snapshot)
    values(selected,kind,reason,private.document_actor_snapshot(actor),jsonb_build_object('plan',d.plan,'departure',d.departure));
  result:=jsonb_build_object('targetId',selected,'changed',true);
  insert into private.delivery_operations(id,actor_id,po_id,payload,result) values(operation,caller,target,payload,result);
  perform private.document_notify(r.project_id); return result;
end $$;

create function private.deliveries_read(actor jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform private.delivery_actor(actor);
  return jsonb_build_object('role',actor->>'activeRole',
    'orders',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'ref',r.ref,'projectId',r.project_id,'project',p.name,
      'vendor',r.body->'fields'->>'vendorName','pickup',coalesce(r.body->'fields'->>'vendorAddress',''),
      'destination',r.body->'fields'->>'shipTo','address',r.body->'fields'->>'shipAddress','cleared',private.payment_cleared(r.id),
      'version',coalesce((select version from private.delivery_heads where po_id=r.id),0)::text,
      'lines',(select jsonb_agg(jsonb_build_object('id',l->>'id','description',s->>'description','unit',s->>'unit',
        'requestedUnit',coalesce(mi.data->>'unit',s->>'unit'),'quantity',l->>'offeredQuantity','factor',s->>'conversionFactor',
        'allocated',coalesce((select sum((x->>'quantity')::numeric)::text from private.deliveries dd cross join lateral jsonb_array_elements(dd.plan->'lines') x
          where dd.po_id=r.id and dd.state<>'cancelled' and x->>'lineId'=l->>'id'),'0')))
        from jsonb_array_elements(r.body->'lines') l
        join private.quotation_revisions q on q.id=r.revision_id
        cross join lateral jsonb_array_elements(q.snapshot->'source'->'lines') s
        left join public.material_request_items mi on mi.id=(l->>'itemId')::uuid
        where s->>'id'=l->>'sourceLineId')) order by r.ref)
      from private.purchasing_records r join public.projects p on p.id=r.project_id
      where exists(select 1 from private.po_issuances i where i.po_id=r.id) and private.request_project_allowed(actor,r.project_id)),'[]'),
    'deliveries',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'poId',d.po_id,'ref',d.ref,'state',d.state,'plan',d.plan,'departure',d.departure,
      'createdAt',d.created_at,'version',h.version::text,
      'history',coalesce((select jsonb_agg(jsonb_build_object('action',e.action,'reason',e.reason,'at',e.recorded_at,'actorName',e.actor->>'name','snapshot',e.snapshot)
        order by e.recorded_at,e.id) from private.delivery_events e where e.delivery_id=d.id),'[]')) order by d.created_at desc,d.id)
      from private.deliveries d join private.delivery_heads h on h.po_id=d.po_id join private.purchasing_records r on r.id=d.po_id
      where private.request_project_allowed(actor,r.project_id)),'[]'));
end $$;

create function public.delivery_command(actor jsonb,command jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.delivery_command(actor,command); $$;
create function public.deliveries_read(actor jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.deliveries_read(actor); $$;
do $$ declare t text; f record; begin
  foreach t in array array['delivery_heads','deliveries','delivery_events','delivery_operations'] loop
    execute format('alter table private.%I enable row level security',t);
    execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
    if t in('delivery_events','delivery_operations') then
      execute format('create trigger immutable before update or delete on private.%I for each row execute function private.document_immutable()',t);
    end if;
  end loop;
  for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in('private','public') and (p.proname like 'delivery\_%' escape '\' or p.proname='deliveries_read') loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
    if f.proname in('delivery_command','deliveries_read') then execute format('grant execute on function %s to service_role',f.signature); end if;
  end loop;
end $$;

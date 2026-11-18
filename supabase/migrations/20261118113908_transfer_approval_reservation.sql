alter table private.document_counters drop constraint document_counters_series_check;
alter table private.document_counters add constraint document_counters_series_check check(series in ('MRF','PO','DEL','TRF'));

create table private.transfers (
  id uuid primary key,
  request_id uuid not null references public.material_requests(id),
  source_id uuid not null references public.projects(id),
  destination_id uuid not null references public.projects(id),
  basis_archive_id uuid not null references private.mrf_archive_snapshots(id),
  ref text unique,
  status text not null check (status in ('review_pending','suitable','converted','release_pending','approved','rejected','cancelled')),
  version bigint not null default 1,
  submitted_by uuid not null references public.profiles(user_id),
  suitability_reviewer uuid references public.profiles(user_id),
  origin_review_id uuid unique references private.transfers(id),
  note text not null,
  created_at timestamptz not null default clock_timestamp(),
  check (source_id<>destination_id)
);
create index transfers_request on private.transfers(request_id);
create index transfers_source on private.transfers(source_id);
create index transfers_destination on private.transfers(destination_id);
create index transfers_basis_archive on private.transfers(basis_archive_id);
create index transfers_submitter on private.transfers(submitted_by);
create index transfers_reviewer on private.transfers(suitability_reviewer) where suitability_reviewer is not null;
create table private.transfer_lines (
  id uuid primary key,
  transfer_id uuid not null references private.transfers(id),
  item_id uuid not null references public.material_request_items(id),
  stock_id uuid not null references private.stock_accounts(id),
  requested_name text not null,
  requested_unit text not null,
  stock_name text not null,
  stock_unit text not null,
  proposed numeric not null check (proposed>0 and proposed<'Infinity'::numeric),
  approved numeric not null default 0 check (approved>=0 and approved<=proposed),
  explanation text not null,
  unique (transfer_id,item_id,stock_id)
);
create index transfer_lines_item on private.transfer_lines(item_id);
create index transfer_lines_stock on private.transfer_lines(stock_id);
create table private.transfer_operations (
  id uuid primary key,
  request_id uuid not null references public.material_requests(id),
  actor_id uuid not null references public.profiles(user_id),
  payload jsonb not null,
  result jsonb not null
);
create index transfer_operations_actor on private.transfer_operations(actor_id);
create index transfer_operations_request on private.transfer_operations(request_id);
create table private.transfer_events (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references private.transfers(id),
  action text not null,
  reason text not null,
  actor jsonb not null,
  snapshot jsonb not null,
  recorded_at timestamptz not null default clock_timestamp()
);
create index transfer_events_record on private.transfer_events(transfer_id,recorded_at,id);

do $$
declare relation text;
begin
  foreach relation in array array['transfers','transfer_lines','transfer_operations','transfer_events'] loop
    execute format('alter table private.%I enable row level security',relation);
    execute format('revoke all on private.%I from public,anon,authenticated,service_role',relation);
    if relation in ('transfer_operations','transfer_events') then
      execute format('create trigger immutable before update or delete on private.%I for each row execute function private.document_immutable()',relation);
    end if;
  end loop;
end $$;

-- Unit equivalence affects candidate eligibility only. Stock movements and
-- reservations keep the authoritative account and its original unit.
create function private.transfer_unit(value text) returns text language sql immutable set search_path='' as $$
  select case lower(btrim(value))
    when 'pcs' then 'pc' when 'piece' then 'pc' when 'pieces' then 'pc'
    when 'bags' then 'bag' when 'sheets' then 'sheet' when 'lengths' then 'length'
    when 'rolls' then 'roll' when 'pails' then 'pail' when 'sets' then 'set'
    when 'cartridges' then 'cartridge' when 'boxes' then 'box'
    when 'm3' then 'cu.m' when 'm³' then 'cu.m' when 'cubic meter' then 'cu.m'
    when 'cubic meters' then 'cu.m' when 'cubic metre' then 'cu.m' when 'cubic metres' then 'cu.m'
    else lower(btrim(value)) end
$$;

create function private.transfer_number(destination uuid) returns text language plpgsql set search_path='' as $$
declare code text; number bigint;
begin
  select document_code into code from public.projects where id=destination;
  if code is null then raise exception 'Destination project document code required' using errcode='P4144'; end if;
  insert into private.document_counters(project_id,series,last_value) values(destination,'TRF',1)
    on conflict on constraint document_counters_pkey do update set last_value=private.document_counters.last_value+1
    returning last_value into number;
  return code||'-TRF-'||lpad(number::text,greatest(4,length(number::text)),'0');
end $$;

create function private.transfer_demand_allowed(actor jsonb, target uuid, transfer_id uuid, changes jsonb)
returns boolean language sql stable set search_path='' as $$
  select actor->>'activeRole'='Site Personnel' and exists (
    select 1 from private.transfers t
    join public.project_assignments a on a.project_id=t.source_id and a.user_id=(actor->>'userId')::uuid
    where t.id=transfer_id and t.request_id=target and t.status='release_pending'
  ) and not exists (
    select 1 from jsonb_array_elements(changes) entry
    where not exists (
      select 1 from private.transfer_lines l
      join private.demand_claims c on c.id=l.id and c.owner_id=l.transfer_id and c.owner_line_id=l.id
      where l.transfer_id=transfer_demand_allowed.transfer_id and c.request_id=target and c.owner_kind='transfer'
        and c.id::text=entry->>'claimId' and c.item_id::text=entry->>'itemId'
        and c.owner_id::text=entry->>'ownerId' and c.owner_line_id::text=entry->>'ownerLineId'
        and entry->>'ownerKind'='transfer' and (entry->>'quantity')::numeric between 0 and c.quantity
    )
  )
$$;

create function private.demand_apply(actor jsonb, operation uuid, target uuid, expected_version text, changes jsonb, reason text, transfer_context uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
<<apply_demand>>
declare caller uuid; revision bigint; receipt private.demand_operations; payload jsonb;
  previous jsonb; result jsonb; change jsonb; existing private.demand_claims; requirement private.demand_requirements;
  claim uuid; item uuid; owner uuid; owner_line uuid; kind text; amount numeric; source uuid; source_item jsonb;
  ids uuid[]:='{}'; changed boolean:=false; ready boolean;
begin
  perform set_config('lock_timeout','5s',true);
  update private.account_guard g set revision=g.revision+1 where g.id;
  caller:=private.project_actor(actor,false);
  -- No realtime publisher exists in this internal unit to take the usual
  -- recipient-session locks. Order native session deletion here instead.
  perform 1 from auth.sessions s where s.id=(actor->>'sessionId')::uuid and s.user_id=caller for share;
  if not found then raise exception 'Current workspace access required' using errcode='42501'; end if;
  perform 1 from public.material_requests r where r.id=target for update;
  if not found or (
    not private.request_project_allowed(actor,(select project_id from public.material_requests where id=target))
    and (transfer_context is null or not private.transfer_demand_allowed(actor,target,transfer_context,changes))
  ) then
    raise exception 'Current MRF access required' using errcode='42501';
  end if;
  if operation is null or expected_version is null or expected_version !~ '^(0|[1-9][0-9]{0,18})$'
    or jsonb_typeof(changes) is distinct from 'array' or jsonb_array_length(changes) not between 1 and 2000
    or reason is null or length(btrim(reason)) not between 5 and 4000 then
    raise exception 'Invalid demand operation' using errcode='23514';
  end if;
  payload:=jsonb_build_object('requestId',target,'expectedVersion',expected_version,'changes',changes,'reason',btrim(reason),'role',actor->>'activeRole');
  select * into receipt from private.demand_operations where id=operation;
  if found then
    if receipt.actor_id<>caller or receipt.payload<>payload then raise exception 'Demand retry identity reused' using errcode='23514'; end if;
    return receipt.result;
  end if;
  select h.version into revision from private.demand_heads h where h.request_id=target;
  revision:=coalesce(revision,0);
  if revision::text<>expected_version then raise exception 'Demand changed; review current allocations' using errcode='40001'; end if;
  previous:=private.demand_snapshot(target);
  ready:=private.mrf_ready(target);
  for change in select * from jsonb_array_elements(changes) loop
    claim:=(change->>'claimId')::uuid; item:=(change->>'itemId')::uuid;
    owner:=(change->>'ownerId')::uuid; owner_line:=(change->>'ownerLineId')::uuid; kind:=change->>'ownerKind';
    if claim is null or item is null or owner is null or owner_line is null or claim=any(ids)
      or kind is null or kind not in('award','purchase_order','suitability','transfer')
      or jsonb_typeof(change->'quantity') is distinct from 'string'
      or length(change->>'quantity')>80 or change->>'quantity' !~ '^[0-9]+(\.[0-9]+)?$' then
      raise exception 'Invalid demand claim' using errcode='23514';
    end if;
    ids:=array_append(ids,claim); amount:=(change->>'quantity')::numeric;
    select * into existing from private.demand_claims c where c.id=claim;
    if found then
      if row(existing.request_id,existing.item_id,existing.owner_kind,existing.owner_id,existing.owner_line_id)
        is distinct from row(target,item,kind,owner,owner_line) then
        raise exception 'Demand claim ownership is fixed; replace atomically' using errcode='23514';
      end if;
      if existing.quantity=amount then continue; end if;
    elsif amount=0 then
      raise exception 'Cannot release an unknown claim' using errcode='23514';
    end if;
    if (existing.id is null or amount>existing.quantity) and not ready then
      raise exception 'Current approved archive required to claim demand' using errcode='23514';
    end if;
    insert into private.demand_heads(request_id) values(target) on conflict do nothing;
    select * into requirement from private.demand_requirements r where r.item_id=item;
    if not found then
      select s.id, i into source,source_item from private.mrf_archive_snapshots s
        cross join lateral jsonb_array_elements(s.snapshot->'draft'->'items') i
        where s.request_id=target and s.version=(select max(v.version) from private.mrf_archive_snapshots v where v.request_id=target)
          and i->>'id'=item::text;
      if source is null or not exists(select 1 from public.material_request_items i where i.id=item and i.request_id=target)
        or source_item->>'quantity' is null then raise exception 'Approved MRF material required' using errcode='23514'; end if;
      insert into private.demand_requirements(item_id,request_id,archive_id,quantity,unit)
        values(item,target,source,(source_item->>'quantity')::numeric,source_item->>'unit');
    elsif requirement.request_id<>target then raise exception 'Material belongs to another MRF' using errcode='23514';
    end if;
    if existing.id is null then
      insert into private.demand_claims values(claim,target,item,kind,owner,owner_line,amount);
    else update private.demand_claims set quantity=amount where id=claim;
    end if;
    changed:=true;
  end loop;
  if exists(select 1 from private.demand_requirements r join private.demand_claims c on c.item_id=r.item_id
    where r.request_id=target group by r.item_id,r.quantity having sum(c.quantity)>r.quantity) then
    raise exception 'Demand claims exceed requested quantity' using errcode='23514';
  end if;
  if changed then
    -- First acquisition registers permanently; releases during correction need
    -- not pass mrf_ready again and can never remove the original reference.
    if not exists(select 1 from private.mrf_downstream_references d where d.request_id=target and d.kind='demand') then
      perform private.mrf_register_downstream(target,'demand',target);
    end if;
    update private.demand_heads set version=version+1 where request_id=target;
  end if;
  result:=private.demand_snapshot(target)||jsonb_build_object('changed',changed);
  insert into private.demand_operations values(operation,target,caller,payload,result);
  if changed then
    insert into private.demand_events(operation_id,request_id,actor_id,actor_name,actor_role,reason,before_state,after_state)
      select operation,target,caller,p.display_name,actor->>'activeRole',btrim(reason),previous,result from public.profiles p where p.user_id=caller;
  end if;
  return result;
end $$;
create or replace function private.demand_apply(actor jsonb, operation uuid, target uuid, expected_version text, changes jsonb, reason text) returns jsonb
language sql security definer set search_path='' as $$
  select private.demand_apply(actor,operation,target,expected_version,changes,reason,null::uuid)
$$;

revoke all on function private.demand_apply(jsonb,uuid,uuid,text,jsonb,text,uuid),
  private.transfer_unit(text),private.transfer_number(uuid),private.transfer_demand_allowed(jsonb,uuid,uuid,jsonb)
  from public,anon,authenticated,service_role;

create function private.transfer_quantity(value jsonb) returns numeric
language plpgsql immutable set search_path='' as $$
declare number text:=value#>>'{}';
begin
  if jsonb_typeof(value) is distinct from 'string' or length(number)>80
    or number !~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$' then
    raise exception 'Exact nonnegative quantity required' using errcode='P4140';
  end if;
  return number::numeric;
end $$;

create function private.transfer_lines_view(target uuid) returns jsonb
language sql stable set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',l.id,'itemId',l.item_id,'stockId',l.stock_id,'requestedName',l.requested_name,
    'requestedUnit',l.requested_unit,'stockName',l.stock_name,'stockUnit',l.stock_unit,
    'proposed',trim_scale(l.proposed)::text,'approved',trim_scale(l.approved)::text,'explanation',l.explanation
  ) order by l.requested_name,l.id),'[]'::jsonb)
  from private.transfer_lines l where l.transfer_id=target
$$;

create function private.transfer_claim(line private.transfer_lines, owner_kind text, amount numeric)
returns jsonb language sql immutable set search_path='' as $$
  select jsonb_build_object('claimId',line.id,'itemId',line.item_id,'ownerKind',owner_kind,
    'ownerId',line.transfer_id,'ownerLineId',line.id,'quantity',trim_scale(amount)::text)
$$;

create function private.transfer_reservation(line private.transfer_lines, amount numeric)
returns jsonb language sql immutable set search_path='' as $$
  select jsonb_build_object('accountId',line.stock_id,'reservationId',line.id,'ownerKind','transfer',
    'ownerId',line.transfer_id,'ownerLineId',line.id,'quantity',trim_scale(amount)::text)
$$;

create function private.transfer_event(actor jsonb,target uuid,action text,reason text)
returns void language sql set search_path='' as $$
  insert into private.transfer_events(transfer_id,action,reason,actor,snapshot)
  select t.id,action,reason,private.document_actor_snapshot(actor),
    jsonb_build_object('status',t.status,'lines',private.transfer_lines_view(t.id))
  from private.transfers t where t.id=target
$$;

create function private.transfer_command(actor jsonb, command jsonb) returns jsonb
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


create function private.transfer_read(actor jsonb, target_request uuid, target_transfer uuid)
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
    'canCancel',role_name='Procurement' and t.status in ('review_pending','suitable','release_pending','approved'),
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

create function public.transfer_command(actor jsonb, command jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select private.transfer_command(actor,command) $$;
create function public.transfer_read(actor jsonb, target_request uuid, target_transfer uuid) returns jsonb
language sql security invoker set search_path='' as $$ select private.transfer_read(actor,target_request,target_transfer) $$;

revoke all on function private.transfer_quantity(jsonb),private.transfer_lines_view(uuid),
  private.transfer_claim(private.transfer_lines,text,numeric),private.transfer_reservation(private.transfer_lines,numeric),
  private.transfer_event(jsonb,uuid,text,text),private.transfer_command(jsonb,jsonb),private.transfer_read(jsonb,uuid,uuid),
  public.transfer_command(jsonb,jsonb),public.transfer_read(jsonb,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.transfer_command(jsonb,jsonb),public.transfer_read(jsonb,uuid,uuid),
  private.transfer_command(jsonb,jsonb),private.transfer_read(jsonb,uuid,uuid) to service_role;

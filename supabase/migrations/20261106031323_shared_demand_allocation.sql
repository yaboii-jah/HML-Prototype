-- 4.6 internal boundary. No RPC wrapper or direct client/service-role grants.
-- Future checked owning commands validate their own role/action/source capacity,
-- then call demand_apply in the SAME transaction as the owning record changes.
alter table public.material_request_items add constraint demand_item_request unique(id,request_id);
alter table private.mrf_downstream_references drop constraint mrf_downstream_references_kind_check;
alter table private.mrf_downstream_references add constraint mrf_downstream_references_kind_check
  check(kind in('quotation','purchase_order','transfer','demand'));

create table private.demand_heads (
  request_id uuid primary key references public.material_requests(id),
  version bigint not null default 0 check(version>=0)
);
create table private.demand_requirements (
  item_id uuid primary key,
  request_id uuid not null references private.demand_heads(request_id),
  foreign key(item_id,request_id) references public.material_request_items(id,request_id),
  archive_id uuid not null references private.mrf_archive_snapshots(id),
  quantity numeric not null check(quantity>0 and quantity<'Infinity'::numeric),
  unit text not null check(length(btrim(unit))>0),
  unique(item_id,request_id)
);
create index demand_requirements_request on private.demand_requirements(request_id);
create index demand_requirements_archive on private.demand_requirements(archive_id);
create trigger demand_requirement_immutable before update or delete on private.demand_requirements
  for each row execute function private.document_immutable();
create table private.demand_claims (
  id uuid primary key,
  request_id uuid not null,
  item_id uuid not null,
  foreign key(item_id,request_id) references private.demand_requirements(item_id,request_id),
  owner_kind text not null check(owner_kind in('award','purchase_order','suitability','transfer')),
  owner_id uuid not null,
  owner_line_id uuid not null,
  quantity numeric not null check(quantity>=0 and quantity<'Infinity'::numeric),
  unique(owner_kind,owner_id,owner_line_id,item_id)
);
create index demand_claims_item on private.demand_claims(item_id,request_id);
create index demand_claims_request on private.demand_claims(request_id);
create table private.demand_operations (
  id uuid primary key,
  request_id uuid not null references public.material_requests(id),
  actor_id uuid not null references public.profiles(user_id),
  payload jsonb not null,
  result jsonb not null
);
create index demand_operations_request on private.demand_operations(request_id);
create index demand_operations_actor on private.demand_operations(actor_id);
create table private.demand_events (
  operation_id uuid primary key references private.demand_operations(id),
  request_id uuid not null references public.material_requests(id),
  actor_id uuid not null references public.profiles(user_id),
  actor_name text not null,
  actor_role text not null,
  reason text not null,
  before_state jsonb not null,
  after_state jsonb not null,
  occurred_at timestamptz not null default clock_timestamp()
);
create index demand_events_request on private.demand_events(request_id);
create index demand_events_actor on private.demand_events(actor_id);
create trigger demand_event_immutable before update or delete on private.demand_events
  for each row execute function private.document_immutable();
create trigger demand_operation_immutable before update or delete on private.demand_operations
  for each row execute function private.document_immutable();
do $$ declare t text; begin
  foreach t in array array['demand_heads','demand_requirements','demand_claims','demand_operations','demand_events'] loop
    execute format('alter table private.%I enable row level security',t);
    execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
  end loop;
end $$;

create function private.demand_snapshot(target uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('requestId',target,'version',coalesce((select version::text from private.demand_heads where request_id=target),'0'),
    'requirements',coalesce((select jsonb_agg(jsonb_build_object('itemId',r.item_id,'archiveId',r.archive_id,'unit',r.unit,
      'requested',trim_scale(r.quantity)::text,'awarded',trim_scale(t.awarded)::text,'ordered',trim_scale(t.ordered)::text,
      'suitability',trim_scale(t.suitability)::text,'transfers',trim_scale(t.transfers)::text,
      'purchase',trim_scale(r.quantity-t.ordered-t.suitability-t.transfers)::text,
      'unassigned',trim_scale(r.quantity-t.ordered-t.suitability-t.transfers-t.awarded)::text) order by r.item_id)
      from private.demand_requirements r cross join lateral (
        select coalesce(sum(c.quantity) filter(where c.owner_kind='award'),0) awarded,
          coalesce(sum(c.quantity) filter(where c.owner_kind='purchase_order'),0) ordered,
          coalesce(sum(c.quantity) filter(where c.owner_kind='suitability'),0) suitability,
          coalesce(sum(c.quantity) filter(where c.owner_kind='transfer'),0) transfers
        from private.demand_claims c where c.item_id=r.item_id
      ) t where r.request_id=target),'[]'::jsonb),
    'claims',coalesce((select jsonb_agg(jsonb_build_object('claimId',c.id,'itemId',c.item_id,'ownerKind',c.owner_kind,
      'ownerId',c.owner_id,'ownerLineId',c.owner_line_id,'quantity',trim_scale(c.quantity)::text) order by c.id)
      from private.demand_claims c where c.request_id=target),'[]'::jsonb));
$$;

-- Zero releases a retained claim. A conversion is a single batch containing the
-- old claim's release and the new owner's claim. No transient cap checks.
-- Actor authorization here is session/project access only, NOT authority to
-- invent a business owner. Only future checked owning commands may call this.
create function private.demand_apply(actor jsonb, operation uuid, target uuid, expected_version text, changes jsonb, reason text) returns jsonb
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
  if not found or not private.request_project_allowed(actor,(select project_id from public.material_requests where id=target)) then
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
revoke all on function private.demand_snapshot(uuid),private.demand_apply(jsonb,uuid,uuid,text,jsonb,text)
  from public,anon,authenticated,service_role;

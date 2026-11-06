-- 4.7: internal project stock only. No public RPC wrappers/client grants.
-- Owning checked workflows must validate action, source and matching policy.
create table private.stock_accounts (
  id uuid primary key,
  project_id uuid not null references public.projects(id) on delete restrict,
  description text not null check(length(btrim(description)) between 1 and 4000),
  unit text not null check(length(btrim(unit)) between 1 and 4000),
  description_key text generated always as (lower(btrim(description))) stored,
  unit_key text generated always as (lower(btrim(unit))) stored,
  version bigint not null default 0 check(version>=0)
);
-- Bound index entries even for 4000-character MRF descriptions/units. Hashes
-- narrow the lookup only; full text decides equality, including collisions.
create index stock_accounts_identity on private.stock_accounts(project_id,md5(description_key),md5(unit_key));
create function private.stock_account_unique() returns trigger language plpgsql security definer set search_path='' as $$
begin
  update private.account_guard g set revision=g.revision+1 where g.id;
  perform 1 from public.projects p where p.id=new.project_id for update;
  if exists(select 1 from private.stock_accounts a where a.project_id=new.project_id
    and md5(a.description_key)=md5(lower(btrim(new.description))) and md5(a.unit_key)=md5(lower(btrim(new.unit)))
    and a.description_key=lower(btrim(new.description)) and a.unit_key=lower(btrim(new.unit))) then
    raise exception 'Stock identity already exists; reuse its account' using errcode='23505';
  end if;
  return new;
end $$;
create trigger unique_identity before insert on private.stock_accounts for each row execute function private.stock_account_unique();
create table private.stock_operations (
  id uuid primary key,
  actor_id uuid not null references public.profiles(user_id),
  payload jsonb not null,
  effect jsonb not null,
  result jsonb not null
);
create index stock_operations_actor on private.stock_operations(actor_id);
create table private.stock_movements (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references private.stock_accounts(id),
  operation_id uuid not null references private.stock_operations(id) deferrable initially deferred,
  source_kind text not null,
  source_id uuid not null,
  source_line_id uuid not null,
  posting_kind text not null check(posting_kind in('receipt','dispatch','usage','adjustment')),
  quantity numeric not null check(quantity<>0 and quantity>'-Infinity'::numeric and quantity<'Infinity'::numeric),
  reservation_id uuid,
  posted_at timestamptz not null default clock_timestamp(),
  unique(source_kind,source_id,source_line_id,posting_kind),
  check((posting_kind='receipt' and source_kind in('purchase_receipt','transfer_receipt') and quantity>0 and reservation_id is null)
    or (posting_kind='dispatch' and source_kind='transfer_trip' and quantity<0 and reservation_id is not null)
    or (posting_kind='usage' and source_kind='usage_entry' and quantity<0 and reservation_id is null)
    or (posting_kind='adjustment' and source_kind='stock_adjustment' and reservation_id is null))
);
create index stock_movements_account on private.stock_movements(account_id);
create index stock_movements_operation on private.stock_movements(operation_id);
create table private.stock_reservations (
  id uuid primary key,
  account_id uuid not null references private.stock_accounts(id),
  owner_kind text not null check(owner_kind='transfer'),
  owner_id uuid not null,
  owner_line_id uuid not null,
  quantity numeric not null check(quantity>=0 and quantity<'Infinity'::numeric),
  unique(owner_kind,owner_id,owner_line_id,account_id)
);
create index stock_reservations_account on private.stock_reservations(account_id);
alter table private.stock_movements add foreign key(reservation_id) references private.stock_reservations(id);
create index stock_movements_reservation on private.stock_movements(reservation_id);
create table private.stock_events (
  operation_id uuid primary key references private.stock_operations(id),
  actor_id uuid not null references public.profiles(user_id),
  actor_name text not null,
  actor_role text not null,
  reason text not null,
  before_state jsonb not null,
  after_state jsonb not null,
  occurred_at timestamptz not null default clock_timestamp()
);
create index stock_events_actor on private.stock_events(actor_id);
do $$ declare t text; begin
  foreach t in array array['stock_accounts','stock_operations','stock_movements','stock_reservations','stock_events'] loop
    execute format('alter table private.%I enable row level security',t);
    execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
  end loop;
  foreach t in array array['stock_operations','stock_movements','stock_events'] loop
    execute format('create trigger immutable before update or delete on private.%I for each row execute function private.document_immutable()',t);
  end loop;
end $$;
create function private.stock_identity_guard() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception 'Stock identities are retained' using errcode='23514'; end if;
  if tg_table_name='stock_accounts' then
    if (to_jsonb(new)-'version'-'description_key'-'unit_key') is distinct from (to_jsonb(old)-'version'-'description_key'-'unit_key') then
      raise exception 'Stock account identity is fixed' using errcode='23514';
    end if;
  elsif (to_jsonb(new)-'quantity') is distinct from (to_jsonb(old)-'quantity') then
    raise exception 'Stock reservation ownership is fixed' using errcode='23514';
  end if;
  return new;
end $$;
create trigger identity_guard before update or delete on private.stock_accounts for each row execute function private.stock_identity_guard();
create trigger identity_guard before update or delete on private.stock_reservations for each row execute function private.stock_identity_guard();

create function private.stock_snapshot(ids uuid[]) returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('accountId',a.id,'projectId',a.project_id,'description',a.description,'unit',a.unit,
    'version',a.version::text,'onHand',trim_scale(m.quantity)::text,'reserved',trim_scale(r.quantity)::text,
    'available',trim_scale(m.quantity-r.quantity)::text) order by a.id),'[]'::jsonb)
  from private.stock_accounts a
  cross join lateral (select coalesce(sum(quantity),0) quantity from private.stock_movements where account_id=a.id) m
  cross join lateral (select coalesce(sum(quantity),0) quantity from private.stock_reservations where account_id=a.id) r
  where a.id=any(ids);
$$;

-- accounts: [{accountId,projectId,description,unit,expectedVersion}]
-- postings: [{accountId,sourceKind,sourceId,sourceLineId,postingKind,quantity,reservationId?}]
-- reservations: [{reservationId,accountId,ownerKind,ownerId,ownerLineId,quantity}]
-- Calls that also use demand_apply acquire affected project/MRF locks before
-- entering this helper. Source-Site demand authorization belongs to 4.14.
create function private.stock_apply(actor jsonb, operation uuid, accounts jsonb, postings jsonb, reservations jsonb, reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
<<apply_stock>>
declare caller uuid; entry jsonb; account uuid; project uuid; ids uuid[]:='{}'; projects uuid[]:='{}';
  stock private.stock_accounts; reserved private.stock_reservations; receipt private.stock_operations;
  payload jsonb; effect jsonb; previous jsonb; result jsonb; existing_operations uuid[]:='{}'; existing_operation uuid;
  expected text; source_key text; sources text[]:='{}'; reservation_ids uuid[]:='{}'; amount numeric;
  reservation uuid; used numeric; old_amount numeric; changed_ids uuid[]:='{}'; touched boolean:=false;
begin
  perform set_config('lock_timeout','5s',true);
  update private.account_guard g set revision=g.revision+1 where g.id;
  caller:=private.project_actor(actor,false);
  perform 1 from auth.sessions s where s.id=(actor->>'sessionId')::uuid and s.user_id=caller for share;
  if not found then raise exception 'Current workspace access required' using errcode='42501'; end if;
  if operation is null or reason is null or length(btrim(reason)) not between 5 and 4000
    or jsonb_typeof(accounts) is distinct from 'array' or jsonb_typeof(postings) is distinct from 'array'
    or jsonb_typeof(reservations) is distinct from 'array' then
    raise exception 'Invalid stock operation' using errcode='23514';
  end if;
  if jsonb_array_length(accounts) not between 1 and 2000 or jsonb_array_length(postings)+jsonb_array_length(reservations) not between 1 and 2000
    or octet_length(jsonb_build_array(accounts,postings,reservations)::text)>750000 then
    raise exception 'Invalid stock batch size' using errcode='23514';
  end if;
  for entry in select * from jsonb_array_elements(accounts) loop
    account:=(entry->>'accountId')::uuid; project:=(entry->>'projectId')::uuid; expected:=entry->>'expectedVersion';
    if account is null or project is null or account=any(ids) or expected is null or expected !~ '^(0|[1-9][0-9]{0,18})$'
      or jsonb_typeof(entry->'description') is distinct from 'string' or length(btrim(entry->>'description')) not between 1 and 4000
      or jsonb_typeof(entry->'unit') is distinct from 'string' or length(btrim(entry->>'unit')) not between 1 and 4000 then
      raise exception 'Invalid stock account' using errcode='23514';
    end if;
    ids:=array_append(ids,account); projects:=array_append(projects,project);
  end loop;
  perform 1 from public.projects p where p.id=any(projects) order by p.id for update;
  foreach project in array projects loop
    if not exists(select 1 from public.projects p where p.id=project) or not private.request_project_allowed(actor,project) then
      raise exception 'Current stock project access required' using errcode='42501';
    end if;
  end loop;
  perform 1 from private.stock_accounts a where a.id=any(ids) order by a.id for update;
  payload:=jsonb_build_object('accounts',accounts,'postings',postings,'reservations',reservations,'reason',btrim(reason),'role',actor->>'activeRole');
  effect:=payload||jsonb_build_object('accounts',(select jsonb_agg(e-'expectedVersion') from jsonb_array_elements(accounts) e));
  select * into receipt from private.stock_operations o where o.id=operation;
  if found then
    if receipt.actor_id<>caller or receipt.payload<>payload then raise exception 'Stock retry identity reused' using errcode='23514'; end if;
    return receipt.result;
  end if;
  -- Check business source identities before versions. An exact batch replay
  -- returns its original outcome and never reapplies reservation consumption.
  for entry in select * from jsonb_array_elements(postings) loop
    if (entry->>'accountId')::uuid is null or not (entry->>'accountId')::uuid=any(ids) or (entry->>'sourceId')::uuid is null or (entry->>'sourceLineId')::uuid is null
      or entry->>'sourceKind' is null or entry->>'postingKind' is null
      or jsonb_typeof(entry->'quantity') is distinct from 'string' or length(ltrim(entry->>'quantity','-'))>80
      or entry->>'quantity' !~ '^-?[0-9]+(\.[0-9]+)?$' or (entry->>'quantity')::numeric=0
      or entry ? 'postedAt' or entry ? 'effectiveDate' then
      raise exception 'Invalid stock posting' using errcode='23514';
    end if;
    source_key:=jsonb_build_array(entry->>'sourceKind',entry->>'sourceId',entry->>'sourceLineId',entry->>'postingKind')::text;
    if source_key=any(sources) then raise exception 'Duplicate stock source in batch' using errcode='23514'; end if;
    sources:=array_append(sources,source_key);
    select m.operation_id into existing_operation from private.stock_movements m
      where m.source_kind=entry->>'sourceKind' and m.source_id=(entry->>'sourceId')::uuid
        and m.source_line_id=(entry->>'sourceLineId')::uuid and m.posting_kind=entry->>'postingKind';
    existing_operations:=array_append(existing_operations,existing_operation);
  end loop;
  if exists(select 1 from unnest(existing_operations) o where o is not null) then
    select * into receipt from private.stock_operations o where o.id=existing_operations[1];
    if receipt.id is null or receipt.actor_id<>caller or receipt.effect<>effect
      or exists(select 1 from unnest(existing_operations) o where o is distinct from receipt.id) then
      raise exception 'Stock source already posted; review its immutable outcome' using errcode='23514';
    end if;
    insert into private.stock_operations values(operation,caller,payload,effect,receipt.result);
    return receipt.result;
  end if;
  previous:=private.stock_snapshot(ids);
  for entry in select * from jsonb_array_elements(accounts) order by value->>'accountId' loop
    account:=(entry->>'accountId')::uuid;
    select * into stock from private.stock_accounts a where a.id=account;
    if found then
      if stock.project_id<>(entry->>'projectId')::uuid or stock.description_key<>lower(btrim(entry->>'description')) or stock.unit_key<>lower(btrim(entry->>'unit')) then
        raise exception 'Stock identity is fixed' using errcode='23514';
      end if;
      if stock.version::text<>entry->>'expectedVersion' then raise exception 'Stock changed; review balances' using errcode='40001'; end if;
    else
      if entry->>'expectedVersion'<>'0' then raise exception 'Stock changed; review balances' using errcode='40001'; end if;
      if not exists(select 1 from jsonb_array_elements(postings) p where p->>'accountId'=account::text and (p->>'quantity')::numeric>0) then
        raise exception 'First stock account requires a positive posting' using errcode='23514';
      end if;
      insert into private.stock_accounts(id,project_id,description,unit) values(account,(entry->>'projectId')::uuid,btrim(entry->>'description'),btrim(entry->>'unit'));
    end if;
  end loop;
  for entry in select * from jsonb_array_elements(reservations) loop
    reservation:=(entry->>'reservationId')::uuid; account:=(entry->>'accountId')::uuid;
    if reservation is null or reservation=any(reservation_ids) or account is null or not account=any(ids)
      or entry->>'ownerKind' is distinct from 'transfer' or (entry->>'ownerId')::uuid is null or (entry->>'ownerLineId')::uuid is null
      or jsonb_typeof(entry->'quantity') is distinct from 'string' or length(entry->>'quantity')>80
      or entry->>'quantity' !~ '^[0-9]+(\.[0-9]+)?$' then raise exception 'Invalid stock reservation' using errcode='23514'; end if;
    reservation_ids:=array_append(reservation_ids,reservation); amount:=(entry->>'quantity')::numeric;
    select * into reserved from private.stock_reservations r where r.id=reservation;
    old_amount:=coalesce(reserved.quantity,0);
    if reserved.id is not null and row(reserved.account_id,reserved.owner_kind,reserved.owner_id,reserved.owner_line_id)
      is distinct from row(account,entry->>'ownerKind',(entry->>'ownerId')::uuid,(entry->>'ownerLineId')::uuid) then
      raise exception 'Reservation ownership is fixed' using errcode='23514';
    end if;
    select coalesce(-sum((p->>'quantity')::numeric),0) into used from jsonb_array_elements(postings) p
      where p->>'postingKind'='dispatch' and p->>'reservationId'=reservation::text and p->>'accountId'=account::text;
    if used>0 and (reserved.id is null or used>old_amount-amount) then
      raise exception 'Dispatch must consume its existing reservation' using errcode='23514';
    end if;
    if reserved.id is null then
      if amount=0 then raise exception 'Unknown reservation cannot be released' using errcode='23514'; end if;
      insert into private.stock_reservations values(reservation,account,'transfer',(entry->>'ownerId')::uuid,(entry->>'ownerLineId')::uuid,amount);
    elsif amount<>old_amount then
      update private.stock_reservations set quantity=amount where id=reservation;
    else continue;
    end if;
    changed_ids:=array_append(changed_ids,account); touched:=true;
  end loop;
  for entry in select * from jsonb_array_elements(postings) loop
    account:=(entry->>'accountId')::uuid; reservation:=(entry->>'reservationId')::uuid;
    if entry->>'postingKind'='dispatch' and (reservation is null or not reservation=any(reservation_ids)
      or not exists(select 1 from private.stock_reservations r where r.id=reservation and r.account_id=account)) then
      raise exception 'Dispatch must consume its own reservation' using errcode='23514';
    end if;
    insert into private.stock_movements(account_id,operation_id,source_kind,source_id,source_line_id,posting_kind,quantity,reservation_id)
      values(account,operation,entry->>'sourceKind',(entry->>'sourceId')::uuid,(entry->>'sourceLineId')::uuid,entry->>'postingKind',(entry->>'quantity')::numeric,reservation);
    changed_ids:=array_append(changed_ids,account); touched:=true;
  end loop;
  if exists(select 1 from jsonb_array_elements(private.stock_snapshot(ids)) s
    where (s->>'onHand')::numeric<0 or (s->>'available')::numeric<0) then
    raise exception 'Stock cannot be negative or below reservations' using errcode='23514';
  end if;
  update private.stock_accounts a set version=a.version+1 where a.id=any(changed_ids);
  result:=jsonb_build_object('accounts',private.stock_snapshot(ids),'changed',touched);
  insert into private.stock_operations values(operation,caller,payload,effect,result);
  if touched then
    insert into private.stock_events(operation_id,actor_id,actor_name,actor_role,reason,before_state,after_state)
      select operation,caller,p.display_name,actor->>'activeRole',btrim(reason),previous,result from public.profiles p where p.user_id=caller;
  end if;
  return result;
end $$;
revoke all on function private.stock_account_unique(),private.stock_identity_guard(),private.stock_snapshot(uuid[]),private.stock_apply(jsonb,uuid,jsonb,jsonb,jsonb,text)
  from public,anon,authenticated,service_role;

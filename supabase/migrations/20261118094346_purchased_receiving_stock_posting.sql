alter table private.deliveries
  add column parent_delivery_id uuid references private.deliveries(id);
create index delivery_parent on private.deliveries(parent_delivery_id) where parent_delivery_id is not null;

create table private.delivery_receipts (
  delivery_id uuid primary key references private.deliveries(id),
  arrival_at timestamptz not null,
  revision integer not null check (revision > 0),
  posted_at timestamptz,
  review_state text not null default 'pending' check (review_state in ('pending','needs_evidence','approved')),
  review_reason text not null default ''
);

create table private.delivery_receipt_versions (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references private.delivery_receipts(delivery_id),
  revision integer not null,
  snapshot jsonb not null,
  actor jsonb not null,
  recorded_at timestamptz not null default clock_timestamp(),
  unique (delivery_id,revision)
);

create table private.delivery_receipt_files (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references private.delivery_receipt_versions(id),
  kind text not null check (kind in ('generated','signed')),
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
  check (kind='signed' or not current_evidence)
);
create index delivery_receipt_files_version on private.delivery_receipt_files(version_id);
create index delivery_receipt_files_author on private.delivery_receipt_files(created_by) where created_by is not null;
create unique index delivery_receipt_generated on private.delivery_receipt_files(version_id) where kind='generated';
create unique index delivery_receipt_signed_current on private.delivery_receipt_files(version_id) where current_evidence;

do $$
declare relation text;
begin
  foreach relation in array array['delivery_receipts','delivery_receipt_versions','delivery_receipt_files'] loop
    execute format('alter table private.%I enable row level security',relation);
    execute format('revoke all on private.%I from public,anon,authenticated,service_role',relation);
  end loop;
end $$;
create trigger immutable before update or delete on private.delivery_receipt_versions
  for each row execute function private.document_immutable();

create function private.delivery_current_receipt(target uuid) returns jsonb
language sql stable set search_path='' as $$
  select v.snapshot
  from private.delivery_receipts h
  join private.delivery_receipt_versions v on v.delivery_id=h.delivery_id and v.revision=h.revision
  where h.delivery_id=target
$$;

create function private.delivery_warehouse_allocated(parent uuid, line_id text, excluded uuid default null)
returns numeric language sql stable set search_path='' as $$
  select coalesce(sum((line->>'quantity')::numeric),0)
  from private.deliveries child cross join lateral jsonb_array_elements(child.plan->'lines') line
  where child.parent_delivery_id=parent and child.state<>'cancelled'
    and child.id is distinct from excluded and line->>'lineId'=line_id
$$;

create function private.delivery_receipt_lines(target uuid, load jsonb, submitted jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare
  planned jsonb; entered jsonb; quotation_line jsonb; requested jsonb;
  result jsonb:='[]'; key text; expected numeric; accepted numeric; missing numeric; rejected numeric;
begin
  if jsonb_typeof(submitted) is distinct from 'array' or jsonb_array_length(submitted)<>jsonb_array_length(load)
    or (select count(distinct x->>'lineId') from jsonb_array_elements(submitted) x)<>jsonb_array_length(load) then
    raise exception 'Count every dispatched line once' using errcode='P4130';
  end if;
  for planned in select * from jsonb_array_elements(load) loop
    select x into entered from jsonb_array_elements(submitted) x where x->>'lineId'=planned->>'lineId';
    foreach key in array array['accepted','missing','rejected'] loop
      if jsonb_typeof(entered->key) is distinct from 'string' or length(entered->>key)>80
        or entered->>key !~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$' then
        raise exception 'Use exact nonnegative counts' using errcode='P4130';
      end if;
    end loop;
    expected:=(planned->>'quantity')::numeric;
    accepted:=(entered->>'accepted')::numeric;
    missing:=(entered->>'missing')::numeric;
    rejected:=(entered->>'rejected')::numeric;
    if accepted+missing+rejected<>expected or jsonb_typeof(entered->'issue') is distinct from 'string'
      or length(entered->>'issue')>2000 or (missing+rejected>0 and length(btrim(entered->>'issue'))<5) then
      raise exception 'Counts must equal the dispatched quantity; explain discrepancies' using errcode='P4130';
    end if;
    select s,m into quotation_line,requested
    from private.purchasing_records po
    join private.quotation_revisions q on q.id=po.revision_id
    join private.mrf_archive_snapshots archive on archive.id=q.mrf_archive_id
    cross join lateral jsonb_array_elements(po.body->'lines') l
    cross join lateral jsonb_array_elements(q.snapshot->'source'->'lines') s
    cross join lateral jsonb_array_elements(archive.snapshot->'draft'->'items') m
    where po.id=target and l->>'id'=planned->>'lineId' and s->>'id'=l->>'sourceLineId' and m->>'id'=l->>'itemId';
    if not found or coalesce(length(btrim(requested->>'name')),0)=0 or coalesce(length(btrim(requested->>'unit')),0)=0 then
      raise exception 'Approved material basis unavailable' using errcode='P4130';
    end if;
    result:=result||jsonb_build_array(jsonb_build_object(
      'lineId',planned->>'lineId','expected',trim_scale(expected)::text,
      'accepted',trim_scale(accepted)::text,'missing',trim_scale(missing)::text,
      'rejected',trim_scale(rejected)::text,'issue',btrim(entered->>'issue'),
      'description',quotation_line->>'description','unit',quotation_line->>'unit',
      'stockDescription',requested->>'name','stockUnit',requested->>'unit',
      'stockQuantity',trim_scale(accepted*(quotation_line->>'conversionFactor')::numeric)::text));
  end loop;
  return result;
end $$;

create function private.delivery_post_stock(actor jsonb, operation uuid, target uuid, project uuid, lines jsonb, reason text)
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
      'accountId',account_id,'sourceKind','purchase_receipt','sourceId',target,
      'sourceLineId',line->>'lineId','postingKind','receipt','quantity',line->>'stockQuantity'));
  end loop;
  if jsonb_array_length(postings)=0 then
    raise exception 'No stock to post' using errcode='P4131';
  end if;
  perform private.stock_apply(actor,operation,accounts,postings,'[]',reason);
end $$;

create function private.delivery_record_receipt(actor jsonb, command jsonb, load private.deliveries, project uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  kind text:=command->>'type'; role_name text:=actor->>'activeRole';
  receiver text:=case when load.plan->>'route'='warehouse' then 'Procurement' else 'Site Personnel' end;
  head private.delivery_receipts; current_version private.delivery_receipt_versions;
  arrival timestamptz; lines jsonb; snapshot jsonb; new_version_id uuid; next_revision integer;
begin
  if load.state<>'dispatched' then raise exception 'Dispatch this load before receiving' using errcode='P4131'; end if;
  if (kind in ('receive','recount','post') and role_name is distinct from receiver)
    or (kind in ('approveEvidence','requestEvidence') and role_name is distinct from 'Accounting') then
    raise exception 'Receiving or Accounting authorization required' using errcode='42501';
  end if;
  select * into head from private.delivery_receipts where delivery_id=load.id for update;
  if kind='receive' then
    if found then raise exception 'Receipt already confirmed' using errcode='P4131'; end if;
    if coalesce(command->>'arrivalAt','') !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$' then
      raise exception 'Actual Philippine arrival time required' using errcode='P4130';
    end if;
    arrival:=(command->>'arrivalAt')::timestamptz;
    if not isfinite(arrival) or arrival<(load.departure->>'at')::timestamptz or arrival>clock_timestamp() then
      raise exception 'Arrival must follow departure and be no later than now' using errcode='P4130';
    end if;
    insert into private.delivery_receipts(delivery_id,arrival_at,revision) values(load.id,arrival,1);
    next_revision:=1;
  elsif head.delivery_id is null then
    raise exception 'Confirm the receipt first' using errcode='P4131';
  else
    select * into current_version from private.delivery_receipt_versions
      where delivery_id=load.id and revision=head.revision;
    if kind='post' then
      if receiver<>'Site Personnel' or head.posted_at is not null then
        raise exception 'Only unposted site stock can be posted' using errcode='P4131';
      end if;
      perform private.delivery_post_stock(actor,(command->>'requestId')::uuid,load.id,project,
        current_version.snapshot->'lines','Posted delivery '||load.ref);
      update private.delivery_receipts set posted_at=clock_timestamp() where delivery_id=load.id;
      return current_version.snapshot;
    elsif kind in ('approveEvidence','requestEvidence') then
      if (command->>'receiptVersionId')::uuid is distinct from current_version.id then
        raise exception 'Receipt version changed' using errcode='40001';
      end if;
      if kind='approveEvidence' and (
        head.review_state<>'pending' or
        not exists(select 1 from private.delivery_receipt_files f where f.version_id=current_version.id and f.kind='generated' and f.state='complete') or
        not exists(select 1 from private.delivery_receipt_files f where f.version_id=current_version.id and f.current_evidence and f.state='complete')
      ) then raise exception 'Current verified archives are required' using errcode='P4132'; end if;
      update private.delivery_receipts
        set review_state=case when kind='approveEvidence' then 'approved' else 'needs_evidence' end,
            review_reason=btrim(command->>'reason')
        where delivery_id=load.id;
      return current_version.snapshot||jsonb_build_object('revision',head.revision,'reviewedEvidence',
        (select id from private.delivery_receipt_files where version_id=current_version.id and current_evidence));
    end if;
    if head.posted_at is not null or exists(select 1 from private.deliveries where parent_delivery_id=load.id and state='dispatched') then
      raise exception 'Recount unavailable after posting or onward departure' using errcode='P4131';
    end if;
    arrival:=head.arrival_at;
    next_revision:=head.revision+1;
  end if;

  lines:=private.delivery_receipt_lines(load.po_id,load.plan->'lines',command->'receiptLines');
  if exists(select 1 from jsonb_array_elements(lines) l
    where (l->>'accepted')::numeric<private.delivery_warehouse_allocated(load.id,l->>'lineId')) then
    raise exception 'Revise the scheduled onward loads before reducing accepted quantities' using errcode='P4121';
  end if;
  if jsonb_typeof(command->'extraGoods') is distinct from 'string' or length(command->>'extraGoods')>2000 then
    raise exception 'Invalid extra goods note' using errcode='P4130';
  end if;
  snapshot:=jsonb_build_object('ref',load.ref,'revision',next_revision,'arrivalAt',arrival,
    'plan',load.plan,'departure',load.departure,'lines',lines,'extraGoods',btrim(command->>'extraGoods'));
  update private.delivery_receipts set revision=next_revision,review_state='pending',review_reason='' where delivery_id=load.id;
  insert into private.delivery_receipt_versions(delivery_id,revision,snapshot,actor)
    values(load.id,next_revision,snapshot,private.document_actor_snapshot(actor)) returning id into new_version_id;
  insert into private.delivery_receipt_files(version_id,kind,name)
    values(new_version_id,'generated',load.ref||'-receipt-v'||next_revision::text||'.pdf');
  return snapshot;
end $$;

create or replace function private.delivery_plan(value jsonb,target uuid,excluded uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare line jsonb; ordered jsonb; used numeric; field text; factor numeric; parent uuid:=(value->>'_parent')::uuid; accepted numeric;
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
    if parent is not null then
      select (x->>'accepted')::numeric into accepted
      from jsonb_array_elements(private.delivery_current_receipt(parent)->'lines') x
      where x->>'lineId'=line->>'lineId';
      if accepted is null or (line->>'quantity')::numeric+private.delivery_warehouse_allocated(parent,line->>'lineId',excluded)>accepted then
        raise exception 'Quantity exceeds remaining warehouse custody' using errcode='P4121';
      end if;
      continue;
    end if;
    select coalesce(sum((x->>'quantity')::numeric),0) into used from private.deliveries d
      cross join lateral jsonb_array_elements(d.plan->'lines') x
      where d.po_id=target and d.parent_delivery_id is null and d.id<>excluded and d.state<>'cancelled' and x->>'lineId'=line->>'lineId';
    if used+(line->>'quantity')::numeric>(ordered->>'offeredQuantity')::numeric then
      raise exception 'Quantity already allocated to other deliveries' using errcode='P4121'; end if;
  end loop;
  return value-'_parent';
end $$;

create or replace function private.delivery_command(actor jsonb,command jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
<<delivery_write>>
declare caller uuid; operation uuid:=(command->>'requestId')::uuid; target uuid:=(command->>'poId')::uuid;
  selected uuid:=(command->>'deliveryId')::uuid; kind text:=command->>'type'; reason text:=coalesce(command->>'reason','');
  receipt private.delivery_operations; r private.purchasing_records; d private.deliveries;
  payload jsonb; result jsonb; number bigint; code text; current_version bigint; plan jsonb; departure jsonb;
  parent private.deliveries; parent_id uuid; parent_arrival timestamptz; receipt_snapshot jsonb;
  floor_time timestamptz; ceiling_time timestamptz; sent_time timestamptz; clear_time timestamptz;
begin
  perform set_config('lock_timeout','5s',true);
  update private.account_guard set revision=revision+1 where id;
  caller:=private.delivery_actor(actor);
  if kind in ('schedule','scheduleForward','revise','cancel','dispatch','correct')
    and actor->>'activeRole' is distinct from 'Logistics' then
    raise exception 'Logistics required' using errcode='42501';
  end if;
  select pr.* into r from private.purchasing_records pr where pr.id=target and pr.kind='po';
  if r.id is null or not private.request_project_allowed(actor,r.project_id) then
    raise exception 'Delivery unavailable' using errcode='42501';
  end if;
  payload:=jsonb_build_object('command',command,'role',actor->>'activeRole');
  select * into receipt from private.delivery_operations where id=operation;
  if found then
    if receipt.actor_id<>caller or receipt.payload<>payload then raise exception 'Retry identity reused' using errcode='P4803'; end if;
    return receipt.result;
  end if;
  if operation is null or target is null or selected is null or coalesce(kind,'') not in('schedule','scheduleForward','revise','cancel','dispatch','correct','receive','recount','post','approveEvidence','requestEvidence')
    or coalesce(command->>'expectedVersion','') !~ '^(0|[1-9][0-9]{0,18})$'
    or length(reason)>2000 or kind in('revise','cancel','correct','recount','requestEvidence') and length(btrim(reason))<5 then raise exception 'Invalid delivery action or reason' using errcode='23514'; end if;
  if not exists(select 1 from private.po_issuances where po_id=target) then raise exception 'Issued PO required' using errcode='P4111'; end if;
  perform 1 from public.projects where id=r.project_id for update;
  perform 1 from public.material_requests where id=r.request_id for update;
  perform 1 from private.purchasing_records where id=target for update;
  insert into private.delivery_heads(po_id) values(target) on conflict do nothing;
  select version into current_version from private.delivery_heads where po_id=target for update;
  if current_version::text is distinct from command->>'expectedVersion' then raise exception 'Delivery capacity or record changed' using errcode='40001'; end if;
  select * into d from private.deliveries where id=selected for update;
  parent_id:=case when kind='scheduleForward' then (command->>'parentDeliveryId')::uuid else d.parent_delivery_id end;
  if kind='scheduleForward' and parent_id is null then raise exception 'Warehouse receipt required' using errcode='P4131'; end if;
  if parent_id is not null then
    select * into parent from private.deliveries candidate
    where candidate.id=parent_id and candidate.po_id=target and candidate.parent_delivery_id is null
      and candidate.state='dispatched' and candidate.plan->>'route'='warehouse';
    select arrival_at into parent_arrival from private.delivery_receipts where delivery_id=parent.id;
    if parent_arrival is null then raise exception 'Confirmed warehouse receipt required' using errcode='P4131'; end if;
  end if;
  if kind in ('schedule','scheduleForward') then
    if d.id is not null then raise exception 'Delivery already exists' using errcode='23505'; end if;
    plan:=(command->'plan')-'_parent';
    if parent_id is not null then
      select plan||jsonb_build_object('_parent',parent_id,'route','site','pickup',parent.plan->>'address',
        'destination',coalesce(nullif(r.body->'fields'->>'shipTo',''),p.name),
        'address',coalesce(nullif(r.body->'fields'->>'shipAddress',''),p.location))
        into plan from public.projects p where p.id=r.project_id;
    end if;
    plan:=private.delivery_plan(plan,target,selected);
    select document_code into code from public.projects where id=r.project_id;
    if code is null then raise exception 'Project document code required' using errcode='23514'; end if;
    insert into private.document_counters(project_id,series,last_value) values(r.project_id,'DEL',1)
      on conflict on constraint document_counters_pkey do update set last_value=private.document_counters.last_value+1 returning last_value into number;
    insert into private.deliveries(id,po_id,ref,state,plan,parent_delivery_id) values(selected,target,code||'-DEL-'||lpad(number::text,greatest(4,length(number::text)),'0'),'scheduled',plan,parent_id);
  else
    if d.id is null or d.po_id<>target then raise exception 'Delivery unavailable' using errcode='42501'; end if;
    if kind in('revise','cancel','dispatch') and d.state<>'scheduled' or kind='correct' and d.state<>'dispatched' then raise exception 'Action unavailable in current state' using errcode='P4122'; end if;
    if kind='revise' then
      plan:=(command->'plan')-'_parent';
      if parent_id is not null then
        plan:=plan||jsonb_build_object('_parent',parent_id,'route','site','pickup',d.plan->>'pickup',
          'destination',d.plan->>'destination','address',d.plan->>'address');
      end if;
      plan:=private.delivery_plan(plan,target,selected);
      update private.deliveries set plan=delivery_write.plan where id=selected;
    elsif kind='cancel' then
      update private.deliveries set state='cancelled' where id=selected;
    elsif kind='dispatch' then
      if parent_id is null and not private.payment_cleared(target) then raise exception 'Current Accounting clearance required' using errcode='P4116'; end if;
      -- Recheck capacity without requiring an overdue plan to be rescheduled first.
      perform private.delivery_plan(jsonb_set(d.plan||case when parent_id is null then '{}'::jsonb else jsonb_build_object('_parent',parent_id) end,'{plannedDate}',to_jsonb((clock_timestamp() at time zone 'Asia/Manila')::date::text)),target,selected);
      select recorded_at into clear_time from private.payment_clearances where po_id=target order by recorded_at desc,id desc limit 1;
      select coalesce((select c.details->>'sentAt' from private.po_issuance_corrections c where c.issuance_id=i.id order by c.version desc limit 1),i.details->>'sentAt')::timestamptz
        into sent_time from private.po_issuances i where i.po_id=target;
      floor_time:=case when parent_id is null then greatest(d.created_at,clear_time,sent_time) else greatest(d.created_at,parent_arrival) end; ceiling_time:=clock_timestamp();
      departure:=private.delivery_departure(command->'departure',floor_time,ceiling_time);
      update private.deliveries set state='dispatched',departure=delivery_write.departure,departure_floor=floor_time,departure_ceiling=ceiling_time where id=selected;
    elsif kind='correct' then
      select arrival_at into ceiling_time from private.delivery_receipts where delivery_id=selected;
      departure:=private.delivery_departure(command->'departure',d.departure_floor,least(d.departure_ceiling,ceiling_time));
      update private.deliveries set departure=delivery_write.departure where id=selected;
    else
      receipt_snapshot:=private.delivery_record_receipt(actor,command,d,r.project_id);
    end if;
  end if;
  update private.delivery_heads set version=version+1 where po_id=target;
  select * into d from private.deliveries where id=selected;
  insert into private.delivery_events(delivery_id,action,reason,actor,snapshot)
    values(selected,kind,reason,private.document_actor_snapshot(actor),jsonb_build_object('plan',d.plan,'departure',d.departure,'receipt',receipt_snapshot));
  result:=jsonb_build_object('targetId',selected,'changed',true);
  if kind in ('receive','recount') then
    result:=result||jsonb_build_object('receiptVersionId',(
      select v.id from private.delivery_receipt_versions v
      where v.delivery_id=selected and v.revision=(receipt_snapshot->>'revision')::integer));
  end if;
  insert into private.delivery_operations(id,actor_id,po_id,payload,result) values(operation,caller,target,payload,result);
  perform private.document_notify(r.project_id); return result;
end $$;


create function private.delivery_receipt_view(target uuid, role_name text) returns jsonb
language sql stable set search_path='' as $$
  select v.snapshot-'plan'-'departure'||jsonb_build_object(
    'id',v.id,'postedAt',h.posted_at,'reviewState',h.review_state,'reviewReason',h.review_reason,
    'canRecount',h.posted_at is null and not exists(
      select 1 from private.deliveries child where child.parent_delivery_id=d.id and child.state='dispatched'),
    'generated',(select jsonb_build_object('id',
      case when role_name<>'Site Personnel' or d.plan->>'route'<>'warehouse' then g.id end,'state',g.state)
      from private.delivery_receipt_files g where g.version_id=v.id and g.kind='generated'),
    'signed',(select jsonb_build_object('state',s.state,'id',
      case when role_name='Accounting' or role_name='Procurement' and d.plan->>'route'='warehouse' then s.id end)
      from private.delivery_receipt_files s where s.version_id=v.id and s.current_evidence),
    'signedUploadState',(select s.state from private.delivery_receipt_files s
      where s.version_id=v.id and s.kind='signed' and not s.current_evidence and s.state<>'complete'
        and not exists(select 1 from private.delivery_receipt_files c where c.version_id=v.id and c.current_evidence
          and (c.created_at,c.id)>(s.created_at,s.id))
      order by s.created_at desc,s.id desc limit 1),
    'historicalFiles',coalesce((select jsonb_agg(jsonb_build_object(
      'id',f.id,'kind',f.kind,'revision',previous.revision,'name',f.name) order by previous.revision desc,f.created_at desc)
      from private.delivery_receipt_files f
      join private.delivery_receipt_versions previous on previous.id=f.version_id
      where previous.delivery_id=d.id and f.state='complete'
        and (previous.id<>v.id or f.kind='signed' and not f.current_evidence)
        and (f.kind='generated' and (role_name<>'Site Personnel' or d.plan->>'route'<>'warehouse')
          or f.kind='signed' and (role_name='Accounting' or role_name='Procurement' and d.plan->>'route'='warehouse'))),'[]'::jsonb))
  from private.delivery_receipts h
  join private.deliveries d on d.id=h.delivery_id
  join private.delivery_receipt_versions v on v.delivery_id=h.delivery_id and v.revision=h.revision
  where h.delivery_id=target
$$;
create or replace function private.deliveries_read(actor jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform private.delivery_actor(actor);
  return jsonb_build_object('role',actor->>'activeRole',
    'orders',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'ref',r.ref,'projectId',r.project_id,'project',p.name,
      'vendor',r.body->'fields'->>'vendorName','pickup',coalesce(r.body->'fields'->>'vendorAddress',''),
      'destination',coalesce(nullif(r.body->'fields'->>'shipTo',''),p.name),
      'address',coalesce(nullif(r.body->'fields'->>'shipAddress',''),p.location),'cleared',private.payment_cleared(r.id),
      'version',coalesce((select version from private.delivery_heads where po_id=r.id),0)::text,
      'lines',(select jsonb_agg(jsonb_build_object('id',l->>'id','description',s->>'description','unit',s->>'unit',
        'requestedUnit',coalesce(mi.data->>'unit',s->>'unit'),'quantity',l->>'offeredQuantity','factor',s->>'conversionFactor',
        'allocated',coalesce((select sum((x->>'quantity')::numeric)::text from private.deliveries dd cross join lateral jsonb_array_elements(dd.plan->'lines') x
          where dd.po_id=r.id and dd.parent_delivery_id is null and dd.state<>'cancelled' and x->>'lineId'=l->>'id'),'0')))
        from jsonb_array_elements(r.body->'lines') l
        join private.quotation_revisions q on q.id=r.revision_id
        cross join lateral jsonb_array_elements(q.snapshot->'source'->'lines') s
        left join public.material_request_items mi on mi.id=(l->>'itemId')::uuid
        where s->>'id'=l->>'sourceLineId')) order by r.ref)
      from private.purchasing_records r join public.projects p on p.id=r.project_id
      where exists(select 1 from private.po_issuances i where i.po_id=r.id) and private.request_project_allowed(actor,r.project_id)),'[]'),
    'deliveries',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'poId',d.po_id,'ref',d.ref,'state',d.state,'plan',d.plan,'departure',d.departure,
      'createdAt',d.created_at,'version',h.version::text,'parentDeliveryId',d.parent_delivery_id,
      'receipt',private.delivery_receipt_view(d.id,actor->>'activeRole'),
      'warehouseRemaining',case when d.plan->>'route'='warehouse' then coalesce((
        select jsonb_object_agg(l->>'lineId',trim_scale((l->>'accepted')::numeric-private.delivery_warehouse_allocated(d.id,l->>'lineId'))::text)
        from jsonb_array_elements(private.delivery_current_receipt(d.id)->'lines') l),'{}'::jsonb) else '{}'::jsonb end,
        'history',coalesce((select jsonb_agg(jsonb_build_object('action',e.action,'reason',e.reason,'at',e.recorded_at,'actorName',e.actor->>'name','snapshot',case when e.snapshot->'receipt' is null or e.snapshot->'receipt'='null' then e.snapshot-'receipt'-'evidenceId'
          else jsonb_set(e.snapshot,'{receipt}',(e.snapshot->'receipt')-'reviewedEvidence') end)
        order by e.recorded_at,e.id) from private.delivery_events e where e.delivery_id=d.id),'[]')) order by d.created_at desc,d.id)
      from private.deliveries d join private.delivery_heads h on h.po_id=d.po_id join private.purchasing_records r on r.id=d.po_id
      where private.request_project_allowed(actor,r.project_id)),'[]'));
end $$;


revoke all on function private.delivery_current_receipt(uuid),private.delivery_warehouse_allocated(uuid,text,uuid),
  private.delivery_receipt_lines(uuid,jsonb,jsonb),private.delivery_post_stock(jsonb,uuid,uuid,uuid,jsonb,text),
  private.delivery_record_receipt(jsonb,jsonb,private.deliveries,uuid),private.delivery_receipt_view(uuid,text)
  from public,anon,authenticated,service_role;

create function private.delivery_file_action(actor jsonb, file_id uuid, version_id uuid, action text, lease uuid, patch jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare
  caller uuid; role_name text:=actor->>'activeRole'; receiver text; project uuid;
  delivery private.deliveries; receipt_version private.delivery_receipt_versions; file private.delivery_receipt_files;
  folder private.project_document_folders; current_version boolean; verified_size integer;
  worker boolean:=action in ('workerClaim','workerId','workerComplete','workerFail');
begin
  if action <> 'read' then
    perform set_config('lock_timeout','5s',true);
    update private.account_guard set revision=revision+1 where id;
  end if;
  if not worker then caller:=private.delivery_actor(actor); end if;
  if file_id is not null then
    select * into file from private.delivery_receipt_files f where f.id=file_id;
    version_id:=file.version_id;
  end if;
  select * into receipt_version from private.delivery_receipt_versions v where v.id=version_id;
  select * into delivery from private.deliveries d where d.id=receipt_version.delivery_id;
  select po.project_id into project from private.purchasing_records po where po.id=delivery.po_id;
  if project is null or (not worker and not private.request_project_allowed(actor,project)) then
    raise exception 'Receipt unavailable' using errcode='42501';
  end if;
  receiver:=case when delivery.plan->>'route'='warehouse' then 'Procurement' else 'Site Personnel' end;
  if action='read' then
    if file.state is distinct from 'complete' or (file.kind='signed' and role_name is distinct from 'Accounting'
      and not (receiver='Procurement' and role_name='Procurement'))
      or (file.kind='generated' and receiver='Procurement' and role_name='Site Personnel') then
      raise exception 'Receipt file unavailable' using errcode='42501';
    end if;
    return jsonb_build_object('driveId',file.drive_id,'size',file.size,'name',file.name,'mime',file.mime);
  end if;
  perform 1 from private.delivery_heads where po_id=delivery.po_id for update;
  select revision=receipt_version.revision into current_version
  from private.delivery_receipts where delivery_id=delivery.id for update;
  if file.id is not null then
    select * into file from private.delivery_receipt_files f where f.id=file_id for update;
  end if;
  if not worker and role_name is distinct from receiver and role_name is distinct from 'Accounting' then
    raise exception 'Receiving or Accounting role required' using errcode='42501';
  end if;

  if action='begin' then
    if not current_version then raise exception 'Receipt version changed' using errcode='40001'; end if;
    if coalesce(length(btrim(patch->>'name')),0) not between 1 and 240
      or coalesce(patch->>'mime','') not in ('application/pdf','image/jpeg','image/png','image/webp')
      or coalesce(patch->>'size','') !~ '^[0-9]{1,8}$'
      or (patch->>'size')::integer not between 12 and 20971520
      or coalesce(patch->>'sha256','') !~ '^[0-9a-f]{64}$' then
      raise exception 'Invalid signed evidence metadata' using errcode='23514';
    end if;
    select * into file from private.delivery_receipt_files f
      where f.version_id=version_id and f.kind='signed' and f.created_by=caller
        and f.created_revision=(actor->>'revision')::bigint and f.created_role=role_name
        and f.sha256=patch->>'sha256' and f.size=(patch->>'size')::integer and f.mime=patch->>'mime'
        and (f.state in ('uploading','processing') or f.state='complete' and f.current_evidence)
      order by f.created_at desc,f.id desc limit 1;
    if file.id is null then
      select * into folder from private.project_document_folders f where f.project_id=project and f.current;
      if folder.folder_id is null then raise exception 'Project Drive folder required' using errcode='P4201'; end if;
      insert into private.delivery_receipt_files(version_id,kind,state,name,mime,size,sha256,folder_id,root_id,created_by,created_revision,created_role,created_actor)
        values(version_id,'signed','uploading',btrim(patch->>'name'),patch->>'mime',(patch->>'size')::integer,patch->>'sha256',
          folder.folder_id,folder.root_id,caller,(actor->>'revision')::bigint,role_name,private.document_actor_snapshot(actor)) returning * into file;
    end if;
    return jsonb_build_object('id',file.id,'offset',file.offset_bytes,'state',file.state);
  elsif action='retryVersion' then
    select * into file from private.delivery_receipt_files f
      where f.version_id=version_id and f.kind=patch->>'kind'
      order by f.created_at desc,f.id desc limit 1 for update;
    if file.id is null then return null; end if;
    if file.state='failed' and (file.kind='generated' or file.offset_bytes=file.size) then
      update private.delivery_receipt_files set state=case when file.kind='generated' then 'pending' else 'processing' end
      where id=file.id;
      perform private.document_notify(project);
    end if;
    return jsonb_build_object('id',file.id);
  elsif action='uploadClaim' then
    if file.kind is distinct from 'signed' or file.created_by is distinct from caller
      or file.created_revision is distinct from (actor->>'revision')::bigint or file.created_role is distinct from role_name then
      raise exception 'Upload unavailable' using errcode='42501';
    end if;
    if file.state in ('processing','complete') then
      return jsonb_build_object('state',file.state,'offset_bytes',file.offset_bytes);
    end if;
    if file.state<>'uploading' or not current_version then raise exception 'Reselect evidence for the current receipt' using errcode='40001'; end if;
    if file.lease_until>clock_timestamp() then raise exception 'Upload is already processing' using errcode='55P03'; end if;
    update private.delivery_receipt_files set lease_id=gen_random_uuid(),lease_until=clock_timestamp()+interval '90 seconds'
      where id=file.id returning * into file;
    return to_jsonb(file);
  elsif action in ('uploadCheckpoint','uploadFinish','uploadRelease','uploadExpired') then
    if file.created_by is distinct from caller or file.created_revision is distinct from (actor->>'revision')::bigint
      or file.created_role is distinct from role_name or lease is null or file.lease_id is distinct from lease then
      raise exception 'Upload lease or authority changed' using errcode='42501';
    end if;
    if action='uploadCheckpoint' then
      update private.delivery_receipt_files set drive_id=coalesce(drive_id,patch->>'driveId'),
        session_ticket=coalesce(patch->>'ticket',session_ticket),offset_bytes=coalesce((patch->>'offset')::integer,offset_bytes)
        where id=file.id returning * into file;
      return to_jsonb(file);
    end if;
    if action='uploadFinish' then
      update private.delivery_receipt_files set state='processing',offset_bytes=size,session_ticket=null,lease_id=null,lease_until=null where id=file.id;
    elsif action='uploadExpired' then
      update private.delivery_receipt_files set state='failed',session_ticket=null,lease_id=null,lease_until=null where id=file.id;
    else
      update private.delivery_receipt_files set lease_id=null,lease_until=null where id=file.id;
    end if;
    if action<>'uploadRelease' then perform private.document_notify(project); end if;
    return null;
  elsif action='workerClaim' then
    if file.state not in ('pending','processing') or file.lease_until>clock_timestamp() then return null; end if;
    if file.kind='signed' and not exists(select 1 from public.profiles p where p.user_id=file.created_by
      and p.is_active and p.access_revision=file.created_revision) then
      update private.delivery_receipt_files set state='failed',lease_id=null,lease_until=null where id=file.id;
      perform private.document_notify(project);
      return null;
    end if;
    if file.folder_id is null then
      select * into folder from private.project_document_folders f where f.project_id=project and f.current;
    end if;
    update private.delivery_receipt_files set lease_id=gen_random_uuid(),lease_until=clock_timestamp()+interval '90 seconds',
      folder_id=coalesce(folder_id,folder.folder_id),root_id=coalesce(root_id,folder.root_id)
      where id=file.id returning * into file;
    return to_jsonb(file)||jsonb_build_object('snapshot',receipt_version.snapshot,'receiverName',receipt_version.actor->>'name');
  elsif action in ('workerId','workerComplete','workerFail') then
    if lease is null or file.lease_id is distinct from lease then raise exception 'Archive lease changed' using errcode='40001'; end if;
    if action='workerId' then
      update private.delivery_receipt_files set drive_id=coalesce(drive_id,patch->>'driveId') where id=file.id returning * into file;
      return to_jsonb(file);
    end if;
    if action='workerFail' then
      update private.delivery_receipt_files set state='failed',lease_id=null,lease_until=null where id=file.id;
    else
      verified_size:=coalesce(file.size,(patch->>'size')::integer);
      if file.drive_id is null or verified_size is null or verified_size<5
        or coalesce(file.sha256,patch->>'sha256','') !~ '^[0-9a-f]{64}$' then
        raise exception 'Verified archive metadata required' using errcode='23514';
      end if;
      if file.kind='signed' and not exists(select 1 from public.profiles p where p.user_id=file.created_by
        and p.is_active and p.access_revision=file.created_revision) then
        raise exception 'Evidence uploader access changed' using errcode='42501';
      end if;
      update private.delivery_receipt_files set state='complete',size=verified_size,
        sha256=coalesce(file.sha256,patch->>'sha256'),offset_bytes=verified_size,lease_id=null,lease_until=null where id=file.id;
      if file.kind='signed' and current_version and not exists(select 1 from private.delivery_receipt_files f
        where f.version_id=version_id and f.current_evidence and (f.created_at,f.id)>(file.created_at,file.id)) then
        update private.delivery_receipt_files f set current_evidence=false where f.version_id=version_id and f.current_evidence;
        update private.delivery_receipt_files set current_evidence=true where id=file.id;
        update private.delivery_receipts set review_state='pending',review_reason='' where delivery_id=delivery.id;
        update private.delivery_heads set version=version+1 where po_id=delivery.po_id;
        insert into private.delivery_events(delivery_id,action,reason,actor,snapshot)
          values(delivery.id,'signedEvidence','',file.created_actor,
            jsonb_build_object('plan',delivery.plan,'departure',delivery.departure,'evidenceId',file.id));
      end if;
    end if;
    perform private.document_notify(project);
    return null;
  end if;
  raise exception 'Invalid receipt file action' using errcode='23514';
end $$;

create function public.delivery_receipt_file(actor jsonb, file_id uuid, version_id uuid, action text, lease uuid, patch jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select private.delivery_file_action(actor,file_id,version_id,action,lease,patch)
$$;

revoke all on function private.delivery_file_action(jsonb,uuid,uuid,text,uuid,jsonb),
  public.delivery_receipt_file(jsonb,uuid,uuid,text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.delivery_file_action(jsonb,uuid,uuid,text,uuid,jsonb),
  public.delivery_receipt_file(jsonb,uuid,uuid,text,uuid,jsonb) to service_role;

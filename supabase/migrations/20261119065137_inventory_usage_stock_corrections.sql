create table private.inventory_entries (
  id uuid primary key,
  project_id uuid not null references public.projects(id),
  actor_id uuid not null references public.profiles(user_id),
  kind text not null check (kind in ('usage','correction','opening')),
  reason text not null check (length(reason) between 5 and 2000),
  related_movement_id uuid references private.stock_movements(id),
  payload jsonb not null,
  check (related_movement_id is null or kind='correction')
);
create index inventory_entries_project on private.inventory_entries(project_id);
create index inventory_entries_actor on private.inventory_entries(actor_id);
create index inventory_entries_related on private.inventory_entries(related_movement_id) where related_movement_id is not null;

create table private.inventory_usage_notes (
  entry_id uuid not null references private.inventory_entries(id),
  account_id uuid not null references private.stock_accounts(id),
  reason text not null check (length(reason) between 5 and 2000),
  primary key(entry_id,account_id)
);
create index inventory_usage_notes_account on private.inventory_usage_notes(account_id);

alter table private.inventory_entries enable row level security;
alter table private.inventory_usage_notes enable row level security;
revoke all on private.inventory_entries,private.inventory_usage_notes from public,anon,authenticated,service_role;
create trigger immutable before update or delete on private.inventory_entries
  for each row execute function private.document_immutable();
create trigger immutable before update or delete on private.inventory_usage_notes
  for each row execute function private.document_immutable();

create function private.inventory_command(viewer jsonb, command jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  operation uuid:=(command->>'operationId')::uuid;
  project uuid:=(command->>'projectId')::uuid;
  category text:=command->>'kind';
  reason_text text:=btrim(command->>'reason');
  related uuid:=(command->>'relatedMovementId')::uuid;
  role_name text:=viewer->>'activeRole';
  caller uuid; previous private.inventory_entries;
  material private.stock_accounts; item jsonb; lines jsonb:=command->'lines';
  account uuid; label text; unit_text text; amount numeric; expected text; note text;
  accounts jsonb:='[]'; postings jsonb:='[]'; ids uuid[]:='{}';
  payload jsonb:=jsonb_build_object('command',command,'role',role_name);
begin
  if operation is null or project is null or coalesce(category,'') not in ('usage','correction','opening')
    or coalesce(length(reason_text),0) not between 5 and 2000
    or (related is not null and category<>'correction')
    or jsonb_typeof(lines) is distinct from 'array'
    or jsonb_array_length(lines) not between 1 and 100
    or (category<>'usage' and jsonb_array_length(lines)<>1) then
    raise exception 'Invalid stock entry' using errcode='P4170';
  end if;
  perform set_config('lock_timeout','5s',true);
  update private.account_guard set revision=revision+1 where id;
  caller:=private.delivery_actor(viewer);
  if not private.request_project_allowed(viewer,project) or coalesce(role_name,'') not in ('Accounting','Site Personnel')
    or (category='usage' and role_name<>'Site Personnel') or (category='opening' and role_name<>'Accounting') then
    raise exception 'Current stock action authority required' using errcode='42501';
  end if;
  perform 1 from public.projects p where p.id=project for update;
  if not found then raise exception 'Project unavailable' using errcode='42501'; end if;
  select * into previous from private.inventory_entries e where e.id=operation;
  if found then
    if previous.actor_id<>caller or previous.payload<>payload then
      raise exception 'Stock entry identity belongs to another submission' using errcode='P4173';
    end if;
    return jsonb_build_object('id',previous.id);
  end if;

  insert into private.inventory_entries values(operation,project,caller,category,reason_text,related,payload);
  for item in select value from jsonb_array_elements(lines) loop
    account:=(item->>'accountId')::uuid;
    expected:=item->>'expectedVersion';
    note:=nullif(btrim(item->>'note'),'');
    if account is null or account=any(ids)
      or jsonb_typeof(item->'quantity') is distinct from 'string'
      or length(item->>'quantity')>80 or item->>'quantity' !~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'
      or (item->>'quantity')::numeric<=0
      or (note is not null and (category<>'usage' or length(note) not between 5 and 2000)) then
      raise exception 'Enter exact positive amounts for distinct materials' using errcode='P4170';
    end if;
    ids:=array_append(ids,account);
    amount:=(item->>'quantity')::numeric;
    if category='opening' then
      label:=btrim(item->>'description');
      unit_text:=btrim(item->>'unit');
      expected:='0';
      if coalesce(length(label),0) not between 1 and 4000 or coalesce(length(unit_text),0) not between 1 and 4000 then
        raise exception 'Material description and unit required' using errcode='P4170';
      end if;
      if exists(select 1 from private.stock_accounts a where a.id=account or
        (a.project_id=project and md5(a.description_key)=md5(lower(label)) and md5(a.unit_key)=md5(lower(unit_text))
         and a.description_key=lower(label) and a.unit_key=lower(unit_text))) then
        raise exception 'Stock identity already exists' using errcode='P4174';
      end if;
    else
      select * into material from private.stock_accounts a where a.id=account and a.project_id=project;
      if not found then raise exception 'Material unavailable for this project' using errcode='P4171'; end if;
      if material.version::text is distinct from expected then
        raise exception 'Stock changed; review latest quantities' using errcode='40001';
      end if;
      label:=material.description;
      unit_text:=material.unit;
      if category='correction' and coalesce(command->>'direction','') not in ('add','remove') then
        raise exception 'Choose to add or remove stock' using errcode='P4170';
      end if;
      if category='usage' or command->>'direction'='remove' then
        if amount>(private.stock_snapshot(array[account])->0->>'available')::numeric then
          raise exception 'Quantity exceeds available stock; reserved stock is protected' using errcode='P4172';
        end if;
        amount:=-amount;
      end if;
      if related is not null and not exists(select 1 from private.stock_movements m where m.id=related and m.account_id=account) then
        raise exception 'Choose a movement for this material' using errcode='P4171';
      end if;
    end if;
    accounts:=accounts||jsonb_build_array(jsonb_build_object('accountId',account,'projectId',project,
      'description',label,'unit',unit_text,'expectedVersion',expected));
    postings:=postings||jsonb_build_array(jsonb_build_object('accountId',account,'sourceId',operation,
      'sourceLineId',account,'sourceKind',case when category='usage' then 'usage_entry' else 'stock_adjustment' end,
      'postingKind',case when category='usage' then 'usage' else 'adjustment' end,'quantity',trim_scale(amount)::text));
    if note is not null then insert into private.inventory_usage_notes values(operation,account,note); end if;
  end loop;
  perform private.stock_apply(viewer,operation,accounts,postings,'[]',reason_text);
  perform private.document_notify(project);
  return jsonb_build_object('id',operation);
end $$;

create function private.inventory_movement(target uuid)
returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('id',m.id,'accountId',a.id,'description',a.description,'unit',a.unit,
    'kind',coalesce(e.kind,m.posting_kind),'at',m.posted_at,'quantity',trim_scale(m.quantity)::text,
    'reason',coalesce(note.reason,ev.reason),'actorName',ev.actor_name,'actorRole',ev.actor_role,
    'relatedMovementId',e.related_movement_id,'usageId',case when e.kind='usage' then e.id end,
    'deliveryId',d.id,'transferId',trip.transfer_id)
  from private.stock_movements m join private.stock_accounts a on a.id=m.account_id
  join private.stock_events ev on ev.operation_id=m.operation_id
  left join private.inventory_entries e on e.id=m.operation_id
  left join private.inventory_usage_notes note on note.entry_id=e.id and note.account_id=a.id
  left join private.deliveries d on m.source_kind='purchase_receipt' and d.id=m.source_id
  left join private.transfer_trips trip on m.source_kind in ('transfer_receipt','transfer_trip') and trip.id=m.source_id
  where m.id=target
$$;

create function private.inventory_receipt_scopes(target uuid)
returns jsonb language sql stable set search_path='' as $$
  select coalesce(jsonb_agg(distinct r.scope_id),'[]')
  from private.stock_movements m
  left join private.deliveries d on m.source_kind='purchase_receipt' and d.id=m.source_id
  left join private.purchasing_records po on po.id=d.po_id
  left join private.transfer_trips trip on m.source_kind='transfer_receipt' and trip.id=m.source_id
  left join private.transfers t on t.id=trip.transfer_id
  join public.material_requests r on r.id=coalesce(po.request_id,t.request_id)
  where m.account_id=target and m.posting_kind='receipt' and r.scope_id is not null
$$;

create function private.inventory_read(viewer jsonb, mode text, selected_project uuid, target uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  role_name text:=viewer->>'activeRole'; projects uuid[];
  permitted uuid[]; accounts uuid[]; balances jsonb:='[]';
  usages jsonb:='[]'; movements jsonb:='[]'; selected_found boolean:=true;
begin
  perform private.delivery_actor(viewer);
  if coalesce(mode,'') not in ('stock','usage','new','material','entry') then
    raise exception 'Invalid inventory view' using errcode='P4170';
  end if;
  select array_agg(p.id) into projects from public.projects p
    where private.request_project_allowed(viewer,p.id);
  permitted:=projects;
  if selected_project is not null then
    permitted:=array(select p from unnest(projects) p where p=selected_project);
  end if;
  if mode in ('stock','new','material') then
    select array_agg(a.id) into accounts from private.stock_accounts a
      where a.project_id=any(permitted) and (mode<>'material' or a.id=target);
    select coalesce(jsonb_agg(balance||jsonb_build_object('scopeIds',
      private.inventory_receipt_scopes((balance->>'accountId')::uuid))
      order by lower(balance->>'description'),balance->>'accountId'),'[]')
      into balances from jsonb_array_elements(private.stock_snapshot(accounts)) balance;
  end if;
  if mode in ('stock','entry') then
    select coalesce(jsonb_agg(
      jsonb_build_object('id',e.id,'projectId',e.project_id,'reason',e.reason,'actorName',ev.actor_name,
        'at',ev.occurred_at,'materialCount',(select count(*) from private.stock_movements m where m.operation_id=e.id))
      order by ev.occurred_at desc,e.id),'[]') into usages
    from private.inventory_entries e join private.stock_events ev on ev.operation_id=e.id
    where e.kind='usage' and e.project_id=any(permitted) and (mode<>'entry' or e.id=target);
  end if;
  if mode='material' then
    selected_found:=jsonb_array_length(balances)=1;
    select coalesce(jsonb_agg(private.inventory_movement(m.id) order by m.posted_at desc,m.id),'[]') into movements
    from private.stock_movements m where m.account_id=any(accounts);
  elsif mode='entry' then
    selected_found:=jsonb_array_length(usages)=1;
    if selected_found then
      select coalesce(jsonb_agg(private.inventory_movement(m.id) order by m.id),'[]') into movements
        from private.stock_movements m where m.operation_id=target;
    end if;
  end if;
  return jsonb_build_object('mode',mode,'target',target,'role',role_name,'found',selected_found,
    'projects',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name) order by p.name,p.id),'[]')
      from public.projects p where p.id=any(projects)),
    'scopes',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'projectId',s.project_id,'name',s.name) order by s.name,s.id),'[]')
      from public.scopes s where s.project_id=any(permitted) and mode in ('stock','new')),
    'accounts',balances,'usage',usages,'movements',movements);
end $$;

create function public.inventory_command(viewer jsonb, command jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select private.inventory_command(viewer,command)
$$;
create function public.inventory_read(viewer jsonb, mode text, selected_project uuid, target uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select private.inventory_read(viewer,mode,selected_project,target)
$$;
revoke all on function private.inventory_command(jsonb,jsonb),public.inventory_command(jsonb,jsonb),
  private.inventory_read(jsonb,text,uuid,uuid),public.inventory_read(jsonb,text,uuid,uuid),
  private.inventory_receipt_scopes(uuid),private.inventory_movement(uuid) from public,anon,authenticated,service_role;
grant execute on function private.inventory_command(jsonb,jsonb),public.inventory_command(jsonb,jsonb),
  private.inventory_read(jsonb,text,uuid,uuid),public.inventory_read(jsonb,text,uuid,uuid) to service_role;

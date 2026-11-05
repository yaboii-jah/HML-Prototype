-- Unit 4.4: service-only entry points recheck the current application session.
create table private.suppliers (
  id uuid primary key default gen_random_uuid(),
  profile jsonb not null check(jsonb_typeof(profile)='object'),
  name_key text not null unique,
  is_active boolean not null default true,
  version bigint not null default 1 check(version>0)
);
create table private.supplier_operations (
  id uuid primary key,
  actor_id uuid not null references public.profiles(user_id) on delete restrict,
  supplier_id uuid not null references private.suppliers(id) on delete restrict deferrable initially deferred,
  payload jsonb not null,
  result jsonb
);
create index supplier_operations_actor_idx on private.supplier_operations(actor_id);
create index supplier_operations_supplier_idx on private.supplier_operations(supplier_id);
alter table private.suppliers enable row level security;
alter table private.supplier_operations enable row level security;
revoke all on private.suppliers,private.supplier_operations from public,anon,authenticated,service_role;

create function private.supplier_profile(value jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare result jsonb:='{}'; field text; content text; maximum integer;
begin
  if jsonb_typeof(value) is distinct from 'object' then
    raise exception 'Supplier details required' using errcode='23514'; end if;
  foreach field in array array['name','address','tin','contactName','email','phone','accreditationNote'] loop
    maximum:=case field when 'name' then 200 when 'address' then 1000 when 'accreditationNote' then 2000 when 'tin' then 100 when 'phone' then 100 else 254 end;
    if jsonb_typeof(value->field) is distinct from 'string' then
      raise exception 'Invalid supplier field' using errcode='23514'; end if;
    content:=regexp_replace(value->>field,'^[[:space:]]+|[[:space:]]+$','','g');
    if length(content)>maximum or (field='name' and content='')
      or (field='email' and content<>'' and content !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
      raise exception 'Check supplier details' using errcode='23514'; end if;
    result:=result||jsonb_build_object(field,content);
  end loop;
  return result;
end;
$$;
create function private.supplier_view(target uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select s.profile||jsonb_build_object('id',s.id,'active',s.is_active,'version',s.version::text)
  from private.suppliers s where s.id=target;
$$;
create function private.supplier_history(target uuid default null) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(h.entry order by h.occurred_at desc,h.id),'[]'::jsonb) from (
    select a.id,a.occurred_at,jsonb_build_object('id',a.id,'supplierId',a.entity_id,
      'supplierName',a.details->>'supplierName','actorName',a.actor_name,'actorRole',a.actor_role,
      'at',a.occurred_at,'action',a.action,'changes',a.details->'changes','reason',a.details->>'reason') entry
    from private.audit_events a where a.entity_type='supplier' and (target is null or a.entity_id=target)
    order by a.occurred_at desc,a.id limit 30
  ) h;
$$;
create function private.suppliers_read(actor jsonb,target_supplier uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform private.project_actor(actor);
  if actor->>'activeRole'='Site Personnel' then raise exception 'Supplier access denied' using errcode='42501'; end if;
  if target_supplier is not null then
    return jsonb_build_object('supplier',private.supplier_view(target_supplier),'history',private.supplier_history(target_supplier));
  end if;
  return jsonb_build_object('suppliers',coalesce((select jsonb_agg(private.supplier_view(s.id) order by s.name_key,s.id)
    from private.suppliers s),'[]'::jsonb),'history',private.supplier_history());
end;
$$;
create function private.supplier_command(actor jsonb,command jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
<<mutation>>
declare caller uuid; operation uuid:=(command->>'requestId')::uuid; kind text:=command->>'type';
  target uuid; receipt private.supplier_operations; supplier private.suppliers; profile jsonb;
  before_value jsonb; after_value jsonb; result jsonb; changed boolean:=false; reason text; recipient record;
begin
  perform set_config('lock_timeout','5s',true);
  update private.account_guard set revision=revision+1 where id;
  caller:=private.project_actor(actor);
  if actor->>'activeRole'<>'Procurement' then raise exception 'Procurement required' using errcode='42501'; end if;
  if operation is null or kind is null or kind not in('createSupplier','saveSupplier','setSupplierStatus') then
    raise exception 'Invalid supplier command' using errcode='23514'; end if;
  target:=case when kind='createSupplier' then gen_random_uuid() else (command->>'supplierId')::uuid end;
  if target is null then raise exception 'Supplier required' using errcode='23514'; end if;
  insert into private.supplier_operations(id,actor_id,supplier_id,payload) values(operation,caller,target,command) on conflict do nothing;
  select * into receipt from private.supplier_operations o where o.id=operation for update;
  if receipt.actor_id<>caller or receipt.payload<>command then raise exception 'Request identity reused' using errcode='P4401'; end if;
  if receipt.result is not null then return receipt.result; end if;
  target:=receipt.supplier_id;
  if kind<>'createSupplier' then
    select * into supplier from private.suppliers s where s.id=target for update;
    if not found then raise exception 'Supplier not found' using errcode='P4402'; end if;
    if jsonb_typeof(command->'expectedVersion') is distinct from 'string' or supplier.version::text<>command->>'expectedVersion' then
      raise exception 'Supplier changed; review again' using errcode='40001'; end if;
    before_value:=private.supplier_view(target);
  end if;
  if kind='setSupplierStatus' then
    reason:=regexp_replace(command->>'reason','^[[:space:]]+|[[:space:]]+$','','g');
    if jsonb_typeof(command->'active') is distinct from 'boolean' or jsonb_typeof(command->'reason') is distinct from 'string'
      or length(reason) not between 5 and 2000 then raise exception 'Status reason required' using errcode='23514'; end if;
    update private.suppliers set is_active=(command->>'active')::boolean,version=version+1
      where id=target and is_active is distinct from (command->>'active')::boolean;
    changed:=found;
  else
    profile:=private.supplier_profile(command->'profile');
    if kind='createSupplier' then
      insert into private.suppliers(id,profile,name_key) values(target,profile,lower(regexp_replace(profile->>'name','[[:space:]]+',' ','g')));
      changed:=true;
    else
      update private.suppliers set profile=mutation.profile,name_key=lower(regexp_replace(mutation.profile->>'name','[[:space:]]+',' ','g')),version=version+1
        where id=target and suppliers.profile is distinct from mutation.profile;
      changed:=found;
    end if;
  end if;
  after_value:=private.supplier_view(target);
  if changed then
    insert into private.audit_events(actor_user_id,actor_name,actor_role,action,entity_type,entity_id,request_id,details)
      select caller,p.display_name,actor->>'activeRole',case kind when 'createSupplier' then 'supplier.created'
        when 'saveSupplier' then 'supplier.updated' else case when (after_value->>'active')::boolean then 'supplier.reactivated' else 'supplier.deactivated' end end,
        'supplier',target,operation,jsonb_build_object('supplierName',after_value->>'name','reason',reason,
          'changes',jsonb_build_object('before',before_value,'after',after_value)) from public.profiles p where p.user_id=caller;
  end if;
  result:=jsonb_build_object('supplierId',target,'changed',changed);
  update private.supplier_operations set result=mutation.result where id=operation;
  -- Follow the foundation lock order: guard, actor/record, then final Auth locks.
  -- Minimal signals go only to currently authorized non-Site sessions.
  if changed then
    perform s.id from auth.sessions s join private.session_bindings b on b.session_id=s.id order by s.id for share of s;
    for recipient in select b.* from private.session_bindings b
      join auth.sessions s on s.id=b.session_id and s.user_id=b.user_id
      join public.profiles p on p.user_id=b.user_id join auth.users u on u.id=p.user_id
      where p.is_active and p.access_revision=b.access_revision and (s.not_after is null or s.not_after>now())
        and not u.is_anonymous and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now())
        and exists(select 1 from public.role_grants g where g.user_id=p.user_id and g.role<>'Site Personnel')
    loop
      perform realtime.send('{}'::jsonb,'foundation_changed',private.foundation_topic(recipient.user_id,recipient.access_revision,recipient.session_id),true);
    end loop;
  end if;
  return result;
end;
$$;
create function public.suppliers_read(actor jsonb,target_supplier uuid default null) returns jsonb
language sql security invoker set search_path='' as $$ select private.suppliers_read(actor,target_supplier); $$;
create function public.supplier_command(actor jsonb,command jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select private.supplier_command(actor,command); $$;
revoke all on function private.supplier_profile(jsonb),private.supplier_view(uuid),private.supplier_history(uuid),
  private.suppliers_read(jsonb,uuid),private.supplier_command(jsonb,jsonb),public.suppliers_read(jsonb,uuid),public.supplier_command(jsonb,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function private.suppliers_read(jsonb,uuid),private.supplier_command(jsonb,jsonb),
  public.suppliers_read(jsonb,uuid),public.supplier_command(jsonb,jsonb) to service_role;

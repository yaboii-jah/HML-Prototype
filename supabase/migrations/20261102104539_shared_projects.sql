-- Unit 3.4. Authenticated clients retain read-only RLS access; application
-- queries/commands use service-only wrappers over private checked functions.
create table private.project_operations (
  id uuid primary key,
  actor_id uuid not null references public.profiles(user_id) on delete restrict,
  project_id uuid not null,
  payload jsonb not null check(jsonb_typeof(payload)='object'),
  result jsonb,
  created_at timestamptz not null default clock_timestamp()
);
create index project_operations_actor_idx on private.project_operations(actor_id);
create index project_operations_project_idx on private.project_operations(project_id);
alter table private.project_operations enable row level security;
revoke all on private.project_operations from public,anon,authenticated,service_role;

create function private.project_actor(actor jsonb, writing boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare caller uuid := (actor->>'userId')::uuid;
begin
  perform set_config('lock_timeout','5s',true);
  perform 1 from auth.users u where u.id=caller and not u.is_anonymous and u.email_confirmed_at is not null
    and (u.banned_until is null or u.banned_until<=now()) for share;
  if not found then raise exception 'Current workspace access required' using errcode='42501'; end if;
  perform 1 from public.profiles p where p.user_id=caller for share;
  if not exists(select 1 from public.profiles p
    join private.session_bindings b on b.user_id=p.user_id and b.access_revision=p.access_revision
    join auth.sessions s on s.id=b.session_id and s.user_id=p.user_id
    join public.role_grants g on g.user_id=p.user_id and g.role=actor->>'activeRole'
    where p.user_id=caller and p.is_active and p.access_revision::text=actor->>'revision'
      and s.id=(actor->>'sessionId')::uuid and (s.not_after is null or s.not_after>now()))
    or (writing and actor->>'activeRole' not in('Administrator','Project Manager')) then
    raise exception 'Current workspace access required' using errcode='42501';
  end if;
  return caller;
end;
$$;

create function private.project_snapshot(target uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',p.id,'name',p.name,'location',p.location,'code',p.document_code,
    'version',p.version::text,'budget',(select b.amount::text from public.project_budgets b where b.project_id=p.id))
  from public.projects p where p.id=target;
$$;
create function private.scope_snapshot(target uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',s.id,'name',s.name,'version',s.version::text,
    'budget',(select b.amount::text from public.scope_budgets b where b.scope_id=s.id))
  from public.scopes s where s.id=target;
$$;

create function private.project_summary(target uuid, financial boolean) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',p.id,'name',p.name,'location',p.location,'code',p.document_code,
    'codeLocked',p.code_locked_at is not null,'version',p.version::text,
    'scopeCount',(select count(*) from public.scopes s where s.project_id=p.id))
    || case when financial then jsonb_build_object('financial',jsonb_build_object(
      'budget',b.amount::text,
      'allocated',case when (select count(*) from public.scopes s where s.project_id=p.id)=
        (select count(*) from public.scopes s join public.scope_budgets sb on sb.scope_id=s.id where s.project_id=p.id)
        then (select coalesce(sum(sb.amount),0)::text from public.scopes s join public.scope_budgets sb on sb.scope_id=s.id where s.project_id=p.id) end,
      'unallocated',case when b.amount is not null and (select count(*) from public.scopes s where s.project_id=p.id)=
        (select count(*) from public.scopes s join public.scope_budgets sb on sb.scope_id=s.id where s.project_id=p.id)
        then (b.amount-(select coalesce(sum(sb.amount),0) from public.scopes s join public.scope_budgets sb on sb.scope_id=s.id where s.project_id=p.id))::text end))
      else '{}'::jsonb end
  from public.projects p left join public.project_budgets b on b.project_id=p.id where p.id=target;
$$;

create function private.project_history(target uuid default null) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(h.entry order by h.occurred_at desc,h.id),'[]'::jsonb) from (
    select a.id,a.occurred_at,jsonb_build_object('id',a.id,'actorName',a.actor_name,'actorRole',a.actor_role,
      'action',a.action,'projectId',a.details->>'projectId','projectName',a.details->>'projectName',
      'at',a.occurred_at,'changes',a.details->'changes') entry
    from private.audit_events a where a.entity_type in('project','scope') and a.details ? 'projectId'
      and (target is null or a.details->>'projectId'=target::text)
    order by a.occurred_at desc,a.id limit 30
  ) h;
$$;

create function private.projects_read(actor jsonb, target_project uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare caller uuid; financial boolean; project jsonb;
begin
  caller:=private.project_actor(actor);
  financial:=actor->>'activeRole'<>'Site Personnel';
  if target_project is null then
    return jsonb_build_object('projects',coalesce((select jsonb_agg(private.project_summary(p.id,financial) order by p.name,p.id)
      from public.projects p where financial or exists(select 1 from public.project_assignments a where a.project_id=p.id and a.user_id=caller)),'[]'::jsonb),
      'history',case when financial then private.project_history() else '[]'::jsonb end);
  end if;
  if financial or exists(select 1 from public.project_assignments a where a.project_id=target_project and a.user_id=caller) then
    project:=private.project_summary(target_project,financial);
    if project is not null then
      project:=project||jsonb_build_object('scopes',coalesce((select jsonb_agg(
        jsonb_build_object('id',s.id,'name',s.name,'version',s.version::text)
        ||case when financial then jsonb_build_object('budget',b.amount::text) else '{}'::jsonb end order by s.name,s.id)
        from public.scopes s left join public.scope_budgets b on b.scope_id=s.id where s.project_id=target_project),'[]'::jsonb));
      if actor->>'activeRole'='Administrator' then
        project:=project||jsonb_build_object('assignments',coalesce((select jsonb_agg(jsonb_build_object('id',a.user_id,'name',p.display_name) order by a.user_id)
          from public.project_assignments a join public.profiles p on p.user_id=a.user_id where a.project_id=target_project),'[]'::jsonb));
      elsif actor->>'activeRole'='Project Manager' then
        project:=project||jsonb_build_object('assignmentCount',(select count(*) from public.project_assignments a where a.project_id=target_project));
      end if;
    end if;
  end if;
  return jsonb_build_object('project',project,'history',case when financial then private.project_history(target_project) else '[]'::jsonb end);
end;
$$;

create function private.project_money(value jsonb) returns numeric
language plpgsql immutable set search_path='' as $$
declare amount numeric;
begin
  if jsonb_typeof(value) is distinct from 'string' or (value#>>'{}') !~ '^[0-9]{1,16}(\.[0-9]{1,2})?$' then
    raise exception 'An explicit exact PHP amount is required' using errcode='23514'; end if;
  amount:=(value#>>'{}')::numeric;
  if amount>9999999999999999.99 then raise exception 'PHP amount exceeds supported range' using errcode='23514'; end if;
  return amount;
end;
$$;

create function private.project_command(actor jsonb, command jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
<<project_mutation>>
declare
  caller uuid; operation uuid:=(command->>'requestId')::uuid; kind text:=command->>'type';
  target uuid; scope_id uuid; receipt private.project_operations; project public.projects; scope public.scopes;
  before_value jsonb; after_value jsonb; result jsonb; amount numeric; current_amount numeric; allocated numeric;
  changed boolean:=false; event text; entity text; entity_id uuid;
  current_assignments uuid[]; expected_assignments uuid[]; cleared bigint:=0;
begin
  -- Account commands take this guard before profiles/projects. Taking it first
  -- here prevents an assignment/reservation appearing after deletion checks.
  if kind='deleteProject' then update private.account_guard set revision=revision+1 where id; end if;
  caller:=private.project_actor(actor,true);
  if operation is null or kind is null or kind not in('createProject','saveProject','createScope','saveScope','deleteScope','deleteProject') then
    raise exception 'Invalid project operation' using errcode='23514'; end if;
  target:=case when kind='createProject' then gen_random_uuid() else (command->>'projectId')::uuid end;
  if target is null then raise exception 'Project identity required' using errcode='23514'; end if;
  -- Reserve the retry key before effects; concurrent replays wait on this row.
  insert into private.project_operations(id,actor_id,project_id,payload) values(operation,caller,target,command) on conflict do nothing;
  select * into receipt from private.project_operations o where o.id=operation for update;
  if receipt.actor_id<>caller or receipt.payload<>command then raise exception 'Request identity reused' using errcode='P3406'; end if;
  target:=receipt.project_id;
  if receipt.result is not null then
    return receipt.result||jsonb_build_object('deleted',not exists(select 1 from public.projects p where p.id=target));
  end if;

  if kind='createProject' then
    if jsonb_typeof(command->'name') is distinct from 'string' or length(btrim(command->>'name')) not between 1 and 200
      or jsonb_typeof(command->'location') is distinct from 'string' or length(btrim(command->>'location')) not between 1 and 500
      or jsonb_typeof(command->'code') is distinct from 'string' or command->>'code' !~ '^[A-Z0-9]+(-[A-Z0-9]+)*$'
      or length(command->>'code')>20 then raise exception 'Invalid project details' using errcode='23514'; end if;
    amount:=private.project_money(command->'budget');
    insert into public.projects(id,name,location,document_code,creation_request_id)
      values(target,btrim(command->>'name'),btrim(command->>'location'),command->>'code',operation);
    insert into public.project_budgets(project_id,amount) values(target,amount);
    changed:=true; event:='project.created'; entity:='project'; entity_id:=target;
    after_value:=private.project_snapshot(target);
  else
    select * into project from public.projects p where p.id=target for update;
    if not found then raise exception 'Project removed' using errcode='P3405'; end if;
    if jsonb_typeof(command->'projectVersion') is distinct from 'string' or project.version::text<>command->>'projectVersion' then
      raise exception 'Project changed; review and reapply' using errcode='40001'; end if;
    before_value:=private.project_snapshot(target);
    if kind='saveProject' then
      if jsonb_typeof(command->'name') is distinct from 'string' or length(btrim(command->>'name')) not between 1 and 200
        or jsonb_typeof(command->'location') is distinct from 'string' or length(btrim(command->>'location')) not between 1 and 500
        or jsonb_typeof(command->'code') is distinct from 'string' or command->>'code' !~ '^[A-Z0-9]+(-[A-Z0-9]+)*$'
        or length(command->>'code')>20 then raise exception 'Invalid project details' using errcode='23514'; end if;
      if project.code_locked_at is not null and project.document_code is distinct from command->>'code' then
        raise exception 'Document code is locked' using errcode='P3403'; end if;
      amount:=private.project_money(command->'budget');
      select coalesce(sum(b.amount),0) into allocated from public.scopes s join public.scope_budgets b on b.scope_id=s.id where s.project_id=target;
      if allocated>amount then raise exception 'Scope allocations exceed project budget' using errcode='P3401'; end if;
      update public.projects set name=btrim(command->>'name'),location=btrim(command->>'location'),document_code=command->>'code'
        where id=target and (name is distinct from btrim(command->>'name') or location is distinct from btrim(command->>'location') or document_code is distinct from command->>'code');
      changed:=found;
      select b.amount into current_amount from public.project_budgets b where b.project_id=target;
      if current_amount is distinct from amount then
        insert into public.project_budgets(project_id,amount) values(target,amount) on conflict(project_id) do update set amount=excluded.amount;
        changed:=true;
      end if;
      event:='project.updated'; entity:='project'; entity_id:=target; after_value:=private.project_snapshot(target);
    elsif kind='deleteProject' then
      if project.code_locked_at is not null or exists(select 1 from private.account_operations o
        where o.kind='provision' and o.state='reserved' and o.payload->'projectIds' ? target::text) then
        raise exception 'Project is referenced by provisioning or document use' using errcode='P3402'; end if;
      select coalesce(array_agg(a.user_id order by a.user_id),array[]::uuid[]) into current_assignments from public.project_assignments a where a.project_id=target;
      if actor->>'activeRole'='Administrator' then
        if jsonb_typeof(command->'assignmentIds') is distinct from 'array' or jsonb_typeof(command->'clearAssignments') is distinct from 'boolean' then
          raise exception 'Assignment confirmation required' using errcode='23514'; end if;
        select coalesce(array_agg(value::uuid order by value::uuid),array[]::uuid[]) into expected_assignments from jsonb_array_elements_text(command->'assignmentIds');
        if expected_assignments<>current_assignments then raise exception 'Assignments changed; review again' using errcode='P3404'; end if;
        if cardinality(current_assignments)>0 and command->>'clearAssignments'<>'true' then raise exception 'Assignment confirmation required' using errcode='P3404'; end if;
      elsif cardinality(current_assignments)>0 then raise exception 'Administrator must clear assignments first' using errcode='42501'; end if;
      -- Stable ordering of affected profile locks; their access triggers revoke
      -- all prior bindings, while permanent identities/other assignments stay.
      perform 1 from public.profiles p where p.user_id=any(current_assignments) order by p.user_id for update;
      delete from public.project_assignments where project_id=target;
      get diagnostics cleared=row_count;
      delete from public.projects where id=target;
      changed:=true; event:='project.deleted'; entity:='project'; entity_id:=target; after_value:=null;
    else
      if kind='createScope' then
        scope_id:=gen_random_uuid(); before_value:=null;
      else
        scope_id:=(command->>'scopeId')::uuid;
        select * into scope from public.scopes s where s.id=scope_id and s.project_id=target for update;
        if not found then raise exception 'Scope removed' using errcode='P3405'; end if;
        if jsonb_typeof(command->'scopeVersion') is distinct from 'string' or scope.version::text<>command->>'scopeVersion' then
          raise exception 'Scope changed; review and reapply' using errcode='40001'; end if;
        before_value:=private.scope_snapshot(scope_id);
      end if;
      if kind='deleteScope' then
        -- Delete the budget while its scope still exists so the allocation
        -- trigger can find and stamp the parent; handle missing budget too.
        delete from public.scope_budgets where scope_budgets.scope_id=project_mutation.scope_id;
        if not found then update public.projects set version=version+1 where id=target; end if;
        delete from public.scopes where id=scope_id;
        changed:=true; event:='scope.deleted'; after_value:=null;
      else
        if jsonb_typeof(command->'name') is distinct from 'string' or
          (command->>'name' not in('General Requirement','Structural Works','Civil Works','Architectural','Mechanical','Electrical','Plumbing & Sanitary','Fire Protection','Medical Gas','Variation Order')
          and (kind='createScope' or command->>'name' is distinct from scope.name)) then
          raise exception 'Choose a standard scope name' using errcode='23514'; end if;
        amount:=private.project_money(command->'budget');
        select b.amount into current_amount from public.project_budgets b where b.project_id=target;
        select coalesce(sum(b.amount),0) into allocated from public.scopes s join public.scope_budgets b on b.scope_id=s.id where s.project_id=target and s.id<>project_mutation.scope_id;
        if current_amount is null or allocated+amount>current_amount then raise exception 'Scope allocations exceed project budget' using errcode='P3401'; end if;
        if kind='createScope' then
          insert into public.scopes(id,project_id,name,creation_request_id) values(scope_id,target,command->>'name',operation);
          insert into public.scope_budgets(scope_id,amount) values(scope_id,amount);
          changed:=true; event:='scope.created';
        else
          update public.scopes set name=command->>'name' where id=scope_id and name is distinct from command->>'name';
          changed:=found;
          select b.amount into current_amount from public.scope_budgets b where b.scope_id=project_mutation.scope_id;
          if current_amount is distinct from amount then
            insert into public.scope_budgets(scope_id,amount) values(scope_id,amount) on conflict on constraint scope_budgets_pkey do update set amount=excluded.amount;
            changed:=true;
          elsif changed then update public.projects set version=version+1 where id=target; end if;
          event:='scope.updated';
        end if;
        after_value:=private.scope_snapshot(scope_id);
      end if;
      entity:='scope'; entity_id:=scope_id;
    end if;
  end if;
  if changed then
    insert into private.audit_events(actor_user_id,actor_name,actor_role,action,entity_type,entity_id,request_id,details)
    select caller,p.display_name,actor->>'activeRole',event,entity,entity_id,operation,
      jsonb_build_object('projectId',target,'projectName',case when entity='scope' then project.name else coalesce(after_value->>'name',project.name,before_value->>'name') end,
        'changes',jsonb_build_object('before',before_value,'after',after_value,'clearedAssignments',cleared))
    from public.profiles p where p.user_id=caller;
  end if;
  result:=jsonb_build_object('projectId',target,'deleted',kind='deleteProject','scopeId',scope_id,'changed',changed);
  update private.project_operations set result=project_mutation.result where id=operation;
  return result;
end;
$$;

create function public.projects_read(actor jsonb,target_project uuid default null) returns jsonb
language sql security invoker set search_path='' as $$ select private.projects_read(actor,target_project); $$;
create function public.project_command(actor jsonb,command jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select private.project_command(actor,command); $$;
revoke all on function private.project_actor(jsonb,boolean),private.project_snapshot(uuid),private.scope_snapshot(uuid),private.project_summary(uuid,boolean),
  private.project_history(uuid),private.projects_read(jsonb,uuid),private.project_money(jsonb),private.project_command(jsonb,jsonb),
  public.projects_read(jsonb,uuid),public.project_command(jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.projects_read(jsonb,uuid),private.project_command(jsonb,jsonb),public.projects_read(jsonb,uuid),public.project_command(jsonb,jsonb) to service_role;

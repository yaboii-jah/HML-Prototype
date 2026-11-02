-- Unit 3.1: protected account/project storage; application commands follow in 3.2-3.4.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema private revoke all on tables from public, anon, authenticated;
alter default privileges in schema private revoke execute on functions from public, anon, authenticated;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete restrict,
  display_name text not null check (display_name = btrim(display_name) and length(display_name) between 1 and 100),
  is_active boolean not null default false,
  access_revision bigint not null default 1 check (access_revision > 0),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.role_grants (
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  role text not null check (role in ('Site Personnel', 'Project Manager', 'Procurement', 'Finance', 'Logistics', 'Accounting', 'Administrator')),
  primary key (user_id, role)
);
create index role_grants_role_user_idx on public.role_grants(role, user_id);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null check (name = btrim(name) and length(name) between 1 and 200),
  location text not null default '' check (location = btrim(location) and length(location) <= 500),
  document_code text unique check (document_code ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$' and length(document_code) between 1 and 20),
  code_locked_at timestamptz,
  creation_request_id uuid not null unique default gen_random_uuid(),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index projects_name_key on public.projects(lower(name));

-- Exact decimal values: reject fractions of a cent and non-finite values before rounding.
create table public.project_budgets (
  project_id uuid primary key references public.projects(id) on delete cascade,
  amount numeric not null check (amount between 0 and 9999999999999999.99 and amount = trunc(amount, 2))
);
create table public.scopes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null check (name = btrim(name) and length(name) between 1 and 200),
  creation_request_id uuid not null unique default gen_random_uuid(),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index scopes_project_name_key on public.scopes(project_id, lower(name));
create table public.scope_budgets (
  scope_id uuid primary key references public.scopes(id) on delete cascade,
  amount numeric not null check (amount between 0 and 9999999999999999.99 and amount = trunc(amount, 2))
);
create table public.project_assignments (
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  primary key (user_id, project_id)
);
create index project_assignments_project_idx on public.project_assignments(project_id);

create table private.session_bindings (
  session_id uuid primary key references auth.sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  access_revision bigint not null check (access_revision > 0),
  bound_at timestamptz not null default now()
);
create index session_bindings_user_idx on private.session_bindings(user_id);

create table private.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references public.profiles(user_id) on delete restrict,
  actor_name text not null check (length(btrim(actor_name)) between 1 and 100),
  actor_role text not null check (actor_role in ('Site Personnel', 'Project Manager', 'Procurement', 'Finance', 'Logistics', 'Accounting', 'Administrator')),
  action text not null check (length(btrim(action)) > 0),
  entity_type text not null check (length(btrim(entity_type)) > 0),
  entity_id uuid not null,
  request_id uuid not null unique,
  occurred_at timestamptz not null default now(),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object')
);
create index audit_events_actor_idx on private.audit_events(actor_user_id);
create index audit_events_entity_time_idx on private.audit_events(entity_type, entity_id, occurred_at);

create function private.stamp_record() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.version := old.version + 1;
  new.created_at := old.created_at;
  new.updated_at := clock_timestamp();
  if tg_table_name = 'profiles' then
    if new.access_revision < old.access_revision then
      raise exception 'Access revision cannot decrease' using errcode = '23514';
    end if;
    if new.is_active is distinct from old.is_active then
      new.access_revision := old.access_revision + 1;
    end if;
  elsif tg_table_name = 'projects' then
    if old.code_locked_at is not null and
       (new.document_code is distinct from old.document_code or new.code_locked_at is distinct from old.code_locked_at) then
      raise exception 'Project document code is locked' using errcode = '23514';
    end if;
    if new.creation_request_id is distinct from old.creation_request_id then
      raise exception 'Creation identity is immutable' using errcode = '23514';
    end if;
  elsif tg_table_name = 'scopes' then
    if new.project_id is distinct from old.project_id or new.creation_request_id is distinct from old.creation_request_id then
      raise exception 'Scope ownership and creation identity are immutable' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
create trigger profiles_stamp before update on public.profiles for each row execute function private.stamp_record();
create trigger projects_stamp before update on public.projects for each row execute function private.stamp_record();
create trigger scopes_stamp before update on public.scopes for each row execute function private.stamp_record();

-- Updating the parent serializes concurrent grants and invalidates all older bindings.
create function private.change_access() returns trigger
language plpgsql set search_path = '' as $$
declare
  target_user uuid;
begin
  if tg_op = 'UPDATE' then
    raise exception 'Replace grants/assignments with delete and insert' using errcode = '23514';
  end if;
  target_user := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
  update public.profiles set access_revision = access_revision + 1 where user_id = target_user;
  if tg_op = 'INSERT' and tg_table_name = 'role_grants' then
    if exists (select 1 from public.role_grants g where g.user_id = target_user and
      ((new.role = 'Site Personnel' and g.role <> 'Site Personnel') or
       (new.role <> 'Site Personnel' and g.role = 'Site Personnel'))) then
      raise exception 'Site Personnel cannot hold another role' using errcode = '23514';
    end if;
  elsif tg_op = 'INSERT' and tg_table_name = 'project_assignments' then
    if not exists (select 1 from public.role_grants g where g.user_id = target_user and g.role = 'Site Personnel') then
      raise exception 'Only Site Personnel receive project assignments' using errcode = '23514';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger role_grants_access before insert or update or delete on public.role_grants for each row execute function private.change_access();
create trigger project_assignments_access before insert or update or delete on public.project_assignments for each row execute function private.change_access();

-- A real parent UPDATE also prevents write skew at REPEATABLE READ/SERIALIZABLE.
create function private.check_allocation() returns trigger
language plpgsql set search_path = '' as $$
declare
  target_project uuid;
  allocated numeric;
  limit_amount numeric;
begin
  if tg_table_name = 'project_budgets' then
    if tg_op = 'DELETE' then
      update public.projects set version = version + 1 where id = old.project_id;
      if found and exists (
        select 1 from public.scope_budgets b join public.scopes s on s.id = b.scope_id where s.project_id = old.project_id
      ) then
        raise exception 'A project with scope allocations requires a budget' using errcode = '23514';
      end if;
      return old;
    end if;
    if tg_op = 'UPDATE' and new.project_id is distinct from old.project_id then
      raise exception 'Budget ownership is immutable' using errcode = '23514';
    end if;
    target_project := new.project_id;
  else
    if tg_op = 'UPDATE' and new.scope_id is distinct from old.scope_id then
      raise exception 'Budget ownership is immutable' using errcode = '23514';
    end if;
    select s.project_id into target_project from public.scopes s
      where s.id = case when tg_op = 'DELETE' then old.scope_id else new.scope_id end;
  end if;
  update public.projects set version = version + 1 where id = target_project;
  if tg_table_name = 'project_budgets' then
    select coalesce(sum(b.amount), 0) into allocated from public.scope_budgets b
      join public.scopes s on s.id = b.scope_id where s.project_id = target_project;
    if allocated > new.amount then
      raise exception 'Scope allocations exceed project budget' using errcode = '23514';
    end if;
  elsif tg_op <> 'DELETE' then
    update public.scopes set version = version + 1 where id = new.scope_id;
    select b.amount into limit_amount from public.project_budgets b where b.project_id = target_project;
    select coalesce(sum(b.amount), 0) into allocated from public.scope_budgets b
      join public.scopes s on s.id = b.scope_id where s.project_id = target_project and b.scope_id <> new.scope_id;
    if limit_amount is null or allocated + new.amount > limit_amount then
      raise exception 'Scope allocations exceed project budget' using errcode = '23514';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger project_budget_allocation before insert or update or delete on public.project_budgets for each row execute function private.check_allocation();
create trigger scope_budget_allocation before insert or update or delete on public.scope_budgets for each row execute function private.check_allocation();

create function private.protect_audit() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Audit history is append-only' using errcode = '42501';
end;
$$;
create trigger audit_immutable before update or delete on private.audit_events for each row execute function private.protect_audit();

-- Definer functions are narrowly scoped to the JWT's own user/session, in an unexposed schema.
create function private.current_user_authorized() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    join private.session_bindings b on b.user_id = p.user_id and b.access_revision = p.access_revision
    join auth.sessions s on s.id = b.session_id and s.user_id = p.user_id
    join auth.users u on u.id = p.user_id
    where p.user_id = (select auth.uid()) and p.is_active
      and s.id::text = (select auth.jwt()->>'session_id')
      and (s.not_after is null or s.not_after > now())
      and not u.is_anonymous and (u.banned_until is null or u.banned_until <= now())
      and exists (select 1 from public.role_grants g where g.user_id = p.user_id)
  );
$$;
create function private.has_role(required_role text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.current_user_authorized() and exists (
    select 1 from public.role_grants g where g.user_id = (select auth.uid()) and g.role = required_role
  );
$$;
create function private.can_read_project(target_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.current_user_authorized() and (
    exists (select 1 from public.role_grants g where g.user_id = (select auth.uid()) and g.role <> 'Site Personnel')
    or exists (select 1 from public.project_assignments a where a.user_id = (select auth.uid()) and a.project_id = target_project)
  );
$$;
create function private.can_read_financials(target_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.can_read_project(target_project) and not private.has_role('Site Personnel');
$$;

alter table public.profiles enable row level security;
alter table public.role_grants enable row level security;
alter table public.project_assignments enable row level security;
alter table public.projects enable row level security;
alter table public.scopes enable row level security;
alter table public.project_budgets enable row level security;
alter table public.scope_budgets enable row level security;
alter table private.session_bindings enable row level security;
alter table private.audit_events enable row level security;

create policy profiles_read on public.profiles for select to authenticated
  using ((select private.current_user_authorized()) and (user_id = (select auth.uid()) or (select private.has_role('Administrator'))));
create policy grants_read on public.role_grants for select to authenticated
  using ((select private.current_user_authorized()) and (user_id = (select auth.uid()) or (select private.has_role('Administrator'))));
create policy assignments_read on public.project_assignments for select to authenticated
  using ((select private.current_user_authorized()) and (user_id = (select auth.uid()) or (select private.has_role('Administrator'))));
create policy projects_read on public.projects for select to authenticated using (private.can_read_project(id));
create policy scopes_read on public.scopes for select to authenticated using (private.can_read_project(project_id));
create policy project_budgets_read on public.project_budgets for select to authenticated using (private.can_read_financials(project_id));
create policy scope_budgets_read on public.scope_budgets for select to authenticated using (
  exists (select 1 from public.scopes s where s.id = scope_id and private.can_read_financials(s.project_id))
);

revoke all on public.profiles, public.role_grants, public.project_assignments, public.projects,
  public.scopes, public.project_budgets, public.scope_budgets from public, anon, authenticated;
grant select on public.profiles, public.role_grants, public.project_assignments, public.projects,
  public.scopes, public.project_budgets, public.scope_budgets to authenticated;
grant all on public.profiles, public.role_grants, public.project_assignments, public.projects,
  public.scopes, public.project_budgets, public.scope_budgets to service_role;
revoke all on private.session_bindings, private.audit_events from public, anon, authenticated, service_role;
grant select, insert, update, delete on private.session_bindings to service_role;
grant select, insert on private.audit_events to service_role;
revoke execute on all functions in schema private from public, anon, authenticated, service_role;
grant execute on function private.current_user_authorized(), private.has_role(text),
  private.can_read_project(uuid), private.can_read_financials(uuid) to authenticated;

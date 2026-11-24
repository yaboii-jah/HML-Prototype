create table private.stock_reports (
  id uuid primary key,
  project_id uuid not null references public.projects(id),
  description text not null,
  unit text not null,
  quantity numeric not null check (quantity > 0),
  reason text not null,
  reported_by uuid not null references public.profiles(user_id),
  reporter_name text not null,
  reported_at timestamptz not null default clock_timestamp(),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  review_id uuid unique,
  reviewed_by uuid references public.profiles(user_id),
  reviewer_name text,
  reviewed_at timestamptz,
  rejection_reason text,
  opening_entry_id uuid unique references private.inventory_entries(id),
  check (
    (status='pending' and review_id is null and reviewed_by is null and reviewer_name is null and reviewed_at is null
      and rejection_reason is null and opening_entry_id is null)
    or (status in ('approved','rejected') and review_id is not null and reviewed_by is not null and reviewer_name is not null and reviewed_at is not null
      and ((status='approved' and rejection_reason is null and opening_entry_id=review_id and opening_entry_id is not null)
        or (status='rejected' and rejection_reason is not null and opening_entry_id is null)))
  )
);
create index stock_reports_project on private.stock_reports(project_id,reported_at desc);
create unique index stock_reports_pending_material on private.stock_reports(project_id,md5(lower(description)),md5(lower(unit)))
  where status='pending';
alter table private.stock_reports enable row level security;
revoke all on private.stock_reports from public,anon,authenticated,service_role;

create function private.stock_report_account(project uuid, description text, unit text)
returns uuid language sql stable set search_path='' as $$
  select a.id from private.stock_accounts a
  where a.project_id=$1 and md5(a.description_key)=md5(lower($2)) and md5(a.unit_key)=md5(lower($3))
    and a.description_key=lower($2) and a.unit_key=lower($3)
$$;

create function private.stock_report_command(viewer jsonb, command jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  operation uuid:=(command->>'operationId')::uuid; action text:=command->>'action';
  role_name text:=viewer->>'activeRole'; project uuid:=(command->>'projectId')::uuid;
  target uuid; caller uuid; caller_name text; saved private.stock_reports;
  label text:=btrim(command->>'description'); unit_text text:=btrim(command->>'unit');
  amount_text text:=command->>'quantity'; reason_text text:=btrim(command->>'reason');
  next_status text;
begin
  if operation is null or project is null or coalesce(action,'') not in ('submit','approve','reject') then
    raise exception 'Invalid stock report action' using errcode='P4170';
  end if;
  perform set_config('lock_timeout','5s',true);
  update private.account_guard set revision=revision+1 where id;
  caller:=private.delivery_actor(viewer);
  if not private.request_project_allowed(viewer,project)
    or role_name is distinct from (case when action='submit' then 'Site Personnel' else 'Accounting' end) then
    raise exception 'Current stock report authority required' using errcode='42501';
  end if;
  perform 1 from public.projects p where p.id=project for update;
  if not found then raise exception 'Project unavailable' using errcode='42501'; end if;
  select p.display_name into strict caller_name from public.profiles p where p.user_id=caller;

  if action='submit' then
    if coalesce(length(label),0) not between 1 and 4000 or coalesce(length(unit_text),0) not between 1 and 4000
      or coalesce(length(reason_text),0) not between 5 and 2000
      or jsonb_typeof(command->'quantity') is distinct from 'string'
      or length(amount_text)>80 or amount_text !~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$' then
      raise exception 'Enter a material, unit, positive count and reason' using errcode='P4170';
    end if;
    if amount_text::numeric<=0 then raise exception 'Enter a positive count' using errcode='P4170'; end if;
    select * into saved from private.stock_reports r where r.id=operation;
    if found then
      if row(saved.reported_by,saved.project_id,saved.description,saved.unit,saved.quantity,saved.reason)
        is distinct from row(caller,project,label,unit_text,amount_text::numeric,reason_text) then
        raise exception 'Stock report identity reused' using errcode='P4173';
      end if;
      return jsonb_build_object('id',saved.id);
    end if;
    if private.stock_report_account(project,label,unit_text) is not null then
      raise exception 'Stock identity already exists' using errcode='P4174';
    end if;
    insert into private.stock_reports(id,project_id,description,unit,quantity,reason,reported_by,reporter_name)
      values(operation,project,label,unit_text,amount_text::numeric,reason_text,caller,caller_name);
    target:=operation;
  else
    target:=(command->>'reportId')::uuid;
    if action='reject' and coalesce(length(reason_text),0) not between 5 and 2000 then
      raise exception 'Explain why the count was rejected' using errcode='P4170';
    end if;
    select * into saved from private.stock_reports r where r.id=target and r.project_id=project for update;
    if not found then raise exception 'Stock report unavailable' using errcode='P4171'; end if;
    next_status:=case when action='approve' then 'approved' else 'rejected' end;
    if saved.review_id=operation then
      if saved.reviewed_by<>caller or saved.status<>next_status
        or saved.rejection_reason is distinct from (case when action='reject' then reason_text end) then
        raise exception 'Stock review identity reused' using errcode='P4173';
      end if;
      return jsonb_build_object('id',saved.id);
    end if;
    if saved.status<>'pending' then raise exception 'This report has already been reviewed' using errcode='P4175'; end if;
    if action='approve' then
      perform private.inventory_command(viewer,jsonb_build_object('kind','opening','operationId',operation,
        'projectId',project,'reason',saved.reason,'lines',jsonb_build_array(jsonb_build_object(
          'accountId',saved.id,'description',saved.description,'unit',saved.unit,'quantity',trim_scale(saved.quantity)::text))));
    end if;
    update private.stock_reports set status=next_status,review_id=operation,
      reviewed_by=caller,reviewer_name=caller_name,reviewed_at=clock_timestamp(),
      rejection_reason=case when action='reject' then reason_text end,
      opening_entry_id=case when action='approve' then operation end
    where id=target;
  end if;
  if action<>'approve' then perform private.document_notify(project); end if;
  return jsonb_build_object('id',target);
end $$;

create function private.stock_reports_read(viewer jsonb, selected_project uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform private.delivery_actor(viewer);
  if coalesce(viewer->>'activeRole','') not in ('Accounting','Site Personnel') then return '[]'; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',r.id,'projectId',r.project_id,'description',r.description,'unit',r.unit,'quantity',trim_scale(r.quantity)::text,
      'reason',r.reason,'reporterName',r.reporter_name,'reportedAt',r.reported_at,'status',r.status,
      'reviewerName',r.reviewer_name,'reviewedAt',r.reviewed_at,'rejectionReason',r.rejection_reason,
      'accountId',private.stock_report_account(r.project_id,r.description,r.unit))
      order by (r.status='pending') desc,r.reported_at desc,r.id),'[]')
    from private.stock_reports r
    where (selected_project is null or r.project_id=selected_project) and private.request_project_allowed(viewer,r.project_id)
  );
end $$;

create function public.stock_report_command(viewer jsonb, command jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select private.stock_report_command(viewer,command)
$$;

create or replace function public.inventory_read(viewer jsonb, mode text, selected_project uuid, target uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select private.inventory_read(viewer,mode,selected_project,target) ||
    case when mode='stock' then jsonb_build_object('stockReports',private.stock_reports_read(viewer,selected_project)) else '{}' end
$$;

revoke all on function private.stock_report_account(uuid,text,text),private.stock_report_command(jsonb,jsonb),
  private.stock_reports_read(jsonb,uuid),public.stock_report_command(jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.stock_report_command(jsonb,jsonb),private.stock_reports_read(jsonb,uuid),
  public.stock_report_command(jsonb,jsonb) to service_role;

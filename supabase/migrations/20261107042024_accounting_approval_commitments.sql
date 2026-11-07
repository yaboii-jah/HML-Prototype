-- 4.9: private, checked Accounting review and gross-before-EWT commitments.
alter table private.purchasing_records
  add column po_status text not null default 'draft'
    check (po_status in ('draft','submitted','held','returned','approved','rejected')),
  add column submission_id uuid,
  add column approval_id uuid;

create table private.po_submissions (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references private.purchasing_records(id),
  request_id uuid not null references public.material_requests(id),
  actor_id uuid not null references public.profiles(user_id),
  actor jsonb not null,
  snapshot jsonb not null,
  mrf_archive_id uuid not null references private.mrf_archive_snapshots(id),
  created_at timestamptz not null default clock_timestamp()
);
create index po_submissions_po on private.po_submissions(po_id);
create index po_submissions_request on private.po_submissions(request_id);
create index po_submissions_actor on private.po_submissions(actor_id);
create index po_submissions_mrf on private.po_submissions(mrf_archive_id);

create table private.po_approvals (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references private.purchasing_records(id),
  request_id uuid not null references public.material_requests(id),
  project_id uuid not null references public.projects(id),
  scope_id uuid not null references public.scopes(id),
  submission_id uuid not null references private.po_submissions(id),
  version bigint not null check (version > 0),
  snapshot jsonb not null,
  actor jsonb not null,
  approved_at timestamptz not null default clock_timestamp(),
  unique (po_id,version)
);
create index po_approvals_request on private.po_approvals(request_id);
create index po_approvals_project on private.po_approvals(project_id);
create index po_approvals_scope on private.po_approvals(scope_id);
create index po_approvals_submission on private.po_approvals(submission_id);

alter table private.purchasing_records
  add foreign key (submission_id) references private.po_submissions(id),
  add foreign key (approval_id) references private.po_approvals(id);
create index purchasing_submission on private.purchasing_records(submission_id);
create index purchasing_approval on private.purchasing_records(approval_id);

create table private.po_review_events (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references private.purchasing_records(id),
  approval_id uuid references private.po_approvals(id),
  mrf_archive_id uuid references private.mrf_archive_snapshots(id),
  action text not null,
  reason text not null,
  actor jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create index po_review_events_po on private.po_review_events(po_id);
create index po_review_events_approval on private.po_review_events(approval_id);
create index po_review_events_mrf on private.po_review_events(mrf_archive_id);

create table private.budget_commitment_entries (
  id uuid primary key default gen_random_uuid(),
  approval_id uuid not null references private.po_approvals(id),
  project_id uuid not null references public.projects(id),
  scope_id uuid not null references public.scopes(id),
  kind text not null check (kind in ('commit','release')),
  amount numeric(18,2) not null,
  actor jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (approval_id,kind),
  check ((kind='commit' and amount>0) or (kind='release' and amount<0))
);
create index budget_commitments_project on private.budget_commitment_entries(project_id);
create index budget_commitments_scope on private.budget_commitment_entries(scope_id);

create table private.accounting_operations (
  id uuid primary key,
  actor_id uuid not null references public.profiles(user_id),
  request_id uuid not null references public.material_requests(id),
  payload jsonb not null,
  result jsonb not null
);
create index accounting_operations_actor on private.accounting_operations(actor_id);
create index accounting_operations_request on private.accounting_operations(request_id);

create table private.po_archive_jobs (
  id uuid primary key default gen_random_uuid(),
  approval_id uuid not null unique references private.po_approvals(id),
  actor jsonb not null,
  original_actor jsonb not null,
  folder_mapping_id uuid not null references private.project_document_folders(id),
  state text not null default 'pending'
    check (state in ('pending','running','failed','paused','complete')),
  checkpoint jsonb not null default '{}',
  attempts jsonb not null default '[]',
  lease uuid,
  lease_until timestamptz,
  dispatched_at timestamptz,
  message text
);
create index po_archive_jobs_folder on private.po_archive_jobs(folder_mapping_id);
create index po_archive_jobs_dispatch on private.po_archive_jobs(dispatched_at,id)
  where state in ('pending','running');
create table private.po_archives (
  job_id uuid primary key references private.po_archive_jobs(id),
  folder_mapping_id uuid not null references private.project_document_folders(id),
  file_id text not null,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  size bigint not null check (size between 5 and 52428800),
  completed_at timestamptz not null default clock_timestamp()
);
create index po_archives_folder on private.po_archives(folder_mapping_id);

do $$
declare t text;
begin
  foreach t in array array['po_submissions','po_approvals','po_review_events',
    'budget_commitment_entries','accounting_operations','po_archive_jobs','po_archives'] loop
    execute format('alter table private.%I enable row level security',t);
    execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
    if t <> 'po_archive_jobs' then
      execute format('create trigger immutable before update or delete on private.%I for each row execute function private.document_immutable()',t);
    end if;
  end loop;
end $$;

create function private.scope_committed(target uuid) returns numeric
language sql stable security definer set search_path='' as $$
  select coalesce(sum(e.amount),0) from private.budget_commitment_entries e where e.scope_id=target;
$$;
create function private.scope_uncommitted(target uuid) returns numeric
language sql stable security definer set search_path='' as $$
  select b.amount-private.scope_committed(target) from public.scope_budgets b where b.scope_id=target;
$$;
create function private.po_budget_position(target uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('projectId',p.id,'projectName',p.name,'version',p.version::text,
    'scopeId',s.id,'scopeName',s.name,'allocation',b.amount::text,
    'committed',private.scope_committed(s.id)::text,
    'uncommitted',private.scope_uncommitted(s.id)::text)
  from private.purchasing_records r
    join public.material_requests m on m.id=r.request_id
    join public.projects p on p.id=r.project_id
    join public.scopes s on s.id=m.scope_id and s.project_id=p.id
    left join public.scope_budgets b on b.scope_id=s.id
  where r.id=target;
$$;

-- Actual parent updates serialize with allocation edits under stronger isolation.
create function private.commitment_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare a private.po_approvals; committed numeric;
begin
  select * into a from private.po_approvals where id=new.approval_id;
  if a.project_id is distinct from new.project_id or a.scope_id is distinct from new.scope_id
    or not exists(select 1 from public.scopes s where s.id=new.scope_id and s.project_id=new.project_id) then
    raise exception 'Commitment ownership is fixed' using errcode='23514';
  end if;
  update public.projects set version=version+1 where id=new.project_id;
  committed:=private.scope_committed(new.scope_id)+new.amount;
  if committed<0 or committed>coalesce((select amount from public.scope_budgets where scope_id=new.scope_id),-1) then
    raise exception 'Insufficient uncommitted scope allocation' using errcode='P4901';
  end if;
  if new.kind='commit' and new.amount<>(a.snapshot->'po'->'calculation'->>'gross')::numeric
    or new.kind='release' and new.amount is distinct from -(select e.amount from private.budget_commitment_entries e where e.approval_id=a.id and e.kind='commit') then
    raise exception 'Exact approved gross required' using errcode='23514';
  end if;
  return new;
end $$;
create trigger commitment_guard before insert on private.budget_commitment_entries
for each row execute function private.commitment_guard();

create function private.scope_commitment_floor() returns trigger
language plpgsql security definer set search_path='' as $$
declare target uuid; allocated numeric;
begin
  target:=case when tg_op='DELETE' then old.scope_id else new.scope_id end;
  perform 1 from public.projects p join public.scopes s on s.project_id=p.id where s.id=target for update of p;
  allocated:=case when tg_op='DELETE' then 0 else new.amount end;
  if allocated<private.scope_committed(target) then
    raise exception 'Allocation cannot fall below committed gross' using errcode='P4901';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger scope_commitment_floor before update or delete on public.scope_budgets
for each row execute function private.scope_commitment_floor();

create function private.po_terms_ready(body jsonb) returns boolean
language plpgsql stable set search_path='' as $$
declare terms jsonb:=body->'payment'; due date; dated date;
begin
  if terms is null or coalesce(terms->>'mode','') not in ('upfront','credit')
    or coalesce(terms->>'relation','') not in ('matches','differs') then return false; end if;
  if terms->>'relation'='differs' and coalesce(length(btrim(terms->>'reason')),0) not between 5 and 2000 then return false; end if;
  if terms->>'mode'='upfront' then return coalesce(terms->>'dueDate','')=''; end if;
  if coalesce(terms->>'dueDate','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return false; end if;
  due:=(terms->>'dueDate')::date;
  dated:=(body->'fields'->>'date')::date;
  return coalesce(due>=dated and due>=(now() at time zone 'Asia/Manila')::date,false);
exception when invalid_datetime_format or datetime_field_overflow then return false;
end $$;

alter function private.purchasing_validate_body(uuid,uuid,jsonb,jsonb) rename to purchasing_without_payment_review_body;
create function private.purchasing_validate_body(target uuid,quote uuid,body jsonb,previous jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  result:=private.purchasing_without_payment_review_body(target,quote,body,previous);
  if previous is null and result ? 'payment' then
    result:=jsonb_set(result,'{payment,relation}','""');
    result:=jsonb_set(result,'{payment,reason}','""');
  end if;
  return result;
end $$;

create function private.po_cannot_approve(target uuid,caller uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.po_preparers where po_id=target and actor_id=caller)
    or exists(select 1 from private.po_submissions where po_id=target and actor_id=caller);
$$;

create function private.approved_po_blockers(target uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r private.purchasing_records; a private.po_approvals; current_mrf uuid; result jsonb:='[]';
begin
  select * into r from private.purchasing_records where id=target;
  select * into a from private.po_approvals where id=r.approval_id;
  if a.id is null then return '["Current Accounting approval required"]'::jsonb; end if;
  if exists(select 1 from private.quotation_revision_events e where e.revision_id=r.revision_id and e.kind='withdraw') then
    result:=result||'["The approved quotation was withdrawn; Accounting must revoke approval"]'::jsonb;
  end if;
  if not exists(select 1 from private.suppliers s where s.id=r.supplier_id and s.is_active) then
    result:=result||'["Supplier is inactive"]'::jsonb;
  end if;
  current_mrf:=private.quotation_mrf_archive(r.request_id);
  if not private.mrf_ready(r.request_id) or current_mrf is null then
    result:=result||'["The current approved MRF archive is unavailable"]'::jsonb;
  elsif current_mrf::text is distinct from a.snapshot->>'mrfArchiveId' then
    if not exists(select 1 from private.quotation_revision_events e where e.revision_id=r.revision_id
      and e.kind='reconfirmMrf' and e.mrf_archive_id=current_mrf) then
      result:=result||'["Procurement must reconfirm the quotation against the corrected MRF"]'::jsonb;
    end if;
    if not exists(select 1 from private.po_review_events e where e.approval_id=a.id
      and e.action='reconfirmPo' and e.mrf_archive_id=current_mrf) then
      result:=result||'["Accounting must reconfirm PO applicability to the corrected MRF"]'::jsonb;
    end if;
  end if;
  return result;
end $$;

create function private.po_review_view(target uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('status',r.po_status,'submissionId',r.submission_id,'approvalId',r.approval_id,
    'budget',private.po_budget_position(r.id),
    'preparerIds',coalesce((select jsonb_agg(actor_id) from private.po_preparers where po_id=r.id),'[]'),
    'submitterIds',coalesce((select jsonb_agg(distinct actor_id) from private.po_submissions where po_id=r.id),'[]'),
    'approvals',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'version',a.version::text,
      'actor',a.actor,'at',a.approved_at,'archiveId',j.id,'archiveState',j.state,'message',j.message)
      order by a.version desc) from private.po_approvals a left join private.po_archive_jobs j on j.approval_id=a.id where a.po_id=r.id),'[]'),
    'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'action',e.action,'reason',e.reason,'actor',e.actor,'at',e.created_at)
      order by e.created_at,e.id) from private.po_review_events e where e.po_id=r.id),'[]'))
  from private.purchasing_records r where r.id=target and r.kind='po';
$$;

alter function private.purchasing_record_view(uuid) rename to purchasing_preparation_view;
create or replace function private.purchasing_blockers(target uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r private.purchasing_records; result jsonb;
begin
  select * into r from private.purchasing_records where id=target;
  result:=private.quotation_revision_blockers(r.revision_id);
  if not exists(select 1 from private.quotation_families f where f.current_quote_id=r.quote_id) then
    result:=result||'["A newer supplier quotation must be reviewed and rebound"]'::jsonb;
  end if;
  if r.kind='po' and r.calculation->>'gross'='0.00' then
    result:=result||'["Zero-value orders cannot be submitted for Accounting approval"]'::jsonb;
  end if;
  return result;
end $$;
create function private.purchasing_record_view(target uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select private.purchasing_preparation_view(target)||jsonb_build_object('review',private.po_review_view(target),
    'blockers',case when r.po_status='approved' then private.approved_po_blockers(target)
      else private.purchasing_blockers(target) end)
  from private.purchasing_records r where r.id=target;
$$;

-- Receipt lookup precedes new lifecycle gates, so a successful old save still replays.
alter function private.purchasing_command(jsonb,jsonb,jsonb,jsonb) rename to purchasing_preparation_command;
create function private.purchasing_command(actor jsonb,command jsonb,calculation jsonb default null,snapshot jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r private.purchasing_records; receipt private.purchasing_operations; caller uuid;
begin
  update private.account_guard set revision=revision+1 where id;
  caller:=private.quotation_actor(actor,true);
  select * into receipt from private.purchasing_operations where id=(command->>'requestId')::uuid;
  if found then
    if receipt.actor_id<>caller or receipt.payload<>jsonb_build_object('command',command,'role',actor->>'activeRole') then
      raise exception 'Retry identity reused' using errcode='P4803';
    end if;
    return receipt.result;
  end if;
  perform 1 from public.projects where id=(select project_id from public.material_requests where id=(command->>'mrfId')::uuid) for update;
  perform 1 from public.material_requests where id=(command->>'mrfId')::uuid for update;
  select * into r from private.purchasing_records where id=(command->>'targetId')::uuid for update;
  if r.kind='po' and r.po_status not in ('draft','returned') then
    raise exception 'PO content is locked by Accounting review' using errcode='P4902';
  end if;
  if r.kind='po' and command->>'type'='checkPo' and not private.po_terms_ready(r.body) then
    raise exception 'Review structured payment terms and Credit due date' using errcode='P4904';
  end if;
  return private.purchasing_preparation_command(actor,command,calculation,snapshot);
end $$;

create function private.accounting_command(actor jsonb,command jsonb,snapshot jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare
  caller uuid; target uuid:=(command->>'targetId')::uuid; operation uuid:=(command->>'requestId')::uuid;
  kind text:=command->>'type'; reason text:=btrim(coalesce(command->>'reason',''));
  r private.purchasing_records; parent public.material_requests; p public.projects;
  receipt private.accounting_operations; a private.po_approvals; sub private.po_submissions;
  job private.po_archive_jobs; actor_value jsonb; payload jsonb; result jsonb;
  current_mrf uuid; mapping uuid; next_version bigint; amount numeric; created timestamptz:=clock_timestamp();
begin
  perform set_config('lock_timeout','5s',true);
  update private.account_guard set revision=revision+1 where id;
  caller:=private.quotation_actor(actor);
  perform 1 from auth.sessions where id=(actor->>'sessionId')::uuid and user_id=caller for share;
  if not found then raise exception 'Current session required' using errcode='42501'; end if;
  if kind in ('submitPo','recallPo') then
    if actor->>'activeRole'<>'Procurement' then raise exception 'Procurement required' using errcode='42501'; end if;
  elsif kind in ('approvePo','holdPo','returnPo','rejectPo','revokePo','reconfirmPo','retryPoArchive') then
    if actor->>'activeRole'<>'Accounting' then raise exception 'Accounting required' using errcode='42501'; end if;
  else raise exception 'Unsupported Accounting action' using errcode='23514'; end if;
  payload:=jsonb_build_object('command',command,'role',actor->>'activeRole');
  select * into receipt from private.accounting_operations where id=operation;
  if found then
    if receipt.actor_id<>caller or receipt.payload<>payload then raise exception 'Retry identity reused' using errcode='P4803'; end if;
    return receipt.result;
  end if;
  select pr.* into r from private.purchasing_records pr where pr.id=target and pr.kind='po';
  if r.id is null or r.request_id::text is distinct from command->>'mrfId' then raise exception 'PO unavailable' using errcode='P4801'; end if;
  select * into p from public.projects where id=r.project_id for update;
  select * into parent from public.material_requests where id=r.request_id for update;
  select * into r from private.purchasing_records where id=target for update;
  if r.version::text is distinct from command->>'expectedPoVersion'
    or coalesce((select version::text from private.purchasing_heads where request_id=r.request_id),'0') is distinct from command->>'expectedVersion'
    or private.demand_snapshot(r.request_id)->>'version' is distinct from command->>'expectedDemand'
    or p.version::text is distinct from command->>'expectedProjectVersion'
    or (select version::text from private.quotation_families where id=(select family_id from private.quotation_drafts where id=r.quote_id)) is distinct from command->>'expectedFamily'
    or coalesce(private.quotation_mrf_archive(r.request_id)::text,'') is distinct from coalesce(command->>'expectedMrfArchive','') then
    raise exception 'PO, source, MRF or budget changed' using errcode='40001';
  end if;
  actor_value:=private.document_actor_snapshot(actor);
  current_mrf:=private.quotation_mrf_archive(r.request_id);
  if kind not in ('submitPo','approvePo') and length(reason) not between 5 and 2000 then
    raise exception 'Give a reason of at least five characters' using errcode='P4904';
  end if;

  if kind='submitPo' then
    if r.state<>'active' or r.po_status not in ('draft','returned') then raise exception 'PO is locked' using errcode='P4902'; end if;
    if not coalesce((private.purchasing_preparation_view(r.id)->>'checked')::boolean,false)
      or not private.po_terms_ready(r.body) or snapshot is null
      or snapshot->'po'->'body' is distinct from r.body
      or snapshot->'po'->'calculation' is distinct from r.calculation
      or snapshot->'po'->>'id' is distinct from r.id::text then
      raise exception 'Complete and confirm the current saved PO first' using errcode='P4904';
    end if;
    insert into private.po_submissions(po_id,request_id,actor_id,actor,snapshot,mrf_archive_id)
      values(r.id,r.request_id,caller,actor_value,snapshot,current_mrf) returning * into sub;
    update private.purchasing_records set po_status='submitted',submission_id=sub.id where id=r.id;
  elsif kind='recallPo' then
    if r.po_status not in ('submitted','held') then raise exception 'Submitted or Held PO required' using errcode='P4902'; end if;
    update private.purchasing_records set po_status='draft',checked=null where id=r.id;
  elsif kind in ('holdPo','returnPo','rejectPo','approvePo') then
    if r.state<>'active' or r.po_status not in ('submitted','held') then raise exception 'Current submission required' using errcode='P4902'; end if;
    if kind='approvePo' then
      if private.po_cannot_approve(r.id,caller) then raise exception 'PO preparers and submitters cannot approve' using errcode='P4903'; end if;
      if not coalesce((private.purchasing_preparation_view(r.id)->>'checked')::boolean,false)
        or not private.po_terms_ready(r.body) then raise exception 'Review current source, pricing and payment terms' using errcode='P4904'; end if;
      amount:=private.project_money(r.calculation->'gross');
      if amount<=0 or (r.calculation->>'net')::numeric<0
        or not exists(select 1 from public.scopes s where s.id=parent.scope_id and s.project_id=r.project_id)
        or coalesce(private.scope_uncommitted(parent.scope_id),-1)<amount then
        raise exception 'Insufficient uncommitted allocation for approved gross' using errcode='P4901'; end if;
      select * into sub from private.po_submissions where id=r.submission_id;
      if sub.mrf_archive_id is distinct from current_mrf then raise exception 'Submission MRF changed' using errcode='40001'; end if;
      select id into mapping from private.project_document_folders where project_id=r.project_id and current;
      if mapping is null then raise exception 'Project folder required' using errcode='P4201'; end if;
      select coalesce(max(version),0)+1 into next_version from private.po_approvals where po_id=r.id;
      insert into private.po_approvals(po_id,request_id,project_id,scope_id,submission_id,version,snapshot,actor,approved_at)
        values(r.id,r.request_id,r.project_id,parent.scope_id,sub.id,next_version,
          sub.snapshot||jsonb_build_object('mrfArchiveId',current_mrf,'approvedAt',created,'approvedBy',actor_value),actor_value,created)
        returning * into a;
      insert into private.budget_commitment_entries(approval_id,project_id,scope_id,kind,amount,actor)
        values(a.id,r.project_id,parent.scope_id,'commit',amount,actor_value);
      insert into private.po_archive_jobs(approval_id,actor,original_actor,folder_mapping_id) values(a.id,actor,actor,mapping);
      update private.purchasing_records set po_status='approved',approval_id=a.id where id=r.id;
    else
      update private.purchasing_records set
        po_status=case kind when 'holdPo' then 'held' when 'returnPo' then 'returned' else 'rejected' end,
        state=case when kind='rejectPo' then 'cancelled' else state end,
        checked=case when kind='holdPo' then checked else null end where id=r.id;
      if kind='rejectPo' then
        perform private.purchasing_apply_claims(actor,r.request_id,operation,command->>'expectedDemand',reason);
      end if;
    end if;
  elsif kind='revokePo' then
    if r.po_status<>'approved' or r.approval_id is null then raise exception 'Current unissued approval required' using errcode='P4902'; end if;
    select * into a from private.po_approvals where id=r.approval_id;
    insert into private.budget_commitment_entries(approval_id,project_id,scope_id,kind,amount,actor)
      select a.id,a.project_id,a.scope_id,'release',-e.amount,actor_value
      from private.budget_commitment_entries e where e.approval_id=a.id and e.kind='commit';
    update private.purchasing_records set po_status='returned',approval_id=null,checked=null where id=r.id;
  elsif kind='reconfirmPo' then
    if r.po_status<>'approved' or private.po_cannot_approve(r.id,caller) then
      raise exception 'Independent Accounting approval required' using errcode='P4903'; end if;
    if current_mrf is null or not private.mrf_ready(r.request_id)
      or exists(select 1 from private.quotation_revision_events e where e.revision_id=r.revision_id and e.kind='withdraw')
      or not exists(select 1 from private.quotation_revision_events e where e.revision_id=r.revision_id and e.kind='reconfirmMrf' and e.mrf_archive_id=current_mrf) then
      raise exception 'Procurement must reconfirm the corrected MRF first' using errcode='P4904'; end if;
  else
    select * into job from private.po_archive_jobs where id=(command->>'archiveId')::uuid and approval_id in (select id from private.po_approvals where po_id=r.id) for update;
    if job.id is null or job.state not in ('failed','paused') then raise exception 'Archive is complete or processing' using errcode='P4904'; end if;
    select id into mapping from private.project_document_folders where project_id=r.project_id and current;
    if mapping is null then raise exception 'Project folder required' using errcode='P4201'; end if;
    update private.po_archive_jobs set attempts=attempts||jsonb_build_array(jsonb_build_object('actor',job.actor,'folder',job.folder_mapping_id,
      'checkpoint',job.checkpoint,'state',job.state,'message',job.message,'retriedAt',created,'retriedBy',actor_value)),
      actor=actor,folder_mapping_id=mapping,checkpoint=case when mapping=job.folder_mapping_id then job.checkpoint else '{}' end,
      state='pending',lease=null,lease_until=null,dispatched_at=null,message=null where id=job.id;
  end if;
  insert into private.po_review_events(po_id,approval_id,mrf_archive_id,action,reason,actor)
    values(r.id,coalesce(a.id,r.approval_id),current_mrf,kind,reason,actor_value);
  update private.purchasing_records set version=version+1,updated_at=created,
    checked=case when kind in ('submitPo','holdPo') then jsonb_set(checked,'{version}',to_jsonb((version+1)::text)) else checked end where id=r.id;
  insert into private.purchasing_heads(request_id,version) values(r.request_id,1)
    on conflict(request_id) do update set version=private.purchasing_heads.version+1;
  insert into private.audit_events(actor_user_id,actor_name,actor_role,action,entity_type,entity_id,request_id,details)
    select caller,display_name,actor->>'activeRole','purchasing.'||kind,'purchasing',r.request_id,operation,
      jsonb_build_object('targetId',r.id,'reason',reason,'approvalId',coalesce(a.id,r.approval_id)) from public.profiles where user_id=caller;
  result:=jsonb_build_object('targetId',r.id,'changed',true);
  insert into private.accounting_operations values(operation,caller,r.request_id,payload,result);
  perform private.quotation_notify();
  return result;
end $$;

create function public.accounting_command(actor jsonb,command jsonb,snapshot jsonb default null) returns jsonb
language sql security invoker set search_path='' as $$ select private.accounting_command(actor,command,snapshot); $$;

-- All helpers stay private; the only admitted writer checks current role/session.
revoke all on function private.scope_committed(uuid),private.scope_uncommitted(uuid),private.po_budget_position(uuid),
  private.commitment_guard(),private.scope_commitment_floor(),private.po_terms_ready(jsonb),private.po_cannot_approve(uuid,uuid),
  private.purchasing_without_payment_review_body(uuid,uuid,jsonb,jsonb),private.purchasing_validate_body(uuid,uuid,jsonb,jsonb),
  private.approved_po_blockers(uuid),private.po_review_view(uuid),private.purchasing_record_view(uuid),
  private.purchasing_preparation_view(uuid),private.purchasing_preparation_command(jsonb,jsonb,jsonb,jsonb),
  private.purchasing_command(jsonb,jsonb,jsonb,jsonb),private.accounting_command(jsonb,jsonb,jsonb),public.accounting_command(jsonb,jsonb,jsonb)
from public,anon,authenticated,service_role;
grant execute on function private.purchasing_command(jsonb,jsonb,jsonb,jsonb),private.accounting_command(jsonb,jsonb,jsonb),public.accounting_command(jsonb,jsonb,jsonb) to service_role;

-- Extend existing role-safe project projections; Site never receives these fields.
alter function private.project_summary(uuid,boolean) rename to project_allocation_summary;
create function private.project_summary(target uuid,financial boolean) returns jsonb
language sql stable security definer set search_path='' as $$
  select private.project_allocation_summary(target,financial)
    || case when financial then jsonb_build_object('financial',
      (private.project_allocation_summary(target,true)->'financial')||jsonb_build_object(
        'committed',(select coalesce(sum(amount),0)::text from private.budget_commitment_entries where project_id=target),
        'uncommitted',case when private.project_allocation_summary(target,true)->'financial'->>'allocated' is null then null else (select (coalesce(sum(b.amount),0)-coalesce((select sum(amount) from private.budget_commitment_entries where project_id=target),0))::text
          from public.scopes s join public.scope_budgets b on b.scope_id=s.id where s.project_id=target) end))
      else '{}'::jsonb end;
$$;
alter function private.projects_read(jsonb,uuid) rename to projects_allocation_read;
create function private.projects_read(actor jsonb,target_project uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  result:=private.projects_allocation_read(actor,target_project);
  if actor->>'activeRole'<>'Site Personnel' and result->'project' is not null and result->'project'<>'null'::jsonb then
    result:=jsonb_set(result,'{project,scopes}',coalesce((select jsonb_agg(s||jsonb_build_object(
      'committed',private.scope_committed((s->>'id')::uuid)::text,
      'uncommitted',private.scope_uncommitted((s->>'id')::uuid)::text))
      from jsonb_array_elements(result->'project'->'scopes') s),'[]'::jsonb));
  end if;
  return result;
end $$;

-- Recheck positive remainder under the same project/MRF locks used by approval.
alter function private.request_command(jsonb,jsonb) rename to request_without_commitments_command;
create function private.request_command(actor jsonb,command jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.material_requests; selected_scope uuid; receipt private.request_operations; caller uuid;
begin
  caller:=private.project_actor(actor,false);
  select * into receipt from private.request_operations where id=(command->>'requestId')::uuid;
  if found and receipt.actor_id=caller and receipt.payload=command and receipt.result is not null then return receipt.result; end if;
  if command->>'type'='submitMrf' or command->>'type'='reviewMrf' and command->>'decision'='approve' then
    perform 1 from public.projects where id=(select project_id from public.material_requests where id=(command->>'mrfId')::uuid) for update;
    select * into r from public.material_requests where id=(command->>'mrfId')::uuid for update;
    selected_scope:=case when command->>'type'='submitMrf' then (command->'draft'->>'scopeId')::uuid else r.scope_id end;
    if r.correction_kind is distinct from 'documents' and coalesce(private.scope_uncommitted(selected_scope),0)<=0 then
      raise exception 'Select a scope with uncommitted allocation' using errcode='P4303';
    end if;
  end if;
  return private.request_without_commitments_command(actor,command);
end $$;

create function private.po_archive_allowed(actor jsonb) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles p join auth.users u on u.id=p.user_id
    join public.role_grants g on g.user_id=p.user_id and g.role='Accounting'
    where p.user_id=(actor->>'userId')::uuid and p.is_active
      and p.access_revision::text=actor->>'revision' and actor->>'activeRole'='Accounting'
      and not u.is_anonymous and u.email_confirmed_at is not null
      and (u.banned_until is null or u.banned_until<=now()));
$$;
create function private.po_archive_dispatch() returns jsonb
language plpgsql security definer set search_path='' as $$
declare ids uuid[];
begin
  with candidates as (
    select id from private.po_archive_jobs where state in ('pending','running')
      and (lease_until is null or lease_until<now())
      and (dispatched_at is null or dispatched_at<now()-interval '2 minutes')
      order by id for update skip locked limit 10
  ), admitted as (
    update private.po_archive_jobs set dispatched_at=clock_timestamp()
      where id in(select id from candidates) returning id
  ) select array_agg(id) into ids from admitted;
  return to_jsonb(coalesce(ids,'{}'::uuid[]));
end $$;
create function private.po_archive_worker(job_id uuid,action text,lease_id uuid default null,patch jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare j private.po_archive_jobs; a private.po_approvals; acquired uuid; key text;
begin
  perform set_config('lock_timeout','5s',true);
  update private.account_guard set revision=revision+1 where id;
  select * into j from private.po_archive_jobs where id=job_id;
  if not found then return null; end if;
  select * into a from private.po_approvals where id=j.approval_id;
  perform 1 from public.projects where id=a.project_id for update;
  perform 1 from public.material_requests where id=a.request_id for update;
  select * into j from private.po_archive_jobs where id=job_id for update;
  if j.state='complete' then return null; end if;
  if not private.po_archive_allowed(j.actor) then
    update private.po_archive_jobs set state='paused',lease=null,lease_until=null,
      message='Accounting access changed. An Accounting colleague can retry.' where id=job_id;
    perform private.quotation_notify();
    return null;
  end if;
  if action='claim' then
    if j.state not in ('pending','running') or j.lease_until>now() then return null; end if;
    acquired:=gen_random_uuid();
    update private.po_archive_jobs set state='running',lease=acquired,
      lease_until=now()+interval '5 minutes',message=null where id=job_id;
  else
    if j.state<>'running' or j.lease is distinct from lease_id or j.lease_until<=now() then return null; end if;
    acquired:=j.lease;
    if action='checkpoint' then
      if jsonb_typeof(patch) is distinct from 'object' or octet_length(patch::text)>2000 then raise exception 'Invalid archive checkpoint' using errcode='23514'; end if;
      for key in select jsonb_object_keys(patch) loop
        if key not in ('fileId','sha256','size','verified') then raise exception 'Unexpected archive checkpoint' using errcode='23514'; end if;
        if key<>'verified' and j.checkpoint ? key and j.checkpoint->key is distinct from patch->key then raise exception 'Archive identity and bytes are fixed' using errcode='23514'; end if;
      end loop;
      update private.po_archive_jobs set checkpoint=checkpoint||patch,
        lease_until=now()+interval '5 minutes' where id=job_id;
    elsif action='fail' then
      update private.po_archive_jobs set state='failed',lease=null,lease_until=null,
        message='Approved PDF verification did not complete. Approval and its budget commitment are retained. Retry this archive.' where id=job_id;
      perform private.quotation_notify();
      return null;
    elsif action='complete' then
      if j.checkpoint->>'verified' is distinct from 'true'
        or coalesce(j.checkpoint->>'fileId','') !~ '^[A-Za-z0-9_-]+$'
        or coalesce(j.checkpoint->>'sha256','') !~ '^[a-f0-9]{64}$'
        or coalesce(j.checkpoint->>'size','') !~ '^[0-9]+$'
        or (j.checkpoint->>'size')::bigint not between 5 and 52428800 then
        raise exception 'Exact approved PDF verification required' using errcode='23514';
      end if;
      insert into private.po_archives(job_id,folder_mapping_id,file_id,sha256,size)
        values(j.id,j.folder_mapping_id,j.checkpoint->>'fileId',j.checkpoint->>'sha256',(j.checkpoint->>'size')::bigint);
      update private.po_archive_jobs set state='complete',lease=null,lease_until=null,message=null where id=job_id;
      insert into private.audit_events(actor_user_id,actor_name,actor_role,action,entity_type,entity_id,request_id,details)
        select p.user_id,p.display_name,'Accounting','purchasing.poArchiveComplete','purchasing',a.request_id,j.id,
          jsonb_build_object('approvalId',a.id,'originalActor',j.original_actor,'retryingActor',j.actor)
          from public.profiles p where p.user_id=(j.actor->>'userId')::uuid;
      perform private.quotation_notify();
      return null;
    else raise exception 'Unsupported archive action' using errcode='23514'; end if;
  end if;
  return (select to_jsonb(x)||jsonb_build_object('approval',to_jsonb(a)||jsonb_build_object('version',a.version::text),
    'folder',(select to_jsonb(f) from private.project_document_folders f where f.id=x.folder_mapping_id))
    from private.po_archive_jobs x where x.id=job_id);
end $$;
create function public.po_archive_dispatch() returns jsonb language sql security invoker set search_path='' as $$ select private.po_archive_dispatch(); $$;
create function public.po_archive_worker(job_id uuid,action text,lease_id uuid default null,patch jsonb default '{}') returns jsonb
language sql security invoker set search_path='' as $$ select private.po_archive_worker(job_id,action,lease_id,patch); $$;
create function public.po_archive_document(actor jsonb,archive_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  perform private.quotation_actor(actor);
  select jsonb_build_object('fileId',f.file_id,'size',f.size,'mime','application/pdf',
    'name',r.ref||'-approval-v'||a.version||'.pdf') into result
    from private.po_archives f join private.po_archive_jobs j on j.id=f.job_id
    join private.po_approvals a on a.id=j.approval_id
    join private.purchasing_records r on r.id=a.po_id where f.job_id=archive_id;
  if result is null then raise exception 'Approved PDF unavailable' using errcode='P4801'; end if;
  return result;
end $$;
revoke all on function private.project_allocation_summary(uuid,boolean),private.project_summary(uuid,boolean),
  private.projects_allocation_read(jsonb,uuid),private.projects_read(jsonb,uuid),
  private.request_without_commitments_command(jsonb,jsonb),private.request_command(jsonb,jsonb),
  private.po_archive_allowed(jsonb),private.po_archive_dispatch(),private.po_archive_worker(uuid,text,uuid,jsonb),
  public.po_archive_dispatch(),public.po_archive_worker(uuid,text,uuid,jsonb),public.po_archive_document(jsonb,uuid)
from public,anon,authenticated,service_role;
grant execute on function private.projects_read(jsonb,uuid),private.request_command(jsonb,jsonb),
  private.po_archive_dispatch(),private.po_archive_worker(uuid,text,uuid,jsonb),
  public.po_archive_dispatch(),public.po_archive_worker(uuid,text,uuid,jsonb),public.po_archive_document(jsonb,uuid)
to service_role;

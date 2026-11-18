-- 4.11: issued-PO settlement. Amounts are exact; source calls stay outside SQL.
create table private.payment_heads (
  po_id uuid primary key references private.purchasing_records(id),
  version bigint not null default 1,
  ledger_version bigint not null default 0,
  clearance_epoch bigint not null default 0
);
create table private.payment_participants (
  po_id uuid not null references private.purchasing_records(id),
  actor_id uuid not null references public.profiles(user_id),
  kind text not null check(kind in ('coordinate','settle')),
  actor jsonb not null, created_at timestamptz not null default clock_timestamp(),
  primary key(po_id,actor_id), unique(po_id,actor_id,kind)
);
create index payment_participants_actor on private.payment_participants(actor_id);
create table private.payment_drafts (
  id uuid primary key,
  po_id uuid not null references private.purchasing_records(id),
  request_id uuid not null references public.material_requests(id),
  body jsonb not null, state text not null default 'draft' check(state in('draft','verified','cancelled')),
  version bigint not null default 1, file_version bigint not null default 1,
  current_files uuid[] not null default '{}',
  replaces_id uuid,
  creator_id uuid not null references public.profiles(user_id), creator_name text not null,
  created_at timestamptz not null default clock_timestamp()
);
create index payment_drafts_po on private.payment_drafts(po_id);
create index payment_drafts_request on private.payment_drafts(request_id);
create index payment_drafts_creator on private.payment_drafts(creator_id);
create unique index payment_one_replacement on private.payment_drafts(replaces_id) where state<>'cancelled';
create table private.payment_verifications (
  id uuid primary key references private.payment_drafts(id),
  po_id uuid not null references private.purchasing_records(id),
  approval_id uuid not null references private.po_approvals(id),
  amount numeric(18,2) not null check(amount>0),
  body jsonb not null, files uuid[] not null check(cardinality(files) between 1 and 12),
  reference_key text not null, actor jsonb not null,
  verified_at timestamptz not null default clock_timestamp()
);
create index payment_verifications_po on private.payment_verifications(po_id);
create index payment_verifications_approval on private.payment_verifications(approval_id);
create index payment_verifications_reference on private.payment_verifications(reference_key);
alter table private.payment_drafts add foreign key(replaces_id) references private.payment_verifications(id);
create table private.payment_reversals (
  verification_id uuid primary key references private.payment_verifications(id),
  reason text not null check(length(btrim(reason)) between 5 and 2000),
  actor jsonb not null, recorded_at timestamptz not null default clock_timestamp()
);
create table private.payment_no_cash (
  id uuid primary key default gen_random_uuid(), po_id uuid not null references private.purchasing_records(id),
  reason text not null check(length(btrim(reason)) between 5 and 2000),
  actor jsonb not null, recorded_at timestamptz not null default clock_timestamp()
);
create index payment_no_cash_po on private.payment_no_cash(po_id);
create table private.payment_no_cash_reversals (
  confirmation_id uuid primary key references private.payment_no_cash(id),
  reason text not null check(length(btrim(reason)) between 5 and 2000),
  actor jsonb not null, recorded_at timestamptz not null default clock_timestamp()
);
create table private.payment_coordination (
  id uuid primary key default gen_random_uuid(), po_id uuid not null references private.purchasing_records(id),
  plan jsonb not null, ledger_version bigint not null,
  actor jsonb not null, recorded_at timestamptz not null default clock_timestamp()
);
create index payment_coordination_po on private.payment_coordination(po_id,recorded_at,id);
create table private.payment_clearances (
  id uuid primary key default gen_random_uuid(), po_id uuid not null references private.purchasing_records(id),
  epoch bigint not null, action text not null check(action in('clear','hold','invalidate')),
  reason text not null, actor jsonb not null,
  recorded_at timestamptz not null default clock_timestamp()
);
create index payment_clearances_po on private.payment_clearances(po_id,recorded_at,id);
create table private.payment_spending (
  id uuid primary key, po_id uuid not null references private.purchasing_records(id),
  approval_id uuid not null references private.po_approvals(id),
  project_id uuid not null references public.projects(id), scope_id uuid not null references public.scopes(id),
  amount numeric(18,2) not null, actor jsonb not null,
  recorded_at timestamptz not null default clock_timestamp()
);
create index payment_spending_po on private.payment_spending(po_id);
create index payment_spending_approval on private.payment_spending(approval_id);
create index payment_spending_project on private.payment_spending(project_id);
create index payment_spending_scope on private.payment_spending(scope_id);
create table private.payment_operations (
  id uuid primary key, actor_id uuid not null references public.profiles(user_id),
  po_id uuid references private.purchasing_records(id), payload jsonb not null, result jsonb
);
create index payment_operations_actor on private.payment_operations(actor_id);
create index payment_operations_po on private.payment_operations(po_id);

create function private.payment_actor(actor jsonb,writing boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare caller uuid;
begin
  caller:=private.project_actor(actor);
  if actor->>'activeRole'='Site Personnel' or (writing and actor->>'activeRole'<>'Accounting') then
    raise exception 'Payment access denied' using errcode='42501'; end if;
  perform 1 from auth.sessions where id=(actor->>'sessionId')::uuid and user_id=caller for share;
  if not found then raise exception 'Current session required' using errcode='42501'; end if;
  return caller;
end $$;
create function private.payment_notify() returns void
language sql security definer set search_path='' as $$ select private.quotation_notify(); $$;
create function private.payment_paid(target uuid) returns numeric
language sql stable security definer set search_path='' as $$
  select coalesce(sum(v.amount),0) from private.payment_verifications v where v.po_id=target
    and not exists(select 1 from private.payment_reversals x where x.verification_id=v.id);
$$;
create function private.payment_no_cash_id(target uuid) returns uuid
language sql stable security definer set search_path='' as $$
  select n.id from private.payment_no_cash n where n.po_id=target
    and not exists(select 1 from private.payment_no_cash_reversals x where x.confirmation_id=n.id)
  order by n.recorded_at desc,n.id desc limit 1;
$$;
create function private.payment_settled(target uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select case when (r.calculation->>'net')::numeric=0 then private.payment_no_cash_id(target) is not null
    else private.payment_paid(target)=(r.calculation->>'net')::numeric end from private.purchasing_records r where r.id=target;
$$;
create function private.payment_participate(target uuid,caller uuid,kind text,actor jsonb) returns void
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from private.payment_participants p where p.po_id=target and p.actor_id=caller and p.kind<>payment_participate.kind) then
    raise exception 'Finance coordination and settlement require different people on this PO' using errcode='P4113'; end if;
  insert into private.payment_participants(po_id,actor_id,kind,actor) values(target,caller,kind,actor) on conflict do nothing;
end $$;
create function private.payment_bump(target uuid,ledger boolean default false) returns void
language sql security definer set search_path='' as $$
  insert into private.payment_heads(po_id,ledger_version) values(target,case when ledger then 1 else 0 end)
  on conflict(po_id) do update set version=private.payment_heads.version+1,
    ledger_version=private.payment_heads.ledger_version+case when ledger then 1 else 0 end;
$$;
create function private.payment_invalidate(target uuid,reason text,actor jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare epoch bigint;
begin
  -- Persist the transition even when nobody observes its temporarily failed prerequisites.
  insert into private.payment_heads(po_id,clearance_epoch) values(target,1)
    on conflict(po_id) do update set version=private.payment_heads.version+1,clearance_epoch=private.payment_heads.clearance_epoch+1
    returning clearance_epoch into epoch;
  insert into private.payment_clearances(po_id,epoch,action,reason,actor) values(target,epoch,'invalidate',reason,actor);
end $$;
create function private.payment_clearance_blockers(target uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r private.purchasing_records; result jsonb;
begin
  select * into r from private.purchasing_records where id=target;
  result:=private.approved_po_blockers(target);
  if not exists(select 1 from private.po_issuances i where i.po_id=target) then result:=result||'["Supplier issuance required"]'; end if;
  if not exists(select 1 from private.po_archive_jobs j join private.po_archives a on a.job_id=j.id where j.approval_id=r.approval_id and j.state='complete') then
    result:=result||'["Approved PO archive required"]'; end if;
  if (r.calculation->>'net')::numeric=0 then
    if private.payment_no_cash_id(target) is null then result:=result||'["Accounting no-cash confirmation required"]'; end if;
  elsif r.body->'payment'->>'mode'='upfront' and not private.payment_settled(target) then
    result:=result||'["Full verified supplier payment required for Upfront delivery"]';
  end if;
  if coalesce(r.body->'payment'->>'mode','') not in('upfront','credit') then result:=result||'["Approved payment arrangement required"]'; end if;
  return result;
end $$;
create function private.payment_cleared(target uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce((select c.action='clear' and c.epoch=coalesce(h.clearance_epoch,0)
    from private.payment_clearances c left join private.payment_heads h on h.po_id=c.po_id
    where c.po_id=target order by c.recorded_at desc,c.id desc limit 1),false)
    and private.payment_clearance_blockers(target)='[]'::jsonb;
$$;

-- Preserve the original obligation ledger. Remaining commitment subtracts paid gross;
-- allocation availability and floors still consume the entire obligation.
create function private.scope_spent(target uuid) returns numeric
language sql stable security definer set search_path='' as $$
  select coalesce(sum(amount),0) from private.payment_spending where scope_id=target;
$$;
create or replace function private.scope_committed(target uuid) returns numeric
language sql stable security definer set search_path='' as $$
  select coalesce(sum(amount),0)-private.scope_spent(target) from private.budget_commitment_entries where scope_id=target;
$$;
create or replace function private.scope_uncommitted(target uuid) returns numeric
language sql stable security definer set search_path='' as $$
  select b.amount-private.scope_committed(target)-private.scope_spent(target) from public.scope_budgets b where b.scope_id=target;
$$;
create or replace function private.scope_commitment_floor() returns trigger
language plpgsql security definer set search_path='' as $$
declare target uuid; allocated numeric;
begin
  target:=case when tg_op='DELETE' then old.scope_id else new.scope_id end;
  perform 1 from public.projects p join public.scopes s on s.project_id=p.id where s.id=target for update of p;
  allocated:=case when tg_op='DELETE' then 0 else new.amount end;
  if allocated<private.scope_committed(target)+private.scope_spent(target) then
    raise exception 'Allocation cannot fall below committed plus spent gross' using errcode='P4901'; end if;
  if tg_op='DELETE' then return old; end if; return new;
end $$;
create function private.payment_spending_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare a private.po_approvals; consumed numeric; obligation numeric;
begin
  select * into a from private.po_approvals where id=new.approval_id;
  if a.po_id is distinct from new.po_id or a.scope_id is distinct from new.scope_id or a.project_id is distinct from new.project_id then
    raise exception 'Spending ownership is fixed' using errcode='23514'; end if;
  update public.projects set version=version+1 where id=new.project_id;
  select coalesce(sum(amount),0)+new.amount into consumed from private.payment_spending where approval_id=new.approval_id;
  select coalesce(sum(amount),0) into obligation from private.budget_commitment_entries where approval_id=new.approval_id;
  if consumed<0 or consumed>obligation then raise exception 'Spending exceeds approved obligation' using errcode='23514'; end if;
  return new;
end $$;
create trigger payment_spending_guard before insert on private.payment_spending for each row execute function private.payment_spending_guard();

create function private.payment_body(value jsonb,complete boolean default false) returns jsonb
language plpgsql immutable set search_path='' as $$
declare k text; amount numeric; dated date;
begin
  if jsonb_typeof(value) is distinct from 'object' then raise exception 'Payment details required' using errcode='23514'; end if;
  foreach k in array array['amount','method','reference','date','note','other','duplicateReason'] loop
    if jsonb_typeof(value->k) is distinct from 'string' or length(value->>k)>2000 then raise exception 'Invalid payment details' using errcode='23514'; end if;
  end loop;
  if value->>'amount'<>'' then
    amount:=private.project_money(value->'amount');
    if amount<=0 then raise exception 'Payment amount must be positive' using errcode='23514'; end if;
  end if;
  if value->>'method' not in('','Bank transfer','Check','Cash','Other') then raise exception 'Invalid method' using errcode='23514'; end if;
  if value->>'date'<>'' then
    dated:=(value->>'date')::date;
    if dated::text<>value->>'date' then raise exception 'Invalid payment date' using errcode='23514'; end if;
  end if;
  if complete and (amount is null or value->>'method'='' or length(btrim(value->>'reference'))=0 or dated is null
    or value->>'method'='Other' and length(btrim(value->>'other'))<5) then raise exception 'Complete payment details required' using errcode='P4114'; end if;
  return value;
end $$;

create function private.payment_command(actor jsonb,command jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare caller uuid; kind text:=command->>'type'; target uuid:=(command->>'poId')::uuid;
  operation uuid:=(command->>'requestId')::uuid; draft_id uuid:=(command->>'draftId')::uuid;
  reason text:=btrim(coalesce(command->>'reason','')); payload jsonb; receipt private.payment_operations;
  r private.purchasing_records; d private.payment_drafts; v private.payment_verifications; actor_value jsonb;
  body jsonb; result jsonb; amount numeric; paid numeric; gross numeric; net numeric; spent numeric; previous numeric;
  plan jsonb; latest private.payment_coordination; ledger bigint; epoch bigint; file_id uuid; ref_key text; no_cash uuid;
begin
  perform set_config('lock_timeout','5s',true); update private.account_guard set revision=revision+1 where id;
  caller:=private.payment_actor(actor,kind<>'coordinate');
  if kind='coordinate' and actor->>'activeRole'<>'Finance' then raise exception 'Finance required' using errcode='42501'; end if;
  payload:=jsonb_build_object('command',command,'role',actor->>'activeRole');
  select * into receipt from private.payment_operations where id=operation;
  if found then
    if receipt.actor_id<>caller or receipt.payload<>payload then raise exception 'Retry identity reused' using errcode='P4803'; end if;
    return receipt.result;
  end if;
  select pr.* into r from private.purchasing_records pr where pr.id=target and pr.kind='po';
  if r.id is null or not exists(select 1 from private.po_issuances i where i.po_id=target) then raise exception 'Issued PO required' using errcode='P4111'; end if;
  perform 1 from public.projects where id=r.project_id for update;
  perform 1 from public.material_requests where id=r.request_id for update;
  perform 1 from private.purchasing_records where id=target for update;
  if coalesce((select version::text from private.payment_heads where po_id=target),'0') is distinct from command->>'expectedVersion' then
    raise exception 'Payment data changed; review again' using errcode='40001'; end if;
  actor_value:=private.document_actor_snapshot(actor);
  net:=(r.calculation->>'net')::numeric; gross:=(r.calculation->>'gross')::numeric;
  select coalesce(ledger_version,0),coalesce(clearance_epoch,0) into ledger,epoch from private.payment_heads where po_id=target;
  ledger:=coalesce(ledger,0); epoch:=coalesce(epoch,0);
  if kind in('reverse','noCash','reverseNoCash','hold','cancelDraft') and length(reason) not between 5 and 2000 then
    raise exception 'Give a reason of at least five characters' using errcode='23514'; end if;
  if kind='coordinate' then
    if private.payment_settled(target) then raise exception 'Settled coordination is read-only' using errcode='P4114'; end if;
    plan:=command->'plan';
    if jsonb_typeof(plan) is distinct from 'object' or coalesce(plan->>'priority','') not in('Normal','High','Urgent')
      or coalesce(plan->>'status','') not in('Pending','Scheduled','Processing','Awaiting Accounting verification','Delayed')
      or jsonb_typeof(plan->'note') is distinct from 'string' or length(plan->>'note')>2000
      or jsonb_typeof(plan->'plannedDate') is distinct from 'string'
      or plan->>'status'='Scheduled' and plan->>'plannedDate'=''
      or plan->>'status'='Delayed' and length(btrim(plan->>'note'))<5 then raise exception 'Invalid coordination plan' using errcode='23514'; end if;
    if plan->>'plannedDate'<>'' and (plan->>'plannedDate')::date::text<>plan->>'plannedDate' then raise exception 'Invalid planned date' using errcode='23514'; end if;
    if command->>'expectedLedger' is distinct from ledger::text then raise exception 'Review latest balance' using errcode='40001'; end if;
    select * into latest from private.payment_coordination where po_id=target order by recorded_at desc,id desc limit 1;
    if latest.plan=plan and latest.ledger_version=ledger then
      result:=jsonb_build_object('targetId',target,'changed',false);
      insert into private.payment_operations(id,actor_id,po_id,payload,result) values(operation,caller,target,payload,result);
      return result;
    end if;
    perform private.payment_participate(target,caller,'coordinate',actor_value);
    insert into private.payment_coordination(po_id,plan,ledger_version,actor) values(target,plan,ledger,actor_value);
  elsif kind='saveDraft' then
    body:=private.payment_body(command->'body');
    select * into d from private.payment_drafts where id=draft_id for update;
    if found then
      if d.po_id<>target or d.state<>'draft' then raise exception 'Current payment draft required' using errcode='P4114'; end if;
      if d.body=body then
        result:=jsonb_build_object('targetId',target,'draftId',draft_id,'changed',false);
        insert into private.payment_operations(id,actor_id,po_id,payload,result) values(operation,caller,target,payload,result);
        return result;
      end if;
      update private.payment_drafts set body=payment_command.body,version=version+1 where id=draft_id;
    else
      if draft_id is null then raise exception 'Payment draft identity required' using errcode='23514'; end if;
      if command->>'replacesId' is not null and not exists(select 1 from private.payment_verifications pv join private.payment_reversals x on x.verification_id=pv.id
        where pv.id=(command->>'replacesId')::uuid and pv.po_id=target) then raise exception 'Replacement must link a reversed payment on this PO' using errcode='23514'; end if;
      insert into private.payment_drafts(id,po_id,request_id,body,replaces_id,creator_id,creator_name)
        values(draft_id,target,r.request_id,body,(command->>'replacesId')::uuid,caller,actor_value->>'name');
    end if;
  elsif kind='cancelDraft' then
    select * into d from private.payment_drafts where id=draft_id and po_id=target and state='draft' for update;
    if not found or exists(select 1 from private.payment_groups g where g.draft_id=d.id and g.state='uploading') then raise exception 'Cancel unfinished proof uploads first' using errcode='P4114'; end if;
    update private.payment_drafts set state='cancelled',current_files='{}' where id=draft_id;
    foreach file_id in array d.current_files loop perform private.payment_enqueue(file_id,'cleanup',actor); end loop;
  elsif kind='verify' then
    perform private.payment_participate(target,caller,'settle',actor_value);
    select * into d from private.payment_drafts where id=draft_id and po_id=target and state='draft' for update;
    if not found or cardinality(d.current_files)<1 or exists(select 1 from private.payment_groups g where g.draft_id=d.id and g.state in('uploading','conflict')) then raise exception 'Complete saved payment and proof first' using errcode='P4114'; end if;
    body:=private.payment_body(d.body,true); amount:=(body->>'amount')::numeric;
    if command->>'evidenceReviewed' is distinct from 'true' then raise exception 'Review the proof against payment details' using errcode='P4114'; end if;
    if (body->>'date')::date<(r.body->'fields'->>'date')::date or (body->>'date')::date>(now() at time zone 'Asia/Manila')::date then raise exception 'Payment date outside supported bounds' using errcode='P4114'; end if;
    paid:=private.payment_paid(target);
    if amount>net-paid then raise exception 'Payment exceeds outstanding supplier net' using errcode='P4112'; end if;
    ref_key:=lower(btrim(body->>'method'))||':'||lower(regexp_replace(btrim(body->>'reference'),'\s+',' ','g'));
    if exists(select 1 from private.payment_verifications pv where pv.po_id=target and pv.reference_key=ref_key and not exists(select 1 from private.payment_reversals x where x.verification_id=pv.id)) then
      raise exception 'Active payment reference already used on this PO' using errcode='P4115'; end if;
    if exists(select 1 from private.payment_verifications pv where pv.po_id<>target and pv.reference_key=ref_key and not exists(select 1 from private.payment_reversals x where x.verification_id=pv.id))
      and length(btrim(body->>'duplicateReason'))<5 then raise exception 'Explain matching payment reference on another PO' using errcode='P4115'; end if;
    foreach file_id in array d.current_files loop
      if not exists(select 1 from private.payment_files f where f.id=file_id and f.state='verified') then raise exception 'Archived proof required' using errcode='P4114'; end if;
      if exists(select 1 from private.payment_verifications pv join private.payment_files used on used.id=any(pv.files)
        join private.payment_files candidate on candidate.id=file_id and candidate.sha256=used.sha256
        where pv.po_id<>target or pv.id not in (
          with recursive lineage(id) as (
            select d.replaces_id where d.replaces_id is not null
            union all select ancestor.replaces_id from private.payment_drafts ancestor join lineage on ancestor.id=lineage.id where ancestor.replaces_id is not null
          ) select id from lineage
        )) then
        raise exception 'Proof already belongs to another payment; use a linked replacement' using errcode='P4115'; end if;
    end loop;
    insert into private.payment_verifications(id,po_id,approval_id,amount,body,files,reference_key,actor)
      values(d.id,target,r.approval_id,amount,body,d.current_files,ref_key,actor_value);
    update private.payment_files set retained=true where id=any(d.current_files);
    update private.payment_drafts set state='verified' where id=d.id;
  elsif kind='reverse' then
    perform private.payment_participate(target,caller,'settle',actor_value);
    select * into v from private.payment_verifications where id=draft_id and po_id=target;
    if not found then raise exception 'Verified payment unavailable' using errcode='P4114'; end if;
    insert into private.payment_reversals(verification_id,reason,actor) values(v.id,reason,actor_value);
    if r.body->'payment'->>'mode'='upfront' then perform private.payment_invalidate(target,'Upfront payment reversed',actor_value); end if;
  elsif kind in('noCash','reverseNoCash') then
    perform private.payment_participate(target,caller,'settle',actor_value);
    if net<>0 then raise exception 'Approved zero supplier net required' using errcode='P4114'; end if;
    no_cash:=private.payment_no_cash_id(target);
    if kind='noCash' then
      if no_cash is not null then raise exception 'No-cash settlement already confirmed' using errcode='P4114'; end if;
      insert into private.payment_no_cash(po_id,reason,actor) values(target,reason,actor_value);
    else
      if no_cash is null then raise exception 'No-cash settlement is not confirmed' using errcode='P4114'; end if;
      insert into private.payment_no_cash_reversals(confirmation_id,reason,actor) values(no_cash,reason,actor_value);
      perform private.payment_invalidate(target,'No-cash confirmation reversed',actor_value);
    end if;
  elsif kind in('clear','hold') then
    if kind='clear' and private.payment_clearance_blockers(target)<>'[]'::jsonb then raise exception 'Resolve clearance prerequisites first' using errcode='P4116'; end if;
    if kind='hold' then perform private.payment_invalidate(target,reason,actor_value); end if;
    select coalesce(clearance_epoch,0) into epoch from private.payment_heads where po_id=target;
    insert into private.payment_clearances(po_id,epoch,action,reason,actor) values(target,coalesce(epoch,0),kind,reason,actor_value);
  else raise exception 'Unsupported payment action' using errcode='23514'; end if;
  if kind in('verify','reverse','noCash','reverseNoCash') then
    paid:=private.payment_paid(target);
    spent:=case when net=0 then case when private.payment_no_cash_id(target) is null then 0 else gross end else round(gross*paid/net,2) end;
    select coalesce(sum(s.amount),0) into previous from private.payment_spending s where s.po_id=target;
    insert into private.payment_spending(id,po_id,approval_id,project_id,scope_id,amount,actor)
      select operation,target,r.approval_id,r.project_id,a.scope_id,spent-previous,actor_value from private.po_approvals a where a.id=r.approval_id;
  end if;
  perform private.payment_bump(target,kind in('verify','reverse','noCash','reverseNoCash'));
  insert into private.audit_events(actor_user_id,actor_name,actor_role,action,entity_type,entity_id,request_id,details)
    values(caller,actor_value->>'name',actor->>'activeRole','payment.'||kind,'purchasing',r.request_id,operation,
      jsonb_build_object('poId',target,'draftId',draft_id,'reason',reason));
  result:=jsonb_build_object('targetId',target,'draftId',draft_id,'changed',true);
  insert into private.payment_operations(id,actor_id,po_id,payload,result) values(operation,caller,target,payload,result);
  perform private.quotation_notify(); return result;
end $$;

create table private.payment_groups (
  id uuid primary key, draft_id uuid not null references private.payment_drafts(id),
  expected_version bigint not null, files uuid[] not null default '{}',
  state text not null default 'uploading' check(state in('uploading','committed','cancelled','conflict')),
  actor jsonb not null, original_actor jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create unique index payment_one_pending_group on private.payment_groups(draft_id) where state='uploading';
create index payment_groups_quote on private.payment_groups(draft_id);
create table private.payment_files (
  id uuid primary key, draft_id uuid not null references private.payment_drafts(id),
  group_id uuid not null references private.payment_groups(id),
  folder_mapping_id uuid not null references private.project_document_folders(id),
  name text not null, mime text not null check(mime in('application/pdf','image/jpeg','image/png','image/webp')),
  size bigint not null check(size between 5 and 20971520), sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
  state text not null default 'uploading' check(state in('uploading','validating','verified','failed','cleaning','trashed')),
  drive_file_id text, encrypted_session text, offset_bytes bigint not null default 0,
  lease uuid, lease_until timestamptz, expires_at timestamptz not null default now()+interval '24 hours',
  -- Future finalization must protect files transactionally before referencing them.
  retained boolean not null default false,
  created_at timestamptz not null default clock_timestamp()
);
create index payment_files_quote on private.payment_files(draft_id);
create index payment_files_group on private.payment_files(group_id);
create index payment_files_folder on private.payment_files(folder_mapping_id);
create table private.payment_jobs (
  id uuid primary key default gen_random_uuid(), file_id uuid not null references private.payment_files(id),
  kind text not null check(kind in('validate','cleanup')),
  state text not null default 'pending' check(state in('pending','running','failed','paused','complete')),
  actor jsonb not null, original_actor jsonb not null,
  checkpoint jsonb not null default '{}', lease uuid, lease_until timestamptz,
  dispatched_at timestamptz, attempts integer not null default 0, message text,
  unique(file_id,kind)
);
create index payment_pending_jobs on private.payment_jobs(dispatched_at,id) where state in('pending','running');

create table private.payment_file_operations (
  id uuid primary key,actor_id uuid not null references public.profiles(user_id),payload jsonb not null,result jsonb
);
create index payment_file_operations_actor on private.payment_file_operations(actor_id);
create function private.payment_files_command(actor jsonb,command jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
<<files>>
declare caller uuid; operation uuid:=(command->>'requestId')::uuid; kind text:=command->>'type';
  q private.payment_drafts; g private.payment_groups; receipt private.payment_file_operations;
  target uuid:=(command->>'draftId')::uuid; group_id uuid; file_id uuid; item jsonb; ids uuid[]:='{}';
  total bigint:=0; n integer:=0; mapping uuid; result jsonb; snapshot jsonb; job private.payment_jobs;
begin
  perform set_config('lock_timeout','5s',true); update private.account_guard set revision=revision+1 where id;
  caller:=private.payment_actor(actor,true);
  if operation is null or kind is null or kind not in('beginGroup','cancelGroup','retryJob') then raise exception 'Invalid original-file action' using errcode='23514'; end if;
  insert into private.payment_file_operations(id,actor_id,payload) values(operation,caller,command) on conflict do nothing;
  select * into receipt from private.payment_file_operations where id=operation for update;
  if receipt.actor_id<>caller or receipt.payload<>command then raise exception 'Retry identity reused' using errcode='P4503'; end if;
  if receipt.result is not null then return receipt.result; end if;
  q:=private.payment_lock(target,kind<>'retryJob');
  snapshot:=private.document_actor_snapshot(actor);
  if kind='beginGroup' then
    if q.file_version::text is distinct from command->>'expectedFiles' then raise exception 'Originals changed; review again' using errcode='40001'; end if;
    if jsonb_typeof(command->'keep') is distinct from 'array' or jsonb_typeof(command->'uploads') is distinct from 'array' then raise exception 'Original group required' using errcode='23514'; end if;
    group_id:=gen_random_uuid();
    insert into private.payment_groups(id,draft_id,expected_version,actor,original_actor) values(group_id,target,q.file_version,snapshot,snapshot);
    for item in select * from jsonb_array_elements(command->'keep') loop
      file_id:=(item#>>'{}')::uuid;
      if file_id is null or file_id=any(ids) or not (file_id=any(q.current_files) or file_id=any(coalesce((select files from private.payment_verifications where id=q.replaces_id),'{}'::uuid[]))) then raise exception 'Choose current originals only' using errcode='23514'; end if;
      select size into total from private.payment_files where id=file_id and state='verified';
      if not found then raise exception 'Original unavailable' using errcode='23514'; end if;
      ids:=array_append(ids,file_id);
    end loop;
    select coalesce(sum(size),0) into total from private.payment_files where id=any(ids);
    if jsonb_array_length(command->'uploads')>0 then
      select f.id into mapping from private.project_document_folders f join public.material_requests r on r.project_id=f.project_id where r.id=q.request_id and f.current;
      if mapping is null then raise exception 'Set up the project document folder first' using errcode='P4201'; end if;
    end if;
    for item in select * from jsonb_array_elements(command->'uploads') loop
      if jsonb_typeof(item->'name') is distinct from 'string' or length(item->>'name') not between 1 and 240
        or jsonb_typeof(item->'mime') is distinct from 'string' or item->>'mime' not in('application/pdf','image/jpeg','image/png','image/webp')
        or jsonb_typeof(item->'size') is distinct from 'number' or item->>'size' !~ '^[0-9]+$'
        or (item->>'size')::bigint not between 5 and 20971520
        or jsonb_typeof(item->'sha256') is distinct from 'string' or item->>'sha256' !~ '^[a-f0-9]{64}$' then raise exception 'Invalid original file' using errcode='23514'; end if;
      file_id:=gen_random_uuid(); ids:=array_append(ids,file_id); total:=total+(item->>'size')::bigint;
      insert into private.payment_files(id,draft_id,group_id,folder_mapping_id,name,mime,size,sha256)
        values(file_id,target,group_id,mapping,item->>'name',item->>'mime',(item->>'size')::bigint,item->>'sha256');
    end loop;
    if cardinality(ids)>12 or total>47185920 then raise exception 'Original group exceeds limits' using errcode='23514'; end if;
    update private.payment_groups set files=ids where id=group_id;
    perform private.payment_commit_group(group_id);
    result:=jsonb_build_object('groupId',group_id,'draftId',target);
  elsif kind='cancelGroup' then
    group_id:=(command->>'groupId')::uuid;
    select * into g from private.payment_groups where id=group_id and draft_id=target for update;
    if not found or g.state not in('uploading','conflict') then raise exception 'Group unavailable' using errcode='23514'; end if;
    update private.payment_groups set state='cancelled' where id=group_id;
    update private.payment_jobs j set state='complete',lease=null,lease_until=null,
      checkpoint=checkpoint||'{"cancelled":true}'::jsonb
      from private.payment_files f where j.file_id=f.id and f.group_id=files.group_id and j.kind='validate' and j.state<>'complete';
    for file_id in select id from private.payment_files where payment_files.group_id=files.group_id loop
      perform private.payment_enqueue(file_id,'cleanup',snapshot);
    end loop;
    result:=jsonb_build_object('groupId',group_id,'draftId',target);
  else
    select j.* into job from private.payment_jobs j join private.payment_files f on f.id=j.file_id where j.id=(command->>'jobId')::uuid and f.draft_id=target for update of j;
    if not found or job.state not in('failed','paused') then raise exception 'Choose a failed job' using errcode='23514'; end if;
    if job.kind='validate' and q.state<>'draft' then raise exception 'Reopen the draft first' using errcode='23514'; end if;
    if job.kind='validate' and not exists(select 1 from private.payment_files f join private.payment_groups pending_group on pending_group.id=f.group_id
      where f.id=job.file_id and pending_group.state='uploading') then raise exception 'Original group is closed' using errcode='23514'; end if;
    update private.payment_jobs set actor=snapshot,state='pending',lease=null,lease_until=null,dispatched_at=null,message=null where id=job.id;
    update private.payment_groups set actor=snapshot where id=(select f.group_id from private.payment_files f where f.id=job.file_id);
    result:=jsonb_build_object('draftId',target,'jobId',job.id);
  end if;
  perform private.payment_audit(actor,'payment.'||kind,target,operation,jsonb_build_object('result',result));
  update private.payment_file_operations set result=files.result where id=operation;
  perform private.payment_notify(); return result;
end $$;
create function private.payment_transfer(actor jsonb,file_id uuid,action text,lease_id uuid default null,patch jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
<<transfer>>
declare f private.payment_files; q private.payment_drafts; acquired uuid;
begin
  perform set_config('lock_timeout','5s',true); update private.account_guard set revision=revision+1 where id;
  perform private.payment_actor(actor,true);
  select * into f from private.payment_files where id=file_id;
  q:=private.payment_lock(f.draft_id);
  select * into f from private.payment_files where id=file_id for update;
  if not exists(select 1 from private.payment_groups g where g.id=f.group_id and g.state='uploading') then raise exception 'Original group is no longer uploading' using errcode='40001'; end if;
  if f.state in('verified','validating') then return jsonb_build_object('complete',true,'offset',f.size); end if;
  if f.expires_at<now() then raise exception 'Upload expired; cancel group and start again' using errcode='P4202'; end if;
  if action='claim' then
    if f.lease_until>now() then raise exception 'Transfer in progress' using errcode='55P03'; end if;
    acquired:=gen_random_uuid(); update private.payment_files set lease=acquired,lease_until=now()+interval '3 minutes' where id=file_id;
  else
    if f.lease is distinct from lease_id or f.lease_until<now() then raise exception 'Transfer lease changed' using errcode='40001'; end if;
    acquired:=f.lease;
    if action='checkpoint' then
      if patch ? 'offset' and ((patch->>'offset')::bigint<f.offset_bytes or (patch->>'offset')::bigint>f.size) then raise exception 'Invalid upload offset' using errcode='23514'; end if;
      update private.payment_files set drive_file_id=coalesce(f.drive_file_id,patch->>'driveFileId'),
        encrypted_session=coalesce(patch->>'session',f.encrypted_session),offset_bytes=coalesce((patch->>'offset')::bigint,f.offset_bytes) where id=file_id;
    elsif action='finish' then
      if f.drive_file_id is null then raise exception 'Provider identity missing' using errcode='23514'; end if;
      update private.payment_files set state='validating',offset_bytes=size,lease=null,lease_until=null where id=file_id;
      perform private.payment_enqueue(file_id,'validate',(select g.actor from private.payment_groups g where g.id=f.group_id));
    elsif action='release' then update private.payment_files set lease=null,lease_until=null where id=file_id;
    else raise exception 'Invalid transfer action' using errcode='23514'; end if;
  end if;
  return (select to_jsonb(x)-'retained'||jsonb_build_object('lease',acquired,'folder',(select to_jsonb(m) from private.project_document_folders m where m.id=x.folder_mapping_id)) from private.payment_files x where x.id=file_id);
end $$;
create function private.payment_dispatch() returns jsonb language plpgsql security definer set search_path='' as $$
declare ids uuid[];
begin
  -- Reconcile abandoned candidate files, retaining current and protected files.
  update private.payment_jobs j set state='complete',lease=null,lease_until=null,
    checkpoint=checkpoint||'{"cancelled":true}'::jsonb
    from private.payment_files f join private.payment_groups g on g.id=f.group_id
    where j.file_id=f.id and j.kind='validate' and j.state<>'complete' and g.state in('cancelled','conflict');
  insert into private.payment_jobs(file_id,kind,actor,original_actor)
    select f.id,'cleanup',g.actor,g.original_actor from private.payment_files f join private.payment_groups g on g.id=f.group_id
    where g.state in('cancelled','conflict') and f.state not in('trashed','cleaning') and not f.retained
      and not exists(select 1 from private.payment_drafts q where f.id=any(q.current_files)) on conflict(file_id,kind) do nothing;
  with candidates as (select id from private.payment_jobs where state='pending' or state='running' and lease_until<now() order by id limit 20 for update skip locked),
  admitted as (update private.payment_jobs j set dispatched_at=now() from candidates c where j.id=c.id and (j.dispatched_at is null or j.dispatched_at<now()-interval '2 minutes') returning j.id)
  select coalesce(array_agg(id),'{}') into ids from admitted;
  return to_jsonb(ids);
end $$;
create function private.payment_worker(job_id uuid,action text,lease_id uuid default null,patch jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
<<worker>>
declare j private.payment_jobs; f private.payment_files; q private.payment_drafts; g private.payment_groups; acquired uuid; referenced boolean;
begin
  perform set_config('lock_timeout','5s',true); update private.account_guard set revision=revision+1 where id;
  select * into j from private.payment_jobs where id=job_id;
  select * into f from private.payment_files where id=j.file_id;
  if f.id is null then return null; end if;
  perform 1 from public.projects where id=(select r.project_id from private.purchasing_records r join private.payment_drafts d on d.po_id=r.id where d.id=f.draft_id) for update;
  perform 1 from public.material_requests where id=(select request_id from private.payment_drafts where id=f.draft_id) for update;
  select * into q from private.payment_drafts where id=f.draft_id for update;
  select * into j from private.payment_jobs where id=job_id for update;
  select * into f from private.payment_files where id=j.file_id for update;
  select * into g from private.payment_groups where id=f.group_id;
  if j.state='complete' then return null; end if;
  if not private.payment_job_allowed(j.actor,q.id) then
    update private.payment_jobs set state='paused',message='Current Accounting authority required',lease=null,lease_until=null where id=job_id; return null;
  end if;
  if j.kind='validate' and (q.state<>'draft' or g.state<>'uploading') then
    update private.payment_jobs set state='paused',message='Draft or original group changed',lease=null,lease_until=null where id=job_id; return null;
  end if;
  referenced:=f.retained or f.id=any(q.current_files) or exists(select 1 from private.payment_groups x where x.state='uploading' and f.id=any(x.files));
  if j.kind='cleanup' and referenced then update private.payment_jobs set state='complete',message='File remains referenced' where id=job_id; return null; end if;
  if action='claim' then
    if j.state='running' and j.lease_until>now() then return null; end if;
    if j.state not in('pending','running') then return null; end if;
    if j.kind='cleanup' and f.lease_until>now() then update private.payment_jobs set dispatched_at=null where id=job_id; return null; end if;
    acquired:=gen_random_uuid();
    update private.payment_jobs set state='running',lease=acquired,lease_until=now()+interval '3 minutes',attempts=attempts+1,message=null where id=job_id;
    if j.kind='cleanup' then update private.payment_files set state='cleaning' where id=f.id; end if;
  else
    if j.state<>'running' or j.lease is distinct from lease_id or j.lease_until<now() then return null; end if;
    acquired:=j.lease;
    if action='checkpoint' then
      update private.payment_jobs set checkpoint=checkpoint||patch where id=job_id;
    elsif action='complete' then
      if j.kind='validate' then
        if j.checkpoint->>'verified' is distinct from 'true' then raise exception 'Original verification missing' using errcode='23514'; end if;
        update private.payment_files set state='verified' where id=f.id;
        perform private.payment_commit_group(f.group_id);
      else
        if j.checkpoint->>'trashed' is distinct from 'true' then raise exception 'Trash confirmation missing' using errcode='23514'; end if;
        update private.payment_files set state='trashed' where id=f.id;
      end if;
      update private.payment_jobs set state='complete',lease=null,lease_until=null where id=job_id;
      perform private.payment_notify(); return null;
    elsif action='fail' then
      update private.payment_jobs set state='failed',message=case when patch->>'invalid'='true' then 'Unreadable or mismatched original; cancel the group and choose a valid file' else 'File processing failed; retry when available' end,lease=null,lease_until=null where id=job_id;
      perform private.payment_notify(); return null;
    else raise exception 'Invalid processing action' using errcode='23514'; end if;
  end if;
  return (select to_jsonb(x)||jsonb_build_object('lease',acquired,'file',to_jsonb(f),'folder',(select to_jsonb(m) from private.project_document_folders m where m.id=f.folder_mapping_id)) from private.payment_jobs x where x.id=job_id);
end $$;
create function private.payment_file(actor jsonb,file_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare f private.payment_files;
begin
  perform private.payment_actor(actor);
  select * into f from private.payment_files where id=file_id and state='verified';
  if f.id is null or not (f.retained or exists(select 1 from private.payment_drafts q where q.id=f.draft_id and f.id=any(q.current_files))) then raise exception 'Original unavailable' using errcode='42501'; end if;
  return jsonb_build_object('id',f.id,'fileId',f.drive_file_id,'name',f.name,'mime',f.mime,'size',f.size);
end $$;

create function private.payment_lock(target uuid,editing boolean default true) returns private.payment_drafts
language plpgsql security definer set search_path='' as $$
declare q private.payment_drafts;
begin
  select * into q from private.payment_drafts where id=target;
  perform 1 from public.projects where id=(select project_id from private.purchasing_records where id=q.po_id) for update;
  perform 1 from public.material_requests where id=q.request_id for update;
  select * into q from private.payment_drafts where id=target for update;
  if q.id is null or not exists(select 1 from private.po_issuances where po_id=q.po_id)
    or editing and q.state<>'draft' then raise exception 'Issued PO and editable payment draft required' using errcode='P4114'; end if;
  return q;
end $$;
create function private.payment_job_allowed(actor jsonb,target uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles p join auth.users u on u.id=p.user_id
    join public.role_grants g on g.user_id=p.user_id and g.role='Accounting'
    where p.user_id=(actor->>'userId')::uuid and p.is_active and p.access_revision::text=actor->>'revision'
      and actor->>'activeRole'='Accounting' and not u.is_anonymous and u.email_confirmed_at is not null
      and (u.banned_until is null or u.banned_until<=now()))
    and exists(select 1 from private.payment_drafts d join private.po_issuances i on i.po_id=d.po_id where d.id=target);
$$;
create function private.payment_enqueue(file uuid,kind text,actor jsonb) returns void
language sql security definer set search_path='' as $$
  insert into private.payment_jobs(file_id,kind,actor,original_actor) values(file,kind,actor,actor) on conflict(file_id,kind) do nothing;
$$;
create function private.payment_audit(actor jsonb,kind text,target uuid,operation uuid,details jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare d private.payment_drafts;
begin
  select * into d from private.payment_drafts where id=target;
  insert into private.audit_events(actor_user_id,actor_name,actor_role,action,entity_type,entity_id,request_id,details)
    select p.user_id,p.display_name,actor->>'activeRole',kind,'purchasing',d.request_id,operation,
      details||jsonb_build_object('poId',d.po_id,'draftId',d.id) from public.profiles p where p.user_id=(actor->>'userId')::uuid;
  perform private.payment_bump(d.po_id);
end $$;
create function private.payment_commit_group(target uuid) returns void
language plpgsql security definer set search_path='' as $$
declare g private.payment_groups; q private.payment_drafts; previous uuid[]; old_file uuid;
begin
  select * into g from private.payment_groups where id=target for update;
  if g.state<>'uploading' or not private.payment_job_allowed(g.actor,g.draft_id) then return; end if;
  select * into q from private.payment_drafts where id=g.draft_id for update;
  if q.state<>'draft' then return; end if;
  if q.file_version<>g.expected_version then update private.payment_groups set state='conflict' where id=target; return; end if;
  if exists(select 1 from unnest(g.files) fid where not exists(select 1 from private.payment_files f where f.id=fid and f.state='verified'
    and (f.draft_id=q.id or f.id=any(coalesce((select files from private.payment_verifications where id=q.replaces_id),'{}'::uuid[]))))) then return; end if;
  previous:=q.current_files;
  if previous=g.files then update private.payment_groups set state='committed' where id=target; return; end if;
  update private.payment_drafts set current_files=g.files,file_version=file_version+1 where id=q.id;
  update private.payment_groups set state='committed' where id=target;
  perform private.payment_audit(g.actor,'payment.files',q.id,target,jsonb_build_object('before',previous,'after',g.files,'originalActor',g.original_actor));
  foreach old_file in array previous loop
    if not old_file=any(g.files) then perform private.payment_enqueue(old_file,'cleanup',g.actor); end if;
  end loop;
end $$;

create function private.payment_draft_view(target uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',d.id,'poId',d.po_id,'body',d.body,'state',d.state,'version',d.version::text,
    'fileVersion',d.file_version::text,'replacesId',d.replaces_id,'creatorName',d.creator_name,'createdAt',d.created_at,
    'files',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'mime',f.mime,'size',f.size,'sha256',f.sha256) order by f.id) from private.payment_files f where f.id=any(d.current_files)),'[]'),
    'replacementFiles',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'mime',f.mime,'size',f.size,'sha256',f.sha256) order by f.id) from private.payment_files f join private.payment_verifications v on f.id=any(v.files) where v.id=d.replaces_id),'[]'),
    'groups',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'state',g.state,'files',g.files,
      'uploads',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'mime',f.mime,'size',f.size,'sha256',f.sha256,'state',f.state,'offset',f.offset_bytes,'expiresAt',f.expires_at)) from private.payment_files f where f.group_id=g.id),'[]')))
      from private.payment_groups g where g.draft_id=d.id and g.state in('uploading','conflict')),'[]'),
    'jobs',coalesce((select jsonb_agg(jsonb_build_object('id',j.id,'kind',j.kind,'state',j.state,'message',j.message)) from private.payment_jobs j join private.payment_files f on f.id=j.file_id where f.draft_id=d.id and j.state<>'complete'),'[]'))
  from private.payment_drafts d where d.id=target;
$$;
create function private.payment_view(target uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('poId',r.id,'ref',r.ref,'vendor',r.body->'fields'->>'vendorName','projectId',r.project_id,
    'poDate',r.body->'fields'->>'date','mode',r.body->'payment'->>'mode','dueDate',r.body->'payment'->>'dueDate',
    'version',coalesce(h.version,0)::text,'ledgerVersion',coalesce(h.ledger_version,0)::text,
    'gross',r.calculation->>'gross','net',r.calculation->>'net','paid',private.payment_paid(r.id)::numeric(18,2)::text,
    'outstanding',((r.calculation->>'net')::numeric-private.payment_paid(r.id))::numeric(18,2)::text,
    'spent',coalesce((select sum(amount) from private.payment_spending s where s.po_id=r.id),0)::numeric(18,2)::text,
    'settled',private.payment_settled(r.id),'noCashId',private.payment_no_cash_id(r.id),
    'cleared',private.payment_cleared(r.id),'blockers',private.payment_clearance_blockers(r.id),
    'sentAt',coalesce((select c.details->>'sentAt' from private.po_issuance_corrections c where c.issuance_id=i.id order by c.version desc limit 1),i.details->>'sentAt'),
    'coordinators',coalesce((select jsonb_agg(p.actor_id) from private.payment_participants p where p.po_id=r.id and p.kind='coordinate'),'[]'),
    'settlers',coalesce((select jsonb_agg(p.actor_id) from private.payment_participants p where p.po_id=r.id and p.kind='settle'),'[]'),
    'coordination',case when c.id is null then null else jsonb_build_object('id',c.id,'plan',c.plan,'ledgerVersion',c.ledger_version::text,'actor',c.actor,'at',c.recorded_at) end,
    'drafts',coalesce((select jsonb_agg(private.payment_draft_view(d.id) order by d.created_at,d.id) from private.payment_drafts d where d.po_id=r.id),'[]'),
    'verifications',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'amount',v.amount::text,'body',v.body,'files',to_jsonb(v.files),
      'actor',v.actor,'at',v.verified_at,'reversal',case when x.verification_id is null then null else jsonb_build_object('reason',x.reason,'actor',x.actor,'at',x.recorded_at) end) order by v.verified_at,v.id)
      from private.payment_verifications v left join private.payment_reversals x on x.verification_id=v.id where v.po_id=r.id),'[]'),
    'coordinationHistory',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'plan',x.plan,'ledgerVersion',x.ledger_version::text,'actor',x.actor,'at',x.recorded_at) order by x.recorded_at,x.id) from private.payment_coordination x where x.po_id=r.id),'[]'),
    'clearanceHistory',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'action',x.action,'reason',x.reason,'epoch',x.epoch::text,'actor',x.actor,'at',x.recorded_at) order by x.recorded_at,x.id) from private.payment_clearances x where x.po_id=r.id),'[]'),
    'noCashHistory',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'action','noCash','reason',x.reason,'actor',x.actor,'at',x.recorded_at,
      'reversal',case when y.confirmation_id is null then null else jsonb_build_object('reason',y.reason,'actor',y.actor,'at',y.recorded_at) end) order by x.recorded_at,x.id)
      from private.payment_no_cash x left join private.payment_no_cash_reversals y on y.confirmation_id=x.id where x.po_id=r.id),'[]'))
  from private.purchasing_records r join private.po_issuances i on i.po_id=r.id
  left join private.payment_heads h on h.po_id=r.id
  left join lateral(select * from private.payment_coordination x where x.po_id=r.id order by x.recorded_at desc,x.id desc limit 1)c on true
  where r.id=target;
$$;
create function private.payments_read(actor jsonb,target_po uuid default null,target_request uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare caller uuid;
begin
  caller:=private.payment_actor(actor);
  return jsonb_build_object('role',actor->>'activeRole','actorId',caller,
    'records',coalesce((select jsonb_agg(private.payment_view(r.id) order by r.updated_at,r.id)
      from private.purchasing_records r join private.po_issuances i on i.po_id=r.id where (target_po is null or r.id=target_po) and (target_request is null or r.request_id=target_request)),'[]'));
end $$;

-- Source transition hooks invalidate immediately, independently of any UI read.
create function private.payment_source_invalidated() returns trigger
language plpgsql security definer set search_path='' as $$
declare r record; snapshot jsonb;
begin
  if tg_table_name='audit_events' then
    if new.action<>'supplier.deactivated' then return new; end if;
    snapshot:=jsonb_build_object('userId',new.actor_user_id,'name',new.actor_name,'activeRole',new.actor_role);
    for r in select p.id from private.purchasing_records p join private.po_issuances i on i.po_id=p.id where p.supplier_id=new.entity_id loop
      perform private.payment_invalidate(r.id,'Supplier deactivated',snapshot);
    end loop;
  elsif tg_table_name='mrf_review_events' then
    if new.action<>'correction_opened' then return new; end if;
    for r in select p.id from private.purchasing_records p join private.po_issuances i on i.po_id=p.id where p.request_id=new.request_id loop
      perform private.payment_invalidate(r.id,'MRF correction opened',jsonb_build_object('userId',new.actor_id,'name',new.actor_name,'activeRole',new.actor_role));
    end loop;
  else
    if new.kind<>'withdraw' then return new; end if;
    for r in select p.id from private.purchasing_records p join private.po_issuances i on i.po_id=p.id where p.revision_id=new.revision_id loop
      perform private.payment_invalidate(r.id,'Quotation withdrawn',new.actor);
    end loop;
  end if;
  return new;
end $$;
create trigger payment_supplier_invalidated after insert on private.audit_events for each row when(new.action='supplier.deactivated') execute function private.payment_source_invalidated();
create trigger payment_mrf_invalidated after insert on private.mrf_review_events for each row execute function private.payment_source_invalidated();
create trigger payment_quote_invalidated after insert on private.quotation_revision_events for each row execute function private.payment_source_invalidated();

-- Add spent without exposing financial payloads to Site Personnel.
create or replace function private.po_budget_position(target uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('projectId',p.id,'projectName',p.name,'version',p.version::text,
    'scopeId',s.id,'scopeName',s.name,'allocation',b.amount::text,
    'committed',private.scope_committed(s.id)::text,'spent',private.scope_spent(s.id)::text,
    'uncommitted',private.scope_uncommitted(s.id)::text)
  from private.purchasing_records r join public.material_requests m on m.id=r.request_id
    join public.projects p on p.id=r.project_id join public.scopes s on s.id=m.scope_id and s.project_id=p.id
    left join public.scope_budgets b on b.scope_id=s.id where r.id=target;
$$;
create or replace function private.project_summary(target uuid,financial boolean) returns jsonb
language sql stable security definer set search_path='' as $$
  select private.project_allocation_summary(target,financial)
    || case when financial then jsonb_build_object('financial',
      (private.project_allocation_summary(target,true)->'financial')||jsonb_build_object(
        'committed',(select (coalesce(sum(amount),0)-coalesce((select sum(amount) from private.payment_spending where project_id=target),0))::text from private.budget_commitment_entries where project_id=target),
        'spent',(select coalesce(sum(amount),0)::text from private.payment_spending where project_id=target),
        'uncommitted',case when private.project_allocation_summary(target,true)->'financial'->>'allocated' is null then null else (select (coalesce(sum(b.amount),0)-coalesce((select sum(amount) from private.budget_commitment_entries where project_id=target),0))::text
          from public.scopes s join public.scope_budgets b on b.scope_id=s.id where s.project_id=target) end)) else '{}'::jsonb end;
$$;
create or replace function private.projects_read(actor jsonb,target_project uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  result:=private.projects_allocation_read(actor,target_project);
  if actor->>'activeRole'<>'Site Personnel' and result->'project' is not null and result->'project'<>'null'::jsonb then
    result:=jsonb_set(result,'{project,scopes}',coalesce((select jsonb_agg(s||jsonb_build_object(
      'committed',private.scope_committed((s->>'id')::uuid)::text,'spent',private.scope_spent((s->>'id')::uuid)::text,
      'uncommitted',private.scope_uncommitted((s->>'id')::uuid)::text)) from jsonb_array_elements(result->'project'->'scopes') s),'[]'::jsonb));
  end if; return result;
end $$;

create function public.payment_command(actor jsonb,command jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.payment_command(actor,command); $$;
create function public.payments_read(actor jsonb,target_po uuid default null,target_request uuid default null) returns jsonb language sql security invoker set search_path='' as $$ select private.payments_read(actor,target_po,target_request); $$;
create function public.payment_files_command(actor jsonb,command jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.payment_files_command(actor,command); $$;
create function public.payment_transfer(actor jsonb,file_id uuid,action text,lease_id uuid default null,patch jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$ select private.payment_transfer(actor,file_id,action,lease_id,patch); $$;
create function public.payment_worker(job_id uuid,action text,lease_id uuid default null,patch jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$ select private.payment_worker(job_id,action,lease_id,patch); $$;
create function public.payment_dispatch() returns jsonb language sql security invoker set search_path='' as $$ select private.payment_dispatch(); $$;
create function public.payment_file(actor jsonb,file_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.payment_file(actor,file_id); $$;

do $$ declare t text; f record; begin
  foreach t in array array['payment_heads','payment_participants','payment_drafts','payment_verifications','payment_reversals',
    'payment_no_cash','payment_no_cash_reversals','payment_coordination','payment_clearances','payment_spending','payment_operations',
    'payment_groups','payment_files','payment_jobs','payment_file_operations'] loop
    execute format('alter table private.%I enable row level security',t);
    execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
    if t not in('payment_heads','payment_drafts','payment_groups','payment_files','payment_jobs','payment_file_operations') then
      execute format('create trigger immutable before update or delete on private.%I for each row execute function private.document_immutable()',t);
    end if;
  end loop;
  for f in select p.oid::regprocedure as signature,p.proname,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in('private','public') and (p.proname like 'payment\_%' escape '\' or p.proname='payments_read' or p.proname='scope_spent') loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
    if f.proname in('payment_command','payments_read','payment_files_command','payment_transfer','payment_worker','payment_dispatch','payment_file') then
      execute format('grant execute on function %s to service_role',f.signature);
    end if;
  end loop;
end $$;

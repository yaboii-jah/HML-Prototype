-- Repair updates to saved payment drafts and distinguish verification failures.
create or replace function private.payment_command(actor jsonb,command jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare caller uuid; kind text:=command->>'type'; target uuid:=(command->>'poId')::uuid;
  operation uuid:=(command->>'requestId')::uuid; draft_id uuid:=(command->>'draftId')::uuid;
  reason text:=btrim(coalesce(command->>'reason','')); payload jsonb; receipt private.payment_operations;
  r private.purchasing_records; d private.payment_drafts; v private.payment_verifications; actor_value jsonb;
  body jsonb; draft_body jsonb; result jsonb; amount numeric; paid numeric; gross numeric; net numeric; spent numeric; previous numeric;
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
    draft_body:=private.payment_body(command->'body');
    select * into d from private.payment_drafts where id=draft_id for update;
    if found then
      if d.po_id<>target or d.state<>'draft' then raise exception 'Current payment draft required' using errcode='P4114'; end if;
      if d.body=draft_body then
        result:=jsonb_build_object('targetId',target,'draftId',draft_id,'changed',false);
        insert into private.payment_operations(id,actor_id,po_id,payload,result) values(operation,caller,target,payload,result);
        return result;
      end if;
      update private.payment_drafts set body=draft_body,version=version+1 where id=draft_id;
    else
      if draft_id is null then raise exception 'Payment draft identity required' using errcode='23514'; end if;
      if command->>'replacesId' is not null and not exists(select 1 from private.payment_verifications pv join private.payment_reversals x on x.verification_id=pv.id
        where pv.id=(command->>'replacesId')::uuid and pv.po_id=target) then raise exception 'Replacement must link a reversed payment on this PO' using errcode='23514'; end if;
      insert into private.payment_drafts(id,po_id,request_id,body,replaces_id,creator_id,creator_name)
        values(draft_id,target,r.request_id,draft_body,(command->>'replacesId')::uuid,caller,actor_value->>'name');
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
    if (body->>'date')::date<(r.body->'fields'->>'date')::date or (body->>'date')::date>(now() at time zone 'Asia/Manila')::date then raise exception 'Payment date outside supported bounds' using errcode='P4117'; end if;
    paid:=private.payment_paid(target);
    if amount>net-paid then raise exception 'Payment exceeds outstanding supplier net' using errcode='P4112'; end if;
    ref_key:=lower(btrim(body->>'method'))||':'||lower(regexp_replace(btrim(body->>'reference'),'\s+',' ','g'));
    if exists(select 1 from private.payment_verifications pv where pv.po_id=target and pv.reference_key=ref_key and not exists(select 1 from private.payment_reversals x where x.verification_id=pv.id)) then
      raise exception 'Active payment reference already used on this PO' using errcode='P4118'; end if;
    if exists(select 1 from private.payment_verifications pv where pv.po_id<>target and pv.reference_key=ref_key and not exists(select 1 from private.payment_reversals x where x.verification_id=pv.id))
      and length(btrim(body->>'duplicateReason'))<5 then raise exception 'Explain matching payment reference on another PO' using errcode='P4119'; end if;
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
        raise exception 'Proof already belongs to another payment; use a linked replacement' using errcode='P4120'; end if;
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

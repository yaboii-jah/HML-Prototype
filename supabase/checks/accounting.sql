-- Appended to the shared purchasing rollback fixture definitions by the runner.
create function pg_temp.po_person(roles text[] default array['Accounting']) returns jsonb language plpgsql as $$
declare person uuid:=gen_random_uuid(); session uuid:=gen_random_uuid(); proof jsonb; role_name text;
begin
  insert into auth.users(id,email,is_anonymous,email_confirmed_at,encrypted_password)
    values(person,person||'@example.invalid',false,now(),'fixture');
  insert into public.profiles(user_id,display_name,is_active) values(person,'Accounting fixture',true);
  foreach role_name in array roles loop insert into public.role_grants values(person,role_name); end loop;
  insert into auth.sessions(id,user_id,created_at,updated_at) values(session,person,now(),now());
  proof:=private.login_preflight(person||'@example.invalid');
  perform private.bind_session(person,session,proof->>'revision',proof->>'credential');
  return jsonb_build_object('userId',person,'sessionId',session,'revision',proof->>'revision','activeRole',roles[1]);
end $$;

create function pg_temp.accounting_fixture(shared jsonb default null) returns jsonb language plpgsql as $$
declare f jsonb:=pg_temp.purchasing_fixture(false,(shared->>'project')::uuid,(shared->>'scope')::uuid);
  parent uuid:=(f->>'request')::uuid; project uuid; scope uuid; award uuid:=gen_random_uuid(); po uuid;
  body jsonb; calculation jsonb; proof jsonb; caller uuid:=(f->'actor'->>'userId')::uuid; fresh_session uuid:=gen_random_uuid();
begin
  select project_id into project from public.material_requests where id=parent;
  scope:=(shared->>'scope')::uuid;
  if scope is null then
    scope:=gen_random_uuid();
    insert into public.project_budgets values(project,10000);
    insert into public.scopes(id,project_id,name) values(scope,project,'Structural Works');
    insert into public.scope_budgets values(scope,1000);
    update public.material_requests set scope_id=scope where id=parent;
  end if;
  -- Historical identity remains the same after this preparer gains Accounting.
  insert into public.role_grants values(caller,'Accounting');
  insert into auth.sessions(id,user_id,created_at,updated_at) values(fresh_session,caller,now(),now());
  proof:=private.login_preflight(caller||'@example.invalid');
  perform private.bind_session(caller,fresh_session,proof->>'revision',proof->>'credential');
  f:=jsonb_set(f,'{actor,sessionId}',to_jsonb(fresh_session::text));
  f:=jsonb_set(f,'{actor,revision}',proof->'revision');
  perform pg_temp.purchasing_action(f,'saveAward',award);
  po:=(pg_temp.purchasing_action(f,'convert',award)->>'targetId')::uuid;
  select r.body into body from private.purchasing_records r where r.id=po;
  body:=jsonb_set(body,'{fields,requisitioner}','"Fixture Site requester"');
  body:=body||jsonb_build_object('payment',jsonb_build_object('mode','upfront','dueDate','',
    'relation','differs','reason','Supplier confirmed upfront payment for this order'));
  calculation:=jsonb_build_object('ruleVersion','hml-po-draft-2026-11-06-v1','materials','672.00','subtotal','672.00',
    'vat','72.00','gross','672.00','ewtGoods','6.00','ewtServices','0.00','net','666.00',
    'rows','[]'::jsonb,'adjustments','[]'::jsonb,'comparisons','[]'::jsonb,'issues','[]'::jsonb);
  perform pg_temp.purchasing_action(f,'savePo',po,jsonb_build_object('body',body),calculation);
  perform pg_temp.purchasing_action(f,'checkPo',po,'{}',calculation);
  return f||jsonb_build_object('po',po,'project',project,'scope',scope,'accountant',pg_temp.po_person());
end $$;

create function pg_temp.accounting_input(f jsonb,kind text,extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('type',$2,'requestId',gen_random_uuid(),'mrfId',r.request_id,'targetId',r.id,
    'expectedVersion',(select version::text from private.purchasing_heads where request_id=r.request_id),
    'expectedDemand',private.demand_snapshot(r.request_id)->>'version','expectedPoVersion',r.version::text,
    'expectedProjectVersion',(select version::text from public.projects where id=r.project_id),
    'expectedFamily',(select version::text from private.quotation_families where id=(select family_id from private.quotation_drafts where id=r.quote_id)),
    'expectedMrfArchive',coalesce(private.quotation_mrf_archive(r.request_id)::text,''),
    'reason','Explicit Accounting fixture decision')||extra
  from private.purchasing_records r where r.id=(f->>'po')::uuid;
$$;

create function pg_temp.accounting_action(f jsonb,kind text,extra jsonb default '{}',actor_override jsonb default null) returns jsonb language plpgsql as $$
declare actor jsonb:=coalesce(actor_override,case when kind in ('submitPo','recallPo') then f->'actor' else f->'accountant' end);
  command jsonb:=pg_temp.accounting_input(f,kind,extra); snapshot jsonb;
begin
  if kind='submitPo' then
    snapshot:=jsonb_build_object('po',private.purchasing_record_view((f->>'po')::uuid),
      'view',private.purchasing_read(actor,(f->>'request')::uuid));
  end if;
  return public.accounting_command(actor,command,snapshot);
end $$;

-- Accounting assertions (the concurrency runner reuses the definitions above).
do $$
declare f jsonb:=pg_temp.accounting_fixture(); po uuid:=(f->>'po')::uuid; request uuid:=(f->>'request')::uuid;
  command jsonb; result jsonb; old_ref text; approval uuid; job uuid; claimed jsonb; lease uuid; item text;
begin
  select ref into old_ref from private.purchasing_records where id=po;
  perform pg_temp.accounting_action(f,'submitPo');
  if private.scope_committed((f->>'scope')::uuid)<>0 then raise exception 'Submission reserved money'; end if;
  foreach item in array array['savePo','checkPo','cancel','rebind','reopen'] loop
    begin perform pg_temp.purchasing_action(f,item,po); raise exception 'Locked PO mutation admitted: %',item;
    exception when sqlstate 'P4902' then null; end;
  end loop;
  begin perform pg_temp.accounting_action(f,'approvePo','{}',(f->'actor')||'{"activeRole":"Accounting"}');
    raise exception 'Historical preparer approved own PO'; exception when sqlstate 'P4903' then null; end;
  perform pg_temp.accounting_action(f,'holdPo');
  if not exists(select 1 from private.demand_claims where owner_id=po and quantity=6) then raise exception 'Hold released demand'; end if;
  command:=pg_temp.accounting_input(f,'approvePo');
  result:=public.accounting_command(f->'accountant',command);
  if public.accounting_command(f->'accountant',command)<>result then raise exception 'Approval retry changed outcome'; end if;
  if private.scope_committed((f->>'scope')::uuid)<>672 or private.scope_uncommitted((f->>'scope')::uuid)<>328 then raise exception 'Budget used net or counted approval twice'; end if;
  if (select count(*) from private.budget_commitment_entries where scope_id=(f->>'scope')::uuid)<>1 then raise exception 'Approval duplicated commitment'; end if;
  begin update public.scope_budgets set amount=671 where scope_id=(f->>'scope')::uuid;
    raise exception 'Allocation reduced below committed gross'; exception when sqlstate 'P4901' then null; end;
  select approval_id into approval from private.purchasing_records where id=po;
  select id into job from private.po_archive_jobs where approval_id=approval;
  claimed:=public.po_archive_worker(job,'claim'); lease:=(claimed->>'lease')::uuid;
  perform public.po_archive_worker(job,'fail',lease);
  if private.scope_committed((f->>'scope')::uuid)<>672 or (select po_status from private.purchasing_records where id=po)<>'approved' then raise exception 'Archive failure undid approval'; end if;
  perform pg_temp.accounting_action(f,'retryPoArchive',jsonb_build_object('archiveId',job));
  claimed:=public.po_archive_worker(job,'claim'); lease:=(claimed->>'lease')::uuid;
  perform pg_temp.accounting_action(f,'revokePo');
  if private.scope_committed((f->>'scope')::uuid)<>0 or not exists(select 1 from private.demand_claims where owner_id=po and quantity=6) then raise exception 'Revocation retained money or released demand'; end if;
  perform public.po_archive_worker(job,'checkpoint',lease,jsonb_build_object('fileId','synthetic-owned-po','sha256',repeat('a',64),'size',10,'verified',true));
  perform public.po_archive_worker(job,'complete',lease);
  if (select po_status from private.purchasing_records where id=po)<>'returned' then raise exception 'Late archive restored approval'; end if;
  if not exists(select 1 from private.po_archives where job_id=job) then raise exception 'Historical archive missing'; end if;
  perform pg_temp.purchasing_action(f,'checkPo',po,'{}',(select calculation from private.purchasing_records where id=po));
  perform pg_temp.accounting_action(f,'submitPo'); perform pg_temp.accounting_action(f,'approvePo');
  if (select count(*) from private.po_approvals where po_id=po)<>2 or (select ref from private.purchasing_records where id=po)<>old_ref then raise exception 'Reapproval lost history/number'; end if;
  begin update private.po_approvals set snapshot='{}' where po_id=po; raise exception 'Approval snapshot rewritten'; exception when check_violation then null; end;
  begin delete from private.budget_commitment_entries where approval_id=approval; raise exception 'Budget history deleted'; exception when check_violation then null; end;
  if has_function_privilege('authenticated','public.accounting_command(jsonb,jsonb,jsonb)','execute')
    or has_function_privilege('service_role','private.scope_committed(uuid)','execute')
    or has_table_privilege('service_role','private.po_approvals','select') then raise exception 'Private financial authority exposed'; end if;
end $$;

do $$
declare f jsonb:=pg_temp.accounting_fixture(); po uuid:=(f->>'po')::uuid; second_actor jsonb:=pg_temp.po_person(array['Procurement','Accounting']);
begin
  perform pg_temp.accounting_action(f,'submitPo','{}',second_actor);
  if exists(select 1 from private.po_preparers where po_id=po and actor_id=(second_actor->>'userId')::uuid) then raise exception 'Submission added content preparer'; end if;
  begin perform pg_temp.accounting_action(f,'approvePo','{}',second_actor||'{"activeRole":"Accounting"}');
    raise exception 'Submitter-only identity approved'; exception when sqlstate 'P4903' then null; end;
  perform pg_temp.accounting_action(f,'recallPo');
  perform pg_temp.purchasing_action(f,'checkPo',po,'{}',(select calculation from private.purchasing_records where id=po));
  perform pg_temp.accounting_action(f,'submitPo');
  perform pg_temp.accounting_action(f,'rejectPo');
  if exists(select 1 from private.demand_claims where owner_id=po and quantity>0) then raise exception 'Rejection retained demand'; end if;
  begin perform pg_temp.purchasing_action(f,'reopen',po,'{"reason":"Try reopening terminal rejection"}');
    raise exception 'Terminal rejection reopened'; exception when sqlstate 'P4902' then null; end;
  perform pg_temp.purchasing_action(f,'saveAward',gen_random_uuid());
end $$;

do $$
declare f jsonb:=pg_temp.accounting_fixture(); another jsonb; po uuid:=(f->>'po')::uuid; stale jsonb; actor jsonb;
begin
  another:=pg_temp.accounting_fixture(f);
  perform pg_temp.accounting_action(f,'submitPo');
  perform pg_temp.accounting_action(another,'submitPo');
  stale:=pg_temp.accounting_input(another,'approvePo');
  perform pg_temp.accounting_action(f,'approvePo');
  begin perform public.accounting_command(another->'accountant',stale); raise exception 'Stale budget decision admitted'; exception when serialization_failure then null; end;
  begin perform pg_temp.accounting_action(another,'approvePo'); raise exception 'Insufficient scope approval admitted'; exception when sqlstate 'P4901' then null; end;
  if private.scope_committed((f->>'scope')::uuid)<>672 then raise exception 'Failed approval left financial effects'; end if;
  actor:=(f->'actor')||'{"activeRole":"Site Personnel"}';
  begin perform public.purchasing_read(actor,(f->>'request')::uuid); raise exception 'Site read financial review'; exception when insufficient_privilege then null; end;
end $$;
rollback;

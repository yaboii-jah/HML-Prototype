-- Uses the existing issued-PO fixture. All checks roll back with their owner.
create function pg_temp.payment_fixture() returns jsonb language plpgsql as $$
declare f jsonb:=pg_temp.issuance_fixture();
begin
  perform pg_temp.issuance_action(f,'prepareSend');
  perform pg_temp.issuance_action(f,'confirmSent',jsonb_build_object('details',pg_temp.sending_details()));
  return f||jsonb_build_object('finance',pg_temp.po_person(array['Finance','Accounting']));
end $$;
create function pg_temp.payment_input(f jsonb,kind text,extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('type',kind,'poId',f->>'po','requestId',gen_random_uuid(),
    'expectedVersion',coalesce((select version::text from private.payment_heads where po_id=(f->>'po')::uuid),'0'),
    'reason','Explicit fixture decision')||extra;
$$;
create function pg_temp.payment_action(f jsonb,kind text,extra jsonb default '{}',who jsonb default null) returns jsonb language sql as $$
  select public.payment_command(coalesce(who,f->'accountant'),pg_temp.payment_input(f,kind,extra));
$$;
create function pg_temp.payment_draft(f jsonb,amount text,ref text) returns uuid language plpgsql as $$
declare d uuid:=gen_random_uuid();
begin
  perform pg_temp.payment_action(f,'saveDraft',jsonb_build_object('draftId',d,'body',jsonb_build_object(
    'amount',amount,'reference',ref,'method','Bank transfer','date',(now() at time zone 'Asia/Manila')::date::text,
    'note','','other','','duplicateReason','')));
  return d;
end $$;
create function pg_temp.payment_proof(f jsonb,d uuid,hash text) returns uuid language plpgsql as $$
declare g jsonb; file uuid; job uuid; claimed jsonb;
begin
  g:=public.payment_files_command(f->'accountant',jsonb_build_object('type','beginGroup','requestId',gen_random_uuid(),
    'draftId',d,'expectedFiles','1','keep','[]'::jsonb,'uploads',jsonb_build_array(jsonb_build_object(
      'name','payment.pdf','mime','application/pdf','size',10,'sha256',hash))));
  select id into file from private.payment_files where group_id=(g->>'groupId')::uuid;
  claimed:=public.payment_transfer(f->'accountant',file,'claim');
  perform public.payment_transfer(f->'accountant',file,'checkpoint',(claimed->>'lease')::uuid,'{"driveFileId":"synthetic-payment-proof"}');
  perform public.payment_transfer(f->'accountant',file,'finish',(claimed->>'lease')::uuid);
  select id into job from private.payment_jobs where file_id=file and kind='validate';
  claimed:=public.payment_worker(job,'claim');
  perform public.payment_worker(job,'checkpoint',(claimed->>'lease')::uuid,'{"verified":true}');
  perform public.payment_worker(job,'complete',(claimed->>'lease')::uuid);
  return file;
end $$;

-- Historical fixtures append new snapshots rather than editing retained approvals.
-- Their synthetic sending already occurred before the agreed Credit date.
create function pg_temp.payment_terms_fixture(mode text,zero_net boolean) returns jsonb language plpgsql as $$
<<historical>>
declare f jsonb:=pg_temp.issuance_fixture(); a private.po_approvals; original private.po_approvals;
  j private.po_archive_jobs; new_job uuid:=gen_random_uuid(); prep uuid:=gen_random_uuid();
  due date:=(now() at time zone 'Asia/Manila')::date-1; body jsonb; calculation jsonb; files jsonb;
begin
  select * into original from private.po_approvals where po_id=(f->>'po')::uuid;
  a:=original; a.id:=gen_random_uuid(); a.version:=a.version+1;
  body:=jsonb_set(a.snapshot->'po'->'body','{payment}',jsonb_build_object('mode',mode,'dueDate',case when mode='credit' then due::text else '' end,'relation','matches','reason',''));
  body:=jsonb_set(body,'{fields,date}',to_jsonb((due-2)::text));
  calculation:=a.snapshot->'po'->'calculation';
  if zero_net then calculation:=calculation||'{"net":"0.00","ewtGoods":"672.00"}'::jsonb; end if;
  a.snapshot:=jsonb_set(jsonb_set(a.snapshot,'{po,body}',body),'{po,calculation}',calculation);
  insert into private.po_approvals select (a).*;
  insert into private.budget_commitment_entries(approval_id,project_id,scope_id,kind,amount,actor)
    values(original.id,original.project_id,original.scope_id,'release',-672,original.actor),
      (a.id,a.project_id,a.scope_id,'commit',672,a.actor);
  update private.purchasing_records set approval_id=a.id,body=historical.body,calculation=historical.calculation where id=a.po_id;
  select * into j from private.po_archive_jobs where approval_id=original.id;
  insert into private.po_archive_jobs(id,approval_id,actor,original_actor,folder_mapping_id,state)
    values(new_job,a.id,j.actor,j.original_actor,j.folder_mapping_id,'complete');
  insert into private.po_archives(job_id,folder_mapping_id,file_id,sha256,size)
    select new_job,folder_mapping_id,file_id,sha256,size from private.po_archives where job_id=j.id;
  files:=private.issuance_files(a.po_id);
  insert into private.po_send_preparations(id,po_id,approval_id,mrf_archive_id,po_archive_id,files,actor,prepared_at)
    values(prep,a.po_id,a.id,(files->>'mrfArchiveId')::uuid,new_job,files,f->'actor',due-interval '1 day');
  insert into private.po_issuances(po_id,preparation_id,details,blockers,actor,recorded_at)
    values(a.po_id,prep,pg_temp.sending_details()||jsonb_build_object('sentAt',to_char(due::timestamp at time zone 'Asia/Manila' at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')),'[]',f->'actor',due);
  return f;
end $$;

do $$
declare f jsonb:=pg_temp.payment_fixture(); po uuid:=(f->>'po')::uuid; d uuid; proof uuid; cmd jsonb; result jsonb; view jsonb; plan jsonb;
begin
  d:=pg_temp.payment_draft(f,'333.00','PAY-1');
  proof:=pg_temp.payment_proof(f,d,repeat('a',64));
  cmd:=pg_temp.payment_input(f,'verify',jsonb_build_object('draftId',d,'evidenceReviewed',true));
  result:=public.payment_command(f->'accountant',cmd);
  if public.payment_command(f->'accountant',cmd)<>result then raise exception 'Payment replay duplicated'; end if;
  if private.payment_paid(po)<>333 or private.scope_spent((f->>'scope')::uuid)<>336
    or private.scope_committed((f->>'scope')::uuid)<>336 or private.scope_uncommitted((f->>'scope')::uuid)<>328 then raise exception 'Partial gross conversion wrong'; end if;
  begin perform pg_temp.payment_action(f,'clear'); raise exception 'Partly paid Upfront cleared'; exception when sqlstate 'P4116' then null; end;
  plan:=jsonb_build_object('priority','High','status','Scheduled','plannedDate',(now() at time zone 'Asia/Manila')::date::text,'note','Finance retained plan');
  perform pg_temp.payment_action(f,'coordinate',jsonb_build_object('expectedLedger','1','plan',plan),f->'finance');
  begin perform pg_temp.payment_action(f,'reverse',jsonb_build_object('draftId',d),(f->'finance')||'{"activeRole":"Accounting"}'); raise exception 'Coordinator reversed payment'; exception when sqlstate 'P4113' then null; end;
  d:=pg_temp.payment_draft(f,'333.00','PAY-2');
  proof:=pg_temp.payment_proof(f,d,repeat('b',64));
  perform pg_temp.payment_action(f,'verify',jsonb_build_object('draftId',d,'evidenceReviewed',true));
  perform pg_temp.payment_action(f,'clear');
  if not private.payment_cleared(po) or private.scope_spent((f->>'scope')::uuid)<>672 then raise exception 'Full settlement/clearance failed'; end if;
  perform pg_temp.payment_action(f,'reverse',jsonb_build_object('draftId',d));
  if private.payment_cleared(po) or private.scope_spent((f->>'scope')::uuid)<>336 then raise exception 'Reversal failed'; end if;
  view:=public.payments_read(f->'accountant',po);
  if view->'records'->0->>'outstanding'<>'333.00' or view->'records'->0->'coordination'->'plan'<>plan then raise exception 'View/retained plan failed'; end if;
  begin update public.scope_budgets set amount=500 where scope_id=(f->>'scope')::uuid; raise exception 'Paid allocation freed'; exception when sqlstate 'P4901' then null; end;
  if has_table_privilege('service_role','private.payment_verifications','select') or has_function_privilege('authenticated','public.payment_command(jsonb,jsonb)','execute') then raise exception 'Payment authority exposed'; end if;
end $$;

do $$
declare mode text; f jsonb; po uuid; command jsonb; result jsonb; d uuid;
begin
  foreach mode in array array['upfront','credit'] loop
    f:=pg_temp.payment_terms_fixture(mode,true); po:=(f->>'po')::uuid;
    begin perform pg_temp.payment_action(f,'clear'); raise exception 'Zero-net PO cleared before confirmation'; exception when sqlstate 'P4116' then null; end;
    command:=pg_temp.payment_input(f,'noCash');
    result:=public.payment_command(f->'accountant',command);
    if public.payment_command(f->'accountant',command)<>result then raise exception 'No-cash replay changed result'; end if;
    if not private.payment_settled(po) or private.scope_spent((f->>'scope')::uuid)<>672 or private.scope_committed((f->>'scope')::uuid)<>0 then raise exception 'No-cash spending incorrect'; end if;
    perform pg_temp.payment_action(f,'clear');
    perform pg_temp.payment_action(f,'reverseNoCash');
    if private.payment_cleared(po) or private.payment_settled(po) or private.scope_spent((f->>'scope')::uuid)<>0 or private.scope_committed((f->>'scope')::uuid)<>672 then raise exception 'No-cash reversal incorrect'; end if;
    perform pg_temp.payment_action(f,'noCash');
    if private.payment_cleared(po) then raise exception 'Confirmation silently revived clearance'; end if;
    perform pg_temp.payment_action(f,'clear');
    if not private.payment_cleared(po) or private.scope_uncommitted((f->>'scope')::uuid)<>328 then raise exception 'Fresh zero-net clearance failed'; end if;
  end loop;
  f:=pg_temp.payment_terms_fixture('credit',false); po:=(f->>'po')::uuid;
  perform pg_temp.payment_action(f,'clear');
  if not private.payment_cleared(po) or private.payment_paid(po)<>0 then raise exception 'Unpaid overdue Credit failed clearance'; end if;
  d:=pg_temp.payment_draft(f,'333.00','OVERDUE-CREDIT');
  perform pg_temp.payment_proof(f,d,repeat('c',64));
  perform pg_temp.payment_action(f,'verify',jsonb_build_object('draftId',d,'evidenceReviewed',true));
  perform pg_temp.payment_action(f,'hold');
  perform pg_temp.payment_action(f,'clear');
  if not private.payment_cleared(po) or private.payment_paid(po)<>333 or private.scope_spent((f->>'scope')::uuid)<>336 then raise exception 'Part-paid overdue Credit failed'; end if;
end $$;

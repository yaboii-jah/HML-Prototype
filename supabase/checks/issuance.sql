-- Appended to the shared Accounting fixture definitions. Provider references are
-- synthetic here; real bytes and failure recovery belong to application checks.
create function pg_temp.issuance_fixture() returns jsonb language plpgsql as $$
declare f jsonb:=pg_temp.accounting_fixture(); job uuid; claimed jsonb;
begin
  perform pg_temp.accounting_action(f,'submitPo');
  perform pg_temp.accounting_action(f,'approvePo');
  select j.id into job from private.po_archive_jobs j join private.purchasing_records r on r.approval_id=j.approval_id where r.id=(f->>'po')::uuid;
  claimed:=public.po_archive_worker(job,'claim');
  perform public.po_archive_worker(job,'checkpoint',(claimed->>'lease')::uuid,
    jsonb_build_object('fileId','synthetic-owned-issued-po-'||job,'sha256',repeat('a',64),'size',10,'verified',true));
  perform public.po_archive_worker(job,'complete',(claimed->>'lease')::uuid);
  return f||jsonb_build_object('colleague',pg_temp.po_person(array['Procurement']));
end $$;
create function pg_temp.issuance_input(f jsonb,kind text,extra jsonb default '{}') returns jsonb language sql as $$
  select pg_temp.accounting_input(f,kind,jsonb_build_object(
    'preparationId',private.po_active_preparation((f->>'po')::uuid),
    'issuanceId',(select id from private.po_issuances where po_id=(f->>'po')::uuid))||extra);
$$;
create function pg_temp.sending_details() returns jsonb language sql as $$
  select jsonb_build_object('channel','email','recipient','Supplier recipient <qa@example.invalid>',
    'sentAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'notes','','other','');
$$;
create function pg_temp.issuance_action(f jsonb,kind text,extra jsonb default '{}',who jsonb default null) returns jsonb language sql as $$
  select public.issuance_command(coalesce(who,f->'actor'),pg_temp.issuance_input(f,kind,extra),
    case when kind='prepareSend' then public.issuance_prepare_files(coalesce(who,f->'actor'),(f->>'po')::uuid) else null end);
$$;

-- Issuance assertions (the concurrency runner reuses the definitions above).
do $$
declare f jsonb:=pg_temp.issuance_fixture(); po uuid:=(f->>'po')::uuid; cmd jsonb; result jsonb; before_value jsonb;
  files jsonb; details jsonb; prepared uuid; issued uuid; invalid jsonb; field text; t text; view jsonb;
begin
  before_value:=jsonb_build_object('demand',private.demand_snapshot((f->>'request')::uuid),'money',private.scope_committed((f->>'scope')::uuid));
  files:=public.issuance_prepare_files(f->'actor',po);
  if jsonb_array_length(files->'files')<>3 or (files->'files'->0->>'size') is null then raise exception 'Missing exact archive references'; end if;
  cmd:=pg_temp.issuance_input(f,'prepareSend');
  begin perform public.issuance_command(f->'actor',cmd); raise exception 'Preparation without provider proof'; exception when sqlstate 'P4102' then null; end;
  result:=public.issuance_command(f->'actor',cmd,files);
  if public.issuance_command(f->'actor',cmd)<>result or public.issuance_receipt(f->'actor',cmd)<>result then raise exception 'Preparation receipt failed'; end if;
  prepared:=private.po_active_preparation(po);
  begin perform public.issuance_command(f->'actor',cmd||'{"reason":"Different input"}',files); raise exception 'Receipt input overwritten'; exception when sqlstate 'P4803' then null; end;
  begin perform public.issuance_receipt(f->'colleague',cmd); raise exception 'Colleague reused receipt'; exception when sqlstate 'P4803' then null; end;
  begin perform pg_temp.accounting_action(f,'revokePo'); raise exception 'Prepared approval revoked'; exception when sqlstate 'P4101' then null; end;
  if private.scope_committed((f->>'scope')::uuid)<>672 then raise exception 'Failed revoke released money'; end if;
  begin perform pg_temp.issuance_action(f,'prepareSend'); raise exception 'Second preparation admitted'; exception when sqlstate 'P4102' then null; end;
  begin perform pg_temp.issuance_action(f,'cancelSend','{"notSent":false}'); raise exception 'False Not sent admitted'; exception when check_violation then null; end;
  cmd:=pg_temp.issuance_input(f,'cancelSend','{"notSent":true}');
  result:=public.issuance_command(f->'colleague',cmd);
  if private.po_active_preparation(po) is not null then raise exception 'Cancellation left active preparation'; end if;
  view:=private.po_issuance_view(po);
  if view->'cancellations'->0->'actor'->>'userId'<>f->'colleague'->>'userId'
    or view->'cancellations'->0->'preparedBy'->>'userId'<>f->'actor'->>'userId' then raise exception 'Cancellation lost responsible people'; end if;
  perform pg_temp.issuance_action(f,'prepareSend');
  details:=pg_temp.sending_details();
  foreach field in array array['channel','recipient','notes','sentAt'] loop
    invalid:=details-field;
    begin perform pg_temp.issuance_action(f,'confirmSent',jsonb_build_object('details',invalid)); raise exception 'Incomplete sending details admitted: %',field; exception when check_violation then null; end;
  end loop;
  begin perform pg_temp.issuance_action(f,'confirmSent',jsonb_build_object('details',details||'{"channel":"other","other":""}')); raise exception 'Unexplained Other admitted'; exception when check_violation then null; end;
  foreach t in array array['2000-01-01T00:00:00Z','2099-01-01T00:00:00Z'] loop
    begin perform pg_temp.issuance_action(f,'confirmSent',jsonb_build_object('details',details||jsonb_build_object('sentAt',t))); raise exception 'Invalid sending bounds admitted'; exception when sqlstate 'P4103' then null; end;
  end loop;
  update private.suppliers set is_active=false where id=(f->>'supplier')::uuid;
  -- Already sent: persist the truth even when current prerequisites changed.
  cmd:=pg_temp.issuance_input(f,'confirmSent',jsonb_build_object('details',details));
  result:=public.issuance_command(f->'colleague',cmd);
  if public.issuance_command(f->'colleague',cmd)<>result then raise exception 'Issuance replay failed after prerequisite loss'; end if;
  view:=private.po_issuance_view(po); issued:=(view->'issuance'->>'id')::uuid;
  if view->>'status'<>'issued' or jsonb_array_length(view->'issuance'->'blockersAtRecording')=0 then raise exception 'Issued blockers lost'; end if;
  begin perform pg_temp.accounting_action(f,'revokePo'); raise exception 'Issued approval revoked'; exception when sqlstate 'P4101' then null; end;
  begin perform pg_temp.issuance_action(f,'cancelSend','{"notSent":true}'); raise exception 'Issued preparation cancelled'; exception when sqlstate 'P4101' then null; end;
  perform pg_temp.issuance_action(f,'correctSent',jsonb_build_object('details',details||'{"channel":"chat","recipient":"Corrected supplier contact"}'),f->'actor');
  view:=private.po_issuance_view(po);
  if view->'issuance'->'details'->>'channel'<>'chat' or view->'issuance'->'originalDetails'<>details
    or view->'corrections'->0->'before'<>details then raise exception 'Correction overwrote original declaration'; end if;
  if jsonb_build_object('demand',private.demand_snapshot((f->>'request')::uuid),'money',private.scope_committed((f->>'scope')::uuid))<>before_value then raise exception 'Sending changed demand or money'; end if;
  foreach t in array array['po_send_preparations','po_send_cancellations','po_issuances','po_issuance_corrections','issuance_operations'] loop
    if has_table_privilege('service_role','private.'||t,'select') or has_table_privilege('authenticated','private.'||t,'select') then raise exception 'Private issuance table exposed'; end if;
    begin execute format('delete from private.%I',t); raise exception 'Issuance history deleted'; exception when check_violation then null; end;
  end loop;
  if has_function_privilege('authenticated','public.issuance_command(jsonb,jsonb,jsonb)','execute')
    or has_function_privilege('service_role','private.issuance_files(uuid)','execute') then raise exception 'Issuance authority exposed'; end if;
  begin perform public.issuance_receipt((f->'accountant'),cmd); raise exception 'Accounting wrote issuance'; exception when insufficient_privilege then null; end;
  delete from auth.sessions where id=(f->'colleague'->>'sessionId')::uuid;
  begin perform public.issuance_receipt(f->'colleague',cmd); raise exception 'Revoked session read receipt'; exception when insufficient_privilege then null; end;
end $$;

-- Freeze a synthetic historical Credit approval instead of changing the system
-- clock or rewriting an immutable real approval. Check Philippine midnight and
-- late recording against that original approved arrangement.
do $$
declare f jsonb:=pg_temp.issuance_fixture(); a private.po_approvals; p private.po_send_preparations;
  due date:=(clock_timestamp() at time zone 'Asia/Manila')::date-1; d jsonb; text_time text;
begin
  select * into a from private.po_approvals where po_id=(f->>'po')::uuid;
  a.id:=gen_random_uuid(); a.version:=2;
  a.snapshot:=jsonb_set(a.snapshot,'{po,body,payment}',jsonb_build_object('mode','credit','dueDate',due::text,'relation','matches','reason',''));
  insert into private.po_approvals select (a).*;
  p.approval_id:=a.id;
  p.prepared_at:=(due::timestamp at time zone 'Asia/Manila')-interval '1 day';
  text_time:=to_char((((due+1)::timestamp at time zone 'Asia/Manila')-interval '1 second') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"');
  d:=pg_temp.sending_details()||jsonb_build_object('sentAt',text_time);
  if private.issuance_details(d,p)<>d then raise exception 'Valid late recording rejected'; end if;
  text_time:=to_char((due+1)::timestamp at time zone 'Asia/Manila' at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"');
  begin perform private.issuance_details(d||jsonb_build_object('sentAt',text_time),p);
    raise exception 'Sending past Philippine Credit midnight admitted'; exception when sqlstate 'P4103' then null; end;
  -- A current PO whose approved terms are already overdue cannot be prepared.
  update private.purchasing_records set approval_id=a.id,body=jsonb_set(body,'{payment}',a.snapshot->'po'->'body'->'payment') where id=(f->>'po')::uuid;
  begin perform public.issuance_prepare_files(f->'actor',(f->>'po')::uuid);
    raise exception 'Overdue Credit preparation admitted'; exception when sqlstate 'P4102' then null; end;
end $$;
rollback;

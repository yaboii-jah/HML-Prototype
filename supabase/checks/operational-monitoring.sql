create function pg_temp.monitoring_fixture() returns jsonb language plpgsql as $$
declare
  f jsonb:=pg_temp.transfer_fixture();
  allocation uuid; line uuid;
begin
  update public.projects set location='Monitoring fixture gate' where id in ((f->>'source')::uuid,(f->>'destination')::uuid);
  allocation:=(public.transfer_command(f->'actor',pg_temp.transfer_input(f,'submit',null,jsonb_build_object('selections',
    jsonb_build_array(pg_temp.transfer_selection(f,'direct','8')))))->'ids'->>0)::uuid;
  select id into line from private.transfer_lines where transfer_id=allocation;
  return f||jsonb_build_object('transfer',allocation,'line',line,
    'logistics',pg_temp.po_person(array['Logistics']),'accountant',pg_temp.po_person());
end $$;

-- Monitoring assertions
do $$
declare
  f jsonb:=pg_temp.monitoring_fixture();
  source jsonb:=f->'sourceActor'; site jsonb:=f->'destinationActor';
  logistics jsonb:=f->'logistics'; procure jsonb:=f->'actor';
  request uuid:=(f->>'request')::uuid; transfer uuid:=(f->>'transfer')::uuid;
  source_project uuid:=(f->>'source')::uuid; site_project uuid:=(f->>'destination')::uuid;
  warehouse uuid:=gen_random_uuid(); onward uuid:=gen_random_uuid();
  target jsonb:=jsonb_build_object('target',request); v jsonb; line jsonb; account uuid;
  today date:=(clock_timestamp() at time zone 'Asia/Manila')::date;
  pay jsonb:=pg_temp.payment_terms_fixture('credit',false); pay_project uuid:=(pay->>'project')::uuid;
  draft uuid; candidate jsonb:=pg_temp.accounting_fixture();
  dual jsonb:=pg_temp.po_person(array['Finance','Accounting']);
  date_filter jsonb:=jsonb_build_object('from',today,'to',today);
begin
  v:=public.monitoring_read(source,'dashboard','{}');
  if v->>'count'<>'1' or v->'actions'->0->>'href'<>'/stock-transfers/'||transfer
    or strpos(v::text,request::text)>0 or strpos(v::text,site_project::text)>0
    or public.monitoring_read(source,'lifecycle',target) is not null then
    raise exception 'Source-only task must disclose the transfer route and no destination request';
  end if;
  if public.monitoring_read(source,'bell','{}')->>'count' is distinct from v->>'count' then
    raise exception 'Bell and dashboard Ready counts disagree';
  end if;
  begin
    perform public.monitoring_read(site,'reports','{}');
    raise exception 'Site received operational financial reports';
  exception when insufficient_privilege then null; end;
  begin
    perform public.monitoring_read(source,'consumption',date_filter||jsonb_build_object('projectId',site_project));
    raise exception 'Source-only Site received destination stock';
  exception when insufficient_privilege then null; end;
  if has_function_privilege('authenticated','public.monitoring_read(jsonb,text,jsonb)','execute')
    or has_function_privilege('service_role','private.monitoring_reports(uuid[],jsonb)','execute') then
    raise exception 'Unchecked direct monitoring execution is enabled';
  end if;
  perform pg_temp.accounting_action(candidate,'submitPo');
  v:=public.monitoring_read((candidate->'actor')||'{"activeRole":"Accounting"}','dashboard',
    jsonb_build_object('projectId',candidate->>'project'));
  if not exists(select 1 from jsonb_array_elements(v->'actions') action
    where action->>'href'='/accounting/'||(candidate->>'po')
      and action->>'blocker'='Another Accounting reviewer must approve this order.') then
    raise exception 'A historical PO preparer could see their own approval as ready';
  end if;

  line:=public.monitoring_read(site,'lifecycle',target)->'items'->0;
  if line->>'requested'<>'18' or line->>'confirmed'<>'0' or line->>'releasePending'<>'8' or line->>'unassigned'<>'10' then
    raise exception 'Pending release and confirmed demand were combined: %',line;
  end if;
  perform public.transfer_command(source,pg_temp.transfer_input(f,'approveRelease',transfer,
    jsonb_build_object('quantities',jsonb_build_object(f->>'line','8'))));
  perform public.transfer_trip_command(logistics,pg_temp.trip_input(f,'scheduleTrip',warehouse,pg_temp.trip_plan(f,'site-warehouse','6')));
  perform public.transfer_trip_command(logistics,pg_temp.trip_input(f,'dispatchTrip',warehouse,jsonb_build_object('departure',pg_temp.departure())));
  perform public.transfer_receipt_command(procure,pg_temp.trip_input(f,'receiveTrip',warehouse,pg_temp.transfer_counts(f,'5.5','0.5','0')));
  v:=public.monitoring_read(site,'lifecycle',target);
  line:=v->'items'->0;
  if line->>'confirmed'<>'7.5' or line->>'accepted'<>'0' or line->>'posted'<>'0'
     or v->'shipments'<>'[]'::jsonb or v->'purchasing'<>'[]'::jsonb then
    raise exception 'Warehouse quantities or restricted data reached site lifecycle: %',v;
  end if;
  if not exists (select 1 from jsonb_array_elements(public.monitoring_read(logistics,'dashboard','{}')->'actions') a
    where a->>'label'='Forward warehouse stock' and a->>'href'='/stock-transfers/'||transfer and a->>'blocker' is null) then
    raise exception 'Available warehouse custody is absent from Logistics Ready';
  end if;
  perform public.transfer_trip_command(logistics,pg_temp.trip_input(f,'scheduleTrip',onward,
    jsonb_set(pg_temp.trip_plan(f,'warehouse-site','5.5'),'{plan,parentTripId}',to_jsonb(warehouse))));
  perform public.transfer_trip_command(logistics,pg_temp.trip_input(f,'dispatchTrip',onward,jsonb_build_object('departure',pg_temp.departure())));
  perform public.transfer_receipt_command(site,pg_temp.trip_input(f,'receiveTrip',onward,pg_temp.transfer_counts(f,'5.3','0.2','0')));
  line:=public.monitoring_read(site,'lifecycle',target)->'items'->0;
  if line->>'confirmed'<>'7.3' or line->>'accepted'<>'5.3' or line->>'posted'<>'0' then
    raise exception 'Acceptance must precede posting: %',line;
  end if;
  perform public.transfer_receipt_command(site,pg_temp.trip_input(f,'postTrip',onward));
  select a.id into strict account from private.stock_accounts a where a.project_id=site_project;
  perform public.inventory_command(site,jsonb_build_object('operationId',gen_random_uuid(),'kind','usage',
    'projectId',site_project,'reason','Monitoring reconciliation usage',
    'lines',jsonb_build_array(jsonb_build_object('accountId',account,'quantity','1.3','expectedVersion','1'))));
  line:=public.monitoring_read(site,'lifecycle',target)->'items'->0;
  if line->>'accepted'<>'5.3' or line->>'posted'<>'5.3' then raise exception 'Usage erased lifecycle progress: %',line; end if;

  v:=public.monitoring_read(site,'consumption',date_filter||jsonb_build_object('projectId',site_project));
  line:=v->'rows'->0;
  if line->>'opening'<>'0' or line->>'receipts'<>'5.3' or line->>'usage'<>'1.3' or line->>'closing'<>'4' then
    raise exception 'Ledger posting movements do not reconcile: %',line;
  end if;
  v:=public.monitoring_read(site,'consumption',jsonb_build_object('from',today-1,'to',today-1));
  if v->'rows'<>'[]'::jsonb then raise exception 'Future-only stock entered a historical period'; end if;
  v:=public.monitoring_read(site,'consumption',jsonb_build_object('from',today+1,'to',today+1));
  if v->'rows'->0->>'opening'<>'4' or v->'rows'->0->>'closing'<>'4' then raise exception 'Quiet period lost its opening stock'; end if;

  v:=public.monitoring_read(logistics,'reports',date_filter||jsonb_build_object('projectId',site_project));
  if not exists(select 1 from jsonb_array_elements(v->'activity') a
    where a->>'label'='Transfer receipts confirmed' and a->>'total'='2') then
    raise exception 'Recorded activity excluded receipt confirmations: %',v->'activity';
  end if;
  v:=public.monitoring_read(logistics,'reports',jsonb_build_object('projectId',site_project,'from',today-1,'to',today-1));
  if v->'activity'<>'[]'::jsonb or v->'balances'->0->>'onHand'<>'4' or jsonb_array_length(v->'exceptions')=0 then
    raise exception 'Activity dates changed balances or current evidence gaps: %',v;
  end if;
  draft:=pg_temp.payment_draft(pay,'123.45','MONITORING-PARTIAL');
  perform pg_temp.payment_proof(pay,draft,repeat('f',64));
  perform pg_temp.payment_action(pay,'coordinate','{"expectedLedger":"0","plan":{"priority":"Normal","status":"Pending","plannedDate":"","note":""}}',dual);
  v:=public.monitoring_read(dual||'{"activeRole":"Accounting"}','dashboard',jsonb_build_object('projectId',pay_project));
  if not exists(select 1 from jsonb_array_elements(v->'actions') action
    where action->>'href'='/finance/'||(pay->>'po') and action->>'label'='Verify supplier payment'
      and action->>'blocker'='Another Accounting user must verify settlement.') then
    raise exception 'A prior Finance coordinator could see their own settlement verification as ready';
  end if;
  perform pg_temp.payment_action(pay,'verify',jsonb_build_object('draftId',draft,'evidenceReviewed',true));
  v:=public.monitoring_read(pay->'accountant','reports',jsonb_build_object('projectId',pay_project,'to',today-1));
  if v->'financial'->0->>'committed' is distinct from private.project_summary(pay_project,true)->'financial'->>'committed'
    or (v->'financial'->0->>'paid')::numeric is distinct from 123.45
    or v->'financial'->0->>'overdue' is distinct from v->'financial'->0->>'credit'
    or v->'financial'->0->>'credit' is distinct from (
      select ((p.calculation->>'net')::numeric-private.payment_paid(p.id))::text from private.purchasing_records p
      where p.id=(pay->>'po')::uuid) then
    raise exception 'Budget or Credit exposure disagrees with authoritative balances: %',v->'financial';
  end if;
end $$;
rollback;

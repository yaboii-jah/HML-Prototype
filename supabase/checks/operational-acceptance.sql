create function pg_temp.acceptance_source(f jsonb) returns jsonb language plpgsql as $$
declare source uuid:=gen_random_uuid(); account uuid:=gen_random_uuid(); destination uuid;
  accountant jsonb:=coalesce(f->'accountant',pg_temp.po_person());
begin
  select project_id into strict destination from public.material_requests where id=(f->>'request')::uuid;
  insert into public.projects(id,name,document_code,location)
    values(source,'Acceptance source '||substr(source::text,1,8),'AC-'||upper(substr(source::text,1,8)),'Source gate');
  update public.projects set location='Destination gate' where id=destination;
  perform public.inventory_command(accountant,jsonb_build_object(
    'operationId',gen_random_uuid(),'kind','opening','projectId',source,'reason','Counted acceptance stock',
    'lines',jsonb_build_array(jsonb_build_object('accountId',account,'description','Requested cement','unit','bag','quantity','20'))));
  return f||jsonb_build_object('source',source,'direct',account,'destination',destination);
end $$;

create function pg_temp.acceptance_fixture() returns jsonb language plpgsql as $$
declare f jsonb:=pg_temp.acceptance_source(pg_temp.issuance_fixture('credit',true));
begin
  if has_function_privilege('authenticated','public.monitoring_read(jsonb,text,jsonb)','execute')
    or has_function_privilege('service_role','private.monitoring_line_facts(uuid[])','execute') then
    raise exception 'Request quantities must only be available through the checked service reader';
  end if;
  perform pg_temp.issuance_action(f,'prepareSend');
  perform pg_temp.issuance_action(f,'confirmSent',jsonb_build_object('details',pg_temp.sending_details()));
  return f||jsonb_build_object('ref',(select ref from public.material_requests where id=(f->>'request')::uuid),
    'net',(select calculation->>'net' from private.purchasing_records where id=(f->>'po')::uuid));
end $$;

create function pg_temp.acceptance_transfer(f jsonb, actor jsonb) returns jsonb language plpgsql as $$
declare t uuid; line uuid;
begin
  t:=(public.transfer_command(actor,pg_temp.transfer_input(f,'submit',null,jsonb_build_object('selections',
    jsonb_build_array(pg_temp.transfer_selection(f,'direct','12')))))->'ids'->>0)::uuid;
  select l.id into strict line from private.transfer_lines l where l.transfer_id=t;
  return f||jsonb_build_object('transfer',t,'line',line);
end $$;

create function pg_temp.acceptance_delivery_counts(f jsonb, amount text)
returns jsonb language sql as $$
  select jsonb_build_object('arrivalAt',clock_timestamp(),'extraGoods','',
    'receiptLines',jsonb_build_array(jsonb_build_object('lineId',body->'lines'->0->>'id',
    'accepted',amount,'missing','0','rejected','0','issue','')))
  from private.purchasing_records where id=(f->>'po')::uuid
$$;

-- Operational acceptance assertions
do $$
declare f jsonb:=pg_temp.acceptance_fixture(); site jsonb:=pg_temp.delivery_site_actor((f->>'destination')::uuid);
  source jsonb:=pg_temp.delivery_site_actor((f->>'source')::uuid); logistics jsonb:=pg_temp.po_person(array['Logistics']);
  arrival uuid:=gen_random_uuid(); warehouse uuid:=gen_random_uuid(); onward uuid:=gen_random_uuid();
  filters jsonb:=jsonb_build_object('projectId',f->>'destination','search',lower(f->>'ref'));
  today date:=(now() at time zone 'Asia/Manila')::date;
  row jsonb; posting jsonb; account uuid; draft uuid; report jsonb;
begin
  row:=public.monitoring_read(site,'dashboardProgress',filters||'{"page":"999"}')->'rows'->0;
  if row->'sourcing'->>'state' is distinct from 'partial' or row->>'totalLines' is distinct from '1' then
    raise exception 'Issued order should partially cover the request: %',row;
  end if;
  if public.monitoring_read(source,'dashboardProgress',jsonb_build_object('search',f->>'ref'))->'rows'
    is distinct from '[]'::jsonb then raise exception 'Source-only Site saw the destination request'; end if;
  f:=pg_temp.acceptance_transfer(f,f->'actor');
  perform public.transfer_command(source,pg_temp.transfer_input(f,'approveRelease',(f->>'transfer')::uuid,
    jsonb_build_object('quantities',jsonb_build_object(f->>'line','12'))));
  perform pg_temp.payment_action(f,'clear');
  if private.payment_paid((f->>'po')::uuid)<>0 or private.payment_settled((f->>'po')::uuid) then
    raise exception 'Credit fixture started settled';
  end if;
  perform public.delivery_command(logistics,pg_temp.delivery_input(f,'schedule',arrival,
    jsonb_build_object('plan',pg_temp.delivery_plan(f,'6'))));
  perform public.delivery_command(logistics,pg_temp.delivery_input(f,'dispatch',arrival,jsonb_build_object('departure',pg_temp.departure())));
  perform public.delivery_command(site,pg_temp.delivery_input(f,'receive',arrival,pg_temp.acceptance_delivery_counts(f,'6')));
  perform public.delivery_command(site,pg_temp.delivery_input(f,'post',arrival));
  perform public.transfer_trip_command(logistics,pg_temp.trip_input(f,'scheduleTrip',warehouse,pg_temp.trip_plan(f,'site-warehouse','12')));
  perform public.transfer_trip_command(logistics,pg_temp.trip_input(f,'dispatchTrip',warehouse,jsonb_build_object('departure',pg_temp.departure())));
  perform public.transfer_receipt_command(f->'actor',pg_temp.trip_input(f,'receiveTrip',warehouse,pg_temp.transfer_counts(f,'12','0','0')));
  row:=public.monitoring_read(site,'dashboardProgress',filters)->'rows'->0;
  if row->'sourcing'->>'state' is distinct from 'complete' or row->'receipt'->>'state' is distinct from 'partial'
    or row->'posting'->>'state' is distinct from 'partial' then
    raise exception 'Warehouse custody affected final site progress: %',row;
  end if;
  perform public.transfer_trip_command(logistics,pg_temp.trip_input(f,'scheduleTrip',onward,
    jsonb_set(pg_temp.trip_plan(f,'warehouse-site','12'),'{plan,parentTripId}',to_jsonb(warehouse))));
  perform public.transfer_trip_command(logistics,pg_temp.trip_input(f,'dispatchTrip',onward,jsonb_build_object('departure',pg_temp.departure())));
  perform public.transfer_receipt_command(site,pg_temp.trip_input(f,'receiveTrip',onward,pg_temp.transfer_counts(f,'12','0','0')));
  posting:=pg_temp.trip_input(f,'postTrip',onward);
  if public.transfer_receipt_command(site,posting) is distinct from public.transfer_receipt_command(site,posting) then
    raise exception 'Retry changed the accepted posting';
  end if;
  select a.id into strict account from private.stock_accounts a where a.project_id=(f->>'destination')::uuid;
  if (private.stock_snapshot(array[account])->0->>'onHand')::numeric<>18
    or (select count(*) from private.stock_movements where account_id=account)<>2 then
    raise exception 'The two site receipts must share one ledger without duplicate stock';
  end if;
  draft:=pg_temp.payment_draft(f,f->>'net','ACCEPTANCE-'||gen_random_uuid());
  perform pg_temp.payment_proof(f,draft,replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''));
  perform pg_temp.payment_action(f,'verify',jsonb_build_object('draftId',draft,'evidenceReviewed',true));
  perform public.inventory_command(site,jsonb_build_object(
    'operationId',gen_random_uuid(),'kind','usage','projectId',f->>'destination','reason','Installed on the acceptance request',
    'lines',jsonb_build_array(jsonb_build_object('accountId',account,'quantity','3','expectedVersion',
      (select version::text from private.stock_accounts where id=account)))));
  if public.monitoring_read(site,'dashboardProgress',filters)->'rows' is distinct from '[]'::jsonb then
    raise exception 'A fully posted request belongs under All';
  end if;
  row:=public.monitoring_read(site,'dashboardProgress',filters||'{"status":"all"}')->'rows'->0;
  if row->'receipt'->>'state' is distinct from 'complete' or row->'posting'->>'state' is distinct from 'complete' then
    raise exception 'Usage removed completed progress: %',row;
  end if;
  update public.material_requests set correction_kind='documents',correction_state='editing' where id=(f->>'request')::uuid;
  row:=public.monitoring_read(site,'dashboardProgress',filters)->'rows'->0;
  if row->>'correctionKind' is distinct from 'documents' or row->'posting'->>'state' is distinct from 'complete' then
    raise exception 'An open document correction should retain completed material progress: %',row;
  end if;
  report:=public.monitoring_read(site,'consumption',jsonb_build_object('from',today,'to',today))->'rows'->0;
  if (report->>'receipts')::numeric is distinct from 18 or (report->>'usage')::numeric is distinct from 3
    or (report->>'closing')::numeric is distinct from 15 then raise exception 'Consumption did not reconcile: %',report; end if;
  report:=public.monitoring_read(f->'accountant','reports',filters-'search')->'financial'->0;
  if (report->>'paid')::numeric is distinct from (f->>'net')::numeric or (report->>'credit')::numeric is distinct from 0 then
    raise exception 'Credit settlement did not reconcile: %',report;
  end if;
end $$;
rollback;

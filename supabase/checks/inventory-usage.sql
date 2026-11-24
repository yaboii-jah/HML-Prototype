create function pg_temp.inventory_input(category text, project uuid, lines jsonb, extras jsonb default '{}')
returns jsonb language sql as $$
  select jsonb_build_object('operationId',gen_random_uuid(),'kind',category,'projectId',project,
    'reason','Verified inventory action','lines',lines)||extras
$$;

create function pg_temp.inventory_line(account uuid, amount text) returns jsonb language sql as $$
  select jsonb_build_object('accountId',account,'quantity',amount,'expectedVersion',
    (select version::text from private.stock_accounts where id=account))
$$;

-- Inventory assertions
do $$
declare
  f jsonb:=pg_temp.trip_fixture(); source uuid:=(f->>'source')::uuid; destination uuid:=(f->>'destination')::uuid;
  site jsonb:=f->'sourceActor'; receiver jsonb:=f->'destinationActor'; accountant jsonb:=pg_temp.po_person();
  finance jsonb:=pg_temp.po_person(array['Finance']); account uuid:=(f->>'direct')::uuid;
  first uuid:=gen_random_uuid(); second uuid:=gen_random_uuid(); cmd jsonb; result jsonb;
  usage_id uuid; related uuid; view jsonb; opening jsonb;
begin
  opening:=jsonb_build_object('accountId',first,'description','Existing tiles','unit','box','quantity','7.125');
  cmd:=pg_temp.inventory_input('opening',destination,jsonb_build_array(opening));
  begin
    perform public.inventory_command(receiver,cmd);
    raise exception 'Site posted opening stock'; exception when insufficient_privilege then null;
  end;
  result:=public.inventory_command(accountant,cmd);
  if result<>public.inventory_command(accountant,cmd) then raise exception 'Opening replay changed outcome'; end if;
  begin
    perform public.inventory_command(accountant,pg_temp.inventory_input('opening',destination,jsonb_build_array(
      opening||jsonb_build_object('accountId',second,'description',' existing TILES ','unit','Box'))));
    raise exception 'Duplicate normalized opening saved'; exception when sqlstate 'P4174' then null;
  end;
  perform public.inventory_command(accountant,pg_temp.inventory_input('opening',destination,jsonb_build_array(
    opening||jsonb_build_object('accountId',second,'description','Sand','quantity','2'))));
  begin
    perform public.inventory_command(site,pg_temp.inventory_input('correction',source,jsonb_build_array(pg_temp.inventory_line(account,'3')),
      '{"direction":"remove"}'));
    raise exception 'Correction consumed reserved stock'; exception when sqlstate 'P4172' then null;
  end;
  begin
    perform public.inventory_command(receiver,pg_temp.inventory_input('usage',source,jsonb_build_array(pg_temp.inventory_line(account,'1'))));
    raise exception 'Unassigned Site recorded usage'; exception when insufficient_privilege then null;
  end;
  cmd:=pg_temp.inventory_input('usage',destination,jsonb_build_array(pg_temp.inventory_line(first,'1.125'),pg_temp.inventory_line(second,'2.1')));
  begin
    perform public.inventory_command(receiver,cmd);
    raise exception 'Invalid grouped usage saved'; exception when sqlstate 'P4172' then null;
  end;
  if exists(select 1 from private.inventory_entries where id=(cmd->>'operationId')::uuid)
    or (private.stock_snapshot(array[first])->0->>'onHand')::numeric<>7.125 then raise exception 'Grouped usage had partial effects'; end if;

  cmd:=pg_temp.inventory_input('usage',destination,jsonb_build_array(
    pg_temp.inventory_line(first,'1.125')||'{"note":"Installed floor tiles"}',pg_temp.inventory_line(second,'2')));
  result:=public.inventory_command(receiver,cmd);
  usage_id:=(result->>'id')::uuid;
  if result<>public.inventory_command(receiver,cmd) or (select count(*) from private.stock_movements where operation_id=usage_id)<>2
    or (private.stock_snapshot(array[first])->0->>'onHand')::numeric<>6
    or (private.stock_snapshot(array[second])->0->>'onHand')::numeric<>0 then
    raise exception 'Exact grouped usage or replay failed';
  end if;
  begin
    perform public.inventory_command(receiver,cmd||'{"reason":"Changed replay reason"}');
    raise exception 'Changed retry accepted'; exception when sqlstate 'P4173' then null;
  end;
  select id into related from private.stock_movements where operation_id=usage_id and account_id=first;
  perform public.inventory_command(receiver,pg_temp.inventory_input('correction',destination,jsonb_build_array(pg_temp.inventory_line(first,'0.125')),
    jsonb_build_object('direction','add','relatedMovementId',related)));
  view:=public.inventory_read(finance,'material',destination,first);
  if not (view->>'found')::boolean or (view->'accounts'->0->>'onHand')::numeric<>6.125
    or not exists(select 1 from jsonb_array_elements(view->'movements') m where m->>'relatedMovementId'=related::text)
    or not exists(select 1 from jsonb_array_elements(view->'movements') m where m->>'reason'='Installed floor tiles') then
    raise exception 'Stock history lost the original or its linked correction';
  end if;
  if (public.inventory_read(site,'material',destination,first)->>'found')::boolean
    or (public.inventory_read(site,'entry',null,usage_id)->>'found')::boolean
    or not (public.inventory_read(finance,'entry',null,usage_id)->>'found')::boolean
    or has_function_privilege('authenticated','public.inventory_read(jsonb,text,uuid,uuid)','execute')
    or has_table_privilege('service_role','private.inventory_entries','select') then
    raise exception 'Inventory read boundary failed';
  end if;
  begin
    perform public.inventory_command(finance,pg_temp.inventory_input('correction',destination,jsonb_build_array(pg_temp.inventory_line(first,'1')),
      '{"direction":"add"}'));
    raise exception 'Read-only role wrote stock'; exception when insufficient_privilege then null;
  end;
end $$;
do $$
declare
  f jsonb:=pg_temp.trip_fixture();
  site jsonb:=f->'destinationActor'; other_site jsonb:=f->'sourceActor';
  accountant jsonb:=pg_temp.po_person();
  project uuid:=(f->>'destination')::uuid;
  report uuid:=gen_random_uuid(); approval uuid:=gen_random_uuid();
  rejected uuid:=gen_random_uuid(); raced uuid:=gen_random_uuid(); receipt_account uuid:=gen_random_uuid();
  cmd jsonb; decision jsonb; result jsonb; view jsonb; bell_before integer;
  report_href text:='/inventory?view=stock-reports&reportId='||report;
begin
  bell_before:=(public.monitoring_read(accountant,'bell','{}')->>'count')::integer;
  cmd:=jsonb_build_object('operationId',report,'action','submit','projectId',project,
    'description','Found stock tiles','unit','box','quantity','7.125','reason','Physical site count');
  begin
    perform public.stock_report_command(other_site,cmd);
    raise exception 'Unassigned Site submitted a report'; exception when insufficient_privilege then null;
  end;
  begin
    perform public.stock_report_command(accountant,cmd);
    raise exception 'Accounting submitted as Site'; exception when insufficient_privilege then null;
  end;
  result:=public.stock_report_command(site,cmd);
  if result<>public.stock_report_command(site,cmd)
    or exists(select 1 from private.stock_accounts where id=report) then
    raise exception 'Pending report posted stock or changed on retry';
  end if;
  if (public.monitoring_read(accountant,'bell','{}')->>'count')::integer is distinct from bell_before+1
    or not exists(select 1 from jsonb_array_elements(public.monitoring_read(accountant,'dashboard',
      jsonb_build_object('projectId',project))->'actions') a where a->>'href'=report_href and a->>'label'='Review unrecorded stock')
    or exists(select 1 from jsonb_array_elements(public.monitoring_read(site,'dashboard','{}')->'actions') a where a->>'href'=report_href) then
    raise exception 'Pending stock report did not appear in the Accounting queue only';
  end if;
  begin
    perform public.stock_report_command(site,cmd||'{"quantity":"12"}');
    raise exception 'Changed submission accepted on replay'; exception when sqlstate 'P4173' then null;
  end;
  begin
    perform public.stock_report_command(site,cmd||jsonb_build_object('operationId',gen_random_uuid(),'description',' found STOCK tiles ','unit','BOX'));
    raise exception 'Duplicate pending report accepted'; exception when unique_violation then null;
  end;
  view:=public.inventory_read(site,'stock',project,null);
  if view->'stockReports'->0->>'status' is distinct from 'pending'
    or public.inventory_read(other_site,'stock',project,null)->'stockReports' is distinct from '[]'::jsonb then
    raise exception 'Pending status or Site project visibility failed';
  end if;
  decision:=jsonb_build_object('operationId',approval,'action','approve','projectId',project,'reportId',report);
  begin
    perform public.stock_report_command(site,decision);
    raise exception 'Site approved a report'; exception when insufficient_privilege then null;
  end;
  result:=public.stock_report_command(accountant,decision);
  if (public.monitoring_read(accountant,'bell','{}')->>'count')::integer is distinct from bell_before
    or exists(select 1 from jsonb_array_elements(public.monitoring_read(accountant,'dashboard','{}')->'actions') a where a->>'href'=report_href) then
    raise exception 'Approved stock report stayed in the Accounting queue';
  end if;
  if result<>public.stock_report_command(accountant,decision)
    or result<>public.stock_report_command(site,cmd)
    or (select count(*) from private.stock_movements where operation_id=approval)<>1
    or (private.stock_snapshot(array[report])->0->>'available')::numeric is distinct from 7.125
    or (select status from private.stock_reports where id=report) is distinct from 'approved'
    or (select actor_id from private.inventory_entries where id=approval) is distinct from (accountant->>'userId')::uuid then
    raise exception 'Approval failed to post one audited opening balance';
  end if;
  begin
    perform public.stock_report_command(accountant,decision||jsonb_build_object('operationId',gen_random_uuid()));
    raise exception 'A second approval succeeded'; exception when sqlstate 'P4175' then null;
  end;
  begin
    perform public.stock_report_command(site,cmd||jsonb_build_object('operationId',gen_random_uuid()));
    raise exception 'Report submitted for an existing record'; exception when sqlstate 'P4174' then null;
  end;

  perform public.stock_report_command(site,cmd||jsonb_build_object('operationId',rejected,'description','Found gravel'));
  decision:=jsonb_build_object('operationId',gen_random_uuid(),'action','reject','projectId',project,
    'reportId',rejected,'reason','Site count needs verification');
  result:=public.stock_report_command(accountant,decision);
  if result<>public.stock_report_command(accountant,decision)
    or exists(select 1 from private.stock_accounts where id=rejected)
    or (public.monitoring_read(accountant,'bell','{}')->>'count')::integer is distinct from bell_before
    or (select rejection_reason from private.stock_reports where id=rejected) is distinct from 'Site count needs verification' then
    raise exception 'Rejection changed stock or lost its reason';
  end if;
  perform public.stock_report_command(site,cmd||jsonb_build_object('operationId',gen_random_uuid(),'description','Found gravel'));

  perform public.stock_report_command(site,cmd||jsonb_build_object('operationId',raced,'description','Counted outlet boxes'));
  perform private.stock_apply(site,gen_random_uuid(),
    jsonb_build_array(jsonb_build_object('accountId',receipt_account,'projectId',project,'description','Counted outlet boxes','unit','box','expectedVersion','0')),
    jsonb_build_array(jsonb_build_object('accountId',receipt_account,'sourceId',gen_random_uuid(),'sourceLineId',gen_random_uuid(),
      'sourceKind','purchase_receipt','postingKind','receipt','quantity','4')), '[]','Simulated receipt posting');
  decision:=jsonb_build_object('operationId',gen_random_uuid(),'action','approve','projectId',project,'reportId',raced);
  begin
    perform public.stock_report_command(accountant,decision);
    raise exception 'Receipt during review allowed another opening'; exception when sqlstate 'P4174' then null;
  end;
  view:=public.inventory_read(accountant,'stock',project,null);
  if not exists(select 1 from jsonb_array_elements(view->'stockReports') r
    where r->>'id'=raced::text and r->>'status'='pending' and r->>'accountId'=receipt_account::text)
    or exists(select 1 from private.inventory_entries where id=(decision->>'operationId')::uuid)
    or (private.stock_snapshot(array[receipt_account])->0->>'available')::numeric is distinct from 4
    or has_function_privilege('authenticated','public.stock_report_command(jsonb,jsonb)','execute')
    or has_table_privilege('service_role','private.stock_reports','select') then
    raise exception 'Blocked approval leaked effects, account location or privileges';
  end if;
end $$;
rollback;

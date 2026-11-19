create function pg_temp.transfer_counts(f jsonb,accepted text,missing text,rejected text) returns jsonb language sql as $$
  select jsonb_build_object('arrivalAt',clock_timestamp(),'extraGoods','',
    'receiptLines',jsonb_build_array(jsonb_build_object('lineId',f->>'line','accepted',accepted,
      'missing',missing,'rejected',rejected,'issue','Verified shortage or damage')))
$$;

-- Receipt assertions
do $$
declare
  f jsonb:=pg_temp.trip_fixture(); logistics jsonb:=f->'logistics'; procurement jsonb:=f->'actor';
  site jsonb:=f->'destinationActor'; accounting jsonb:=pg_temp.po_person(array['Accounting']);
  warehouse uuid:=gen_random_uuid(); onward uuid:=gen_random_uuid(); later uuid:=gen_random_uuid();
  direct uuid:=gen_random_uuid(); material uuid:=(f->>'line')::uuid; request uuid:=(f->>'request')::uuid;
  transfer uuid:=(f->>'transfer')::uuid; command jsonb; result jsonb; view jsonb;
  receipt_version uuid; generated uuid; signed uuid; supporting uuid; lease uuid;
  evidence jsonb; award uuid:=gen_random_uuid();
begin
  perform public.transfer_trip_command(logistics,
    pg_temp.trip_input(f,'scheduleTrip',warehouse,pg_temp.trip_plan(f,'site-warehouse','6')));
  perform public.transfer_trip_command(logistics,
    pg_temp.trip_input(f,'dispatchTrip',warehouse,jsonb_build_object('departure',pg_temp.departure())));
  command:=pg_temp.trip_input(f,'receiveTrip',warehouse,pg_temp.transfer_counts(f,'5.5','0.25','0.25'));
  begin
    perform public.transfer_receipt_command(site,command);
    raise exception 'Site submitted warehouse receiving'; exception when insufficient_privilege then null;
  end;
  result:=public.transfer_receipt_command(procurement,command);
  if result<>public.transfer_receipt_command(procurement,command)
    or (select quantity from private.demand_claims where id=material)<>7.5 then
    raise exception 'Warehouse shortages were not released exactly once';
  end if;
  perform private.demand_apply(procurement,gen_random_uuid(),request,
    private.demand_snapshot(request)->>'version',
    jsonb_build_array(jsonb_build_object('claimId',award,'itemId',f->>'item','ownerId',award,
      'ownerLineId',award,'ownerKind','award','quantity','10.5')),'Synthetic replacement demand');
  begin
    perform public.transfer_receipt_command(procurement,pg_temp.trip_input(f,'recountTrip',warehouse,
      pg_temp.transfer_counts(f,'6','0','0')));
    raise exception 'Recount used demand claimed by a replacement'; exception when sqlstate 'P4164' then null;
  end;
  if (select revision from private.transfer_receipts where trip_id=warehouse)<>1 then
    raise exception 'Failed recount changed the receipt revision';
  end if;

  update public.material_requests set correction_kind='documents',correction_state='editing' where id=request;
  perform public.transfer_trip_command(logistics,pg_temp.trip_input(f,'scheduleTrip',onward,
    jsonb_set(pg_temp.trip_plan(f,'warehouse-site','4'),'{plan,parentTripId}',to_jsonb(warehouse))));
  perform public.transfer_trip_command(logistics,pg_temp.trip_input(f,'scheduleTrip',later,
    jsonb_set(pg_temp.trip_plan(f,'warehouse-site','1.5'),'{plan,parentTripId}',to_jsonb(warehouse))));
  begin
    perform public.transfer_receipt_command(procurement,pg_temp.trip_input(f,'recountTrip',warehouse,
      pg_temp.transfer_counts(f,'5.25','0.5','0.25')));
    raise exception 'Recount reduced custody below reservations'; exception when sqlstate 'P4152' then null;
  end;
  perform public.transfer_trip_command(logistics,pg_temp.trip_input(f,'dispatchTrip',onward,
    jsonb_build_object('departure',pg_temp.departure())));
  command:=pg_temp.trip_input(f,'receiveTrip',onward,pg_temp.transfer_counts(f,'3.8','0','0.2'));
  begin
    perform public.transfer_receipt_command(f->'sourceActor',command);
    raise exception 'Source-only Site received the onward load'; exception when insufficient_privilege then null;
  end;
  perform public.transfer_receipt_command(site,command);
  perform public.transfer_trip_command(procurement,pg_temp.trip_input(f,'cancelRemaining',null));
  if (select state from private.transfer_trips where id=later)<>'scheduled'
    or (select quantity from private.demand_claims where id=material)<>5.3
    or (select quantity from private.stock_movements where source_id=warehouse)<>-6
    or exists(select 1 from private.stock_movements where source_id=onward) then
    raise exception 'First-leg cancellation, custody, or net demand reconciliation failed';
  end if;
  command:=pg_temp.trip_input(f,'postTrip',onward);
  result:=public.transfer_receipt_command(site,command);
  if result<>public.transfer_receipt_command(site,command)
    or (select count(*) from private.stock_movements where source_id=onward and source_kind='transfer_receipt')<>1
    or not exists(select 1 from private.stock_movements m join private.stock_accounts a on a.id=m.account_id
      where m.source_id=onward and m.quantity=3.8 and a.description='Requested cement'
        and a.project_id=(f->>'destination')::uuid) then
    raise exception 'Destination posting failed or duplicated';
  end if;
  begin
    perform public.transfer_receipt_command(site,pg_temp.trip_input(f,'recountTrip',onward,pg_temp.transfer_counts(f,'4','0','0')));
    raise exception 'Recount accepted after stock posting'; exception when sqlstate 'P4161' then null;
  end;
  perform public.transfer_trip_command(logistics,pg_temp.trip_input(f,'cancelTrip',later));
  if (private.transfer_custody(warehouse)->0->>'available')::numeric<>1.5 then
    raise exception 'Onward cancellation failed to free only custody';
  end if;

  select id into receipt_version from private.transfer_receipt_versions where trip_id=onward;
  select id into generated from private.transfer_receipt_files where version_id=receipt_version and kind='generated';
  evidence:=jsonb_build_object('name','signed.pdf','kind','signed','mime','application/pdf','size',12,'sha256',repeat('a',64));
  signed:=(public.transfer_receipt_file(site,null,receipt_version,'begin',null,evidence)->>'id')::uuid;
  if (public.transfer_receipt_file(site,null,receipt_version,'begin',null,evidence)->>'id')::uuid<>signed then
    raise exception 'Evidence resume duplicated the active file';
  end if;
  supporting:=(public.transfer_receipt_file(site,null,receipt_version,'begin',null,
    evidence||'{"kind":"supporting","name":"condition.pdf"}')->>'id')::uuid;
  update private.transfer_receipt_files set state='complete',drive_id='fixture-file-'||id,size=12,sha256=repeat('a',64)
    where id in (generated,signed);
  command:=pg_temp.trip_input(f,'approveTripEvidence',onward,jsonb_build_object('receiptVersionId',receipt_version));
  begin
    perform public.transfer_receipt_command(accounting,command);
    raise exception 'Review approved while supporting evidence was incomplete'; exception when sqlstate 'P4162' then null;
  end;
  perform public.transfer_receipt_file(site,supporting,null,'withdraw',null,'{}');
  perform public.transfer_receipt_command(accounting,pg_temp.trip_input(f,'approveTripEvidence',onward,
    jsonb_build_object('receiptVersionId',receipt_version)));
  if not exists(select 1 from private.transfer_receipts where trip_id=onward and posted_at is not null and review_state='approved') then
    raise exception 'Posting and Accounting review should be able to complete independently';
  end if;
  perform public.transfer_receipt_file(accounting,signed,null,'read',null,'{}');
  perform public.transfer_receipt_file(site,generated,null,'read',null,'{}');
  begin
    perform public.transfer_receipt_file(site,signed,null,'read',null,'{}');
    raise exception 'Destination Site opened a signed original'; exception when insufficient_privilege then null;
  end;
  begin
    perform public.transfer_receipt_file(f->'sourceActor',generated,null,'read',null,'{}');
    raise exception 'Source-only Site opened the generated receipt'; exception when insufficient_privilege then null;
  end;
  view:=public.transfer_read(site,null,transfer);
  if not exists(select 1 from jsonb_array_elements(view->'records'->0->'trips') entry
    where entry->>'id'=onward::text and entry->'receipt'->>'reviewState'='approved') then
    raise exception 'Transfer read model did not show the approved receipt';
  end if;
  perform public.transfer_receipt_file(site,null,receipt_version,'begin',null,
    evidence||jsonb_build_object('replacesId',signed,'sha256',repeat('b',64)));
  if not exists(select 1 from private.transfer_receipts where trip_id=onward and posted_at is not null and review_state='pending')
    or not exists(select 1 from private.transfer_receipt_files where id=signed and state='complete' and not current_evidence) then
    raise exception 'Replacement failed to reopen review or retain history';
  end if;
end $$;
rollback;

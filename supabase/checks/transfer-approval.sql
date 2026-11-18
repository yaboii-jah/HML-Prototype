create function pg_temp.transfer_fixture() returns jsonb language plpgsql as $$
declare f jsonb:=pg_temp.demand_fixture(); source uuid:=gen_random_uuid(); destination uuid;
  direct_stock uuid:=gen_random_uuid(); alternative_stock uuid:=gen_random_uuid(); account uuid; description text;
begin
  select project_id into destination from public.material_requests where id=(f->>'request')::uuid;
  insert into public.projects(id,name,document_code) values(source,'Source stock fixture '||source,'ST-'||upper(substr(source::text,1,8)));
  foreach account in array array[direct_stock,alternative_stock] loop
    description:=case when account=direct_stock then 'Requested cement' else 'Same grade cement' end;
    perform private.stock_apply(f->'actor',gen_random_uuid(),
      jsonb_build_array(jsonb_build_object('accountId',account,'projectId',source,'description',description,'unit','bags','expectedVersion','0')),
      jsonb_build_array(jsonb_build_object('accountId',account,'sourceKind','purchase_receipt','sourceId',gen_random_uuid(),
        'sourceLineId',gen_random_uuid(),'postingKind','receipt','quantity','10')),'[]','Synthetic posted stock');
  end loop;
  return f||jsonb_build_object('source',source,'destination',destination,'direct',direct_stock,'alternative',alternative_stock,
    'sourceActor',pg_temp.delivery_site_actor(source),'destinationActor',pg_temp.delivery_site_actor(destination));
end $$;

create function pg_temp.transfer_input(f jsonb,kind text,record_id uuid,extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('type',kind,'requestId',gen_random_uuid(),'transferId',record_id,
    'mrfId',f->>'request','sourceId',f->>'source','reason','Reviewed material quantities',
    'expectedDemand',private.demand_snapshot((f->>'request')::uuid)->>'version',
    'expectedVersion',(select version::text from private.transfers where id=record_id))||extra
$$;
create function pg_temp.transfer_selection(f jsonb, stock_kind text, amount text) returns jsonb language sql as $$
  select jsonb_build_object('itemId',f->>'item','stockId',f->>stock_kind,'quantity',amount,'match',stock_kind,
    'verified',stock_kind='direct','explanation','Same specified grade and package')
$$;

-- Transfer assertions
do $$
declare f jsonb:=pg_temp.transfer_fixture(); source uuid:=(f->>'source')::uuid; target uuid:=(f->>'request')::uuid;
  direct_stock uuid:=(f->>'direct')::uuid; alt_stock uuid:=(f->>'alternative')::uuid;
  direct uuid; review uuid; release uuid; line uuid; cmd jsonb; result jsonb; projection jsonb;
  dual jsonb:=f->'destinationActor'; new_session uuid:=gen_random_uuid(); credentials jsonb;
begin
  projection:=public.transfer_read(f->'actor',target,null);
  if jsonb_array_length(projection->'sourcing'->'candidates')<>2
    or projection->'sourcing'->'items'->0->>'unassigned' is distinct from '18' then
    raise exception 'Initial approved MRF sourcing must show stock and unclaimed demand';
  end if;
  cmd:=pg_temp.transfer_input(f,'submit',null,jsonb_build_object('selections',
    jsonb_build_array(pg_temp.transfer_selection(f,'direct','4'),pg_temp.transfer_selection(f,'alternative','7'))));
  result:=public.transfer_command(f->'actor',cmd);
  if result<>public.transfer_command(f->'actor',cmd) then raise exception 'Submit replay changed outcome'; end if;
  direct:=(result->'ids'->>0)::uuid; review:=(result->'ids'->>1)::uuid;
  if (select ref from private.transfers where id=direct) !~ '-TRF-0001$'
    or (private.stock_snapshot(array[direct_stock])->0->>'reserved')::numeric<>4
    or (private.stock_snapshot(array[alt_stock])->0->>'reserved')::numeric<>0
    or (select sum(quantity) from private.demand_claims where request_id=target)<>11 then
    raise exception 'Mixed submission must reserve stock only for direct matches and claim demand for both';
  end if;

  projection:=public.transfer_read(f->'sourceActor',null,null);
  if jsonb_array_length(projection->'records')<>1 or projection->'records'->0->'requestId'<>'null'
    or projection->'sourcing'<>'null' then raise exception 'Source-only projection leaked destination details'; end if;
  if (public.transfer_read(pg_temp.po_person(array['Finance']),null,direct)->'records'->0->>'id')::uuid is distinct from direct then
    raise exception 'Finance must be able to read the operational release'; end if;
  if jsonb_array_length(public.transfer_read(pg_temp.po_person(array['Site Personnel']),null,direct)->'records')<>0 then
    raise exception 'Unassigned Site could see a transfer'; end if;
  begin
    perform public.transfer_command(f->'sourceActor',pg_temp.transfer_input(f,'confirmSuitability',review,'{"quantity":"7","specificationsConfirmed":true}'));
    raise exception 'Source alone confirmed destination suitability'; exception when insufficient_privilege then null;
  end;
  begin
    perform public.transfer_command(f->'actor',pg_temp.transfer_input(f,'submit',null,jsonb_build_object('selections',
      jsonb_build_array(pg_temp.transfer_selection(f,'direct','2'),pg_temp.transfer_selection(f,'alternative','11')))));
    raise exception 'Invalid mixed submission saved'; exception when sqlstate 'P4142' then null;
  end;
  if (select count(*) from private.transfers where request_id=target)<>2 then raise exception 'Mixed rollback was partial'; end if;
  select id into line from private.transfer_lines where transfer_id=direct;
  cmd:=pg_temp.transfer_input(f,'approveRelease',direct,jsonb_build_object('quantities',jsonb_build_object(line,'2.25')));
  perform public.transfer_command(f->'sourceActor',cmd);
  if (select quantity from private.demand_claims where id=line)<>2.25
    or (select quantity from private.stock_reservations where id=line)<>2.25 then
    raise exception 'Source-only actor failed to reduce both existing claims';
  end if;
  perform public.transfer_command(dual,pg_temp.transfer_input(f,'confirmSuitability',review,'{"quantity":"6","specificationsConfirmed":true}'));
  result:=public.transfer_command(f->'actor',pg_temp.transfer_input(f,'requestRelease',review,'{"quantity":"3.5"}'));
  release:=(result->'ids'->>1)::uuid;
  if (select sum(quantity) from private.demand_claims where request_id=target)<>5.75
    or (private.stock_snapshot(array[alt_stock])->0->>'reserved')::numeric<>3.5 then
    raise exception 'Conversion must close the old hold and reserve only the requested amount';
  end if;
  insert into public.project_assignments(user_id,project_id) values((dual->>'userId')::uuid,source);
  insert into auth.sessions(id,user_id,created_at,updated_at) values(new_session,(dual->>'userId')::uuid,now(),now());
  credentials:=private.login_preflight((dual->>'userId')||'@example.invalid');
  perform private.bind_session((dual->>'userId')::uuid,new_session,credentials->>'revision',credentials->>'credential');
  dual:=dual||jsonb_build_object('sessionId',new_session,'revision',credentials->>'revision');
  select id into line from private.transfer_lines where transfer_id=release;
  begin
    perform public.transfer_command(dual,pg_temp.transfer_input(f,'approveRelease',release,jsonb_build_object('quantities',jsonb_build_object(line,'3.5'))));
    raise exception 'Dual-assigned reviewer approved both handoffs'; exception when sqlstate 'P4143' then null;
  end;
  perform public.transfer_command(f->'actor',pg_temp.transfer_input(f,'cancel',release));
  if (private.stock_snapshot(array[alt_stock])->0->>'reserved')::numeric<>0
    or (select quantity from private.demand_claims where id=line)<>0 then raise exception 'Cancellation failed to free both claims'; end if;
  begin
    perform public.transfer_command(f->'actor',pg_temp.transfer_input(f,'requestRelease',review,'{"quantity":"2"}'));
    raise exception 'Consumed suitability approval reused'; exception when sqlstate 'P4141' then null;
  end;
  if (select sum(quantity) from private.stock_movements where account_id in (direct_stock,alt_stock))<>20 then
    raise exception 'Approval changed physical stock';
  end if;
  if has_function_privilege('authenticated','public.transfer_command(jsonb,jsonb)','EXECUTE')
    or has_table_privilege('service_role','private.transfer_lines','SELECT')
    or has_function_privilege('service_role','private.transfer_demand_allowed(jsonb,uuid,uuid,jsonb)','EXECUTE') then
    raise exception 'Unrestricted access to transfer authority';
  end if;
end $$;

do $$
declare f jsonb:=pg_temp.transfer_fixture(); requester jsonb:=f->'actor'; source uuid:=(f->>'source')::uuid;
  target uuid:=(f->>'request')::uuid; release uuid; line uuid; session uuid:=gen_random_uuid(); credentials jsonb;
begin
  release:=(public.transfer_command(requester,pg_temp.transfer_input(f,'submit',null,jsonb_build_object('selections',
    jsonb_build_array(pg_temp.transfer_selection(f,'direct','4')))))->'ids'->>0)::uuid;
  select id into line from private.transfer_lines where transfer_id=release;
  delete from public.role_grants where user_id=(requester->>'userId')::uuid and role='Procurement';
  insert into public.role_grants values((requester->>'userId')::uuid,'Site Personnel');
  insert into public.project_assignments(user_id,project_id) values((requester->>'userId')::uuid,source);
  insert into auth.sessions(id,user_id,created_at,updated_at) values(session,(requester->>'userId')::uuid,now(),now());
  credentials:=private.login_preflight((requester->>'userId')||'@example.invalid');
  perform private.bind_session((requester->>'userId')::uuid,session,credentials->>'revision',credentials->>'credential');
  requester:=requester||jsonb_build_object('sessionId',session,'revision',credentials->>'revision','activeRole','Site Personnel');
  begin
    perform public.transfer_command(requester,pg_temp.transfer_input(f,'approveRelease',release,jsonb_build_object('quantities',jsonb_build_object(line,'4'))));
    raise exception 'Procurement submitter self-approved after role switch'; exception when sqlstate 'P4143' then null;
  end;
  update public.material_requests set correction_kind='documents',correction_state='editing' where id=target;
  begin
    perform public.transfer_command(f->'sourceActor',pg_temp.transfer_input(f,'approveRelease',release,jsonb_build_object('quantities',jsonb_build_object(line,'4'))));
    raise exception 'Approval during MRF correction'; exception when sqlstate 'P4141' then null;
  end;
  if (select quantity from private.stock_reservations where id=line)<>4 then raise exception 'Correction released stock'; end if;
  perform public.transfer_command(f->'sourceActor',pg_temp.transfer_input(f,'reject',release));
  if (select quantity from private.demand_claims where id=line)<>0 or (select quantity from private.stock_reservations where id=line)<>0 then
    raise exception 'Rejection during correction did not release both claims';
  end if;
end $$;
rollback;

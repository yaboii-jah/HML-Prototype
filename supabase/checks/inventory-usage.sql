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
rollback;

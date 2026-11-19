import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { transferJson as json, transferRace, transferResult } from './check-transfer-races.mjs';
import { inventoryCheckSql } from './helpers/inventory-check.mjs';

export async function checkInventoryRaces(context) {
  const { sql }=context;
  const race=transferRace(context);
  const definition=await inventoryCheckSql({ definitionsOnly:true });
  const read=query=>transferResult(sql,query);
  const value=async query=>(await sql(query)).output.trim();
  const inventory=(actor,command)=>`select public.inventory_command(${json(actor)},${json(command)});`;
  const trip=(actor,command)=>`select public.transfer_trip_command(${json(actor)},${json(command)});`;
  const create=(kind,project,lines,extras={})=>({ kind,projectId:project,operationId:randomUUID(),lines,reason:'Verified stock race action',...extras });
  const version=account=>value(`select version from private.stock_accounts where id='${account}';`);
  const tripInput=(f,type,id,extra={})=>read(definition+`select pg_temp.trip_input(${json(f)},'${type}','${id}',${json(extra)}); rollback;`);
  const schedule=(f,tripId)=>read(definition+`select pg_temp.trip_input(${json(f)},'scheduleTrip','${tripId}',
    pg_temp.trip_plan(${json(f)},'site-site','8')); rollback;`);
  const depart=()=>({ departure:{ at:new Date().toISOString(),carrier:'',driver:'',vehicle:'',reference:'',note:'' } });
  const balance=async account=>read(`select private.stock_snapshot(array['${account}'::uuid])->0;`);

  for (const isolation of ['read committed','repeatable read']) {
    const f=await read(definition+'select pg_temp.transfer_fixture(); commit;');
    const reserve=await read(definition+`select pg_temp.transfer_input(${json(f)},'submit',null,jsonb_build_object(
      'selections',jsonb_build_array(pg_temp.transfer_selection(${json(f)},'direct','6')))); rollback;`);
    const usage=create('usage',f.source,[{ accountId:f.direct,expectedVersion:await version(f.direct),quantity:'5' }]);
    await race(`select public.transfer_command(${json(f.actor)},${json(reserve)});`,
      inventory(f.sourceActor,usage),isolation);
    const held=await balance(f.direct);
    assert.equal(held.onHand,'10');
    assert.equal(held.reserved,'6');

    const shipping=await read(definition+`select pg_temp.trip_fixture()||jsonb_build_object('accounting',pg_temp.po_person()); commit;`);
    const tripId=randomUUID();
    await read(trip(shipping.logistics,await schedule(shipping,tripId)));
    const correction=create('correction',shipping.source,[{ accountId:shipping.direct,expectedVersion:await version(shipping.direct),quantity:'1' }],{direction:'remove'});
    await race(trip(shipping.logistics,await tripInput(shipping,'dispatchTrip',tripId,depart())),
      inventory(shipping.accounting,correction),isolation);
    assert.equal((await balance(shipping.direct)).onHand,'2');

    const receive=await tripInput(shipping,'receiveTrip',tripId,{
      arrivalAt:new Date().toISOString(),extraGoods:'',
      receiptLines:[{lineId:shipping.line,accepted:'8',missing:'0',rejected:'0',issue:''}],
    });
    const receipt=command=>`select public.transfer_receipt_command(${json(shipping.destinationActor)},${json(command)});`;
    await read(receipt(receive));
    const firstReceipt=await tripInput(shipping,'postTrip',tripId);
    const opening=create('opening',shipping.destination,[{ accountId:randomUUID(),description:'Requested cement',unit:'bag',quantity:'4' }]);
    // The approved MRF determines the receipt's destination unit label.
    opening.lines[0].unit=await value(`select requested_unit from private.transfer_lines where id='${shipping.line}';`);
    await race(receipt(firstReceipt),inventory(shipping.accounting,opening),isolation);
    const target=await value(`select id from private.stock_accounts where project_id='${shipping.destination}';`);
    assert.equal((await balance(target)).onHand,'8');
  }
}

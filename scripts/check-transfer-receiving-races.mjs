import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { transferJson as json, transferRace, transferResult } from './check-transfer-races.mjs';
import { transferReceivingCheckSql } from './helpers/transfer-receiving-check.mjs';

export async function checkTransferReceivingRaces(context) {
  const { sql } = context;
  const race = transferRace(context);
  const definition = await transferReceivingCheckSql({ definitionsOnly:true });
  const read = query => transferResult(sql,query);
  const value = async query => (await sql(query)).output.trim();
  const fixture = () => read(definition+`select pg_temp.trip_fixture()||jsonb_build_object('accounting',pg_temp.po_person(array['Accounting'])); commit;`);
  const input = (f,type,trip,extra={}) => read(definition+`select pg_temp.trip_input(${json(f)},'${type}','${trip}',${json(extra)}); rollback;`);
  const tripCall = (actor,c) => `select public.transfer_trip_command(${json(actor)},${json(c)});`;
  const receiptCall = (actor,c) => `select public.transfer_receipt_command(${json(actor)},${json(c)});`;
  const counts = (f,accepted,missing) => ({
    arrivalAt:new Date().toISOString(),extraGoods:'',
    receiptLines:[{ lineId:f.line,accepted,missing,rejected:'0',issue:'Confirmed missing material' }],
  });
  const depart = () => ({ departure:{ at:new Date().toISOString(),carrier:'',driver:'',vehicle:'',reference:'',note:'' } });
  const plan = (f,route,quantity,parentTripId) => ({ plan:{
    route,parentTripId,plannedDate:new Date(Date.now()+8*3600000).toISOString().slice(0,10),
    plannedTime:'',directions:'',lines:[{ lineId:f.line,quantity }],
  } });
  async function dispatch(f,route,trip) {
    await read(tripCall(f.logistics,await input(f,'scheduleTrip',trip,plan(f,route,'6'))));
    await read(tripCall(f.logistics,await input(f,'dispatchTrip',trip,depart())));
  }

  for (const isolation of ['read committed','repeatable read']) {
    const warehouse = await fixture(), parent = randomUUID(), child = randomUUID();
    await dispatch(warehouse,'site-warehouse',parent);
    await read(receiptCall(warehouse.actor,await input(warehouse,'receiveTrip',parent,counts(warehouse,'5','1'))));
    await race(tripCall(warehouse.logistics,await input(warehouse,'scheduleTrip',child,plan(warehouse,'warehouse-site','5',parent))),
      receiptCall(warehouse.actor,await input(warehouse,'recountTrip',parent,counts(warehouse,'4','2'))),isolation);
    assert.equal(await value(`select private.transfer_custody('${parent}')->0->>'available';`),'0');
    assert.equal(await value(`select revision from private.transfer_receipts where trip_id='${parent}';`),'1');

    const direct = await fixture(), trip = randomUUID();
    await dispatch(direct,'site-site',trip);
    const receipt = await read(receiptCall(direct.destinationActor,await input(direct,'receiveTrip',trip,counts(direct,'5','1'))));
    const replacement = { claimId:randomUUID(),itemId:direct.item,ownerId:randomUUID(),ownerLineId:randomUUID(),ownerKind:'award',quantity:'11' };
    const competing = `select private.demand_apply(${json(direct.actor)},'${randomUUID()}','${direct.request}',
      private.demand_snapshot('${direct.request}')->>'version',${json([replacement])},'Replacement for missing materials');`;
    await race(competing,receiptCall(direct.destinationActor,await input(direct,'recountTrip',trip,counts(direct,'6','0'))),isolation);
    assert.equal(await value(`select quantity from private.demand_claims where id='${direct.line}';`),'7');

    await race(receiptCall(direct.destinationActor,await input(direct,'postTrip',trip)),
      receiptCall(direct.destinationActor,await input(direct,'postTrip',trip)),isolation);
    assert.equal(await value(`select count(*) from private.stock_movements where source_id='${trip}';`),'2');
    assert.equal(await value(`select quantity from private.stock_movements where source_id='${trip}' and source_kind='transfer_receipt';`),'5');

    const version = await value(`select id from private.transfer_receipt_versions where trip_id='${trip}';`);
    const evidence = { name:'signed.pdf',mime:'application/pdf',size:12,sha256:'a'.repeat(64),kind:'signed' };
    const attach = meta => `select public.transfer_receipt_file(${json(direct.destinationActor)},null,'${version}','begin',null,${json(meta)});`;
    await read(attach(evidence));
    await sql(`update private.transfer_receipt_files set state='complete',drive_id='fixture-'||id,size=12,sha256=repeat('a',64)
      where version_id='${version}' and (current_evidence or id='${receipt.archiveFileId}');`);
    await race(attach({ ...evidence,name:'condition.pdf',kind:'supporting' }),
      receiptCall(direct.accounting,await input(direct,'approveTripEvidence',trip,{ receiptVersionId:version })),isolation);
    assert.equal(await value(`select review_state from private.transfer_receipts where trip_id='${trip}';`),'pending');
  }
}

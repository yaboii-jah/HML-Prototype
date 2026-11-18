import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { transferRace, transferJson as json, transferResult } from './check-transfer-races.mjs';
import { transferTripCheckSql } from './helpers/transfer-trip-check.mjs';

export async function checkTransferTripRaces(context) {
  const { sql }=context;
  const race=transferRace(context);
  const definition=await transferTripCheckSql({ definitionsOnly:true });
  const read=query=>transferResult(sql,query);
  const fresh=()=>read(definition+'select pg_temp.trip_fixture(); commit;');
  const input=(f,type,id,extra={})=>read(definition+
    `select pg_temp.trip_input(${json(f)},'${type}',${id?"'"+id+"'":'null'},${json(extra)}); rollback;`);
  const call=(actor,command)=>`select public.transfer_trip_command(${json(actor)},${json(command)});`;
  const plan=(f,quantity)=>({ plan:{ route:'site-warehouse',plannedDate:new Date(Date.now()+8*3600000).toISOString().slice(0,10),
    plannedTime:'',directions:'',lines:[{ lineId:f.line,quantity }] } });
  const departure=()=>({ departure:{ at:new Date().toISOString(),carrier:'',driver:'',vehicle:'',reference:'',note:'' } });
  const value=async query=>(await sql(query)).output.trim();
  const schedule=(f,id,quantity)=>input(f,'scheduleTrip',id,plan(f,quantity));
  const movements=id=>value(`select coalesce(sum(quantity),0)::text from private.stock_movements where source_id='${id}';`);
  for (const isolation of ['read committed','repeatable read']) {
    const f=await fresh(),first=randomUUID(),second=randomUUID();
    await race(call(f.logistics,await schedule(f,first,'5')),call(f.logistics,await schedule(f,second,'5')),isolation);
    const overschedule=await sql(call(f.logistics,await schedule(f,second,'5')),{allowFailure:true});
    assert.match(overschedule.diagnostics,/exceeds approved unbooked quantity/i);
    await read(call(f.logistics,await schedule(f,second,'3')));
    const dispatch=await input(f,'dispatchTrip',first,departure());
    const cancel=await input(f,'cancelRemaining',null);
    await race(call(f.logistics,dispatch),call(f.actor,cancel),isolation);
    await read(call(f.actor,await input(f,'cancelRemaining',null)));
    assert.equal(await movements(first),'-5');
    assert.equal(await movements(second),'0');
    assert.equal(await value(`select state from private.transfer_trips where id='${second}';`),'cancelled');
    assert.equal(await value(`select quantity from private.demand_claims where id='${f.line}';`),'5');

    const other=await fresh(),trip=randomUUID();
    await read(call(other.logistics,await schedule(other,trip,'8')));
    const revise=await input(other,'reviseTrip',trip,plan(other,'7'));
    await race(call(other.logistics,revise),call(other.logistics,await input(other,'dispatchTrip',trip,departure())),isolation);
    assert.equal(await movements(trip),'0');
    assert.equal(await value(`select quantity from private.transfer_trip_lines where trip_id='${trip}';`),'7');
    const revoke=`update private.account_guard set revision=revision+1 where id;
      delete from public.role_grants where user_id='${other.logistics.userId}' and role='Logistics';`;
    await race(revoke,call(other.logistics,await input(other,'dispatchTrip',trip,departure())),isolation);
    assert.equal(await movements(trip),'0');
  }
}

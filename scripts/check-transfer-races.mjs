import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { transferCheckSql } from './helpers/transfer-check.mjs';

export const transferJson=value=>"'"+JSON.stringify(value).replaceAll("'","''")+"'::jsonb";
export const transferResult=async (sql,query)=>JSON.parse((await sql(query)).output.split('\n').find(line=>line.startsWith('{')));

export function transferRace({ sql,database,environment }) {
  return async function race(first,second,isolation) {
    const child=spawn('docker',['exec','-i',database,'psql','-U','postgres','-d','postgres','-At','-v','ON_ERROR_STOP=1'],
      { env:environment,stdio:['pipe','pipe','pipe'] });
    let output='',diagnostics='',competitor;
    child.stdout.on('data',data=>output+=data); child.stderr.on('data',data=>diagnostics+=data);
    const completed=new Promise((resolve,reject)=>{child.on('close',resolve);child.on('error',reject);});
    try {
      child.stdin.write(`begin isolation level ${isolation}; ${first} select 'transfer-ready';\n`);
      for (let i=0;i<200&&!output.includes('transfer-ready');i++) await delay(25);
      assert.ok(output.includes('transfer-ready'),diagnostics);
      const name='transfer-race-'+randomUUID();
      competitor=sql(`set application_name='${name}'; begin isolation level ${isolation}; ${second} commit;`,{allowFailure:true});
      let blocked=false;
      for (let i=0;i<100&&!blocked;i++) {
        blocked=(await sql(`select exists(select 1 from pg_stat_activity where application_name='${name}' and wait_event_type='Lock');`)).output.trim()==='t';
        if (!blocked) await delay(25);
      }
      assert.ok(blocked,'Competing transfer transaction waits on a real lock');
      child.stdin.end('commit;\n');
      assert.equal(await completed,0,diagnostics);
      const result=await competitor;
      assert.notEqual(result.code,0);
      assert.match(result.diagnostics,/changed|unavailable|serialize|assignment|required|availability|already be allocated/i);
    } finally {
      if (!child.stdin.writableEnded) child.stdin.end('rollback;\n');
      await Promise.allSettled([completed,competitor]);
    }
  };
}

export async function checkTransferRaces(context) {
  const { sql }=context;
  const race=transferRace(context),json=transferJson;
  const read=query=>transferResult(sql,query);
  const definition=await transferCheckSql({ definitionsOnly:true });
  const fresh=()=>read(definition+'select pg_temp.transfer_fixture(); commit;');
  const input=(f,type,id,extra={})=>read(definition+`select pg_temp.transfer_input(${json(f)},'${type}',${id?"'"+id+"'":'null'},${json(extra)}); rollback;`);
  const call=(actor,command)=>`select public.transfer_command(${json(actor)},${json(command)});`;
  const selection=(f,quantity)=>({ itemId:f.item,stockId:f.direct,quantity,match:'direct',verified:true,explanation:'' });
  for (const isolation of ['read committed','repeatable read']) {
    const f=await fresh();
    const transfer=await input(f,'submit',null,{selections:[selection(f,'6')]});
    const claim={ claimId:randomUUID(),itemId:f.item,ownerId:randomUUID(),ownerLineId:randomUUID(),ownerKind:'award',quantity:'13' };
    const award=`select private.demand_apply(${json(f.actor)},'${randomUUID()}','${f.request}','0',${json([claim])},'Competing signed-off award');`;
    await race(award,call(f.actor,transfer),isolation);
    const retry=await sql(call(f.actor,await input(f,'submit',null,{selections:[selection(f,'6')]})),{allowFailure:true});
    assert.match(retry.diagnostics,/exceed requested/);

    const stockFixture=await fresh();
    const secondRequest=await read(definition+'select pg_temp.demand_fixture(); commit;');
    const competing={ ...stockFixture,...secondRequest };
    const first=await input(stockFixture,'submit',null,{selections:[selection(stockFixture,'6')]});
    const second=await input(competing,'submit',null,{selections:[selection(competing,'6')]});
    await race(call(stockFixture.actor,first),call(competing.actor,second),isolation);
    assert.equal((await sql(`select private.stock_snapshot(array['${stockFixture.direct}'::uuid])->0->>'reserved';`)).output.trim(),'6');
    for (const revoke of [false,true]) {
      const fixture=await fresh();
      const created=await read(call(fixture.actor,await input(fixture,'submit',null,{selections:[selection(fixture,'5')]})));
      const id=created.ids[0];
      const line=(await sql(`select id from private.transfer_lines where transfer_id='${id}';`)).output.trim();
      const approval=await input(fixture,'approveRelease',id,{quantities:{[line]:'4'}});
      const block=revoke
        ? `update private.account_guard set revision=revision+1 where id;
           delete from public.project_assignments where user_id='${fixture.sourceActor.userId}' and project_id='${fixture.source}';`
        : call(fixture.actor,await input(fixture,'cancel',id));
      await race(block,call(fixture.sourceActor,approval),isolation);
      assert.equal((await sql(`select status from private.transfers where id='${id}';`)).output.trim(),revoke?'release_pending':'cancelled');
    }
  }
}

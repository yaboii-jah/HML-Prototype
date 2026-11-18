import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { deliveryCheckSql } from './helpers/delivery-check.mjs';

/** Real competing PostgreSQL connections with observed lock waits, never timing-only races. */
export async function checkDeliveryRaces({ sql, database, environment }) {
  const definition = await deliveryCheckSql({ definitionsOnly:true });
  const json = value => "'" + JSON.stringify(value).replaceAll("'", "''") + "'::jsonb";
  const read = result => JSON.parse(result.output.split('\n').find(line => line.startsWith('{')));
  const fresh = async () => read(await sql(definition + 'select pg_temp.delivery_fixture(); commit;'));
  const input = async (f,type,id,extra={}) => read(await sql(definition + `select pg_temp.delivery_input(${json(f)},'${type}','${id}',${json(extra)}); rollback;`));
  const plan = async (f,amount,route='site') => read(await sql(definition + `select pg_temp.delivery_plan(${json(f)},'${amount}','${route}'); rollback;`));
  const departure = () => ({ at:new Date().toISOString(), carrier:'',driver:'',vehicle:'',reference:'',note:'' });
  const call = (f,c,actor=f.logistics) => `select public.delivery_command(${json(actor)},${json(c)});`;
  async function race(first,second,isolation) {
    const child = spawn('docker',['exec','-i',database,'psql','-U','postgres','-d','postgres','-At','-v','ON_ERROR_STOP=1'],
      { env:environment,windowsHide:true,stdio:['pipe','pipe','pipe'] });
    let output = '',diagnostics = '';
    child.stdout.on('data',chunk => { output += chunk; }); child.stderr.on('data',chunk => { diagnostics += chunk; });
    const done = new Promise((resolve,reject) => { child.on('error',reject); child.on('close',resolve); });
    let competing;
    try {
      child.stdin.write(`begin isolation level ${isolation}; ${first} select 'delivery-ready';\n`);
      for (let i=0;i<240 && !output.includes('delivery-ready');i++) await delay(25);
      assert.ok(output.includes('delivery-ready'),diagnostics);
      const name = 'delivery-race-'+randomUUID();
      competing = sql(`set application_name='${name}'; begin isolation level ${isolation}; ${second} commit;`,{ allowFailure:true });
      let blocked = false;
      for (let i=0;i<120 && !blocked;i++) {
        blocked = (await sql(`select exists(select 1 from pg_stat_activity where application_name='${name}' and wait_event_type='Lock');`)).output.trim()==='t';
        if (!blocked) await delay(25);
      }
      assert.ok(blocked,'Delivery competitor demonstrably waits on a lock');
      child.stdin.end('commit;\n'); assert.equal(await done,0,diagnostics);
      return await competing;
    } finally { if (child.exitCode===null) child.kill(); if (competing) await competing; }
  }
  for (const isolation of ['read committed','repeatable read']) {
    const f = await fresh(), a = randomUUID(), b = randomUUID();
    const first = await input(f,'schedule',a,{ plan:await plan(f,'4') });
    const second = await input(f,'schedule',b,{ plan:await plan(f,'4') });
    const result = await race(call(f,first),call(f,second),isolation);
    assert.notEqual(result.code,0,'Competing schedule cannot silently overwrite capacity');
    assert.match(result.diagnostics,/changed|concurrent update|serialize/i);
    const retry = await sql(call(f,await input(f,'schedule',b,{ plan:await plan(f,'4') })),{ allowFailure:true });
    assert.notEqual(retry.code,0); assert.match(retry.diagnostics,/Quantity already allocated/);
    for (const transition of ['cancel','revise','hold','revoke']) {
      const run = await fresh(), id = randomUUID();
      await sql(call(run,await input(run,'schedule',id,{ plan:await plan(run,'3') })));
      await sql(definition+`select pg_temp.delivery_clear(${json(run)}); commit;`);
      const dispatch = await input(run,'dispatch',id,{ departure:departure() });
      let change;
      if (transition==='hold') {
        const hold = read(await sql(definition+`select pg_temp.payment_input(${json(run)},'hold'); rollback;`));
        change = `select public.payment_command(${json(run.accountant)},${json(hold)});`;
      } else if (transition==='revoke') {
        change = `update private.account_guard set revision=revision+1 where id; update public.profiles set is_active=false where user_id='${run.logistics.userId}';`;
      } else change = call(run,await input(run,transition,id,transition==='revise' ? { plan:await plan(run,'2') } : {}));
      const outcome = await race(change,call(run,dispatch),isolation);
      assert.notEqual(outcome.code,0,`${transition} cannot race past dispatch guards`);
      assert.match(outcome.diagnostics,/changed|concurrent update|serialize|clearance|access required/i);
      assert.equal((await sql(`select state from private.deliveries where id='${id}';`)).output.trim(),transition==='cancel' ? 'cancelled' : 'scheduled');
    }
    const receiving = await fresh(), warehouse = randomUUID(), onward = randomUUID();
    const warehousePlan = await plan(receiving,'5','warehouse');
    const onwardPlan = await plan(receiving,'3');
    const lineId = warehousePlan.lines[0].lineId;
    const count = (accepted,missing) => ({
      arrivalAt:new Date().toISOString(),extraGoods:'',
      receiptLines:[{ lineId,accepted,missing,rejected:'0',issue:'Fixture receipt difference' }],
    });
    await sql(`update public.projects set location='Fixture location' where id='${receiving.project}';`);
    await sql(call(receiving,await input(receiving,'schedule',warehouse,{ plan:warehousePlan })));
    await sql(definition+`select pg_temp.delivery_clear(${json(receiving)}); commit;`);
    await sql(call(receiving,await input(receiving,'dispatch',warehouse,{ departure:departure() })));
    const receipts = await Promise.all([1,2].map(() => input(receiving,'receive',warehouse,count('5','0'))));
    const receiptRace = await race(...receipts.map(c => call(receiving,c,receiving.actor)),isolation);
    assert.match(receiptRace.diagnostics,/changed|concurrent update|serialize/i);
    const forward = await input(receiving,'scheduleForward',onward,{ parentDeliveryId:warehouse,plan:onwardPlan });
    const recount = await input(receiving,'recount',warehouse,count('2','3'));
    const custodyRace = await race(call(receiving,forward),call(receiving,recount,receiving.actor),isolation);
    assert.match(custodyRace.diagnostics,/changed|concurrent update|serialize/i);
    const checkedRecount = await sql(call(receiving,await input(receiving,'recount',warehouse,count('2','3')),receiving.actor),{ allowFailure:true });
    assert.match(checkedRecount.diagnostics,/scheduled onward loads/);
    await sql(call(receiving,await input(receiving,'dispatch',onward,{ departure:departure() })));
    const siteActor = read(await sql(definition+`select pg_temp.delivery_site_actor('${receiving.project}'); commit;`));
    await sql(call(receiving,await input(receiving,'receive',onward,count('3','0')),siteActor));
    const posts = await Promise.all([1,2].map(() => input(receiving,'post',onward)));
    const postRace = await race(...posts.map(c => call(receiving,c,siteActor)),isolation);
    assert.match(postRace.diagnostics,/changed|concurrent update|serialize/i);
    assert.equal((await sql(`select count(*) from private.stock_movements where source_id='${onward}';`)).output.trim(),'1');
  }
}

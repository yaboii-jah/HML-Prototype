import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { issuanceCheckSql } from './helpers/issuance-check.mjs';

export async function checkIssuanceRaces({ sql, database, environment }) {
  const definition = await issuanceCheckSql({ definitionsOnly: true });
  const json = value => "'" + JSON.stringify(value).replaceAll("'", "''") + "'::jsonb";
  const readJson = result => JSON.parse(result.output.split('\n').find(line => line.startsWith('{')));
  const fresh = async () => readJson(await sql(definition + 'select pg_temp.issuance_fixture(); commit;'));
  const input = async (f, action, extra = {}) => readJson(await sql(definition + `select pg_temp.issuance_input(${json(f)},'${action}',${json(extra)}); rollback;`));
  const proof = async f => readJson(await sql(`select public.issuance_prepare_files(${json(f.actor)},'${f.po}');`));
  const call = (f, command, files = null) => `select public.issuance_command(${json(f.actor)},${json(command)},${json(files)});`;
  const revoke = async f => {
    const c = readJson(await sql(definition + `select pg_temp.accounting_input(${json(f)},'revokePo'); rollback;`));
    return `select public.accounting_command(${json(f.accountant)},${json(c)});`;
  };
  const view = async f => readJson(await sql(`select private.purchasing_record_view('${f.po}');`));
  const guard = 'update private.account_guard set revision=revision+1 where id;';
  async function race(first, second, isolation) {
    const child = spawn('docker', ['exec', '-i', database, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'],
      { env: environment, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', diagnostics = '';
    child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { diagnostics += chunk; });
    const finished = new Promise((done, reject) => { child.on('error', reject); child.on('close', done); });
    let competing;
    try {
      child.stdin.write(`begin isolation level ${isolation}; ${first} select 'issuance-ready';\n`);
      for (let i = 0; i < 240 && !output.includes('issuance-ready'); i++) await delay(25);
      assert.ok(output.includes('issuance-ready'), diagnostics);
      const name = 'issuance-race-' + randomUUID();
      competing = sql(`set application_name='${name}'; begin isolation level ${isolation}; ${second} commit;`, { allowFailure: true });
      let blocked = false;
      for (let i = 0; i < 120 && !blocked; i++) {
        blocked = (await sql(`select exists(select 1 from pg_stat_activity where application_name='${name}' and wait_event_type='Lock');`)).output.trim() === 't';
        if (!blocked) await delay(25);
      }
      assert.ok(blocked, 'Issuance competitor demonstrably waits for its predecessor');
      child.stdin.end('commit;\n');
      assert.equal(await finished, 0, diagnostics);
      return await competing;
    } finally {
      if (!child.stdin.writableEnded) child.stdin.end('rollback;\n');
      await Promise.allSettled([finished, competing]);
    }
  }
  const stale = result => { assert.notEqual(result.code, 0); assert.match(result.diagnostics, /changed|could not serialize/); };
  for (const isolation of ['read committed', 'repeatable read']) {
    for (const prepareFirst of [true, false]) {
      const f = await fresh(), c = await input(f, 'prepareSend'), files = await proof(f), undo = await revoke(f);
      stale(await race(prepareFirst ? call(f, c, files) : undo, prepareFirst ? undo : call(f, c, files), isolation));
      const p = await view(f);
      assert.equal(p.issuance.status, prepareFirst ? 'prepared' : 'notIssued');
      assert.equal(Number(p.review.budget.committed), prepareFirst ? 672 : 0);
      if (prepareFirst) {
        const result = await sql(await revoke(f), { allowFailure: true });
        assert.notEqual(result.code, 0); assert.match(result.diagnostics, /prepared for sending/);
      }
    }
    for (const sendFirst of [true, false]) {
      const f = await fresh();
      await sql(call(f, await input(f, 'prepareSend'), await proof(f)));
      const details = readJson(await sql(definition + 'select pg_temp.sending_details(); rollback;'));
      const sent = call(f, await input(f, 'confirmSent', { details }));
      const cancelled = call(f, await input(f, 'cancelSend', { notSent: true }));
      stale(await race(sendFirst ? sent : cancelled, sendFirst ? cancelled : sent, isolation));
      const p = await view(f);
      assert.equal(p.issuance.status, sendFirst ? 'issued' : 'notIssued');
      assert.equal(p.issuance.cancellations.length, sendFirst ? 0 : 1);
      assert.equal(Number(p.review.budget.committed), 672);
    }
    let f = await fresh(), c = await input(f, 'prepareSend'), files = await proof(f);
    let result = await race(call(f, c, files), call(f, c, files), isolation);
    if (result.code) assert.match(result.diagnostics, /could not serialize/);
    await sql(call(f, c));
    assert.equal((await sql(`select count(*) from private.po_send_preparations where po_id='${f.po}';`)).output.trim(), '1');
    assert.equal((await sql(`select count(*) from private.audit_events where request_id='${c.requestId}';`)).output.trim(), '1');
    const cancel = call(f, await input(f, 'cancelSend', { notSent: true }));
    result = await race(cancel, await revoke(f), isolation); stale(result);
    await sql(await revoke(f));
    assert.equal(Number((await view(f)).review.budget.committed), 0);

    for (const loss of ['supplier', 'mrf', 'session', 'profile']) {
      for (const lossFirst of [true, false]) {
        f = await fresh();
        await sql(call(f, await input(f, 'prepareSend'), await proof(f)));
        const details = readJson(await sql(definition + 'select pg_temp.sending_details(); rollback;'));
        c = await input(f, 'confirmSent', { details });
        const change = guard + (loss === 'supplier' ? `update private.suppliers set is_active=false where id='${f.supplier}';`
          : loss === 'mrf' ? `update public.material_requests set correction_kind='documents',correction_state='editing' where id='${f.request}';`
            : loss === 'session' ? `delete from auth.sessions where id='${f.actor.sessionId}';`
              : `update public.profiles set is_active=false where user_id='${f.actor.userId}';`);
        result = await race(lossFirst ? change : call(f, c), lossFirst ? call(f, c) : change, isolation);
        if (lossFirst && ['session', 'profile'].includes(loss)) {
          assert.notEqual(result.code, 0); assert.match(result.diagnostics, /access|session|could not serialize/i);
          assert.equal((await view(f)).issuance.status, 'prepared');
        } else {
          if (result.code) {
            assert.match(result.diagnostics, /changed|could not serialize/);
            await sql(lossFirst ? call(f, await input(f, 'confirmSent', { details })) : change);
          }
          const p = await view(f);
          assert.equal(p.issuance.status, 'issued');
          if (lossFirst && ['supplier', 'mrf'].includes(loss)) assert.ok(p.issuance.issuance.blockersAtRecording.length);
        }
        assert.equal(Number((await view(f)).review.budget.committed), 672);
      }
    }
  }
}

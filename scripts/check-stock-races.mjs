import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

export async function checkStockRaces({ sql, database, environment }) {
  const definition = (await readFile('supabase/checks/stock.sql', 'utf8')).split('-- Assertions')[0];
  const json = value => "'" + JSON.stringify(value).replaceAll("'", "''") + "'::jsonb";
  const account = (f, version, id = f.account) => ({ accountId: id, projectId: f.project, description: 'Cement', unit: 'bag', expectedVersion: version });
  const posting = (f, quantity, kind = 'receipt', reservationId = null) => ({ accountId: f.account, quantity, postingKind: kind, reservationId,
    sourceKind: { receipt: 'purchase_receipt', dispatch: 'transfer_trip', usage: 'usage_entry', adjustment: 'stock_adjustment' }[kind], sourceId: randomUUID(), sourceLineId: randomUUID() });
  const hold = (f, quantity) => ({ reservationId: randomUUID(), accountId: f.account, ownerKind: 'transfer', ownerId: randomUUID(), ownerLineId: randomUUID(), quantity });
  const apply = (f, version, postings = [], reservations = [], operation = randomUUID()) =>
    `select private.stock_apply(${json(f.actor)},'${operation}',${json([account(f, version)])},${json(postings)},${json(reservations)},'Synthetic owning transition');`;
  const balance = async f => JSON.parse((await sql(`select private.stock_snapshot(array['${f.account}'::uuid]);`)).output.trim())[0];
  async function fixture(seed = true) {
    const f = JSON.parse((await sql(definition + 'select pg_temp.stock_fixture(); commit;')).output.split('\n').find(line => line.startsWith('{')));
    f.account = randomUUID();
    if (seed) await sql(apply(f, '0', [posting(f, '10')]));
    return f;
  }
  async function race(firstSql, secondSql, isolation) {
    const child = spawn('docker', ['exec', '-i', database, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], { env: environment, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', diagnostics = '';
    child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { diagnostics += chunk; });
    const finished = new Promise((done, reject) => { child.on('error', reject); child.on('close', code => done(code)); });
    let second;
    try {
      child.stdin.write(`begin isolation level ${isolation}; ${firstSql} select 'stock-ready';\n`);
      for (let i = 0; i < 200 && !output.includes('stock-ready'); i++) await delay(25);
      assert.ok(output.includes('stock-ready'), diagnostics);
      const name = `stock-race-${randomUUID()}`;
      second = sql(`set application_name='${name}'; begin isolation level ${isolation}; ${secondSql} commit;`, { allowFailure: true });
      let blocked = false;
      for (let i = 0; i < 100 && !blocked; i++) {
        blocked = (await sql(`select exists(select 1 from pg_stat_activity where application_name='${name}' and wait_event_type='Lock');`)).output.trim() === 't';
        if (!blocked) await delay(25);
      }
      assert.ok(blocked, 'Competing stock transaction demonstrably waits');
      child.stdin.end('commit;\n'); assert.equal(await finished, 0, diagnostics); return await second;
    } finally {
      if (!child.stdin.writableEnded) child.stdin.end('rollback;\n');
      await Promise.allSettled([finished, second]);
    }
  }
  for (const isolation of ['read committed', 'repeatable read']) {
    for (const firstKind of ['reservation', 'usage']) {
      const f = await fixture(), a = hold(f, '6'), b = hold(f, '6');
      const first = firstKind === 'usage' ? apply(f, '1', [posting(f, '-6', 'usage')]) : apply(f, '1', [], [a]);
      const denied = await race(first, apply(f, '1', [], [b]), isolation);
      assert.notEqual(denied.code, 0); assert.match(denied.diagnostics, /Stock changed|could not serialize/);
      const retry = await sql(apply(f, '2', [], [b]), { allowFailure: true });
      assert.notEqual(retry.code, 0); assert.match(retry.diagnostics, /below reservations/);
      assert.equal((await balance(f)).available, '4');
    }
    for (const dispatchFirst of [true, false]) {
      const f = await fixture(), reservation = hold(f, '6');
      await sql(apply(f, '1', [], [reservation]));
      const dispatch = version => apply(f, version, [posting(f, '-6', 'dispatch', reservation.reservationId)], [{ ...reservation, quantity: '0' }]);
      const usage = version => apply(f, version, [posting(f, dispatchFirst ? '-5' : '-4', 'usage')]);
      const denied = await race(dispatchFirst ? dispatch('2') : usage('2'), dispatchFirst ? usage('2') : dispatch('2'), isolation);
      assert.notEqual(denied.code, 0); assert.match(denied.diagnostics, /Stock changed|could not serialize/);
      const retry = await sql(dispatchFirst ? usage('3') : dispatch('3'), { allowFailure: true });
      if (dispatchFirst) { assert.notEqual(retry.code, 0); assert.match(retry.diagnostics, /negative|reservations/); }
      else { assert.equal(retry.code, 0); assert.equal((await balance(f)).onHand, '0'); }
    }
    // A fresh transport UUID cannot repost the same business source.
    const f = await fixture(), source = posting(f, '1');
    const replay = await race(apply(f, '1', [source]), apply(f, '1', [source]), isolation);
    if (replay.code !== 0) assert.match(replay.diagnostics, /could not serialize/);
    await sql(apply(f, '1', [source]));
    assert.equal((await balance(f)).onHand, '11');
    assert.equal((await sql(`select count(*) from private.stock_movements where source_id='${source.sourceId}';`)).output.trim(), '1');
    for (const revokeKind of ['profile', 'session', 'assignment']) for (const revokeFirst of [true, false]) {
      const c = await fixture(); c.actor = c.siteActor;
      const action = apply(c, '1', [posting(c, '-1', 'usage')]);
      const revoke = revokeKind === 'session' ? `delete from auth.sessions where id='${c.actor.sessionId}';`
        : `update private.account_guard set revision=revision+1 where id; ` + (revokeKind === 'profile'
          ? `update public.profiles set is_active=false where user_id='${c.actor.userId}';`
          : `delete from public.project_assignments where user_id='${c.actor.userId}' and project_id='${c.project}';`);
      const outcome = await race(revokeFirst ? revoke : action, revokeFirst ? action : revoke, isolation);
      if (revokeFirst) {
        assert.notEqual(outcome.code, 0); assert.match(outcome.diagnostics, /access required|could not serialize/); assert.equal((await balance(c)).onHand, '10');
      } else {
        if (outcome.code !== 0) { assert.match(outcome.diagnostics, /could not serialize/); await sql(revoke); }
        assert.equal((await balance(c)).onHand, '9');
      }
    }
    for (const stockFirst of [true, false]) {
      const c = await fixture(false); const create = apply(c, '0', [posting(c, '1')]);
      const deletion = `update private.account_guard set revision=revision+1 where id; delete from public.projects where id='${c.project}';`;
      const outcome = await race(stockFirst ? create : deletion, stockFirst ? deletion : create, isolation);
      assert.notEqual(outcome.code, 0); assert.match(outcome.diagnostics, /foreign key|access required|could not serialize/);
    }
  }
  // Joint atomicity uses a genuinely authorized Procurement actor. Source-Site
  // access to destination demand remains the future 4.14 checked adapter.
  for (const isolation of ['read committed', 'repeatable read']) {
  const demandDefinition = (await readFile('supabase/checks/demand.sql', 'utf8')).split('-- Assertions')[0];
  const d = JSON.parse((await sql(demandDefinition + 'select pg_temp.demand_fixture(); commit;')).output.split('\n').find(line => line.startsWith('{')));
  const f = await fixture(); f.actor = d.actor;
  const reservation = hold(f, '6');
  const demandClaim = { claimId: randomUUID(), itemId: d.item, ownerKind: 'transfer', ownerId: reservation.ownerId, ownerLineId: reservation.ownerLineId, quantity: '6' };
  const demand = quantity => `select private.demand_apply(${json(d.actor)},'${randomUUID()}','${d.request}','0',${json([{ ...demandClaim, quantity }])},'Joint sourcing transition');`;
  const lock = `update private.account_guard set revision=revision+1 where id; select private.project_actor(${json(d.actor)},false); select id from auth.sessions where id='${d.actor.sessionId}' for share; select id from public.projects where id in('${f.project}',(select project_id from public.material_requests where id='${d.request}')) order by id for update; select id from public.material_requests where id='${d.request}' for update;`;
  for (const stockFails of [true, false]) {
    const stock = apply(f, '1', [], [{ ...reservation, quantity: stockFails ? '11' : '6' }]);
    const failed = await sql(`begin isolation level ${isolation}; ${lock} ${stockFails ? demand('6') + stock : stock + demand('19')} commit;`, { allowFailure: true });
    assert.notEqual(failed.code, 0); assert.match(failed.diagnostics, /below reservations|exceed requested/);
    assert.equal((await balance(f)).reserved, '0');
    assert.equal((await sql(`select private.demand_snapshot('${d.request}')->>'version';`)).output.trim(), '0');
  }
  await sql(`begin isolation level ${isolation}; ${lock} ${demand('6')} ${apply(f, '1', [], [reservation])} commit;`);
  assert.equal((await balance(f)).reserved, '6');
  assert.equal((await sql(`select private.demand_snapshot('${d.request}')->>'version';`)).output.trim(), '1');
  }
}

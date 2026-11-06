import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

export async function checkDemandRaces({ sql, database, environment }) {
  const definition = (await readFile('supabase/checks/demand.sql', 'utf8')).split('-- Assertions')[0];
  const json = value => "'" + JSON.stringify(value).replaceAll("'", "''") + "'::jsonb";
  const fixture = async () => JSON.parse((await sql(definition + 'select pg_temp.demand_fixture(); commit;')).output.split('\n').find(line => line.startsWith('{')));
  const claim = (f, kind, quantity) => ({ claimId: randomUUID(), itemId: f.item, ownerKind: kind, ownerId: randomUUID(), ownerLineId: randomUUID(), quantity });
  const apply = (f, version, changes, operation = randomUUID()) => `select private.demand_apply(${json(f.actor)},'${operation}','${f.request}','${version}',${json(changes)},'Synthetic owning transition');`;
  const snapshot = async f => JSON.parse((await sql(`select private.demand_snapshot('${f.request}');`)).output.trim());
  async function race(firstSql, secondSql, isolation) {
    const child = spawn('docker', ['exec', '-i', database, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], { env: environment, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', diagnostics = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { diagnostics += chunk; });
    const finished = new Promise((done, reject) => { child.on('error', reject); child.on('close', code => done(code)); });
    let second;
    try {
      child.stdin.write(`begin isolation level ${isolation}; ${firstSql} select 'demand-ready';\n`);
      for (let i = 0; i < 200 && !output.includes('demand-ready'); i++) await delay(25);
      assert.ok(output.includes('demand-ready'), diagnostics);
      const name = `demand-race-${randomUUID()}`;
      second = sql(`set application_name='${name}'; begin isolation level ${isolation}; ${secondSql} commit;`, { allowFailure: true });
      let blocked = false;
      for (let i = 0; i < 100 && !blocked; i++) {
        blocked = (await sql(`select exists(select 1 from pg_stat_activity where application_name='${name}' and wait_event_type='Lock');`)).output.trim() === 't';
        if (!blocked) await delay(25);
      }
      assert.ok(blocked, 'Competing demand transaction demonstrably waits');
      child.stdin.end('commit;\n');
      assert.equal(await finished, 0, diagnostics);
      return await second;
    } finally {
      if (!child.stdin.writableEnded) child.stdin.end('rollback;\n');
      await Promise.allSettled([finished, second]);
    }
  }
  for (const isolation of ['read committed', 'repeatable read']) {
    for (const [firstKind, secondKind] of [['award', 'suitability'], ['award', 'transfer'], ['purchase_order', 'transfer']]) {
      const f = await fixture(), a = claim(f, firstKind, '12'), b = claim(f, secondKind, '8');
      const result = await race(apply(f, '0', [a]), apply(f, '0', [b]), isolation);
      assert.notEqual(result.code, 0);
      assert.match(result.diagnostics, /Demand changed|could not serialize/);
      const excess = await sql(apply(f, '1', [b]), { allowFailure: true });
      assert.notEqual(excess.code, 0);
      assert.match(excess.diagnostics, /exceed requested/);
      await sql(apply(f, '1', [{ ...b, quantity: '6' }]));
      assert.equal((await snapshot(f)).requirements[0].unassigned, '0');
    }
    const f = await fixture(), a = claim(f, 'award', '12'), operation = randomUUID();
    const command = apply(f, '0', [a], operation);
    const retry = await race(command, command, isolation);
    if (retry.code !== 0) assert.match(retry.diagnostics, /could not serialize/);
    await sql(command);
    assert.equal((await sql(`select count(*) from private.demand_events where operation_id='${operation}';`)).output.trim(), '1');
    const po = claim(f, 'purchase_order', '12'), b = claim(f, 'transfer', '7');
    const converted = await race(apply(f, '1', [po, { ...a, quantity: '0' }]), apply(f, '1', [b]), isolation);
    assert.notEqual(converted.code, 0);
    assert.match(converted.diagnostics, /Demand changed|could not serialize/);
    assert.equal((await snapshot(f)).requirements[0].ordered, '12');
    const excess = await sql(apply(f, '2', [b]), { allowFailure: true });
    assert.notEqual(excess.code, 0);
    assert.match(excess.diagnostics, /exceed requested/);
    for (const demandFirst of [true, false]) {
      const c = await fixture();
      const acquisition = apply(c, '0', [claim(c, 'suitability', '1')]);
      const correction = `select public.request_command(${json(c.actor)},${json({ type: 'openCorrection', requestId: randomUUID(), mrfId: c.request, expectedVersion: '1', reason: 'Correct source document' })});`;
      const result = await race(demandFirst ? acquisition : correction, demandFirst ? correction : acquisition, isolation);
      if (demandFirst) {
        if (result.code !== 0) { assert.match(result.diagnostics, /could not serialize/); await sql(correction); }
        assert.equal((await sql(`select correction_kind from public.material_requests where id='${c.request}';`)).output.trim(), 'documents');
        assert.equal((await snapshot(c)).requirements[0].suitability, '1');
      } else {
        assert.notEqual(result.code, 0);
        assert.match(result.diagnostics, /approved archive|required|could not serialize/);
        assert.equal((await snapshot(c)).version, '0');
      }
    }
    for (const revokeKind of ['profile', 'session']) for (const revokeFirst of [true, false]) {
      const c = await fixture();
      const acquisition = apply(c, '0', [claim(c, 'transfer', '1')]);
      const revocation = revokeKind === 'session' ? `delete from auth.sessions where id='${c.actor.sessionId}';`
        : `update private.account_guard set revision=revision+1 where id; update public.profiles set is_active=false where user_id='${c.actor.userId}';`;
      const result = await race(revokeFirst ? revocation : acquisition, revokeFirst ? acquisition : revocation, isolation);
      if (revokeFirst) {
        assert.notEqual(result.code, 0);
        assert.match(result.diagnostics, /access required|could not serialize/);
        assert.equal((await snapshot(c)).version, '0');
      } else {
        if (result.code !== 0) { assert.match(result.diagnostics, /could not serialize/); await sql(revocation); }
        assert.equal((await snapshot(c)).requirements[0].transfers, '1');
      }
    }
  }
}

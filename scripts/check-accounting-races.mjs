import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { accountingCheckSql } from './helpers/accounting-check.mjs';

export async function checkAccountingRaces({ sql, database, environment }) {
  const definition = await accountingCheckSql({ definitionsOnly: true });
  const json = (value) => "'" + JSON.stringify(value).replaceAll("'", "''") + "'::jsonb";
  const fresh = async (shared = null) => {
    const result = await sql(definition + `select pg_temp.accounting_fixture(${shared ? json(shared) : 'null'}); commit;`);
    return JSON.parse(result.output.split('\n').find((line) => line.startsWith('{')));
  };
  const input = async (f, kind, extra = {}) => {
    const result = await sql(definition + `select pg_temp.accounting_input(${json(f)},'${kind}',${json(extra)}); rollback;`);
    return JSON.parse(result.output.split('\n').find((line) => line.startsWith('{')));
  };
  const act = (f, kind) => sql(definition + `select pg_temp.accounting_action(${json(f)},'${kind}'); commit;`);
  const call = (f, command) => `select public.accounting_command(${json(f.accountant)},${json(command)});`;
  const committed = async (f) => (await sql(`select private.scope_committed('${f.scope}')::text;`)).output.trim();
  const guard = 'update private.account_guard set revision=revision+1 where id; ';
  async function race(first, second, isolation) {
    const child = spawn('docker', ['exec', '-i', database, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'],
      { env: environment, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', diagnostics = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { diagnostics += chunk; });
    const finished = new Promise((done, reject) => { child.on('error', reject); child.on('close', done); });
    let competing;
    try {
      child.stdin.write(`begin isolation level ${isolation}; ${first} select 'accounting-ready';\n`);
      for (let index = 0; index < 240 && !output.includes('accounting-ready'); index++) await delay(25);
      assert.ok(output.includes('accounting-ready'), diagnostics);
      const name = 'accounting-race-' + randomUUID();
      competing = sql(`set application_name='${name}'; begin isolation level ${isolation}; ${second} commit;`, { allowFailure: true });
      let blocked = false;
      for (let index = 0; index < 120 && !blocked; index++) {
        blocked = (await sql(`select exists(select 1 from pg_stat_activity where application_name='${name}' and wait_event_type='Lock');`)).output.trim() === 't';
        if (!blocked) await delay(25);
      }
      assert.ok(blocked, 'Accounting competitor demonstrably waits for its predecessor');
      child.stdin.end('commit;\n');
      assert.equal(await finished, 0, diagnostics);
      return await competing;
    } finally {
      if (!child.stdin.writableEnded) child.stdin.end('rollback;\n');
      await Promise.allSettled([finished, competing]);
    }
  }
  for (const isolation of ['read committed', 'repeatable read']) {
    let f = await fresh(), another = await fresh(f);
    await act(f, 'submitPo'); await act(another, 'submitPo');
    let first = await input(f, 'approvePo'), second = await input(another, 'approvePo');
    let result = await race(call(f, first), call(another, second), isolation);
    assert.notEqual(result.code, 0);
    assert.match(result.diagnostics, /changed|could not serialize/);
    assert.equal(Number(await committed(f)), 672);
    result = await sql(call(another, await input(another, 'approvePo')), { allowFailure: true });
    assert.notEqual(result.code, 0);
    assert.match(result.diagnostics, /Insufficient uncommitted/);

    for (const approvalFirst of [true, false]) {
      f = await fresh(); await act(f, 'submitPo'); first = await input(f, 'approvePo');
      const reduction = guard + `update public.scope_budgets set amount=650 where scope_id='${f.scope}';`;
      result = await race(approvalFirst ? call(f, first) : reduction, approvalFirst ? reduction : call(f, first), isolation);
      assert.notEqual(result.code, 0);
      assert.match(result.diagnostics, /committed|changed|could not serialize/);
      assert.equal(Number(await committed(f)), approvalFirst ? 672 : 0);
    }

    f = await fresh(); await act(f, 'submitPo'); first = await input(f, 'approvePo');
    result = await race(call(f, first), call(f, first), isolation);
    if (result.code !== 0) assert.match(result.diagnostics, /could not serialize/);
    await sql(call(f, first));
    assert.equal((await sql(`select count(*) from private.po_approvals where po_id='${f.po}';`)).output.trim(), '1');
    assert.equal((await sql(`select count(*) from private.audit_events where request_id='${first.requestId}';`)).output.trim(), '1');
    assert.equal(Number(await committed(f)), 672);

    // Revoking one PO frees money without freeing its material demand. A stale
    // competing review must still refresh before consuming the released money.
    another = await fresh(f); await act(another, 'submitPo');
    second = await input(another, 'approvePo');
    result = await race(call(f, await input(f, 'revokePo')), call(another, second), isolation);
    assert.notEqual(result.code, 0);
    await sql(call(another, await input(another, 'approvePo')));
    assert.equal(Number(await committed(f)), 672);
    assert.equal((await sql(`select quantity::text from private.demand_claims where owner_id='${f.po}' and quantity>0;`)).output.trim(), '6');

    for (const loss of ['supplier', 'withdrawal', 'profile', 'session', 'mrf']) {
      for (const lossFirst of [true, false]) {
        f = await fresh(); await act(f, 'submitPo'); first = await input(f, 'approvePo');
        const change = loss === 'session' ? `delete from auth.sessions where id='${f.accountant.sessionId}';`
          : guard + (loss === 'supplier' ? `update private.suppliers set is_active=false where id='${f.supplier}';`
            : loss === 'withdrawal' ? `insert into private.quotation_revision_events(revision_id,kind,actor,reason) values('${f.revision}','withdraw',${json(f.actor)},'Observed source withdrawal');`
              : loss === 'profile' ? `update public.profiles set is_active=false where user_id='${f.accountant.userId}';`
                : `update public.material_requests set correction_kind='documents',correction_state='editing' where id='${f.request}';`);
        result = await race(lossFirst ? change : call(f, first), lossFirst ? call(f, first) : change, isolation);
        if (lossFirst) {
          assert.notEqual(result.code, 0);
          assert.match(result.diagnostics, /changed|review|Review|access|Current session|could not serialize/);
        } else if (result.code !== 0) {
          assert.match(result.diagnostics, /could not serialize/);
          await sql(change);
        }
        assert.equal(Number(await committed(f)), lossFirst ? 0 : 672);
      }
    }
    for (const archiveFirst of [true, false]) {
      f = await fresh(); await act(f, 'submitPo'); await act(f, 'approvePo');
      const job = (await sql(`select id::text from private.po_archive_jobs where approval_id=(select approval_id from private.purchasing_records where id='${f.po}');`)).output.trim();
      const claimed = JSON.parse((await sql(`select public.po_archive_worker('${job}','claim');`)).output.trim());
      const complete = `select public.po_archive_worker('${job}','checkpoint','${claimed.lease}',${json({ fileId: 'synthetic-owned-po-' + job, sha256: 'a'.repeat(64), size: 10, verified: true })}); select public.po_archive_worker('${job}','complete','${claimed.lease}');`;
      const revoke = call(f, await input(f, 'revokePo'));
      result = await race(archiveFirst ? complete : revoke, archiveFirst ? revoke : complete, isolation);
      if (result.code !== 0) {
        assert.match(result.diagnostics, /could not serialize/);
        await sql(archiveFirst ? call(f, await input(f, 'revokePo')) : complete);
      }
      assert.equal(Number(await committed(f)), 0);
      assert.equal((await sql(`select po_status from private.purchasing_records where id='${f.po}';`)).output.trim(), 'returned');
      assert.equal((await sql(`select count(*) from private.po_archives where job_id='${job}';`)).output.trim(), '1');
    }
  }
}

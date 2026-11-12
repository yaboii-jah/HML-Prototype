import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { paymentCheckSql } from './helpers/payment-check.mjs';

/** Observed-lock payment coordination/settlement races at both isolation levels. */
export async function checkPaymentRaces({ sql, database, environment }) {
  const definition = await paymentCheckSql({ definitionsOnly: true });
  const json = value => "'" + JSON.stringify(value).replaceAll("'", "''") + "'::jsonb";
  const readJson = result => JSON.parse(result.output.split('\n').find(line => line.startsWith('{')));
  const hash = () => randomUUID().replaceAll('-', '').repeat(2);
  const tag = randomUUID().slice(0, 8);
  const fresh = async () => readJson(await sql(definition + 'select pg_temp.payment_fixture(); commit;'));
  const totals = async f => readJson(await sql(`select jsonb_build_object('gross',(calculation->>'gross')::numeric,'net',(calculation->>'net')::numeric) from private.purchasing_records where id='${f.po}';`));
  const input = async (f, kind, extra = {}) => readJson(await sql(definition + `select pg_temp.payment_input(${json(f)},'${kind}',${json(extra)}); rollback;`));
  const draft = async (f, amount, reference) => {
    const unique = `${reference}-${randomUUID().slice(0, 8)}`;
    const result = await sql(definition + `select pg_temp.payment_draft(${json(f)},'${amount}','${unique}'); commit;`);
    return result.output.split('\n').map(line => line.trim()).find(line => /^[0-9a-f-]{36}$/.test(line));
  };
  const proof = async (f, draftId) => {
    const result = await sql(definition + `select pg_temp.payment_proof(${json(f)},'${draftId}','${hash()}'); commit;`);
    return result.output.split('\n').map(line => line.trim()).find(line => /^[0-9a-f-]{36}$/.test(line));
  };
  const call = (f, command, who = null) => `select public.payment_command(${json(who ?? f.accountant)},${json(command)});`;
  const view = async f => readJson(await sql(`select private.payment_view('${f.po}');`));
  const position = async f => readJson(await sql(`select jsonb_build_object('paid',private.payment_paid('${f.po}'),'spent',private.scope_spent('${f.scope}'),'committed',private.scope_committed('${f.scope}'),'uncommitted',private.scope_uncommitted('${f.scope}'));`));
  const supplierStatus = async (f, active) => {
    const version = (await sql(`select version::text from private.suppliers where id='${f.supplier}';`)).output.trim();
    return `select public.supplier_command(${json(f.actor)},${json({ type: 'setSupplierStatus', requestId: randomUUID(), supplierId: f.supplier, expectedVersion: version, active, reason: 'Observed payment source change' })});`;
  };
  async function race(first, second, isolation, ready) {
    const child = spawn('docker', ['exec', '-i', database, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'],
      { env: environment, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', diagnostics = '';
    child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { diagnostics += chunk; });
    const finished = new Promise((done, reject) => { child.on('error', reject); child.on('close', done); });
    let competing;
    try {
      child.stdin.write(`begin isolation level ${isolation}; ${first} select '${ready}';\n`);
      for (let i = 0; i < 240 && !output.includes(ready); i++) await delay(25);
      assert.ok(output.includes(ready), diagnostics);
      const name = 'payment-race-' + randomUUID();
      competing = sql(`set application_name='${name}'; begin isolation level ${isolation}; ${second} commit;`, { allowFailure: true });
      let blocked = false;
      for (let i = 0; i < 120 && !blocked; i++) {
        blocked = (await sql(`select exists(select 1 from pg_stat_activity where application_name='${name}' and wait_event_type='Lock');`)).output.trim() === 't';
        if (!blocked) await delay(25);
      }
      assert.ok(blocked, 'Payment competitor demonstrably waits for its predecessor');
      child.stdin.end('commit;\n');
      assert.equal(await finished, 0, diagnostics);
      return await competing;
    } finally {
      if (!child.stdin.writableEnded) child.stdin.end('rollback;\n');
      await Promise.allSettled([finished, competing]);
    }
  }
  const stale = result => {
    assert.notEqual(result.code, 0);
    assert.match(result.diagnostics, /changed|could not serialize/);
  };
  const settled = async (f, expected) => {
    const values = await position(f);
    assert.equal(Number(values.paid), expected.paid);
    assert.equal(Number(values.spent), expected.spent);
    assert.equal(Number(values.committed), expected.committed);
    assert.equal(Number(values.uncommitted), expected.uncommitted);
  };

  for (const isolation of ['read committed', 'repeatable read']) {
    const f = await fresh();
    const amount = await totals(f);
    assert.equal(Number(amount.net), 666);
    assert.equal(Number(amount.gross), 672);

    // Competing verifications share one expected version. Exactly one settles; the
    // loser must refresh and its proportional gross is added only once.
    for (const firstIsOne of [true, false]) {
      const run = await fresh();
      const one = await draft(run, '333.00', `PAY-A-${firstIsOne}-${tag}`);
      await proof(run, one);
      const two = await draft(run, '333.00', `PAY-B-${firstIsOne}-${tag}`);
      await proof(run, two);
      const first = await input(run, 'verify', { draftId: one, evidenceReviewed: true });
      const second = await input(run, 'verify', { draftId: two, evidenceReviewed: true });
      const result = await race(call(run, firstIsOne ? first : second), call(run, firstIsOne ? second : first), isolation, 'payment-ready');
      stale(result);
      await settled(run, { paid: 333, spent: 336, committed: 336, uncommitted: 328 });
      await sql(call(run, await input(run, 'verify', { draftId: firstIsOne ? two : one, evidenceReviewed: true })));
      await settled(run, { paid: 666, spent: 672, committed: 0, uncommitted: 328 });
      const rows = JSON.parse((await sql(`select jsonb_agg(amount order by amount) from private.payment_spending where po_id='${run.po}';`)).output.trim());
      assert.deepEqual(rows.map(Number), [336, 336]);
      const saved = await view(run);
      assert.equal(saved.verifications.length, 2);
      assert.equal(saved.cleared, false);
    }

    // Clearance competes with reversal. Whichever wins, a later reversal or the
    // missing upfront balance leaves the PO uncleared and its spending released.
    for (const clearFirst of [true, false]) {
      const run = await fresh();
      const payment = await draft(run, '666.00', `PAY-REV-${clearFirst}-${tag}`);
      await proof(run, payment);
      await sql(call(run, await input(run, 'verify', { draftId: payment, evidenceReviewed: true })));
      const clear = await input(run, 'clear');
      const reverse = await input(run, 'reverse', { draftId: payment });
      const result = await race(clearFirst ? call(run, clear) : call(run, reverse),
        clearFirst ? call(run, reverse) : call(run, clear), isolation, 'payment-ready');
      stale(result);
      if (clearFirst) {
        await sql(call(run, await input(run, 'reverse', { draftId: payment })));
      } else {
        const retry = await sql(call(run, await input(run, 'clear')), { allowFailure: true });
        assert.notEqual(retry.code, 0);
        assert.match(retry.diagnostics, /Resolve clearance prerequisites/);
      }
      await settled(run, { paid: 0, spent: 0, committed: 672, uncommitted: 328 });
      assert.equal((await view(run)).cleared, false);
    }

    // Clearance competes with supplier deactivation. An invalidation after clearance
    // survives reactivation: the old clearance cannot revive without a fresh decision.
    for (const clearFirst of [true, false]) {
      const run = await fresh();
      const payment = await draft(run, '666.00', `PAY-SRC-${clearFirst}-${tag}`);
      await proof(run, payment);
      await sql(call(run, await input(run, 'verify', { draftId: payment, evidenceReviewed: true })));
      const clear = await input(run, 'clear');
      const deactivate = await supplierStatus(run, false);
      const result = await race(clearFirst ? call(run, clear) : deactivate,
        clearFirst ? deactivate : call(run, clear), isolation, 'payment-ready');
      if (clearFirst) {
        if (result.code !== 0) {
          assert.match(result.diagnostics, /could not serialize|changed/);
          await sql(await supplierStatus(run, false));
        }
        assert.equal((await view(run)).cleared, false);
      } else {
        stale(result);
        const retry = await sql(call(run, await input(run, 'clear')), { allowFailure: true });
        assert.notEqual(retry.code, 0);
        assert.match(retry.diagnostics, /Supplier is inactive|Resolve clearance prerequisites/);
      }
      await sql(await supplierStatus(run, true));
      assert.equal((await view(run)).cleared, false, 'Source restoration must not revive clearance');
      await sql(call(run, await input(run, 'clear')));
      assert.equal((await view(run)).cleared, true);
      await settled(run, { paid: 666, spent: 672, committed: 0, uncommitted: 328 });
    }

    // A proof worker completion and verification both lock the same draft/head.
    // Verification cannot observe an uncommitted archived proof, and a completion
    // that lands first forces the reviewer to reload the changed payment.
    {
      const run = await fresh();
      const id = randomUUID();
      await sql(definition + `select pg_temp.payment_action(${json(run)},'saveDraft',jsonb_build_object('draftId','${id}','body',jsonb_build_object(
        'amount','333.00','reference','PAY-PROOF-${tag}-${randomUUID().slice(0, 8)}','method','Bank transfer',
        'date',(now() at time zone 'Asia/Manila')::date::text,'note','','other','','duplicateReason',''))); commit;`);
      const begin = readJson(await sql(definition + `select public.payment_files_command(${json(run.accountant)},${json({
        type: 'beginGroup', requestId: randomUUID(), draftId: id, expectedFiles: '1', keep: [],
        uploads: [{ name: 'payment.pdf', mime: 'application/pdf', size: 10, sha256: hash() }],
      })}); commit;`));
      const file = (await sql(`select id from private.payment_files where group_id='${begin.groupId}';`)).output.trim();
      const claimed = readJson(await sql(`select public.payment_transfer(${json(run.accountant)},'${file}','claim');`));
      await sql(`select public.payment_transfer(${json(run.accountant)},'${file}','checkpoint','${claimed.lease}',${json({ driveFileId: 'synthetic-payment-proof' })});`);
      await sql(`select public.payment_transfer(${json(run.accountant)},'${file}','finish','${claimed.lease}');`);
      const job = (await sql(`select id from private.payment_jobs where file_id='${file}' and kind='validate';`)).output.trim();
      const work = readJson(await sql(`select public.payment_worker('${job}','claim');`));
      await sql(`select public.payment_worker('${job}','checkpoint','${work.lease}',${json({ verified: true })});`);
      const verify = await input(run, 'verify', { draftId: id, evidenceReviewed: true });
      const early = await sql(call(run, verify), { allowFailure: true });
      assert.notEqual(early.code, 0);
      assert.match(early.diagnostics, /Complete saved payment and proof first/);
      assert.equal((await sql(`select count(*) from private.payment_verifications where po_id='${run.po}';`)).output.trim(), '0');
      const complete = `select public.payment_worker('${job}','complete','${work.lease}');`;
      const result = await race(complete, call(run, verify), isolation, 'payment-ready');
      stale(result);
      await sql(call(run, await input(run, 'verify', { draftId: id, evidenceReviewed: true })));
      assert.equal((await sql(`select count(*) from private.payment_verifications where po_id='${run.po}';`)).output.trim(), '1');
      assert.equal((await sql(`select state from private.payment_files where id='${file}';`)).output.trim(), 'verified');
      await settled(run, { paid: 333, spent: 336, committed: 336, uncommitted: 328 });
    }

    // An MRF correction invalidates clearance during its own save. Restoring the
    // source never revives the previous decision even when all blockers disappear.
    for (const clearFirst of [true, false]) {
      const run = await fresh();
      const payment = await draft(run, '666.00', `PAY-MRF-${clearFirst}-${tag}`);
      await proof(run, payment);
      await sql(call(run, await input(run, 'verify', { draftId: payment, evidenceReviewed: true })));
      const clear = await input(run, 'clear');
      const invalidate = `update public.material_requests set correction_kind='documents',correction_state='editing' where id='${run.request}';
        insert into private.mrf_review_events(request_id,actor_id,actor_name,actor_role,action,reason)
          values('${run.request}','${run.actor.userId}','MRF fixture','Procurement','correction_opened','Observed payment correction');`;
      const result = await race(clearFirst ? call(run, clear) : invalidate,
        clearFirst ? invalidate : call(run, clear), isolation, 'payment-ready');
      if (clearFirst) {
        if (result.code !== 0) {
          assert.match(result.diagnostics, /could not serialize|changed/);
          await sql(invalidate);
        }
        assert.equal((await view(run)).cleared, false);
      } else {
        stale(result);
        const retry = await sql(call(run, await input(run, 'clear')), { allowFailure: true });
        assert.notEqual(retry.code, 0);
      }
      await sql(`update public.material_requests set correction_kind=null,correction_state=null where id='${run.request}';`);
      assert.equal((await view(run)).cleared, false, 'MRF restoration must not revive clearance');
      await sql(call(run, await input(run, 'clear')));
      assert.equal((await view(run)).cleared, true);
      await settled(run, { paid: 666, spent: 672, committed: 0, uncommitted: 328 });
    }
  }
}

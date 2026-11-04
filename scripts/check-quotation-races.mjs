import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

export async function checkQuotationRaces({ sql, database, environment, fixture }) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Owned disposable quotation race fixtures');
  const { mrf, quote, body } = fixture, actor = { ...fixture.actor, sessionId: randomUUID() };
  const json = value => "'" + JSON.stringify(value).replaceAll("'", "''") + "'::jsonb";
  await sql(`insert into auth.sessions(id,user_id,created_at,updated_at) values('${actor.sessionId}','${actor.userId}',now(),now());
    select private.bind_session('${actor.userId}','${actor.sessionId}',private.login_preflight((select email from auth.users where id='${actor.userId}'))->>'revision',private.login_preflight((select email from auth.users where id='${actor.userId}'))->>'credential');`);
  const command = value => `select public.quotation_command(${json(actor)},${json({ requestId: randomUUID(), quoteId: quote, ...value })});`;
  const saved = () => sql(`select private.quotation_view('${quote}');`).then(r => JSON.parse(r.output.trim()));
  async function race(firstSql, secondSql, isolation) {
    const connection = spawn('docker', ['exec', '-i', database, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], { env: environment, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', diagnostics = '';
    connection.stdout.on('data', chunk => { output += chunk; });
    connection.stderr.on('data', chunk => { diagnostics += chunk; });
    const first = new Promise((resolve, reject) => { connection.on('error', reject); connection.on('close', code => resolve({ code, diagnostics })); });
    let second;
    try {
      connection.stdin.write(`begin isolation level ${isolation}; ${firstSql} select 'quotation-ready';\n`);
      for (let i = 0; i < 160 && !output.includes('quotation-ready'); i++) await delay(25);
      assert.ok(output.includes('quotation-ready'), 'First quotation transaction reached its controlled lock');
      const name = 'quotation-race-' + randomUUID();
      second = sql(`set application_name='${name}'; begin isolation level ${isolation}; ${secondSql} commit;`, { allowFailure: true });
      let blocked = false;
      for (let i = 0; i < 100 && !blocked; i++) {
        blocked = (await sql(`select exists(select 1 from pg_stat_activity where application_name='${name}' and wait_event_type='Lock');`)).output.trim() === 't';
        if (!blocked) await delay(25);
      }
      assert.ok(blocked, 'Competing quotation transaction demonstrably waits');
      connection.stdin.end('commit;\n');
      const [one, two] = await Promise.all([first, second]);
      assert.equal(one.code, 0, one.diagnostics);
      assert.notEqual(two.code, 0, 'Both conflicting mutations cannot succeed');
      return two.diagnostics;
    } finally {
      if (!connection.stdin.writableEnded) connection.stdin.end('rollback;\n');
      await Promise.allSettled([first, second]);
    }
  }
  for (const isolation of ['read committed', 'repeatable read']) {
    const current = await saved();
    assert.match(await race(command({ type: 'save', expectedVersion: current.version, body: { ...body, notes: isolation } }),
      command({ type: 'status', expectedVersion: current.version, state: 'cancelled', reason: 'Competing cancellation' }), isolation), /Quotation changed|could not serialize/);
  }
  const current = await saved();
  const begin = `select public.quotation_files_command(${json(actor)},${json({ type: 'beginGroup', requestId: randomUUID(), quoteId: quote, expectedFiles: current.fileVersion, keep: current.files.map(f => f.id), uploads: [{ name: 'race.pdf', mime: 'application/pdf', size: 10, sha256: 'a'.repeat(64) }] })});`;
  assert.match(await race(`select public.request_command(${json(actor)},${json({ type: 'openCorrection', requestId: randomUUID(), mrfId: mrf, expectedVersion: JSON.parse((await sql(`select private.request_snapshot('${mrf}');`)).output.trim()).version, reason: 'Controlled correction race' })});`, begin, 'read committed'), /Current approved MRF/);
  assert.equal((await sql(`select count(*) from private.quotation_groups where quote_id='${quote}' and state='uploading';`)).output.trim(), '0');
  // A grant change takes the same foundation guard before any command admission.
  assert.match(await race(`update private.account_guard set revision=revision+1 where id;update public.profiles set is_active=false where user_id='${actor.userId}';`,
    command({ type: 'save', expectedVersion: (await saved()).version, body }), 'read committed'), /Current workspace access required/);
  console.log('Observed quotation save/status, correction/file admission and access-revocation races passed.');
}

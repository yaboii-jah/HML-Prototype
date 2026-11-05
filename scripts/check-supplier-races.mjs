import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

export async function checkSupplierRaces({ sql, database, environment }) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Owned disposable supplier race fixtures');
  const person = randomUUID(), session = randomUUID();
  await sql(`insert into auth.users(id,email,is_anonymous,email_confirmed_at,encrypted_password) values('${person}','${person}@example.invalid',false,now(),'fixture');
    insert into public.profiles(user_id,display_name,is_active) values('${person}','Supplier race Procurement',true);
    insert into public.role_grants values('${person}','Procurement');
    insert into auth.sessions(id,user_id,created_at,updated_at) values('${session}','${person}',now(),now());
    select private.bind_session('${person}','${session}',private.login_preflight('${person}@example.invalid')->>'revision',private.login_preflight('${person}@example.invalid')->>'credential');`);
  const revision = (await sql(`select access_revision::text from public.profiles where user_id='${person}';`)).output.trim();
  const actor = { userId: person, sessionId: session, revision, activeRole: 'Procurement' };
  const json = value => "'" + JSON.stringify(value).replaceAll("'", "''") + "'::jsonb";
  const query = command => `select public.supplier_command(${json(actor)},${json(command)});`;
  const profile = name => ({ name, address: '', tin: '', contactName: '', email: '', phone: '', accreditationNote: '' });
  const create = () => ({ type: 'createSupplier', requestId: randomUUID(), profile: profile('Supplier race ' + randomUUID()) });
  async function race(firstSql, secondSql, isolation, retry = false) {
    const connection = spawn('docker', ['exec', '-i', database, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], { env: environment, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', diagnostics = '';
    connection.stdout.on('data', chunk => { output += chunk; }); connection.stderr.on('data', chunk => { diagnostics += chunk; });
    const first = new Promise((resolve, reject) => { connection.on('error', reject); connection.on('close', code => resolve({ code, diagnostics })); });
    const name = `supplier-race-${randomUUID()}`; let second;
    try {
      connection.stdin.write(`begin isolation level ${isolation}; ${firstSql} select 'supplier-ready';\n`);
      for (let i = 0; i < 160 && !output.includes('supplier-ready'); i++) await delay(25);
      assert.ok(output.includes('supplier-ready'), 'First supplier transaction reached its controlled lock');
      second = sql(`set application_name='${name}'; begin isolation level ${isolation}; ${secondSql} commit;`, { allowFailure: true });
      let blocked = false;
      for (let i = 0; i < 100 && !blocked; i++) { blocked = (await sql(`select exists(select 1 from pg_stat_activity where application_name='${name}' and wait_event_type='Lock');`)).output.trim() === 't'; if (!blocked) await delay(25); }
      assert.ok(blocked, 'Second supplier transaction demonstrably waits on the first');
      connection.stdin.end('commit;\n');
      const [one, two] = await Promise.all([first, second]);
      assert.equal(one.code, 0); if (retry) assert.equal(two.code, 0, 'Logical retry succeeds');
      else assert.notEqual(two.code, 0, 'Competing changes cannot both succeed');
      return two.diagnostics;
    } finally { if (!connection.stdin.writableEnded) connection.stdin.end('rollback;\n'); await Promise.allSettled([first, second]); }
  }
  for (const isolation of ['read committed', 'repeatable read']) {
    const first = create();
    const duplicate = { ...first, requestId: randomUUID(), profile: { ...first.profile, name: '  ' + first.profile.name.toUpperCase().replaceAll(' ', '   ') + '  ' } };
    assert.match(await race(query(first), query(duplicate), isolation), /duplicate key|could not serialize/);
    const id = JSON.parse((await sql(`select private.suppliers_read(${json(actor)})->'suppliers';`)).output.trim()).find(s => s.name === first.profile.name).id;
    const edit = { type: 'saveSupplier', requestId: randomUUID(), supplierId: id, expectedVersion: '1', profile: { ...first.profile, address: 'Changed' } };
    assert.match(await race(query(edit), query({ type: 'setSupplierStatus', requestId: randomUUID(), supplierId: id, expectedVersion: '1', active: false, reason: 'Competing deactivation' }), isolation), /Supplier changed|could not serialize/);
    // A failed stronger-isolation replay is retried as a new transaction with the same identity.
    const replay = create();
    if (isolation === 'read committed') await race(query(replay), query(replay), isolation, true);
    else {
      assert.match(await race(query(replay), query(replay), isolation), /could not serialize/);
      await sql(query(replay));
    }
    assert.equal((await sql(`select count(*) from private.audit_events where request_id='${replay.requestId}';`)).output.trim(), '1');
  }
  // A native session deletion must also defeat a previously admitted actor.
  await sql(`delete from auth.sessions where id='${session}';`);
  const denied = await sql(query(create()), { allowFailure: true });
  assert.notEqual(denied.code, 0);
  assert.match(denied.diagnostics, /Current workspace access required/);
  console.log('Supplier duplicate, edit/status, retry and revoked-session races passed.');
}

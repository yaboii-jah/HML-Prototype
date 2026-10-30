import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

export async function checkAccountRaces({ sql, database, environment }) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Audited concurrency fixtures require the disposable CI stack');
  const literal = value => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
  const connection = () => {
    const child = spawn('docker', ['exec', '-i', database, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], { env: environment, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', diagnostics = '';
    child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { diagnostics += chunk; });
    const done = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', code => resolve({ code, diagnostics, output })); });
    return { child, done, ready: async marker => { for (let i = 0; i < 160 && !output.includes(marker); i++) await delay(25); assert.ok(output.includes(marker), 'First transaction reached the controlled lock'); } };
  };
  const blocked = async name => {
    let found = false;
    for (let i = 0; i < 100 && !found; i++) { found = (await sql(`select exists(select 1 from pg_stat_activity where application_name='${name}' and wait_event_type='Lock');`)).output.trim() === 't'; if (!found) await delay(25); }
    assert.ok(found, 'Competing transaction demonstrably waits on a real lock');
  };
  for (const isolation of ['read committed', 'repeatable read']) {
    const a = randomUUID(), b = randomUUID(), sa = randomUUID(), sb = randomUUID();
    await sql(`update public.profiles set is_active=false where user_id in(select user_id from public.role_grants where role='Administrator');
      insert into auth.users(id,email,is_anonymous,email_confirmed_at,encrypted_password) values('${a}','${a}@example.invalid',false,now(),'fixture'),('${b}','${b}@example.invalid',false,now(),'fixture');
      insert into public.profiles(user_id,display_name,is_active,first_signed_in_at) values('${a}','Race A',true,now()),('${b}','Race B',true,now());
      insert into public.role_grants values('${a}','Administrator'),('${b}','Administrator');
      insert into auth.sessions(id,user_id,created_at,updated_at) values('${sa}','${a}',now(),now()),('${sb}','${b}',now(),now());
      select private.bind_session('${a}','${sa}',(private.login_preflight('${a}@example.invalid')->>'revision'),(private.login_preflight('${a}@example.invalid')->>'credential'));
      select private.bind_session('${b}','${sb}',(private.login_preflight('${b}@example.invalid')->>'revision'),(private.login_preflight('${b}@example.invalid')->>'credential'));`);
    const actorA = { userId: a, sessionId: sa, revision: '2', activeRole: 'Administrator' };
    const actorB = { userId: b, sessionId: sb, revision: '2', activeRole: 'Administrator' };
    const draft = { name: 'Race account', roles: ['Administrator'], projectIds: [], active: false, clearAssignments: false };
    const one = connection(); const secondName = `account-${randomUUID()}`; let second;
    const versionA = (await sql(`select version from public.profiles where user_id='${a}';`)).output.trim();
    const versionB = (await sql(`select version from public.profiles where user_id='${b}';`)).output.trim();
    try {
      one.child.stdin.write(`begin isolation level ${isolation}; select public.account_save(${literal(actorA)},'${randomUUID()}','${b}','${versionB}',${literal(draft)}); select 'account-ready';\n`);
      await one.ready('account-ready');
      second = sql(`set application_name='${secondName}'; begin isolation level ${isolation}; select public.account_save(${literal(actorB)},'${randomUUID()}','${a}','${versionA}',${literal(draft)}); commit;`, { allowFailure: true });
      await blocked(secondName); one.child.stdin.end('commit;\n');
      const [firstResult, secondResult] = await Promise.all([one.done, second]);
      assert.equal(firstResult.code, 0); assert.notEqual(secondResult.code, 0);
      assert.match(secondResult.diagnostics, /Administrator access required|could not serialize/);
      assert.equal((await sql(`select count(*) from public.profiles p join public.role_grants g on g.user_id=p.user_id where p.is_active and p.first_signed_in_at is not null and g.role='Administrator';`)).output.trim(), '1', 'Concurrent cross-deactivation preserves one usable Administrator');
    } finally { if (!one.child.stdin.writableEnded) one.child.stdin.end('rollback;\n'); await Promise.allSettled([one.done, second]); }

    // Reset first: completion waits on Auth's password row UPDATE, then rejects
    // the fingerprint captured before that update. No profile lock comes first.
    const preflight = JSON.parse((await sql(`select private.login_preflight('${a}@example.invalid');`)).output.trim());
    const fresh = randomUUID();
    await sql(`insert into auth.sessions(id,user_id,created_at,updated_at) values('${fresh}','${a}',now(),now());`);
    const reset = connection(), bindName = `bind-${randomUUID()}`; let bind;
    try {
      reset.child.stdin.write(`begin; update auth.users set encrypted_password='changed' where id='${a}'; select 'reset-ready';\n`);
      await reset.ready('reset-ready');
      bind = sql(`set application_name='${bindName}'; select private.bind_session('${a}','${fresh}','${preflight.revision}','${preflight.credential}');`);
      await blocked(bindName); reset.child.stdin.end('commit;\n');
      assert.equal((await reset.done).code, 0); assert.equal((await bind).output.trim(), 'SET\nf');
    } finally { if (!reset.child.stdin.writableEnded) reset.child.stdin.end('rollback;\n'); await Promise.allSettled([reset.done, bind]); }

    // Bind first: the SHARE lock blocks a native-style password UPDATE; after
    // it commits, session deletion cascades the just-created binding.
    const nextPreflight = JSON.parse((await sql(`select private.login_preflight('${a}@example.invalid');`)).output.trim());
    const binding = connection(), resetName = `reset-${randomUUID()}`; let passwordUpdate;
    try {
      binding.child.stdin.write(`begin; select private.bind_session('${a}','${fresh}','${nextPreflight.revision}','${nextPreflight.credential}'); select 'binding-ready';\n`);
      await binding.ready('binding-ready');
      passwordUpdate = sql(`set application_name='${resetName}'; begin; update auth.users set encrypted_password='changed-again' where id='${a}'; delete from auth.sessions where user_id='${a}'; commit;`);
      await blocked(resetName); binding.child.stdin.end('commit;\n');
      assert.equal((await binding.done).code, 0); assert.equal((await passwordUpdate).code, 0);
      assert.equal((await sql(`select count(*) from private.session_bindings where session_id='${fresh}';`)).output.trim(), '0');
    } finally { if (!binding.child.stdin.writableEnded) binding.child.stdin.end('rollback;\n'); await Promise.allSettled([binding.done, passwordUpdate]); }
  }
  console.log('Account cross-deactivation and both credential/reset lock orders passed.');
}

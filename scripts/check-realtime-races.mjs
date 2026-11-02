import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

export async function checkRealtimeRaces({ sql, database, environment }) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  const json = value => "'" + JSON.stringify(value).replaceAll("'", "''") + "'::jsonb";
  const actorId = randomUUID(), actorSession = randomUUID();
  await sql(`insert into auth.users(id,email,is_anonymous,email_confirmed_at,encrypted_password) values('${actorId}','${actorId}@example.invalid',false,now(),'fixture');
    insert into public.profiles(user_id,display_name) values('${actorId}','Realtime race Administrator');
    insert into public.role_grants values('${actorId}','Administrator');
    insert into auth.sessions(id,user_id,created_at,updated_at) values('${actorSession}','${actorId}',now(),now());
    select public.auth_bind_session('${actorId}','${actorSession}',private.login_preflight('${actorId}@example.invalid')->>'revision',private.login_preflight('${actorId}@example.invalid')->>'credential');`);
  const actor = { userId: actorId, sessionId: actorSession, revision: '2', activeRole: 'Administrator' };
  const publish = () => {
    const requestId = randomUUID();
    return `select public.project_command(${json(actor)},${json({ type: 'createProject', requestId, name: 'Realtime race ' + requestId, location: 'CI',
      code: 'RR-' + requestId.replaceAll('-', '').slice(0, 12).toUpperCase(), budget: '1.00' })});`;
  };
  async function fixture() {
    const id = randomUUID(), session = randomUUID();
    await sql(`insert into auth.users(id,email,is_anonymous,email_confirmed_at,encrypted_password) values('${id}','${id}@example.invalid',false,now(),'fixture');
      insert into public.profiles(user_id,display_name) values('${id}','Realtime receiver');
      insert into public.role_grants values('${id}','Accounting');
      insert into auth.sessions(id,user_id,created_at,updated_at) values('${session}','${id}',now(),now());
      select public.auth_bind_session('${id}','${session}',private.login_preflight('${id}@example.invalid')->>'revision',private.login_preflight('${id}@example.invalid')->>'credential');`);
    const version = (await sql(`select version::text from public.profiles where user_id='${id}';`)).output.trim();
    return { id, session, topic: `foundation:${id}:2:${session}`,
      revoke: `select public.account_save(${json(actor)},'${randomUUID()}','${id}','${version}',${json({ name: 'Realtime receiver', roles: ['Accounting'], projectIds: [], active: false, clearAssignments: false })});`,
      remove: `delete from auth.sessions where id='${session}';` };
  }
  async function race(firstSql, secondSql, isolation) {
    const child = spawn('docker', ['exec', '-i', database, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'],
      { env: environment, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', diagnostics = '', second;
    child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { diagnostics += chunk; });
    const first = new Promise((done, reject) => { child.on('error', reject); child.on('close', code => done({ code, diagnostics })); });
    const name = 'realtime-race-' + randomUUID();
    try {
      child.stdin.write(`begin isolation level ${isolation}; ${firstSql} select 'realtime-ready';\n`);
      for (let i = 0; i < 160 && !output.includes('realtime-ready'); i++) await delay(25);
      assert.ok(output.includes('realtime-ready'), 'First realtime transaction holds its controlled lock: ' + diagnostics);
      second = sql(`set application_name='${name}'; begin isolation level ${isolation}; ${secondSql} commit;`, { allowFailure: true });
      let blocked = false;
      for (let i = 0; i < 100 && !blocked; i++) {
        blocked = (await sql(`select exists(select 1 from pg_stat_activity where application_name='${name}' and wait_event_type='Lock');`)).output.trim() === 't';
        if (!blocked) await delay(25);
      }
      assert.ok(blocked, 'Second realtime transaction demonstrably waits');
      child.stdin.end('commit;\n');
      const [one, two] = await Promise.all([first, second]);
      assert.equal(one.code, 0, one.diagnostics);
      if (two.code !== 0) assert.match(two.diagnostics, /could not serialize/, 'Only stronger-isolation serialization is an acceptable retry');
      return two;
    } finally {
      if (!child.stdin.writableEnded) child.stdin.end('rollback;\n');
      await Promise.allSettled([first, second]);
    }
  }
  const count = async topic => Number((await sql(`select count(*) from realtime.messages where topic='${topic}' and event='foundation_changed';`)).output.trim());
  for (const isolation of ['read committed', 'repeatable read']) {
    for (const native of [false, true]) {
      for (const publisherFirst of [false, true]) {
        const receiver = await fixture(), before = await count(receiver.topic);
        const revocation = native ? receiver.remove : receiver.revoke;
        const two = await race(publisherFirst ? publish() : revocation, publisherFirst ? revocation : publish(), isolation);
        if (isolation === 'read committed' || (native && publisherFirst)) assert.equal(two.code, 0, two.diagnostics);
        assert.equal(await count(receiver.topic), before + (publisherFirst ? 1 : 0), 'Only a publication committed before revocation reaches the old topic');
        // Finish a serialization-retried revocation, then prove another writer
        // cannot notify this old binding even though the Auth JWT still exists.
        if (publisherFirst && two.code !== 0) await sql(revocation);
        await sql(publish());
        assert.equal(await count(receiver.topic), before + (publisherFirst ? 1 : 0), 'No subsequent committed publication reaches the old topic');
      }
    }
  }
  console.log('Observed-lock publication/revocation races passed in both orders at READ COMMITTED and REPEATABLE READ.');
}

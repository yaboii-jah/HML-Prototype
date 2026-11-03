import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

export async function checkRequestRaces({ sql, database, environment }) {
  const person = randomUUID(), session = randomUUID(), project = randomUUID();
  await sql(`insert into auth.users(id,email,is_anonymous,email_confirmed_at,encrypted_password) values('${person}','${person}@example.invalid',false,now(),'fixture');
    insert into public.profiles(user_id,display_name,is_active) values('${person}','MRF race Site',true);
    insert into public.role_grants values('${person}','Site Personnel');
    insert into public.projects(id,name,document_code) values('${project}','MRF race ${project}','RC-${project.replaceAll('-', '').slice(0, 10).toUpperCase()}');
    insert into public.project_assignments values('${person}','${project}');
    insert into auth.sessions(id,user_id,created_at,updated_at) values('${session}','${person}',now(),now());
    select private.bind_session('${person}','${session}',private.login_preflight('${person}@example.invalid')->>'revision',private.login_preflight('${person}@example.invalid')->>'credential');`);
  const revision = (await sql(`select access_revision::text from public.profiles where user_id='${person}';`)).output.trim();
  const actor = { userId: person, sessionId: session, revision, activeRole: 'Site Personnel' };
  const draft = { scopeId: null, requestDate: '', sourceRef: '', requestedBy: '', approvedBy: '', purchaser: '', financeOfficer: '', specialInstructions: '', items: [] };
  const query = command => `select public.request_command('${JSON.stringify(actor)}'::jsonb,'${JSON.stringify(command)}'::jsonb);`;
  for (const isolation of ['read committed', 'repeatable read']) {
    const command = { type: 'createDraft', requestId: randomUUID(), projectId: project, draft };
    const first = spawn('docker', ['exec', '-i', database, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], { env: environment, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', diagnostics = '';
    first.stdout.on('data', chunk => { output += chunk; });
    first.stderr.on('data', chunk => { diagnostics += chunk; });
    const finished = new Promise((resolve, reject) => { first.on('error', reject); first.on('close', code => resolve(code)); });
    let second;
    try {
      first.stdin.write(`begin isolation level ${isolation}; ${query(command)} select 'request-ready';\n`);
      for (let index = 0; index < 160 && !output.includes('request-ready'); index++) await delay(25);
      assert.ok(output.includes('request-ready'), diagnostics);
      const name = `request-race-${randomUUID()}`;
      second = sql(`set application_name='${name}'; begin isolation level ${isolation}; ${query(command)} commit;`, { allowFailure: true });
      let blocked = false;
      for (let index = 0; index < 100 && !blocked; index++) {
        blocked = (await sql(`select exists(select 1 from pg_stat_activity where application_name='${name}' and wait_event_type='Lock');`)).output.trim() === 't';
        if (!blocked) await delay(25);
      }
      assert.ok(blocked, 'Duplicate retry demonstrably waits');
      first.stdin.end('commit;\n');
      assert.equal(await finished, 0, diagnostics);
      const result = await second;
      if (result.code !== 0) assert.match(result.diagnostics, /could not serialize/);
      await sql(query(command));
      assert.equal((await sql(`select count(*) from private.audit_events where request_id='${command.requestId}';`)).output.trim(), '1');
      assert.equal((await sql(`select count(*) from private.request_operations where id='${command.requestId}';`)).output.trim(), '1');
    } finally {
      if (!first.stdin.writableEnded) first.stdin.end('rollback;\n');
      await Promise.allSettled([finished, second]);
    }
  }
}

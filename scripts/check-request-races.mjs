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
  const freshProject = async () => {
    const id = randomUUID();
    await sql(`insert into public.projects(id,name,document_code) values('${id}','MRF race ${id}','RC-${id.replaceAll('-', '').slice(0, 10).toUpperCase()}');
      insert into public.project_assignments values('${person}','${id}');
      delete from private.session_bindings where session_id='${session}';
      select private.bind_session('${person}','${session}',private.login_preflight('${person}@example.invalid')->>'revision',private.login_preflight('${person}@example.invalid')->>'credential');`);
    actor.revision = (await sql(`select access_revision::text from public.profiles where user_id='${person}';`)).output.trim();
    return id;
  };
  async function race(firstQuery, secondQuery, isolation) {
    const first = spawn('docker', ['exec', '-i', database, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], { env: environment, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', diagnostics = '';
    first.stdout.on('data', chunk => { output += chunk; });
    first.stderr.on('data', chunk => { diagnostics += chunk; });
    const finished = new Promise((resolve, reject) => { first.on('error', reject); first.on('close', code => resolve(code)); });
    let second;
    try {
      first.stdin.write(`begin isolation level ${isolation}; ${firstQuery} select 'request-ready';\n`);
      for (let index = 0; index < 160 && !output.includes('request-ready'); index++) await delay(25);
      assert.ok(output.includes('request-ready'), diagnostics);
      const name = `request-race-${randomUUID()}`;
      second = sql(`set application_name='${name}'; begin isolation level ${isolation}; ${secondQuery} commit;`, { allowFailure: true });
      let blocked = false;
      for (let index = 0; index < 100 && !blocked; index++) {
        blocked = (await sql(`select exists(select 1 from pg_stat_activity where application_name='${name}' and wait_event_type='Lock');`)).output.trim() === 't';
        if (!blocked) await delay(25);
      }
      assert.ok(blocked, 'Competing request transaction demonstrably waits');
      first.stdin.end('commit;\n');
      assert.equal(await finished, 0, diagnostics);
      return await second;
    } finally {
      if (!first.stdin.writableEnded) first.stdin.end('rollback;\n');
      await Promise.allSettled([finished, second]);
    }
  }
  for (const isolation of ['read committed', 'repeatable read']) {
      const command = { type: 'createDraft', requestId: randomUUID(), projectId: project, draft };
      const result = await race(query(command), query(command), isolation);
      if (result.code !== 0) assert.match(result.diagnostics, /could not serialize/);
      await sql(query(command));
      assert.equal((await sql(`select count(*) from private.audit_events where request_id='${command.requestId}';`)).output.trim(), '1');
      assert.equal((await sql(`select count(*) from private.request_operations where id='${command.requestId}';`)).output.trim(), '1');
      const separate = { ...command, requestId: randomUUID() };
      const another = { ...command, requestId: randomUUID() };
      const concurrent = await race(query(separate), query(another), isolation);
      if (concurrent.code !== 0) assert.match(concurrent.diagnostics, /could not serialize/);
      await sql(query(another));
      const records = JSON.parse((await sql(`select jsonb_agg(result->'record'->>'ref') from private.request_operations where id in('${separate.requestId}','${another.requestId}');`)).output.trim());
      assert.equal(new Set(records).size, 2, 'Independent creates receive distinct numbers');
      const saved = JSON.parse((await sql(query(command))).output.trim()).record;
      const edit = { type: 'saveDraft', requestId: randomUUID(), mrfId: saved.id, expectedVersion: saved.version, draft: { ...draft, sourceRef: randomUUID() } };
      const competing = { ...edit, requestId: randomUUID(), draft: { ...draft, sourceRef: randomUUID() } };
      const stale = await race(query(edit), query(competing), isolation);
      assert.notEqual(stale.code, 0, 'Competing edits cannot both replace the same version');
      assert.match(stale.diagnostics, /MRF changed|could not serialize/);
      // Compete against direct parent changes too: FK/code invariants must
      // protect records even without a UI's preliminary deletion checks.
      for (const change of ['code', 'project', 'scope']) {
        const parent = await freshProject();
        const scope = change === 'scope' ? randomUUID() : null;
        if (scope) await sql(`insert into public.scopes(id,project_id,name) values('${scope}','${parent}','Structural Works');`);
        const create = { type: 'createDraft', requestId: randomUUID(), projectId: parent, draft: { ...draft, scopeId: scope } };
        const mutation = change === 'code' ? `update public.projects set document_code='CHANGED-${parent.replaceAll('-', '').slice(0, 8).toUpperCase()}' where id='${parent}';`
          : change === 'project' ? `delete from public.projects where id='${parent}';` : `delete from public.scopes where id='${scope}';`;
        const denied = await race(query(create), `update private.account_guard set revision=revision+1 where id; ${mutation}`, isolation);
        assert.notEqual(denied.code, 0, change + ' cannot invalidate a committed MRF');
        assert.match(denied.diagnostics, /locked|immutable|foreign key|could not serialize/i);
        assert.equal((await sql(`select count(*) from public.material_requests where project_id='${parent}';`)).output.trim(), '1');
      }
  }
}

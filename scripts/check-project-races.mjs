import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

export async function checkProjectRaces({ sql, database, environment }) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Project race fixtures require owned disposable CI');
  const json = value => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
  const caller = randomUUID(), session = randomUUID(), person = randomUUID();
  await sql(`insert into auth.users(id,email,is_anonymous,email_confirmed_at,encrypted_password) values('${caller}','${caller}@example.invalid',false,now(),'fixture'),('${person}','${person}@example.invalid',false,now(),'fixture');
    insert into public.profiles(user_id,display_name,is_active,first_signed_in_at) values('${caller}','Project race Administrator',true,now()),('${person}','Assigned race Site',true,now());
    insert into public.role_grants values('${caller}','Administrator'),('${person}','Site Personnel');
    insert into auth.sessions(id,user_id,created_at,updated_at) values('${session}','${caller}',now(),now());
    select private.bind_session('${caller}','${session}',private.login_preflight('${caller}@example.invalid')->>'revision',private.login_preflight('${caller}@example.invalid')->>'credential');`);
  const actor = { userId: caller, sessionId: session, revision: '2', activeRole: 'Administrator' };
  const commandSql = command => `select private.project_command(${json(actor)},${json(command)});`;
  const detail = async id => JSON.parse((await sql(`select private.projects_read(${json(actor)},'${id}')->'project';`)).output.trim());
  const create = async () => {
    const requestId = randomUUID();
    const result = await sql(commandSql({ type: 'createProject', requestId, name: `Race ${requestId}`, location: 'CI', code: 'RC-' + requestId.replaceAll('-', '').slice(0, 12).toUpperCase(), budget: '100.00' }));
    return JSON.parse(result.output.trim()).projectId;
  };
  async function race(firstSql, secondSql, isolation) {
    const connection = spawn('docker', ['exec', '-i', database, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], { env: environment, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', diagnostics = '';
    connection.stdout.on('data', chunk => { output += chunk; }); connection.stderr.on('data', chunk => { diagnostics += chunk; });
    const first = new Promise((resolve, reject) => { connection.on('error', reject); connection.on('close', code => resolve({ code, diagnostics })); });
    const name = `project-race-${randomUUID()}`; let second;
    try {
      connection.stdin.write(`begin isolation level ${isolation}; ${firstSql} select 'project-ready';\n`);
      for (let i = 0; i < 160 && !output.includes('project-ready'); i++) await delay(25);
      assert.ok(output.includes('project-ready'), 'First project transaction reached its controlled lock');
      second = sql(`set application_name='${name}'; begin isolation level ${isolation}; ${secondSql} commit;`, { allowFailure: true });
      let blocked = false;
      for (let i = 0; i < 100 && !blocked; i++) { blocked = (await sql(`select exists(select 1 from pg_stat_activity where application_name='${name}' and wait_event_type='Lock');`)).output.trim() === 't'; if (!blocked) await delay(25); }
      assert.ok(blocked, 'Second project transaction demonstrably waits on the first');
      connection.stdin.end('commit;\n');
      const [one, two] = await Promise.all([first, second]);
      assert.equal(one.code, 0); assert.notEqual(two.code, 0, 'Competing changes cannot both succeed');
      return two.diagnostics;
    } finally { if (!connection.stdin.writableEnded) connection.stdin.end('rollback;\n'); await Promise.allSettled([first, second]); }
  }
  for (const isolation of ['read committed', 'repeatable read']) {
    let id = await create(), project = await detail(id);
    const base = { projectId: id, projectVersion: project.version };
    let diagnostic = await race(
      commandSql({ type: 'createScope', requestId: randomUUID(), ...base, name: 'Structural Works', budget: '70.00' }),
      commandSql({ type: 'createScope', requestId: randomUUID(), ...base, name: 'Electrical', budget: '70.00' }), isolation);
    assert.match(diagnostic, /Project changed|could not serialize/);
    assert.equal((await detail(id)).financial.allocated, '70.00');

    id = await create(); project = await detail(id);
    diagnostic = await race(
      commandSql({ type: 'saveProject', requestId: randomUUID(), projectId: id, projectVersion: project.version, name: project.name, location: project.location, code: project.code, budget: '60.00' }),
      commandSql({ type: 'createScope', requestId: randomUUID(), projectId: id, projectVersion: project.version, name: 'Structural Works', budget: '70.00' }), isolation);
    assert.match(diagnostic, /Project changed|could not serialize/);
    assert.equal((await detail(id)).financial.budget, '60.00');

    // Assignment changes do not stamp project.version. The reviewed identity
    // set must still reject an intervening assignment after taking the guard.
    id = await create(); project = await detail(id);
    const profileVersion = (await sql(`select version::text from public.profiles where user_id='${person}';`)).output.trim();
    diagnostic = await race(
      `select private.account_save(${json(actor)},'${randomUUID()}','${person}','${profileVersion}',${json({ name: 'Assigned race Site', roles: ['Site Personnel'], projectIds: [id], active: true, clearAssignments: false })});`,
      commandSql({ type: 'deleteProject', requestId: randomUUID(), projectId: id, projectVersion: project.version, assignmentIds: [], clearAssignments: false }), isolation);
    assert.match(diagnostic, /Assignments changed|could not serialize/);
    assert.ok(await detail(id));

    id = await create(); project = await detail(id);
    const reserve = randomUUID(), pendingDraft = { name: 'Pending race', email: `${reserve}@example.invalid`, roles: ['Site Personnel'], projectIds: [id], active: true, clearAssignments: false };
    diagnostic = await race(
      `select private.account_reserve(${json(actor)},'${reserve}',${json(pendingDraft)});`,
      commandSql({ type: 'deleteProject', requestId: randomUUID(), projectId: id, projectVersion: project.version, assignmentIds: [], clearAssignments: false }), isolation);
    assert.match(diagnostic, /referenced by provisioning|could not serialize/);
    assert.ok(await detail(id));

    id = await create(); project = await detail(id);
    const late = randomUUID();
    diagnostic = await race(
      commandSql({ type: 'deleteProject', requestId: randomUUID(), projectId: id, projectVersion: project.version, assignmentIds: [], clearAssignments: false }),
      `select private.account_reserve(${json(actor)},'${late}',${json({ ...pendingDraft, email: `${late}@example.invalid`, projectIds: [id] })});`, isolation);
    assert.match(diagnostic, /Invalid roles or project assignments|could not serialize/);
    assert.equal(await detail(id), null);
  }
  console.log('Project allocation, budget-reduction, assignment-review and provisioning/deletion lock races passed.');
}

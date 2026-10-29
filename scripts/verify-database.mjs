import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile, cp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { supabase } from './helpers/supabase-cli.mjs';
import { requireLoopback } from './helpers/supabase-target.mjs';

if (process.env.GITHUB_ACTIONS !== 'true' || !/^\d+$/.test(process.env.GITHUB_RUN_ID ?? '') || process.platform !== 'linux') {
  throw new Error('verify:db runs on disposable GitHub Linux runners. Use db:staging:check for scoped hosted checks.');
}

const project = `constructsync-ci-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT ?? '1'}`;
const network = `${project}-network`;
const workdir = resolve('.verification/database-workdir');
const database = `supabase_db_${project}`;
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(SUPABASE_|NEXT_PUBLIC_SUPABASE_)/.test(key)));
const cli = (args, options = {}) => supabase([...args, '--workdir', workdir], { environment, ...options });

function command(binary, args, input) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(binary, args, { windowsHide: true, env: environment, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    let diagnostics = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { diagnostics += chunk; });
    child.on('error', reject);
    child.on('close', code => resolveResult({ code, output, diagnostics }));
    child.stdin.end(input);
  });
}
async function sql(query, { allowFailure = false } = {}) {
  const result = await command('docker', ['exec', '-i', database, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], query);
  if (!allowFailure && result.code !== 0) throw new Error(`Database verification failed: ${result.diagnostics}`);
  return result;
}

const hash = createHash('sha256');
const migrationNames = (await readdir('supabase/migrations')).filter(name => name.endsWith('.sql')).sort();
for (const name of migrationNames) hash.update(name).update(await readFile(`supabase/migrations/${name}`));
const migrationHash = hash.digest('hex');
let networkCreated = false;
let passed = false;
let typeMatch = false;
await mkdir(`${workdir}/supabase`, { recursive: true });
await writeFile(`${workdir}/supabase/config.toml`, (await readFile('supabase/config.toml', 'utf8')).replace('project_id = "constructsync-ci"', `project_id = "${project}"`));
await cp('supabase/migrations', `${workdir}/supabase/migrations`, { recursive: true });

try {
  const networkResult = await command('docker', ['network', 'create', '--driver', 'bridge', '--opt', 'com.docker.network.bridge.host_binding_ipv4=127.0.0.1', network]);
  assert.equal(networkResult.code, 0, 'Create isolated loopback Docker network');
  networkCreated = true;
  console.log('Starting disposable Supabase and replaying foundation migrations.');
  await cli(['start', '--network-id', network, '--exclude', 'storage-api,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'], { capture: true });
  console.log('Checking SQL constraints, permissions and session revocation.');
  await sql(await readFile('supabase/checks/staging.sql', 'utf8'));

  // Hold the parent lock in one connection; the second must observe committed allocation.
  const projectId = randomUUID();
  const scopeA = randomUUID();
  const scopeB = randomUUID();
  await sql(`insert into public.projects(id,name) values ('${projectId}','Concurrency ${projectId}');
    insert into public.project_budgets values ('${projectId}',100);
    insert into public.scopes(id,project_id,name) values ('${scopeA}','${projectId}','A'),('${scopeB}','${projectId}','B');`);
  try {
    for (const isolation of ['read committed', 'repeatable read']) {
      const connection = spawn('docker', ['exec', '-i', database, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], {
        env: environment, stdio: ['pipe', 'pipe', 'pipe'],
      });
      let firstOutput = '';
      let firstError = '';
      connection.stdout.on('data', chunk => { firstOutput += chunk; });
      connection.stderr.on('data', chunk => { firstError += chunk; });
      const first = new Promise((resolveFirst, reject) => {
        connection.on('error', reject);
        connection.on('close', code => resolveFirst({ code, diagnostics: firstError }));
      });
      connection.stdin.write(`begin isolation level ${isolation}; insert into public.scope_budgets values ('${scopeA}',70); select 'parent-ready';\n`);
      const secondName = `allocation-${randomUUID()}`;
      let second;
      try {
        for (let attempt = 0; attempt < 200 && !firstOutput.includes('parent-ready'); attempt++) {
          await new Promise(resolveDelay => setTimeout(resolveDelay, 25));
        }
        assert.ok(firstOutput.includes('parent-ready'), 'First transaction inserted while holding parent lock');
        second = sql(`set application_name='${secondName}'; begin isolation level ${isolation}; insert into public.scope_budgets values ('${scopeB}',70); commit;`, { allowFailure: true });
        let blocked = false;
        for (let attempt = 0; attempt < 60 && !blocked; attempt++) {
          const probe = await sql(`select exists(select 1 from pg_stat_activity where application_name='${secondName}' and wait_event_type='Lock');`);
          blocked = probe.output.trim() === 't';
          if (!blocked) await new Promise(resolveDelay => setTimeout(resolveDelay, 25));
        }
        assert.ok(blocked, 'Second allocation demonstrably waits for the first transaction');
        connection.stdin.end('commit;\n');
      } catch (error) {
        connection.stdin.end('rollback;\n');
        await Promise.allSettled([first, second]);
        throw error;
      }
      const [one, two] = await Promise.all([first, second]);
      assert.equal(one.code, 0);
      assert.notEqual(two.code, 0, `Competing ${isolation} allocations cannot both succeed`);
      assert.match(two.diagnostics, /exceed project budget|could not serialize/);
      assert.equal((await sql(`select sum(amount) from public.scope_budgets where scope_id in ('${scopeA}','${scopeB}');`)).output.trim(), '70');
      await sql(`delete from public.scope_budgets where scope_id in ('${scopeA}','${scopeB}');`);
    }
  } finally {
    await sql(`delete from public.projects where id='${projectId}';`);
  }

  // Exercise real Auth JWTs and direct PostgREST requests, beyond SQL role simulation.
  const status = JSON.parse((await cli(['status', '--output', 'json'], { capture: true })).output);
  const api = requireLoopback(status.API_URL ?? status.api_url).origin;
  requireLoopback(status.DB_URL ?? status.db_url);
  const anon = status.ANON_KEY ?? status.anon_key;
  const secret = status.SERVICE_ROLE_KEY ?? status.service_role_key;
  assert.ok(anon && secret, 'Disposable API credentials available');
  const created = [];
  const testProject = randomUUID();
  const request = (path, { token = anon, ...options } = {}) => fetch(`${api}${path}`, {
    ...options, headers: { apikey: anon, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...options.headers },
  });
  const admin = (path, options = {}) => request(path, { ...options, token: secret, headers: { apikey: secret } });
  try {
    await sql(`insert into public.projects(id,name) values ('${testProject}','HTTP ${testProject}'); insert into public.project_budgets values ('${testProject}',100);`);
    const signup = await request('/auth/v1/signup', { method: 'POST', body: JSON.stringify({ email: `${randomUUID()}@example.invalid`, password: randomUUID() }) });
    assert.ok(signup.status >= 400, 'Public signup is disabled');
    const anonymousSignup = await request('/auth/v1/signup', { method: 'POST', body: '{}' });
    assert.ok(anonymousSignup.status >= 400, 'Anonymous signup is disabled');
    for (const role of ['Project Manager', 'Site Personnel']) {
      const email = `${randomUUID()}@example.invalid`;
      const password = randomUUID();
      const response = await admin('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { role: 'Administrator' } }) });
      assert.equal(response.status, 200, 'Create synthetic Auth identity');
      const user = await response.json();
      assert.match(user.id, /^[\da-f-]{36}$/i);
      created.push(user.id);
      const login = await request('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password }) });
      assert.equal(login.status, 200, 'Sign in through Auth');
      const session = await login.json();
      const claims = JSON.parse(Buffer.from(session.access_token.split('.')[1], 'base64url').toString());
      assert.match(claims.session_id, /^[\da-f-]{36}$/i);
      const before = await request(`/rest/v1/projects?id=eq.${testProject}`, { token: session.access_token });
      assert.equal(before.status, 200);
      assert.deepEqual(await before.json(), [], 'Auth identity without app grants has no access');
      await sql(`insert into public.profiles(user_id,display_name,is_active) values ('${user.id}','HTTP fixture',true);
        insert into public.role_grants values ('${user.id}','${role}');
        ${role === 'Site Personnel' ? `insert into public.project_assignments values ('${user.id}','${testProject}');` : ''}
        insert into private.session_bindings(session_id,user_id,access_revision)
        select '${claims.session_id}',user_id,access_revision from public.profiles where user_id='${user.id}';`);
      const records = await request(`/rest/v1/projects?id=eq.${testProject}`, { token: session.access_token });
      assert.equal(records.status, 200);
      assert.equal((await records.json()).length, 1, 'Current grants and bound session permit project metadata');
      const budgets = await request(`/rest/v1/project_budgets?project_id=eq.${testProject}`, { token: session.access_token });
      assert.equal(budgets.status, 200);
      assert.equal((await budgets.json()).length, role === 'Site Personnel' ? 0 : 1, 'Budget confidentiality via direct API');
      if (role === 'Site Personnel') {
        const embedded = await request(`/rest/v1/projects?select=id,project_budgets(amount)&id=eq.${testProject}`, { token: session.access_token });
        assert.equal(embedded.status, 200);
        const [row] = await embedded.json();
        assert.ok(row);
        assert.ok(row.project_budgets === null || (Array.isArray(row.project_budgets) && row.project_budgets.length === 0), 'Embedded API relation preserves budget confidentiality');
      }
      const forgedWrite = await request('/rest/v1/projects', { token: session.access_token, method: 'POST', body: JSON.stringify({ name: 'Forged browser project' }) });
      assert.ok(forgedWrite.status >= 400);
      await sql(`update public.profiles set is_active=false where user_id='${user.id}';`);
      const revoked = await request(`/rest/v1/projects?id=eq.${testProject}`, { token: session.access_token });
      assert.equal(revoked.status, 200);
      assert.deepEqual(await revoked.json(), [], 'Deactivation rejects an existing signed JWT');
      const refreshed = await request('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: session.refresh_token }) });
      assert.equal(refreshed.status, 200);
      const refreshedSession = await refreshed.json();
      const afterRefresh = await request(`/rest/v1/projects?id=eq.${testProject}`, { token: refreshedSession.access_token });
      assert.deepEqual(await afterRefresh.json(), [], 'JWT refresh cannot renew invalidated access');
    }
    const anonymous = await request(`/rest/v1/projects?id=eq.${testProject}`);
    assert.ok(anonymous.status >= 400, 'Anonymous API read rejected');
  } finally {
    for (const id of created) {
      await sql(`delete from public.profiles where user_id='${id}';`);
      const response = await admin(`/auth/v1/admin/users/${id}`, { method: 'DELETE' });
      assert.ok(response.ok, 'Remove only run-owned Auth users');
    }
    await sql(`delete from public.projects where id='${testProject}';`);
  }
  console.log('SQL, concurrent allocation and real Auth/Data API checks passed.');
  const { output } = await cli(['gen', 'types', '--local', '--lang', 'typescript', '--schema', 'public,private'], { capture: true });
  assert.ok(output.includes('export type Database ='), 'Generated database types returned');
  await writeFile('.verification/database.types.ts', output);
  let expected = '';
  try { expected = await readFile('src/server/database/database.types.ts', 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  typeMatch = output.replaceAll('\r\n', '\n') === expected.replaceAll('\r\n', '\n');
  passed = typeMatch;
} finally {
  try { await cli(['stop', '--project-id', project, '--no-backup'], { capture: true }); }
  finally {
    if (networkCreated) assert.equal((await command('docker', ['network', 'rm', network])).code, 0, 'Remove only run-owned Docker network');
  }
  await writeFile('.verification/database-ci.json', JSON.stringify({ passed, typeMatch, migrationHash,
    runUrl: `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` }, null, 2));
}
assert.ok(typeMatch, 'Commit the generated database.types.ts artifact, then rerun CI to verify type consistency.');
console.log('Database verification and generated type consistency passed.');

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

/** Observed-lock document races against the owned disposable database. */
export async function checkDocumentRaces({ sql, database, environment }) {
  const invoke = (name, parameters) => `select public.${name}(${parameters.map(value => value === null ? 'null' : typeof value === 'object' ? `$json$${JSON.stringify(value)}$json$::jsonb` : `'${value}'`).join(',')});`;
  async function fixture(complete = false) {
    const user = randomUUID(), session = randomUUID(), project = randomUUID(), mapping = randomUUID();
    await sql(`insert into auth.users(id,email,is_anonymous,email_confirmed_at,encrypted_password) values('${user}','${user}@example.invalid',false,now(),'fixture');
      insert into public.profiles(user_id,display_name,is_active) values('${user}','Document race Site',true);
      insert into public.role_grants values('${user}','Site Personnel');
      insert into public.projects(id,name,document_code) values('${project}','Document race ${project}','DR-${project.slice(0, 8).toUpperCase()}');
      insert into public.project_assignments values('${user}','${project}');
      insert into auth.sessions(id,user_id,created_at,updated_at) values('${session}','${user}',now(),now());
      select private.bind_session('${user}','${session}',private.login_preflight('${user}@example.invalid')->>'revision',private.login_preflight('${user}@example.invalid')->>'credential');
      insert into private.project_document_folders(id,project_id,folder_id,root_id,name) values('${mapping}','${project}','race-folder-${project}','race-company-root','Race destination');`);
    const revision = (await sql(`select access_revision::text from public.profiles where user_id='${user}';`)).output.trim();
    const actor = { userId: user, sessionId: session, revision, activeRole: 'Site Personnel' };
    const draft = { scopeId: null, requestDate: '', sourceRef: '', requestedBy: '', approvedBy: '', purchaser: '', financeOfficer: '', specialInstructions: '', items: [] };
    if (complete) {
      const scope = randomUUID();
      await sql(`insert into public.project_budgets values('${project}',100);insert into public.scopes(id,project_id,name) values('${scope}','${project}','Structural Works');insert into public.scope_budgets values('${scope}',100);`);
      Object.assign(draft, { scopeId: scope, requestDate: '2026-11-03', requestedBy: 'Printed site', approvedBy: 'Printed PM', purchaser: 'Printed buyer', financeOfficer: 'Printed finance',
        items: [{ id: randomUUID(), name: 'Cement', unit: 'bag', quantity: '10.125', neededDate: '2026-11-04', purpose: '', location: 'Site', remarks: '' }] });
    }
    const mrf = JSON.parse((await sql(invoke('request_command', [actor, { type: 'createDraft', requestId: randomUUID(), projectId: project, draft }]))).output.trim()).record;
    const document = randomUUID();
    await sql(`insert into private.request_documents(id,request_id,folder_mapping_id,drive_file_id,name,size,sha256,uploader_id,uploader_name) values('${document}','${mrf.id}','${mapping}','race-file-${document}','race.pdf',10,repeat('a',64),'${user}','Document race Site');
      insert into private.request_document_state(request_id,current_document) values('${mrf.id}','${document}');`);
    return { actor, user, project, mrf, draft, document };
  }
  async function manager() {
    const user = randomUUID(), session = randomUUID();
    await sql(`insert into auth.users(id,email,is_anonymous,email_confirmed_at,encrypted_password) values('${user}','${user}@example.invalid',false,now(),'fixture');
      insert into public.profiles(user_id,display_name,is_active) values('${user}','Review race PM',true);insert into public.role_grants values('${user}','Project Manager');
      insert into auth.sessions(id,user_id,created_at,updated_at) values('${session}','${user}',now(),now());
      select private.bind_session('${user}','${session}',private.login_preflight('${user}@example.invalid')->>'revision',private.login_preflight('${user}@example.invalid')->>'credential');`);
    return { userId: user, sessionId: session, revision: (await sql(`select access_revision from public.profiles where user_id='${user}';`)).output.trim(), activeRole: 'Project Manager' };
  }
  async function race(firstQuery, secondQuery, isolation) {
    const first = spawn('docker', ['exec', '-i', database, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], { env: environment, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', diagnostics = '';
    first.stdout.on('data', chunk => { output += chunk; });
    first.stderr.on('data', chunk => { diagnostics += chunk; });
    const finished = new Promise((done, reject) => { first.on('error', reject); first.on('close', done); });
    let second;
    try {
      first.stdin.write(`begin isolation level ${isolation}; ${firstQuery} select 'document-race-ready';\n`);
      for (let i = 0; i < 160 && !output.includes('document-race-ready'); i++) await delay(25);
      assert.ok(output.includes('document-race-ready'), diagnostics);
      const name = 'document-race-' + randomUUID();
      second = sql(`set application_name='${name}'; begin isolation level ${isolation}; ${secondQuery} commit;`, { allowFailure: true });
      let blocked = false;
      for (let i = 0; i < 100 && !blocked; i++) {
        blocked = (await sql(`select exists(select 1 from pg_stat_activity where application_name='${name}' and wait_event_type='Lock');`)).output.trim() === 't';
        if (!blocked) await delay(25);
      }
      assert.ok(blocked, 'Document competitor demonstrably waits on a lock');
      first.stdin.end('commit;\n');
      assert.equal(await finished, 0, diagnostics);
      return await second;
    } finally {
      if (!first.stdin.writableEnded) first.stdin.end('rollback;\n');
      await Promise.allSettled([finished, second]);
    }
  }
  for (const isolation of ['read committed', 'repeatable read']) {
    const f = await fixture(true), pm = await manager();
    const submit = { type: 'submitMrf', requestId: randomUUID(), mrfId: f.mrf.id, expectedVersion: '1', attachmentRevision: '1', draft: f.draft };
    const submitted = invoke('request_command', [f.actor, submit]);
    const duplicate = await race(submitted, submitted, isolation);
    if (duplicate.code !== 0) assert.match(duplicate.diagnostics, /could not serialize/);
    const saved = JSON.parse((await sql(submitted)).output.trim()).record;
    assert.equal((await sql(`select count(*) from private.mrf_submissions where request_id='${f.mrf.id}';`)).output.trim(), '1');
    const approve = { type: 'reviewMrf', requestId: randomUUID(), mrfId: f.mrf.id, expectedVersion: saved.version, submissionId: saved.submissionId, decision: 'approve' };
    const competing = await race(invoke('request_command', [pm, approve]), invoke('request_command', [pm, { ...approve, requestId: randomUUID(), decision: 'return', reason: 'Competing review' }]), isolation);
    assert.notEqual(competing.code, 0); assert.match(competing.diagnostics, /MRF changed|could not serialize/);
    assert.equal((await sql(`select count(*) from private.mrf_archive_snapshots where request_id='${f.mrf.id}';`)).output.trim(), '1');
    assert.equal((await sql(`select count(*) from private.document_jobs where request_id='${f.mrf.id}' and kind='archive';`)).output.trim(), '1');
    const changed = await fixture(true);
    const staleSubmit = invoke('request_command', [changed.actor, { ...submit, requestId: randomUUID(), mrfId: changed.mrf.id, draft: changed.draft }]);
    const removed = await race(invoke('document_command', [changed.actor, { type: 'remove', operationId: randomUUID(), mrfId: changed.mrf.id, expectedRevision: '1' }]), staleSubmit, isolation);
    assert.notEqual(removed.code, 0); assert.match(removed.diagnostics, /Supporting PDF changed|could not serialize/);
    assert.equal((await sql(`select count(*) from private.mrf_submissions where request_id='${changed.mrf.id}';`)).output.trim(), '0');
    const revoked = await fixture(true);
    const denied = await race(`update private.account_guard set revision=revision+1 where id;delete from public.project_assignments where user_id='${revoked.user}' and project_id='${revoked.project}';`,
      invoke('request_command', [revoked.actor, { ...submit, requestId: randomUUID(), mrfId: revoked.mrf.id, draft: revoked.draft }]), isolation);
    assert.notEqual(denied.code, 0); assert.match(denied.diagnostics, /Current|session|access|could not serialize/i);
    assert.equal((await sql(`select count(*) from private.mrf_submissions where request_id='${revoked.mrf.id}';`)).output.trim(), '0');
  }
  console.log('Observed MRF submission retries, competing PM decisions, PDF changes and revocation races passed at both isolation levels.');
  for (const isolation of ['read committed', 'repeatable read']) {
    const f = await fixture();
    const start = { type: 'startUpload', operationId: randomUUID(), mrfId: f.mrf.id, expectedRevision: '1', name: 'race.pdf', size: 10, sha256: 'a'.repeat(64) };
    const query = invoke('document_command', [f.actor, start]);
    const duplicate = await race(query, query, isolation);
    if (duplicate.code !== 0) assert.match(duplicate.diagnostics, /could not serialize/);
    await sql(query);
    assert.equal((await sql(`select count(*) from private.document_uploads where request_id='${f.mrf.id}';`)).output.trim(), '1', 'Concurrent retry creates one upload');
    const header = invoke('request_command', [f.actor, { type: 'saveDraft', requestId: randomUUID(), mrfId: f.mrf.id, expectedVersion: '1', draft: { ...f.draft, sourceRef: 'Concurrent header save' } }]);
    const remove = invoke('document_command', [f.actor, { type: 'remove', operationId: randomUUID(), mrfId: f.mrf.id, expectedRevision: '1' }]);
    const independent = await race(header, remove, isolation);
    if (independent.code !== 0) { assert.match(independent.diagnostics, /could not serialize/); await sql(remove); }
    assert.equal((await sql(`select version from public.material_requests where id='${f.mrf.id}';`)).output.trim(), '2');
    assert.equal((await sql(`select revision::text||':'||(current_document is null)::text from private.request_document_state where request_id='${f.mrf.id}';`)).output.trim(), '2:true', 'Header/file versions are independent');
    const job = (await sql(`select id from private.document_jobs where resource_id='${f.document}' and kind='cleanup';`)).output.trim();
    const claim = invoke('document_worker', [job, 'claim']);
    const competing = await race(claim, claim, isolation);
    if (competing.code !== 0) assert.match(competing.diagnostics, /could not serialize/);
    assert.equal((await sql(claim)).output.trim(), '', 'An active worker lease cannot be claimed twice');
    assert.equal((await sql(`select attempts from private.document_jobs where id='${job}';`)).output.trim(), '1');
    // An application access change holds the same guard before changing grants.
    await sql(`update private.document_jobs set lease=null,lease_until=null,state='pending' where id='${job}';`);
    const revoked = await race(`update private.account_guard set revision=revision+1 where id; delete from public.project_assignments where user_id='${f.user}' and project_id='${f.project}';`, claim, isolation);
    if (revoked.code !== 0) assert.match(revoked.diagnostics, /could not serialize/);
    await sql(claim);
    assert.equal((await sql(`select state from private.document_jobs where id='${job}';`)).output.trim(), 'paused', 'Revocation wins before worker admission');
    const other = await fixture();
    const removeCommand = { type: 'remove', operationId: randomUUID(), mrfId: other.mrf.id, expectedRevision: '1' };
    const stale = await race(invoke('document_command', [other.actor, removeCommand]), invoke('document_command', [other.actor, { ...removeCommand, operationId: randomUUID() }]), isolation);
    assert.notEqual(stale.code, 0, 'Two attachment changes cannot both commit against one revision');
    assert.match(stale.diagnostics, /Attachment changed|could not serialize/);
    assert.equal((await sql(`select revision from private.request_document_state where request_id='${other.mrf.id}';`)).output.trim(), '2');
  }
  console.log('Observed document retry, independent-save, worker-lease and authority-revocation races passed at both isolation levels.');
}

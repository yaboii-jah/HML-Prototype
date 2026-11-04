import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { PDFDocument } from 'pdf-lib';

/** Real Next/Workflow + Auth/Postgres + fake Drive. All data is disposable. */
export async function checkMrfDocuments({ browser, second, client, login, logout, sql, administrator, base, drive }) {
  const ok = result => { assert.equal(result.error, null); return result.data; };
  const cookie = async b => (await b.call('Network.getAllCookies')).cookies.filter(c => c.domain === '127.0.0.1').map(c => `${c.name}=${c.value}`).join('; ');
  const actor = async b => {
    const data = await b.run("return await (await fetch('/api/realtime/session')).json()");
    return { userId: data.session.userId, revision: data.session.revision, activeRole: data.session.activeRole, sessionId: data.sessionId };
  };
  const until = async (check, label) => {
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) { if (await check()) return; await delay(150); }
    throw Error('Document runtime check timed out: ' + label);
  };
  const readSql = async query => JSON.parse((await sql(query)).output.trim());
  const docState = mrf => readSql(`select coalesce(jsonb_build_object('revision',s.revision::text,'current',s.current_document),'{}') from private.request_document_state s where request_id='${mrf}';`);
  await login(browser, administrator);
  const adminActor = await actor(browser), projectOperation = randomUUID();
  const project = ok(await client.rpc('project_command', { actor: adminActor, command: { type: 'createProject', requestId: projectOperation, name: 'Documents runtime ' + projectOperation, location: 'CI', code: 'D-' + projectOperation.slice(0, 8).toUpperCase(), budget: '0' } })).projectId;
  await browser.navigate('/projects/' + project);
  await browser.wait("return document.body.innerText.includes('Current destination:')");
  assert.equal((await sql(`select count(*) from private.project_document_folders where project_id='${project}' and current;`)).output.trim(), '1', 'Workflow acknowledged automatic folder');
  const originalMapping = await readSql(`select jsonb_build_object('id',id,'folder',folder_id) from private.project_document_folders where project_id='${project}' and current;`);
  const staff = [];
  for (let i = 0; i < 2; i++) {
    const account = { email: `${randomUUID()}@example.invalid`, password: randomUUID() };
    account.id = ok(await client.auth.admin.createUser({ ...account, email_confirm: true })).user.id;
    ok(await client.from('profiles').insert({ user_id: account.id, display_name: `Document Site ${i}`, is_active: true }));
    ok(await client.from('role_grants').insert({ user_id: account.id, role: 'Site Personnel' }));
    ok(await client.from('project_assignments').insert({ user_id: account.id, project_id: project }));
    staff.push(account);
  }
  await logout(browser); await login(browser, staff[0]); await login(second, staff[1]);
  const siteActor = await actor(browser);
  const draft = { scopeId: null, sourceRef: '', requestDate: '2026-11-03', requestedBy: 'Site', approvedBy: 'Printed PM', purchaser: '', financeOfficer: '', specialInstructions: '', items: [] };
  const mrf = ok(await client.rpc('request_command', { actor: siteActor, command: { type: 'createDraft', requestId: randomUUID(), projectId: project, draft } })).record.id;
  await browser.navigate(`/requests/${mrf}/edit`); await second.navigate(`/requests/${mrf}`);
  await browser.fill('input[name=sourceRef]', 'Unsaved details survive file actions');
  await browser.wait("return !!document.querySelector('.mrf-documents input[type=file]')&&!document.querySelector('.mrf-documents fieldset').disabled");
  const pdf = await PDFDocument.create(); pdf.addPage([400, 500]); const bytes = Buffer.from(await pdf.save());
  const select = async (name, data) => browser.run(`const bytes=Uint8Array.from(atob('${data.toString('base64')}'),c=>c.charCodeAt(0));const dt=new DataTransfer();dt.items.add(new File([bytes],${JSON.stringify(name)},{type:'application/pdf'}));const input=document.querySelector('.mrf-documents input[type=file]');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));`);
  await select('shared.pdf', bytes);
  await browser.run("[...document.querySelectorAll('.mrf-documents button')].find(b=>b.textContent==='Upload PDF').click()");
  await browser.wait("return document.querySelector('.document-current')?.textContent.includes('shared.pdf')");
  await second.wait("return document.querySelector('.document-current')?.textContent.includes('shared.pdf')");
  await browser.wait("return document.querySelector('.mrf-documents input[type=file]')?.files.length===0");
  assert.equal(await browser.run("return document.querySelector('.mrf-documents input[type=file]').files.length"), 0, 'Successful upload clears native file selection');
  assert.equal(await browser.run("return document.querySelector('input[name=sourceRef]').value"), 'Unsaved details survive file actions');
  assert.equal((await sql(`select version from public.material_requests where id='${mrf}';`)).output.trim(), '1', 'File save left draft version alone');
  const current = (await docState(mrf)).current, cookies = await cookie(browser);
  const http = (path, init = {}, overrideCookie = cookies) => fetch(base + path, { ...init, headers: { Cookie: overrideCookie, Origin: base, ...init.headers }, signal: AbortSignal.timeout(30000) });
  const file = await http('/api/mrf-documents/files/' + current);
  assert.equal(file.status, 200); assert.match(file.headers.get('cache-control'), /private.*no-store/);
  assert.equal(createHash('sha256').update(Buffer.from(await file.arrayBuffer())).digest('hex'), createHash('sha256').update(bytes).digest('hex'));
  const range = await http('/api/mrf-documents/files/' + current, { headers: { Range: 'bytes=0-4' } });
  assert.equal(range.status, 206); assert.equal(await range.text(), '%PDF-');
  assert.equal((await http('/api/mrf-documents/files/' + current, { headers: { Range: 'bytes=999999999-' } })).status, 416);
  assert.equal((await http('/api/mrf-documents/files/' + current, {}, '')).status, 401);
  assert.equal((await http('/api/mrf-documents?mrfId=' + mrf, { headers: { Origin: 'https://example.invalid' } })).status, 403);
  const post = async command => {
    const response = await http('/api/mrf-documents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operationId: randomUUID(), mrfId: mrf, ...command }) });
    const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body)); return body;
  };
  const uploadBytes = async (name, content, lostFinal = false) => {
    const state = await docState(mrf), sha256 = createHash('sha256').update(content).digest('hex');
    const { uploadId } = await post({ type: 'startUpload', expectedRevision: state.revision, name, size: content.length, sha256 });
    const path = '/api/mrf-documents/uploads/' + uploadId;
    assert.equal((await http(path, { method: 'POST' })).status, 200);
    let offset = 0;
    while (offset < content.length) {
      const chunk = content.subarray(offset, offset + 3 * 1024 * 1024);
      if (lostFinal && offset + chunk.length === content.length) drive.faults.loseFinalResponse = true;
      const response = await http(path, { method: 'PUT', headers: { 'Content-Type': 'application/pdf', 'X-Upload-Offset': String(offset) }, body: chunk });
      if (lostFinal && offset + chunk.length === content.length) {
        assert.equal(response.status, 503, 'Lost final provider response remains uncertain');
        const recovered = await http(path, { method: 'POST' }); assert.equal(recovered.status, 200);
      } else assert.equal(response.status, 200, await response.text());
      offset += chunk.length;
      if (offset < content.length) {
        // A different browser/session explicitly resumes the matching file, with no persisted browser bytes.
        const same = await post({ type: 'resumeUpload', uploadId, size: String(content.length), sha256 }); assert.equal(same.uploadId, uploadId);
      }
    }
    return uploadId;
  };
  await uploadBytes('corrupt.pdf', Buffer.from('%PDF- this is corrupt\n%%EOF'));
  await until(async () => (await sql(`select count(*) from private.document_jobs where project_id='${project}' and kind='validate' and state='failed';`)).output.trim() === '1', 'corrupt PDF rejected');
  assert.equal((await docState(mrf)).current, current, 'Invalid replacement retained current PDF');
  await second.wait("return !!document.querySelector('.mrf-documents input[type=file]')");
  await second.run(`const dt=new DataTransfer();dt.items.add(new File([Uint8Array.from(atob('${bytes.toString('base64')}'),c=>c.charCodeAt(0))],'kept-local.pdf',{type:'application/pdf'}));const input=document.querySelector('.mrf-documents input[type=file]');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));`);
  const large = await PDFDocument.create(); large.addPage(); await large.attach(randomBytes(3 * 1024 * 1024 + 100), 'synthetic.bin');
  const largeBytes = Buffer.from(await large.save()), resumed = await uploadBytes('resumed.pdf', largeBytes, true);
  await until(async () => (await docState(mrf)).current === resumed, 'resumed PDF committed after lost acknowledgement');
  assert.equal([...drive.files.values()].filter(file => file.appProperties?.hmlUploadId === resumed).length, 1, 'Retry created one provider file');
  await browser.wait("return document.querySelector('.document-current')?.textContent.includes('resumed.pdf')");
  await second.wait("return document.body.innerText.includes('The shared attachment changed after you selected this PDF')");
  assert.equal(await second.run("return document.querySelector('.mrf-documents .primary').disabled"), true, 'File conflict requires explicit review');
  await second.run("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('I reviewed the current attachment')).click()");
  assert.equal(await second.run("return document.querySelector('.mrf-documents .primary').disabled"), false);
  assert.equal(await browser.run("return document.querySelector('input[name=sourceRef]').value"), 'Unsaved details survive file actions');
  for (const width of [1440, 375]) {
    await browser.call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width === 375 });
    await browser.run("document.querySelector('.mobile-scrim')?.click();document.querySelector('.mrf-documents').scrollIntoView()");
    if (width === 375) await browser.wait("return !document.querySelector('.mobile-scrim')&&document.querySelector('.side-nav').getBoundingClientRect().right<=1");
    assert.equal(await browser.run('return document.documentElement.scrollWidth<=innerWidth'), true, 'Attachment controls fit viewport');
    const screenshot = await browser.call('Page.captureScreenshot', { format: 'png' }); await writeFile(`.verification/request-documents-${width}.png`, Buffer.from(screenshot.data, 'base64'));
  }
  await browser.call('Emulation.clearDeviceMetricsOverride');
  // File access and every transfer action are denied immediately after revocation.
  const secondCookie = await cookie(second);
  ok(await client.from('project_assignments').delete().eq('user_id', staff[1].id).eq('project_id', project));
  assert.equal((await http('/api/mrf-documents/files/' + resumed, {}, secondCookie)).status, 401);
  assert.equal((await http('/api/mrf-documents/uploads/' + resumed, { method: 'POST' }, secondCookie)).status, 401);
  // Internal archive fixture exercises the engine; no application approval API exists.
  const manager = { email: `${randomUUID()}@example.invalid`, password: randomUUID() };
  const managerId = ok(await client.auth.admin.createUser({ ...manager, email_confirm: true })).user.id;
  ok(await client.from('profiles').insert({ user_id: managerId, display_name: 'Archive PM', is_active: true }));
  ok(await client.from('role_grants').insert({ user_id: managerId, role: 'Project Manager' }));
  await login(second, manager);
  const managerActor = await actor(second), managerCookie = await cookie(second);
  const snapshotId = randomUUID(), archiveJob = randomUUID();
  const snapshot = { ref: 'CI-MRF-0001', projectName: 'Frozen project', projectLocation: 'Frozen location', draft: { ...draft, items: [{ id: randomUUID(), name: 'Exact quantity', unit: 'pc', quantity: '12345678901234567890.12345', neededDate: '2026-11-03', purpose: '', location: '', remarks: '' }] } };
  const actorJson = JSON.stringify(managerActor);
  const correctedMapping = randomUUID(), correctedFolder = 'drive-' + randomUUID();
  drive.files.set(correctedFolder, { id: correctedFolder, name: 'Corrected destination', mimeType: 'application/vnd.google-apps.folder', parents: [drive.root], trashed: false, capabilities: { canAddChildren: true }, appProperties: {} });
  await sql(`insert into private.mrf_archive_snapshots(id,request_id,version,source_document,request_version,attachment_revision,snapshot,approved_by,approved_name,approved_at) values('${snapshotId}','${mrf}',1,'${resumed}',1,${(await docState(mrf)).revision},$doc$${JSON.stringify(snapshot)}$doc$,'${managerId}','Archive PM','2026-11-03T00:00:00Z');
    insert into private.document_jobs(id,kind,project_id,request_id,resource_id,actor,original_actor,payload,state,checkpoint) values('${archiveJob}','archive','${project}','${mrf}','${snapshotId}',$doc$${actorJson}$doc$,$doc$${actorJson}$doc$,jsonb_build_object('folderMappingId','${originalMapping.id}'),'failed','{"formFileId":"old-partial-file"}');
    update private.project_document_folders set current=false where project_id='${project}';
    insert into private.project_document_folders(id,project_id,folder_id,root_id,name) values('${correctedMapping}','${project}','${correctedFolder}','${drive.root}','Corrected destination');
    insert into private.document_folder_owners values('${correctedFolder}','${project}');`);
  const deniedArchiveRetry = await http('/api/mrf-documents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'retryArchive', operationId: randomUUID(), mrfId: mrf, jobId: archiveJob, useCurrentMapping: true }) });
  assert.equal(deniedArchiveRetry.status, 403, 'Site Personnel cannot retry approved archive work');
  const retry = await http('/api/mrf-documents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'retryArchive', operationId: randomUUID(), mrfId: mrf, jobId: archiveJob, useCurrentMapping: true }) }, managerCookie);
  assert.equal(retry.status, 200, await retry.text());
  await until(async () => (await sql(`select count(*) from private.mrf_archives where snapshot_id='${snapshotId}';`)).output.trim() === '1', 'real Workflow archive pair');
  const archive = await readSql(`select to_jsonb(a) from private.mrf_archives a where snapshot_id='${snapshotId}';`);
  assert.equal(archive.folder_mapping_id, correctedMapping, 'Explicit archive retry uses corrected destination');
  const previous = await readSql(`select payload->'priorAttempts' from private.document_jobs where id='${archiveJob}';`);
  assert.equal(previous[0].checkpoint.formFileId, 'old-partial-file', 'Failed attempt metadata retained');
  assert.equal(drive.files.get(archive.supporting_file_id).body.equals(largeBytes), true, 'Archive supporting bytes exact');
  assert.equal(createHash('sha256').update(drive.files.get(archive.form_file_id).body).digest('hex'), archive.form_sha256);
  await post({ type: 'remove', expectedRevision: (await docState(mrf)).revision });
  await delay(1000);
  assert.equal(drive.files.get([...drive.files.values()].find(f => f.appProperties?.hmlUploadId === resumed).id).trashed, false, 'Approved source retained after remove');
  assert.equal(drive.files.get(archive.supporting_file_id).trashed, false, 'Official archive retained');
  // Avoid discarding an unsaved input through an unattended native dialog.
  await browser.run("Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(document.querySelector('input[name=sourceRef]'),'');document.querySelector('input[name=sourceRef]').dispatchEvent(new Event('input',{bubbles:true}));");
  await browser.run("[...document.querySelectorAll('button')].find(b=>b.textContent==='Save draft')?.click()");
  await browser.wait(`return location.pathname==='/requests/${mrf}'`);
  await logout(browser);
  console.log('Private document sharing, independent saves, Range, corrupt replacement, multi-chunk recovery, revocation and Workflow archive integrity passed.');
  return { staff, manager, bytes };
}

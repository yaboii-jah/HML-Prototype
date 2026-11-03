import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

/** Actual application actions -> checked Postgres -> Workflow -> fake Drive. */
export async function checkMrfReview({ browser, second, client, login, logout, sql, base, drive, staff, manager, bytes }) {
  const ok = result => { assert.equal(result.error, null); return result.data; };
  const actor = async b => {
    const data = await b.run("return await (await fetch('/api/realtime/session')).json()");
    return { userId: data.session.userId, revision: data.session.revision, activeRole: data.session.activeRole, sessionId: data.sessionId };
  };
  const until = async (check, label) => {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) { if (await check()) return; await delay(150); }
    throw Error('MRF review timed out: ' + label);
  };
  const click = (b, label) => b.run(`const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!button||button.disabled)throw Error('Unavailable action: '+${JSON.stringify(label)});button.click();`);
  const current = id => sql(`select private.request_snapshot('${id}');`).then(result => JSON.parse(result.output.trim()));
  const managerActor = await actor(second), operation = randomUUID();
  const project = ok(await client.rpc('project_command', { actor: managerActor, command: { type: 'createProject', requestId: operation, name: 'Review runtime ' + operation, location: 'Frozen review location', code: 'R-' + operation.slice(0,8).toUpperCase(), budget: '100' } })).projectId;
  const scope = randomUUID();
  await sql(`insert into public.scopes(id,project_id,name) values('${scope}','${project}','Structural Works');insert into public.scope_budgets values('${scope}',100);`);
  for (const account of staff) ok(await client.from('project_assignments').insert({ user_id: account.id, project_id: project }));
  await second.navigate('/projects/' + project);
  await second.wait("return document.body.innerText.includes('Current destination:')");
  const mapping = JSON.parse((await sql(`select to_jsonb(f) from private.project_document_folders f where project_id='${project}' and current;`)).output.trim());
  await logout(second); await login(second, staff[1]); await login(browser, staff[0]);
  const siteActor = await actor(second);
  const form = { scopeId: scope, requestDate: '2026-11-03', sourceRef: '', requestedBy: 'Printed requester', approvedBy: 'Printed approver', purchaser: 'Printed buyer', financeOfficer: 'Printed finance', specialInstructions: '',
    items: [{ id: randomUUID(), name: 'Exact material', quantity: '12.125', unit: 'pc', neededDate: '2026-11-04', location: 'Site', purpose: '', remarks: '' }] };
  const mrf = ok(await client.rpc('request_command', { actor: siteActor, command: { type: 'createDraft', requestId: randomUUID(), projectId: project, draft: form } })).record.id;
  await browser.navigate(`/requests/${mrf}/edit`); await second.navigate(`/requests/${mrf}`);
  await browser.wait("return !!document.querySelector('.mrf-documents input[type=file]')&&!document.querySelector('.mrf-documents fieldset').disabled");
  await browser.run(`const dt=new DataTransfer();dt.items.add(new File([Uint8Array.from(atob('${bytes.toString('base64')}'),c=>c.charCodeAt(0))],'review.pdf',{type:'application/pdf'}));const input=document.querySelector('.mrf-documents input[type=file]');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));`);
  await click(browser, 'Upload PDF');
  await second.wait("return document.querySelector('.document-current')?.textContent.includes('review.pdf')");
  await browser.fill('input[name=sourceRef]', 'Preserved across submission');
  await second.wait("return [...document.querySelectorAll('button')].some(b=>b.textContent==='Save and submit'&&!b.disabled)");
  await click(second, 'Save and submit');
  await browser.wait("return document.querySelector('input[name=sourceRef]')?.closest('fieldset').disabled&&document.body.innerText.includes('This request is locked')");
  assert.equal(await browser.run("return document.querySelector('input[name=sourceRef]').value"), 'Preserved across submission');
  await logout(second); await login(second, manager); await second.navigate(`/requests/${mrf}`);
  await second.fill('#mrf-review-heading ~ .field textarea', 'Clarify the request');
  await click(second, 'Return for changes');
  await browser.wait("return document.body.innerText.includes('Returned')&&!document.querySelector('input[name=sourceRef]').closest('fieldset').disabled");
  await click(browser, 'I reviewed the latest MRF; keep my draft');
  await click(browser, 'I reviewed the current request');
  await click(browser, 'Save and submit');
  await browser.wait(`return location.pathname==='/requests/${mrf}'`);
  await second.wait("return document.body.innerText.includes('The request changed.')");
  await click(second, 'I reviewed the current request');
  // A genuine provider failure keeps approval committed and offers PM retry.
  drive.files.get(mapping.folder_id).trashed = true;
  await click(second, 'Approve MRF');
  await until(async () => (await current(mrf)).status === 'approved', 'approval committed');
  await second.wait("return document.body.innerText.includes('Retry approved archive')");
  assert.equal((await current(mrf)).procurementReady, false);
  drive.files.get(mapping.folder_id).trashed = false;
  await click(second, 'Retry approved archive');
  await until(async () => (await current(mrf)).procurementReady, 'verified archive completion');
  await browser.wait("return document.body.innerText.includes('Approved document versions')&&document.body.innerText.includes('Archive complete')");
  const cookie = (await browser.call('Network.getAllCookies')).cookies.filter(c => c.domain === '127.0.0.1').map(c => `${c.name}=${c.value}`).join('; ');
  const files = JSON.parse((await sql(`select jsonb_agg(to_jsonb(f)) from private.mrf_archive_files f join private.mrf_archive_snapshots s on s.id=f.snapshot_id where s.request_id='${mrf}';`)).output.trim());
  for (const file of files) {
    const response = await fetch(base + '/api/mrf-documents/files/' + file.id, { headers: { Cookie: cookie, Origin: base } });
    assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /private.*no-store/);
    const body = Buffer.from(await response.arrayBuffer()); assert.equal(body.length, file.size);
    if (file.kind === 'supporting') assert.equal(createHash('sha256').update(body).digest('hex'), createHash('sha256').update(bytes).digest('hex'));
    const range = await fetch(base + '/api/mrf-documents/files/' + file.id, { headers: { Cookie: cookie, Origin: base, Range: 'bytes=0-4' } });
    assert.equal(range.status, 206); assert.equal(await range.text(), '%PDF-');
  }
  const procurement = { email: randomUUID()+'@example.invalid', password: randomUUID() };
  procurement.id = ok(await client.auth.admin.createUser({ ...procurement, email_confirm: true })).user.id;
  ok(await client.from('profiles').insert({ user_id: procurement.id, display_name: 'Review Procurement', is_active: true }));
  ok(await client.from('role_grants').insert({ user_id: procurement.id, role: 'Procurement' }));
  await logout(second); await login(second, procurement); await second.navigate(`/requests/${mrf}`);
  await second.fill('#mrf-review-heading ~ .field textarea', 'Correct the requirement');
  await click(second, 'Open correction');
  await browser.wait("return document.body.innerText.includes('Full correction')");
  assert.equal((await current(mrf)).procurementReady, false);
  await browser.navigate(`/requests/${mrf}/edit`);
  await browser.fill('input[name=sourceRef]', 'Corrected requirement');
  await click(browser, 'Save and submit');
  await browser.wait(`return location.pathname==='/requests/${mrf}'`);
  await logout(second); await login(second, manager); await second.navigate(`/requests/${mrf}`);
  assert.equal(await second.run("return [...document.querySelectorAll('button')].some(b=>b.textContent==='Reject MRF')"), false);
  await click(second, 'Approve MRF');
  await until(async () => (await current(mrf)).procurementReady, 'corrected archive completion');
  await browser.wait("return document.body.innerText.includes('Version 2')&&document.body.innerText.includes('Version 1')");
  assert.equal((await sql(`select count(*) from private.mrf_archive_files f join private.mrf_archive_snapshots s on s.id=f.snapshot_id where s.request_id='${mrf}';`)).output.trim(), '4');
  for (const width of [1440,375]) {
    await browser.call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width===375 });
    await browser.run("document.querySelector('.mobile-scrim')?.click();document.querySelector('#mrf-review-heading').scrollIntoView()");
    if(width===375)await browser.wait("return !document.querySelector('.mobile-scrim')&&document.querySelector('.side-nav').getBoundingClientRect().right<=1");
    assert.equal(await browser.run('return document.documentElement.scrollWidth<=innerWidth'),true);
    const shot=await browser.call('Page.captureScreenshot',{format:'png'});await writeFile(`.verification/request-review-${width}.png`,Buffer.from(shot.data,'base64'));
  }
  await browser.call('Emulation.clearDeviceMetricsOverride');
  await logout(browser);
  console.log('Real submission/review actions, dirty collaborator locks, PM archive failure/retry, private approved PDFs and corrected versions passed.');
}

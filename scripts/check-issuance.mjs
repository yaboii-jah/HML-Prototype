import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

/** Actual UI actions against isolated Auth/Postgres/Realtime and loopback Drive. */
export async function checkIssuance({ browser, second, sql, drive, login, logout, poId, mrf, quote, procurement, colleague, accountant }) {
  const saved = async () => JSON.parse((await sql(`select private.purchasing_record_view('${poId}');`)).output.trim());
  const until = async (read, label) => {
    const end = Date.now() + 60000;
    while (Date.now() < end) { if (await read()) return; await delay(100); }
    throw Error('Issuance timeout: ' + label);
  };
  const click = async (page, label) => {
    const expression = `const root=document.querySelector('dialog[open]')||document;const b=[...root.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled);`;
    if (!await page.run("return !!document.querySelector('dialog[open]')")) {
      await page.wait("if(document.querySelector('dialog[open]'))return true;" + expression + 'b?.click();return false;');
    } else { await page.wait(expression + 'return !!b;'); await page.run(expression + 'b.click();'); }
  };
  const field = async (page, label, value, select = false) => {
    // CDP helpers use CSS selectors; locate by the actual label text instead.
    await page.run(`const label=[...document.querySelectorAll('dialog[open] label')].find(l=>l.querySelector('span')?.textContent===${JSON.stringify(label)});const el=label?.querySelector('input:not([type=checkbox]),textarea,select');if(!el)throw Error('Sending field missing');const setter=Object.getOwnPropertyDescriptor(el instanceof HTMLSelectElement?HTMLSelectElement.prototype:el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set;setter.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('${select ? 'change' : 'input'}',{bubbles:true}));`);
  };
  const declare = page => page.click('dialog[open] input[type=checkbox]');
  const close = page => page.click('dialog[open] .record-modal-close');
  const capture = async (page, suffix) => {
    await mkdir('.impeccable/review', { recursive: true });
    await page.wait("return !document.querySelector('.foundation-status')");
    for (const width of [1440, 375]) {
      await page.call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 600 });
      await page.run("document.querySelector('.mobile-scrim')?.click();await document.fonts.ready;document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().endTime)).forEach(a=>a.finish());const h=[...document.querySelectorAll('h3')].find(h=>h.textContent==='Supplier issuance');if(!document.querySelector('dialog[open]')){h?.scrollIntoView();window.scrollBy(0,-100);}");
      const screenshot = await page.call('Page.captureScreenshot', { format: 'png' });
      await writeFile(`.verification/issuance-${suffix}-${width}.png`, Buffer.from(screenshot.data, 'base64'));
      if (suffix === 'issued') await writeFile(`.impeccable/review/${width === 1440 ? 'desktop' : 'mobile'}.png`, Buffer.from(screenshot.data, 'base64'));
      assert.equal(await page.run('return document.documentElement.scrollWidth<=innerWidth+1'), true, 'Issuance fits viewport');
    }
    await page.call('Emulation.clearDeviceMetricsOverride');
  };

  await browser.navigate(`/purchase-orders/${poId}`);
  // Rebinding intentionally invalidates each saved adjustment confirmation.
  await click(browser, 'Edit saved preparation');
  await field(browser, 'Payment arrangement', 'upfront', true);
  await field(browser, 'Agreement against quotation', 'differs', true);
  await field(browser, 'Agreed difference and reason', 'Supplier confirmed upfront terms for the rebound QA order');
  await browser.run("for(const label of document.querySelectorAll('dialog[open] label.field')){if(label.textContent.includes('Confirm this saved inclusion and amount')){const input=label.querySelector('input[type=checkbox]');if(input&&!input.disabled&&!input.checked)input.click();}}");
  await click(browser, 'Save preparation');
  await browser.wait("return !document.querySelector('dialog[open]')");
  await browser.wait("return [...document.querySelectorAll('dt')].some(dt=>dt.textContent==='Terms review'&&dt.nextElementSibling?.textContent==='Supplier confirmed upfront terms for the rebound QA order');");
  await click(browser, 'Confirm saved preparation'); await click(browser, 'Confirm saved preparation');
  await browser.wait("return !document.querySelector('dialog[open]')");
  await until(async () => (await saved()).checked, 'saved rebind confirmation');
  await click(browser, 'Submit to Accounting'); await click(browser, 'Submit to Accounting');
  await browser.wait("return !document.querySelector('dialog[open]')");
  await logout(second); await login(second, accountant);
  await second.navigate(`/accounting/${poId}`);
  await click(second, 'Approve PO'); await click(second, 'Approve PO');
  await second.wait("return !document.querySelector('dialog[open]')");
  await until(async () => {
    const p = await saved();
    return p.review.approvals.some(a => a.id === p.review.approvalId && a.archiveState === 'complete');
  }, 'new approved PDF');
  const before = await saved();
  const proof = JSON.parse((await sql(`select private.issuance_files('${poId}');`)).output.trim());
  const ownedFile = drive.files.get(proof.files[2].id);
  assert.ok(ownedFile);
  ownedFile.trashed = true;
  await click(browser, 'Prepare to send'); await click(browser, 'Prepare to send');
  await browser.wait("return document.querySelector('dialog[open] [role=alert]')?.textContent.includes('Nothing was prepared')");
  assert.equal((await saved()).issuance.status, 'notIssued');
  await close(browser); ownedFile.trashed = false;

  // Drop only this action's response after the real server has committed it.
  await browser.run(`window.__issuanceFetch=window.fetch;window.fetch=async function(...args){const response=await window.__issuanceFetch.apply(this,args);const request=args[0],init=args[1];if((init?.method||request?.method||'GET').toUpperCase()==='POST'&&new URL(typeof request==='string'?request:request.url,location.href).pathname===location.pathname){window.fetch=window.__issuanceFetch;await response.clone().text();throw Error('Owned lost issuance acknowledgement');}return response;};`);
  await click(browser, 'Prepare to send'); await click(browser, 'Prepare to send');
  await until(async () => (await saved()).issuance.status === 'prepared', 'prepared after lost acknowledgement');
  await browser.wait("return [...document.querySelectorAll('button')].some(b=>b.textContent==='Check saved outcome')");
  const calls = drive.calls;
  await click(browser, 'Check saved outcome');
  await browser.wait("return !document.querySelector('dialog[open]')");
  assert.equal(drive.calls, calls, 'Preparation replay uses its receipt without another Drive check');
  await second.wait("return document.body.textContent.includes('Prepared to send')");
  assert.equal(await second.run("return [...document.querySelectorAll('button')].find(b=>b.textContent==='Revoke approval')?.disabled"), true);
  await browser.wait("return [...document.querySelectorAll('p')].some(p=>p.textContent.trim()==='Sending status: Prepared to send')");
  await capture(browser, 'prepared');

  await logout(second); await login(second, colleague);
  await second.navigate(`/purchase-orders/${poId}`);
  await click(second, 'Cancel preparation');
  await field(second, 'Reason (at least five characters)', 'Colleague confirmed the documents were not sent');
  assert.equal(await second.run("return document.querySelector('dialog[open] .button.primary').disabled"), true);
  await declare(second); await click(second, 'Cancel preparation');
  await second.wait("return !document.querySelector('dialog[open]')");
  await browser.wait("return document.body.textContent.includes('Not issued')");
  let p = await saved();
  assert.equal(p.issuance.cancellations[0].preparedBy.userId, procurement.id);
  assert.equal(p.issuance.cancellations[0].actor.userId, colleague.id);

  await click(browser, 'Prepare to send'); await click(browser, 'Prepare to send');
  await browser.wait("return !document.querySelector('dialog[open]')");
  await second.wait("return document.body.textContent.includes('Prepared to send')");
  await click(second, 'Confirm sent');
  await field(second, 'Sending channel', 'email', true);
  await field(second, 'Recipient name / contact', 'QA supplier contact <supplier@example.invalid>');
  await field(second, 'Actually sent (Philippine date and time)', new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 19));
  await declare(second);
  const reason = 'Keep this entry while prerequisites change';
  await field(second, 'Sending notes (optional)', reason);
  await sql(`begin;update private.account_guard set revision=revision+1 where id;update public.projects set version=version+1 where id='${before.review.budget.projectId}';commit;`);
  await second.wait("return document.querySelector('dialog[open]')?.textContent.includes('Your entries are preserved')");
  assert.equal(await second.run("return [...document.querySelectorAll('dialog[open] textarea')][0].value"), reason);
  await click(second, 'I reviewed the latest values');
  await capture(second, 'confirm');
  // Provider unavailability after preparation cannot erase an actual sending.
  ownedFile.trashed = true;
  const confirmCalls = drive.calls;
  await click(second, 'Confirm sent');
  await second.wait("return !document.querySelector('dialog[open]')");
  await until(async () => (await saved()).issuance.status === 'issued', 'actual issuance');
  assert.equal(drive.calls, confirmCalls, 'Confirm sent makes no Drive request');
  ownedFile.trashed = false;
  p = await saved();
  assert.equal(p.issuance.issuance.actor.userId, colleague.id);
  assert.equal(p.issuance.preparation.actor.userId, procurement.id);
  assert.equal(p.review.budget.committed, before.review.budget.committed);
  await browser.wait("return document.body.textContent.includes('Sending status: Issued')");
  await second.wait("return [...document.querySelectorAll('p')].some(p=>p.textContent.trim()==='Sending status: Issued')");
  await capture(second, 'issued');
  await click(second, 'Correct sending details');
  await field(second, 'Sending channel', 'chat', true);
  await field(second, 'Recipient name / contact', 'QA corrected supplier contact');
  await field(second, 'Reason (at least five characters)', 'Corrected the supplier contact and actual channel');
  await declare(second); await click(second, 'Correct sending details');
  await second.wait("return !document.querySelector('dialog[open]')");
  p = await saved();
  assert.equal(p.issuance.corrections.length, 1);
  assert.equal(p.issuance.issuance.originalDetails.channel, 'email');
  assert.equal(p.issuance.issuance.details.channel, 'chat');
  await logout(second); await login(second, accountant);
  await second.navigate(`/accounting/${poId}`);
  await second.wait("return document.body.textContent.includes('Sending status: Issued')");
  assert.equal(await second.run("return [...document.querySelectorAll('button')].find(b=>b.textContent==='Revoke approval')?.disabled"), true);
  assert.equal(await second.run("return [...document.querySelectorAll('button')].some(b=>b.textContent==='Correct sending details')"), false);
  await logout(second); await login(second, colleague);
  await browser.navigate(`/requests/${mrf}/quotes/${quote}`);
  await second.navigate(`/requests/${mrf}/quotes/${quote}`);
  console.log('Issuance live-file failure/retry, lost acknowledgement, colleague handoff, conflicts, realtime, permanent lock and corrections passed.');
  return { poId, issuanceId: p.issuance.issuance.id };
}

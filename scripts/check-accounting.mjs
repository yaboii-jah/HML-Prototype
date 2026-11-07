import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { formatPhp } from '../src/domain/projects/projects.ts';

export async function checkAccounting({ browser, second, sql, base, drive, mrf, quote, poId, login, logout, procurement, preparer, accountant, manager }) {
  const until = async (read, label) => {
    const end = Date.now() + 60000;
    while (Date.now() < end) { if (await read()) return; await delay(150); }
    throw Error('Accounting timeout: ' + label);
  };
  const click = async (page, label) => {
    const expression = `const root=document.querySelector('dialog[open]')||document;const b=[...root.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled);`;
    if (!await page.run("return !!document.querySelector('dialog[open]')")) {
      // Opening a review/editor has no business effect. Retry only this opener
      // while navigation hydrates; confirmations inside the dialog run once.
      await page.wait("if(document.querySelector('dialog[open]'))return true;" + expression + "b?.click();return false;");
      return;
    }
    await page.wait(expression + 'return !!b;');
    await page.run(expression + 'b.click();');
  };
  const field = async (page, label, value, select = false) => {
    const expression = `const f=[...document.querySelectorAll('dialog[open] label.field')].find(l=>l.querySelector('span')?.textContent.startsWith(${JSON.stringify(label)}));const input=f?.querySelector(${JSON.stringify(select ? 'select' : 'input,textarea')});`;
    await page.wait(expression + 'return !!input&&!input.disabled;');
    if (select) await page.run(expression + `input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('change',{bubbles:true}));`);
    else {
      await page.run(expression + "document.querySelectorAll('#accounting-field').forEach(el=>el.removeAttribute('id'));input.id='accounting-field';");
      await page.fill('#accounting-field', value);
    }
  };
  const saved = async () => JSON.parse((await sql(`select private.purchasing_record_view('${poId}');`)).output.trim());
  const cookie = async (page) => (await page.call('Network.getAllCookies')).cookies.filter((c) => c.domain === '127.0.0.1').map((c) => `${c.name}=${c.value}`).join('; ');
  const reasonAction = async (page, label, reason, confirmation = label) => {
    await click(page, label);
    await field(page, 'Reason (at least five characters)', reason);
    await click(page, confirmation);
    await page.wait("return !document.querySelector('dialog[open]')");
  };
  const capture = async (page, suffix) => {
    await page.wait("return !document.querySelector('.foundation-status');");
    await mkdir('.impeccable/review', { recursive: true });
    for (const width of [1440, 375]) {
      await page.call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 600 });
      await page.run("document.querySelector('.mobile-scrim')?.click();window.scrollTo(0,0);await document.fonts.ready;document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().endTime)).forEach(a=>a.finish());");
      const size = await page.call('Page.getLayoutMetrics');
      const screenshot = await page.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
        clip: { x: 0, y: 0, width, height: Math.ceil(size.cssContentSize.height), scale: 1 } });
      await writeFile(`.verification/accounting-${suffix}-${width}.png`, Buffer.from(screenshot.data, 'base64'));
      if (suffix === 'approved') await writeFile(`.impeccable/review/${width === 1440 ? 'desktop' : 'mobile'}.png`, Buffer.from(screenshot.data, 'base64'));
      assert.equal(await page.run('return document.documentElement.scrollWidth<=innerWidth+1'), true, 'Accounting layout fits viewport');
    }
    await page.call('Emulation.clearDeviceMetricsOverride');
  };

  await browser.navigate(`/purchase-orders/${poId}`);
  await click(browser, 'Edit saved preparation');
  await field(browser, 'Payment arrangement', 'upfront', true);
  await field(browser, 'Agreement against quotation', 'differs', true);
  await field(browser, 'Agreed difference and reason', 'Supplier confirmed this upfront purchase arrangement');
  await click(browser, 'Save preparation');
  await browser.wait("return !document.querySelector('dialog[open]')");
  await browser.wait("return [...document.querySelectorAll('dt')].some(dt=>dt.textContent==='Terms review'&&dt.nextElementSibling?.textContent==='Supplier confirmed this upfront purchase arrangement');");
  await click(browser, 'Confirm saved preparation'); await click(browser, 'Confirm saved preparation');
  await browser.wait("return !document.querySelector('dialog[open]')");
  await until(async () => (await saved()).checked, 'fresh saved preparation');
  await click(browser, 'Submit to Accounting'); await click(browser, 'Submit to Accounting');
  await browser.wait("return !document.querySelector('dialog[open]')");
  await until(async () => (await saved()).review.status === 'submitted', 'submission');
  assert.equal((await saved()).review.budget.committed, '0', 'Submission does not reserve money');
  await logout(second); await login(second, accountant);
  await second.navigate(`/accounting/${poId}`);
  await click(second, 'Hold PO');
  const preserved = 'Wait for supplier coordination without losing this review reason';
  await field(second, 'Reason (at least five characters)', preserved);
  await reasonAction(browser, 'Recall PO', 'Procurement recalled the pending review for a source check');
  await second.wait("return document.querySelector('dialog[open]')?.textContent.includes('The PO, source, MRF or budget changed')");
  assert.equal(await second.run("return document.querySelector('dialog[open] textarea').value"), preserved);
  await click(second, 'I reviewed the latest values');
  await click(browser, 'Confirm saved preparation'); await click(browser, 'Confirm saved preparation');
  await browser.wait("return !document.querySelector('dialog[open]')");
  await until(async () => (await saved()).checked, 'recalled preparation');
  await click(browser, 'Submit to Accounting'); await click(browser, 'Submit to Accounting');
  await browser.wait("return !document.querySelector('dialog[open]')");
  await until(async () => (await saved()).review.status === 'submitted', 'resubmission');
  await second.wait("return [...document.querySelectorAll('p')].some(p=>p.textContent?.startsWith('Review status: submitted.'));");
  await second.wait("return document.querySelector('dialog[open]')?.textContent.includes('The PO, source, MRF or budget changed')");
  await click(second, 'I reviewed the latest values');
  await click(second, 'Hold PO');
  await until(async () => (await saved()).review.status === 'held', 'Accounting Hold');
  await second.wait("return !document.querySelector('dialog[open]')");
  const before = await saved();
  // Fund this run's synthetic project before exercising the PM allocation UI.
  // The quotation fixture deliberately starts with only PHP 100 of project budget.
  await sql(`begin; update private.account_guard set revision=revision+1 where id;
    update public.projects set version=version+1 where id='${before.review.budget.projectId}';
    update public.project_budgets set amount=greatest(amount,
      coalesce((select sum(b.amount) from public.scope_budgets b join public.scopes s on s.id=b.scope_id
        where s.project_id='${before.review.budget.projectId}'),0)+${before.calculation.gross}::numeric)
      where project_id='${before.review.budget.projectId}'; commit;`);
  // Set the allocation to exactly this gross through the existing PM screen.
  // The following document-only MRF correction must work with zero remainder.
  await logout(browser); await login(browser, manager);
  await browser.navigate(`/projects/${before.review.budget.projectId}`);
  await browser.wait(`const row=document.querySelector('[data-scope-id="${before.review.budget.scopeId}"]');return !!row;`);
  await browser.wait(`const row=document.querySelector('[data-scope-id="${before.review.budget.scopeId}"]');[...row.querySelectorAll('button')].find(b=>b.textContent.trim()==='Edit allocation')?.click();return !!document.querySelector('.scope-editor input[name=scopeBudget]');`);
  await browser.wait("return !!document.querySelector('.scope-editor input[name=scopeBudget]')");
  await browser.fill('input[name=scopeBudget]', before.calculation.gross);
  await browser.click('.scope-editor .form-actions .primary');
  await browser.wait("return !!document.querySelector('.confirm-dialog[open]')");
  await browser.click('.confirm-dialog[open] .primary');
  await browser.wait("return !document.querySelector('dialog[open]')");
  await second.wait(`return [...document.querySelectorAll('dt')].some(dt=>dt.textContent==='Scope allocation'&&dt.nextElementSibling?.textContent===${JSON.stringify(formatPhp(before.calculation.gross))});`);
  await logout(browser); await login(browser, preparer);
  await browser.navigate(`/purchase-orders/${poId}`);
  const providerCount = drive.files.size;
  drive.faults.loseFinalResponse = true;
  await click(second, 'Approve PO'); await click(second, 'Approve PO');
  await second.wait("return !document.querySelector('dialog[open]')");
  await until(async () => (await saved()).review.status === 'approved', 'Accounting approval');
  await until(async () => (await saved()).review.approvals[0].archiveState === 'failed', 'lost archive acknowledgement');
  const approved = await saved();
  assert.equal(approved.review.budget.committed, approved.calculation.gross, 'Budget uses gross before EWT');
  assert.equal(Number(approved.review.budget.uncommitted), 0, 'Approved gross consumes the exact reviewed allocation');
  assert.equal(approved.review.budget.scopeId, before.review.budget.scopeId);
  await reasonAction(second, 'Retry approved PDF v1', 'Retry frozen approved PDF after the interrupted provider response', 'Retry approved PDF archive');
  await until(async () => (await saved()).review.approvals[0].archiveState === 'complete', 'approved archive reconciliation');
  const current = await saved(), archive = current.review.approvals[0];
  assert.equal(drive.files.size, providerCount + 1, 'Lost acknowledgement and retry do not duplicate the approved PDF');
  const response = await fetch(base + `/api/approved-purchase-orders/${archive.archiveId}`, { headers: { Cookie: await cookie(second) } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /private.*no-store/);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  const expectedHash = (await sql(`select sha256 from private.po_archives where job_id='${archive.archiveId}';`)).output.trim();
  assert.equal(createHash('sha256').update(bytes).digest('hex'), expectedHash);
  const range = await fetch(base + `/api/approved-purchase-orders/${archive.archiveId}`, { headers: { Cookie: await cookie(second), Range: 'bytes=0-4' } });
  assert.equal(range.status, 206); assert.equal(await range.text(), '%PDF-');
  await writeFile('.verification/accounting-approved-po.pdf', bytes);
  await second.wait("return [...document.querySelectorAll('a')].some(a=>a.textContent==='Open approved PDF v1');");
  await capture(second, 'approved');
  await second.navigate('/accounting');
  await second.wait("return !!document.querySelector('select')");
  await second.wait(`if(document.querySelector('a[href="/accounting/${poId}"]'))return true;const s=document.querySelector('.toolbar select');s.value='approved';s.dispatchEvent(new Event('change',{bubbles:true}));return false;`);
  await capture(second, 'queue');
  await second.navigate(`/projects/${current.review.budget.projectId}`);
  await second.wait("return document.body.textContent.includes('Committed gross')&&document.body.textContent.includes('Uncommitted scope allocation')");
  await capture(second, 'budget');
  await logout(second); await login(second, procurement);
  await browser.navigate(`/requests/${mrf}/quotes/${quote}`);
  await second.navigate(`/requests/${mrf}/quotes/${quote}`);
  return { poId, archiveId: archive.archiveId, approvalId: archive.id, gross: approved.calculation.gross };
}

export async function reviewApprovedPo({ second, login, logout, sql, poId, accountant, procurement, mrf, quote, action }) {
  await logout(second); await login(second, accountant);
  await second.navigate(`/accounting/${poId}`);
  const label = action === 'reconfirmPo' ? 'Confirm corrected MRF applicability' : 'Revoke approval';
  const click = async () => {
    const expression = `const root=document.querySelector('dialog[open]')||document;const b=[...root.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled);`;
    if (!await second.run("return !!document.querySelector('dialog[open]')")) {
      await second.wait("if(document.querySelector('dialog[open]'))return true;" + expression + "b?.click();return false;");
      return;
    }
    await second.wait(expression + 'return !!b;'); await second.run(expression + 'b.click();');
  };
  await click(); await second.fill('dialog[open] textarea', action === 'reconfirmPo' ? 'Accounting reviewed the corrected archived MRF against the unchanged approved purchase' : 'Revoke unissued approval so Procurement can review the replacement quotation');
  await click(); await second.wait("return !document.querySelector('dialog[open]')");
  const po = JSON.parse((await sql(`select private.purchasing_record_view('${poId}');`)).output.trim());
  if (action === 'reconfirmPo') {
    assert.equal(po.review.status, 'approved');
    assert.deepEqual(po.blockers, []);
  } else {
    assert.equal(po.review.status, 'returned');
    assert.equal(Number(po.review.budget.committed), 0);
  }
  await logout(second); await login(second, procurement);
  await second.navigate(`/requests/${mrf}/quotes/${quote}`);
}

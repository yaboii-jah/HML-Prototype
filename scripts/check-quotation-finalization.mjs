import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { checkPurchasing, checkPurchasingRebind } from "./check-purchasing.mjs";
import { checkAccounting, reviewApprovedPo } from "./check-accounting.mjs";
import {
  emptyQuoteBody,
  emptyQuoteLine,
} from "../src/domain/quotations/drafts.ts";

/** Real application actions, isolated Auth/Postgres, real Workflow and loopback Drive. */
export async function checkQuotationFinalization(options) {
  try {
    return await checkFinalization(options);
  } catch (error) {
    for (const [index, page] of [options.browser, options.second].entries()) {
      const shot = await page
        .call("Page.captureScreenshot", { format: "png" })
        .catch(() => null);
      if (shot)
        await writeFile(
          `.verification/quotation-finalization-failure-${index}.png`,
          Buffer.from(shot.data, "base64"),
        );
      console.error(
        "Finalization failure state:",
        await page
          .run(
            "return [...document.querySelectorAll('[role=alert],.quotation-originals,.quotation-readiness,.quotation-revision')].map(el=>el.textContent).join(' | ')",
          )
          .catch(() => "unavailable"),
      );
    }
    throw error;
  }
}
async function checkFinalization({
  browser,
  second,
  client,
  login,
  logout,
  sql,
  base,
  drive,
  mrf,
  staff,
  manager,
  bytes,
}) {
  const ok = (result) => {
    assert.equal(result.error, null);
    return result.data;
  };
  const until = async (check, label) => {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      if (await check()) return;
      await delay(150);
    }
    throw Error("Financial workflow timed out: " + label);
  };
  const accounts = [];
  for (const role of ["Procurement", "Procurement", "Accounting"]) {
    const account = {
      email: randomUUID() + "@example.invalid",
      password: randomUUID(),
    };
    account.id = ok(
      await client.auth.admin.createUser({ ...account, email_confirm: true }),
    ).user.id;
    ok(
      await client.from("profiles").insert({
        user_id: account.id,
        display_name: "Financial " + role,
        is_active: true,
      }),
    );
    ok(await client.from("role_grants").insert({ user_id: account.id, role }));
    accounts.push(account);
  }
  const actor = async (page) => {
    const data = await page.run(
      "return await (await fetch('/api/realtime/session')).json()",
    );
    return {
      userId: data.session.userId,
      revision: data.session.revision,
      activeRole: data.session.activeRole,
      sessionId: data.sessionId,
    };
  };
  const click = async (page, label) => {
    const expression = `const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled);`;
    await page.wait(expression + "return !!button;");
    await page.run(expression + "button.click();");
  };
  const select = async (page, label, value) => {
    const expression = `const field=[...document.querySelectorAll('.quotation-financial-review label.field')].find(el=>el.querySelector('span')?.textContent===${JSON.stringify(label)});const input=field?.querySelector('select');`;
    await page.wait(expression + "return !!input&&!input.disabled;");
    await page.run(
      expression +
        `input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('change',{bubbles:true}));`,
    );
  };
  const readyQuotationEditor = async (page) => {
    // Opening a harmless details dialog proves this client boundary is hydrated
    // before assigning a synthetic file selection or dispatching form input.
    await page.wait(
      "if(!document.querySelector('.record-dialog'))[...document.querySelectorAll('button')].find(b=>b.textContent==='Line details'&&!b.disabled)?.click();return !!document.querySelector('.record-dialog input[name=line-description]')",
    );
    await click(page, "Close line details");
  };
  const current = (quote) =>
    sql(`select private.quotation_view('${quote}');`).then((result) =>
      JSON.parse(result.output.trim()),
    );
  const saveFinancial = async (page) => {
    await click(page, "Save financial review");
    await page.wait(
      "return document.querySelector('.quotation-financial-review')?.textContent.includes('Financial review saved.')",
    );
  };
  const confirmSource = async (page) => {
    await click(page, "Line details");
    await click(page, "Confirm material match");
    await page.wait(
      "return document.querySelector('.quotation-source-table')?.textContent.includes('Confirmed')",
    );
    await click(page, "Close line details");
    await click(page, "Entered data checked against originals");
    await page.wait(
      "return document.querySelector('.quotation-review-status')?.textContent.includes('Entered data checked against the saved originals.')",
    );
  };
  const finalize = async (page) => {
    await click(page, "Confirm saved financial review and PHP");
    await click(page, "Finalize quotation revision");
    await click(page, "Finalize and archive revision");
    await page.wait(
      "return document.querySelector('.quotation-revision')?.textContent.includes('Finalized revision')",
      60000,
    );
  };
  const reasonAction = async (page, button, reason, submit) => {
    await click(page, button);
    await page.fill("textarea[name=revisionReason]", reason);
    await click(page, submit);
  };
  await login(browser, accounts[0]);
  await login(second, accounts[1]);
  const buyer = await actor(browser),
    colleague = await actor(second);
  const parent = ok(
    await client.rpc("quotations_read", { actor: buyer, target_request: mrf }),
  ).request;
  const item = parent.items[0];
  const supplier = ok(
    await client.rpc("supplier_command", {
      actor: buyer,
      command: {
        type: "createSupplier",
        requestId: randomUUID(),
        profile: {
          name: "Financial offer " + randomUUID(),
          address: "",
          tin: "",
          contactName: "",
          email: "",
          phone: "",
          accreditationNote: "",
        },
      },
    }),
  ).supplierId;
  const material = {
    ...emptyQuoteLine(),
    description: item.name,
    quantity: "2",
    unit: item.unit,
    unitPrice: "112.0000",
    conversionFactor: "1",
    requestItemId: item.id,
    printedTotal: "224",
  };
  const free = {
    ...emptyQuoteLine(),
    description: "Free supplier sample",
    quantity: "1",
    unit: "pc",
    unitPrice: "0",
  };
  const alternative = {
    ...emptyQuoteLine(),
    description: "Reference-only alternative",
    quantity: "1",
    unit: "pc",
    unitPrice: "500",
  };
  const delivery = {
    id: randomUUID(),
    label: "Delivery fee",
    kind: "delivery",
    basis: "fixed",
    value: "112",
    taxable: "VAT",
    sourceDetails: "Supplier delivery service",
  };
  const tax = {
    id: randomUUID(),
    label: "VAT included summary",
    kind: "VAT",
    basis: "summary",
    value: "36",
    taxable: "",
    sourceDetails: "Already included, count once",
  };
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const body = {
    ...emptyQuoteBody(),
    supplierName: "Supplier as quoted",
    ref: "FIN-" + randomUUID().slice(0, 8),
    date: today,
    paymentTerms: "30 days credit",
    deliveryTerms: "Delivered to project",
    vatRate: "12",
    printedSubtotal: "224",
    printedTax: "36",
    printedTotal: "332",
    lines: [material, free, alternative],
    adjustments: [delivery, tax],
  };
  const quote = ok(
    await client.rpc("quotation_command", {
      actor: buyer,
      command: {
        type: "create",
        requestId: randomUUID(),
        mrfId: mrf,
        supplierId: supplier,
        body,
      },
    }),
  ).quoteId;
  const path = `/requests/${mrf}/quotes/${quote}`;
  await browser.navigate(path);
  await browser.wait(
    "return !!document.querySelector('.quotation-originals input[type=file]')",
  );
  await readyQuotationEditor(browser);
  await browser.run(
    `const data=new DataTransfer();data.items.add(new File([Uint8Array.from(atob('${bytes.toString("base64")}'),c=>c.charCodeAt(0))],'financial-original.pdf',{type:'application/pdf'}));const input=document.querySelector('.quotation-originals input[type=file]');input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));`,
  );
  await click(browser, "Save original group");
  await browser.wait(
    "return document.querySelector('.quotation-originals')?.textContent.includes('financial-original.pdf')&&!document.body.innerText.includes('Group uploading')",
    60000,
  );
  await confirmSource(browser);
  await click(browser, "Keep my classifications with reviewed source");
  await select(browser, "VAT classification", "VAT");
  await select(browser, "Price basis", "inclusive");
  await browser.fill("input[name=reviewVatRate]", "12");
  await select(browser, "Line 1 classification", "material");
  await browser.run(
    `document.querySelector('[data-financial-row="${free.id}"]').open=true;`,
  );
  await select(browser, "Line 2 classification", "material");
  await browser.run(
    `const el=document.querySelector('[data-financial-row="${free.id}"] input[type=checkbox]');el.click();`,
  );
  await browser.run(
    `document.querySelector('[data-financial-row="${alternative.id}"]').open=true;`,
  );
  await select(browser, "Line 3 classification", "reference");
  await browser.fill(
    `[data-financial-row="${alternative.id}"] textarea`,
    "Alternative excluded from the supplier total",
  );
  await select(browser, "Adjustment 1 classification", "shipping");
  await select(browser, "Adjustment 1 calculation", "fixed");
  await select(browser, "Adjustment 1 tax treatment", "true");
  await browser.run(
    `document.querySelector('[data-financial-adjustment="${tax.id}"]').open=true;`,
  );
  await select(browser, "Adjustment 2 classification", "summary");
  await select(browser, "Adjustment 2 summary basis", "vat");
  await browser.fill(
    `[data-financial-adjustment="${tax.id}"] textarea`,
    "Duplicate VAT summary already included",
  );
  await browser.wait(
    "return document.querySelector('.quotation-readiness')?.textContent.includes('Printed total does not match')",
  );
  await select(browser, "Printed total represents", "net");
  await saveFinancial(browser);
  let saved = await current(quote);
  assert.equal(saved.financial.calculation.gross, "336.00");
  assert.equal(saved.financial.calculation.net, "332.00");
  assert.equal(saved.body.currency, "");
  assert.deepEqual(saved.financial.calculation.issues, []);
  for (const width of [1440, 375]) {
    await browser.call("Emulation.setDeviceMetricsOverride", {
      width,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: width === 375,
    });
    await browser.run(
      "document.querySelector('.mobile-scrim')?.click();document.querySelector('.quotation-financial-review').scrollIntoView();window.scrollBy(0,-88)",
    );
    if (width === 375)
      await browser.wait(
        "return !document.querySelector('.mobile-scrim')&&document.querySelector('.side-nav').getBoundingClientRect().right<=1",
      );
    await browser.run(
      "await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return true",
    );
    assert.equal(
      await browser.run(
        "return document.documentElement.scrollWidth<=innerWidth",
      ),
      true,
    );
    const shot = await browser.call("Page.captureScreenshot", {
      format: "png",
    });
    await writeFile(
      `.verification/quotation-review-editor-${width}.png`,
      Buffer.from(shot.data, "base64"),
    );
  }
  await browser.call("Emulation.clearDeviceMetricsOverride");
  // Repeated two-session financial conflicts preserve input and require renewed review.
  await second.navigate(path);
  await second.wait(
    "return !!document.querySelector('input[name=reviewVatRate]')",
  );
  await readyQuotationEditor(second);
  const alternateNote = `[data-financial-row="${alternative.id}"] textarea`;
  for (const page of [browser, second])
    await page.run(
      `document.querySelector('[data-financial-row="${alternative.id}"]').open=true;`,
    );
  await browser.fill(alternateNote, "My preserved financial classification");
  await second.fill(alternateNote, "Colleague financial classification");
  await saveFinancial(second);
  await browser.wait("return !!document.querySelector('.quotation-conflict')");
  assert.equal(
    await browser.run(
      `return document.querySelector(${JSON.stringify(alternateNote)}).value`,
    ),
    "My preserved financial classification",
  );
  await click(browser, "Keep my classifications with reviewed source");
  await second.fill(alternateNote, "Changed again during financial review");
  await saveFinancial(second);
  await browser.wait("return !!document.querySelector('.quotation-conflict')");
  await click(browser, "Keep my classifications with reviewed source");
  await saveFinancial(browser);
  // A valid finalization survives provider failure and lost upload acknowledgement.
  const mapping = JSON.parse(
    (
      await sql(
        `select to_jsonb(d) from private.project_document_folders d join public.material_requests m on m.project_id=d.project_id where m.id='${mrf}' and d.current;`,
      )
    ).output.trim(),
  );
  const providerCount = drive.files.size;
  drive.files.get(mapping.folder_id).trashed = true;
  await finalize(browser);
  await browser.wait(
    "return document.querySelector('.quotation-revision')?.textContent.includes('Archive: failed')",
    60000,
  );
  saved = await current(quote);
  assert.equal(saved.state, "finalized");
  assert.equal(saved.revision.eligible, false);
  const revision = saved.revision.id,
    frozen = (
      await sql(
        `select snapshot::text from private.quotation_revisions where id='${revision}';`,
      )
    ).output.trim();
  drive.files.get(mapping.folder_id).trashed = false;
  drive.faults.loseFinalResponse = true;
  await click(browser, "Retry quotation archive");
  await until(async () => {
    const attempt = JSON.parse(
      (
        await sql(
          `select jsonb_build_object('state',state,'attempts',jsonb_array_length(attempts)) from private.quotation_archive_jobs where revision_id='${revision}';`,
        )
      ).output.trim(),
    );
    return attempt.attempts === 1 && attempt.state === "failed";
  }, "new retry attempt failed after losing the provider acknowledgement");
  await click(browser, "Retry quotation archive");
  await browser.wait(
    "return document.querySelector('.quotation-revision')?.textContent.includes('Current and eligible')",
    60000,
  );
  assert.equal(
    drive.files.size,
    providerCount + 2,
    "Lost acknowledgement created no duplicate review folder or PDF",
  );
  assert.equal(
    await browser.run(
      "return document.querySelector('.quotation-originals').textContent.includes('Uploads transferred')",
    ),
    false,
    "Completed originals do not retain an in-progress transfer message",
  );
  assert.equal(
    await browser.run(
      "return document.querySelector('input[name=ref]').disabled",
    ),
    true,
  );
  const cookie = async (page) =>
    (await page.call("Network.getAllCookies")).cookies
      .filter((c) => c.domain === "127.0.0.1")
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
  const response = await fetch(
    base + `/api/quotation-revisions/${revision}/review`,
    { headers: { Cookie: await cookie(browser) } },
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /private.*no-store/);
  const pdf = Buffer.from(await response.arrayBuffer());
  assert.equal(
    createHash("sha256").update(pdf).digest("hex"),
    (
      await sql(
        `select sha256 from private.quotation_archives where revision_id='${revision}';`,
      )
    ).output.trim(),
  );
  const range = await fetch(
    base + `/api/quotation-revisions/${revision}/review`,
    { headers: { Cookie: await cookie(browser), Range: "bytes=0-4" } },
  );
  assert.equal(range.status, 206);
  assert.equal(await range.text(), "%PDF-");
  const purchasing = await checkPurchasing({ browser, second, sql, base, drive, mrf, quote, material });
  const accounting = await checkAccounting({ browser, second, sql, base, drive, mrf, quote, ...purchasing,
    login, logout, procurement: accounts[1], preparer: accounts[0], accountant: accounts[2], manager });
  // Actual MRF correction/reapproval/Workflow must not silently revalidate the offer.
  await second.navigate(`/requests/${mrf}`);
  await second.run(
    "const input=document.querySelector('#mrf-review-heading ~ .field textarea');input.focus();input.select()",
  );
  await second.call("Input.insertText", {
    text: "Check corrected supporting plans",
  });
  await click(second, "Open correction");
  await browser.wait(
    "return document.querySelector('.quotation-revision')?.textContent.includes('Current MRF approval/archive is unavailable')",
  );
  await logout(second);
  await login(second, staff[0]);
  await second.navigate(`/requests/${mrf}/edit`);
  await click(second, "Save and submit");
  await second.wait(`return location.pathname==='/requests/${mrf}'`);
  await logout(second);
  await login(second, manager);
  await second.navigate(`/requests/${mrf}`);
  await click(second, "Approve MRF");
  await browser.wait(
    "return [...document.querySelectorAll('button')].some(b=>b.textContent==='Review corrected MRF'&&!b.disabled)",
    60000,
  );
  assert.equal((await current(quote)).revision.eligible, false);
  await click(browser, "Review corrected MRF");
  const applicabilityReason =
    "Supplier offer still applies to reviewed corrected plans";
  await browser.fill("textarea[name=revisionReason]", applicabilityReason);
  await logout(second);
  await login(second, accounts[1]);
  await second.navigate(path);
  await readyQuotationEditor(second);
  await reasonAction(
    second,
    "Review corrected MRF",
    "Colleague checked the same corrected plans",
    "Reconfirm current MRF",
  );
  await browser.wait(
    "return document.querySelector('.record-dialog')?.textContent.includes('Saved revision information changed')",
  );
  assert.equal(
    await browser.run(
      "return document.querySelector('textarea[name=revisionReason]').value",
    ),
    applicabilityReason,
  );
  assert.equal(
    await browser.run(
      "return [...document.querySelectorAll('.record-dialog button')].find(b=>b.textContent==='Reconfirm current MRF').disabled",
    ),
    true,
  );
  await click(browser, "I reviewed the latest revision and MRF");
  await click(browser, "Reconfirm current MRF");
  await browser.wait(
    `return document.querySelector('.quotation-revision')?.textContent.includes('Current and eligible')&&document.querySelector('.project-history')?.textContent.includes(${JSON.stringify(applicabilityReason)})`,
  );
  assert.equal(
    (
      await sql(
        `select snapshot::text from private.quotation_revisions where id='${revision}';`,
      )
    ).output.trim(),
    frozen,
  );
  // Fresh replacement review reuses original ownership, then replaces the prior head.
  await reviewApprovedPo({ second, login, logout, sql, poId: purchasing.poId, accountant: accounts[2], procurement: accounts[1], mrf, quote, action: "reconfirmPo" });
  await reasonAction(
    browser,
    "Start revision",
    "Correct captured supplier notes",
    "Start quotation revision",
  );
  await browser.wait(
    `return location.pathname.startsWith('/requests/${mrf}/quotes/')&&!location.pathname.endsWith('${quote}')&&!!document.querySelector('input[name=ref]')`,
  );
  const replacement = await browser.run(
    "return location.pathname.split('/').at(-1)",
  );
  let replacementSaved = await current(replacement);
  assert.equal(replacementSaved.checked, false);
  assert.equal(replacementSaved.financial.checked, false);
  assert.deepEqual(replacementSaved.matches, []);
  assert.deepEqual(replacementSaved.files, (await current(quote)).files);
  assert.equal((await current(quote)).revision.eligible, true);
  await browser.fill(
    "textarea[name=notes]",
    "Correction to captured quotation notes",
  );
  await click(browser, "Save quotation");
  await browser.wait(
    "return !document.body.innerText.includes('Save or discard your text changes')&&document.querySelector('.project-history')?.textContent.includes('Correction to captured quotation notes')",
  );
  await confirmSource(browser);
  await click(browser, "Keep my classifications with reviewed source");
  await saveFinancial(browser);
  await finalize(browser);
  await browser.wait(
    "return document.querySelector('.quotation-revision')?.textContent.includes('Current and eligible')",
    60000,
  );
  assert.equal((await current(quote)).revision.current, false);
  replacementSaved = await current(replacement);
  assert.equal(replacementSaved.revision.number, "2");
  await reviewApprovedPo({ second, login, logout, sql, poId: purchasing.poId, accountant: accounts[2], procurement: accounts[1], mrf, quote: replacement, action: "revokePo" });
  await checkPurchasingRebind({ browser, sql, mrf, quote: replacement, ...purchasing });
  assert.match(
    await browser.run(
      "return document.querySelector('.quotation-financial-review').textContent",
    ),
    /VAT included summary: summary; reconciled against VAT; excluded from totals/,
  );
  for (const width of [1440, 375]) {
    await browser.call("Emulation.setDeviceMetricsOverride", {
      width,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: width === 375,
    });
    await browser.run(
      "document.querySelector('.mobile-scrim')?.click();document.querySelector('#financial-review-heading').scrollIntoView();window.scrollBy(0,-88)",
    );
    if (width === 375)
      await browser.wait(
        "return !document.querySelector('.mobile-scrim')&&document.querySelector('.side-nav').getBoundingClientRect().right<=1",
      );
    assert.equal(
      await browser.run(
        "return document.documentElement.scrollWidth<=innerWidth",
      ),
      true,
    );
    const shot = await browser.call("Page.captureScreenshot", {
      format: "png",
    });
    await writeFile(
      `.verification/quotation-financial-${width}.png`,
      Buffer.from(shot.data, "base64"),
    );
    await browser.run(
      "document.querySelector('.quotation-revision').scrollIntoView();window.scrollBy(0,-88)",
    );
    const revisionShot = await browser.call("Page.captureScreenshot", {
      format: "png",
    });
    await writeFile(
      `.verification/quotation-revision-${width}.png`,
      Buffer.from(revisionShot.data, "base64"),
    );
  }
  await browser.call("Emulation.clearDeviceMetricsOverride");
  await reasonAction(
    browser,
    "Withdraw revision",
    "Supplier withdrew the replacement offer",
    "Withdraw this revision",
  );
  await browser.wait(
    "return document.querySelector('.quotation-revision')?.textContent.includes('Withdrawn permanently')",
  );
  assert.equal(
    (await current(quote)).revision.eligible,
    false,
    "No automatic predecessor resurrection",
  );
  // Reader sees frozen evidence; Site remains denied even on its assigned MRF.
  await logout(second);
  await login(second, accounts[2]);
  await second.navigate(`/requests/${mrf}/quotes/${replacement}`);
  await second.wait("return !!document.querySelector('.quotation-revision')");
  assert.equal(
    await second.run(
      "return [...document.querySelectorAll('button')].some(b=>b.textContent==='Withdraw revision')",
    ),
    false,
  );
  assert.equal(
    (
      await fetch(base + `/api/quotation-revisions/${revision}/review`, {
        headers: { Cookie: await cookie(second) },
      })
    ).status,
    200,
  );
  await logout(second);
  await login(second, staff[0]);
  assert.equal(
    await second.run(
      `return (await fetch('/api/quotation-revisions/${revision}/review')).status`,
    ),
    403,
  );
  assert.equal(
    await second.run(
      `return (await fetch('/api/foundation/view?view=quotations&mrfId=${mrf}')).status`,
    ),
    403,
  );
  assert.equal(await second.run(`return (await fetch('/api/foundation/view?view=purchasing&mrfId=${mrf}')).status`), 403);
  assert.equal(await second.run(`return (await fetch('/api/purchase-order-drafts/${purchasing.poId}/preview?version=1')).status`), 403);
  await logout(second);
  // Leave a freshly reviewed owned draft for observed-lock finalization races.
  await reasonAction(
    browser,
    "Start revision",
    "Renew withdrawn supplier offer for race fixture",
    "Start quotation revision",
  );
  await browser.wait(
    `return !location.pathname.endsWith('${replacement}')&&!!document.querySelector('input[name=ref]')`,
  );
  const pending = await browser.run(
    "return location.pathname.split('/').at(-1)",
  );
  await confirmSource(browser);
  await click(browser, "Confirm saved financial review and PHP");
  await until(
    async () => (await current(pending)).financial.checked,
    "fresh financial confirmation for the race fixture",
  );
  const pendingSaved = await current(pending);
  assert.equal(pendingSaved.financial.checked, true);
  await browser.run(
    `document.querySelector('[data-financial-row="${alternative.id}"]').open=true;`,
  );
  await browser.fill(
    alternateNote,
    "Dirty financial input must clear on revocation",
  );
  await sql(
    `update public.profiles set is_active=false where user_id='${accounts[0].id}';`,
  );
  await browser.wait(
    "return location.pathname==='/sign-in'&&!document.querySelector('.quotation-financial-review')",
    60000,
  );
  console.log(
    "Quotation financial reconciliation, repeated conflicts, immutable replacements, archive recovery, MRF reconfirmation, withdrawal and protected history passed.",
  );
  return {
    mrf,
    quote: pending,
    actor: colleague,
    calculation: pendingSaved.financial.calculation,
    review: pendingSaved.financial.review,
    body: pendingSaved.body,
    previous: replacement,
    accounting,
  };
}

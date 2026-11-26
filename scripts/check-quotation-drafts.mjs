import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import sharp from "sharp";

/** Reuses an MRF archived by the actual application review/Workflow path. */
export async function checkQuotationDrafts(options) {
  try {
    return await checkCapture(options);
  } catch (error) {
    for (const [index, page] of [options.browser, options.second].entries()) {
      const shot = await page
        .call("Page.captureScreenshot", { format: "png" })
        .catch(() => null);
      if (shot)
        await writeFile(
          `.verification/quotation-failure-${index}.png`,
          Buffer.from(shot.data, "base64"),
        );
      console.error(
        "Quotation failure state:",
        await page
          .run(
          "return [...document.querySelectorAll('[role=alert],.quotation-extraction, .quotation-extraction-result,.quotation-originals [role=status]')].map(el=>el.textContent).join(' | ')",
          )
          .catch(() => "unavailable"),
      );
    }
    throw error;
  }
}
async function checkCapture({
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
  bytes,
}) {
  const ok = (result) => {
    assert.equal(result.error, null);
    return result.data;
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
        display_name: "Quotation " + role,
        is_active: true,
      }),
    );
    ok(await client.from("role_grants").insert({ user_id: account.id, role }));
    accounts.push(account);
  }
  for (const page of [browser, second])
    if (await page.run("return !!document.querySelector('.masthead-account')"))
      await logout(page);
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
  const click = async (page, text) => {
    const expression = `const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled);`;
    await page.wait(expression + "return !!button;");
    await page.run(expression + "button.click();");
  };
  const save = async (page) => {
    await click(page, "Save quotation");
    await page.wait(
      "return !document.body.innerText.includes('Save or discard your text changes')&&[...document.querySelectorAll('button')].some(b=>b.textContent==='Save quotation'&&!b.disabled)",
    );
  };
  await login(browser, accounts[0]);
  const buyer = await actor(browser);
  const profile = {
    name: "Quotation browser " + randomUUID(),
    address: "Supplier source address",
    tin: "",
    contactName: "",
    email: "",
    phone: "",
    accreditationNote: "",
  };
  const supplier = ok(
    await client.rpc("supplier_command", {
      actor: buyer,
      command: { type: "createSupplier", requestId: randomUUID(), profile },
    }),
  ).supplierId;
  await browser.navigate(`/requests/${mrf}/quotes`);
  await click(browser, "Create quotation draft");
  await browser.wait(
    "return !!document.querySelector('select[name=supplierId]')",
  );
  await browser.run(
    `const el=document.querySelector('select[name=supplierId]');el.value=${JSON.stringify(supplier)};el.dispatchEvent(new Event('change',{bubbles:true}));`,
  );
  await click(browser, "Save draft and link MRF");
  await browser.wait(
    `return location.pathname.startsWith('/requests/${mrf}/quotes/')&&!!document.querySelector('input[name=ref]')`,
  );
  const quote = await browser.run("return location.pathname.split('/').at(-1)");
  const path = `/requests/${mrf}/quotes/${quote}`;
  await browser.navigate(`/requests/${mrf}/quotes`);
  await click(browser, "Create quotation draft");
  await browser.run(
    "const el=document.querySelector('select[name=supplierId]');el.value='quote-only';el.dispatchEvent(new Event('change',{bubbles:true}));",
  );
  await browser.fill('dialog input[name=supplierName]', "Quotation browser");
  await browser.wait(
    `return [...document.querySelectorAll('[aria-label="Possible supplier matches"] a')].some(link=>link.href.endsWith(${JSON.stringify(path)}));`,
  );
  const typedName = "Quote-only supplier " + randomUUID();
  await browser.fill('dialog input[name=supplierName]', typedName);
  await click(browser, "Save draft and link MRF");
  await browser.wait(
    `return location.pathname.startsWith('/requests/${mrf}/quotes/')&&!!document.querySelector('input[name=ref]')`,
  );
  assert.ok(await browser.run("return document.body.innerText.includes('Supplier details are saved with this quotation.')"));
  const manual = await browser.run("return location.pathname.split('/').at(-1)");
  assert.equal((await sql(`select supplier_id is null from private.quotation_drafts where id='${manual}';`)).output.trim(), "t");
  await browser.navigate(path);
  await login(second, accounts[1]);
  await second.navigate(path);
  await second.wait("return !!document.querySelector('input[name=ref]:not(:disabled)')");
  const colleague = await actor(second);
  await browser.fill("input[name=ref]", "Preserved local source");
  await second.fill("input[name=ref]", "Saved by colleague");
  await save(second);
  await browser.wait(
    "return document.body.innerText.includes('Review latest saved quotation')",
  );
  assert.equal(
    await browser.run("return document.querySelector('input[name=ref]').value"),
    "Preserved local source",
  );
  await click(browser, "I reviewed the latest quotation; keep my draft");
  await second.fill("input[name=ref]", "Changed again");
  await save(second);
  await browser.wait(
    "return document.body.innerText.includes('Review latest saved quotation')",
  );
  await click(browser, "I reviewed the latest quotation; keep my draft");
  await save(browser);
  await browser.wait(
    "return !document.body.innerText.includes('Review latest saved quotation')",
  );
  assert.equal(
    (
      await sql(
        `select body->>'ref' from private.quotation_drafts where id='${quote}';`,
      )
    ).output.trim(),
    "Preserved local source",
  );
  await click(browser, "Add offered line");
  await browser.fill(
    'input[aria-label="Supplier description 1"]',
    "Exact material from supplier",
  );
  await browser.fill('input[aria-label="Offered quantity 1"]', "12.12500");
  await browser.fill('input[aria-label="Offered unit 1"]', "pc");
  await browser.fill(
    'input[aria-label="Quoted unit price 1"]',
    "12345678901234567890.12345678901234567890",
  );
  await browser.run(
    "const select=document.querySelector('select[aria-label=\"Requested material 1\"]');select.value=select.options[1].value;select.dispatchEvent(new Event('change',{bubbles:true}));",
  );
  await click(browser, "Line details");
  await browser.fill("input[name=line-conversionFactor]", "1");
  await click(browser, "Close line details");
  await save(browser);
  await browser.wait(
    "return !document.body.innerText.includes('Save or discard your text changes')",
  );
  assert.equal(
    (
      await sql(
        `select body->'lines'->0->>'unitPrice' from private.quotation_drafts where id='${quote}';`,
      )
    ).output.trim(),
    "12345678901234567890.12345678901234567890",
  );
  const image = await sharp({
    create: { width: 10, height: 10, channels: 3, background: "#165c43" },
  })
    .png()
    .toBuffer();
  const select = async (files) =>
    browser.run(
      `const dt=new DataTransfer();${files.map((f) => `dt.items.add(new File([Uint8Array.from(atob('${f.bytes.toString("base64")}'),c=>c.charCodeAt(0))],${JSON.stringify(f.name)},{type:${JSON.stringify(f.mime)}}));`).join("")}const input=document.querySelector('.quotation-originals input[type=file]');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));`,
    );
  // Interrupted chunks survive reload and require matching local-file reselection.
  drive.faults.pauseUploads = true;
  await select([
    { name: "offer.pdf", mime: "application/pdf", bytes },
    { name: "offer.png", mime: "image/png", bytes: image },
  ]);
  await click(browser, "Save original group");
  await browser.wait(
    "return !!document.querySelector('.quotation-originals [role=alert]')",
  );
  await browser.navigate(path);
  await browser.wait(
    "return document.body.innerText.includes('Reselect matching files to resume')",
  );
  drive.faults.pauseUploads = false;
  drive.faults.loseFinalResponse = true;
  await select([
    { name: "offer.pdf", mime: "application/pdf", bytes },
    { name: "offer.png", mime: "image/png", bytes: image },
  ]);
  await click(browser, "Resume uploads");
  await browser.wait(
    "return document.querySelectorAll('.quotation-originals a[download],.quotation-originals li>a:first-of-type').length===2&&!document.body.innerText.includes('Group uploading')",
    60000,
  );
  await browser.wait(
    "return [...document.querySelectorAll('button')].some(b=>b.textContent==='Entered data checked against originals'&&!b.disabled)",
  );
  await click(browser, "Line details");
  await click(browser, "Confirm material match");
  await browser.wait(
    "return document.querySelector('.quotation-source-table')?.textContent.includes('Confirmed')",
  );
  await click(browser, "Close line details");
  await click(browser, "Entered data checked against originals");
  await browser.wait(
    "return document.querySelector('.quotation-review-status')?.textContent.includes('Entered data checked against the saved originals.')",
  );
  const original = JSON.parse(
    (await sql(`select private.quotation_view('${quote}');`)).output.trim(),
  );
  assert.equal(original.files.length, 2);
  const cookie = (await browser.call("Network.getAllCookies")).cookies
    .filter((c) => c.domain === "127.0.0.1")
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  for (const file of original.files) {
    const response = await fetch(base + "/api/quotation-files/" + file.id, {
      headers: { Cookie: cookie },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), file.mime);
    assert.match(response.headers.get("cache-control"), /private.*no-store/);
    const range = await fetch(base + "/api/quotation-files/" + file.id, {
      headers: { Cookie: cookie, Range: "bytes=0-4" },
    });
    assert.equal(range.status, 206);
    assert.equal((await range.arrayBuffer()).byteLength, 5);
  }
  if (
    await browser.run(
      "return [...document.querySelectorAll('button')].some(b=>b.textContent==='I reviewed the latest original group')",
    )
  )
    await click(browser, "I reviewed the latest original group");
  await select([
    {
      name: "damaged.png",
      mime: "image/png",
      bytes: Buffer.from("not a decodable image"),
    },
  ]);
  await click(browser, "Save original group");
  await browser.wait(
    "return document.querySelector('.quotation-originals')?.textContent.includes('Unreadable or mismatched original')",
    60000,
  );
  assert.deepEqual(
    JSON.parse(
      (
        await sql(`select private.quotation_view('${quote}')->'files';`)
      ).output.trim(),
    ),
    original.files,
  );
  await click(browser, "Cancel unfinished group");
  await browser.wait(
    "return !document.body.innerText.includes('Group uploading')",
  );
  await browser.wait("return !document.querySelector('.quotation-originals')?.textContent.includes('Checking original: failed')");
  await browser.fill("input[name=ref]", "Dirty after review");
  assert.equal(
    await browser.run(
      "return [...document.querySelectorAll('button')].find(b=>b.textContent==='Entered data checked against originals').disabled",
    ),
    true,
  );
  await save(browser);
  await browser.wait(
    "return document.querySelector('.quotation-review-status')?.textContent.includes('has not been checked')",
  );
  await click(browser, "Cancel quotation");
  await browser.fill("textarea[name=statusReason]", "Withdrawn supplier offer");
  await browser.click(".record-dialog .primary");
  await browser.wait(
    "return document.querySelector('.quotation-review-status')?.textContent.includes('Cancelled quotation')",
  );
  assert.equal(
    JSON.parse(
      (
        await sql(`select private.quotation_view('${quote}')->'files';`)
      ).output.trim(),
    ).length,
    2,
  );
  await click(browser, "Reopen quotation");
  await browser.fill(
    "textarea[name=statusReason]",
    "Supplier confirmed the offer",
  );
  await browser.click(".record-dialog .primary");
  await browser.wait(
    "return document.querySelector('.quotation-review-status')?.textContent.includes('Editable quotation draft')",
  );
  await checkAutofill({ browser, second, drive, sql, base, path, original, quote, click, save, cookie, supplierName: profile.name });
  await checkIntake({ browser, drive, client, buyer, sql, mrf, click, save, bytes, image, profile });
  await browser.navigate(path);
  for (const width of [1440, 375]) {
    await browser.call("Emulation.setDeviceMetricsOverride", {
      width,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: width === 375,
    });
    await browser.run(
      "document.querySelector('.mobile-scrim')?.click();window.scrollTo(0,0)",
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
      `.verification/quotation-${width}.png`,
      Buffer.from(shot.data, "base64"),
    );
    await browser.run(
      "document.querySelector('.quotation-originals').scrollIntoView()",
    );
    const originalsShot = await browser.call("Page.captureScreenshot", {
      format: "png",
    });
    await writeFile(
      `.verification/quotation-originals-${width}.png`,
      Buffer.from(originalsShot.data, "base64"),
    );
    await browser.run(
      "const history=[...document.querySelectorAll('.quotation-file-history')].find(el=>el.querySelector('details'));if(!history)throw Error('File metadata history missing');history.open=true;history.querySelector('details').open=true;history.scrollIntoView()",
    );
    assert.equal(
      await browser.run(
        "return document.documentElement.scrollWidth<=innerWidth",
      ),
      true,
    );
    const historyShot = await browser.call("Page.captureScreenshot", {
      format: "png",
    });
    await writeFile(
      `.verification/quotation-history-${width}.png`,
      Buffer.from(historyShot.data, "base64"),
    );
  }
  await browser.call("Emulation.clearDeviceMetricsOverride");
  await logout(second);
  await login(second, accounts[2]);
  await second.navigate(path);
  await second.wait("return !!document.querySelector('input[name=ref]')");
  assert.equal(
    await second.run(
      "return document.querySelector('input[name=ref]').disabled",
    ),
    true,
  );
  await logout(second);
  await login(second, staff[0]);
  assert.equal(
    await second.run(
      `return (await fetch('/api/foundation/view?view=quotations&mrfId=${mrf}')).status`,
    ),
    403,
  );
  assert.equal(
    await second.run(
      `return (await fetch('/api/quotation-files/${original.files[0].id}')).status`,
    ),
    403,
  );
  await sql(
    `update public.profiles set is_active=false where user_id='${accounts[0].id}';`,
  );
  await browser.wait("return location.pathname==='/sign-in'", 60000);
  await logout(second);
  console.log(
    "Quotation capture/conflict/realtime/role checks and mixed-original interruption/recovery/atomic failure checks passed.",
  );
  return {
    mrf,
    quote,
    actor: colleague,
    body: JSON.parse(
      (
        await sql(
          `select body from private.quotation_drafts where id='${quote}';`,
        )
      ).output.trim(),
    ),
  };
}

async function checkIntake({ browser, drive, client, buyer, sql, mrf, click, save, bytes, image, profile }) {
  const read = async (query) => (await sql(query)).output.trim();
  const linked = () => read(`select count(*) from private.mrf_downstream_references where request_id='${mrf}' and kind='quotation';`);
  const signed = await client.rpc('supplier_command', { actor: buyer, command: { type: 'createSupplier', requestId: randomUUID(),
    profile: { ...profile, name: 'Intake directory ' + randomUUID() } } });
  assert.equal(signed.error, null);
  const directory = signed.data.supplierId;
  const originals = [{ name: 'intake.pdf', bytes, mime: 'application/pdf' }, { name: 'intake.png', bytes: image, mime: 'image/png' }];
  for (const width of [1440, 375]) {
    if (width === 375) await browser.call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: true });
    const prior = Number(await linked()), providerCalls = drive.gemini.inputs.length;
    await browser.navigate(`/requests/${mrf}/quotes`);
    await click(browser, 'Create quotation draft');
    await browser.run("const field=document.querySelector('dialog select[name=supplierId]');field.value='quote-only';field.dispatchEvent(new Event('change',{bubbles:true}));");
    const upload = 'dialog input[name=intake-originals]';
    await browser.wait(`return !!document.querySelector(${JSON.stringify(upload)})`);
    assert.equal(await browser.run("return document.querySelector('dialog input[name=supplierName]').value"), '');
    await browser.run(`const dt=new DataTransfer();${originals.map(file => `dt.items.add(new File([Uint8Array.from(atob('${file.bytes.toString('base64')}'),c=>c.charCodeAt(0))],${JSON.stringify(file.name)},{type:${JSON.stringify(file.mime)}}));`).join('')}const input=document.querySelector(${JSON.stringify(upload)});input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));`);
    if (width === 1440) {
      drive.faults.shareIntake = true;
      await click(browser, 'Extract and fill');
      await browser.wait("return !!document.querySelector('dialog [role=alert]')");
      assert.equal(await read(`select count(*) from private.quotation_intakes where request_id='${mrf}' and state<>'closed';`), '0');
      drive.faults.shareIntake = false;
    }
    await click(browser, 'Extract and fill');
    await browser.wait("return document.querySelector('dialog input[name=supplierName]')?.value==='Printed Quotation Supplier'", 60000);
    assert.equal(Number(await linked()), prior, 'Extracting supplier details never links an MRF');
    assert.equal(drive.gemini.inputs.length, providerCalls + 1);
    const name = width === 1440 ? 'Reviewed quote only' : 'Reviewed directory quote';
    await browser.fill('dialog input[name=supplierName]', name);
    if (width === 375) await browser.run(`const field=document.querySelector('dialog select[name=supplierId]');field.value=${JSON.stringify(directory)};field.dispatchEvent(new Event('change',{bubbles:true}));`);
    if (width === 1440) drive.faults.loseCopyResponse = true;
    await click(browser, 'Save draft and link MRF');
    await browser.wait("return !document.querySelector('dialog[open]') && !!document.querySelector('.quotation-originals')");
    const quote = await browser.run("return location.pathname.split('/').at(-1)");
    assert.equal(Number(await linked()), prior + 1);
    const draft = async () => JSON.parse(await read(`select private.quotation_view('${quote}');`));
    let row = await draft();
    assert.equal(row.supplierId, width === 1440 ? null : directory);
    assert.equal(row.body.supplierName, name);
    assert.equal(row.body.lines.length, 0, 'Initial save saves only reviewed supplier fields');
    if (width === 1440) {
      await browser.wait("return document.querySelector('.quotation-originals').textContent.includes('File processing failed')", 60000);
      await click(browser, 'Retry file job');
    }
    await browser.wait("return !!document.querySelector('.quotation-extraction-result')&&document.querySelector('input[name=ref]').value==='Q-ORIGINAL'", 60000);
    assert.equal(drive.gemini.inputs.length, providerCalls + 1, 'Opening the editor reuses extraction');
    row = await draft();
    assert.equal(row.body.lines.length, 0);
    assert.equal(row.files.length, 2);
    await save(browser);
    row = await draft();
    assert.equal(row.body.lines[1].sourceFileId, row.files[1].id);
    assert.equal(row.body.lines[1].sourcePage, '1');
    assert.equal(row.body.lines[1].unitPrice, '0.00');
    assert.equal(row.body.supplierName, name);
    assert.equal(row.checked, false);
    const shot = await browser.call('Page.captureScreenshot', { format: 'png' });
    await writeFile(`.verification/quotation-intake-${width}.png`, Buffer.from(shot.data, 'base64'));
  }
  await browser.call('Emulation.clearDeviceMetricsOverride');
}

async function checkAutofill({ browser, second, drive, sql, base, path, original, quote, click, save, cookie, supplierName }) {
  const extractionInputs = () => drive.gemini.inputs.filter(input => input.response_format.schema.properties.documentType.enum.includes('single_offer'));
  const saved = async () => JSON.parse((await sql(`select private.quotation_view('${quote}');`)).output.trim());
  const current = await saved();
  const context = { quoteId: quote, version: current.version, fileVersion: current.fileVersion };
  const url = '/api/quotation-extraction?' + new URLSearchParams(context);
  const status = page => page.run(`return (await (await fetch(${JSON.stringify(url)})).json()).state`);
  assert.equal((await fetch(base + url, { redirect: 'manual' })).status, 401);
  const crossOrigin = await fetch(base + '/api/quotation-extraction', {
    method: 'POST', headers: { Cookie: cookie, Origin: 'https://unrelated.example.invalid', 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...context, type: 'start', operationId: randomUUID() }),
  });
  assert.equal(crossOrigin.status, 403, 'Cross-origin POST cannot start extraction');
  drive.gemini.failNext = true;
  await click(browser, 'Extract and fill');
  await browser.wait("return document.querySelector('.quotation-extraction')?.textContent.includes('Extraction could not finish')", 60000);
  drive.gemini.quotationDelay = 1500;
  await click(browser, 'Retry extraction');
  await browser.wait("return document.querySelector('.quotation-extraction')?.textContent.includes('Reading the originals')");
  await browser.fill('textarea[name=notes]', 'Typed while extraction ran');
  await browser.wait("return [...document.querySelectorAll('button')].some(b=>b.textContent==='Continue filling'&&!b.disabled)", 60000);
  assert.equal(await status(second), 'idle', 'Ready result stays private to its initiating buyer');
  assert.match(await browser.run("return document.querySelector('.quotation-extraction').textContent"), /Printed Quotation Supplier/);
  assert.ok((await browser.run("return document.querySelector('.quotation-extraction').textContent")).includes(supplierName));
  await click(browser, 'Continue filling');
  await browser.wait("return !!document.querySelector('.quotation-extraction-result')");
  assert.equal(await browser.run("return document.querySelector('textarea[name=notes]').value"), 'Typed while extraction ran');
  assert.equal(await browser.run("return document.querySelector('input[name=ref]').value"), current.body.ref);
  assert.equal(await browser.run("return document.querySelectorAll('input[aria-label^=\"Supplier description \" ]').length"), 2);
  await browser.fill('textarea[name=notes]', 'Kept after undo');
  await click(browser, 'Undo fill');
  assert.equal(await browser.run("return document.querySelector('textarea[name=notes]').value"), 'Kept after undo');
  assert.equal(await browser.run("return document.querySelectorAll('input[aria-label^=\"Supplier description \" ]').length"), 1);
  await browser.fill('textarea[name=notes]', current.body.notes);
  assert.deepEqual((await saved()).body, current.body, 'Fill and undo remain local until save');
  await browser.navigate(path);
  await click(browser, 'Fill from originals');
  await click(browser, 'Continue filling');
  await browser.wait("return !!document.querySelector('.quotation-extraction-result')");
  assert.equal(extractionInputs().length, 2, 'Ready recovery does not call Gemini again');
  const request = extractionInputs().at(-1);
  assert.equal(request.store, false);
  const inputs = request.input.filter(input => input.data);
  assert.deepEqual(inputs.map(input => input.mime_type), original.files.map(file => file.mime));
  assert.deepEqual(inputs.map(input => Buffer.from(input.data, 'base64').byteLength), original.files.map(file => file.size));
  for (const width of [1440, 375]) {
    await browser.call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width === 375 });
    await browser.run("document.querySelector('.mobile-scrim')?.click(); const result=document.querySelector('.quotation-extraction-result'); result.querySelector('details').open=true; result.scrollIntoView()");
    assert.equal(await browser.run("return document.querySelector('.quotation-extraction-result').getBoundingClientRect().right<=innerWidth&&document.documentElement.scrollWidth<=innerWidth"), true);
    const shot = await browser.call('Page.captureScreenshot', { format: 'png' });
    await writeFile(`.verification/quotation-extraction-${width}.png`, Buffer.from(shot.data, 'base64'));
  }
  await browser.call('Emulation.clearDeviceMetricsOverride');
  await save(browser);
  const persisted = await saved();
  assert.equal(persisted.body.supplierName, current.body.supplierName);
  assert.equal(persisted.body.lines[1].sourceFileId, original.files[1].id);
  assert.equal(persisted.body.lines[1].sourcePage, '1');
  assert.equal(persisted.body.lines[1].unitPrice, '0.00');
  assert.equal(persisted.body.lines[1].requestItemId, null);
  assert.equal(persisted.body.adjustments[0].value, '0.000');
  assert.equal(persisted.checked, false);
  drive.gemini.quotationDelay = 0;
  drive.gemini.quotationType = 'multiple_offers';
  await click(browser, 'Extract and fill');
  await browser.wait("return document.querySelector('.quotation-extraction')?.textContent.includes('contains multiple offers')", 60000);
  assert.deepEqual((await saved()).body, persisted.body);
  drive.gemini.quotationType = 'single_offer';
}

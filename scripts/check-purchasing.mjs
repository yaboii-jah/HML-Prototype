import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { compare, decimal } from "../src/domain/quotations/decimal.ts";

/** Uses existing disposable signed-in Procurement sessions and an actually archived offer. */
export async function checkPurchasing({
  browser,
  second,
  sql,
  base,
  drive,
  mrf,
  quote,
  material,
}) {
  const until = async (read, label) => {
    const end = Date.now() + 60000;
    while (Date.now() < end) {
      if (await read()) return;
      await delay(150);
    }
    throw Error("Purchasing timeout: " + label);
  };
  const click = async (page, label) => {
    const find = `const root=document.querySelector('dialog[open]')||document;const b=[...root.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled);`;
    await page.wait(find + "return !!b;");
    await page.run(find + "b.click();");
  };
  const openEditor = async (page) => {
    await page.wait(
      "if(!document.querySelector('dialog[open]'))[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Edit saved preparation'&&!b.disabled)?.click();return !!document.querySelector('dialog[open] textarea')",
    );
  };
  const field = async (page, label, value, select = false) => {
    const expression = `const field=[...document.querySelectorAll('dialog[open] label.field')].find(l=>l.querySelector('span')?.textContent.startsWith(${JSON.stringify(label)}));const input=field?.querySelector(${JSON.stringify(select ? "select" : "input,textarea")});`;
    await page.wait(expression + "return !!input&&!input.disabled;");
    if (select)
      await page.run(
        expression +
          `input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('change',{bubbles:true}));`,
      );
    else {
      await page.run(
        expression +
          "document.querySelectorAll('#purchasing-check-field').forEach(el=>el.removeAttribute('id'));input.id='purchasing-check-field';",
      );
      await page.fill("#purchasing-check-field", value);
    }
  };
  const view = async () =>
    JSON.parse(
      (
        await sql(
          `select private.purchasing_read((select actor from private.quotation_archive_jobs where revision_id=(select id from private.quotation_revisions where quote_id='${quote}')),'${mrf}');`,
        )
      ).output.trim(),
    );
  const cookie = async (page) =>
    (await page.call("Network.getAllCookies")).cookies
      .filter((c) => c.domain === "127.0.0.1")
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
  const capture = async (page, name = "", modal = false) => {
    for (const width of [1440, 375]) {
      await page.call("Emulation.setDeviceMetricsOverride", {
        width,
        height: 1000,
        deviceScaleFactor: 1,
        mobile: width < 600,
      });
      await page.run(
        "window.scrollTo(0,0); await document.fonts.ready; document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().endTime)).forEach(a=>a.finish());",
      );
      if (width < 600) {
        await page.run("document.querySelector('.mobile-scrim')?.click();");
        await page.wait(
          "return !document.querySelector('.mobile-scrim')&&document.querySelector('.side-nav').getBoundingClientRect().right<=1",
        );
      }
      assert.equal(
        await page.run(
          "return document.documentElement.scrollWidth<=innerWidth",
        ),
        true,
      );
      const { cssContentSize } = await page.call("Page.getLayoutMetrics");
      const shot = await page.call("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: !modal,
        clip: {
          x: 0,
          y: 0,
          width,
          height: modal ? 1000 : cssContentSize.height,
          scale: 1,
        },
      });
      await writeFile(
        `.verification/purchasing-${name ? name + "-" : ""}${width}.png`,
        Buffer.from(shot.data, "base64"),
      );
    }
    await page.call("Emulation.clearDeviceMetricsOverride");
  };
  const parentQuantity = (await view()).quotations.request.items.find(
    (i) => i.id === material.requestItemId,
  ).quantity;
  const allocated =
    compare(decimal(parentQuantity), decimal("1")) < 0 ? parentQuantity : "1";
  await browser.navigate(`/requests/${mrf}/purchasing`);
  await browser.wait(
    "if(!document.querySelector('dialog[open]'))[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Prepare supplier award'&&!b.disabled)?.click();return !!document.querySelector('dialog[open] textarea')",
  );
  await field(
    browser,
    "Supplier selection reason",
    "Reviewed partial supplier allocation",
  );
  await field(browser, "Add a confirmed material offer", material.id, true);
  await click(browser, "Add material");
  await field(browser, "Offered quantity", allocated);
  await click(browser, "Save preparation");
  await until(
    async () => (await view()).records.some((r) => r.kind === "award"),
    "shared saved award",
  );
  await browser.wait("return !document.querySelector('dialog[open]')");
  await second.navigate(`/requests/${mrf}/purchasing`);
  await openEditor(second);
  await openEditor(browser);
  await field(
    second,
    "Supplier selection reason",
    "Colleague input preserved during repeated conflicts",
  );
  await field(
    browser,
    "Supplier selection reason",
    "First newer reviewed supplier decision",
  );
  await click(browser, "Save preparation");
  await second.wait(
    "return document.querySelector('dialog[open]')?.textContent.includes('Latest saved values')",
  );
  assert.equal(
    await second.run(
      "return document.querySelector('dialog[open] textarea').value",
    ),
    "Colleague input preserved during repeated conflicts",
  );
  await click(second, "I reviewed the latest saved version");
  await browser.wait(
    "return !document.querySelector('dialog[open]')&&document.body.textContent.includes('First newer reviewed supplier decision')",
  );
  await openEditor(browser);
  await field(
    browser,
    "Supplier selection reason",
    "Second newer supplier decision requires another review",
  );
  await click(browser, "Save preparation");
  await second.wait(
    "return document.querySelector('dialog[open]')?.textContent.includes('Second newer supplier decision requires another review')",
  );
  assert.equal(
    await second.run(
      "return [...document.querySelectorAll('dialog[open] button')].find(b=>b.textContent==='Save preparation').disabled",
    ),
    true,
  );
  await click(second, "I reviewed the latest saved version");
  await click(second, "Save preparation");
  await second.wait(
    "return !document.querySelector('dialog[open]')&&document.body.textContent.includes('Colleague input preserved during repeated conflicts')",
  );
  await click(second, "Create PO draft");
  await click(second, "Confirm PO creation");
  await second.wait(
    "return location.pathname.startsWith('/purchase-orders/')&&document.body.textContent.includes('Saved PO draft preparation')",
  );
  const poId = await second.run("return location.pathname.split('/').at(-1)");
  const demand = JSON.parse(
    (await sql(`select private.demand_snapshot('${mrf}');`)).output.trim(),
  );
  assert.equal(
    demand.claims
      .filter((c) => c.ownerKind === "award")
      .every((c) => c.quantity === "0"),
    true,
  );
  assert.equal(
    demand.claims.find((c) => c.ownerId === poId).quantity,
    allocated,
  );
  await openEditor(second);
  await field(
    second,
    "Vendor name (printed)",
    "Explicit printed vendor snapshot",
  );
  await field(second, "Ship to", "Disposable purchasing QA site");
  await field(second, "Requisitioner", "Verified QA requester");
  await second.run(
    "for(const label of document.querySelectorAll('dialog[open] label.field')){if(label.textContent.includes('Confirm this saved inclusion and amount')){const input=label.querySelector('input[type=checkbox]');if(input&&!input.disabled&&!input.checked)input.click();}}",
  );
  await click(second, "Save preparation");
  await second.wait(
    "return !document.querySelector('dialog[open]')&&document.body.textContent.includes('Explicit printed vendor snapshot')",
  );
  await click(second, "Confirm saved preparation");
  await click(second, "Confirm saved preparation");
  await until(
    async () => (await view()).records.find((r) => r.id === poId)?.checked,
    "saved PO preparation confirmation",
  );
  let po = (await view()).records.find((r) => r.id === poId);
  const preview = await fetch(
    base + `/api/purchase-order-drafts/${poId}/preview?version=${po.version}`,
    { headers: { Cookie: await cookie(second) } },
  );
  assert.equal(preview.status, 200);
  assert.match(preview.headers.get("cache-control"), /private.*no-store/);
  const previewBytes = Buffer.from(await preview.arrayBuffer());
  assert.equal(previewBytes.subarray(0, 5).toString(), "%PDF-");
  await writeFile(".verification/purchasing-po-preview.pdf", previewBytes);
  await capture(second, "po");
  await openEditor(second);
  await capture(second, "editor", true);
  await click(second, "Save preparation");
  await second.wait("return !document.querySelector('dialog[open]')");
  assert.equal(
    (
      await fetch(
        base + `/api/purchase-order-drafts/${poId}/preview?version=0`,
        { headers: { Cookie: await cookie(second) } },
      )
    ).status,
    409,
  );
  await click(second, "Cancel PO draft");
  await field(
    second,
    "Reason (at least five characters)",
    "Cancel draft to release its demand explicitly",
  );
  await click(second, "Confirm cancel");
  await until(
    async () =>
      (await view()).records.find((r) => r.id === poId)?.state === "cancelled",
    "PO cancellation",
  );
  assert.equal(
    JSON.parse(
      (await sql(`select private.demand_snapshot('${mrf}');`)).output.trim(),
    )
      .claims.filter((c) => c.ownerId === poId)
      .every((c) => c.quantity === "0"),
    true,
  );
  await second.wait("return !document.querySelector('dialog[open]')");
  await click(second, "Reopen with checks");
  await field(
    second,
    "Reason (at least five characters)",
    "Reopen after checking current supplier and demand",
  );
  await click(second, "Confirm reopen");
  await until(
    async () =>
      (await view()).records.find((r) => r.id === poId)?.state === "active",
    "PO reopened",
  );
  assert.equal((await view()).records.find((r) => r.id === poId).ref, po.ref);
  await second.navigate(`/requests/${mrf}/purchasing`);
  await openEditor(second);
  await click(second, "Save preparation");
  await second.wait("return !document.querySelector('dialog[open]')");
  const providerCount = drive.files.size;
  drive.faults.loseFinalResponse = true;
  await click(second, "Save comparison PDF / XLSX version");
  await until(async () => {
    const report = (await view()).reports[0];
    return (
      report?.artifacts.some((a) => a.state === "failed") &&
      report.artifacts.some((a) => a.state === "complete")
    );
  }, "independent artifact outcomes after a lost acknowledgement");
  const report = (await view()).reports[0],
    failed = report.artifacts.find((a) => a.state === "failed");
  await click(second, "Retry " + failed.format.toUpperCase());
  await until(
    async () =>
      (await view()).reports[0].artifacts.every((a) => a.state === "complete"),
    "artifact retry reconciliation",
  );
  assert.equal(
    drive.files.size,
    providerCount + 2,
    "No duplicate artifact after lost acknowledgement",
  );
  for (const artifact of (await view()).reports[0].artifacts) {
    const response = await fetch(
      base + `/api/comparison-artifacts/${artifact.id}`,
      { headers: { Cookie: await cookie(second) } },
    );
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control"), /private.*no-store/);
    const bytes = Buffer.from(await response.arrayBuffer());
    const hash = (
      await sql(
        `select sha256 from private.comparison_archives where artifact_id='${artifact.id}';`,
      )
    ).output.trim();
    assert.equal(createHash("sha256").update(bytes).digest("hex"), hash);
    const range = await fetch(
      base + `/api/comparison-artifacts/${artifact.id}`,
      { headers: { Cookie: await cookie(second), Range: "bytes=0-4" } },
    );
    assert.equal(range.status, 206);
    assert.deepEqual(
      Buffer.from(await range.arrayBuffer()),
      bytes.subarray(0, 5),
    );
    await writeFile(
      `.verification/purchasing-comparison.${artifact.format}`,
      bytes,
    );
  }
  await capture(second);
  await browser.navigate(`/requests/${mrf}/quotes/${quote}`);
  await second.navigate(`/requests/${mrf}/quotes/${quote}`);
  await browser.wait("return !!document.querySelector('.quotation-revision')");
  await second.wait("return !!document.querySelector('.quotation-revision')");
  return { poId, allocated };
}

export async function checkPurchasingRebind({
  browser,
  sql,
  mrf,
  quote,
  poId,
  allocated,
}) {
  await browser.navigate(`/purchase-orders/${poId}`);
  await browser.wait(
    "if(!document.querySelector('dialog[open]'))[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Edit saved preparation')?.click();return !!document.querySelector('dialog[open] select')",
  );
  await browser.run(
    `const select=document.querySelector('dialog[open] select');select.value='${quote}';select.dispatchEvent(new Event('change',{bubbles:true}));`,
  );
  await browser.wait(
    "return [...document.querySelectorAll('button')].some(b=>b.textContent==='Save reviewed source rebind'&&!b.disabled)",
  );
  await browser.run(
    "[...document.querySelectorAll('button')].find(b=>b.textContent==='Save reviewed source rebind').click()",
  );
  await browser.wait(
    "return !document.querySelector('dialog[open]')&&document.body.textContent.includes('Source rebound')",
  );
  assert.equal(
    (
      await sql(
        `select quote_id::text from private.purchasing_records where id='${poId}';`,
      )
    ).output.trim(),
    quote,
  );
  assert.equal(
    (
      await sql(
        `select quantity::text from private.demand_claims where owner_id='${poId}' and quantity>0;`,
      )
    ).output.trim(),
    allocated,
  );
  assert.equal(
    (
      await sql(
        `select count(*) from private.po_preparers where po_id='${poId}';`,
      )
    ).output.trim(),
    "2",
  );
  await browser.navigate(`/requests/${mrf}/quotes/${quote}`);
  await browser.wait("return !!document.querySelector('.quotation-revision')");
}

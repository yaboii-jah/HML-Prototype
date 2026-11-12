import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";

/** Real Finance/Accounting sessions, actual UI, loopback Drive proof files. */
export async function checkPayments({
  browser,
  second,
  client,
  sql,
  base,
  drive,
  login,
  logout,
  poId,
  accountant,
  staff,
}) {
  const ok = (result, label) => {
    assert.equal(result.error?.message, undefined, label);
    return result.data;
  };
  const view = async () =>
    JSON.parse(
      (await sql(`select private.payment_view('${poId}');`)).output.trim(),
    );
  const signOut = async (page) => {
    if (await page.run("return !!document.querySelector('.masthead-account')"))
      await logout(page);
  };
  const click = async (page, label) => {
    const expression = `const root=document.querySelector('dialog[open]')||document;const b=[...root.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled);`;
    await page.wait(expression + "return !!b;");
    await page.run(expression + "b.click();");
  };
  const field = async (page, label, value, select = false) => {
    await page.run(`const root=document.querySelector('dialog[open]')||document;const label=[...root.querySelectorAll('label.field')].find(l=>l.querySelector('span')?.textContent===${JSON.stringify(label)});const el=label?.querySelector('input:not([type=checkbox]),textarea,select');if(!el)throw Error('Payment field missing');const setter=Object.getOwnPropertyDescriptor(el instanceof HTMLSelectElement?HTMLSelectElement.prototype:el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set;setter.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('${select ? "change" : "input"}',{bubbles:true}));`);
  };
  const entry = (reference) =>
    `[...document.querySelectorAll('.payment-entry')].find(e=>e.querySelector('h3')?.textContent===${JSON.stringify(reference)})`;
  const clickEntry = async (page, reference, label) => {
    const expression = `const e=${entry(reference)};const b=e&&[...e.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled);`;
    await page.wait(expression + "return !!b;");
    await page.run(expression + "b.click();");
  };
  const proofReady = (reference) =>
    `return !!${entry(reference)}?.querySelector('.payment-proof-files a[href^="/api/payment-files/"]')&&!document.body.innerText.includes('Group uploading');`;
  const choose = async (page, name, bytes) =>
    page.run(`const bytes=Uint8Array.from(atob('${bytes.toString("base64")}'),c=>c.charCodeAt(0));const dt=new DataTransfer();dt.items.add(new File([bytes],${JSON.stringify(name)},{type:'application/pdf'}));const input=document.querySelector('.payment-proof-files input[type=file]');if(!input)throw Error('Payment proof input missing');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));`);
  const capture = async (page, suffix) => {
    await mkdir(".verification", { recursive: true });
    await page.wait(
      "return !document.body.textContent.includes('Connecting live updates')",
      30000,
    );
    for (const width of [1440, 375]) {
      await page.call("Emulation.setDeviceMetricsOverride", {
        width,
        height: 1000,
        deviceScaleFactor: 1,
        mobile: width < 600,
      });
      await page.run(
        "document.querySelector('.mobile-scrim')?.click();await document.fonts.ready;document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().endTime)).forEach(a=>a.finish());window.scrollTo(0,0);",
      );
      if (width === 375)
        await page.wait(
          "return !document.querySelector('.mobile-scrim')&&document.querySelector('.side-nav').getBoundingClientRect().right<=1",
        );
      const shot = await page.call("Page.captureScreenshot", { format: "png" });
      await writeFile(
        `.verification/payment-${suffix}-${width}.png`,
        Buffer.from(shot.data, "base64"),
      );
      assert.equal(
        await page.run("return document.documentElement.scrollWidth<=innerWidth+1"),
        true,
        `Payment ${suffix} fits ${width}px`,
      );
    }
    await page.call("Emulation.clearDeviceMetricsOverride");
  };
  const cookie = async (page) =>
    (await page.call("Network.getAllCookies")).cookies
      .filter((value) => value.domain === "127.0.0.1")
      .map((value) => `${value.name}=${value.value}`)
      .join("; ");
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const tag = randomUUID().slice(0, 8);
  const firstRef = `PAY-QA-1-${tag}`;
  const secondRef = `PAY-QA-2-${tag}`;
  const finance = {
    email: randomUUID() + "@example.invalid",
    password: randomUUID(),
  };
  finance.id = ok(
    await client.auth.admin.createUser({
      email: finance.email,
      password: finance.password,
      email_confirm: true,
    }),
    "Create Finance account",
  ).user.id;
  ok(
    await client.from("profiles").insert({
      user_id: finance.id,
      display_name: "Finance payment reviewer",
      is_active: true,
    }),
    "Create Finance profile",
  );
  ok(
    await client
      .from("role_grants")
      .insert({ user_id: finance.id, role: "Finance" }),
    "Grant Finance role",
  );
  const initial = await view();
  const ref = initial.ref;
  const cents = (value) => BigInt(Math.round(Number(value) * 100));
  const money = (value) => `${value / 100n}.${String(value % 100n).padStart(2, "0")}`;
  const netCents = cents(initial.net);
  const grossCents = cents(initial.gross);
  const partialCents = netCents / 2n;
  const spentPartialCents = (grossCents * partialCents * 2n + netCents) / (netCents * 2n);
  const partial = money(partialCents);
  const net = money(netCents);

  // Finance keeps the retained coordination plan; it cannot prepare or settle.
  await signOut(second);
  await login(second, finance);
  await second.navigate("/finance");
  await second.wait(
    `return document.body.textContent.includes(${JSON.stringify(ref)})`,
  );
  await second.navigate(`/finance/${poId}`);
  await second.wait(
    "return document.body.textContent.includes('Finance coordination')&&!!document.querySelector('.payments-workspace')",
  );
  await click(second, "Review coordination plan");
  await field(second, "Priority", "High", true);
  await field(second, "Coordination status", "Scheduled", true);
  await field(second, "Planned payment date", today);
  await field(
    second,
    "Coordination notes / delay reason",
    "Finance scheduled the supplier transfer",
  );
  await click(second, "Save reviewed plan");
  await second.wait(
    "return document.body.textContent.includes('Finance scheduled the supplier transfer')",
  );
  let saved = await view();
  assert.equal(saved.coordination.plan.priority, "High");
  assert.equal(saved.coordination.plan.status, "Scheduled");
  assert.equal(saved.coordination.plan.plannedDate, today);
  assert.ok(saved.coordinators.includes(finance.id));
  assert.equal(
    await second.run(
      "return [...document.querySelectorAll('button')].some(b=>['Add payment draft','Clear delivery','Verify payment'].includes(b.textContent))",
    ),
    false,
    "Finance cannot prepare or settle payments",
  );

  // Accounting sees the retained plan and prepares proof-backed settlement.
  await signOut(browser);
  await login(browser, accountant);
  await browser.navigate(`/finance/${poId}`);
  await browser.wait(
    "return document.body.textContent.includes('Finance scheduled the supplier transfer')",
  );
  assert.equal(
    await browser.run(
      "return [...document.querySelectorAll('button')].some(b=>b.textContent==='Review coordination plan')",
    ),
    false,
    "Accounting cannot author Finance coordination",
  );
  await click(browser, "Add payment draft");
  await field(browser, "Supplier payment amount (PHP)", partial);
  await field(browser, "Bank / check / voucher reference", firstRef);
  await field(browser, "Actual payment date", today);
  await field(browser, "Payment method", "Bank transfer", true);
  await field(browser, "Payment note", "QA partial supplier transfer");
  await click(browser, "Save payment draft");
  await browser.wait(
    `return !document.querySelector('.payment-editor')&&document.body.textContent.includes(${JSON.stringify(firstRef)})`,
  );

  const pdf = await PDFDocument.create();
  pdf.addPage([400, 500]);
  const proofBytes = Buffer.from(await pdf.save());
  const replacementPdf = await PDFDocument.create();
  replacementPdf.addPage([400, 500]);
  replacementPdf.setTitle("Replacement payment proof");
  const replacementBytes = Buffer.from(await replacementPdf.save());

  // Interrupted upload survives reload; the matching local file resumes it and
  // an uncertain final response is reconciled without a duplicate archive.
  drive.faults.pauseUploads = true;
  await choose(browser, "payment.pdf", proofBytes);
  await clickEntry(browser, firstRef, "Save proof group");
  await browser.wait(
    "return !!document.querySelector('.payment-proof-files [role=alert]')",
  );
  await browser.navigate(`/finance/${poId}`);
  await browser.wait(
    "return document.body.textContent.includes('Reselect matching files to resume')",
  );
  drive.faults.pauseUploads = false;
  drive.faults.loseFinalResponse = true;
  await choose(browser, "payment.pdf", proofBytes);
  await clickEntry(browser, firstRef, "Resume uploads");
  await browser.wait(proofReady(firstRef));

  await clickEntry(browser, firstRef, "Verify payment");
  await browser.wait(
    "return !!document.querySelector('dialog[open] input[type=checkbox]')",
  );
  await browser.click("dialog[open] input[type=checkbox]");
  // Commit the action, discard only its response, then let realtime advance the
  // displayed version. Recovery must replay the original receipt identity.
  await browser.run(`window.paymentOriginalFetch=window.fetch;
    window.paymentLostResponse=false;
    window.fetch=async function(input,init){
      const response=await window.paymentOriginalFetch.call(this,input,init);
      if(!window.paymentLostResponse&&new Headers(init?.headers).has('Next-Action')&&typeof init?.body==='string'&&init.body.includes('verify')){
        window.paymentLostResponse=true;await response.clone().arrayBuffer();throw new TypeError('Synthetic lost payment acknowledgement');
      }
      return response;
    };`);
  await click(browser, "Verify payment");
  await browser.wait("return [...document.querySelectorAll('dialog[open] button')].some(b=>b.textContent.trim()==='Check saved outcome'&&!b.disabled)");
  assert.equal(await browser.run("return window.paymentLostResponse"),true);
  await browser.wait("return document.querySelector('dialog[open]')?.textContent.includes('The record changed')");
  const beforeRecovery = await view();
  assert.equal(beforeRecovery.verifications.length,1);
  await browser.run("window.fetch=window.paymentOriginalFetch;delete window.paymentOriginalFetch;");
  await click(browser, "Check saved outcome");
  await browser.wait("return !document.querySelector('dialog[open]')");
  await browser.wait(
    "return document.body.textContent.includes('Verified by')",
  );
  saved = await view();
  assert.equal(cents(saved.paid), partialCents);
  assert.equal(cents(saved.spent), spentPartialCents);
  assert.equal(saved.verifications.length, 1);
  assert.equal(saved.cleared, false);
  const firstFile = saved.verifications[0].files[0];
  const cookies = await cookie(browser);
  const download = await fetch(base + `/api/payment-files/${firstFile}`, {
    headers: { Cookie: cookies },
  });
  assert.equal(download.status, 200);
  assert.equal(download.headers.get("content-type"), "application/pdf");
  assert.equal(
    createHash("sha256")
      .update(Buffer.from(await download.arrayBuffer()))
      .digest("hex"),
    createHash("sha256").update(proofBytes).digest("hex"),
  );
  const range = await fetch(base + `/api/payment-files/${firstFile}`, {
    headers: { Cookie: cookies, Range: "bytes=0-4" },
  });
  assert.equal(range.status, 206);
  assert.equal(await range.text(), "%PDF-");

  // Reversal retains the verification/evidence but releases gross spending.
  await clickEntry(browser, firstRef, "Reverse payment");
  await field(
    browser,
    "Reason (at least five characters)",
    "QA reversal after reconciliation",
  );
  await click(browser, "Reverse payment");
  await browser.wait("return !document.querySelector('dialog[open]')");
  saved = await view();
  assert.equal(Number(saved.paid), 0);
  assert.equal(Number(saved.spent), 0);
  assert.ok(saved.verifications[0].reversal);
  await browser.wait("return document.body.textContent.includes('Reversed')");

  // The linked replacement settles the full net; then clearance can be held and
  // re-established without touching the original retained evidence.
  await clickEntry(browser, firstRef, "Prepare linked replacement");
  await browser.wait("return !!document.querySelector('.payment-editor')");
  await field(browser, "Supplier payment amount (PHP)", net);
  await field(browser, "Bank / check / voucher reference", secondRef);
  await field(browser, "Payment note", "QA full settlement after reversal");
  await click(browser, "Save payment draft");
  await browser.wait(
    `return !document.querySelector('.payment-editor')&&document.body.textContent.includes(${JSON.stringify(secondRef)})`,
  );
  await choose(browser, "payment-replacement.pdf", replacementBytes);
  await clickEntry(browser, secondRef, "Save proof group");
  await browser.wait(proofReady(secondRef));
  await clickEntry(browser, secondRef, "Verify payment");
  await browser.wait(
    "return !!document.querySelector('dialog[open] input[type=checkbox]')",
  );
  await browser.click("dialog[open] input[type=checkbox]");
  await click(browser, "Verify payment");
  await browser.wait("return !document.querySelector('dialog[open]')");
  saved = await view();
  assert.equal(cents(saved.paid), netCents);
  assert.equal(cents(saved.spent), grossCents);
  assert.equal(saved.settled, true);
  assert.equal(saved.cleared, false);
  assert.ok(
    saved.blockers.includes(
      "The approved quotation was withdrawn; Accounting must revoke approval",
    ),
  );

  // The withdrawn source gates clearance, but a reasoned delivery hold stays available.
  await browser.wait(
    "return document.body.textContent.includes('The approved quotation was withdrawn')&&document.body.textContent.includes('Settled')",
  );
  assert.equal(
    await browser.run(
      "return [...document.querySelectorAll('button')].some(b=>b.textContent==='Clear delivery'&&!b.disabled)",
    ),
    false,
    "Source prerequisites gate clearance",
  );
  await click(browser, "Place delivery hold");
  await field(
    browser,
    "Reason (at least five characters)",
    "QA delivery hold while source prerequisites are unresolved",
  );
  if (
    await browser.run(
      "return [...document.querySelectorAll('dialog[open] button')].some(b=>b.textContent==='I reviewed the latest payment work'&&!b.disabled)",
    )
  )
    await click(browser, "I reviewed the latest payment work");
  await click(browser, "Place delivery hold");
  await browser.wait("return !document.querySelector('dialog[open]')");
  saved = await view();
  assert.equal(saved.cleared, false);
  assert.equal(saved.clearanceHistory.at(-1).action, "hold");

  await browser.navigate(`/finance/${poId}`);
  await browser.wait(
    "return document.body.textContent.includes('Settled')&&document.body.textContent.includes('Delivery not cleared')&&document.body.textContent.includes('The approved quotation was withdrawn')",
  );
  await capture(browser, "detail");
  await browser.navigate("/finance");
  await browser.wait("return !!document.querySelector('.table-frame table')");
  await field(browser, "Payment view", "settled", true);
  await browser.wait(
    `return document.body.textContent.includes(${JSON.stringify(ref)})`,
  );
  await capture(browser, "directory");

  // Site Personnel cannot read Finance pages, payment views or proof files.
  await signOut(second);
  await login(second, staff[0]);
  await second.navigate("/finance");
  await second.wait("return location.pathname==='/projects'");
  await second.navigate(`/finance/${poId}`);
  await second.wait("return location.pathname==='/projects'");
  assert.equal(
    await second.run(
      `return (await fetch('/api/foundation/view?view=payments&poId=${poId}')).status`,
    ),
    403,
  );
  assert.equal(
    await second.run(
      `return (await fetch('/api/payment-files/${firstFile}')).status`,
    ),
    403,
  );

  console.log(
    "Finance coordination, proof recovery, verification, reversal, replacement, gated clearance and Site denial passed.",
  );
  return { poId, ref, financeId: finance.id, cleared: false };
}

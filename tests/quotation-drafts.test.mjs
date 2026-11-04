import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import {
  emptyQuoteBody,
  emptyQuoteLine,
  parseQuoteBody,
  parseQuoteCommand,
  parseQuotationsView,
  quoteDecimal,
  validQuoteFile,
  QUOTE_FILE_LIMIT,
} from "../src/domain/quotations/drafts.ts";
import { validateQuotationOriginal } from "../src/server/quotations/original-validation.ts";
import { createDriveGateway } from "../src/server/documents/drive-gateway.ts";
import { fakeDrive } from "../scripts/helpers/fake-drive.mjs";

test("quotation source values preserve precision, blank, zero and signed printed amounts", () => {
  const body = emptyQuoteBody(),
    line = emptyQuoteLine();
  line.quantity = "000012.12500";
  line.unitPrice = "12345678901234567890.12345678901234567890";
  line.printedTotal = "-123.4500";
  line.conversionFactor = "0.00000000000000000001";
  body.lines.push(line);
  body.printedTax = "0";
  const parsed = parseQuoteBody(body);
  assert.equal(parsed.lines[0].unitPrice, line.unitPrice);
  assert.equal(parsed.lines[0].quantity, line.quantity);
  assert.equal(parsed.lines[0].printedTotal, "-123.4500");
  assert.equal(parsed.printedTax, "0");
  assert.equal(parsed.printedSubtotal, "");
  assert.equal(parsed.currency, "");
  assert.equal(parsed.vatRate, "");
  for (const bad of [
    1,
    null,
    "1e3",
    "+1",
    "1,000",
    "NaN",
    ".5",
    "1.",
    "1".repeat(81),
  ])
    assert.equal(quoteDecimal(bad), null);
  assert.equal(quoteDecimal("-1", "quantity"), null);
  assert.equal(quoteDecimal("-0.00", "quantity"), "-0.00");
  assert.equal(quoteDecimal("0", "factor"), null);
  assert.equal(quoteDecimal("-1", "factor"), null);
  assert.equal(parseQuoteBody({ ...body, lines: [line, line] }), null);
  assert.equal(parseQuoteBody({ ...body, date: "2026-02-30" }), null);
  assert.equal(parseQuoteBody({ ...body, printedTotal: 12 }), null);
});

test("drafts admit incomplete capture but reject forged links, versions and status reasons", () => {
  const command = {
    type: "create",
    requestId: randomUUID(),
    mrfId: randomUUID(),
    supplierId: randomUUID(),
    body: emptyQuoteBody(),
  };
  assert.deepEqual(parseQuoteCommand(command), command);
  assert.equal(parseQuoteCommand({ ...command, supplierId: "forged" }), null);
  const status = {
    type: "status",
    requestId: randomUUID(),
    quoteId: randomUUID(),
    expectedVersion: "9007199254740993",
    state: "cancelled",
    reason: "  Changed supplier  ",
  };
  assert.equal(
    parseQuoteCommand(status).expectedVersion,
    status.expectedVersion,
  );
  assert.equal(parseQuoteCommand(status).reason, "Changed supplier");
  assert.equal(parseQuoteCommand({ ...status, reason: "    no  " }), null);
  assert.equal(parseQuoteCommand({ ...status, expectedVersion: 2 }), null);
  assert.equal(parseQuoteCommand({ ...status, state: "finalized" }), null);
  const line = emptyQuoteLine();
  line.requestItemId = "bad";
  assert.equal(parseQuoteBody({ ...emptyQuoteBody(), lines: [line] }), null);
});

test("quotation projections discard provider secrets and deny Site projections", () => {
  const file = {
    id: randomUUID(),
    name: "source.png",
    size: 100,
    mime: "image/png",
    sha256: "a".repeat(64),
    drive_file_id: "private-provider-id",
    encrypted_session: "secret",
  };
  const q = {
    id: randomUUID(),
    mrfId: randomUUID(),
    supplierId: randomUUID(),
    body: emptyQuoteBody(),
    state: "draft",
    version: "1",
    fileVersion: "1",
    creatorName: "Named procurement",
    createdAt: "2026-11-04",
    checked: null,
    matches: [],
    files: [file],
    groups: [],
    jobs: [],
  };
  const value = {
    role: "Accounting",
    request: { id: q.mrfId, ref: 'QA-MRF-0001', procurementReady: true, items: [{ id: randomUUID(), name: 'Requested material', unit: 'pc', quantity: '12.125' }] },
    suppliers: [],
    quotes: [q],
    history: [],
  };
  const parsed = parseQuotationsView(value);
  assert.equal(parsed.quotes[0].checked, false);
  assert.equal(JSON.stringify(parsed).includes("private-provider-id"), false);
  assert.equal(JSON.stringify(parsed).includes("secret"), false);
  assert.equal(parseQuotationsView({ ...value, role: "Site Personnel" }), null);
  assert.equal(validQuoteFile({ ...file, mime: "image/svg+xml" }), false);
  assert.equal(validQuoteFile({ ...file, size: QUOTE_FILE_LIMIT + 1 }), false);
});

test("original validation fully decodes each supported image and rejects mismatched or damaged content", async () => {
  for (const [format, mime] of [
    ["png", "image/png"],
    ["jpeg", "image/jpeg"],
    ["webp", "image/webp"],
  ]) {
    const bytes = await sharp({
      create: { width: 5, height: 5, channels: 3, background: "#165c43" },
    })
      .toFormat(format)
      .toBuffer();
    await validateQuotationOriginal(bytes, mime);
    await assert.rejects(
      validateQuotationOriginal(
        bytes,
        mime === "image/png" ? "image/jpeg" : "image/png",
      ),
    );
    await assert.rejects(
      validateQuotationOriginal(
        bytes.subarray(0, Math.floor(bytes.length / 2)),
        mime,
      ),
    );
  }
  const pdf = await PDFDocument.create();
  pdf.addPage();
  await validateQuotationOriginal(await pdf.save(), "application/pdf");
  await assert.rejects(
    validateQuotationOriginal(
      Buffer.from("%PDF- fake %%EOF"),
      "application/pdf",
    ),
  );
  await assert.rejects(
    validateQuotationOriginal(Buffer.from("<svg></svg>"), "image/svg+xml"),
  );
});

test("MIME-aware Drive transport verifies exact mixed-original identity, bytes and Range reads", async () => {
  const fake = await fakeDrive(),
    drive = createDriveGateway(
      fake.origin,
      async () => "disposable-drive-token",
    );
  try {
    const folder = await drive.generateId();
    await drive.ensureFolder(folder, fake.root, "Quotation fixture", {
      owned: "quotation-test",
    });
    const bytes = await sharp({
      create: { width: 3, height: 3, channels: 3, background: "#165c43" },
    })
      .png()
      .toBuffer();
    const id = await drive.generateId(),
      tags = { hmlQuotationFile: randomUUID() },
      hash = createHash("sha256").update(bytes).digest("hex");
    const uri = await drive.begin(
      id,
      folder,
      "source.png",
      bytes.length,
      tags,
      "image/png",
    );
    await drive.transfer(uri, bytes.length, bytes, 0, "image/png");
    assert.deepEqual(
      await drive.verifyFile(id, folder, tags, bytes.length, hash, "image/png"),
      bytes,
    );
    await assert.rejects(
      drive.verifyFile(id, folder, tags, bytes.length, hash, "image/jpeg"),
    );
    const part = await drive.stream(id, { start: 0, end: 7 });
    assert.equal(part.headers.get("content-type"), "image/png");
    assert.deepEqual(
      Buffer.from(await part.arrayBuffer()),
      bytes.subarray(0, 8),
    );
    await assert.rejects(drive.trash(id, { hmlQuotationFile: "foreign" }));
    await drive.trash(id, tags);
    assert.equal((await drive.get(id)).trashed, true);
  } finally {
    await fake.close();
  }
});

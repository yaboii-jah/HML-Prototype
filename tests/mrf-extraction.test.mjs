import test from "node:test";
import assert from "node:assert/strict";
import { seedDemo } from "../src/mock/fixtures/seed.ts";
import { applyCommand } from "../src/domain/commands.ts";
import { MAX_MRF_SOURCE_BYTES, mrfSourceError, mrfSourceSignature, parseMrfExtraction, mrfImportedItems } from "../src/domain/mrf-extraction.ts";

export const extractedMrf = () => ({
  documentType: "single_mrf",
  details: { projectName: "Printed project", ref: " MRF-AI-01 ", requestDate: "2026-10-05", requestedBy: "Site author", approvedBy: "Printed signatory", purchaser: "Buyer", financeOfficer: "Finance", specialInstructions: " Keep dry " },
  items: [{ name: " Cement ", quantity: 12.5, unit: " bag ", neededDate: "2026-10-08", purpose: null, location: "Site", remarks: "Check packaging" }], warnings: [],
});
const context = { now: () => "2026-10-05T12:00:00.000Z", id: prefix => `${prefix}-ai-test` };
const command = () => ({ type: "saveRequest", intent: "submit", siteId: "site-a", scopeId: "site-a-scope", ...parseMrfExtraction(extractedMrf()).extraction.details, items: mrfImportedItems(parseMrfExtraction(extractedMrf()).extraction, () => "item-ai"), documents: [{ name: "Supporting.pdf", type: "Supporting PDF", fileId: "support-ai" }] });
const execute = (state, value) => { const result = applyCommand(state, value, context); assert.equal(result.ok, true, result.message); return result.snapshot; };

test("MRF source policy accepts one PDF or ordered photos within the total limit", () => {
  assert.equal(mrfSourceError([{ type: "application/pdf", size: MAX_MRF_SOURCE_BYTES }]), "");
  assert.equal(mrfSourceError(Array.from({ length: 12 }, () => ({ type: "image/png", size: 100 }))), "");
  for (const files of [[], [{ type: "application/pdf", size: 20 }, { type: "image/png", size: 20 }], [{ type: "application/pdf", size: 10 }, { type: "application/pdf", size: 10 }], Array.from({ length: 13 }, () => ({ type: "image/jpeg", size: 5 })), [{ type: "text/plain", size: 10 }], [{ type: "image/webp", size: 0 }], [{ type: "image/png", size: MAX_MRF_SOURCE_BYTES + 1 }]]) assert.notEqual(mrfSourceError(files), "");
  assert.notEqual(mrfSourceError([{ type: "image/png", size: MAX_MRF_SOURCE_BYTES / 2 + 1 }, { type: "image/jpeg", size: MAX_MRF_SOURCE_BYTES / 2 }]), "");
});

test("MRF source signature checks reject disguised files", () => {
  for (const [mime, bytes] of [["application/pdf", Buffer.from("%PDF-1.4")], ["image/png", Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])], ["image/jpeg", Uint8Array.from([255, 216, 255])], ["image/webp", Buffer.from("RIFF1234WEBP")]]) {
    assert.equal(mrfSourceSignature(bytes, mime), true);
    assert.equal(mrfSourceSignature(Buffer.from("pretend file"), mime), false);
    assert.equal(mrfSourceSignature(new Uint8Array(), mime), false);
  }
});

test("missing or invalid extracted values remain blank and require manual correction", () => {
  const raw = extractedMrf(); raw.details.requestDate = "2026-02-30"; raw.details.requestedBy = null;
  raw.items.push({ ...raw.items[0], quantity: null, unit: null, neededDate: "08/10/26", location: null });
  const result = parseMrfExtraction(raw);
  assert.equal(result.extraction.details.ref, "MRF-AI-01");
  assert.equal(result.extraction.details.requestDate, "");
  assert.equal(result.extraction.details.requestedBy, "");
  assert.equal(result.extraction.items[1].quantity, null);
  assert.equal(result.extraction.items[1].neededDate, "");
  assert.equal(result.extraction.items[1].unit, "");
  assert.equal(result.extraction.items[1].location, "");
  let index = 0; const items = mrfImportedItems(result.extraction, () => `item-${++index}`);
  assert.deepEqual(items.map(item => item.id), ["item-1", "item-2"]);
  assert.deepEqual(items.map(item => item.quantity), [12.5, 0]);
  assert.equal(items[0].purpose, "");
  assert.ok(result.warnings.length >= 4);
  assert.equal(applyCommand(seedDemo(), { ...command(), items }, context).field, "items");
  assert.deepEqual(mrfImportedItems({ details: result.extraction.details, items: [] }, () => "empty")[0], { id: "empty", name: "", unit: "", quantity: 0, neededDate: "", purpose: "", location: "", remarks: "" });
});

test("normalization preserves repeated material rows and all warnings on a large incomplete form", () => {
  const raw = extractedMrf(); raw.items = Array.from({ length: 100 }, () => ({ ...raw.items[0], quantity: 0, neededDate: null }));
  const result = parseMrfExtraction(raw);
  assert.equal(result.extraction.items.length, 100);
  assert.ok(result.warnings.length > 50);
  assert.deepEqual(parseMrfExtraction({ documentType: "single_mrf", ...result.extraction, warnings: result.warnings }), result);
});

test("MRF parser rejects mixed requests, unrelated documents and malformed structures", () => {
  assert.throws(() => parseMrfExtraction({ ...extractedMrf(), documentType: "multiple_mrfs" }), /more than one MRF/);
  assert.throws(() => parseMrfExtraction({ ...extractedMrf(), documentType: "other" }), /does not appear/);
  for (const raw of [null, {}, { ...extractedMrf(), items: [{ ...extractedMrf().items[0], quantity: "10" }] }, { ...extractedMrf(), items: Array.from({ length: 101 }, () => extractedMrf().items[0]) }, { ...extractedMrf(), details: null }, { ...extractedMrf(), warnings: [123] }]) assert.throws(() => parseMrfExtraction(raw));
});

test("AI draft metadata survives storage and review cannot be bypassed by omitting the AI flag", () => {
  const initial = seedDemo();
  const state = execute(initial, { ...command(), intent: "draft", aiAssisted: true, aiReviewed: true, ref: "", documents: [] });
  const draft = state.requests.at(-1);
  assert.equal(draft.aiAssisted, true);
  assert.equal(draft.aiReviewedAt, undefined);
  assert.equal(draft.aiReviewedBy, undefined);
  const reopened = JSON.parse(JSON.stringify(state));
  const rejected = applyCommand(reopened, { ...command(), id: draft.id, aiAssisted: false }, context);
  assert.equal(rejected.field, "aiReview");
  assert.equal(reopened.requests.at(-1).status, "draft");
  const submitted = execute(reopened, { ...command(), id: draft.id, aiReviewed: true });
  assert.equal(submitted.requests.at(-1).aiReviewedAt, context.now());
  assert.equal(submitted.requests.at(-1).aiReviewedBy, "Site Personnel");
  assert.equal(submitted.requests.at(-1).approvedBy, "Printed signatory");
  assert.equal(submitted.requests.at(-1).status, "submitted");
  assert.equal(initial.requests.length + 1, submitted.requests.length);
});

test("returned AI requests need fresh review while manual requests retain their existing flow", () => {
  let state = execute(seedDemo(), { ...command(), aiAssisted: true, aiReviewed: true });
  const id = state.requests.at(-1).id;
  state = execute({ ...state, role: "Project Manager" }, { type: "reviewRequest", id, decision: "return", reason: "Please correct quantity" });
  state = execute({ ...state, role: "Site Personnel" }, { ...command(), id, intent: "draft" });
  assert.equal(state.requests.at(-1).aiReviewedAt, undefined);
  assert.equal(applyCommand(state, { ...command(), id }, context).field, "aiReview");
  assert.equal(applyCommand({ ...state, role: "Finance" }, { ...command(), id, aiReviewed: true }, context).ok, false);
  const manual = execute(seedDemo(), command()).requests.at(-1);
  assert.equal(manual.aiAssisted, undefined);
  assert.equal(manual.aiReviewedAt, undefined);
});

test("AI acknowledgement cannot replace the separately required supporting PDF", () => {
  for (const documents of [[], [{ name: "Scan.pdf", type: "MRF source", fileId: "source" }], [{ name: "Supporting.pdf", type: "Supporting PDF" }]]) assert.equal(applyCommand(seedDemo(), { ...command(), aiAssisted: true, aiReviewed: true, documents }, context).field, "documents");
});

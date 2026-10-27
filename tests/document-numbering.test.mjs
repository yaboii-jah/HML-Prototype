import { initializedWorkspaceStorage } from './helpers/initialized-storage.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import { seedDemo } from "./fixtures/workspace.ts";
import { applyCommand } from "../src/domain/commands.ts";
import { archiveFileName, issueDocumentReference, nextDocumentReference, validDocumentNumberingState } from "../src/domain/document-numbering.ts";
import { COMPANY_WAREHOUSE } from "../src/domain/company.ts";
import { deliveryLocations } from "../src/domain/delivery-flow.ts";
import { LocalDemoRepository } from "../src/mock/repository.ts";

let sequence = 0;
const at = "2026-10-12T08:00:00.000Z";
const context = { now: () => at, id: prefix => `${prefix}-numbering-${++sequence}` };
const run = (state, command, role = state.role) => {
  const result = applyCommand({ ...state, role }, command, context);
  assert.equal(result.ok, true, result.message);
  return result.snapshot;
};
const requestCommand = siteId => ({ type: "saveRequest", siteId, intent: "draft", ref: "IGNORED-MANUAL-NUMBER", sourceRef: "PAPER-372", requestDate: "2026-10-12", requestedBy: "Site", approvedBy: "PM", purchaser: "Buyer", financeOfficer: "Finance", items: [], documents: [] });

test("Project codes normalize, reject invalid/duplicate codes, and lock only after successful use", () => {
  let state = seedDemo();
  state = run(state, { type: "addSite", documentCode: " hml-test ", name: "Numbering project", location: "San Juan", budget: 10000 }, "Administrator");
  const site = state.sites.at(-1);
  assert.equal(site.documentCode, "HML-TEST");
  const add = { type: "addSite", name: "Other project", location: "Manila", budget: 0 };
  for (const documentCode of [undefined, "hml-test", "HAS SPACE", "-ABC", "ABC-", "A".repeat(21)]) {
    assert.equal(applyCommand({ ...state, role: "Administrator" }, { ...add, documentCode }, context).ok, false);
  }
  const edit = { type: "updateSite", siteId: site.id, name: site.name, location: site.location, budget: site.budget };
  state = run(state, { ...edit, documentCode: "ALT" }, "Project Manager");
  assert.equal(state.sites.at(-1).codeLockedAt, undefined);
  state = run(state, requestCommand(site.id), "Site Personnel");
  assert.equal(state.requests.at(-1).ref, "ALT-MRF-0001");
  assert.equal(state.sites.at(-1).codeLockedAt, at);
  assert.equal(applyCommand({ ...state, role: "Administrator" }, { ...edit, documentCode: "NEW" }, context).ok, false);
  state = run(state, { ...edit, documentCode: "ALT", name: "Renamed project" }, "Administrator");
  assert.equal(state.requests.at(-1).ref, "ALT-MRF-0001");
});

test("First saves assign permanent MRF numbers, preserve source numbers and prohibit project moves", () => {
  let state = seedDemo();
  const legacy = structuredClone(state.requests);
  state = run(state, requestCommand("site-a"), "Site Personnel");
  const first = state.requests.at(-1);
  assert.equal(first.ref, "HBR-MRF-0001");
  assert.equal(first.sourceRef, "PAPER-372");
  state = run(state, { ...requestCommand("site-a"), id: first.id, ref: "TAMPERED", sourceRef: "CORRECTED-PAPER" }, "Site Personnel");
  assert.equal(state.requests.at(-1).ref, first.ref);
  assert.equal(state.sites[0].documentCounters.MRF, 1);
  assert.equal(state.requests.at(-1).sourceRef, "CORRECTED-PAPER");
  const move = applyCommand({ ...state, role: "Site Personnel" }, { ...requestCommand("site-b"), id: first.id }, context);
  assert.equal(move.ok, false);
  assert.equal(move.field, "siteId");
  state = run(state, requestCommand("site-a"), "Site Personnel");
  state = run(state, requestCommand("site-b"), "Site Personnel");
  assert.deepEqual(state.requests.slice(-2).map(value => value.ref), ["HBR-MRF-0002", "NWL-MRF-0001"]);
  assert.deepEqual(state.requests.slice(0, legacy.length), legacy);
});

test("Uncoded projects reject new records; failed saves and unauthorized actions consume no numbers", () => {
  const state = seedDemo();
  delete state.sites[0].documentCode;
  const before = structuredClone(state);
  assert.equal(applyCommand(state, requestCommand("site-a"), context).field, "siteId");
  assert.deepEqual(state, before);
  const coded = seedDemo();
  const failed = applyCommand(coded, { ...requestCommand("site-a"), intent: "submit" }, context);
  assert.equal(failed.ok, false);
  assert.equal(coded.sites[0].documentCounters, undefined);
  assert.equal(applyCommand({ ...coded, role: "Finance" }, requestCommand("site-a"), context).ok, false);
  assert.equal(nextDocumentReference(coded, "site-a", "MRF").ref, "HBR-MRF-0001");
});

test("Project/type counters remain independent, skip occupied legacy refs and never reuse rejected/deleted numbers", () => {
  const state = seedDemo();
  state.requests.push({ ...structuredClone(state.requests[0]), id: "imported", ref: "HBR-MRF-0001" });
  const first = issueDocumentReference(state, "site-a", "MRF", at);
  assert.equal(first.ref, "HBR-MRF-0002");
  state.requests.push({ ...structuredClone(state.requests[0]), id: "issued", status: "rejected", ...first });
  assert.equal(issueDocumentReference(state, "site-a", "PO", at).ref, "HBR-PO-0001");
  assert.equal(issueDocumentReference(state, "site-b", "MRF", at).ref, "NWL-MRF-0001");
  state.requests = state.requests.filter(value => value.id !== "issued");
  assert.equal(issueDocumentReference(state, "site-a", "MRF", at).ref, "HBR-MRF-0003");
  state.sites[0].documentCounters.DEL = 9999;
  assert.equal(issueDocumentReference(state, "site-a", "DEL", at).ref, "HBR-DEL-10000");
});

test("Actual PO and delivery creation use separate project sequences and preserve recorded destinations", () => {
  let state = seedDemo();
  state.pos = [];
  state.batches = [];
  state = run(state, { type: "createPO", requestId: "m1", quoteId: "q1", reason: "Lowest compliant offer", notes: "" }, "Procurement");
  const po = state.pos[0];
  assert.equal(po.ref, "HBR-PO-0001");
  po.status = "released"; po.paymentMode = "credit"; po.archive = { status: "complete", fileId: "po", url: "https://drive.google.com/file/d/po/view" };
  state = run(state, { type: "createBatch", poId: po.id, leg: "supplier-warehouse", destination: { ...COMPANY_WAREHOUSE }, scheduledDate: "2026-10-13", evidence: "Delivery slip pending", delayReason: "", expected: { "m1-i1": 10 } }, "Logistics");
  assert.equal(state.batches[0].ref, "HBR-DEL-0001");
  assert.equal(state.batches[0].destination.address, "155 M. Paterno St., San Juan City");
  assert.equal(state.sites[0].documentCounters.PO, 1);
  assert.equal(state.sites[0].documentCounters.DEL, 1);
});

test("Upload archive names prefix legacy parents without rewriting source names/hashes, and artifact-only use locks codes", () => {
  let state = seedDemo();
  const quote = { ...structuredClone(state.quotes[0]), id: "new-draft", reviewStatus: "draft", adjustments: [], documents: [{ name: "Supplier original.pdf", type: "application/pdf", fileId: "original-file" }] };
  state = run(state, { type: "saveQuoteDraft", quote }, "Procurement");
  const saved = state.quotes.at(-1).documents[0];
  assert.equal(saved.name, "Supplier original.pdf");
  assert.match(saved.archiveName, /^HBR-MRF-2026-001-/);
  assert.equal(state.sites[0].codeLockedAt, at);
  assert.equal(state.sites[0].documentCounters, undefined);
  state = run(state, { type: "saveQuoteDraft", quote: { ...state.quotes.at(-1), documents: [{ ...saved, archiveName: "CHANGED.pdf" }] } }, "Procurement");
  assert.equal(state.quotes.at(-1).documents[0].archiveName, saved.archiveName);
  state = run(state, { type: "saveQuoteDraft", quote: { ...quote, id: "another-quotation-copy" } }, "Procurement");
  assert.notEqual(state.quotes.at(-1).documents[0].archiveName, saved.archiveName, "Reusing a source file in another quotation produces a distinct archive filename");
  const proofPO = state.pos[0];
  Object.assign(proofPO, { workflow: "pm-external-v1", status: "approved", paymentMode: "upfront", issuance: { at, by: { name: "Buyer", email: "buyer@example.com", role: "Procurement" } } });
  const proof = { name: "Bank receipt.pdf", mime: "application/pdf", size: 120, localFileId: "proof-original", sha256: "a".repeat(64) };
  state = run(state, { type: "attachPaymentProofs", poId: proofPO.id, documents: [proof] }, "Accounting / Auditing");
  const savedProof = state.pos[0].paymentProofs[0];
  assert.equal(savedProof.name, proof.name);
  assert.equal(savedProof.sha256, proof.sha256);
  assert.match(savedProof.archiveName, /^HBR-PO-2026-001-/);
  assert.equal(savedProof.localFileId, proof.localFileId);
});

test("A document correction on a legacy MRF prefixes the new archive without changing previous versions", () => {
  let state = seedDemo();
  const request = state.requests[0];
  state.sites[0].driveFolderId = "project-folder";
  const versions = [{ version: 1, formFileId: "old-form", supportFileId: "old-support", formUrl: "https://drive.google.com/file/d/old-form/view", supportUrl: "https://drive.google.com/file/d/old-support/view", archivedAt: at }];
  request.archive = { status: "complete", approvedAt: at, versions: structuredClone(versions) };
  request.correction = { status: "requested", scope: "documents", reason: "Replace supporting document" };
  state = run(state, { ...requestCommand(request.siteId), ...request, type: "saveRequest", intent: "submit", documents: [{ name: "Replacement.pdf", type: "Supporting PDF", fileId: "new-support" }] }, "Site Personnel");
  assert.equal(state.requests[0].ref, request.ref);
  assert.equal(state.requests[0].archiveRef, "HBR-" + request.ref);
  assert.deepEqual(state.requests[0].archive.versions, versions);
  state = run(state, { type: "reviewRequest", id: request.id, decision: "approve" }, "Procurement");
  assert.equal(state.requests[0].archive.fileRef, "HBR-" + request.ref);
  assert.deepEqual(state.requests[0].archive.versions, versions);
});

test("Long archive names preserve the identifying prefix, stable suffix and extension", () => {
  const name = archiveFileName("PROJECT-PO-0001", "Very long supplier document ".repeat(20) + ".pdf", "unique-proof-id");
  assert.ok(name.length <= 120);
  assert.match(name, /^PROJECT-PO-0001-/);
  assert.ok(name.endsWith("-unique-proof-id.pdf"));
  assert.notEqual(name, archiveFileName("PROJECT-PO-0001", "Very long supplier document ".repeat(20) + ".pdf", "different-proof-id"));
});

test("Numbering survives schema-12 reload; uncoded legacy projects remain loadable without backfill", async () => {
  const state = run(seedDemo(), requestCommand("site-a"), "Site Personnel");
  const stored = new Map([["hml-constructsync-demo-v12", JSON.stringify(state)]]);
  const oldWindow = globalThis.window;
  const oldStorage = globalThis.localStorage;
  globalThis.window = { localStorage: { getItem: key => stored.get(key) || null, setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) }, addEventListener() {} };
  globalThis.localStorage = initializedWorkspaceStorage(globalThis.window.localStorage);
  try {
    const loaded = await new LocalDemoRepository().load();
    assert.equal(loaded.status, "ready");
    assert.equal(nextDocumentReference(loaded.snapshot, "site-a", "MRF").ref, "HBR-MRF-0002");
    assert.deepEqual(loaded.snapshot.requests.at(-1).numbering, state.requests.at(-1).numbering);
    const legacy = seedDemo(); legacy.sites.forEach(site => { delete site.documentCode; });
    stored.set("hml-constructsync-demo-v12", JSON.stringify(legacy));
    const old = await new LocalDemoRepository().load();
    assert.equal(old.status, "ready");
    assert.equal(old.snapshot.sites[0].documentCode, undefined);
    assert.equal(old.snapshot.requests[0].ref, legacy.requests[0].ref);
    const corrupt = structuredClone(state); corrupt.requests.at(-1).numbering.projectId = "site-b";
    assert.equal(validDocumentNumberingState(corrupt), false);
    const unlocked = structuredClone(state); delete unlocked.sites[0].codeLockedAt; delete unlocked.sites[0].documentCounters;
    assert.equal(validDocumentNumberingState(unlocked), false, "An issued reference must keep its project code locked after reload");
  } finally { globalThis.window = oldWindow; globalThis.localStorage = oldStorage; }
});

test("Warehouse default is exact while existing and onward delivery addresses remain authoritative", () => {
  const state = seedDemo(), po = state.pos[0];
  assert.equal(COMPANY_WAREHOUSE.address, "155 M. Paterno St., San Juan City");
  assert.equal(deliveryLocations(state, po, { ...state.batches[0], leg: "supplier-warehouse", destination: { name: "Depot", address: "Original depot address" } }).destination.address, "Original depot address");
  assert.equal(deliveryLocations(state, po, { ...state.batches[0], leg: "warehouse-site", origin: { name: "Depot", address: "Saved parent warehouse" }, destination: { name: "Site", address: "Saved site" } }).origin.address, "Saved parent warehouse");
});

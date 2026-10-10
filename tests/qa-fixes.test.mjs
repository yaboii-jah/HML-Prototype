import test from "node:test";
import assert from "node:assert/strict";
import { applyCommand } from "../src/domain/commands.ts";
import { seedDemo } from "../src/mock/fixtures/seed.ts";
import { blankWorkspace } from "../src/mock/fixtures/blank.ts";
import { projectRemovalReason } from "../src/domain/project-removal.ts";
import { deliveryEvidenceStatus, deliveryDocumentIssues } from "../src/domain/delivery-archive.ts";
import { tasksFor } from "../src/domain/queues.ts";
import { bindAccountCommands } from "../src/app-state/command-gateway.ts";

let sequence = 0;
const context = role => ({ now: () => "2026-10-10T08:00:00Z", id: prefix => `${prefix}-qa-${++sequence}`, actor: { name: "QA user", email: "qa@example.com", role } });
const execute = (state, command, role = state.role) => applyCommand(state, command, context(role));
const run = (state, command, role) => { const result = execute(state, command, role); assert.equal(result.ok, true, result.message); return result.snapshot; };

test("unused project deletion retains Drive references in audit, removes scopes and clears its filter", () => {
  for (const role of ["Administrator", "Project Manager"]) {
    let state = run(blankWorkspace(), { type: "addSite", name: "Accidental project", location: "Pasig", budget: 100 }, role);
    const siteId = state.sites[0].id;
    state = run(state, { type: "setProjectDriveFolder", siteId, folderId: "retained-drive-folder" }, role);
    state = run(state, { type: "saveProjectScope", siteId, name: "Unused scope", budget: 50 }, role);
    state.siteFilter = siteId;
    const deleted = run(state, { type: "removeSite", siteId }, role);
    assert.equal(deleted.sites.length, 0); assert.equal(deleted.scopes.length, 0); assert.equal(deleted.siteFilter, "all");
    assert.equal(deleted.activity[0].eventType, "project.removed"); assert.equal(deleted.activity[0].entityRef, "Accidental project");
    assert.equal(deleted.activity[0].projectId, siteId); assert.match(deleted.activity[0].reason, /retained-drive-folder/);
    assert.equal(state.sites.length, 1, "caller state is immutable");
  }
});

test("project deletion rejects linked records and unauthorized roles without losing history", () => {
  const state = seedDemo(), before = structuredClone(state);
  assert.match(execute(state, { type: "removeSite", siteId: state.sites[0].id }, "Administrator").message, /material requests/);
  for (const role of ["Procurement", "Finance", "Site Personnel", "Logistics", "Accounting / Auditing"]) assert.equal(execute(state, { type: "removeSite", siteId: state.sites[0].id }, role).ok, false);
  assert.deepEqual(state, before);
  const stock = structuredClone(state); stock.requests = [];
  stock.movements = [{ id: "stock", siteId: stock.sites[0].id }];
  assert.equal(execute(stock, { type: "removeSite", siteId: stock.sites[0].id }, "Project Manager").ok, false);
});

test("folder creation blocks deletion until acknowledgement and abandoned operations expire", () => {
  let state = run(blankWorkspace(), { type: "addSite", name: "Pending project", location: "Pasig", budget: 100 }, "Administrator");
  const siteId = state.sites[0].id;
  state = run(state, { type: "startOperation", target: { kind: "project", id: siteId } }, "Administrator");
  assert.equal(execute(state, { type: "removeSite", siteId }, "Administrator").ok, false);
  assert.match(projectRemovalReason(state, siteId, Date.parse("2026-10-10T08:00:30Z")), /Wait/);
  assert.equal(projectRemovalReason(state, siteId, Date.parse("2026-10-10T08:02:00Z")), "");
  state = run(state, { type: "failProjectFolder", siteId, error: "Drive unavailable" }, "Administrator");
  assert.equal(execute(state, { type: "removeSite", siteId }, "Administrator").ok, true);
});

test("captured project deletion rejects a switched account", async () => {
  const actor = context("Administrator").actor;
  const state = run(blankWorkspace(), { type: "addSite", name: "Unused", location: "Pasig", budget: 0 }, "Administrator");
  let active = actor;
  const gateway = bindAccountCommands({ getSnapshot: () => ({ snapshot: state }), execute: async (command, current) => applyCommand(state, command, { ...context(current.role), actor: current }) }, actor, () => active);
  active = { ...actor, email: "different@example.com" };
  assert.equal((await gateway.run({ type: "removeSite", siteId: state.sites[0].id })).ok, false);
});

function allocationFixture() {
  const state = seedDemo(); state.role = "Procurement"; state.pos = []; state.pendingAwards = [];
  const request = state.requests[0]; request.status = "approved"; request.archive = undefined; request.correction = undefined;
  request.items = ["one", "two"].map(id => ({ ...request.items[0], id, quantity: 10 }));
  state.quotes = [{ id: "supplier-offer", mrfId: request.id, supplierId: state.suppliers[0].id, ref: "Q-QA", prices: {}, available: "", leadDays: 0, terms: "", documents: [], currency: "PHP", reviewStatus: "finalized", lines: request.items.map(item => ({ id: `offer-${item.id}`, description: item.name, quantity: 10, unit: item.unit, unitPrice: 100, conversionFactor: 1, requestItemId: item.id, brand: "", specification: "", varianceReason: "", matchConfirmed: true })) }];
  return state;
}
const material = (itemId, quantity) => ({ itemId, awards: [{ quoteId: "supplier-offer", quoteLineId: `offer-${itemId}`, quantity }] });
const batch = (state, materials) => ({ type: "replaceMaterialAwardBatch", requestId: state.requests[0].id, materials });

test("allocation batches apply partial awards across materials and suppress unchanged audit entries", () => {
  let state = allocationFixture();
  state = run(state, batch(state, [material("one", 2), material("two", 3)]));
  assert.deepEqual(state.pendingAwards.map(value => value.quantity), [2, 3]);
  const ids = state.pendingAwards.map(value => value.id), history = state.activity.length;
  state = run(state, batch(state, [material("one", 2), material("two", 3)]));
  assert.deepEqual(state.pendingAwards.map(value => value.id), ids); assert.equal(state.activity.length, history);
  state = run(state, batch(state, [{ itemId: "one", awards: [] }]));
  assert.deepEqual(state.pendingAwards.map(value => value.itemId), ["two"]);
});

test("a later invalid allocation rolls back every material and audit change", () => {
  const state = allocationFixture(), before = structuredClone(state);
  for (const materials of [[material("one", 2), material("two", 11)], [material("one", 2), material("two", NaN)], [material("one", 2), material("missing", 1)], [material("one", 2), material("one", 3)], []]) {
    assert.equal(execute(state, batch(state, materials)).ok, false); assert.deepEqual(state, before);
  }
});

test("allocation batches enforce role, current quotation, archive and existing PO rules", () => {
  const state = allocationFixture(), command = batch(state, [material("one", 2), material("two", 3)]);
  assert.equal(execute(state, command, "Finance").ok, false);
  for (const mutate of [state => { state.quotes[0].archive = { status: "pending", files: [] }; }, state => { state.quotes[0].reviewStatus = "draft"; }, state => { state.quotes.push({ ...structuredClone(state.quotes[0]), id: "newer", supersedesId: "supplier-offer" }); }, state => { state.pos.push({ id: "already-ordered", mrfId: state.requests[0].id, quoteId: state.quotes[0].id, status: "draft", lines: [] }); }]) {
    const changed = structuredClone(state); mutate(changed); const before = structuredClone(changed);
    assert.equal(execute(changed, command).ok, false); assert.deepEqual(changed, before);
  }
});

function receiptFixture(leg = "supplier-site") {
  let state = seedDemo(); state.batches = []; state.movements = []; state.accounting = [];
  state = run(state, { type: "createBatch", poId: "po1", leg, scheduledDate: "2026-10-10", evidence: "QA-DR", delayReason: "", expected: { "m1-i1": 10 }, ...(leg === "supplier-warehouse" ? { destination: { name: "Warehouse", address: "Pasig" } } : {}) }, "Logistics");
  state = run(state, { type: "dispatchBatch", id: state.batches[0].id }, "Logistics");
  return run(state, { type: "confirmBatch", id: state.batches[0].id, lines: { "m1-i1": { accepted: 10, issue: "" } } }, leg === "supplier-warehouse" ? "Procurement" : "Site Personnel");
}
function receiptTasks(state, role) { return tasksFor({ ...state, role, siteFilter: "all" }).filter(task => task.href.includes("#delivery-documents")); }

test("receipt follow-up is role-specific, version-aware and visible beyond eight deliveries", () => {
  const state = receiptFixture(), batch = state.batches[0];
  assert.equal(receiptTasks(state, "Site Personnel").length, 1); assert.equal(receiptTasks(state, "Procurement").length, 0);
  assert.match(receiptTasks(state, "Site Personnel")[0].title, /Upload signed receipt/);
  const warehouse = receiptFixture("supplier-warehouse");
  assert.equal(receiptTasks(warehouse, "Site Personnel").length, 0); assert.equal(receiptTasks(warehouse, "Procurement").length, 1);
  state.batches = Array.from({ length: 12 }, (_, index) => ({ ...structuredClone(batch), id: `batch-${index}`, ref: `DR-${index}` }));
  assert.equal(receiptTasks(state, "Site Personnel").length, 12);
  const excluded = tasksFor({ ...state, role: "Site Personnel", siteFilter: "other-site" });
  assert.equal(excluded.some(task => task.href.includes("#delivery-documents")), false);
});

test("receipt tasks transition through pending, failed, generated-only and complete evidence", () => {
  const state = receiptFixture(), batch = state.batches[0], current = batch.receiptVersions.at(-1);
  const proof = { id: "signed", batchId: batch.id, kind: "Signed delivery receipt", receiptVersion: current.version, archive: { status: "pending" } };
  state.accounting = [{ poId: "po1", documents: [proof] }];
  assert.match(receiptTasks(state, "Site Personnel")[0].title, /Finish signed/);
  proof.archive.error = "Network unavailable";
  assert.match(receiptTasks(state, "Site Personnel")[0].title, /Retry signed/);
  proof.archive = { status: "complete", fileId: "signed", url: "https://drive.google.com/file/d/signed/view" };
  assert.match(receiptTasks(state, "Site Personnel")[0].title, /Archive generated/);
  current.archive = { status: "complete", fileId: "generated", url: "https://drive.google.com/file/d/generated/view" };
  assert.equal(receiptTasks(state, "Site Personnel").length, 0); assert.deepEqual(deliveryDocumentIssues(state, "po1"), []);
  batch.receiptVersions.push({ ...structuredClone(current), id: "corrected", version: current.version + 1, archive: { status: "pending" } });
  assert.equal(deliveryEvidenceStatus(state, batch).signedArchived, false);
  assert.match(receiptTasks(state, "Site Personnel")[0].title, /Upload signed/); assert.equal(deliveryDocumentIssues(state, "po1").length, 2);
});

test("an incomplete archive acknowledgement cannot falsely clear receipt follow-up", () => {
  const state = receiptFixture(), batch = state.batches[0], version = batch.receiptVersions.at(-1);
  version.archive = { status: "complete", fileId: "", url: "" };
  state.accounting = [{ poId: "po1", documents: [{ kind: "Signed delivery receipt", batchId: batch.id, receiptVersion: version.version, archive: { status: "complete", fileId: "", url: "" } }] }];
  assert.equal(deliveryEvidenceStatus(state, batch).generatedArchived, false); assert.equal(deliveryEvidenceStatus(state, batch).signedArchived, false);
  assert.equal(receiptTasks(state, "Site Personnel").length, 1);
});

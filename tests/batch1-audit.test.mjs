import { initializedWorkspaceStorage } from './helpers/initialized-storage.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import { applyCommand } from "../src/domain/commands.ts";
import { actorName, auditTime } from "../src/domain/audit.ts";
import { requestLifecycle, groupAuditEvents } from "../src/domain/request-lifecycle.ts";
import { bindAccountCommands } from "../src/app-state/command-gateway.ts";
import { seedDemo } from "../src/mock/fixtures/seed.ts";
import { LocalDemoRepository } from "../src/mock/repository.ts";

const andrea = { name: "Andrea Reyes", email: "hml.constructsync.procurement@gmail.com", role: "Procurement" };
const paolo = { name: "Paolo Mendoza", email: "hml.constructsync.finance@gmail.com", role: "Finance" };
const daniel = { name: "Daniel Garcia", email: "hml.constructsync.admin@gmail.com", role: "Administrator" };
const miguel = { name: "Miguel Santos", email: "hml.constructsync.site@gmail.com", role: "Site Personnel" };
let sequence = 0;
const context = actor => ({ actor, now: () => "2026-10-07T01:02:03.000Z", id: prefix => `${prefix}-audit-${++sequence}` });
const execute = (state, command, actor) => { const result = applyCommand(state, command, context(actor)); assert.equal(result.ok, true, result.message); return result.snapshot; };
const draft = () => ({ id: "audit-quote", mrfId: "m3", supplierId: "", ref: "AUDIT-Q", prices: {}, available: "", leadDays: 0, terms: "", documents: [], reviewStatus: "draft", lines: [{ id: "audit-offer", description: "Plywood", quantity: 10, unit: "sheet", unitPrice: 100, brand: "", specification: "", requestItemId: "m3-i1", conversionFactor: 1, varianceReason: "", matchConfirmed: false }], adjustments: [] });
function pendingRequest() {
  const state = seedDemo(), request = state.requests.find(value => value.id === "m3");
  request.archive = { status: "pending", approvedAt: "2026-10-07T00:00:00.000Z", versions: [] };
  state.sites.find(value => value.id === request.siteId).driveFolderId = "audit-folder";
  return state;
}
const requestAck = id => ({ type: "completeRequestArchive", id, formFileId: "audit-form", supportFileId: "audit-support", formUrl: "https://drive.google.com/file/d/audit-form/view", supportUrl: "https://drive.google.com/file/d/audit-support/view" });
function gatewayWorkspace(initial, initialActor) {
  let snapshot = initial, active = initialActor;
  const repository = { getSnapshot: () => ({ snapshot }), execute: async (command, actor) => { const result = applyCommand(snapshot, command, context(actor)); if (result.ok) snapshot = result.snapshot; return result; } };
  return { repository, bind: actor => bindAccountCommands(repository, actor, () => active), get: () => snapshot, change: actor => { active = actor; if (actor) snapshot = { ...snapshot, role: actor.role }; }, replace: next => { snapshot = next; } };
}

test("audit actors are immutable action-time snapshots and document signatories are independent", () => {
  const actor = { ...andrea }, state = seedDemo();
  const approved = execute(state, { type: "reviewRequest", id: "m6", decision: "return", reason: "Check requested quantity" }, actor);
  actor.name = "Changed later";
  const event = approved.activity[0];
  assert.deepEqual(event.actorIdentity, andrea); assert.equal(event.actor, "Procurement"); assert.equal(event.requestId, "m6");
  assert.equal(approved.requests.find(value => value.id === "m6").approvedBy, state.requests.find(value => value.id === "m6").approvedBy);
  assert.match(auditTime(event.at), /9:02:03/); assert.equal(auditTime("not-a-date"), "Time not recorded");
  assert.equal(actorName("Project Manager"), "User not recorded");
  assert.equal(applyCommand(state, { type: "reviewRequest", id: "m6", decision: "approve" }, context({ ...andrea, role: "Project Manager" })).ok, false);
});

test("quotation edits log changed fields, omit no-op saves, and retain deleted draft ownership", () => {
  let state = execute(seedDemo(), { type: "saveQuoteDraft", quote: draft() }, andrea);
  assert.equal(state.activity[0].eventType, "quote.draft.created");
  const before = state.activity.length;
  state = execute(state, { type: "saveQuoteDraft", quote: structuredClone(state.quotes.find(value => value.id === "audit-quote")) }, andrea);
  assert.equal(state.activity.length, before);
  const changed = structuredClone(state.quotes.find(value => value.id === "audit-quote")); changed.lines[0].unitPrice = 120;
  state = execute(state, { type: "saveQuoteDraft", quote: changed }, andrea);
  assert.equal(state.activity[0].eventType, "quote.draft.updated"); assert.deepEqual(state.activity[0].changedFields, ["Line 1: Unit price"]);
  assert.equal(Object.hasOwn(state.activity[0], "before"), false);
  state = execute(state, { type: "deleteQuoteDraft", id: "audit-quote" }, andrea);
  const history = requestLifecycle(state, "m3").events;
  assert.ok(history.some(event => event.eventType === "quote.draft.deleted" && event.entityRef === "AUDIT-Q" && event.actorIdentity.name === andrea.name));
  assert.equal(requestLifecycle(state, "m1").events.some(event => event.entity === "audit-quote"), false);
});

test("lifecycle includes explicit quote, comparison, payment and batch links without shared-site usage", () => {
  const state = seedDemo();
  state.activity.push({ id: "q-event", entity: "q2", actor: "Procurement", action: "Quotation finalized", at: "2026-10-07T02:00:00Z" }, { id: "batch-event", entity: "b2", actor: "Logistics", action: "Batch scheduled", at: "2026-10-07T03:00:00Z" }, { id: "usage-event", entity: "mv2", actor: "Site Personnel", action: "Usage", at: "2026-10-07T04:00:00Z" });
  state.batches.find(value => value.id === "b2").status = "posted"; state.batches.find(value => value.id === "b2").lines[0].accepted = 40;
  const result = requestLifecycle(state, "m1");
  assert.ok(result.events.some(value => value.id === "q-event")); assert.ok(result.events.some(value => value.id === "batch-event"));
  assert.equal(result.events.some(value => value.id === "usage-event"), false);
  assert.match(result.stages.find(value => value.name === "Delivery").progress, /Fully received/);
  assert.match(result.stages.find(value => value.name === "Payment").progress, /0 PHP recorded \/ 27,800/);
  assert.equal(Object.hasOwn(result, "completed"), false);
  const noHistory = structuredClone(state); noHistory.activity = []; noHistory.pos[0].createdAt = ""; noHistory.pos[0].updatedAt = "2040-01-01T00:00:00Z";
  assert.equal(requestLifecycle(noHistory, "m1").stages.find(value => value.name === "Purchasing").recordedAt, undefined);
});

test("visual autosave grouping preserves every stored event and breaks on actor, record and time gaps", () => {
  const event = (id, at, overrides = {}) => ({ id, entity: "quote-1", at, actor: "Procurement", actorIdentity: { ...andrea }, action: "Quotation updated", eventType: "quote.draft.updated", changedFields: ["Unit price"], ...overrides });
  const entries = [event("1", "2026-10-07T02:02:00Z"), event("2", "2026-10-07T02:01:30Z"), event("3", "2026-10-07T02:00:00Z"), event("4", "2026-10-07T01:59:50Z", { actorIdentity: { ...andrea, name: "Another name" } }), event("5", "2026-10-07T01:59:40Z", { entity: "quote-2" })];
  const original = structuredClone(entries), groups = groupAuditEvents(entries);
  assert.deepEqual(groups.map(value => value.entries.length), [2, 1, 1, 1]); assert.deepEqual(entries, original);
  assert.equal(groupAuditEvents(entries.map(value => ({ ...value, actorIdentity: undefined }))).length, 5);
});

test("started archive survives sign-out and account switch without granting stale business commands", async () => {
  const actor = { ...andrea }, workspace = gatewayWorkspace(pendingRequest(), actor), commands = workspace.bind(actor);
  const runner = await commands.beginOperation({ kind: "request", id: "m3" });
  actor.name = "Renamed after starting"; workspace.change(undefined);
  const first = await runner(requestAck("m3")); assert.equal(first.ok, true, first.message);
  assert.equal(workspace.get().activity[0].actorIdentity.name, "Andrea Reyes");
  assert.equal((await commands.run({ type: "reviewRequest", id: "m6", decision: "approve" })).ok, false);
  workspace.change(paolo);
  const count = workspace.get().activity.length;
  assert.equal((await runner(requestAck("m3"))).ok, true); assert.equal(workspace.get().activity.length, count);
  assert.equal(workspace.get().role, "Finance");
  assert.equal((await runner(requestAck("m1"))).ok, false);
  assert.equal((await runner({ type: "recordPayment", paymentRequestId: "anything", method: "Cash", reference: "x", date: "2026-10-07" })).ok, false);
  assert.equal((await commands.run({ type: "reviewRequest", id: "m6", decision: "approve" })).ok, false);
});

test("manual archive retries capture the retrying user and source-version changes reject late acknowledgements", async () => {
  const workspace = gatewayWorkspace(pendingRequest(), andrea);
  const original = await workspace.bind(andrea).beginOperation({ kind: "request", id: "m3" });
  await original({ type: "failRequestArchive", id: "m3", error: "Drive unavailable" });
  const failedCount = workspace.get().activity.length;
  await original({ type: "failRequestArchive", id: "m3", error: "Drive unavailable" });
  assert.equal(workspace.get().activity.length, failedCount, "Duplicate failure callbacks add no event");
  workspace.change(daniel);
  const retry = await workspace.bind(daniel).beginOperation({ kind: "request", id: "m3" });
  assert.equal(workspace.get().activity[0].eventType, "operation.retried");
  await retry({ type: "failRequestArchive", id: "m3", error: "Drive unavailable" });
  assert.equal(workspace.get().activity[0].eventType, "archive.failed");
  assert.equal(workspace.get().activity[0].actorIdentity.name, "Daniel Garcia", "Each retry records its outcome even when the error is unchanged");
  assert.equal((await retry(requestAck("m3"))).ok, true);
  assert.equal(workspace.get().activity[0].actorIdentity.name, "Daniel Garcia");
  const fresh = gatewayWorkspace(pendingRequest(), andrea), pending = await fresh.bind(andrea).beginOperation({ kind: "request", id: "m3" });
  const replaced = structuredClone(fresh.get()); replaced.requests.find(value => value.id === "m3").ref = "CORRECTED-SOURCE"; fresh.replace(replaced);
  assert.equal((await pending(requestAck("m3"))).ok, false); assert.equal(fresh.get().requests.find(value => value.id === "m3").archive.status, "pending");
});

test("evidence preparation retains its initiating uploader and permits only its newly created document archives", async () => {
  const workspace = gatewayWorkspace(seedDemo(), miguel), pipeline = await workspace.bind(miguel).beginOperation({ kind: "attachment", poId: "po1", batchId: "b1" });
  workspace.change(paolo);
  const saved = await pipeline({ type: "attachAccountingDocuments", poId: "po1", batchId: "b1", documents: [{ name: "Receipt.pdf", kind: "Payment receipt", mime: "application/pdf", size: 100, localFileId: "receipt-file", sha256: "a".repeat(64) }] });
  assert.equal(saved.ok, true, saved.message);
  const document = saved.snapshot.accounting.find(value => value.poId === "po1").documents.at(-1);
  assert.equal(document.uploadedByIdentity.name, "Miguel Santos"); assert.equal(saved.snapshot.role, "Finance");
  assert.equal((await pipeline({ type: "startOperation", target: { kind: "evidence", poId: "po1", documentId: document.id } })).ok, true);
  assert.equal((await pipeline({ type: "completeAccountingArchive", poId: "po1", documentId: document.id, fileId: "evidence-drive", url: "https://drive.google.com/file/d/evidence-drive/view" })).ok, true);
  assert.equal((await pipeline({ type: "completeAccountingArchive", poId: "po3", documentId: document.id, fileId: "wrong", url: "https://drive.google.com/file/d/wrong/view" })).ok, false);
});

test("named v12 audit records survive repository reload without session data or historical rewrites", async () => {
  const state = execute(seedDemo(), { type: "reviewRequest", id: "m6", decision: "return", reason: "Correct quantity" }, andrea);
  const raw = JSON.stringify(state), previousWindow = globalThis.window, previousStorage = globalThis.localStorage;
  let writes = 0; globalThis.window = { addEventListener() {} }; globalThis.localStorage = initializedWorkspaceStorage({ getItem: key => key === "hml-constructsync-demo-v12" ? raw : null, setItem() { writes++; } });
  try {
    const loaded = await new LocalDemoRepository().load(); assert.equal(loaded.status, "ready"); assert.equal(writes, 0);
    assert.deepEqual(loaded.snapshot.activity, JSON.parse(raw).activity); assert.equal(loaded.snapshot.version, 12);
    assert.ok(loaded.snapshot.activity.some(value => !value.actorIdentity));
    assert.equal(raw.includes("HML!PROC2026"), false);
  } finally { globalThis.window = previousWindow; globalThis.localStorage = previousStorage; }
});

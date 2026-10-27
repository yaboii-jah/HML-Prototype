import { initializedWorkspaceStorage } from './helpers/initialized-storage.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { PDFDocument, PDFName } from "pdf-lib";
import { applyCommand } from "../src/domain/commands.ts";
import { seedDemo } from "./fixtures/workspace.ts";
import { ACCOUNT_FIXTURES } from "../src/app-state/demo-session.ts";
import { acceptedFor, budgetFor, outstandingFor, schedulableFor, stockFor } from "../src/domain/selectors.ts";
import { batchStage, deliveryPayment, deliveryToday, warehouseAvailableFor, warehouseHeldFor } from "../src/domain/delivery-flow.ts";
import { requestLifecycle } from "../src/domain/request-lifecycle.ts";
import { tasksFor } from "../src/domain/queues.ts";
import { validDeliveryReceipt } from "../src/domain/delivery-document.ts";
import { generateDeliveryReceiptPdf } from "../src/server/delivery-receipt-pdf.ts";
import { LocalDemoRepository } from "../src/mock/repository.ts";
import { pageText } from "./helpers/pdf-text.mjs";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
  return specifier.startsWith("@/") ? nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context) : nextResolve(specifier, context);
} });
const { POST } = await import("../app/api/documents/preview/route.ts");
const identity = role => { const { name, email } = ACCOUNT_FIXTURES.find(value => value.role === role); return { name, email, role }; };
let sequence = 0;
const context = role => ({ actor: identity(role), id: prefix => `${prefix}-delivery-${++sequence}`, now: () => new Date(Date.parse("2026-10-07T02:00:00Z") + sequence * 1000).toISOString() });
const run = (state, command, role = "Logistics") => { const result = applyCommand(state, command, context(role)); assert.equal(result.ok, true, result.message); return result.snapshot; };
const reject = (state, command, role, pattern) => { const before = structuredClone(state), result = applyCommand(state, command, context(role)); assert.equal(result.ok, false); if (pattern) assert.match(result.message, pattern); assert.deepEqual(state, before); };
const base = () => { const state = seedDemo(); state.batches = []; state.movements = []; return state; };
const schedule = (quantity = 100, extra = {}) => ({ type: "createBatch", poId: "po1", leg: "supplier-site", scheduledDate: "2026-10-08", evidence: "Supplier DR", delayReason: "", expected: { "m1-i1": quantity }, ...extra });
const receive = (id, accepted = 100, issue = "") => ({ type: "confirmBatch", id, lines: { "m1-i1": { accepted, issue } } });
const post = (id, accepted = 100, reason = "") => ({ type: "postBatch", id, accepted: { "m1-i1": accepted }, reason });
function warehouseReceipt(quantity = 100) {
  let state = run(base(), schedule(100, { leg: "supplier-warehouse", destination: { name: "Company Warehouse", address: "Marikina depot" } }));
  const parentId = state.batches.at(-1).id;
  state = run(state, { type: "dispatchBatch", id: parentId });
  state = run(state, receive(parentId, quantity, quantity < 100 ? "Supplier shortage" : ""), "Procurement");
  return { state, parentId };
}
function receiptData(state, id = state.batches.at(-1).id) {
  const batch = state.batches.find(value => value.id === id), po = state.pos.find(value => value.id === batch.poId), request = state.requests.find(value => value.id === po.mrfId);
  return { kind: "delivery", batch, parentBatch: state.batches.find(value => value.id === batch.parentBatchId), po, request, project: state.sites.find(value => value.id === request.siteId) };
}

test("new direct batches require Logistics dispatch before Site receiving and post stock once", () => {
  let state = run(base(), schedule()), batch = state.batches.at(-1), before = budgetFor(state, "site-a");
  reject(state, receive(batch.id), "Site Personnel", /Dispatch/);
  reject(state, { type: "dispatchBatch", id: batch.id }, "Procurement", /Logistics/);
  state = run(state, { type: "dispatchBatch", id: batch.id });
  reject(state, receive(batch.id), "Procurement", /Site Personnel/);
  state = run(state, receive(batch.id), "Site Personnel");
  assert.equal(stockFor(state, "site-a", "Portland cement", "bag"), 0);
  state = run(state, post(batch.id), "Site Personnel");
  assert.equal(stockFor(state, "site-a", "Portland cement", "bag"), 100);
  reject(state, post(batch.id), "Site Personnel", /posted/);
  batch = state.batches.at(-1);
  assert.equal(batch.createdByIdentity.name, identity("Logistics").name); assert.ok(batch.dispatchedAt); assert.ok(batch.receivedAt); assert.ok(batch.postedAt);
  assert.equal(batch.receivedByIdentity.name, identity("Site Personnel").name);
  assert.deepEqual(budgetFor(state, "site-a"), before); assert.equal(state.payments.length, 0);
});

test("delivery scheduling uses the Philippine calendar date across UTC midnight and year boundaries", () => {
  assert.equal(deliveryToday(new Date("2026-10-06T20:00:00Z")), "2026-10-07");
  assert.equal(deliveryToday(new Date("2026-10-06T10:00:00Z")), "2026-10-06");
  assert.equal(deliveryToday(new Date("2026-12-31T20:00:00Z")), "2027-01-01");
});

test("supplier allowance is shared across direct and warehouse routes and rechecked at dispatch", () => {
  let state = run(base(), schedule(60));
  reject(state, schedule(41, { leg: "supplier-warehouse", destination: { name: "Depot", address: "Pasig" } }), "Logistics", /balance/);
  state = run(state, schedule(40, { leg: "supplier-warehouse", destination: { name: "Depot", address: "Pasig" } }));
  assert.equal(schedulableFor(state, state.pos.find(po => po.id === "po1"), "m1-i1"), 0);
  const stale = structuredClone(state); stale.batches[1].lines[0].expected = 50;
  reject(stale, { type: "dispatchBatch", id: stale.batches[0].id }, "Logistics", /allocation/);
  reject(state, schedule(1, { parentBatchId: state.batches[1].id }), "Logistics", /Only onward/);
});

test("warehouse receipt belongs to Procurement, excludes site stock/fulfilment, and supplies onward batches", () => {
  let state = run(base(), schedule(100, { leg: "supplier-warehouse", destination: { name: "Depot", address: "Marikina" } })), parentId = state.batches[0].id;
  reject(state, schedule(60, { leg: "warehouse-site", parentBatchId: parentId }), "Logistics", /confirmed warehouse/);
  state = run(state, { type: "dispatchBatch", id: parentId });
  reject(state, receive(parentId), "Site Personnel", /Procurement/);
  state = run(state, receive(parentId, 80, "20 damaged"), "Procurement");
  assert.equal(acceptedFor(state, "po1", "m1-i1"), 0); assert.equal(stockFor(state, "site-a", "Portland cement", "bag"), 0);
  assert.equal(warehouseAvailableFor(state, parentId, "m1-i1"), 80);
  assert.equal(schedulableFor(state, state.pos.find(po => po.id === "po1"), "m1-i1"), 20);
  assert.match(requestLifecycle(state, "m1").stages.find(stage => stage.name === "Delivery").progress, /Not received.*1 receipts held at warehouse/);
  reject(state, post(parentId), "Site Personnel", /not a site receipt/);
  reject(state, { type: "attachAccountingDocuments", poId: "po1", batchId: parentId, documents: [] }, "Site Personnel", /receiving department/);
  state = run(state, schedule(60, { leg: "warehouse-site", parentBatchId: parentId }));
  assert.deepEqual(state.batches.at(-1).origin, state.batches[0].destination);
});

test("split forwarding reserves held goods and dispatch shortages never restore warehouse availability", () => {
  let { state, parentId } = warehouseReceipt();
  state = run(state, schedule(60, { leg: "warehouse-site", parentBatchId: parentId })); const firstId = state.batches.at(-1).id;
  assert.equal(warehouseHeldFor(state, parentId, "m1-i1"), 100); assert.equal(warehouseAvailableFor(state, parentId, "m1-i1"), 40);
  reject(state, schedule(41, { leg: "warehouse-site", parentBatchId: parentId }), "Logistics", /balance/);
  state = run(state, schedule(40, { leg: "warehouse-site", parentBatchId: parentId })); const secondId = state.batches.at(-1).id;
  state = run(state, { type: "dispatchBatch", id: firstId });
  assert.equal(warehouseHeldFor(state, parentId, "m1-i1"), 40);
  reject(state, receive(firstId, 50), "Site Personnel", /shortage/);
  state = run(state, receive(firstId, 50, "10 damaged in transit"), "Site Personnel"); state = run(state, post(firstId, 50), "Site Personnel");
  assert.equal(warehouseAvailableFor(state, parentId, "m1-i1"), 0);
  state = run(state, { type: "dispatchBatch", id: secondId }); state = run(state, receive(secondId, 40), "Site Personnel"); state = run(state, post(secondId, 40), "Site Personnel");
  assert.equal(stockFor(state, "site-a", "Portland cement", "bag"), 90); assert.equal(warehouseHeldFor(state, parentId, "m1-i1"), 0);
  assert.equal(outstandingFor(state, state.pos.find(po => po.id === "po1"), "m1-i1"), 10); assert.equal(schedulableFor(state, state.pos.find(po => po.id === "po1"), "m1-i1"), 0);
  assert.equal(state.movements.filter(movement => movement.kind === "receipt").length, 2);
});

test("onward batches cannot borrow a different PO's warehouse receipt", () => {
  const { state, parentId } = warehouseReceipt(); const other = structuredClone(state); other.pos.find(po => po.id === "po5").status = "released";
  reject(other, { ...schedule(10, { leg: "warehouse-site", parentBatchId: parentId }), poId: "po5", expected: { "m5-i1": 10 } }, "Logistics", /this PO/);
});

test("stock review retains direct reservations and applies explained corrections within the allocation", () => {
  let state = run(base(), schedule(60)), id = state.batches[0].id;
  state = run(state, { type: "dispatchBatch", id }); state = run(state, receive(id, 50, "Initial shortage"), "Site Personnel");
  assert.equal(schedulableFor(state, state.pos.find(po => po.id === "po1"), "m1-i1"), 40);
  reject(state, schedule(41), "Logistics", /balance/);
  reject(state, post(id, 55), "Site Personnel", /Explain/);
  state = run(state, post(id, 55, "Recount confirmed five additional bags"), "Site Personnel");
  assert.equal(schedulableFor(state, state.pos.find(po => po.id === "po1"), "m1-i1"), 45); assert.equal(state.batches[0].postingReason, "Recount confirmed five additional bags");
});

test("queues route warehouse receiving to Procurement and final receiving to Site Personnel", () => {
  let state = run(base(), schedule(100, { leg: "supplier-warehouse", destination: { name: "Depot", address: "Pasig" } })), id = state.batches[0].id;
  assert.ok(tasksFor({ ...state, role: "Logistics" }).some(task => task.title === `Dispatch ${state.batches[0].ref}`));
  state = run(state, { type: "dispatchBatch", id });
  assert.ok(tasksFor({ ...state, role: "Procurement" }).some(task => task.href === `/deliveries/${id}`));
  assert.equal(tasksFor({ ...state, role: "Site Personnel" }).some(task => task.href === `/deliveries/${id}`), false);
  state = run(state, receive(id), "Procurement");
  assert.equal(batchStage(state.batches[0]), "Received at warehouse");
  assert.ok(tasksFor({ ...state, role: "Logistics" }).some(task => task.title === `Forward ${state.batches[0].ref}`));
  assert.match(deliveryPayment(state, state.pos.find(po => po.id === "po1")), /Credit.*Method not recorded/);
});

test("receipt validation checks quantities, source relations, timestamps and receiver role", () => {
  const { state, parentId } = warehouseReceipt(), child = run(state, schedule(50, { leg: "warehouse-site", parentBatchId: parentId })), data = receiptData(child);
  assert.equal(validDeliveryReceipt(data), true);
  for (const mutate of [value => value.batch.poId = "other", value => value.parentBatch.poId = "other", value => value.batch.lines[0].expected = 101, value => value.batch.origin.address = "wrong depot", value => value.batch.receivedAt = "not-a-time", value => value.batch.receivedByIdentity = identity("Finance"), value => value.batch.scheduledDate = "2026-02-30", value => value.batch.receivedByIdentity = null]) { const invalid = structuredClone(data); mutate(invalid); assert.equal(validDeliveryReceipt(invalid), false); }
});

test("delivery PDF previews return uncached PDFs without advancing the delivery and reject foreign inputs", async () => {
  const state = run(base(), schedule()), data = receiptData(state), before = structuredClone(state);
  const request = (body, origin) => new Request("http://localhost/api/documents/preview", { method: "POST", headers: { "Content-Type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });
  const response = await POST(request(data)); assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "no-store"); assert.equal(response.headers.get("Content-Type"), "application/pdf");
  const pdf = await PDFDocument.load(await response.arrayBuffer()), pendingText = pdf.getPages().flatMap(page => pageText(pdf, page)).map(line => line.text).join(" ");
  assert.match(pendingText, /DELIVERY RECEIPT/); assert.match(pendingText, /PENDING RECEIPT/); assert.match(pendingText, /Awaiting receiving confirmation/); assert.deepEqual(state, before);
  const confirmed = warehouseReceipt().state, receivedPdf = await PDFDocument.load(await generateDeliveryReceiptPdf(receiptData(confirmed)));
  const receivedText = receivedPdf.getPages().flatMap(page => pageText(receivedPdf, page)).map(line => line.text).join(" ");
  assert.match(receivedText, /Andrea Reyes/); assert.doesNotMatch(receivedText, /PENDING RECEIPT/);
  assert.equal((await POST(request({ ...data, batch: { ...data.batch, poId: "other" } }))).status, 400);
  assert.equal((await POST(request(data, "https://foreign.test"))).status, 403);
});

test("receipts preserve the PO company artwork and continue long descriptions without losing source data", async () => {
  const { state } = warehouseReceipt(), data = structuredClone(receiptData(state)), before = structuredClone(data);
  data.request.ref = "MRF-" + "LONG-REFERENCE-".repeat(40); data.request.items[0].name = "Long material description ".repeat(180); data.batch.lines[0].issue = "Inspection note ".repeat(120);
  const source = structuredClone(data), pdf = await PDFDocument.load(await generateDeliveryReceiptPdf(data));
  assert.ok(pdf.getPageCount() > 1);
  for (const page of pdf.getPages()) { assert.equal(page.getWidth(), 612); assert.equal(page.getHeight(), 792); assert.ok(page.node.Resources().get(PDFName.of("XObject")), "Each page retains the company template artwork"); }
  const printed = pdf.getPages().flatMap(page => pageText(pdf, page));
  assert.ok(printed.every(line => line.x >= 36 && line.x <= 576 && line.y >= 20 && line.y <= 760), "Receipt text stays within the printable page");
  assert.deepEqual(data, source); assert.deepEqual(state.batches[0], before.batch);
});

test("fractional quantities remain schedulable and reach a zero balance without floating-point remnants", () => {
  let state = base(); state.requests.find(request => request.id === "m1").items[0].quantity = .3;
  state = run(state, schedule(.1)); state = run(state, schedule(.2));
  assert.equal(schedulableFor(state, state.pos.find(po => po.id === "po1"), "m1-i1"), 0);
  for (const batch of [...state.batches]) {
    state = run(state, { type: "dispatchBatch", id: batch.id });
    state = run(state, receive(batch.id, batch.lines[0].expected), "Site Personnel");
    state = run(state, post(batch.id, batch.lines[0].expected), "Site Personnel");
  }
  assert.equal(acceptedFor(state, "po1", "m1-i1"), .3);
  assert.equal(outstandingFor(state, state.pos.find(po => po.id === "po1"), "m1-i1"), 0);
  assert.equal(stockFor(state, "site-a", "Portland cement", "bag"), .3);
  state = run(state, { type: "recordMovement", siteId: "site-a", itemName: "Portland cement", unit: "bag", kind: "usage", quantity: .3, reason: "Use remaining stock" }, "Site Personnel");
  assert.equal(stockFor(state, "site-a", "Portland cement", "bag"), 0);
  let warehouseState = base(); warehouseState.requests.find(request => request.id === "m1").items[0].quantity = .8;
  warehouseState = run(warehouseState, schedule(.8, { leg: "supplier-warehouse", destination: { name: "Depot", address: "Pasig" } }));
  const parentId = warehouseState.batches[0].id;
  warehouseState = run(warehouseState, { type: "dispatchBatch", id: parentId }); warehouseState = run(warehouseState, receive(parentId,.8), "Procurement");
  warehouseState = run(warehouseState, schedule(.1, { leg: "warehouse-site", parentBatchId: parentId }));
  warehouseState = run(warehouseState, schedule(.7, { leg: "warehouse-site", parentBatchId: parentId }));
  assert.equal(warehouseAvailableFor(warehouseState,parentId,"m1-i1"),0);
});

test("legacy direct receiving and new routing metadata survive v12 reload without invented dispatch records", async () => {
  const legacy = seedDemo(), raw = JSON.stringify(legacy), previousWindow = globalThis.window, previousStorage = globalThis.localStorage;
  let writes = 0; globalThis.window = { addEventListener() {} }; globalThis.localStorage = initializedWorkspaceStorage({ getItem: key => key === "hml-constructsync-demo-v12" ? raw : null, setItem() { writes++; } });
  try {
    const loaded = await new LocalDemoRepository().load(); assert.equal(loaded.status, "ready"); assert.equal(writes, 0); assert.deepEqual(loaded.snapshot.batches, legacy.batches);
    const received = run(loaded.snapshot, receive("b2", 40), "Site Personnel"); assert.equal(received.batches.find(batch => batch.id === "b2").dispatchedAt, undefined);
    const { state } = warehouseReceipt(); const saved = JSON.stringify(state); globalThis.localStorage.getItem = key => key === "hml-constructsync-demo-v12" ? saved : null;
    const reloaded = await new LocalDemoRepository().load(); assert.deepEqual(reloaded.snapshot.batches, JSON.parse(saved).batches);
  } finally { globalThis.window = previousWindow; globalThis.localStorage = previousStorage; }
});

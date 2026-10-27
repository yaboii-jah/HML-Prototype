import test from "node:test";
import assert from "node:assert/strict";
import { seedDemo } from "./fixtures/workspace.ts";
import { applyCommand } from "../src/domain/commands.ts";

let sequence = 0;
const ctx = { now: () => "2026-10-08T10:00:00Z", id: prefix => `${prefix}-${++sequence}`, actor: { name: "Andrea Reyes", email: "hml.constructsync.procurement@gmail.com", role: "Procurement" } };
function fixture() {
  const state = seedDemo(); state.role = "Procurement"; state.pos = []; state.pendingAwards = [];
  const request = state.requests[0]; request.status = "approved"; request.archive = undefined; request.correction = undefined;
  request.items = [{ ...request.items[0], id: "material", quantity: 10 }, { ...request.items[0], id: "other", quantity: 10 }];
  state.quotes = ["a", "b"].map((id, index) => ({ id, mrfId: request.id, supplierId: state.suppliers[index].id, ref: id, prices: {}, available: "", leadDays: 0, terms: "", documents: [], currency: "PHP", reviewStatus: "finalized", lines: [{ id: `line-${id}`, description: request.items[0].name, quantity: 10, unit: request.items[0].unit, unitPrice: 100, conversionFactor: 1, requestItemId: "material", brand: "", specification: "", varianceReason: "", matchConfirmed: true }] }));
  return state;
}
const award = (id, quantity) => ({ quoteId: id, quoteLineId: `line-${id}`, quantity });
const command = (state, awards, itemId = "material") => ({ type: "replaceMaterialAwards", requestId: state.requests[0].id, itemId, awards });
function apply(state, awards) { const result = applyCommand(state, command(state, awards), ctx); assert.equal(result.ok, true, result.message); return result.snapshot; }

test("material awards replace a full allocation atomically, preserve IDs, and retain named audit ownership", () => {
  let state = apply(fixture(), [award("a", 10)]);
  const id = state.pendingAwards[0].id;
  const activity = state.activity.length;
  state = apply(state, [award("a", 10)]);
  assert.equal(state.pendingAwards[0].id, id); assert.equal(state.activity.length, activity);
  state.pendingAwards.push({ id: "unrelated", requestId: state.requests[0].id, itemId: "other", quoteId: "a", quoteLineId: "other-line", quantity: 2 });
  state = apply(state, [award("a", 4), award("b", 6)]);
  assert.equal(state.pendingAwards.find(row => row.quoteId === "a" && row.itemId === "material").id, id);
  state = apply(state, [award("b", 10)]);
  assert.equal(state.pendingAwards.some(row => row.id === "unrelated"), true);
  assert.deepEqual(state.pendingAwards.filter(row => row.itemId === "material").map(row => row.quantity), [10]);
  assert.equal(state.activity[0].eventType, "allocation.changed");
  assert.equal(state.activity[0].requestId, state.requests[0].id);
  assert.deepEqual(state.activity[0].actorIdentity, ctx.actor);
  assert.equal(state.activity.some(event => event.entity === id && event.action === "Supplier allocation removed"), true);
});

test("invalid material candidates leave all saved allocations and history untouched", () => {
  const state = apply(fixture(), [award("a", 10)]), before = structuredClone(state);
  for (const awards of [[award("a", 4), award("b", 11)], [award("a", 8), award("b", 8)], [award("a", 1), award("a", 2)], [award("a", NaN)], [award("a", -1)], [award("a", 0)], [{ ...award("a", 1), quoteLineId: "missing" }]]) {
    assert.equal(applyCommand(state, command(state, awards), ctx).ok, false);
    assert.deepEqual(state, before);
  }
  assert.equal(applyCommand(state, command(state, [award("b", 1)], "other"), ctx).ok, false);
});

test("material awards enforce department, correction, archive, currency, revision and existing-PO guards", () => {
  const base = fixture();
  assert.equal(applyCommand(base, command(base, [award("a", 1)]), { ...ctx, actor: { ...ctx.actor, role: "Finance" } }).ok, false);
  for (const mutate of [s => { s.requests[0].correction = { status: "requested", scope: "documents", reason: "Fix documents" }; }, s => { s.quotes[0].archive = { status: "pending", files: [] }; }, s => { s.quotes[0].currency = "USD"; }, s => { s.quotes[0].reviewStatus = "draft"; }, s => { s.quotes.push({ ...structuredClone(s.quotes[0]), id: "revision", supersedesId: "a", version: 2 }); }, s => { s.pos.push({ id: "po", mrfId: s.requests[0].id, quoteId: "a", status: "draft", lines: [], ref: "PO" }); }]) {
    const state = structuredClone(base); mutate(state);
    assert.equal(applyCommand(state, command(state, [award("a", 1)]), ctx).ok, false);
  }
});

test("stale material awards can be cleared without removing other allocations", () => {
  let state = apply(fixture(), [award("a", 10)]);
  state.quotes.push({ ...structuredClone(state.quotes[0]), id: "revision", supersedesId: "a", version: 2 });
  state = apply(state, []);
  assert.equal(state.pendingAwards.length, 0);
  assert.equal(state.activity[0].action, "Supplier allocation removed");
});

test("material replacement checks existing PO usage and supplier converted capacity", () => {
  let state = fixture(); state.quotes[0].lines[0].quantity = 2; state.quotes[0].lines[0].conversionFactor = 2;
  assert.equal(applyCommand(state, command(state, [award("a", 5)]), ctx).ok, false);
  state = apply(state, [award("a", 4), award("b", 6)]);
  assert.equal(state.pendingAwards.reduce((sum, row) => sum + row.quantity, 0), 10);
  state.pendingAwards = []; state.quotes.push({ ...structuredClone(state.quotes[0]), id: "old", supplierId: "another" });
  state.pos.push({ id: "existing", mrfId: state.requests[0].id, quoteId: "old", status: "draft", lines: [{ itemId: "material", quoteLineId: "old-line", quantity: 7, unitPrice: 50 }], ref: "PO" });
  assert.equal(applyCommand(state, command(state, [award("b", 4)]), ctx).ok, false);
  assert.equal(applyCommand(state, command(state, [award("b", 3)]), ctx).ok, true);
});

test("partial draft generation is atomic when a later supplier conflicts", () => {
  let state = apply(fixture(), [award("a", 2), award("b", 2)]);
  state.pos.push({ id: "conflict", mrfId: state.requests[0].id, quoteId: "b", status: "draft", lines: [], ref: "PO" });
  const before = structuredClone(state);
  assert.equal(applyCommand(state, { type: "generateAwardPOs", requestId: state.requests[0].id, reasons: {} }, ctx).ok, false);
  assert.deepEqual(state, before);
  state.pos = [];
  const result = applyCommand(state, { type: "generateAwardPOs", requestId: state.requests[0].id, reasons: {} }, ctx);
  assert.equal(result.ok, true, result.message); assert.equal(result.snapshot.pos.length, 2);
});

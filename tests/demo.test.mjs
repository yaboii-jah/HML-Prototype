import test from "node:test";
import assert from "node:assert/strict";
import { seedDemo } from "../src/mock/fixtures/seed.ts";
import { applyCommand } from "../src/domain/commands.ts";
import { migrateLegacy, LocalDemoRepository } from "../src/mock/repository.ts";
import { legacyDestination } from "../src/domain/legacy-links.ts";
import { acceptedFor, budgetFor, inventoryFor, outstandingFor, paidTotal, paymentStatus, poTotal, quoteTotal, stockFor } from "../src/domain/selectors.ts";
import { nextRef } from "../src/domain/ids.ts";

const context = { now: () => "2026-09-24T12:00:00.000Z", id: prefix => `${prefix}-test-${Math.random().toString(36).slice(2)}` };
const execute = (state, command) => { const result = applyCommand(state, command, context); assert.equal(result.ok, true, result.message); return result.snapshot; };

test("seeded cement transaction has consistent purchasing, delivery, stock, and budget values", () => {
  const state = seedDemo(); const po = state.pos.find(p => p.id === "po1");
  assert.equal(poTotal(state, po), 27800);
  assert.equal(acceptedFor(state, po.id, "m1-i1"), 60);
  assert.equal(outstandingFor(state, po, "m1-i1"), 40);
  assert.equal(stockFor(state, "site-a", "Portland cement", "bag"), 30);
  assert.equal(paymentStatus(state, po), "Unpaid");
  assert.equal(budgetFor(state, "site-a").committed, 53900);
  assert.equal(nextRef("MRF-2026", state.requests), "MRF-2026-010");
  assert.equal(quoteTotal(state, state.quotes[0]), 28500);
  assert.equal(quoteTotal(state, state.quotes[1]), 27800);
});

test("PM review requires authority and a reason to return; revisions keep the original ID", () => {
  let state = seedDemo();
  assert.equal(applyCommand(state, { type: "reviewRequest", id: "m6", decision: "approve" }, context).ok, false);
  state = execute(state, { type: "setRole", role: "Project Manager" });
  assert.equal(applyCommand(state, { type: "reviewRequest", id: "m6", decision: "return", reason: "No" }, context).ok, false);
  state = execute(state, { type: "reviewRequest", id: "m6", decision: "return", reason: "Clarify electrical scope" });
  assert.equal(state.requests.find(r => r.id === "m6").status, "returned");
  state = execute(state, { type: "setRole", role: "Site Personnel" });
  const original = state.requests.find(r => r.id === "m6");
  state = execute(state, { type: "saveRequest", id: "m6", intent: "submit", siteId: original.siteId, category: original.category, scope: "Electrical rough-in, level two", items: original.items, neededDate: original.neededDate, purpose: original.purpose, location: original.location, remarks: original.remarks, documents: original.documents });
  assert.equal(state.requests.find(r => r.id === "m6").status, "submitted");
  assert.equal(state.requests.filter(r => r.id === "m6").length, 1);
});

test("receiving posts only once and site usage cannot create negative stock", () => {
  let state = seedDemo();
  state = execute(state, { type: "setRole", role: "Logistics" });
  assert.equal(applyCommand(state, { type: "createBatch", poId: "po1", scheduledDate: "2026-09-25", evidence: "Second expected receipt", delayReason: "", expected: { "m1-i1": 40 } }, context).ok, false);
  state = execute(state, { type: "setRole", role: "Site Personnel" });
  state = execute(state, { type: "confirmBatch", id: "b2", lines: { "m1-i1": { accepted: 40, issue: "" } } });
  state = execute(state, { type: "postBatch", id: "b2", accepted: { "m1-i1": 40 }, reason: "" });
  assert.equal(outstandingFor(state, state.pos[0], "m1-i1"), 0);
  assert.equal(stockFor(state, "site-a", "Portland cement", "bag"), 70);
  assert.equal(inventoryFor(state, "site-a").find(i => i.name === "Portland cement")?.onHand, 70);
  assert.equal(stockFor(state, "site-b", "Portland cement", "bag"), 0);
  assert.equal(applyCommand(state, { type: "postBatch", id: "b2", accepted: { "m1-i1": 40 }, reason: "" }, context).ok, false);
  assert.equal(applyCommand(state, { type: "recordMovement", siteId: "site-a", itemName: "Portland cement", unit: "bag", kind: "usage", quantity: 71, reason: "Tower slab pour" }, context).ok, false);
  state = execute(state, { type: "recordMovement", siteId: "site-a", itemName: "Portland cement", unit: "bag", kind: "usage", quantity: 5, reason: "Tower slab pour" });
  assert.equal(stockFor(state, "site-a", "Portland cement", "bag"), 65);
});

test("payment entries move committed value to spent without reducing available twice", () => {
  let state = execute(seedDemo(), { type: "setRole", role: "Accounting / Auditing" });
  const before = budgetFor(state, "site-a");
  state = execute(state, { type: "recordPayment", poId: "po1", amount: 5000, method: "Bank", reference: "BANK-TEST-01", date: "2026-09-24" });
  const after = budgetFor(state, "site-a");
  assert.equal(paidTotal(state, "po1"), 5000);
  assert.equal(after.committed, before.committed - 5000);
  assert.equal(after.spent, before.spent + 5000);
  assert.equal(after.available, before.available);
  assert.equal(paymentStatus(state, state.pos[0]), "Partly Paid");
  assert.equal(applyCommand(state, { type: "recordPayment", poId: "po1", amount: 30000, method: "Bank", reference: "BANK-TEST-02", date: "2026-09-24" }, context).ok, false);
});

test("v1 migration preserves edited records and rejects malformed saved data", () => {
  const old = { ...seedDemo(), version: 1 }; old.requests[0].scope = "Edited old scope";
  old.suppliers[0].contact = "sales@metrobuild.example";
  old.suppliers[1].contact = "Custom contact";
  old.activity[0].action = "PO served (Demo)";
  old.movements[2].reason = "Opening demo stock";
  const migrated = migrateLegacy(old);
  assert.equal(migrated.version, 2);
  assert.equal(migrated.requests[0].scope, "Edited old scope");
  assert.equal(migrated.requests[0].id, "m1");
  assert.equal(migrated.suppliers[0].contact, "Lina Cruz · Sales");
  assert.equal(migrated.suppliers[1].contact, "Custom contact");
  assert.equal(migrated.activity[0].action, "PO served");
  assert.equal(migrated.movements[2].reason, "Opening stock balance");
  assert.equal(migrateLegacy({ version: 1, role: "Site Personnel" }), null);
  const saved = new Map([["hml-constructsync-demo-v2", "not-json"]]);
  const previous = globalThis.localStorage;
  const previousWindow = globalThis.window;
  globalThis.localStorage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
  globalThis.window = { addEventListener() {} };
  try {
    const repo = new LocalDemoRepository();
    assert.equal(repo.getSnapshot().status, "recovery");
    assert.equal(repo.getSnapshot().snapshot, null);
  } finally { globalThis.localStorage = previous; globalThis.window = previousWindow; }
});

test("legacy query links still target their record routes", () => {
  assert.equal(legacyDestination(new URLSearchParams("view=requests&kind=request&id=m1")), "/requests/m1");
  assert.equal(legacyDestination(new URLSearchParams("view=finance&kind=po&id=po1")), "/finance/po1");
  assert.equal(legacyDestination(new URLSearchParams("view=dashboard")), "/dashboard");
});

test("previous BuildSync v2 records migrate to ConstructSync without changing user edits", () => {
  const priorStorage = globalThis.localStorage;
  const priorWindow = globalThis.window;
  const old = seedDemo();
  old.suppliers[0].contact = "sales@metrobuild.example";
  old.suppliers[1].contact = "Custom purchasing contact";
  old.activity[0].action = "PO served (Demo)";
  const saved = new Map([["hml-buildsync-demo-v2", JSON.stringify(old)]]);
  globalThis.localStorage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
  globalThis.window = { addEventListener() {} };
  try {
    const view = new LocalDemoRepository().getSnapshot();
    assert.equal(view.status, "ready");
    assert.equal(view.snapshot.suppliers[0].contact, "Lina Cruz · Sales");
    assert.equal(view.snapshot.suppliers[1].contact, "Custom purchasing contact");
    assert.equal(view.snapshot.activity[0].action, "PO served");
    assert.equal(view.snapshot.requests[0].id, "m1");
    assert.equal(JSON.parse(saved.get("hml-constructsync-demo-v2")).requests[0].id, "m1");
  } finally { globalThis.localStorage = priorStorage; globalThis.window = priorWindow; }
});

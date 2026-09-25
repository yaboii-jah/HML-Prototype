import test from "node:test";
import assert from "node:assert/strict";
import { seedDemo } from "../src/mock/fixtures/seed.ts";
import { applyCommand } from "../src/domain/commands.ts";
import { migrateLegacy, LocalDemoRepository } from "../src/mock/repository.ts";
import { legacyDestination } from "../src/domain/legacy-links.ts";
import { acceptedFor, budgetFor, earliestNeededDate, inventoryFor, outstandingFor, paidTotal, paymentStatus, poTotal, quoteTotal, stockFor } from "../src/domain/selectors.ts";
import { nextRef } from "../src/domain/ids.ts";

const context = { now: () => "2026-09-24T12:00:00.000Z", id: prefix => `${prefix}-test-${Math.random().toString(36).slice(2)}` };
const execute = (state, command) => { const result = applyCommand(state, command, context); assert.equal(result.ok, true, result.message); return result.snapshot; };
const oldSnapshot = version => ({ ...seedDemo(), version, requests: seedDemo().requests.map(request => {
  const legacy = structuredClone(request);
  delete legacy.requestedBy; delete legacy.approvedBy; delete legacy.purchaser; delete legacy.financeOfficer;
  const { neededDate, purpose, location, remarks } = legacy.items[0];
  return { ...legacy, neededDate, purpose, location, remarks, items: legacy.items.map(({ id, name, unit, quantity }) => ({ id, name, unit, quantity })) };
}) });

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
  state = execute(state, { type: "saveRequest", id: "m6", intent: "submit", siteId: original.siteId, category: original.category, scope: "Electrical rough-in, level two", requestedBy: original.requestedBy, approvedBy: original.approvedBy, purchaser: original.purchaser, financeOfficer: original.financeOfficer, items: original.items, documents: original.documents });
  assert.equal(state.requests.find(r => r.id === "m6").status, "submitted");
  assert.equal(state.requests.filter(r => r.id === "m6").length, 1);
});

test("multi-material requests keep separate details through draft, submission, and revision", () => {
  let state = seedDemo();
  const command = { type: "saveRequest", intent: "draft", siteId: "site-a", category: "Structural", scope: "Two work areas", requestedBy: "", approvedBy: "", purchaser: "", financeOfficer: "", documents: [{ name: "Signed request.pdf", type: "application/pdf" }], items: [
    { id: "first", name: "Cement", unit: "bag", quantity: 10, neededDate: "2026-10-20", purpose: "Slab pour", location: "Tower 1", remarks: "Keep dry" },
    { id: "second", name: "Sand", unit: "cu.m", quantity: 4, neededDate: "2026-10-05", purpose: "Mixing", location: "Tower 2", remarks: "" },
  ] };
  state = execute(state, command);
  const request = state.requests.at(-1);
  assert.equal(request.status, "draft");
  assert.equal(earliestNeededDate(request), "2026-10-05");
  assert.equal(applyCommand(state, { ...command, id: request.id, intent: "submit" }, context).ok, false);
  const complete = { ...command, id: request.id, intent: "submit", requestedBy: "Joel Reyes", approvedBy: "Mara Santos", purchaser: "Nina Valdez", financeOfficer: "Rafael Lim" };
  assert.equal(applyCommand(state, { ...complete, items: [{ ...command.items[0], purpose: "" }, command.items[1]] }, context).ok, false);
  state = execute(state, complete);
  assert.deepEqual(state.requests.at(-1).items.map(item => item.id), ["first", "second"]);
  assert.deepEqual(state.requests.at(-1).items.map(item => item.location), ["Tower 1", "Tower 2"]);
  assert.deepEqual(state.requests.at(-1).items.map(item => item.remarks), ["Keep dry", ""]);
  state = execute(state, { type: "setRole", role: "Project Manager" });
  state = execute(state, { type: "reviewRequest", id: request.id, decision: "return", reason: "Clarify second delivery" });
  state = execute(state, { type: "setRole", role: "Site Personnel" });
  state = execute(state, { ...complete, items: [command.items[0], { ...command.items[1], location: "Tower 3" }] });
  assert.equal(state.requests.at(-1).items[1].location, "Tower 3");
  assert.equal(state.requests.filter(item => item.id === request.id).length, 1);
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
  const old = oldSnapshot(1); old.requests[0].scope = "Edited old scope";
  old.suppliers[0].contact = "sales@metrobuild.example";
  old.suppliers[1].contact = "Custom contact";
  old.activity[0].action = "PO served (Demo)";
  old.movements[2].reason = "Opening demo stock";
  const migrated = migrateLegacy(old);
  assert.equal(migrated.version, 4);
  assert.equal(migrated.requests[0].scope, "Edited old scope");
  assert.equal(migrated.requests[0].id, "m1");
  assert.equal(migrated.requests[0].items[0].neededDate, old.requests[0].neededDate);
  assert.equal(migrated.requests[0].items[0].purpose, old.requests[0].purpose);
  assert.equal(migrated.requests[0].items[0].location, old.requests[0].location);
  assert.equal(migrated.requests[0].items[0].remarks, old.requests[0].remarks);
  assert.equal(migrated.requests[0].requestedBy, "");
  assert.equal(migrated.suppliers[0].contact, "Lina Cruz · Sales");
  assert.equal(migrated.suppliers[1].contact, "Custom contact");
  assert.equal(migrated.activity[0].action, "PO served");
  assert.equal(migrated.movements[2].reason, "Opening stock balance");
  assert.equal(migrateLegacy({ version: 1, role: "Site Personnel" }), null);
  const saved = new Map([["hml-constructsync-demo-v4", "not-json"]]);
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
  const old = oldSnapshot(2);
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
    assert.equal(JSON.parse(saved.get("hml-constructsync-demo-v4")).requests[0].id, "m1");
  } finally { globalThis.localStorage = priorStorage; globalThis.window = priorWindow; }
});

test("current ConstructSync v2 data copies request details to every material", () => {
  const old = oldSnapshot(2);
  old.requests[0].items.push({ id: "m1-i2", name: "Fine sand", unit: "cu.m", quantity: 3 });
  old.requests[0].purpose = "Edited purpose";
  const saved = new Map([["hml-constructsync-demo-v2", JSON.stringify(old)]]);
  const priorStorage = globalThis.localStorage, priorWindow = globalThis.window;
  globalThis.localStorage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) };
  globalThis.window = { addEventListener() {} };
  try {
    const view = new LocalDemoRepository().getSnapshot();
    assert.equal(view.status, "ready");
    assert.equal(view.snapshot.version, 4);
    assert.deepEqual(view.snapshot.requests[0].items.map(item => item.id), ["m1-i1", "m1-i2"]);
    assert.deepEqual(view.snapshot.requests[0].items.map(item => item.purpose), ["Edited purpose", "Edited purpose"]);
    assert.equal(view.snapshot.requests[0].requestedBy, "");
    assert.equal(saved.has("hml-constructsync-demo-v2"), false);
  } finally { globalThis.localStorage = priorStorage; globalThis.window = priorWindow; }
});

test("reviewed partial quotations can split one material across supplier POs", () => {
  let state = seedDemo();
  const request = structuredClone(state.requests.find(value => value.id === "m3"));
  request.id = "split-request"; request.ref = "MRF-2026-099";
  request.items[0].id = "split-item"; request.items[0].quantity = 10;
  state.requests.push(request);
  state = execute(state, { type: "setRole", role: "Procurement" });
  const quoted = (supplierId, quantity, price) => ({
    type: "saveReviewedQuote", requestId: request.id, supplierId, ref: `Q-${supplierId}`, available: "In stock", leadDays: 2,
    terms: "30 days", documents: [{ name: `${supplierId}.pdf`, type: "application/pdf", fileId: `file-${supplierId}` }],
    currency: "PHP", tax: 0, freight: 0, discount: 0, validity: "2026-10-31", extraction: "gemini",
    lines: [{ id: `offer-${supplierId}`, description: "Plywood 18mm", quantity, unit: "sheet", unitPrice: price, brand: "", specification: "", requestItemId: "split-item", conversionFactor: 1, varianceReason: "" }],
  });
  state = execute(state, quoted("sup-1", 6, 700));
  state = execute(state, quoted("sup-3", 8, 680));
  const first = state.quotes.at(-2), second = state.quotes.at(-1);
  const award = (quote, quantity, tax = 0) => ({ type: "createAwardPO", requestId: request.id, quoteId: quote.id, lines: [{ itemId: "split-item", quoteLineId: quote.lines[0].id, quantity, unitPrice: quote.lines[0].unitPrice }], tax, freight: 0, discount: 0, reason: "Confirmed delivery and price", notes: "" });
  state = execute(state, award(first, 6));
  assert.equal(poTotal(state, state.pos.at(-1)), 4200);
  assert.equal(applyCommand(state, award(second, 5), context).ok, false);
  state = execute(state, award(second, 4, 48));
  assert.equal(poTotal(state, state.pos.at(-1)), 2768);
  assert.equal(outstandingFor(state, state.pos.at(-2), "split-item"), 6);
  assert.equal(outstandingFor(state, state.pos.at(-1), "split-item"), 4);
  assert.equal(applyCommand(state, award(first, 1), context).ok, false);
  state = execute(state, { type: "setRole", role: "Finance" });
  state = execute(state, { type: "setRole", role: "Procurement" });
  const firstPO = state.pos.at(-2);
  state = execute(state, { type: "savePO", id: firstPO.id, quoteId: first.id, lines: [{ itemId: "split-item", quoteLineId: first.lines[0].id, quantity: 5, unitPrice: 700 }], tax: 0, freight: 0, discount: 0, reason: "Confirmed delivery and price", notes: "Reduced award", finalize: true });
  assert.equal(poTotal(state, state.pos.at(-2)), 3500);
  assert.equal(state.pos.at(-2).status, "finalized");
});

test("quotation revisions preserve the version linked to an existing PO", () => {
  let state = seedDemo();
  const request = structuredClone(state.requests.find(value => value.id === "m3"));
  request.id = "revision-request"; request.items[0].id = "revision-item"; request.items[0].quantity = 10;
  state.requests.push(request);
  state = execute(state, { type: "setRole", role: "Procurement" });
  const input = (price, supersedesId) => ({ type: "saveReviewedQuote", requestId: request.id, supplierId: "sup-1", ref: "Q-REV", available: "In stock", leadDays: 2, terms: "30 days", documents: [{ name: "quote.pdf", type: "application/pdf", fileId: "file-1" }], currency: "PHP", tax: 0, freight: 0, discount: 0, validity: "", extraction: "manual", supersedesId, lines: [{ id: `offer-${price}`, description: "Plywood 18mm", quantity: 10, unit: "sheet", unitPrice: price, brand: "", specification: "", requestItemId: "revision-item", conversionFactor: 1, varianceReason: "" }] });
  state = execute(state, input(700));
  const first = state.quotes.at(-1);
  state = execute(state, { type: "createAwardPO", requestId: request.id, quoteId: first.id, lines: [{ itemId: "revision-item", quoteLineId: first.lines[0].id, quantity: 5, unitPrice: 700 }], tax: 0, freight: 0, discount: 0, reason: "Confirmed price and availability", notes: "" });
  const po = state.pos.at(-1);
  assert.equal(applyCommand(state, input(680), context).ok, false);
  state = execute(state, input(680, first.id));
  assert.equal(state.quotes.at(-1).version, 2);
  assert.equal(state.pos.find(value => value.id === po.id).quoteId, first.id);
  assert.equal(poTotal(state, state.pos.find(value => value.id === po.id)), 3500);
});

test("v3 browser records migrate to v4 without changing linked POs", () => {
  const previousStorage = globalThis.localStorage, previousWindow = globalThis.window;
  const old = { ...seedDemo(), version: 3 };
  const saved = new Map([["hml-constructsync-demo-v3", JSON.stringify(old)]]);
  globalThis.localStorage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) };
  globalThis.window = { addEventListener() {} };
  try {
    const view = new LocalDemoRepository().getSnapshot();
    assert.equal(view.snapshot.version, 4);
    assert.equal(view.snapshot.pos[0].quoteId, old.pos[0].quoteId);
    assert.equal(view.snapshot.quotes[0].ref, old.quotes[0].ref);
    assert.equal(saved.has("hml-constructsync-demo-v3"), false);
  } finally { globalThis.localStorage = previousStorage; globalThis.window = previousWindow; }
});

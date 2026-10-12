import test from "node:test";
import assert from "node:assert/strict";
import { applyCommand } from "../src/domain/commands.ts";
import { projectScopes, scopeBudgetFor } from "../src/domain/scope-budgets.ts";
import { budgetFor, poTotal } from "../src/domain/selectors.ts";
import { MATERIAL_CLASSIFICATION, adjustmentClassification } from "../src/domain/expense-classification.ts";
import { blankWorkspace } from "../src/mock/fixtures/blank.ts";
import { seedDemo } from "../src/mock/fixtures/seed.ts";
import { LocalDemoRepository } from "../src/mock/repository.ts";

const actors = {
  admin: { name: "Daniel Garcia", email: "admin@example.com", role: "Administrator" },
  site: { name: "Miguel Santos", email: "site@example.com", role: "Site Personnel" },
  pm: { name: "Project Manager", email: "pm@example.com", role: "Project Manager" },
  buyer: { name: "Andrea Reyes", email: "buyer@example.com", role: "Procurement" },
  accounting: { name: "Camille Torres", email: "accounting@example.com", role: "Accounting / Auditing" },
  finance: { name: "Paolo Mendoza", email: "finance@example.com", role: "Finance" },
};
let sequence = 0;
const context = actor => ({ actor, now: () => "2026-10-07T03:00:00Z", id: prefix => `${prefix}-scope-${++sequence}` });
const run = (state, command, actor = actors.admin) => { const result = applyCommand(state, command, context(actor)); assert.equal(result.ok, true, result.message); return result.snapshot; };
const reject = (state, command, actor, pattern) => { const before = structuredClone(state), result = applyCommand(state, command, context(actor)); assert.equal(result.ok, false); if (pattern) assert.match(result.message, pattern); assert.deepEqual(state, before); };
function workspace() {
  let state = run(blankWorkspace(), { type: "addSite", documentCode: "TOWER", name: "Tower", location: "Pasig", budget: 1000 });
  state = run(state, { type: "saveProjectScope", siteId: state.sites[0].id, name: "Structural", budget: 600 });
  return state;
}
function requestCommand(state, ref = "MRF-SCOPE-1") {
  return { type: "saveRequest", intent: "submit", siteId: state.sites[0].id, scopeId: state.scopes[0].id, ref, requestDate: "2026-10-07", requestedBy: "Site", approvedBy: "Signatory", purchaser: "Buyer", financeOfficer: "Finance", items: [{ id: `${ref}-item`, name: "Cement", unit: "bag", quantity: 5, neededDate: "2026-10-08", purpose: "", location: "Pasig", remarks: "" }], documents: [{ name: "Supporting.pdf", type: "Supporting PDF", fileId: `${ref}-support` }] };
}
function pricedPO() {
  let state = seedDemo(), po = state.pos.find(value => value.id === "po3");
  po.lines = [{ itemId: "m3-i1", quoteLineId: state.quotes.find(value => value.id === po.quoteId).lines[0].id, quantity: 1, unitPrice: 700 }];
  state.scopes.find(scope => scope.id === "site-b-scope").budget = 1000;
  state = run(state, { type: "saveAccountingPO", id: po.id, paymentMode: "credit", financial: { vatStatus: "VAT", priceBasis: "inclusive", vatRate: 12, ewtGoods: 0, ewtServices: 0, reviewed: true }, adjustments: [{ id: "delivery", label: "Delivery fee", kind: "shipping", calculation: "fixed", value: 50, included: true, confirmed: true }] }, actors.accounting);
  return state;
}

test("Administrator maintains unique scope allocations within a project cap and named edits persist", () => {
  let state = workspace(), scope = state.scopes[0], siteId = scope.siteId;
  reject(state, { type: "saveProjectScope", siteId, name: "Civil", budget: 100 }, actors.accounting, /Administrator/);
  reject(state, { type: "saveProjectScope", siteId, name: " structural ", budget: 100 }, actors.admin, /already/);
  reject(state, { type: "saveProjectScope", siteId, name: "Civil", budget: 400.01 }, actors.admin, /project budget/);
  for (const budget of [-1, NaN, Infinity]) reject(state, { type: "saveProjectScope", siteId, name: "Civil", budget }, actors.admin, /valid/);
  state = run(state, { type: "saveProjectScope", siteId, name: "Civil", budget: 400 });
  state = run(state, { type: "saveProjectScope", id: scope.id, siteId, name: "Structure", budget: 599.99 });
  assert.equal(state.scopes[0].id, scope.id); assert.equal(projectScopes(state, siteId).length, 2);
  assert.equal(state.activity[0].actorIdentity.name, actors.admin.name); assert.equal(state.activity[0].entityRef, "Structure");
  assert.deepEqual(state.activity[0].changedFields, ["Scope name", "Scope allocation"]);
  const count = state.activity.length;
  state = run(state, { type: "saveProjectScope", id: scope.id, siteId, name: "Structure", budget: 599.99 });
  assert.equal(state.activity.length, count);
});

test("MRFs require a funded scope in their project while drafts and competing unpriced requests reserve nothing", () => {
  let state = workspace(), command = requestCommand(state);
  reject(state, { ...command, scopeId: undefined }, actors.site, /Choose a scope/);
  state = run(state, { type: "addSite", documentCode: "OTHER", name: "Other", location: "Manila", budget: 100 });
  state = run(state, { type: "saveProjectScope", siteId: state.sites[1].id, name: "Civil", budget: 100 });
  reject(state, { ...command, scopeId: state.scopes[1].id }, actors.site, /belonging/);
  state = run(state, { ...command, intent: "draft", scopeId: undefined, ref: "" }, actors.site);
  assert.equal(state.requests.at(-1).scopeId, undefined);
  const before = budgetFor(state, command.siteId);
  state = run(state, command, actors.site); state = run(state, requestCommand(state, "MRF-SCOPE-2"), actors.site);
  assert.deepEqual(budgetFor(state, command.siteId), before); assert.equal(scopeBudgetFor(state, command.scopeId).available, 600);
  state = run(state, { type: "saveProjectScope", id: command.scopeId, siteId: command.siteId, name: "Structural", budget: 0 });
  reject(state, requestCommand(state, "MRF-SCOPE-3"), actors.site, /no remaining budget/);
  reject(state, { type: "reviewRequest", id: state.requests.at(-1).id, decision: "approve" }, actors.pm, /no remaining budget/);
});

test("scope budget blocks a second split PO and includes service fees while the project retains its guard", () => {
  let state = pricedPO(), po = state.pos.find(value => value.id === "po3");
  assert.equal(poTotal(state, po), 750);
  state.scopes.find(scope => scope.id === "site-b-scope").budget = 749.99;
  reject(state, { type: "reviewPO", id: po.id, decision: "approve" }, actors.accounting, /scope budget/);
  state.scopes.find(scope => scope.id === "site-b-scope").budget = 1000;
  state.sites.find(site => site.id === "site-b").budget = 749.99;
  reject(state, { type: "reviewPO", id: po.id, decision: "approve" }, actors.accounting, /project budget/);
  state.sites.find(site => site.id === "site-b").budget = 100000;
  const second = structuredClone(po); second.id = "split-po"; second.ref = "PO-SPLIT"; second.lines[0].unitPrice = 300; second.adjustments = [];
  state.pos.push(second);
  state = run(state, { type: "reviewPO", id: po.id, decision: "approve" }, actors.accounting);
  assert.equal(scopeBudgetFor(state, "site-b-scope").available, 250);
  reject(state, { type: "reviewPO", id: second.id, decision: "approve" }, actors.accounting, /scope budget/);
  reject(state, { type: "saveProjectScope", id: "site-b-scope", siteId: "site-b", name: "Structural", budget: 749.99 }, actors.admin, /committed and spent/);
});

test("partial disbursement moves scope commitment to spend once and isolates other project scopes", () => {
  let state = run(pricedPO(), { type: "reviewPO", id: "po3", decision: "approve" }, actors.accounting);
  const before = scopeBudgetFor(state, "site-b-scope"), other = scopeBudgetFor(state, "site-a-scope"), projectBefore = budgetFor(state, "site-b");
  state = run(state, { type: "savePaymentRequest", poId: "po3", amount: 200, note: "Part payment", submit: true }, actors.accounting);
  const paymentId = state.paymentRequests.at(-1).id;
  state = run(state, { type: "reviewPaymentRequest", id: paymentId, decision: "approve" }, actors.finance);
  state = run(state, { type: "recordPayment", paymentRequestId: paymentId, method: "Bank", reference: "SCOPE-BANK", date: "2026-10-07" }, actors.finance);
  assert.deepEqual(scopeBudgetFor(state, "site-b-scope"), { allocated: 1000, committed: 550, spent: 200, available: before.available });
  assert.deepEqual(scopeBudgetFor(state, "site-a-scope"), other); assert.equal(budgetFor(state, "site-b").available, projectBefore.available);
  reject(state, { type: "recordPayment", paymentRequestId: paymentId, method: "Bank", reference: "DUPLICATE", date: "2026-10-07" }, actors.finance, /approved/);
});

test("document-only corrections preserve the budget scope and work after its funds are fully committed", () => {
  let state = seedDemo(), request = state.requests.find(value => value.id === "m1");
  request.archive = { status: "complete", approvedAt: "2026-10-01T00:00:00Z", versions: [] };
  state.sites.find(site => site.id === request.siteId).driveFolderId = "scope-project-folder";
  state.scopes.find(scope => scope.id === request.scopeId).budget = scopeBudgetFor(state, request.scopeId).committed;
  assert.equal(scopeBudgetFor(state, request.scopeId).available, 0);
  state = run(state, { type: "reopenApprovedRequest", id: request.id, reason: "Replace scanned document" }, actors.buyer);
  const command = { type: "saveRequest", id: request.id, intent: "submit", siteId: request.siteId, scopeId: request.scopeId, ref: request.ref, requestDate: request.requestDate, requestedBy: request.requestedBy, approvedBy: request.approvedBy, purchaser: request.purchaser, financeOfficer: request.financeOfficer, items: request.items, documents: [{ name: "Replacement.pdf", type: "Supporting PDF", fileId: "replacement" }] };
  reject(state, { ...command, scopeId: undefined }, actors.site, /Only the supporting PDF/);
  state = run(state, command, actors.site);
  state = run(state, { type: "reviewRequest", id: request.id, decision: "approve" }, actors.buyer);
  assert.equal(state.requests.find(value => value.id === request.id).scopeId, request.scopeId);
});

test("classification describes goods and services without changing tax, deductions or inventory", () => {
  const state = pricedPO(), before = structuredClone(state), po = state.pos.find(value => value.id === "po3");
  assert.equal(MATERIAL_CLASSIFICATION, "Goods");
  assert.equal(adjustmentClassification("shipping"), "Services"); assert.equal(adjustmentClassification("other"), "Services");
  assert.equal(adjustmentClassification("tax"), "Financial adjustment"); assert.equal(adjustmentClassification("discount"), "Financial adjustment");
  assert.deepEqual(state, before); assert.equal(poTotal(state, po), 750);
});

test("unscoped v12 data loads without writes or guessed assignments and still supports approved release", async () => {
  const saved = seedDemo(); delete saved.scopes; for (const request of saved.requests) delete request.scopeId;
  const raw = JSON.stringify(saved), previousWindow = globalThis.window, previousStorage = globalThis.localStorage;
  let writes = 0; globalThis.window = { addEventListener() {} }; globalThis.localStorage = { getItem: key => key === "hml-constructsync-demo-v12" ? raw : null, setItem() { writes++; } };
  try {
    const loaded = await new LocalDemoRepository().load(); assert.equal(loaded.status, "ready"); assert.equal(writes, 0); assert.deepEqual(loaded.snapshot.scopes, []);
    assert.deepEqual(loaded.snapshot.requests, saved.requests); assert.deepEqual(loaded.snapshot.activity, saved.activity);
    const released = run(loaded.snapshot, { type: "releasePO", id: "po5" }, actors.accounting);
    assert.equal(released.pos.find(value => value.id === "po5").status, "released");
    const reviewed = run(loaded.snapshot, { type: "saveAccountingPO", id: "po3", paymentMode: "credit", financial: { vatStatus: "NON-VAT", priceBasis: "inclusive", vatRate: 12, ewtGoods: 0, ewtServices: 0, reviewed: true } }, actors.accounting);
    reject(reviewed, { type: "reviewPO", id: "po3", decision: "approve" }, actors.accounting, /Choose a scope/);
  } finally { globalThis.window = previousWindow; globalThis.localStorage = previousStorage; }
});

test("scope allocations and their named audit survive repository reload", async () => {
  const initial = workspace(), saved = run(initial, requestCommand(initial), actors.site);
  const raw = JSON.stringify(saved), previousWindow = globalThis.window, previousStorage = globalThis.localStorage;
  let writes = 0; globalThis.window = { addEventListener() {} }; globalThis.localStorage = { getItem: key => key === "hml-constructsync-demo-v12" ? raw : null, setItem() { writes++; } };
  try {
    const loaded = await new LocalDemoRepository().load();
    assert.equal(loaded.status, "ready"); assert.equal(writes, 0);
    assert.deepEqual(loaded.snapshot.scopes, saved.scopes); assert.deepEqual(loaded.snapshot.activity, JSON.parse(raw).activity);
    assert.equal(loaded.snapshot.requests[0].scopeId, saved.scopes[0].id);
  } finally { globalThis.window = previousWindow; globalThis.localStorage = previousStorage; }
});

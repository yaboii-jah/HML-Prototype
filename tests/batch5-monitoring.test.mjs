import test from "node:test";
import assert from "node:assert/strict";
import { requestMonitoring, monitoringRequests } from "../src/domain/request-monitoring.ts";
import { requestLifecycle } from "../src/domain/request-lifecycle.ts";
import { seedDemo } from "../src/mock/fixtures/seed.ts";

function base() {
  const state = seedDemo(), po = state.pos.find(value => value.id === "po1");
  po.lines = [{ itemId: "m1-i1", quoteLineId: "offer-1", quantity: 100, unitPrice: 100 }];
  state.pos = [po]; state.batches = []; state.movements = []; state.activity = []; state.paymentRequests = []; state.payments = [];
  return state;
}
const row = state => requestMonitoring(state, "m1");
const batch = (id, amount, status = "confirmed", extra = {}) => ({ id, ref: `DEL-${id}`, poId: "po1", scheduledDate: "2026-10-07", evidence: "DR", delayReason: "", status, lines: [{ itemId: "m1-i1", expected: amount, accepted: amount, issue: "" }], createdAt: "2026-10-07T01:00:00Z", updatedAt: "2026-10-07T01:00:00Z", ...extra });
const payment = (id, poId, amount, status = "submitted") => ({ id, ref: `PAY-${id}`, poId, amount, note: "Supplier payment", status, priority: "Normal", createdAt: "2026-10-07T01:00:00Z", updatedAt: "2026-10-07T01:00:00Z", createdBy: "Accounting / Auditing" });
const pay = (state, poId, amount) => { const id = `payment-${state.paymentRequests.length}`; state.paymentRequests.push(payment(id,poId,amount,"disbursed")); state.payments.push({ id:`paid-${id}`,paymentRequestId:id,poId,amount,method:"Bank",reference:"BANK",date:"2026-10-07",actor:"Finance" }); };

test("monitoring is a readonly projection and empty/draft requests never receive completed milestones", () => {
  const state = base(), before = structuredClone(state), result = row(state);
  assert.deepEqual(state, before); assert.equal(result.served.state, "complete"); assert.equal(result.finance.state, "pending");
  assert.equal(Object.hasOwn(result,"completed"),false); assert.equal(Object.hasOwn(state.requests[0],"served"),false);
  const draft = state.requests.find(request => request.id === "m8"); draft.items = [];
  const empty = requestMonitoring(state,draft.id);
  for (const key of ["review","served","finance","delivered","stock"]) assert.notEqual(empty[key].state,"complete");
});

test("Served requires released coverage across split POs and excludes approved, draft and rejected allocations", () => {
  const state = base(), po = state.pos[0]; po.lines[0].quantity = 60;
  const second = structuredClone(po); second.id = "po-split"; second.ref = "PO-SPLIT"; second.lines[0].quantity = 40; second.status = "approved"; state.pos.push(second);
  assert.equal(row(state).served.state,"partial"); assert.equal(row(state).coverage[0].released,60);
  second.status = "released"; assert.equal(row(state).served.state,"complete");
  for (const status of ["draft","submitted","hold","returned","rejected"]) { second.status=status; assert.notEqual(row(state).served.state,"complete",status); }
  assert.equal(row(state).review.label,"Approved");
});

test("receiving every existing PO is still partial when requested quantities remain unawarded", () => {
  const state = base(); state.pos[0].lines[0].quantity=60; state.batches=[batch("partial",60,"posted")];
  pay(state,"po1",6000);
  const result=row(state);
  assert.equal(result.served.state,"partial"); assert.equal(result.delivered.state,"partial"); assert.equal(result.stock.state,"partial"); assert.equal(result.finance.state,"partial");
  assert.deepEqual(result.amounts,{payable:6000,paid:6000,outstanding:0});
  assert.match(requestLifecycle(state,"m1").stages.find(stage=>stage.name==="Delivery").progress,/Partly received/);
});

test("warehouse quantities never count as Delivered and credit receiving can finish before Finance or stock posting", () => {
  const state=base(); state.batches=[batch("warehouse",100,"confirmed",{leg:"supplier-warehouse"})];
  assert.equal(row(state).delivered.state,"pending"); assert.equal(row(state).stock.state,"pending");
  state.batches.push(batch("site",100,"confirmed",{leg:"warehouse-site",parentBatchId:"warehouse"}));
  assert.equal(row(state).delivered.state,"complete"); assert.equal(row(state).stock.state,"pending"); assert.notEqual(row(state).finance.state,"complete");
  state.batches[1].status="posted"; assert.equal(row(state).stock.state,"complete");
});

test("posting corrections update delivery coverage while subsequent use or adjustments do not undo posting", () => {
  const state=base(); state.batches=[batch("site",100)]; assert.equal(row(state).delivered.state,"complete");
  state.batches[0].status="posted"; state.batches[0].lines[0].accepted=95; state.batches[0].lines[0].issue="Five damaged";
  assert.equal(row(state).delivered.state,"partial"); assert.equal(row(state).stock.state,"partial");
  state.batches.push(batch("replacement",5,"posted"));
  state.movements.push({id:"use",siteId:"site-a",itemName:"Portland cement",unit:"bag",quantity:-100,kind:"usage",reason:"Used on site",actor:"Site Personnel",at:"2026-10-07T04:00:00Z"});
  assert.equal(row(state).delivered.state,"complete"); assert.equal(row(state).stock.state,"complete");
  assert.equal(row(state).flags.needsAttention,false,"Resolved historical shortages do not remain current blockers");
});

test("mixed units and materials require individual coverage rather than a combined quantity", () => {
  const state=base(), request=state.requests.find(value=>value.id==="m1");
  request.items.push({...request.items[0],id:"sand",name:"Sand",unit:"cu.m",quantity:2});
  state.batches=[batch("cement",100,"posted")];
  assert.equal(row(state).served.state,"partial"); assert.equal(row(state).delivered.state,"partial"); assert.equal(row(state).stock.state,"partial");
  state.pos[0].lines.push({itemId:"sand",quoteLineId:"sand-offer",quantity:2,unitPrice:500});
  state.batches[0].lines.push({itemId:"sand",expected:2,accepted:2,issue:""});
  assert.equal(row(state).served.state,"complete"); assert.equal(row(state).delivered.state,"complete");
});

test("Finance reflects open request ownership and full payments against approved material coverage", () => {
  const state=base(); state.pos[0].status="approved"; state.pos[0].paymentMode="upfront";
  let result=row(state); assert.equal(result.flags.forFinance,false); assert.equal(result.finance.label,"Accounting preparation");
  const request=payment("pending","po1",10000); state.paymentRequests.push(request);
  assert.equal(row(state).flags.forFinance,true); assert.equal(row(state).finance.label,"For Finance");
  request.status="hold"; assert.equal(row(state).finance.state,"blocked"); assert.equal(row(state).flags.needsAttention,true);
  request.status="returned"; assert.equal(row(state).flags.forFinance,false); assert.equal(row(state).finance.label,"Returned to Accounting");
  request.status="rejected"; pay(state,"po1",10000);
  result=row(state); assert.equal(result.finance.state,"complete"); assert.notEqual(result.served.state,"complete");
  assert.equal(result.delivered.state,"pending");
});

test("current exceptions stay on their own records and replaced rejected POs do not overwrite MRF review", () => {
  const state=base(), held=structuredClone(state.pos[0]); held.id="held"; held.ref="PO-HELD"; held.status="hold"; held.lines[0].quantity=20; state.pos[0].lines[0].quantity=80; state.pos.push(held);
  const result=row(state); assert.equal(result.review.label,"Approved"); assert.match(result.served.detail,/on hold/); assert.equal(result.flags.needsAttention,true);
  held.status="rejected"; state.pos[0].lines[0].quantity=100;
  assert.equal(row(state).served.state,"complete"); assert.equal(row(state).pos.length,2);
  state.requests.find(value=>value.id==="m1").correction={status:"requested",scope:"documents",reason:"Replace PDF"};
  assert.equal(row(state).served.state,"complete"); assert.match(row(state).review.detail,/Correction/);
});

test("project filtering, historical attribution and latest activity follow explicit record links without rewriting metadata", () => {
  const state=base(); delete state.scopes;
  state.siteFilter="site-b"; assert.ok(monitoringRequests(state).every(value=>value.request.siteId==="site-b"));
  assert.ok(monitoringRequests(state,"site-a").every(value=>value.request.siteId==="site-a"));
  state.requests.find(value=>value.id==="m1").updatedAt="2099-01-01T00:00:00Z";
  assert.equal(row(state).latestActivity,undefined); assert.equal(row(state).scopeName,"Scope not assigned");
  state.activity.push({id:"old",entity:"po1",at:"2026-10-07T01:00:00Z",actor:"Accounting / Auditing",action:"PO released"},{id:"other",entity:"m3",at:"2026-10-07T02:00:00Z",actor:"Procurement",action:"Other project"});
  const before=structuredClone(state), result=row(state);
  assert.equal(result.latestActivity.id,"old"); assert.equal(result.latestActivity.actorIdentity,undefined); assert.deepEqual(state,before);
});

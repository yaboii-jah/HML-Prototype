import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { emptyPayment, parsePayment, paymentIssues, parseAccountingCommand, parsePoReview } from "../src/domain/purchasing/accounting.ts";
import { parseOrderBody } from "../src/domain/purchasing/contracts.ts";
import { parseProject } from "../src/domain/projects/projects.ts";
import { purchasingFixture } from "./helpers/purchasing.mjs";

test("payment review distinguishes absent, malformed, upfront and agreed Credit terms", () => {
  const { order } = purchasingFixture();
  assert.equal(parseOrderBody(order).payment, undefined, "Old drafts receive no invented terms");
  assert.equal(parsePayment({ ...emptyPayment(), mode: "credit", dueDate: "2026-02-30" }), null);
  assert.equal(parsePayment({ ...emptyPayment(), mode: "staged" }), null);
  assert.match(paymentIssues(undefined, "2026-11-07", "2026-11-07").join(), /Choose/);
  const upfront = { mode: "upfront", dueDate: "", relation: "matches", reason: "" };
  assert.deepEqual(paymentIssues(upfront, "2026-11-07", "2026-11-07"), []);
  assert.match(paymentIssues({ ...upfront, dueDate: "2026-11-08" }, "2026-11-07", "2026-11-07").join(), /must not carry/);
  assert.match(paymentIssues({ ...upfront, relation: "differs" }, "2026-11-07", "2026-11-07").join(), /five characters/);
  assert.deepEqual(paymentIssues({ ...upfront, relation: "differs", reason: "Supplier agreed revised terms" }, "2026-11-07", "2026-11-07"), []);
});

test("Credit date gates submission and approval across the Philippine calendar boundary", () => {
  const credit = { mode: "credit", dueDate: "2026-11-08", relation: "matches", reason: "" };
  assert.deepEqual(paymentIssues(credit, "2026-11-07", "2026-11-08"), []);
  assert.match(paymentIssues(credit, "2026-11-07", "2026-11-09").join(), /current Philippine date/);
  assert.match(paymentIssues(credit, "2026-11-09", "2026-11-07").join(), /PO date/);
});

test("Accounting commands require reviewed source and budget versions and reject client financial authority", () => {
  const command = { type: "approvePo", requestId: randomUUID(), mrfId: randomUUID(), targetId: randomUUID(),
    expectedVersion: "2", expectedDemand: "3", expectedPoVersion: "4", expectedProjectVersion: "5",
    expectedFamily: "6", expectedMrfArchive: randomUUID(), reason: "" };
  assert.deepEqual(parseAccountingCommand(command), command);
  for (const field of ["expectedVersion", "expectedDemand", "expectedPoVersion", "expectedProjectVersion", "expectedFamily"]) {
    assert.equal(parseAccountingCommand({ ...command, [field]: 1 }), null);
  }
  for (const field of ["snapshot", "calculation", "totals"]) assert.equal(parseAccountingCommand({ ...command, [field]: {} }), null);
  assert.equal(parseAccountingCommand({ ...command, type: "rejectPo", reason: "" }), null);
  assert.equal(parseAccountingCommand({ ...command, type: "retryPoArchive", reason: "Retry verified archive" }), null);
  assert.ok(parseAccountingCommand({ ...command, type: "retryPoArchive", archiveId: randomUUID(), reason: "Retry verified archive" }));
});

test("review DTOs retain permanent actors and exact large money while omitting session proofs", () => {
  const actor = { userId: randomUUID(), name: "Accounting reviewer", activeRole: "Accounting", sessionId: randomUUID(), revision: "secret-proof" };
  const review = { status: "approved", submissionId: randomUUID(), approvalId: randomUUID(),
    budget: { projectId: randomUUID(), projectName: "Project", version: "9007199254740993", scopeId: randomUUID(), scopeName: "Structural Works",
      allocation: "9999999999999999.99", committed: "9007199254740993.01", uncommitted: "992800745259006.98" },
    preparerIds: [randomUUID()], submitterIds: [randomUUID()], events: [],
    approvals: [{ id: randomUUID(), version: "1", actor, at: "2026-11-07T00:00:00Z", archiveId: randomUUID(), archiveState: "complete", message: null }] };
  const parsed = parsePoReview(review);
  assert.equal(parsed.budget.committed, "9007199254740993.01");
  assert.equal(parsed.approvals[0].actor.userId, actor.userId);
  assert.equal("sessionId" in parsed.approvals[0].actor, false);
  assert.equal("revision" in parsed.approvals[0].actor, false);
  assert.equal(parsePoReview({ ...review, budget: { ...review.budget, committed: 10 } }), null);
});

test("Site project DTOs reject commitment fields and financial readers preserve their exact values", () => {
  const project = { id: randomUUID(), name: "Project", location: "Site", code: "QA49", codeLocked: true, version: "1", scopeCount: 1,
    scopes: [{ id: randomUUID(), name: "Structural Works", version: "1", committed: "10.00", uncommitted: "90.00" }] };
  assert.equal(parseProject(project, false, true, "Site Personnel"), null);
  const permitted = { ...project, financial: { budget: "100.00", allocated: "100.00", unallocated: "0.00", committed: "10.00", uncommitted: "90.00" }, scopes: [{ ...project.scopes[0], budget: "100.00" }] };
  assert.equal(parseProject(permitted, true, true, "Accounting").scopes[0].committed, "10.00");
});

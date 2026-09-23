import { newId, nextRef } from "./ids.ts";
import { acceptedFor, budgetFor, inventoryFor, outstandingFor, paidTotal, poTotal, requestForPO, schedulableFor, stockFor } from "./selectors.ts";
import { ROLES, type DemoSnapshot, type DocumentRef, type DocumentStatus, type Item, type Priority, type Role } from "./types.ts";

export type Command =
  | { type: "setRole"; role: Role }
  | { type: "setSiteFilter"; siteId: string }
  | { type: "saveRequest"; id?: string; intent: "draft" | "submit"; siteId: string; category: string; scope: string; items: Item[]; neededDate: string; purpose: string; location: string; remarks: string; documents: DocumentRef[] }
  | { type: "reviewRequest"; id: string; decision: "approve" | "return" | "reject"; reason?: string }
  | { type: "addQuote"; requestId: string; supplierId: string; ref: string; prices: Record<string, number>; available: string; leadDays: number; terms: string; document?: string }
  | { type: "createPO"; requestId: string; quoteId: string; reason: string; notes: string }
  | { type: "savePO"; id: string; quoteId: string; notes: string; finalize: boolean }
  | { type: "setPriority"; id: string; priority: Priority }
  | { type: "reviewPO"; id: string; decision: "approve" | "hold" | "return" | "reject"; reason?: string }
  | { type: "servePO"; id: string }
  | { type: "createBatch"; poId: string; scheduledDate: string; evidence: string; delayReason: string; expected: Record<string, number> }
  | { type: "confirmBatch"; id: string; lines: Record<string, { accepted: number; issue: string }> }
  | { type: "postBatch"; id: string; accepted: Record<string, number>; reason: string }
  | { type: "recordMovement"; siteId: string; itemName: string; unit: string; kind: "usage" | "adjustment"; quantity: number; reason: string }
  | { type: "saveDocuments"; poId: string; invoiceRef: string; receiptRef: string; review: DocumentStatus; note: string }
  | { type: "recordPayment"; poId: string; amount: number; method: "Cash" | "Bank" | "Check" | "Other"; reference: string; date: string }
  | { type: "updateAssignment"; siteId: string; manager: string; personnel: string }
  | { type: "addCategory"; name: string }
  | { type: "updateSupplier"; id: string; contact: string; accreditation: string }
  | { type: "addSupplier"; name: string; location: string; contact: string; accreditation: string };

export type CommandContext = { now: () => string; id: (prefix: string) => string };
export type CommandResult = { ok: true; snapshot: DemoSnapshot; recordId?: string; message: string } | { ok: false; message: string; field?: string };
const defaultContext: CommandContext = { now: () => new Date().toISOString(), id: newId };
const fail = (message: string, field?: string): CommandResult => ({ ok: false, message, field });
const positive = (n: number) => Number.isFinite(n) && n > 0;
const nonnegative = (n: number) => Number.isFinite(n) && n >= 0;
const reasonOK = (s?: string) => (s?.trim().length ?? 0) >= 5;

export function applyCommand(previous: DemoSnapshot, command: Command, ctx: CommandContext = defaultContext): CommandResult {
  const state = structuredClone(previous);
  const actor = state.role;
  const at = ctx.now();
  const id = ctx.id;
  const log = (entity: string, action: string, reason?: string) => state.activity.unshift({ id: id("act"), entity, action, reason: reason?.trim() || undefined, actor, at });
  const done = (message: string, recordId?: string): CommandResult => ({ ok: true, snapshot: state, recordId, message });
  const permit = (...roles: Role[]) => roles.includes(actor);

  switch (command.type) {
    case "setRole":
      if (!ROLES.includes(command.role)) return fail("Unknown role.");
      state.role = command.role;
      return done(`Switched to ${command.role}`);
    case "setSiteFilter":
      if (command.siteId !== "all" && !state.sites.some(s => s.id === command.siteId)) return fail("Site not found.");
      state.siteFilter = command.siteId;
      return done("Site context updated.");
    case "saveRequest": {
      if (!permit("Site Personnel")) return fail("Switch to Site Personnel to edit an MRF.");
      if (!state.sites.some(s => s.id === command.siteId)) return fail("Choose a valid site.", "siteId");
      const original = command.id ? state.requests.find(r => r.id === command.id) : undefined;
      if (command.id && !original) return fail("MRF not found.");
      if (original && !["draft", "returned"].includes(original.status)) return fail("Only draft or returned MRFs can be edited.");
      if (command.intent === "submit") {
        if (![command.scope, command.neededDate, command.purpose, command.location].every(x => x.trim())) return fail("Complete the request details before submitting.");
        if (!command.documents.some(d => d.name.trim())) return fail("Add a signed MRF reference before submitting.", "documents");
        if (!command.items.length || command.items.some(i => !i.name.trim() || !i.unit.trim() || !positive(i.quantity))) return fail("Each material needs a name, unit, and positive quantity.", "items");
      }
      const items = command.items.map(i => ({ ...i, name: i.name.trim(), unit: i.unit.trim(), id: i.id || id("item") }));
      const fields = { siteId: command.siteId, category: command.category, scope: command.scope.trim(), items, neededDate: command.neededDate, purpose: command.purpose.trim(), location: command.location.trim(), remarks: command.remarks.trim(), documents: command.documents.filter(d => d.name.trim()), status: command.intent === "submit" ? "submitted" as const : "draft" as const, reason: undefined, updatedAt: at };
      if (original) { Object.assign(original, fields); log(original.id, command.intent === "submit" ? "MRF revised and resubmitted" : "MRF draft saved"); return done(command.intent === "submit" ? "MRF submitted to the Project Manager." : "MRF draft saved.", original.id); }
      const requestId = id("mrf");
      state.requests.push({ id: requestId, ref: nextRef("MRF-2026", state.requests), createdAt: at, ...fields });
      log(requestId, command.intent === "submit" ? "MRF submitted" : "MRF draft saved");
      return done(command.intent === "submit" ? "MRF submitted to the Project Manager." : "MRF draft saved.", requestId);
    }
    case "reviewRequest": {
      if (!permit("Project Manager")) return fail("Switch to Project Manager to review an MRF.");
      const request = state.requests.find(r => r.id === command.id);
      if (!request || request.status !== "submitted") return fail("This MRF is no longer awaiting PM review.");
      if (command.decision !== "approve" && !reasonOK(command.reason)) return fail("Enter a reason of at least five characters.", "reason");
      request.status = command.decision === "approve" ? "approved" : command.decision === "return" ? "returned" : "rejected";
      request.reason = command.decision === "approve" ? undefined : command.reason?.trim();
      request.updatedAt = at;
      log(request.id, `MRF ${request.status}`, request.reason);
      return done(command.decision === "approve" ? "MRF approved. Procurement is next." : `MRF ${request.status}.`);
    }
    case "addQuote": {
      if (!permit("Procurement")) return fail("Switch to Procurement to add quotations.");
      const request = state.requests.find(r => r.id === command.requestId);
      if (!request || request.status !== "approved") return fail("Only an approved MRF can receive quotations.");
      if (!state.suppliers.some(s => s.id === command.supplierId)) return fail("Choose a valid supplier.", "supplierId");
      if (state.quotes.some(q => q.mrfId === request.id && q.supplierId === command.supplierId)) return fail("This supplier already has a quote for the MRF.");
      if (!command.ref.trim() || !command.available.trim() || !command.terms.trim() || !nonnegative(command.leadDays)) return fail("Complete the quotation reference, availability, lead time, and terms.");
      if (request.items.some(item => !positive(command.prices[item.id]))) return fail("Enter a positive unit price for every material.", "prices");
      const quoteId = id("quote");
      state.quotes.push({ id: quoteId, mrfId: request.id, supplierId: command.supplierId, ref: command.ref.trim(), prices: command.prices, available: command.available.trim(), leadDays: command.leadDays, terms: command.terms.trim(), documents: command.document?.trim() ? [{ name: command.document.trim(), type: "Reference" }] : [] });
      log(request.id, "Supplier quotation added");
      return done("Quotation added.", quoteId);
    }
    case "createPO": {
      if (!permit("Procurement")) return fail("Switch to Procurement to prepare a PO.");
      const request = state.requests.find(r => r.id === command.requestId);
      const quote = state.quotes.find(q => q.id === command.quoteId && q.mrfId === request?.id);
      if (!request || request.status !== "approved" || !quote) return fail("Choose a quote for an approved MRF.");
      if (state.pos.some(p => p.mrfId === request.id)) return fail("This MRF already has a PO.");
      if (state.quotes.filter(q => q.mrfId === request.id).length < 2) return fail("Compare at least two supplier quotations before selecting one.");
      if (!reasonOK(command.reason)) return fail("Explain the supplier choice in at least five characters.", "reason");
      const poId = id("po");
      state.pos.push({ id: poId, ref: nextRef("PO-2026", state.pos), mrfId: request.id, quoteId: quote.id, status: "draft", priority: "Normal", notes: command.notes.trim(), selectionReason: command.reason.trim(), createdAt: at, updatedAt: at });
      log(poId, "PO drafted", command.reason);
      return done("PO draft created.", poId);
    }
    case "savePO": {
      if (!permit("Procurement")) return fail("Switch to Procurement to edit a PO.");
      const po = state.pos.find(p => p.id === command.id);
      if (!po || !["draft", "returned"].includes(po.status)) return fail("This PO is locked for editing.");
      if (!state.quotes.some(q => q.id === command.quoteId && q.mrfId === po.mrfId)) return fail("Choose a quote linked to this MRF.");
      po.quoteId = command.quoteId; po.notes = command.notes.trim(); po.updatedAt = at;
      if (command.finalize) { po.status = "finalized"; po.reviewReason = undefined; log(po.id, "PO finalized for Finance"); return done("PO finalized. Finance is next."); }
      log(po.id, "PO draft updated"); return done("PO draft saved.");
    }
    case "setPriority": {
      if (!permit("Finance")) return fail("Switch to Finance to set priority.");
      const po = state.pos.find(p => p.id === command.id);
      if (!po || !["finalized", "hold"].includes(po.status)) return fail("This PO is not in Finance review.");
      po.priority = command.priority; po.updatedAt = at; log(po.id, `Priority set to ${po.priority}`);
      return done("Priority updated.");
    }
    case "reviewPO": {
      if (!permit("Finance")) return fail("Switch to Finance to review a PO.");
      const po = state.pos.find(p => p.id === command.id);
      if (!po || !["finalized", "hold"].includes(po.status)) return fail("This PO is not awaiting Finance review.");
      if (command.decision === "approve") {
        const request = requestForPO(state, po);
        if (!request) return fail("The linked MRF is missing.");
        if (poTotal(state, po) > budgetFor(state, request.siteId).available) return fail("This PO exceeds the available project budget.");
        po.status = "approved"; po.reviewReason = undefined; po.updatedAt = at; log(po.id, "Budget approved");
        return done("Budget approved. Procurement can serve the PO.");
      }
      if (!reasonOK(command.reason)) return fail("Enter a reason of at least five characters.", "reason");
      po.status = command.decision === "hold" ? "hold" : command.decision === "return" ? "returned" : "rejected";
      po.reviewReason = command.reason?.trim(); po.updatedAt = at; log(po.id, `Finance ${po.status}`, po.reviewReason);
      return done(`PO ${po.status}.`);
    }
    case "servePO": {
      if (!permit("Procurement")) return fail("Switch to Procurement to serve a PO.");
      const po = state.pos.find(p => p.id === command.id);
      if (!po || po.status !== "approved") return fail("Finance approval is required before serving.");
      po.status = "served"; po.updatedAt = at; log(po.id, "PO served");
      return done("PO served. Logistics is next.");
    }
    case "createBatch": {
      if (!permit("Logistics")) return fail("Switch to Logistics to schedule a delivery.");
      const po = state.pos.find(p => p.id === command.poId);
      if (!po || po.status !== "served") return fail("Only a served PO can receive a delivery batch.");
      const request = requestForPO(state, po);
      if (!request || !command.scheduledDate || !command.evidence.trim()) return fail("Enter a schedule and evidence reference.");
      const lines = request.items.map(item => ({ itemId: item.id, expected: command.expected[item.id] ?? 0, accepted: 0, issue: "" }));
      if (lines.some(line => !nonnegative(line.expected) || line.expected > schedulableFor(state, po, line.itemId)) || lines.every(line => line.expected === 0)) return fail("Expected quantities must fit the unscheduled PO balance.", "expected");
      const batchId = id("batch");
      state.batches.push({ id: batchId, ref: nextRef("DEL-2026", state.batches), poId: po.id, scheduledDate: command.scheduledDate, evidence: command.evidence.trim(), delayReason: command.delayReason.trim(), lines, status: "expected", createdAt: at, updatedAt: at });
      log(batchId, "Delivery batch scheduled", command.delayReason);
      return done("Expected batch logged. Site receiving is next.", batchId);
    }
    case "confirmBatch": {
      if (!permit("Site Personnel")) return fail("Switch to Site Personnel to confirm receiving.");
      const batch = state.batches.find(b => b.id === command.id);
      const po = state.pos.find(p => p.id === batch?.poId);
      if (!batch || batch.status !== "expected" || !po || po.status !== "served") return fail("This batch is not awaiting site confirmation.");
      for (const line of batch.lines) {
        const input = command.lines[line.itemId];
        if (!input || !nonnegative(input.accepted) || input.accepted > line.expected || input.accepted > outstandingFor(state, po, line.itemId)) return fail("Accepted quantity exceeds this batch or the open PO balance.");
        if (input.accepted < line.expected && !input.issue.trim()) return fail("Describe any shortage or damage before confirming.", "issue");
        line.accepted = input.accepted; line.issue = input.issue.trim();
      }
      batch.status = "confirmed"; batch.updatedAt = at; log(batch.id, "Received quantities confirmed");
      return done("Quantities confirmed. Review the posting preview.");
    }
    case "postBatch": {
      if (!permit("Site Personnel")) return fail("Switch to Site Personnel to post site stock.");
      const batch = state.batches.find(b => b.id === command.id);
      const po = state.pos.find(p => p.id === batch?.poId);
      const request = po && requestForPO(state, po);
      if (!batch || batch.status !== "confirmed" || !po || !request || state.movements.some(m => m.batchId === batch.id && m.kind === "receipt")) return fail("This batch cannot be posted again.");
      const changed = batch.lines.some(line => command.accepted[line.itemId] !== line.accepted);
      if (changed && !reasonOK(command.reason)) return fail("Explain changes to accepted quantities before posting.", "reason");
      for (const line of batch.lines) {
        const quantity = command.accepted[line.itemId];
        const ordered = request.items.find(item => item.id === line.itemId)?.quantity ?? 0;
        if (!nonnegative(quantity) || quantity > line.expected || quantity > ordered - acceptedFor(state, po.id, line.itemId, batch.id)) return fail("Posting quantity exceeds the batch or PO balance.");
        line.accepted = quantity;
      }
      batch.status = "posted"; batch.updatedAt = at;
      for (const line of batch.lines) {
        if (line.accepted <= 0) continue;
        const item = request.items.find(i => i.id === line.itemId)!;
        state.movements.push({ id: id("movement"), siteId: request.siteId, itemName: item.name, unit: item.unit, quantity: line.accepted, kind: "receipt", reason: `Posted ${batch.ref}${command.reason.trim() ? ` · ${command.reason.trim()}` : ""}`, batchId: batch.id, actor, at });
      }
      log(batch.id, "Accepted stock posted", command.reason);
      return done("Accepted quantities posted to site stock.");
    }
    case "recordMovement": {
      if (command.kind === "usage" && !permit("Site Personnel")) return fail("Switch to Site Personnel to record usage.");
      if (command.kind === "adjustment" && !permit("Site Personnel", "Accounting / Auditing")) return fail("This role cannot correct stock.");
      if (!state.sites.some(s => s.id === command.siteId) || !inventoryFor(state, command.siteId).some(item => item.name.toLowerCase() === command.itemName.trim().toLowerCase() && item.unit.toLowerCase() === command.unit.trim().toLowerCase())) return fail("Choose an existing site material.");
      if (!reasonOK(command.reason)) return fail("Enter a reason of at least five characters.", "reason");
      if (!Number.isFinite(command.quantity) || command.quantity === 0 || (command.kind === "usage" && command.quantity < 0)) return fail("Enter a valid nonzero quantity.", "quantity");
      const signed = command.kind === "usage" ? -command.quantity : command.quantity;
      if (stockFor(state, command.siteId, command.itemName, command.unit) + signed < 0) return fail("This movement would create negative stock.", "quantity");
      const movementId = id("movement");
      state.movements.push({ id: movementId, siteId: command.siteId, itemName: command.itemName, unit: command.unit, quantity: signed, kind: command.kind, reason: command.reason.trim(), actor, at });
      log(movementId, `${command.kind} recorded`, command.reason);
      return done(`${command.kind === "usage" ? "Usage" : "Adjustment"} recorded.`, movementId);
    }
    case "saveDocuments": {
      if (!permit("Accounting / Auditing")) return fail("Switch to Accounting to review documents.");
      if (!state.pos.some(p => p.id === command.poId && ["approved", "served"].includes(p.status))) return fail("This PO is not ready for accounting review.");
      if (command.review === "Complete" && (!command.invoiceRef.trim() || !command.receiptRef.trim())) return fail("Invoice and receipt references are required to complete review.");
      if (command.review === "Discrepancy" && !reasonOK(command.note)) return fail("Describe the discrepancy.", "note");
      let record = state.accounting.find(a => a.poId === command.poId);
      if (!record) { record = { poId: command.poId, invoiceRef: "", receiptRef: "", review: "Incomplete", note: "" }; state.accounting.push(record); }
      Object.assign(record, { invoiceRef: command.invoiceRef.trim(), receiptRef: command.receiptRef.trim(), review: command.review, note: command.note.trim() });
      log(command.poId, `Documents marked ${record.review}`, record.note);
      return done("Document review saved.");
    }
    case "recordPayment": {
      if (!permit("Accounting / Auditing")) return fail("Switch to Accounting to record a payment reference.");
      const po = state.pos.find(p => p.id === command.poId && ["approved", "served"].includes(p.status));
      if (!po) return fail("This PO is not ready for payment tracking.");
      if (!positive(command.amount) || command.amount > poTotal(state, po) - paidTotal(state, po.id)) return fail("Payment must be positive and within the unpaid PO amount.", "amount");
      if (!command.reference.trim() || !command.date) return fail("Enter a payment reference and date.");
      const paymentId = id("payment");
      state.payments.push({ id: paymentId, poId: po.id, amount: command.amount, method: command.method, reference: command.reference.trim(), date: command.date, actor });
      log(po.id, `Payment reference recorded · ${command.amount}`);
      return done("Payment reference recorded.", paymentId);
    }
    case "updateAssignment": {
      if (!permit("Administrator")) return fail("Switch to Administrator to edit assignments.");
      const site = state.sites.find(s => s.id === command.siteId);
      if (!site || !command.manager.trim() || !command.personnel.trim()) return fail("Enter both assignment names.");
      site.manager = command.manager.trim(); site.personnel = command.personnel.trim(); log(site.id, "Project assignment updated");
      return done("Assignments saved.");
    }
    case "addCategory": {
      if (!permit("Administrator")) return fail("Switch to Administrator to edit categories.");
      const name = command.name.trim();
      if (!name || state.categories.some(c => c.toLowerCase() === name.toLowerCase())) return fail("Enter a unique category name.");
      state.categories.push(name); log("admin", `Category added · ${name}`);
      return done("Category added.");
    }
    case "updateSupplier": {
      if (!permit("Administrator")) return fail("Switch to Administrator to edit suppliers.");
      const supplier = state.suppliers.find(s => s.id === command.id);
      if (!supplier || !command.contact.trim() || !command.accreditation.trim()) return fail("Enter supplier contact and accreditation.");
      supplier.contact = command.contact.trim(); supplier.accreditation = command.accreditation.trim(); log(supplier.id, "Supplier reference updated");
      return done("Supplier saved.");
    }
    case "addSupplier": {
      if (!permit("Administrator")) return fail("Switch to Administrator to add suppliers.");
      if (![command.name, command.location, command.contact, command.accreditation].every(value => value.trim())) return fail("Complete all supplier fields.");
      const supplierId = id("supplier");
      state.suppliers.push({ id: supplierId, name: command.name.trim(), location: command.location.trim(), contact: command.contact.trim(), accreditation: command.accreditation.trim() });
      log(supplierId, "Supplier added");
      return done("Supplier added.", supplierId);
    }
  }
}

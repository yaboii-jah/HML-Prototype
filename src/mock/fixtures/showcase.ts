import { COMPANY_WAREHOUSE } from "../../domain/company.ts";
import { blankWorkspace } from "./blank.ts";
import { applyCommand, type Command } from "../../domain/commands.ts";
import { localArchiveUrl } from "../../domain/archive-destination.ts";
import { coordinationEligible, coordinationBalance } from "../../domain/payment-coordination.ts";
import { poTotal } from "../../domain/selectors.ts";
import { ACCOUNT_FIXTURES } from "../../app-state/account-fixtures.ts";
import type { AccountingRecord, DemoSnapshot, Role, Quote } from "../../domain/types.ts";

export type ShowcaseDocument = { id: string; name: string; lines: string[] };
const MATERIALS = [
  ["Portland cement 40kg", "bag", 100, 265], ["Reinforcing bar 12mm x 6m", "length", 120, 235],
  ["Marine plywood 18mm", "sheet", 30, 1120], ["Concrete hollow block 6in", "piece", 500, 28],
  ["PVC conduit 20mm x 3m", "length", 80, 95], ["Copper wire THHN 3.5mm2", "roll", 8, 3650],
  ["Ceramic floor tile 600 x 600mm", "box", 40, 840], ["Interior latex paint 16L", "pail", 12, 2450],
  ["PPR pipe 25mm x 4m", "length", 60, 285], ["Fire sprinkler head 15mm", "piece", 45, 465],
  ["Galvanized steel duct 0.6mm", "sheet", 20, 1450], ["Medical gas copper tube 15mm", "length", 25, 985],
] as const;
const SCOPES = ["General Requirement", "Structural Works", "Civil Works", "Architectural", "Mechanical", "Electrical", "Plumbing & Sanitary", "Fire Protection", "Medical Gas", "Variation Order"];

/** A separate current-workflow fixture; legacy automated-test data stays unchanged. */
export function buildShowcase(installationId: string, now = new Date()) {
  let state: DemoSnapshot = { ...blankWorkspace(), showcase: { installationId, seededAt: now.toISOString(), revision: 1 } };
  const documents: ShowcaseDocument[] = [];
  let sequence = 0, offset = -45;
  const day = (days: number) => new Date(now.getTime() + days * 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
  const at = () => `${day(offset)}T02:00:00.000Z`;
  const actors = ACCOUNT_FIXTURES.map(({ name, role, email }) => ({ name, role, email }));
  const id = (prefix: string) => `showcase-${installationId}-${prefix}-${++sequence}`;
  const file = (name: string, lines: string[]) => {
    const fileId = `local-${installationId}-${++sequence}`;
    documents.push({ id: fileId, name, lines }); return fileId;
  };
  const run = (role: Role, command: Command) => {
    const result = applyCommand(state, command, { now: at, id, actor: actors.find(actor => actor.role === role)!, siteIds: state.sites.map(site => site.id) });
    if (!result.ok) throw new Error(`Showcase ${command.type}: ${result.message}`);
    state = result.snapshot;
  };
  state.sites = [
    ["PCH", "Pasig Community Health Center", "Pasig City"], ["CWE", "Cavite Warehouse Expansion", "Dasmarinas, Cavite"],
    ["LCF", "Laguna Commercial Fit-Out", "Santa Rosa, Laguna"], ["QOR", "Quezon City Office Renovation", "Quezon City"],
    ["BUU", "Bulacan Utilities Upgrade", "Malolos, Bulacan"],
  ].map(([code, name, location], index) => ({ id: `showcase-project-${index + 1}`, documentCode: code, name, location, budget: 8000000 + index * 1000000, personnel: "Miguel Santos", localArchiveId: installationId }));
  for (const site of state.sites) {
    state.scopes.push(...SCOPES.map((name, index) => ({ id: `${site.id}-scope-${index}`, siteId: site.id, name, budget: site.budget / SCOPES.length })));
    MATERIALS.forEach(([name, unit, quantity], index) => state.movements.push({ id: id("opening"), siteId: site.id, itemName: name, unit, quantity: index === 0 ? 0 : index % 4 === 0 ? Math.floor(quantity * 0.1) : quantity * 3, kind: "opening", reason: "Opening stock carried forward from prior work packages", actor: "Administrator", actorIdentity: actors.find(a => a.role === "Administrator"), at: at() }));
  }
  state.categories = [...SCOPES];
  state.suppliers = ["Metrospan Building Supply", "Bayanihan Concrete Products", "Summitline Steel Trading", "Eastbank Electrical Supply", "Greenfield Architectural Products", "Northway Plumbing Supply", "Primeguard Fire Systems", "Airlink Mechanical Trading", "Medipipe Technical Supply", "Southridge Construction Depot"].map((name, index) => ({ id: `showcase-supplier-${index + 1}`, name, location: ["Pasig City", "Cavite", "Quezon City", "Makati City", "Laguna"][index % 5], contact: `Sales desk ${index + 1} / sales@example.com`, accreditation: `HML-ACC-${String(index + 1).padStart(3, "0")}` }));

  for (let n = 0; n < 30; n++) {
    offset = -40 + n;
    const site = state.sites[n % 5], scope = state.scopes.find(s => s.siteId === site.id && s.name === SCOPES[n % 10])!;
    const items = Array.from({ length: 3 }, (_, k) => {
      const [name, unit, quantity] = MATERIALS[(n * 3 + k) % MATERIALS.length];
      return { id: id("item"), name, unit, quantity, neededDate: day(Math.min(14, offset + 20)), purpose: `Scheduled ${scope.name.toLowerCase()} work package`, location: site.location, remarks: "Confirm specifications and delivery access with the site engineer." };
    });
    const support = file(`${site.documentCode} supporting request ${n + 1}.pdf`, [site.name, scope.name, ...items.map(item => `${item.name} / ${item.quantity} ${item.unit}`), "Work area: " + site.location]);
    run("Site Personnel", { type: "saveRequest", intent: n >= 28 ? "draft" : "submit", siteId: site.id, scopeId: scope.id, ref: "", requestDate: day(offset), requestedBy: "Miguel Santos", approvedBy: "Adrian Cruz", purchaser: "Andrea Reyes", financeOfficer: "Paolo Mendoza", documents: [{ name: `${site.documentCode} supporting request.pdf`, type: "Supporting PDF", fileId: support }], items });
    const requestId = state.requests.at(-1)!.id;
    if (n >= 20 && n <= 24 || n >= 28) continue;
    run("Project Manager", { type: "reviewRequest", id: requestId, decision: n <= 19 ? "approve" : n <= 26 ? "return" : "reject", reason: n <= 26 ? "Confirm quantities against the latest site measurement." : "Existing available stock covers this work package." });
    if (n >= 25) continue;
    const request = state.requests.find(r => r.id === requestId)!;
    const form = file(`${request.ref}.pdf`, [request.ref, site.name, "Approved material request", ...items.map(item => `${item.name} / ${item.quantity} ${item.unit}`)]);
    run("Project Manager", { type: "completeRequestArchive", id: requestId, formFileId: form, supportFileId: support, formUrl: localArchiveUrl(form), supportUrl: localArchiveUrl(support) });
    if (n >= 18) continue;
    for (let k = 0; k < (n === 17 ? 1 : 3); k++) {
      const supplier = state.suppliers[(n + k) % state.suppliers.length], quoteId = id("quote"), item = items[k];
      const unitPrice = MATERIALS.find(material => material[0] === item.name)![3] + k * 5;
      const original = file(`${supplier.name} quotation.pdf`, [supplier.name, site.name, request.ref, `Quote: QT-${n + 1}-${k + 1}`, `${item.name} / ${item.quantity} ${item.unit} @ PHP ${unitPrice}`, `Amount PHP ${item.quantity * unitPrice}`, "Prices include VAT. Delivery within 3 working days."]);
      const quote: Quote = { id: quoteId, mrfId: requestId, supplierId: supplier.id, ref: `QT-${String(n + 1).padStart(3, "0")}-${k + 1}`, prices: {}, available: "Available from warehouse", leadDays: 3 + k, terms: k % 2 ? "30 days from invoice" : "Full payment before delivery", documents: [{ name: `${supplier.name} quotation.pdf`, type: "application/pdf", fileId: original }], currency: "PHP", extraction: "manual", reviewStatus: "draft", supplierDetails: { name: supplier.name, address: supplier.location, tin: "", contactName: "Sales desk", email: "sales@example.com", phone: "" }, financial: { vatStatus: "VAT", priceBasis: "inclusive", vatRate: 12, reviewed: true }, adjustments: [], lines: [{ id: id("offer"), description: item.name, quantity: item.quantity, unit: item.unit, unitPrice, requestItemId: item.id, conversionFactor: 1, matchConfirmed: true, brand: "As specified", specification: item.name, varianceReason: "" }] };
      run("Procurement", { type: "saveQuoteDraft", quote });
      if (n === 17) continue;
      run("Procurement", { type: "finalizeQuote", id: quoteId });
      run("Procurement", { type: "completeQuoteArchive", id: quoteId, files: [{ localFileId: original, driveFileId: original, url: localArchiveUrl(original), name: `${supplier.name} quotation.pdf` }] });
      if (n >= 15) continue;
      run("Procurement", { type: "createAwardPO", requestId, quoteId, lines: [{ itemId: item.id, quoteLineId: quote.lines![0].id, quantity: item.quantity, unitPrice }], tax: 0, freight: 0, discount: 0, reason: "Compliant material specification and confirmed delivery availability", notes: "Coordinate delivery with the receiving engineer." });
      const poId = state.pos.at(-1)!.id, index = n * 3 + k;
      if (index < 6) continue;
      run("Procurement", { type: "savePO", id: poId, quoteId, notes: "Coordinate delivery with the receiving engineer.", finalize: true });
      if (index < 12) continue;
      if (index < 20) { run("Accounting / Auditing", { type: "reviewPO", id: poId, decision: index < 15 ? "hold" : index < 18 ? "return" : "reject", reason: "Confirm the updated specification and supplier delivery commitment." }); continue; }
      const mode = index % 2 ? "credit" : "upfront";
      let po = state.pos.find(p => p.id === poId)!;
      run("Accounting / Auditing", { type: "saveAccountingPO", id: poId, paymentMode: mode, paymentDueDate: mode === "credit" ? day(index % 3 === 0 ? -4 : 15) : undefined, financial: { ...po.financial!, reviewed: true } });
      run("Accounting / Auditing", { type: "reviewPO", id: poId, decision: "approve" });
      po = state.pos.find(p => p.id === poId)!;
      const poFile = file(`${po.ref}.pdf`, [po.ref, request.ref, site.name, supplier.name, `${item.name} / ${item.quantity} ${item.unit}`, `Net supplier payable: PHP ${poTotal(state, po)}`, `Payment: ${mode}`, "Approved by Accounting"]);
      run("Accounting / Auditing", { type: "completePOArchive", id: poId, fileId: poFile, url: localArchiveUrl(poFile) });
      if (index < 24) continue;
      run("Procurement", { type: "issuePO", id: poId });
      if (index === 24 || index === 25) continue;
      offset = -2;
      if (mode === "upfront" || index % 3 !== 0) {
        const proofId = file(`${po.ref} payment confirmation.pdf`, [po.ref, supplier.name, "Demonstration payment confirmation", `Net payable PHP ${poTotal(state, state.pos.find(p => p.id === poId)!)}`, "Bank reference DEMO-" + index, day(-2)]);
        run("Accounting / Auditing", { type: "attachPaymentProofs", poId, documents: [{ name: `${po.ref} payment confirmation.pdf`, mime: "application/pdf", size: 100, localFileId: proofId, sha256: "0".repeat(64) }] });
        const proof = state.pos.find(p => p.id === poId)!.paymentProofs!.at(-1)!;
        run("Accounting / Auditing", { type: "completePaymentProofArchive", poId, documentId: proof.id, fileId: proofId, url: localArchiveUrl(proofId) });
        if (mode === "upfront") run("Accounting / Auditing", { type: "verifyExternalPayment", poId, method: "Bank", reference: `DEMO-PAY-${index}`, date: day(-2) });
        else run("Accounting / Auditing", { type: "recordCreditPayment", poId, paymentId: id("credit-payment"), proofIds: [proof.id], amount: Math.round(poTotal(state, state.pos.find(p => p.id === poId)!) * (index % 5 === 0 ? 100 : 50)) / 100, method: "Bank", reference: `DEMO-PAY-${index}`, date: day(-2) });
      }
      if (index < 30) continue;
      run("Accounting / Auditing", { type: "releasePO", id: poId });
    }
  }

  offset = -2;
  for (const request of state.requests.slice(15, 17)) run("Procurement", { type: "createBidReport", requestId: request.id });
  // Supplier legs include scheduled, in-transit, received and stock-posted work.
  offset = -1;
  for (const [index, po] of state.pos.filter(p => p.status === "released").entries()) {
    const request = state.requests.find(r => r.id === po.mrfId)!, item = request.items.find(i => i.id === po.lines![0].itemId)!;
    const count = index < 5 ? 3 : 2;
    let remaining = po.lines![0].quantity;
    for (let part = 0; part < count; part++) {
      const amount = part === count - 1 ? remaining : Math.floor(po.lines![0].quantity / count); remaining -= amount;
      run("Logistics", { type: "createBatch", poId: po.id, leg: index < 2 && part === 0 ? "supplier-warehouse" : "supplier-site", destination: index < 2 && part === 0 ? COMPANY_WAREHOUSE : undefined, scheduledDate: day(part === count - 1 ? 2 : -3), evidence: `${po.ref} supplier delivery ${part + 1}`, delayReason: "", expected: { [item.id]: amount } });
      const batchId = state.batches.at(-1)!.id;
      if (part === count - 1 && index % 3 === 0 && index < 12) continue;
      run("Logistics", { type: "dispatchBatch", id: batchId });
      if (part === count - 1 && index % 3 === 1 && index < 12) continue;
      const accepted = index === 2 && part === 0 ? Math.max(1, amount - 1) : amount;
      run(index < 2 && part === 0 ? "Procurement" : "Site Personnel", { type: "confirmBatch", id: batchId, lines: { [item.id]: { accepted, issue: accepted < amount ? "One unit damaged in transit" : "" } } });
      if (part === count - 1 && index % 3 === 2 && index < 12) continue;
      if (index < 2 && part === 0) {
        run("Logistics", { type: "createBatch", poId: po.id, leg: "warehouse-site", parentBatchId: batchId, scheduledDate: day(0), evidence: "Onward delivery from company warehouse", delayReason: "", expected: { [item.id]: accepted } });
        const onward = state.batches.at(-1)!;
        run("Logistics", { type: "dispatchBatch", id: onward.id });
        run("Site Personnel", { type: "confirmBatch", id: onward.id, lines: { [item.id]: { accepted, issue: "" } } });
        run("Site Personnel", { type: "postBatch", id: onward.id, accepted: { [item.id]: accepted }, reason: "Received from the company warehouse" });
        continue;
      }
      run("Site Personnel", { type: "postBatch", id: batchId, accepted: { [item.id]: accepted }, reason: "Quantities counted and accepted at site" });
    }
  }
  // Independent stock transfers leave both source and destination tasks ready.
  for (let n = 0; n < 4; n++) {
    const request = state.requests[18 + n % 2], source = state.sites.find(s => s.id !== request.siteId)!, item = request.items[n % 3];
    const material = MATERIALS.find(m => m[0] === item.name)!;
    run("Procurement", { type: "proposeStockTransfer", requestId: request.id, sourceSiteId: source.id, note: "Verified matching specification; use available stock before purchasing.", lines: [{ itemId: item.id, sourceName: material[0], unit: material[1], quantity: Math.min(5, item.quantity), suitabilityConfirmed: true }] });
    const transfer = state.stockTransfers!.at(-1)!;
    if (n === 0) continue;
    run("Site Personnel", { type: "reviewStockTransfer", id: transfer.id, decision: "approve", quantities: { [transfer.lines[0].id]: Math.min(5, item.quantity) }, reason: "Stock physically checked and available for release" });
    run("Logistics", { type: "scheduleTransferDelivery", transferId: transfer.id, scheduledDate: day(n === 1 ? 1 : -1), evidence: "Inter-project material transfer", quantities: { [transfer.lines[0].id]: Math.min(5, item.quantity) } });
    const delivery = state.transferDeliveries!.at(-1)!;
    if (n === 1) continue;
    run("Logistics", { type: "dispatchTransferDelivery", id: delivery.id });
    if (n === 2) continue;
    run("Site Personnel", { type: "receiveTransferDelivery", id: delivery.id, lines: { [transfer.lines[0].id]: { accepted: Math.min(5, item.quantity), issue: "" } } });
    run("Site Personnel", { type: "postTransferDelivery", id: delivery.id, quantities: { [transfer.lines[0].id]: Math.min(5, item.quantity) }, reason: "Counted and stored in the destination stock area" });
  }
  const accountingFor = (poId: string) => {
    let record = state.accounting.find(r => r.poId === poId);
    if (!record) { record = { poId, invoiceRef: "", receiptRef: "", review: "Incomplete", note: "Review supplier paperwork and delivery evidence." } satisfies AccountingRecord; state.accounting.push(record); }
    return record;
  };
  // Freeze real, readable local documents for receipts and invoices.
  for (const batch of state.batches) for (const receipt of batch.receiptVersions || []) {
    const receiptFile = file(`${batch.ref} receipt v${receipt.version}.pdf`, [batch.ref, receipt.data.project.name, "Delivery receipt", ...batch.lines.map(line => `${receipt.data.request.items.find(i => i.id === line.itemId)?.name} / expected ${line.expected} / accepted ${line.accepted}`)]);
    receipt.archive = { status: "complete", fileId: receiptFile, url: localArchiveUrl(receiptFile) };
    if (batch.status === "posted") {
      const signedFile = file(`${batch.ref} signed receipt.pdf`, [batch.ref, "Demonstration receiving acknowledgement", "Received and checked by Miguel Santos", ...batch.lines.map(line => `Accepted ${line.accepted} units`)]);
      const record = accountingFor(batch.poId);
      (record.documents ||= []).push({ id: id("signed-receipt"), batchId: batch.id, receiptVersion: receipt.version, name: `${batch.ref} signed receipt.pdf`, kind: "Signed delivery receipt", mime: "application/pdf", size: 100, localFileId: signedFile, sha256: "0".repeat(64), uploadedAt: at(), uploadedBy: "Site Personnel", uploadedByIdentity: actors[0], archive: { status: "complete", fileId: signedFile, url: localArchiveUrl(signedFile) } });
    }
  }
  for (const po of state.pos.filter(p => p.status === "released")) {
    const invoice = file(`${po.ref} invoice.pdf`, [po.ref, state.suppliers.find(s => s.id === (po.supplierId || state.quotes.find(q => q.id === po.quoteId)?.supplierId))?.name || "Supplier invoice", `Net payable PHP ${poTotal(state, po)}`, "Demonstration supplier invoice"]);
    const record = accountingFor(po.id);
    (record.documents ||= []).push({ id: id("invoice"), name: `${po.ref} invoice.pdf`, kind: "Invoice", mime: "application/pdf", size: 100, localFileId: invoice, sha256: "0".repeat(64), uploadedAt: at(), uploadedBy: "Accounting / Auditing", uploadedByIdentity: actors.find(a => a.role === "Accounting / Auditing"), archive: { status: "complete", fileId: invoice, url: localArchiveUrl(invoice) } });
    record.invoiceRef = `INV-${po.ref}`;
  }
  for (const [index, po] of state.pos.filter(p => p.status === "released").entries()) {
    const batches = state.batches.filter(b => b.poId === po.id);
    const review = batches.length && batches.every(b => b.status === "posted") ? "Complete" : index === 0 ? "Under Review" : index === 1 ? "Discrepancy" : undefined;
    if (review) run("Accounting / Auditing", { type: "saveDocuments", poId: po.id, invoiceRef: `INV-${po.ref}`, receiptRef: batches.map(b => b.ref).join(", "), review, note: review === "Complete" ? "Invoice, generated receipts and current signed receiving copies checked." : review === "Discrepancy" ? "Follow up the missing signed supplier receipt." : "Checking supplier invoice against received quantities." });
  }
  offset = 0;
  for (const [index, po] of state.pos.filter(po => coordinationEligible(po) && coordinationBalance(state, po) > 0).entries()) {
    run("Finance", { type: "savePaymentCoordination", poId: po.id, revision: po.paymentCoordination?.revision || 0, priority: index % 3 === 0 ? "High" : "Normal", status: index % 3 === 0 ? "Delayed" : index % 3 === 1 ? "Scheduled" : "Processing", plannedDate: day(index % 3 === 0 ? -1 : 2), note: index % 3 === 0 ? "Follow up supplier bank details before settlement." : "Included in the next supplier payment run." });
  }
  for (const site of state.sites) {
    const material = MATERIALS[2];
    run("Site Personnel", { type: "recordMovement", siteId: site.id, itemName: material[0], unit: material[1], kind: "usage", quantity: 12, reason: "Formwork used for the completed concrete work package" });
  }
  state.role = "Site Personnel"; state.siteFilter = "all";
  return { snapshot: state, documents };
}

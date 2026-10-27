import { initializedWorkspaceStorage } from './helpers/initialized-storage.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import { seedDemo } from "./fixtures/workspace.ts";
import { applyCommand } from "../src/domain/commands.ts";
import { initializePoDocument } from "../src/domain/po-document.ts";
import { poFinancialBreakdown, quoteFinancialBreakdown } from "../src/domain/pricing.ts";
import { moveQuotationServices } from "../src/domain/quotation-services.ts";
import { poTotal, supplierName, budgetFor } from "../src/domain/selectors.ts";
import { generatePoPdf } from "../src/server/template-po-pdf.ts";
import { pageText } from "./helpers/pdf-text.mjs";
import { LocalDemoRepository } from "../src/mock/repository.ts";
import { PDFDocument } from "pdf-lib";

const automatic = { vatStatus: "VAT", priceBasis: "inclusive", vatRate: 12, reviewed: true, ewtMode: "automatic", ewtGoods: 0, ewtServices: 0 };
const service = (value, taxable = true) => ({ id: "delivery", label: "Delivery Fee", kind: "shipping", calculation: "fixed", value, included: true, confirmed: true, taxable });
const priced = (unitPrice, quantity = 1) => ({ itemId: "item", quoteLineId: "offer", quantity, unitPrice });
const sample = () => ({ financial: { ...automatic }, lines: [185617.82, 319055.1, 231244.08, 96703.4, 245995.78, 99953.4, 37626.8].map((amount, i) => ({ ...priced(amount), quoteLineId: `offer-${i}` })), adjustments: [service(20000)] });
const run = (state, command) => { const result = applyCommand(state, command); assert.equal(result.ok, true, result.message); return result.snapshot; };
function fixture() {
  const state = seedDemo(); state.role = "Accounting";
  const po = state.pos[0], request = state.requests.find(value => value.id === po.mrfId), quote = state.quotes.find(value => value.id === po.quoteId), site = state.sites.find(value => value.id === request.siteId);
  initializePoDocument(po, request, quote, site, "2026-10-08T00:00:00Z");
  po.document.vendorName = supplierName(state, po); po.financial = { ...automatic };
  po.status = "submitted"; po.lines = [{ ...priced(112, 10), itemId: request.items[0].id }]; po.adjustments = [service(112)];
  state.pos = [po]; state.payments = []; request.items[0].quantity = 100;
  return { state, po, request, quote };
}

test("company sample produces the exact goods/services EWT and net payable", () => {
  const value = poFinancialBreakdown(sample());
  assert.equal(value.gross, 1236196.38); assert.equal(value.ewtGoods, 10858.9); assert.equal(value.ewtServices, 357.14); assert.equal(value.net, 1224980.34);
});

test("inclusive/exclusive VAT, changed rate and exempt fees apply VAT once", () => {
  const po = { financial: { ...automatic }, lines: [priced(112)], adjustments: [service(112)] };
  assert.equal(poFinancialBreakdown(po).net, 221);
  po.lines[0].unitPrice = 100; po.adjustments[0].value = 100; po.financial.priceBasis = "exclusive";
  assert.equal(poFinancialBreakdown(po).net, 221);
  po.financial.priceBasis = "inclusive"; po.financial.vatRate = 10; po.lines[0].unitPrice = 110; po.adjustments[0].value = 110;
  assert.equal(poFinancialBreakdown(po).net, 217);
  po.adjustments[0].taxable = false; assert.equal(poFinancialBreakdown(po).ewtServices, 0);
  po.financial.vatStatus = "NON-VAT"; assert.equal(poFinancialBreakdown(po).net, 220);
});

test("automatic service EWT excludes non-taxable charges in quotation and PO totals", () => {
  for (const priceBasis of ["inclusive", "exclusive"]) {
    for (const kind of ["shipping", "other"]) {
      const po = { financial: { ...automatic, priceBasis }, lines: [priced(112)], adjustments: [{ ...service(112, false), kind }] };
      const exempt = poFinancialBreakdown(po);
      assert.equal(exempt.servicesBase, 0);
      assert.equal(exempt.calculatedServices, 0);
      assert.equal(exempt.ewtServices, 0);
      assert.equal(exempt.gross, priceBasis === "inclusive" ? 224 : 237.44);
      assert.equal(exempt.ewtGoods, priceBasis === "inclusive" ? 1 : 1.12);
      assert.equal(exempt.net, priceBasis === "inclusive" ? 223 : 236.32);

      po.adjustments.push({ ...service(112), id: "taxable-service", kind, taxable: undefined });
      po.adjustments.push({ ...service(112), id: "excluded-service", kind, included: false });
      const mixed = poFinancialBreakdown(po);
      assert.equal(mixed.ewtServices, priceBasis === "inclusive" ? 2 : 2.24);
      assert.equal(mixed.gross, priceBasis === "inclusive" ? 336 : 362.88);
      assert.equal(mixed.net, priceBasis === "inclusive" ? 333 : 359.52);
      const quote = { financial: po.financial, lines: po.lines, adjustments: po.adjustments.filter(value => value.included) };
      assert.equal(quoteFinancialBreakdown(quote).net, mixed.net);

      po.adjustments = [po.adjustments[0]];
      po.financial = { ...po.financial, ewtMode: "manual", ewtServicesManual: true, ewtGoodsManual: false, ewtServices: 5 };
      const manual = poFinancialBreakdown(po);
      assert.equal(manual.calculatedServices, 0);
      assert.equal(manual.ewtServices, 5);
      assert.equal(manual.net, exempt.net - 5);
    }
  }
});

test("line discounts lower goods EWT but general discounts only lower payable", () => {
  const po = { financial: { ...automatic }, lines: [{ ...priced(1120), discountType: "percentage", discountValue: 10 }], adjustments: [service(112), { id: "discount", label: "Discount", kind: "discount", calculation: "fixed", value: 112, included: true, confirmed: true }] };
  const result = poFinancialBreakdown(po);
  assert.equal(result.ewtGoods, 9); assert.equal(result.ewtServices, 2); assert.equal(result.gross, 1008); assert.equal(result.net, 997);
});

test("quotation settings initialize automatic withholding on actual partial PO quantities", () => {
  const { state, po, request, quote } = fixture();
  quote.financial = { vatStatus: "VAT", priceBasis: "inclusive", vatRate: 12, reviewed: true };
  quote.lines = [{ id: "q-line", requestItemId: request.items[0].id, quantity: 100, unitPrice: 112, conversionFactor: 1 }]; quote.adjustments = [];
  po.lines = [{ ...priced(112, 10), itemId: request.items[0].id }]; po.adjustments = [];
  initializePoDocument(po, request, quote, state.sites[0], po.createdAt);
  assert.equal(quoteFinancialBreakdown(quote).ewtGoods, 100); assert.equal(poFinancialBreakdown(po).ewtGoods, 10); assert.equal(po.financial.ewtMode, "automatic");
  quote.adjustments = [service(112, false)]; delete po.adjustments;
  initializePoDocument(po, request, quote, state.sites[0], po.createdAt);
  assert.equal(po.adjustments[0].taxable, false); assert.equal(poFinancialBreakdown(po).ewtServices, 0);
  assert.equal(quoteFinancialBreakdown(quote).ewtServices, 0);
});

test("manual category overrides persist through price edits and can be recalculated", () => {
  let { state, po } = fixture();
  state = run(state, { type: "saveAccountingPO", id: po.id, paymentMode: "credit", financial: { ...automatic, ewtMode: "manual", ewtGoodsManual: true, ewtServicesManual: false, ewtGoods: 7 } });
  state = run(state, { type: "saveAccountingPO", id: po.id, paymentMode: "credit", financial: state.pos[0].financial, lines: state.pos[0].lines.map(line => ({ ...line, unitPrice: 224 })) });
  assert.equal(poFinancialBreakdown(state.pos[0]).ewtGoods, 7); assert.equal(poFinancialBreakdown(state.pos[0]).ewtServices, 2);
  state = run(state, { type: "saveAccountingPO", id: po.id, paymentMode: "credit", financial: { ...automatic } });
  assert.equal(poFinancialBreakdown(state.pos[0]).ewtGoods, 20);
  state = run(state, { type: "saveAccountingPO", id: po.id, paymentMode: "credit", financial: { ...automatic, vatStatus: "NON-VAT" } });
  assert.equal(poFinancialBreakdown(state.pos[0]).ewtGoods, 0);
});

test("Accounting direct edits preserve the quotation, effective supplier, audit and returned prices", () => {
  let { state, po, quote, request } = fixture(); const originalQuote = structuredClone(quote);
  const newSupplier = state.suppliers.find(value => value.id !== quote.supplierId);
  state = run(state, { type: "saveAccountingPO", id: po.id, paymentMode: "credit", supplierId: newSupplier.id, document: { ...po.document, vendorName: newSupplier.name, terms: "30 days" }, notes: "Accounting correction", lines: [{ ...po.lines[0], unitPrice: 224, quantity: 20 }], financial: { ...automatic } });
  assert.deepEqual(state.quotes.find(value => value.id === quote.id), originalQuote); assert.equal(supplierName(state, state.pos[0]), newSupplier.name); assert.equal(poTotal(state, state.pos[0]), 4550);
  assert.ok(state.activity[0].changedFields.includes("Supplier")); assert.ok(state.activity[0].changedFields.includes("Material lines"));
  state = run(state, { type: "reviewPO", id: po.id, decision: "return", reason: "Please check delivery dates" }); state.role = "Procurement";
  const returned = state.pos[0];
  state = run(state, { type: "savePO", id: po.id, quoteId: quote.id, notes: returned.notes, lines: returned.lines, financial: returned.financial, document: returned.document, adjustments: returned.adjustments, finalize: true });
  assert.equal(state.pos[0].lines[0].unitPrice, 224); assert.equal(state.pos[0].supplierId, newSupplier.id); assert.equal(state.requests.find(value => value.id === request.id).items[0].quantity, 100);
});

test("invalid direct edits and unauthorized overrides are atomic; approval locks editing", () => {
  const { state, po } = fixture(), original = structuredClone(state);
  for (const patch of [{ lines: [{ ...po.lines[0], quantity: 101 }] }, { lines: [{ ...po.lines[0], itemId: "unrequested" }] }, { supplierId: "missing" }, { financial: { ...automatic, ewtMode: "manual", ewtGoods: 999999 } }]) {
    const result = applyCommand(state, { type: "saveAccountingPO", id: po.id, paymentMode: "credit", financial: { ...automatic }, ...patch }); assert.equal(result.ok, false, result.message); assert.deepEqual(state, original);
  }
  const procurement = structuredClone(state); procurement.role = "Procurement"; procurement.pos[0].status = "returned"; procurement.pos[0].accountingEdited = true;
  assert.match(applyCommand(procurement, { type: "savePO", id: po.id, quoteId: po.quoteId, notes: "", finalize: false, financial: { ...automatic, ewtMode: "manual", ewtGoods: 1 } }).message, /Only Accounting/);
  procurement.pos[0].financial = { ...automatic, ewtMode: "manual", ewtGoodsManual: false, ewtServicesManual: true, ewtServices: 1 };
  const returned = run(procurement, { type: "savePO", id: po.id, quoteId: po.quoteId, notes: "", lines: [{ ...po.lines[0], unitPrice: 224 }], finalize: false, financial: { ...procurement.pos[0].financial, ewtGoods: 20 } });
  assert.equal(returned.pos[0].financial.ewtGoods, 20); assert.equal(returned.pos[0].financial.ewtServices, 1);
  const approved = run(run(state, { type: "saveAccountingPO", id: po.id, paymentMode: "credit", financial: { ...automatic } }), { type: "reviewPO", id: po.id, decision: "approve" });
  assert.equal(budgetFor(approved, state.requests[0].siteId).committed, poTotal(approved, approved.pos[0]));
  assert.equal(applyCommand(approved, { type: "saveAccountingPO", id: po.id, paymentMode: "credit", financial: automatic }).ok, false);
});

test("service row conversion avoids duplicate fees and preserves original source data", () => {
  const line = { id: "service-row", description: "Delivery Fee", quantity: 1, unitPrice: 20000, unit: "LOT", sourcePage: 2 };
  const quote = { lines: [line], adjustments: [service(20000)] };
  const normalized = moveQuotationServices(quote, [line.id]);
  assert.equal(normalized.lines.length, 0); assert.equal(normalized.adjustments.length, 1); assert.deepEqual(normalized.adjustments[0].sourceLine, line); assert.equal(quote.lines.length, 1);
});

test("new quote confirmation is mandatory and legacy PO totals remain unchanged", () => {
  let { state, quote } = fixture(); state.role = "Procurement";
  const draft = { ...structuredClone(quote), id: "new-vat-draft", lines: [], adjustments: [], reviewStatus: "draft" }; delete draft.financial;
  state = run(state, { type: "saveQuoteDraft", quote: draft });
  assert.equal(state.quotes.find(value => value.id === draft.id).financial.reviewed, false);
  assert.match(applyCommand(state, { type: "finalizeQuote", id: draft.id }).message, /VAT/);
  const legacy = { lines: [priced(100)], adjustments: [], financial: { ...automatic, ewtMode: undefined, ewtGoods: 8, ewtServices: 2 } };
  assert.equal(poFinancialBreakdown(legacy).net, 90);
});

test("PO PDF and reload retain effective supplier and automatic financial settings", async () => {
  const { state, po, request, quote } = fixture(); Object.assign(po, sample()); po.lines.forEach(line => { line.itemId = request.items[0].id; });
  po.document.vendorName = "Accounting supplier change";
  const pdf = await PDFDocument.load(await generatePoPdf(po, request, quote, "Project"));
  const texts = pdf.getPages().map(page => pageText(pdf, page).map(item => item.text).join(" ")).join(" ");
  assert.match(texts, /Accounting supplier change/); assert.match(texts, /10,858\.90/); assert.match(texts, /357\.14/); assert.match(texts, /1,224,980\.34/);
  const originalStorage = globalThis.localStorage, originalWindow = globalThis.window, saved = new Map([["hml-constructsync-demo-v12", JSON.stringify(state)]]);
  globalThis.window = { addEventListener() {} };
  globalThis.localStorage = initializedWorkspaceStorage({ getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) });
  try { const repository = new LocalDemoRepository(); await repository.load(); assert.equal(poTotal(repository.getSnapshot().snapshot, repository.getSnapshot().snapshot.pos[0]), 1224980.34); } finally { globalThis.localStorage = originalStorage; globalThis.window = originalWindow; }
});

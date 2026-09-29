import type { DemoSnapshot, MRF, PO, Quote, Site, Supplier, Batch, Movement } from "@/src/domain/types";

import { upgradeLegacyQuotes } from "../../domain/procurement.ts";

export function seedDemo(): DemoSnapshot {
  const day = (offset: number) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10); };
  const at = (offset: number) => `${day(offset)}T08:00:00.000Z`;
  const sites: Site[] = [
    { id: "site-a", name: "Harbor Residences · Site A", location: "Pasay City", budget: 750000, manager: "Mara Santos", personnel: "Joel Reyes" },
    { id: "site-b", name: "Northline Warehouse · Site B", location: "Quezon City", budget: 520000, manager: "Paolo Cruz", personnel: "Ina Garcia" },
  ];
  const suppliers: Supplier[] = [
    { id: "sup-1", name: "MetroBuild Materials", location: "Makati City", contact: "Lina Cruz · Sales", accreditation: "HML-ACC-014" },
    { id: "sup-2", name: "Pacific Cement & Supply", location: "Pasig City", contact: "Arnel Lim · Accounts", accreditation: "HML-ACC-021" },
    { id: "sup-3", name: "SolidSpan Trading", location: "Quezon City", contact: "Mika Tan · Trade Desk", accreditation: "HML-ACC-033" },
  ];
  const mk = (id: string, siteId: string, name: string, unit: string, quantity: number, status: MRF["status"], offset: number, category = "Structural") : MRF => ({ id, ref: `MRF-2026-${id.slice(1).padStart(3,"0")}`, requestDate: day(offset), siteId, category, scope: `${name} for current work package`, requestedBy: siteId === "site-a" ? "Joel Reyes" : "Ina Garcia", approvedBy: siteId === "site-a" ? "Mara Santos" : "Paolo Cruz", purchaser: "Nina Valdez", financeOfficer: "Rafael Lim", items: [{ id: `${id}-i1`, name, unit, quantity, neededDate: day(offset + 14), purpose: `Required for scheduled ${category.toLowerCase()} works.`, location: siteId === "site-a" ? "Tower 1 staging area" : "Main warehouse", remarks: "Coordinate with site storekeeper." }], documents: [{ name: `Signed ${id.toUpperCase()}.pdf`, type: "application/pdf" }, { name: "Key Plan - work area.pdf", type: "application/pdf" }], status, createdAt: at(offset), updatedAt: at(offset) });
  const requests = [mk("m1","site-a","Portland cement","bag",100,"approved",-21), mk("m2","site-a","Steel reinforcing bar 12mm","length",220,"approved",-11), mk("m3","site-b","Plywood 18mm","sheet",80,"approved",-9,"Formwork"), mk("m4","site-b","Concrete hollow block","piece",600,"approved",-8,"Masonry"), mk("m5","site-a","Washed sand","cu.m",18,"approved",-5), mk("m6","site-b","PVC conduit 20mm","length",120,"submitted",-3,"Electrical"), mk("m7","site-a","Ceramic floor tile","box",45,"returned",-6,"Finishes"), mk("m8","site-b","Paint primer","pail",20,"draft",-2,"Finishes"), mk("m9","site-b","Scaffolding clamp","piece",120,"rejected",-10,"Temporary Works")];
  requests[6].reason = "Clarify floor area and tile specification."; requests[8].reason = "Existing site stock covers the next work package.";
  const quotes: Quote[] = [
    { id:"q1", mrfId:"m1", supplierId:"sup-1", ref:"QT-MB-1042", prices:{"m1-i1":285}, available:"In stock", leadDays:3, terms:"30 days after delivery", documents:[{name:"MetroBuild quotation.pdf",type:"application/pdf"}] },
    { id:"q2", mrfId:"m1", supplierId:"sup-2", ref:"QT-PC-0781", prices:{"m1-i1":278}, available:"80 bags now; balance in 5 days", leadDays:5, terms:"50% advance, balance on delivery", documents:[{name:"Pacific quotation.pdf",type:"application/pdf"}] },
    { id:"q3", mrfId:"m2", supplierId:"sup-1", ref:"QT-MB-1055", prices:{"m2-i1":205}, available:"In stock", leadDays:4, terms:"30 days", documents:[] },
    { id:"q4", mrfId:"m2", supplierId:"sup-3", ref:"QT-SS-0128", prices:{"m2-i1":198}, available:"In stock", leadDays:6, terms:"30 days", documents:[] },
    { id:"q5", mrfId:"m3", supplierId:"sup-3", ref:"QT-SS-0130", prices:{"m3-i1":690}, available:"In stock", leadDays:3, terms:"15 days", documents:[] },
    { id:"q6", mrfId:"m4", supplierId:"sup-1", ref:"QT-MB-1060", prices:{"m4-i1":24}, available:"In stock", leadDays:5, terms:"30 days", documents:[] },
    { id:"q7", mrfId:"m5", supplierId:"sup-2", ref:"QT-PC-0790", prices:{"m5-i1":1450}, available:"In stock", leadDays:4, terms:"Cash on delivery", documents:[] },
  ];
  const pos: PO[] = [
    { id:"po1", ref:"PO-2026-001", mrfId:"m1", quoteId:"q2", status:"served", priority:"High", notes:"Deliver in two batches as availability permits.", selectionReason:"Lower unit price and staged availability suit the work schedule.", createdAt:at(-18), updatedAt:at(-14) },
    { id:"po2", ref:"PO-2026-002", mrfId:"m2", quoteId:"q4", status:"draft", priority:"Normal", notes:"", selectionReason:"Lowest compliant quote.", createdAt:at(-7), updatedAt:at(-7) },
    { id:"po3", ref:"PO-2026-003", mrfId:"m3", quoteId:"q5", status:"finalized", priority:"Normal", notes:"", selectionReason:"Available within required lead time.", createdAt:at(-6), updatedAt:at(-5) },
    { id:"po4", ref:"PO-2026-004", mrfId:"m4", quoteId:"q6", status:"hold", priority:"High", notes:"", selectionReason:"Meets block specification.", reviewReason:"Confirm revised delivery window with site.", createdAt:at(-6), updatedAt:at(-4) },
    { id:"po5", ref:"PO-2026-005", mrfId:"m5", quoteId:"q7", status:"approved", priority:"Normal", notes:"", selectionReason:"Meets required grading and schedule.", createdAt:at(-4), updatedAt:at(-2) },
  ];
  const batches: Batch[] = [
    { id:"b1", ref:"DEL-2026-001", poId:"po1", scheduledDate:day(-10), evidence:"Delivery receipt DR-4821", delayReason:"", lines:[{itemId:"m1-i1",expected:60,accepted:60,issue:""}], status:"posted", createdAt:at(-10), updatedAt:at(-9) },
    { id:"b2", ref:"DEL-2026-002", poId:"po1", scheduledDate:day(3), evidence:"Awaiting delivery receipt", delayReason:"", lines:[{itemId:"m1-i1",expected:40,accepted:0,issue:""}], status:"expected", createdAt:at(-2), updatedAt:at(-2) },
  ];
  const movements: Movement[] = [
    { id:"mv1", siteId:"site-a", itemName:"Portland cement", unit:"bag", quantity:60, kind:"receipt", reason:"Posted DEL-2026-001", batchId:"b1", actor:"Site Personnel", at:at(-9) },
    { id:"mv2", siteId:"site-a", itemName:"Portland cement", unit:"bag", quantity:-30, kind:"usage", reason:"Tower 1 slab pour", actor:"Site Personnel", at:at(-7) },
    { id:"mv3", siteId:"site-b", itemName:"Safety net", unit:"roll", quantity:12, kind:"opening", reason:"Opening stock balance", actor:"Administrator", at:at(-20) },
  ];
  const snapshot: DemoSnapshot = { version:7, role:"Site Personnel", siteFilter:"all", sites, suppliers, categories:["Structural","Formwork","Masonry","Electrical","Finishes","Temporary Works"], requests, quotes, pendingAwards:[], pos, batches, movements, payments:[], accounting:[{poId:"po1",invoiceRef:"",receiptRef:"DR-4821",review:"Incomplete",note:"Supplier invoice pending."}], activity:[{id:"a1",entity:"po1",at:at(-14),actor:"Procurement",action:"PO served"},{id:"a2",entity:"b1",at:at(-9),actor:"Site Personnel",action:"60 bags posted to site stock"},{id:"a3",entity:"m7",at:at(-5),actor:"Project Manager",action:"MRF returned",reason:requests[6].reason}] };
  return upgradeLegacyQuotes(snapshot);
}



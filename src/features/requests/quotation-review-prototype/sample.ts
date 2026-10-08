// Throwaway quotation-review samples. Never write these records to the app repository.
export type Material = { id: string; name: string; quantity: number; unit: string };
export type Offer = { id: string; materialId: string; description: string; quantity: number; unit: string; unitPrice: number; discount: number; tax: number; conversion: number; difference: string; confirmed: boolean; printed: number | null; explanation: string; sourceId: string; page: number };
export type Charge = { id: string; label: string; amount: number };
export type SampleQuote = { id: string; name: string; reference: string; currency: string; date: string; validity: string; terms: string; address: string; contact: string; leadDays: number; origin: "AI extracted" | "Manual entry"; version: number; status: "draft" | "finalized"; archive: "none" | "pending" | "complete" | "error"; charges: Charge[]; offers: Offer[]; documentIds: string[] };
export type Source = { id: string; quoteId: string; name: string; pages: number; offers: Offer[]; supplier: string; reference: string; currency: string };
export type Sample = { materials: Material[]; quotes: SampleQuote[]; sources: Source[] };
export const amount = (offer: Offer) => Math.round(offer.quantity * offer.unitPrice * (1 - offer.discount / 100) * (1 + offer.tax / 100) * 100) / 100;
export const total = (quote: SampleQuote) => quote.offers.reduce((sum, offer) => sum + amount(offer), 0) + quote.charges.reduce((sum, charge) => sum + charge.amount, 0);
export const formatted = (currency: string, value: number) => `${currency === "PHP" ? "₱" : currency === "USD" ? "$" : currency + " "}${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export function problems(quote: SampleQuote, materials: Material[]): string[] {
  const result: string[] = [];
  if (!quote.name.trim()) result.push("Enter the supplier name.");
  if (!quote.reference.trim()) result.push("Enter the quotation reference.");
  if (!quote.currency.trim()) result.push("Enter the currency.");
  if (!quote.documentIds.length) result.push("Attach a source quotation.");
  if (!quote.offers.length) result.push("Add an offered line.");
  for (const offer of quote.offers) {
    const label = offer.description || "Unnamed offer", material = materials.find(item => item.id === offer.materialId);
    if (!offer.description.trim() || !offer.unit.trim() || offer.quantity <= 0 || offer.unitPrice <= 0) result.push(`${label}: complete description, quantity, unit and price.`);
    if (material && !offer.confirmed) result.push(`${label}: confirm the MRF match.`);
    if (material && (offer.conversion <= 0 || offer.unit.toLowerCase() !== material.unit.toLowerCase() && !offer.difference.trim())) result.push(`${label}: review the unit conversion and difference.`);
    if (offer.printed !== null && Math.abs(amount(offer) - offer.printed) > .01 && !offer.explanation.trim()) result.push(`${label}: explain the printed amount difference.`);
  }
  if (quote.charges.some(charge => !charge.label.trim() || !Number.isFinite(charge.amount))) result.push("Review quotation charges.");
  return result;
}
export function samples(count = 12): Sample {
  const names = ["Portland cement, 40 kg", "Marine plywood, 18 mm", "Coatguard 114 HBP", "Deformed reinforcing bar, 16 mm", "Concrete hollow blocks, 6 in", "PVC pipe, 100 mm", "Sand, washed", "Gravel, 3/4 in", "Roofing sheet, prepainted", "Tie wire, No. 16", "Tile adhesive, 25 kg", "Safety harness"];
  const units = ["bag", "sheet", "gal", "kg", "pc", "length", "m³", "m³", "sheet", "kg", "bag", "set"];
  const materials = Array.from({ length: count }, (_, index) => ({ id: `m-${index}`, name: names[index % names.length] + (index >= names.length ? ` · area ${Math.floor(index / names.length) + 1}` : ""), quantity: [100, 20, 7, 300, 600, 30, 20, 20, 60, 25, 40, 8][index % 12], unit: units[index % 12] }));
  const suppliers = ["MetroBuild Materials", "SolidMix Trading", "PrimeSource Industrial", "Harbor Hardware", "Granite Supply Co."];
  const quotes: SampleQuote[] = suppliers.map((name, index) => {
    const id = `q-${index}`, sourceId = `${id}-quotation`;
    const offers: Offer[] = materials.filter((_, n) => !(index === 1 && n % 5 === 2) && !(index === 2 && n % 4 === 3)).map((material, n) => ({ id: `${id}-${material.id}`, materialId: material.id, description: material.name.replace(/ · area .+$/, "") + (index === 0 ? " · Pacific brand" : ""), quantity: material.quantity - (index === 1 && material.id === "m-0" ? 20 : 0), unit: material.unit, unitPrice: [265, 680, 1850, 58, 19, 240, 1100, 1250, 495, 72, 190, 2800][Number(material.id.slice(2)) % 12] * (index === 2 ? .02 : 1 + index * .035), discount: 0, tax: 0, conversion: 1, difference: "", confirmed: index >= 3 || index === 2, printed: null, explanation: "", sourceId: index === 2 ? "" : sourceId, page: Math.floor(n / 8) + 1 }));
    if (index === 0) { offers.splice(1, 0, { ...offers[0], id: `${id}-alternative`, description: "Portland cement, 40 kg · Premium alternative", unitPrice: 285, quantity: 60, confirmed: false }); if (offers[3]) offers[3].printed = amount(offers[3]) - 500; }
    if (index === 1) { const bar = offers.find(offer => offer.materialId === "m-3"); if (bar) { bar.unit = "bundle"; bar.quantity = 6; bar.unitPrice = 2900; bar.conversion = 50; } }
    if (index < 2) offers.push({ id: `${id}-extra`, materialId: "", description: index === 0 ? "Industrial safety gloves" : "Supplier handling allowance", quantity: 10, unit: index === 0 ? "pair" : "lot", unitPrice: 120, discount: 0, tax: 0, conversion: 1, difference: "", confirmed: false, printed: null, explanation: "", sourceId: "", page: 0 });
    return { id, name, reference: index === 1 ? "" : `Q-${["MB", "SM", "PS", "HH", "GS"][index]}-1026`, currency: index === 2 ? "USD" : "PHP", date: "2026-10-08", validity: "2026-11-08", terms: index % 2 ? "30 days credit" : "Payment before delivery", address: "Industrial Avenue, Baguio City", contact: "Supplier sales desk", leadDays: index + 2, origin: index === 2 ? "Manual entry" : "AI extracted", version: index === 0 ? 2 : 1, status: index >= 3 ? "finalized" : "draft", archive: index === 3 ? "complete" : index === 4 ? "error" : "none", charges: [{ id: `${id}-delivery`, label: "Delivery charge", amount: 1500 }], offers, documentIds: [sourceId, `${id}-terms`] };
  });
  const sources = quotes.flatMap(quote => [{ id: quote.documentIds[0], quoteId: quote.id, supplier: quote.name, reference: quote.reference || "SM-ORIGINAL-008", currency: quote.currency, name: `${quote.name} quotation.pdf`, pages: Math.max(1, ...quote.offers.map(offer => offer.page)), offers: structuredClone(quote.offers).map(offer => ({ ...offer, page: offer.page || 1 })) }, { id: quote.documentIds[1], quoteId: quote.id, supplier: quote.name, reference: quote.reference || "SM-ORIGINAL-008", currency: quote.currency, name: `${quote.name} commercial terms.pdf`, pages: 1, offers: [] }]);
  return { materials, quotes, sources };
}

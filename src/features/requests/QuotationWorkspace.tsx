"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useDemo } from "@/src/app-state/DemoProvider";
import { Badge, Empty, Field, InlineError, RecordHeader } from "@/src/components/ui/Primitives";
import { MissingRecord } from "@/src/components/ui/States";
import { money } from "@/src/domain/format";
import { newId } from "@/src/domain/ids";
import { orderedFor } from "@/src/domain/selectors";
import type { Quote, QuoteLine } from "@/src/domain/types";
import { openQuoteFile, saveQuoteFiles } from "./quote-files";

type ExtractedLine = Pick<QuoteLine, "description" | "quantity" | "unit" | "unitPrice" | "brand" | "specification">;
type Draft = { supplier: string; reference: string; currency: string; available: string; leadDays: number; terms: string; validity: string; tax: number; freight: number; discount: number; lines: QuoteLine[] };
const blankLine = (): QuoteLine => ({ id: newId("offer"), description: "", quantity: 1, unit: "", unitPrice: 0, brand: "", specification: "", requestItemId: "", conversionFactor: 1, varianceReason: "" });
const blankDraft = (): Draft => ({ supplier: "", reference: "", currency: "PHP", available: "", leadDays: 0, terms: "", validity: "", tax: 0, freight: 0, discount: 0, lines: [blankLine()] });
const latestQuotes = (quotes: Quote[]) => { const superseded = new Set(quotes.map(quote => quote.supersedesId).filter(Boolean)); return quotes.filter(quote => !superseded.has(quote.id)); };
const num = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;

export function QuotationWorkspace({ id }: { id: string }) {
  const { snapshot: state, run } = useDemo();
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [source, setSource] = useState<"gemini" | "manual">("manual");
  const [supplierId, setSupplierId] = useState("");
  const [newSupplier, setNewSupplier] = useState(false);
  const [supersedesId, setSupersedesId] = useState("");
  const [awardId, setAwardId] = useState("");
  const [awardQuantities, setAwardQuantities] = useState<Record<string, number>>({});
  const [charges, setCharges] = useState({ tax: 0, freight: 0, discount: 0 });
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!state) return null;
  const request = state.requests.find(value => value.id === id);
  if (!request) return <MissingRecord name="MRF" listHref="/requests"/>;
  const quotes = state.quotes.filter(quote => quote.mrfId === id);
  const currentQuotes = latestQuotes(quotes);
  const pos = state.pos.filter(po => po.mrfId === id);
  const canEdit = state.role === "Procurement" && request.status === "approved";
  const remaining = (itemId: string) => Math.max(0, (request.items.find(item => item.id === itemId)?.quantity || 0) - pos.filter(po => po.status !== "rejected").reduce((sum, po) => sum + orderedFor(state, po, itemId), 0));
  const selectedQuote = quotes.find(quote => quote.id === awardId);

  const updateLine = (index: number, patch: Partial<QuoteLine>) => setDraft(current => current && ({ ...current, lines: current.lines.map((line, i) => i === index ? { ...line, ...patch } : line) }));
  const parse = async () => {
    if (!files.length) { setError("Choose the supplier quotation files first."); return; }
    setBusy(true); setError("");
    try {
      const form = new FormData(); files.forEach(file => form.append("files", file));
      const response = await fetch("/api/quotes/extract", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Quotation parsing failed.");
      const extracted = result.extraction as Omit<Draft, "lines"> & { lines: ExtractedLine[] };
      if (!Array.isArray(extracted.lines)) throw new Error("Gemini returned no quotation lines.");
      setDraft({ supplier: String(extracted.supplier || ""), reference: String(extracted.reference || ""), currency: String(extracted.currency || "PHP").toUpperCase(), available: String(extracted.available || ""), leadDays: num(extracted.leadDays), terms: String(extracted.terms || ""), validity: String(extracted.validity || ""), tax: num(extracted.tax), freight: num(extracted.freight), discount: num(extracted.discount), lines: extracted.lines.map(line => ({ id: newId("offer"), description: String(line.description || ""), quantity: num(line.quantity), unit: String(line.unit || ""), unitPrice: num(line.unitPrice), brand: String(line.brand || ""), specification: String(line.specification || ""), requestItemId: "", conversionFactor: 1, varianceReason: "" })) });
      setSource("gemini");
      const match = state.suppliers.find(supplier => supplier.name.toLowerCase() === String(extracted.supplier || "").trim().toLowerCase());
      setSupplierId(match?.id || ""); setNewSupplier(!match);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Quotation parsing failed."); }
    finally { setBusy(false); }
  };
  const saveQuote = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!draft || !files.length) return;
    setBusy(true); setError("");
    try {
      if (draft.currency !== "PHP") throw new Error("Only PHP quotations can be saved in this phase.");
      let chosenSupplier = supplierId;
      if (newSupplier) {
        if (!draft.supplier.trim()) throw new Error("Enter the supplier name.");
        const added = await run({ type: "addSupplierFromQuote", name: draft.supplier });
        if (!added.ok || !added.recordId) throw new Error(added.message);
        chosenSupplier = added.recordId;
      }
      if (!chosenSupplier) throw new Error("Choose a supplier or add a new one.");
      const documents = await saveQuoteFiles(files);
      const saved = await run({ type: "saveReviewedQuote", requestId: id, supplierId: chosenSupplier, ref: draft.reference, available: draft.available, leadDays: draft.leadDays, terms: draft.terms, documents, lines: draft.lines, currency: draft.currency, tax: draft.tax, freight: draft.freight, discount: draft.discount, validity: draft.validity, extraction: source, supersedesId: supersedesId || undefined });
      if (!saved.ok) throw new Error(saved.message);
      setDraft(null); setFiles([]); setSupersedesId("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Quotation could not be saved."); }
    finally { setBusy(false); }
  };
  const createPO = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!selectedQuote?.lines) return;
    const lines = selectedQuote.lines.filter(line => line.requestItemId && num(awardQuantities[line.id]) > 0).map(line => ({ itemId: line.requestItemId, quoteLineId: line.id, quantity: num(awardQuantities[line.id]), unitPrice: line.unitPrice / line.conversionFactor }));
    const created = await run({ type: "createAwardPO", requestId: id, quoteId: selectedQuote.id, lines, ...charges, reason, notes });
    if (!created.ok) { setError(created.message); return; }
    router.push(`/purchase-orders/${created.recordId}`);
  };

  return <>
    <RecordHeader backHref={`/requests/${id}`} backLabel={request.ref} eyebrow="PROCUREMENT · QUOTATION REVIEW" title="Compare supplier quotations" badges={<Badge value={request.status}/>}/>
    <p className="muted">Upload the supplier documents, verify the extracted lines, then award quantities against each material in {request.ref}.</p>
    {canEdit && <section className="panel quote-upload-panel">
      <h2 className="panel-title">Supplier quotation</h2>
      <input aria-label="Supplier quotation files" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" multiple onChange={event => setFiles(Array.from(event.target.files || []))}/>
      <p className="helper-note">Original files stay in this browser. PDF, JPG, PNG, and WebP; up to 12 files, 20 MB each.</p>
      <div className="button-row"><button className="button primary" type="button" disabled={busy || !files.length} onClick={() => void parse()}>{busy ? "Processing…" : "Extract with Gemini"}</button><button className="button secondary" type="button" disabled={!files.length} onClick={() => { setDraft(blankDraft()); setSource("manual"); setError(""); }}>Review manually</button></div>
    </section>}
    {draft && canEdit && <form className="panel quote-review" onSubmit={event => void saveQuote(event)}>
      <h2 className="panel-title">Review {source === "gemini" ? "Gemini extraction" : "quotation"}</h2>
      <p className="helper-note">Check every value against the original documents. Match each offered line to an MRF material only when it is equivalent.</p>
      <div className="form-grid">
        <Field label="Supplier shown on quote"><input value={draft.supplier} onChange={event => setDraft({ ...draft, supplier: event.target.value })}/></Field>
        <Field label="Supplier directory"><select name="supplier" value={newSupplier ? "new" : supplierId} onChange={event => { setNewSupplier(event.target.value === "new"); setSupplierId(event.target.value === "new" ? "" : event.target.value); }}><option value="">Choose supplier</option>{state.suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}<option value="new">Add supplier from this quotation</option></select></Field>
        <Field label="Quotation reference"><input name="reference" required value={draft.reference} onChange={event => setDraft({ ...draft, reference: event.target.value })}/></Field>
        <Field label="Revised quotation"><select value={supersedesId} onChange={event => setSupersedesId(event.target.value)}><option value="">New quotation</option>{currentQuotes.filter(quote => quote.supplierId === supplierId).map(quote => <option key={quote.id} value={quote.id}>{quote.ref} · version {quote.version || 1}</option>)}</select></Field>
        <Field label="Currency"><input value={draft.currency} onChange={event => setDraft({ ...draft, currency: event.target.value.toUpperCase() })}/></Field>
        <Field label="Availability"><input value={draft.available} onChange={event => setDraft({ ...draft, available: event.target.value })}/></Field>
        <Field label="Lead time (days)"><input type="number" min="0" value={draft.leadDays} onChange={event => setDraft({ ...draft, leadDays: num(event.target.value) })}/></Field>
        <Field label="Payment terms"><input value={draft.terms} onChange={event => setDraft({ ...draft, terms: event.target.value })}/></Field>
        <Field label="Validity"><input value={draft.validity} onChange={event => setDraft({ ...draft, validity: event.target.value })}/></Field>
        <Field label="Quoted tax"><input type="number" min="0" step="0.01" value={draft.tax} onChange={event => setDraft({ ...draft, tax: num(event.target.value) })}/></Field>
        <Field label="Quoted freight"><input type="number" min="0" step="0.01" value={draft.freight} onChange={event => setDraft({ ...draft, freight: num(event.target.value) })}/></Field>
        <Field label="Quoted discount"><input type="number" min="0" step="0.01" value={draft.discount} onChange={event => setDraft({ ...draft, discount: num(event.target.value) })}/></Field>
      </div>
      <h3>Quoted materials</h3>
      {draft.lines.map((line, index) => <div className="quote-review-line" key={line.id}>
        <div className="form-grid">
          <Field label="Quoted description"><input name={`description-${index}`} required value={line.description} onChange={event => updateLine(index, { description: event.target.value })}/></Field>
          <Field label="MRF match"><select name={`match-${index}`} value={line.requestItemId} onChange={event => updateLine(index, { requestItemId: event.target.value })}><option value="">Unmatched / extra</option>{request.items.map(item => <option key={item.id} value={item.id}>{item.name} · {item.unit}</option>)}</select></Field>
          <Field label="Quoted quantity"><input name={`quoted-quantity-${index}`} type="number" min="0.0001" step="any" value={line.quantity} onChange={event => updateLine(index, { quantity: num(event.target.value) })}/></Field>
          <Field label="Quoted unit"><input name={`quoted-unit-${index}`} required value={line.unit} onChange={event => updateLine(index, { unit: event.target.value })}/></Field>
          <Field label="Unit price (PHP)"><input name={`unit-price-${index}`} type="number" min="0.01" step="any" value={line.unitPrice} onChange={event => updateLine(index, { unitPrice: num(event.target.value) })}/></Field>
          <Field label="MRF units per quoted unit"><input type="number" min="0.0001" step="any" value={line.conversionFactor} onChange={event => updateLine(index, { conversionFactor: num(event.target.value) })}/></Field>
          <Field label="Brand"><input value={line.brand} onChange={event => updateLine(index, { brand: event.target.value })}/></Field>
          <Field label="Specification"><input value={line.specification} onChange={event => updateLine(index, { specification: event.target.value })}/></Field>
          <Field label="Accepted difference / conversion reason"><input value={line.varianceReason} onChange={event => updateLine(index, { varianceReason: event.target.value })}/></Field>
        </div>
        <button type="button" className="text-link" onClick={() => setDraft({ ...draft, lines: draft.lines.filter(value => value.id !== line.id) })}>Remove line</button>
      </div>)}
      <button type="button" className="button secondary" onClick={() => setDraft({ ...draft, lines: [...draft.lines, blankLine()] })}>+ Add line</button>
      <div className="form-actions"><button type="button" className="button secondary" onClick={() => setDraft(null)}>Cancel review</button><button className="button primary" disabled={busy}>Save reviewed quotation</button></div>
    </form>}
    <section className="panel"><h2 className="panel-title">Compare by requested material</h2>
      <div className="table-frame"><table className="quote-matrix"><thead><tr><th>MRF material</th>{currentQuotes.map(quote => <th key={quote.id}>{state.suppliers.find(supplier => supplier.id === quote.supplierId)?.name || "Supplier"}<small>{quote.ref} · v{quote.version || 1}</small></th>)}</tr></thead><tbody>{request.items.map(item => <tr key={item.id}><th scope="row">{item.name}<small>{item.quantity} {item.unit} requested · {remaining(item.id)} unawarded</small></th>{currentQuotes.map(quote => { const offers = quote.lines?.filter(line => line.requestItemId === item.id) || []; return <td key={quote.id}>{offers.length ? offers.map(line => <div className="quote-offer" key={line.id}><strong>{money(line.unitPrice / line.conversionFactor)} / {item.unit}</strong><small>{line.description} · {line.quantity * line.conversionFactor} {item.unit} offered</small>{line.brand && <small>Brand: {line.brand}</small>}{line.specification && <small>{line.specification}</small>}{line.varianceReason && <small>Difference: {line.varianceReason}</small>}</div>) : quote.lines ? <span className="muted">Not quoted</span> : quote.prices[item.id] ? <span>{money(quote.prices[item.id])} / {item.unit}<small>Legacy quotation · original unavailable</small></span> : <span className="muted">Not quoted</span>}</td>; })}</tr>)}</tbody></table></div>
      {!currentQuotes.length && <Empty detail="Upload a supplier quotation to begin comparing materials."/>}
    </section>
    {currentQuotes.length > 0 && <section className="panel"><h2 className="panel-title">Supplier quotations and awards</h2><div className="quote-source-list">{currentQuotes.map(quote => <div className="quote-source" key={quote.id}><div><strong>{state.suppliers.find(supplier => supplier.id === quote.supplierId)?.name || "Supplier"} · {quote.ref}</strong><small>Version {quote.version || 1} · {quote.available || "Availability not stated"} · {quote.leadDays} day lead time · {quote.terms || "Terms not stated"}</small><small>Quoted charges: tax {money(quote.tax || 0)}, freight {money(quote.freight || 0)}, discount {money(quote.discount || 0)}</small></div><div className="button-row">{quote.documents.map(document => document.fileId ? <button type="button" className="text-link" key={document.fileId} onClick={() => void openQuoteFile(document.fileId!).catch(cause => setError(String(cause)))}>{document.name} ↗</button> : <small key={document.name}>{document.name} · legacy reference</small>)}{canEdit && quote.lines?.some(line => line.requestItemId && remaining(line.requestItemId) > 0) && <button className="button secondary" type="button" onClick={() => { setAwardId(quote.id); setAwardQuantities({}); setCharges({ tax: 0, freight: 0, discount: 0 }); setError(""); }}>Award from this quote</button>}</div></div>)}</div></section>}
    {selectedQuote?.lines && canEdit && <form className="panel quote-award" onSubmit={event => void createPO(event)}><h2 className="panel-title">Create PO draft · {state.suppliers.find(supplier => supplier.id === selectedQuote.supplierId)?.name}</h2><p className="helper-note">Allocate only the quantities to purchase from this supplier. Zero leaves a line unawarded.</p>{selectedQuote.lines.filter(line => line.requestItemId).map(line => { const item = request.items.find(value => value.id === line.requestItemId); if (!item) return null; const max = Math.min(remaining(item.id), line.quantity * line.conversionFactor - pos.filter(po => po.status !== "rejected" && po.quoteId === selectedQuote.id).reduce((sum, po) => sum + (po.lines || []).filter(value => value.quoteLineId === line.id).reduce((n, value) => n + value.quantity, 0), 0)); return <div className="quote-award-line" key={line.id}><div><strong>{item.name}</strong><small>{line.description} · {money(line.unitPrice / line.conversionFactor)} / {item.unit}</small><small>{Math.max(0, max)} {item.unit} available to award</small></div><Field label={`Award quantity (${item.unit})`}><input name={`award-${line.id}`} type="number" min="0" max={Math.max(0, max)} step="any" value={awardQuantities[line.id] ?? 0} onChange={event => setAwardQuantities({ ...awardQuantities, [line.id]: num(event.target.value) })}/></Field></div>; })}<div className="form-grid"><Field label={`PO tax (quote: ${money(selectedQuote.tax || 0)})`}><input type="number" min="0" step="0.01" value={charges.tax} onChange={event => setCharges({ ...charges, tax: num(event.target.value) })}/></Field><Field label={`PO freight (quote: ${money(selectedQuote.freight || 0)})`}><input type="number" min="0" step="0.01" value={charges.freight} onChange={event => setCharges({ ...charges, freight: num(event.target.value) })}/></Field><Field label={`PO discount (quote: ${money(selectedQuote.discount || 0)})`}><input type="number" min="0" step="0.01" value={charges.discount} onChange={event => setCharges({ ...charges, discount: num(event.target.value) })}/></Field><Field label="Supplier selection reason"><textarea name="reason" required minLength={5} value={reason} onChange={event => setReason(event.target.value)}/></Field><Field label="PO notes"><textarea name="notes" value={notes} onChange={event => setNotes(event.target.value)}/></Field></div><div className="form-actions"><button type="button" className="button secondary" onClick={() => setAwardId("")}>Cancel</button><button className="button primary">Create PO draft</button></div></form>}
    {quotes.length > currentQuotes.length && <section className="panel"><h2 className="panel-title">Earlier quotation versions</h2>{quotes.filter(quote => !currentQuotes.includes(quote)).map(quote => <div className="data-link" key={quote.id}><div><strong>{quote.ref} · version {quote.version || 1}</strong><small>{state.suppliers.find(supplier => supplier.id === quote.supplierId)?.name}</small></div><div className="button-row">{quote.documents.map(document => document.fileId ? <button type="button" className="text-link" key={document.fileId} onClick={() => void openQuoteFile(document.fileId!).catch(cause => setError(String(cause)))}>{document.name} ↗</button> : <small key={document.name}>{document.name}</small>)}</div></div>)}</section>}
    {pos.length > 0 && <section className="panel"><h2 className="panel-title">Purchase orders from this request</h2>{pos.map(po => <Link className="data-link" href={`/purchase-orders/${po.id}`} key={po.id}><span>{po.ref} · {state.suppliers.find(supplier => supplier.id === quotes.find(quote => quote.id === po.quoteId)?.supplierId)?.name}</span><Badge value={po.status}/></Link>)}</section>}
    <InlineError message={error}/>
  </>;
}

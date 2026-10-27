"use client";
import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { useDemo } from "@/src/app-state/DemoProvider";
import { Badge, Field, InlineError } from "@/src/components/ui/Primitives";
import { sourceStockAvailable } from "@/src/domain/stock-transfers";
import { procurementReady } from "@/src/domain/request-archive";
import { reviewIsCurrent } from "@/src/domain/stock-suitability";
import type { DemoSnapshot, MRF, StockSuitabilityReview } from "@/src/domain/types";

const labels = { pending: "Awaiting requesting site", approved: "Ready to request release", rejected: "Rejected by requesting site", cancelled: "Cancelled", used: "Release requested", stale: "Material changed" };
function ReviewCard({ state, request, review }: { state: DemoSnapshot; request: MRF; review: StockSuitabilityReview }) {
  const { run, siteIds } = useDemo();
  const [specificationsConfirmed, setSpecificationsConfirmed] = useState(false);
  const [quantity, setQuantity] = useState(review.status === "pending" ? String(review.proposed) : "");
  const [reason, setReason] = useState(""), [error, setError] = useState(""), [message, setMessage] = useState(""), [busy, setBusy] = useState(false), [cancelling, setCancelling] = useState(false);
  const working = useRef(false);
  const available = sourceStockAvailable(state, review.sourceSiteId, review.sourceName, review.unit);
  const current = reviewIsCurrent(state, review) && procurementReady(request);
  const canReview = state.role === "Site Personnel" && siteIds.includes(review.destinationSiteId) && review.status === "pending" && current;
  const canRelease = state.role === "Procurement" && review.status === "approved" && current;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (working.current) return;
    const decision = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value");
    working.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const result = await run(cancelling ? { type: "cancelStockSuitability", id: review.id, reason } : canReview ? { type: "reviewStockSuitability", specificationsConfirmed, id: review.id, decision: decision === "reject" ? "reject" : "approve", quantity: Number(quantity), reason } : { type: "requestApprovedStockRelease", id: review.id, quantity: Number(quantity) });
      if (result.ok) { setMessage(result.message); setCancelling(false); setReason(""); } else setError(result.message);
    } finally { working.current = false; setBusy(false); }
  }
  return <article className="stock-review-card" data-review-id={review.id} aria-label={"Suitability review for " + review.requestedName}>
    <div className="stock-card-heading"><strong>{review.proposed} {review.unit} from {state.sites.find(site => site.id === review.sourceSiteId)?.name}</strong><Badge>{labels[review.status]}</Badge></div>
    <div className="stock-specs"><div><small>Requested material</small><strong>{review.requestedName}</strong><span>{review.requestedUnit} · {review.requestedQuantity} requested</span></div><div><small>Proposed stock</small><strong>{review.sourceName}</strong><span>{review.unit} · {available} currently available</span></div></div>
    <p><strong>Why these may be the same material:</strong> {review.explanation}</p>
    {review.note && <p className="helper-note">Transfer note: {review.note}</p>}
    {review.specificationsConfirmed && <p className="helper-note">Same specifications confirmed by {review.reviewedBy?.name}.</p>}
    {review.reason && <p className="helper-note">Decision: {review.reason}</p>}
    {review.status === "pending" && <p className="helper-note">The requesting site must verify matching size, grade, type, brand and package size where specified. Reject stock with different specifications. {review.proposed} {review.unit} are set aside from purchasing; source stock is not held.</p>}
    {review.status === "approved" && <p className="helper-note">Approved for up to {review.approved} {review.unit}. Procurement rechecks stock before requesting release. Any unused quantity returns to purchasing.</p>}
    {review.status === "used" && review.transferId && <Link className="text-link" href={"/stock-transfers/" + review.transferId}>View source release request</Link>}
    {!current && ["pending", "approved"].includes(review.status) && <p className="field-error">The MRF is being corrected. Review actions are paused.</p>}
    {(canReview || canRelease || cancelling) && <form onSubmit={submit} className="stock-review-form">
      {!cancelling && <Field label={canReview ? "Quantity approved" : "Release quantity"}><input aria-label={(canReview ? "Approve quantity for " : "Release quantity for ") + review.sourceName} type="number" required aria-required="true" min="0" max={canReview ? review.proposed : Math.min(review.approved, available)} step="any" value={quantity} disabled={busy} onChange={event => setQuantity(event.target.value)}/></Field>}
      {(canReview || cancelling) && <Field label={cancelling ? "Cancellation reason" : "Reason (required for rejection or fewer units)"}><textarea aria-label={"Review reason for " + review.sourceName} value={reason} disabled={busy} onChange={event => setReason(event.target.value)}/></Field>}
      {canRelease && available <= 0 && !cancelling && <p className="field-error">No stock is currently available. Cancel this review to return its quantity to purchasing.</p>}
      {canReview && !cancelling && <label className="stock-check"><input type="checkbox" aria-label={"Confirm same specifications for " + review.sourceName} checked={specificationsConfirmed} disabled={busy} onChange={event => setSpecificationsConfirmed(event.target.checked)}/><span>I verified that both descriptions represent the same material, unit and specifications.</span></label>}
      <div className="button-row">{cancelling ? <><button type="button" className="button secondary" disabled={busy} onClick={() => setCancelling(false)}>Keep review</button><button className="button danger-outline" disabled={busy}>{busy ? "Cancelling…" : "Cancel review"}</button></> : canReview ? <><button className="button primary" value="approve" disabled={busy || !specificationsConfirmed}>{busy ? "Saving…" : "Confirm same material"}</button><button className="button danger-outline" value="reject" disabled={busy} formNoValidate>Reject match</button></> : <button className="button primary" disabled={busy || available <= 0}>{busy ? "Requesting…" : "Request stock release"}</button>}</div>
    </form>}
    {state.role === "Procurement" && ["pending", "approved"].includes(review.status) && !cancelling && <button className="text-link" type="button" disabled={busy} onClick={() => { setCancelling(true); setReason(""); setError(""); }}>Cancel suitability review</button>}
    <InlineError message={error}/>{message && <p role="status" className="helper-note">{message}</p>}
  </article>;
}
export function StockSuitabilityList({ state, request, itemId }: { state: DemoSnapshot; request: MRF; itemId?: string }) {
  const reviews = (state.stockSuitabilityReviews || []).filter(value => value.requestId === request.id && (!itemId || value.itemId === itemId));
  if (!reviews.length) return null;
  return <section id={itemId ? undefined : "stock-suitability"} className={itemId ? "stock-review-list" : "panel stock-review-list"} aria-label="Stock suitability reviews"><h3>Suitability reviews</h3>{reviews.map(review => <ReviewCard key={review.id + review.status} state={state} request={request} review={review}/>)}</section>;
}

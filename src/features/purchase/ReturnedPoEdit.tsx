"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDemo } from "@/src/app-state/DemoProvider";
import { useConfirmation } from "@/src/components/ui/ConfirmDialog";
import { InlineError, PageHeader } from "@/src/components/ui/Primitives";
import { poFinancialBreakdown } from "@/src/domain/pricing";
import { money } from "@/src/domain/format";
import type { PO } from "@/src/domain/types";
import { PoContentsFields } from "./PoContentsFields";
import { PoDocumentFields, readPoDocument, readPoFinancial } from "./PoDocumentFields";

export function ReturnedPoEdit({ po }: { po: PO }) {
  const { snapshot: state, run } = useDemo();
  const [draft, setDraft] = useState(po), [reviewed, setReviewed] = useState(false), [error, setError] = useState("");
  const { confirm, confirmation } = useConfirmation();
  const router = useRouter();
  if (!state) return null;
  const breakdown = poFinancialBreakdown(draft);
  const edit = (next: PO) => { setDraft(next); setReviewed(false); };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget), finalize = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "finalize";
    if (finalize && !await confirm(`Submit ${po.ref} to Accounting?`, "Accounting will review the updated purchase order.", "Submit to Accounting")) return;
    const result = await run({ type: "savePO", id: po.id, quoteId: po.quoteId, lines: draft.lines, adjustments: draft.adjustments, document: readPoDocument(form), financial: readPoFinancial(form), notes: draft.notes, supersededReason: draft.supersededReason, finalize });
    if (result.ok) router.push(`/purchase-orders/${po.id}`); else setError(result.message);
  };
  return <><PageHeader title="Edit purchase order" description="Accounting edits are retained. The original supplier quotation remains unchanged."/>
    {po.reviewReason && <p className="callout warn">{po.reviewReason}</p>}
    <form className="form-stack" onSubmit={save} onChange={event => { if (!(event.target instanceof HTMLInputElement) || event.target.name !== "financialReviewed") setReviewed(false); }}>
      <section className="panel"><PoContentsFields state={state} po={draft} onChange={edit} editSupplier={false}/></section>
      <PoDocumentFields document={draft.document!} financial={draft.financial!} reviewed={reviewed} onReview={setReviewed} onFinancialChange={financial => edit({ ...draft, financial })} breakdown={breakdown}/>
      <p>Net supplier payable: <strong>{money(breakdown.net)}</strong></p><InlineError message={error}/>
      <div className="button-row"><Link className="button secondary" href={`/purchase-orders/${po.id}`}>Cancel</Link><button className="button secondary" value="draft">Save draft</button><button className="button primary" value="finalize">Submit to Accounting</button></div>
    </form>{confirmation}</>;
}

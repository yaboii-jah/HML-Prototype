"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Field, InlineError } from "@/src/components/ui/Primitives";
import { RecordModal } from "@/src/components/ui/RecordModal";
import {
  HEADER_FIELDS,
  LINE_FIELDS,
  type QuotationDraft,
  type QuotationsView,
} from "@/src/domain/quotations/drafts";
import {
  calculateQuotation,
  emptyFinancialReview,
  quotationHeaderIssues,
  reconcileFinancialRows,
  type FinancialReview,
  type FinancialRow,
  type FinancialAdjustment,
  type QuotationCalculation,
  type SummaryBasis,
} from "@/src/domain/quotations/financial";
import { php } from "@/src/domain/quotations/decimal";
import { useQuoteOperation } from "./use-quotation-operation";

const roleLabels = {
  "": "Choose classification",
  material: "Material",
  shipping: "Delivery / freight",
  other: "Other service / charge",
  discount: "Discount",
  summary: "Source summary (count once)",
  reference: "Reference-only alternative",
};
const basisLabels = {
  "": "Choose calculation basis",
  materials: "Materials after line discounts",
  subtotal: "Subtotal before added VAT",
  vat: "VAT",
  gross: "Gross before EWT",
  net: "Net after EWT",
};

function BasisSelect({
  value,
  change,
  disabled,
}: {
  value: SummaryBasis;
  change: (value: SummaryBasis) => void;
  disabled: boolean;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => change(event.target.value as SummaryBasis)}
    >
      {Object.entries(basisLabels).map(([key, label]) => (
        <option key={key} value={key}>
          {label}
        </option>
      ))}
    </select>
  );
}
function TaxSelect({
  value,
  change,
  disabled,
}: {
  value: boolean | null;
  change: (value: boolean | null) => void;
  disabled: boolean;
}) {
  return (
    <select
      value={value === null ? "" : String(value)}
      disabled={disabled}
      onChange={(event) =>
        change(event.target.value === "" ? null : event.target.value === "true")
      }
    >
      <option value="">Choose treatment</option>
      <option value="true">Taxable</option>
      <option value="false">Non-taxable (no added VAT or services EWT)</option>
    </select>
  );
}

export function CalculationSummary({
  calculation,
  review,
}: {
  calculation: QuotationCalculation;
  review: FinancialReview;
}) {
  return (
    <>
      <dl className="quotation-calculation-totals">
        <div>
          <dt>Materials after line discounts</dt>
          <dd>{php(calculation.materials)}</dd>
        </div>
        <div>
          <dt>Subtotal before added VAT</dt>
          <dd>{php(calculation.subtotal)}</dd>
        </div>
        <div>
          <dt>
            {review.priceBasis === "inclusive"
              ? "VAT included (aggregate)"
              : "VAT added / component rounding"}
          </dt>
          <dd>{php(calculation.vat)}</dd>
        </div>
        <div>
          <dt>Gross quotation amount</dt>
          <dd>{php(calculation.gross)}</dd>
        </div>
        <div>
          <dt>Goods EWT</dt>
          <dd>{php(calculation.ewtGoods)}</dd>
        </div>
        <div>
          <dt>Services EWT</dt>
          <dd>{php(calculation.ewtServices)}</dd>
        </div>
        <div>
          <dt>Net after EWT</dt>
          <dd>{php(calculation.net)}</dd>
        </div>
      </dl>
      {!!calculation.comparisons.length && (
        <div className="quotation-source-table">
          <table>
            <caption>Printed amounts and their reviewed basis</caption>
            <thead>
              <tr>
                <th>Source amount</th>
                <th>Basis</th>
                <th>Printed</th>
                <th>Calculated</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {calculation.comparisons.map((row, index) => (
                <tr key={`${row.label}-${index}`}>
                  <td>{row.label}</td>
                  <td>{row.basis}</td>
                  <td>{php(row.printed)}</td>
                  <td>{php(row.calculated)}</td>
                  <td>{row.matches ? "Exact match" : "Resolve difference"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <details>
        <summary>Calculation bases and rounding</summary>
        <p>
          Amounts use exact decimal arithmetic and half-up cents at the recorded
          stages. Document percentages independently use the material subtotal
          after line discounts. Document discounts leave goods and services EWT
          bases unchanged.
        </p>
        <p>
          Taxable service charges receive services EWT. Non-taxable services
          receive neither added VAT nor services EWT. A separate VAT summary is
          counted once.
        </p>
      </details>
    </>
  );
}

function SavedClassifications({
  review,
  quote,
}: {
  review: FinancialReview | null;
  quote: QuotationDraft;
}) {
  if (!review) return <p>No financial settings have been saved.</p>;
  return (
    <>
      <p>
        PHP · {review.vatStatus || "VAT status unrecorded"} ·{" "}
        {review.priceBasis || "Price basis unrecorded"} · VAT rate{" "}
        {review.vatRate || "unrecorded"}.
      </p>
      <ul>
        {review.rows.map((row) => (
          <li key={row.id}>
            {quote.body.lines.find((line) => line.id === row.id)?.description ||
              "Removed source row"}
            : {roleLabels[row.role]}; line discount {row.discountType};{" "}
            {row.free ? "free item confirmed; " : ""}
            {row.reason}
          </li>
        ))}
      </ul>
      <ul>
        {review.adjustments.map((row) => (
          <li key={row.id}>
            {quote.body.adjustments.find((source) => source.id === row.id)
              ?.label || "Removed source adjustment"}
            : {row.kind || "unclassified"};{" "}
            {row.calculation || "basis unrecorded"};{" "}
            {row.taxable === null
              ? "tax treatment unrecorded"
              : row.taxable
                ? "taxable"
                : "non-taxable"}
            . {row.reason}
          </li>
        ))}
      </ul>
    </>
  );
}

function SourceDifferences({
  before,
  after,
}: {
  before: QuotationDraft;
  after: QuotationDraft;
}) {
  const changes: { label: string; before: string; after: string }[] = [];
  for (const key of Object.keys(
    HEADER_FIELDS,
  ) as (keyof typeof HEADER_FIELDS)[])
    if (before.body[key] !== after.body[key])
      changes.push({
        label: HEADER_FIELDS[key],
        before: before.body[key],
        after: after.body[key],
      });
  for (const line of after.body.lines) {
    const previous = before.body.lines.find((row) => row.id === line.id);
    if (!previous)
      changes.push({
        label: `Added source row: ${line.description || "Untitled"}`,
        before: "Not present",
        after: `${line.quantity} ${line.unit} at ${line.unitPrice}`,
      });
    else
      for (const key of Object.keys(
        LINE_FIELDS,
      ) as (keyof typeof LINE_FIELDS)[])
        if (previous[key] !== line[key])
          changes.push({
            label: `${line.description || "Source row"}: ${LINE_FIELDS[key]}`,
            before: previous[key],
            after: line[key],
          });
  }
  for (const line of before.body.lines)
    if (!after.body.lines.some((row) => row.id === line.id))
      changes.push({
        label: "Removed source row",
        before: line.description,
        after: "Removed",
      });
  if (
    JSON.stringify(before.body.adjustments) !==
    JSON.stringify(after.body.adjustments)
  )
    changes.push({
      label: "Source adjustments",
      before: before.body.adjustments
        .map(
          (row) => `${row.label}: ${row.value} (${row.basis}; ${row.taxable})`,
        )
        .join("; "),
      after: after.body.adjustments
        .map(
          (row) => `${row.label}: ${row.value} (${row.basis}; ${row.taxable})`,
        )
        .join("; "),
    });
  if (before.fileVersion !== after.fileVersion)
    changes.push({
      label: "Supplier originals",
      before: before.files.map((file) => file.name).join(", "),
      after: after.files.map((file) => file.name).join(", "),
    });
  return changes.length ? (
    <ul>
      {changes.map((change, index) => (
        <li key={index}>
          <strong>{change.label}</strong>: {change.before || "Not recorded"} →{" "}
          {change.after || "Not recorded"}
        </li>
      ))}
    </ul>
  ) : (
    <p>
      The source amounts are unchanged. Review saved classifications and renewed
      confirmations below.
    </p>
  );
}

function RevisionActions({
  quote,
  view,
}: {
  quote: QuotationDraft;
  view: QuotationsView;
}) {
  const operation = useQuoteOperation(),
    router = useRouter();
  const [action, setAction] = useState<
    "startRevision" | "withdraw" | "reconfirmMrf" | "activateRevision" | null
  >(null);
  const [reason, setReason] = useState("");
  const revision = quote.revision,
    family = quote.family;
  if (!revision || !family) return null;
  const writer = view.role === "Procurement";
  const labels = {
    startRevision: "Start quotation revision",
    withdraw: "Withdraw this revision",
    reconfirmMrf: "Reconfirm current MRF",
    activateRevision: "Recheck and activate revision",
  };
  return (
    <section
      className="panel quotation-revision"
      aria-labelledby="quotation-revision-heading"
    >
      <h2 id="quotation-revision-heading">
        Finalized revision {revision.number}
      </h2>
      <p>
        {revision.finalizedBy} / Procurement ·{" "}
        {new Date(revision.finalizedAt).toLocaleString("en-PH", {
          timeZone: "Asia/Manila",
        })}
      </p>
      <p>
        <strong>
          {revision.withdrawn
            ? "Withdrawn permanently"
            : revision.eligible
              ? "Current and eligible"
              : revision.current
                ? "Current revision — use paused"
                : family.pendingQuoteId === quote.id
                  ? "Replacement awaiting archive or eligibility"
                  : "Retained historical revision"}
        </strong>
      </p>
      {!!revision.blockers.length && (
        <ul>
          {revision.blockers.map((blocker) => (
            <li key={blocker}>{blocker}</li>
          ))}
        </ul>
      )}
      <p>
        Archive: {revision.archiveState}
        {revision.archiveMessage ? `. ${revision.archiveMessage}` : ""}
      </p>
      {revision.pdfAvailable && (
        <div className="form-actions">
          <a
            className="button secondary"
            href={`/api/quotation-revisions/${revision.id}/review`}
            target="_blank"
            rel="noreferrer"
          >
            Preview internal review PDF
          </a>
          <a
            className="button secondary"
            href={`/api/quotation-revisions/${revision.id}/review?download=1`}
          >
            Download internal review PDF
          </a>
        </div>
      )}
      {writer && (
        <div className="form-actions">
          {!family.pendingQuoteId && view.request?.procurementReady && (
            <button
              className="button secondary"
              disabled={operation.busy}
              onClick={() => {
                setAction("startRevision");
                setReason("");
              }}
            >
              Start revision
            </button>
          )}
          {!revision.withdrawn && (
            <button
              className="button secondary"
              disabled={operation.busy}
              onClick={() => {
                setAction("withdraw");
                setReason("");
              }}
            >
              Withdraw revision
            </button>
          )}
          {!revision.withdrawn &&
            family.currentMrfArchiveId &&
            revision.blockers.some((blocker) =>
              blocker.includes("reconfirm applicability"),
            ) && (
              <button
                className="button secondary"
                disabled={operation.busy}
                onClick={() => {
                  setAction("reconfirmMrf");
                  setReason("");
                }}
              >
                Review corrected MRF
              </button>
            )}
          {!revision.withdrawn &&
            revision.pdfAvailable &&
            family.pendingQuoteId === quote.id &&
            family.currentMrfArchiveId && (
              <button
                className="button primary"
                disabled={operation.busy}
                onClick={() => {
                  setAction("activateRevision");
                  setReason("");
                }}
              >
                Recheck and activate
              </button>
            )}
          {["failed", "paused"].includes(revision.archiveState) && (
            <button
              className="button secondary"
              disabled={operation.busy}
              onClick={() =>
                operation.run({
                  type: "retryArchive",
                  quoteId: quote.id,
                  expectedVersion: quote.version,
                  expectedFamily: family.version,
                })
              }
            >
              Retry quotation archive
            </button>
          )}
        </div>
      )}
      {family.pendingQuoteId && family.pendingQuoteId !== quote.id && (
        <p>
          <Link
            href={`/requests/${quote.mrfId}/quotes/${family.pendingQuoteId}`}
          >
            Open the unfinished replacement
          </Link>
          . The current offer remains available while eligible.
        </p>
      )}
      <InlineError message={operation.error} />
      {operation.notice && <p role="status">{operation.notice}</p>}
      {action && (
        <RecordModal
          open
          title={labels[action]}
          onClose={() => {
            if (!operation.busy) setAction(null);
          }}
        >
          <form
            className="form-stack"
            onSubmit={async (event) => {
              event.preventDefault();
              const base = {
                quoteId: quote.id,
                expectedVersion: quote.version,
                expectedFamily: family.version,
                reason,
              };
              const result = await operation.run(
                action === "reconfirmMrf" || action === "activateRevision"
                  ? {
                      ...base,
                      type: action,
                      expectedMrf: family.currentMrfArchiveId || "",
                    }
                  : { ...base, type: action },
              );
              if (result?.ok) {
                setAction(null);
                if (action === "startRevision" && result.quoteId)
                  router.push(
                    `/requests/${quote.mrfId}/quotes/${result.quoteId}`,
                  );
              }
            }}
          >
            {action === "withdraw" ? (
              <p>
                Withdrawal is permanent for this revision. It retains all files
                and history, releases an unfinished replacement slot and never
                restores an older offer automatically. Restoring an offer
                requires a new revision.
              </p>
            ) : action === "startRevision" ? (
              <p>
                Copy the captured offer and retained originals into one
                replacement draft. Source, match and financial confirmations
                must be renewed. The current eligible offer remains available
                until its replacement is archived and eligible.
              </p>
            ) : (
              <p>
                Review the exact current MRF and supplier offer before
                confirming continued applicability. This records your review
                without changing the frozen financial snapshot. A changed offer
                requires a new revision.
              </p>
            )}
            {(action === "reconfirmMrf" || action === "activateRevision") && (
              <Link href={`/requests/${quote.mrfId}`} target="_blank">
                Open current MRF and approved documents
              </Link>
            )}
            <Field
              label={
                action === "reconfirmMrf" || action === "activateRevision"
                  ? "Review conclusion and reason"
                  : "Reason"
              }
            >
              <textarea
                name="revisionReason"
                required
                minLength={5}
                maxLength={2000}
                value={reason}
                disabled={operation.busy}
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>
            <InlineError message={operation.error} />
            <button className="button primary" disabled={operation.busy}>
              {operation.busy ? "Saving…" : labels[action]}
            </button>
          </form>
        </RecordModal>
      )}
    </section>
  );
}

export function QuotationFinancialReview({
  quote,
  view,
  sourceDirty,
}: {
  quote: QuotationDraft;
  view: QuotationsView;
  sourceDirty: boolean;
}) {
  const [basis, setBasis] = useState(quote);
  const [review, setReview] = useState<FinancialReview>(
    () => quote.financial?.review || emptyFinancialReview(quote.body),
  );
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const operation = useQuoteOperation();
  const financial = quote.financial,
    family = quote.family;
  const editable =
    view.role === "Procurement" &&
    quote.state === "draft" &&
    !!view.request?.procurementReady;
  const dirty =
    JSON.stringify(review) !==
    JSON.stringify(basis.financial?.review || emptyFinancialReview(basis.body));
  const stale =
    basis.contentVersion !== quote.contentVersion ||
    basis.state !== quote.state ||
    basis.fileVersion !== quote.fileVersion ||
    basis.financial?.version !== financial?.version;
  const calculation = calculateQuotation(
    quote.body,
    reconcileFinancialRows(review, quote.body),
  );
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const readiness = [
    ...quotationHeaderIssues(quote.body, today),
    ...calculation.issues,
  ];
  if (!quote.checked)
    readiness.push(
      "Save and check the source data against verified originals.",
    );
  if (quote.groups.length)
    readiness.push("Complete or explicitly cancel original-file changes.");
  if (!family?.supplierActive) readiness.push("The supplier is inactive.");
  const included = review.rows.filter((row) => row.role === "material");
  const linked = included.filter(
    (row) => quote.body.lines.find((line) => line.id === row.id)?.requestItemId,
  );
  if (!linked.length)
    readiness.push("Match and confirm at least one material from the MRF.");
  if (linked.some((row) => !quote.matches.includes(row.id)))
    readiness.push(
      "Confirm each linked material match for the current source and originals.",
    );
  if (!financial?.checked)
    readiness.push(
      "Confirm the current saved financial review, including PHP treatment.",
    );
  if (dirty) readiness.push("Save your financial review changes.");
  if (sourceDirty)
    readiness.push(
      "Save or discard your source changes above before confirming or finalizing.",
    );
  if (stale)
    readiness.push(
      "Review the newer saved source or financial settings before continuing.",
    );
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  if (!financial || !family) return null;
  const updateRow = (id: string, patch: Partial<FinancialRow>) =>
    setReview((current) => ({
      ...current,
      rows: current.rows.map((row) =>
        row.id === id ? { ...row, ...patch } : row,
      ),
    }));
  const updateAdjustment = (id: string, patch: Partial<FinancialAdjustment>) =>
    setReview((current) => ({
      ...current,
      adjustments: current.adjustments.map((row) =>
        row.id === id ? { ...row, ...patch } : row,
      ),
    }));
  const adopt = (saved: QuotationDraft) => {
    setBasis(saved);
    setReview(saved.financial?.review || emptyFinancialReview(saved.body));
    operation.reviewed();
  };
  return (
    <>
      <section
        className="panel quotation-financial-review"
        aria-labelledby="financial-review-heading"
      >
        <h2 id="financial-review-heading">Financial review</h2>
        <p>
          PHP only. Review source classifications and calculations before
          finalizing. Saving financial settings preserves captured source text
          and supplier originals.
        </p>
        {quote.state === "draft" && view.role === "Procurement" ? (
          <>
            {(stale || operation.conflict) && (
              <section
                className="quotation-conflict"
                aria-label="Financial review conflict"
              >
                <h3>Review newer saved information</h3>
                <p>
                  Your classifications are preserved. Another source, file or
                  financial change requires a fresh review before saving.
                </p>
                <details>
                  <summary>Compare saved changes</summary>
                  <SourceDifferences before={basis} after={quote} />
                  <h4>Latest saved financial settings</h4>
                  <SavedClassifications
                    review={financial.review}
                    quote={quote}
                  />
                  <h4>Your current classifications</h4>
                  <SavedClassifications review={review} quote={quote} />
                </details>
                <button
                  type="button"
                  className="button secondary"
                  disabled={operation.busy}
                  onClick={() => {
                    setBasis(quote);
                    setReview(reconcileFinancialRows(review, quote.body));
                    operation.reviewed();
                  }}
                >
                  Keep my classifications with reviewed source
                </button>
                <button
                  type="button"
                  className="button secondary"
                  disabled={operation.busy}
                  onClick={() => adopt(quote)}
                >
                  Use saved financial settings
                </button>
              </section>
            )}
            <form
              className="form-stack"
              onSubmit={async (event) => {
                event.preventDefault();
                const result = await operation.run({
                  type: "saveFinancial",
                  quoteId: quote.id,
                  expectedVersion: quote.version,
                  expectedFiles: basis.fileVersion,
                  review,
                });
                if (result?.ok && result.quote) adopt(result.quote);
              }}
            >
              <fieldset disabled={!editable || operation.busy}>
                <legend>Reviewed financial basis</legend>
                <div className="quotation-financial-fields">
                  <Field label="Currency">
                    <input value="PHP" readOnly />
                  </Field>
                  <Field label="VAT classification">
                    <select
                      name="reviewVatStatus"
                      value={review.vatStatus}
                      onChange={(event) =>
                        setReview({
                          ...review,
                          vatStatus: event.target
                            .value as FinancialReview["vatStatus"],
                        })
                      }
                    >
                      <option value="">Choose classification</option>
                      <option value="VAT">VAT</option>
                      <option value="NON-VAT">NON-VAT</option>
                    </select>
                  </Field>
                  <Field label="Price basis">
                    <select
                      name="reviewPriceBasis"
                      value={review.priceBasis}
                      onChange={(event) =>
                        setReview({
                          ...review,
                          priceBasis: event.target
                            .value as FinancialReview["priceBasis"],
                        })
                      }
                    >
                      <option value="">Choose basis</option>
                      <option value="inclusive">VAT inclusive</option>
                      <option value="exclusive">VAT exclusive</option>
                    </select>
                  </Field>
                  <Field label="Reviewed VAT rate (%)">
                    <input
                      name="reviewVatRate"
                      inputMode="decimal"
                      value={review.vatRate}
                      disabled={review.vatStatus !== "VAT"}
                      onChange={(event) =>
                        setReview({ ...review, vatRate: event.target.value })
                      }
                    />
                  </Field>
                  <Field label="Printed subtotal represents">
                    <select
                      name="reviewSubtotalBasis"
                      value={review.subtotalBasis}
                      onChange={(event) =>
                        setReview({
                          ...review,
                          subtotalBasis: event.target
                            .value as FinancialReview["subtotalBasis"],
                        })
                      }
                    >
                      <option value="materials">
                        Materials after line discounts
                      </option>
                      <option value="subtotal">
                        Subtotal including adjustments before added VAT
                      </option>
                    </select>
                  </Field>
                  <Field label="Printed total represents">
                    <select
                      name="reviewTotalBasis"
                      value={review.totalBasis}
                      onChange={(event) =>
                        setReview({
                          ...review,
                          totalBasis: event.target
                            .value as FinancialReview["totalBasis"],
                        })
                      }
                    >
                      <option value="gross">Gross before EWT</option>
                      <option value="net">Net after EWT</option>
                    </select>
                  </Field>
                </div>
              </fieldset>
              <h3>Classify offered source rows</h3>
              {!quote.body.lines.length && (
                <p>
                  Add offered source rows above before reviewing their financial
                  treatment.
                </p>
              )}
              {quote.body.lines.map((source, index) => {
                const row = review.rows.find((value) => value.id === source.id);
                if (!row)
                  return (
                    <p key={source.id}>
                      Review the newly added source row before classifying it.
                    </p>
                  );
                const excluded =
                  row.role === "summary" || row.role === "reference";
                return (
                  <details
                    key={row.id}
                    className="quotation-financial-row"
                    data-financial-row={row.id}
                    open={index === 0}
                  >
                    <summary>
                      Line {index + 1}:{" "}
                      {source.description || "Description not recorded"} ·{" "}
                      {roleLabels[row.role]}
                    </summary>
                    <p>
                      Source: {source.quantity || "quantity unrecorded"}{" "}
                      {source.unit} at {source.unitPrice || "price unrecorded"}.{" "}
                      {source.requestItemId
                        ? "Linked to an MRF material."
                        : "Unmatched extra / alternative."}
                    </p>
                    <div className="quotation-financial-fields">
                      <Field label={`Line ${index + 1} classification`}>
                        <select
                          value={row.role}
                          disabled={!editable || operation.busy}
                          onChange={(event) =>
                            updateRow(row.id, {
                              role: event.target.value as FinancialRow["role"],
                            })
                          }
                        >
                          {Object.entries(roleLabels).map(([key, label]) => (
                            <option key={key} value={key}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </Field>
                      {!excluded && (
                        <Field label={`Line ${index + 1} discount basis`}>
                          <select
                            value={row.discountType}
                            disabled={!editable || operation.busy}
                            onChange={(event) =>
                              updateRow(row.id, {
                                discountType: event.target
                                  .value as FinancialRow["discountType"],
                              })
                            }
                          >
                            <option value="none">No line discount</option>
                            <option value="percentage">
                              Percentage of rounded line base
                            </option>
                            <option value="fixed">Fixed amount</option>
                          </select>
                        </Field>
                      )}
                      {!excluded && row.role !== "material" && (
                        <Field label={`Line ${index + 1} tax treatment`}>
                          <TaxSelect
                            value={row.taxable}
                            disabled={!editable || operation.busy}
                            change={(taxable) => updateRow(row.id, { taxable })}
                          />
                        </Field>
                      )}
                      {!excluded && (
                        <Field label={`Line ${index + 1} printed amount basis`}>
                          <select
                            value={row.printedBasis}
                            disabled={!editable || operation.busy}
                            onChange={(event) =>
                              updateRow(row.id, {
                                printedBasis: event.target
                                  .value as FinancialRow["printedBasis"],
                              })
                            }
                          >
                            <option value="input">
                              Amount before added VAT
                            </option>
                            <option value="contribution">
                              Contribution including added VAT
                            </option>
                          </select>
                        </Field>
                      )}
                      {row.role === "summary" && (
                        <>
                          <Field label={`Line ${index + 1} summary basis`}>
                            <BasisSelect
                              value={row.summaryBasis}
                              disabled={!editable || operation.busy}
                              change={(summaryBasis) =>
                                updateRow(row.id, { summaryBasis })
                              }
                            />
                          </Field>
                          <Field label="Source summary amount field">
                            <select
                              value={row.amountField}
                              disabled={!editable || operation.busy}
                              onChange={(event) =>
                                updateRow(row.id, {
                                  amountField: event.target
                                    .value as FinancialRow["amountField"],
                                })
                              }
                            >
                              <option value="printedTotal">
                                Printed line total
                              </option>
                              <option value="unitPrice">
                                Captured unit price field
                              </option>
                            </select>
                          </Field>
                        </>
                      )}
                      {row.role === "material" && (
                        <label className="quotation-free-confirmation">
                          <input
                            type="checkbox"
                            checked={row.free}
                            disabled={!editable || operation.busy}
                            onChange={(event) =>
                              updateRow(row.id, { free: event.target.checked })
                            }
                          />
                          This source item is explicitly free
                        </label>
                      )}
                      <Field
                        label={
                          excluded
                            ? `Line ${index + 1} exclusion reason`
                            : `Line ${index + 1} review note`
                        }
                      >
                        <textarea
                          value={row.reason}
                          maxLength={2000}
                          disabled={!editable || operation.busy}
                          onChange={(event) =>
                            updateRow(row.id, { reason: event.target.value })
                          }
                        />
                      </Field>
                    </div>
                  </details>
                );
              })}
              {!!quote.body.adjustments.length && (
                <h3>Classify source adjustments</h3>
              )}
              {quote.body.adjustments.map((source, index) => {
                const row = review.adjustments.find(
                  (value) => value.id === source.id,
                );
                if (!row)
                  return (
                    <p key={source.id}>
                      Review the newly added source adjustment.
                    </p>
                  );
                const excluded =
                  row.kind === "summary" || row.kind === "reference";
                return (
                  <details
                    key={row.id}
                    className="quotation-financial-row"
                    data-financial-adjustment={row.id}
                    open={index === 0}
                  >
                    <summary>
                      {source.label || `Adjustment ${index + 1}`} ·{" "}
                      {row.kind || "Choose classification"}
                    </summary>
                    <p>
                      Captured source value: {source.value || "Not recorded"};
                      basis: {source.basis || "Not recorded"}; tax treatment:{" "}
                      {source.taxable || "Not recorded"}.
                    </p>
                    <div className="quotation-financial-fields">
                      <Field label={`Adjustment ${index + 1} classification`}>
                        <select
                          value={row.kind}
                          disabled={!editable || operation.busy}
                          onChange={(event) =>
                            updateAdjustment(row.id, {
                              kind: event.target
                                .value as FinancialAdjustment["kind"],
                            })
                          }
                        >
                          {Object.entries(roleLabels)
                            .filter(([key]) => key !== "material")
                            .map(([key, label]) => (
                              <option key={key} value={key}>
                                {label}
                              </option>
                            ))}
                        </select>
                      </Field>
                      {!excluded && (
                        <>
                          <Field label={`Adjustment ${index + 1} calculation`}>
                            <select
                              value={row.calculation}
                              disabled={!editable || operation.busy}
                              onChange={(event) =>
                                updateAdjustment(row.id, {
                                  calculation: event.target
                                    .value as FinancialAdjustment["calculation"],
                                })
                              }
                            >
                              <option value="">Choose calculation</option>
                              <option value="fixed">Fixed amount</option>
                              <option value="percentage">
                                Percentage of material subtotal
                              </option>
                            </select>
                          </Field>
                          <Field
                            label={`Adjustment ${index + 1} tax treatment`}
                          >
                            <TaxSelect
                              value={row.taxable}
                              disabled={!editable || operation.busy}
                              change={(taxable) =>
                                updateAdjustment(row.id, { taxable })
                              }
                            />
                          </Field>
                        </>
                      )}
                      {row.kind === "summary" && (
                        <Field label={`Adjustment ${index + 1} summary basis`}>
                          <BasisSelect
                            value={row.summaryBasis}
                            disabled={!editable || operation.busy}
                            change={(summaryBasis) =>
                              updateAdjustment(row.id, { summaryBasis })
                            }
                          />
                        </Field>
                      )}
                      <Field
                        label={
                          excluded
                            ? `Adjustment ${index + 1} exclusion reason`
                            : `Adjustment ${index + 1} review note`
                        }
                      >
                        <textarea
                          value={row.reason}
                          maxLength={2000}
                          disabled={!editable || operation.busy}
                          onChange={(event) =>
                            updateAdjustment(row.id, {
                              reason: event.target.value,
                            })
                          }
                        />
                      </Field>
                    </div>
                  </details>
                );
              })}
              <button
                className="button secondary"
                disabled={!editable || operation.busy || stale}
              >
                {operation.busy ? "Saving…" : "Save financial review"}
              </button>
            </form>
            <h3>
              {dirty ? "Unsaved calculation preview" : "Saved calculation"}
            </h3>
            <CalculationSummary calculation={calculation} review={review} />
            {!!readiness.length && (
              <div className="quotation-readiness" role="status">
                <h3>Before finalizing</h3>
                <ul>
                  {[...new Set(readiness)].map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="form-actions">
              <button
                className="button secondary"
                disabled={
                  !editable ||
                  operation.busy ||
                  dirty ||
                  sourceDirty ||
                  stale ||
                  !financial.review ||
                  !quote.checked ||
                  quote.groups.length > 0 ||
                  calculation.issues.length > 0
                }
                onClick={async () => {
                  const result = await operation.run({
                    type: "checkFinancial",
                    quoteId: quote.id,
                    expectedVersion: quote.version,
                    expectedFiles: basis.fileVersion,
                    expectedFinancial: financial.version,
                  });
                  if (result?.ok && result.quote) adopt(result.quote);
                }}
              >
                Confirm saved financial review and PHP
              </button>
              <button
                className="button primary"
                disabled={!editable || operation.busy || readiness.length > 0}
                onClick={() => setFinalizeOpen(true)}
              >
                Finalize quotation revision
              </button>
            </div>
          </>
        ) : (
          <>
            <SavedClassifications review={financial.review} quote={quote} />
            {financial.calculation && financial.review ? (
              <CalculationSummary
                calculation={financial.calculation}
                review={financial.review}
              />
            ) : (
              <p>No financial calculation has been saved.</p>
            )}
          </>
        )}
        <InlineError message={operation.error} />
        {operation.notice && <p role="status">{operation.notice}</p>}
      </section>
      <RevisionActions quote={quote} view={view} />
      {finalizeOpen && quote.state === "draft" && (
        <RecordModal
          open
          title="Finalize quotation revision"
          onClose={() => {
            if (!operation.busy) setFinalizeOpen(false);
          }}
        >
          <div className="form-stack">
            <p>
              This freezes the saved source, financial calculation, material
              matches and supplier originals. Corrections require a new
              revision. Purchasing remains blocked until the internal review PDF
              archive completes and current eligibility checks pass.
            </p>
            <p>
              Supplier reference: <strong>{quote.body.ref}</strong>. Gross:{" "}
              <strong>{php(calculation.gross)}</strong>. Net after EWT:{" "}
              <strong>{php(calculation.net)}</strong>.
            </p>
            <p>
              {quote.files.length} supplier originals will be retained with this
              revision.
            </p>
            <InlineError message={operation.error} />
            <button
              className="button primary"
              disabled={!editable || operation.busy || readiness.length > 0}
              onClick={async () => {
                const result = await operation.run({
                  type: "finalize",
                  quoteId: quote.id,
                  expectedVersion: quote.version,
                  expectedFiles: basis.fileVersion,
                  expectedFinancial: financial.version,
                  expectedFamily: family.version,
                });
                if (result?.ok) setFinalizeOpen(false);
              }}
            >
              {operation.busy ? "Finalizing…" : "Finalize and archive revision"}
            </button>
          </div>
        </RecordModal>
      )}
    </>
  );
}

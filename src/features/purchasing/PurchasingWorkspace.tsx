"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useFoundationRealtime } from "@/src/app-state/FoundationRealtime";
import { PageHeader, Field, Badge } from "@/src/components/ui/Primitives";
import { RecordModal } from "@/src/components/ui/RecordModal";
import { demandTotals } from "@/src/domain/demand/quantities";
import {
  comparisonSnapshot,
  initialOrderBody,
  initialAdjustments,
  exactQuantity,
} from "@/src/domain/purchasing/pricing";
import { decimal, divide, php } from "@/src/domain/quotations/decimal";
import type {
  OrderBody,
  PurchasingCommand,
  PurchasingRecord,
  PurchasingView,
} from "@/src/domain/purchasing/contracts";
import { PO_FIELDS } from "@/src/domain/purchasing/contracts";
import { OrderEditor } from "./OrderEditor";
import { usePurchasingOperation } from "./use-purchasing-operation";
import "./purchasing.css";

type Base = { expectedVersion: string; expectedDemand: string };
type Editor = {
  id: string;
  quoteId: string;
  familyVersion: string;
  body: OrderBody;
  saved?: PurchasingRecord;
  base: Base;
  rebind: boolean;
};
type Decision = {
  type: "cancel" | "reopen" | "convert" | "checkPo";
  record: PurchasingRecord;
  reason: string;
  base: Base;
};
const stamp = (view: PurchasingView): Base => ({
  expectedVersion: view.version,
  expectedDemand: view.demandVersion,
});
const when = (value: string) =>
  new Date(value).toLocaleString("en-PH", { timeZone: "Asia/Manila" });
const historyLabels: Record<string, string> = {
  saveAward: "Supplier award saved",
  savePo: "PO draft saved",
  convert: "Award converted to PO",
  cancel: "Purchasing record cancelled",
  reopen: "Purchasing record reopened",
  rebind: "Supplier source rebound",
  checkPo: "Saved preparation confirmed",
  saveComparison: "Comparison version saved",
  retryArtifact: "Artifact retry requested",
  artifactComplete: "Comparison artifact archived",
};

function SavedRecord({
  record,
  view,
}: {
  record: PurchasingRecord;
  view: PurchasingView;
}) {
  const quote = view.quotations.quotes.find((q) => q.id === record.quoteId);
  return (
    <>
      <p>
        Quotation:{" "}
        <Link
          className="text-link"
          href={`/requests/${record.mrfId}/quotes/${record.quoteId}`}
        >
          {quote?.body.ref || "Retained source"} · revision{" "}
          {quote?.revision?.number}
        </Link>
      </p>
      <p>Supplier selection: {record.body.reason}</p>
      <div className="table-frame embedded">
        <table>
          <thead>
            <tr>
              <th>Material</th>
              <th>Offered quantity</th>
              <th>MRF quantity</th>
              <th>Fixed discount</th>
            </tr>
          </thead>
          <tbody>
            {record.body.lines.map((line) => (
              <tr key={line.id}>
                <td>
                  {
                    view.quotations.request?.items.find(
                      (i) => i.id === line.itemId,
                    )?.name
                  }
                  <small>
                    {
                      quote?.body.lines.find((l) => l.id === line.sourceLineId)
                        ?.description
                    }
                  </small>
                </td>
                <td>
                  {line.offeredQuantity}{" "}
                  {
                    quote?.body.lines.find((l) => l.id === line.sourceLineId)
                      ?.unit
                  }
                </td>
                <td>
                  {line.quantity}{" "}
                  {
                    view.quotations.request?.items.find(
                      (i) => i.id === line.itemId,
                    )?.unit
                  }
                </td>
                <td>
                  {line.fixedDiscount || "Not applicable / pending review"}
                  {line.fixedDiscount && (
                    <small>
                      {line.discountConfirmed ? "Confirmed" : "Unconfirmed"}
                    </small>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {record.blockers.length > 0 && (
        <ul>
          {record.blockers.map((blocker) => (
            <li key={blocker}>{blocker}</li>
          ))}
        </ul>
      )}
      {record.kind === "po" && (
        <>
          <p>
            {record.checked
              ? "Saved preparation confirmed"
              : "Preparation needs review"}
            . Accounting submission is not yet available.
          </p>
          {record.calculation && !record.calculation.issues.length ? (
            <p>
              Gross {php(record.calculation.gross)} · Net payable{" "}
              {php(record.calculation.net)}
            </p>
          ) : (
            <p>Pricing review is incomplete.</p>
          )}
          <details>
            <summary>Saved printed details and adjustments</summary>
            <dl className="mrf-draft-summary">
              {(Object.keys(PO_FIELDS) as (keyof typeof PO_FIELDS)[]).map(
                (key) => (
                  <div key={key}>
                    <dt>{PO_FIELDS[key]}</dt>
                    <dd>{record.body.fields[key] || "Not recorded"}</dd>
                  </div>
                ),
              )}
            </dl>
            {record.body.adjustments.map((a) => (
              <p key={`${a.sourceKind}-${a.id}`}>
                {a.sourceKind === "line"
                  ? quote?.body.lines.find((l) => l.id === a.id)?.description
                  : quote?.body.adjustments.find((s) => s.id === a.id)?.label}
                : {a.include ? `included, ${a.amount}` : "excluded"} ·{" "}
                {a.confirmed ? "confirmed" : "unconfirmed"}
                {a.reason ? ` · ${a.reason}` : ""}
              </p>
            ))}
          </details>
        </>
      )}
    </>
  );
}

export function PurchasingWorkspace({
  initial,
  poId,
}: {
  initial: PurchasingView;
  poId?: string;
}) {
  const live = useFoundationRealtime(),
    router = useRouter(),
    operation = usePurchasingOperation();
  const view =
    live.view?.kind === "purchasing" &&
    live.view.data.quotations.request?.id === initial.quotations.request?.id
      ? live.view.data
      : initial;
  const request = view.quotations.request;
  const [editor, setEditor] = useState<Editor | null>(null),
    [decision, setDecision] = useState<Decision | null>(null);
  const [quoteId, setQuoteId] = useState(""),
    [selections, setSelections] = useState<
      { itemId: string; quoteId: string; lineId: string }[]
    >([]);
  const [reportIdentity, setReportIdentity] = useState<{
    command: Omit<PurchasingCommand, "requestId">;
    requestId: string;
  } | null>(null);
  useEffect(() => {
    if (!editor) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [editor]);
  if (!request) return <p>MRF unavailable.</p>;
  const editable = view.role === "Procurement",
    eligible = view.quotations.quotes.filter((q) => q.revision?.eligible);
  const selectedQuote = view.quotations.quotes.find(
    (q) => q.id === (quoteId || eligible[0]?.id),
  );
  const selectedPo = poId
    ? view.records.find((r) => r.id === poId && r.kind === "po")
    : null;
  const currentEditorRecord = editor
    ? view.records.find((r) => r.id === editor.id)
    : null;
  const editorQuote = editor
    ? view.quotations.quotes.find((q) => q.id === editor.quoteId)
    : null;
  const stale =
    !!editor &&
    (editor.base.expectedVersion !== view.version ||
      editor.base.expectedDemand !== view.demandVersion ||
      editor.familyVersion !== editorQuote?.family?.version);
  let comparison = null,
    comparisonError = "";
  if (!poId)
    try {
      comparison = comparisonSnapshot(
        view,
        selections,
        "",
        new Date().toISOString(),
      );
    } catch (error) {
      comparisonError =
        error instanceof Error
          ? error.message
          : "Review comparison selections.";
    }
  const openEditor = (record?: PurchasingRecord) => {
    const quote = view.quotations.quotes.find(
      (q) => q.id === (record?.quoteId || selectedQuote?.id),
    );
    if (!quote?.family) return;
    operation.reviewed();
    setEditor({
      id: record?.id || crypto.randomUUID(),
      quoteId: quote.id,
      familyVersion: quote.family.version,
      body: structuredClone(record?.body || initialOrderBody(quote)),
      saved: record,
      base: stamp(view),
      rebind: false,
    });
  };
  const changeQuote = (id: string) => {
    const next = view.quotations.quotes.find((q) => q.id === id);
    if (!editor || !next?.family) return;
    setEditor({
      ...editor,
      quoteId: id,
      familyVersion: next.family.version,
      rebind: !!editor.saved && editor.saved.quoteId !== id,
      body: {
        ...editor.body,
        adjustments: initialAdjustments(next),
        lines: editor.body.lines.map((line) => {
          const same = next.body.lines.find(
            (l) =>
              l.id === line.sourceLineId &&
              l.requestItemId === line.itemId &&
              next.matches.includes(l.id),
          );
          let offered = "";
          if (same)
            try {
              offered = exactQuantity(
                divide(decimal(line.quantity), decimal(same.conversionFactor)),
              );
            } catch {}
          return {
            ...line,
            sourceLineId: same?.id || "",
            offeredQuantity: offered,
            fixedDiscount: "",
            discountConfirmed: false,
          };
        }),
      },
    });
  };
  const saveEditor = async () => {
    if (!editor || !editorQuote?.family) return;
    const result = await operation.run({
      type: editor.rebind
        ? "rebind"
        : editor.saved?.kind === "po"
          ? "savePo"
          : "saveAward",
      mrfId: request.id,
      targetId: editor.id,
      ...editor.base,
      quoteId: editor.quoteId,
      expectedFamily: editor.familyVersion,
      body: editor.body,
    });
    if (result?.ok) setEditor(null);
  };
  const act = (type: Decision["type"], record: PurchasingRecord) => {
    operation.reviewed();
    setDecision({ type, record, reason: "", base: stamp(view) });
  };
  const runDecision = async () => {
    if (!decision) return;
    const result = await operation.run({
      type: decision.type,
      mrfId: request.id,
      targetId: decision.record.id,
      ...decision.base,
      reason: decision.reason,
    });
    if (result?.ok) {
      setDecision(null);
      if (decision.type === "convert")
        router.push(`/purchase-orders/${result.targetId}`);
    }
  };
  const saveComparison = async () => {
    const pending = reportIdentity ?? {
      command: {
        type: "saveComparison",
        mrfId: request.id,
        targetId: crypto.randomUUID(),
        ...stamp(view),
        selections,
        sources: eligible.map((q) => ({
          quoteId: q.id,
          familyVersion: q.family!.version,
        })),
      },
      requestId: crypto.randomUUID(),
    };
    setReportIdentity(pending);
    const result = await operation.run(pending.command, pending.requestId);
    if (result?.ok) setReportIdentity(null);
  };
  const recordActions = (record: PurchasingRecord) =>
    editable &&
    record.state !== "converted" && (
      <div className="button-row">
        <button
          className="button secondary"
          disabled={operation.busy}
          onClick={() => openEditor(record)}
        >
          {record.state === "cancelled"
            ? "Review / rebind source"
            : "Edit saved preparation"}
        </button>
        {record.state === "active" ? (
          <>
            <button
              className="button secondary"
              disabled={operation.busy}
              onClick={() => act("cancel", record)}
            >
              Cancel {record.kind === "po" ? "PO draft" : "award"}
            </button>
            {record.kind === "award" ? (
              <button
                className="button primary"
                disabled={operation.busy || !!record.blockers.length}
                onClick={() => act("convert", record)}
              >
                Create PO draft
              </button>
            ) : (
              <button
                className="button primary"
                disabled={operation.busy || !!record.blockers.length}
                onClick={() => act("checkPo", record)}
              >
                Confirm saved preparation
              </button>
            )}
          </>
        ) : (
          <button
            className="button primary"
            disabled={operation.busy}
            onClick={() => act("reopen", record)}
          >
            Reopen with checks
          </button>
        )}
      </div>
    );
  return (
    <div className="purchasing-workspace">
      <Link
        className="back-link"
        href={
          poId
            ? `/requests/${request.id}/purchasing`
            : `/requests/${request.id}`
        }
      >
        {poId ? "Back to comparisons and awards" : "Back to material request"}
      </Link>
      <PageHeader
        title={selectedPo?.ref || `${request.ref} · Purchasing`}
        description={
          poId
            ? "Saved PO draft preparation"
            : "Compare eligible offers, confirm supplier quantities and prepare PO drafts."
        }
        actions={
          <Link
            className="button secondary"
            href={`/requests/${request.id}/quotes`}
          >
            Supplier quotations
          </Link>
        }
      />
      {operation.error && !editor && !decision && (
        <p className="field-error" role="alert">
          {operation.error}
        </p>
      )}
      {operation.notice && <p role="status">{operation.notice}</p>}
      {!request.procurementReady && (
        <p role="status">
          The current approved MRF archive is unavailable. Existing allocations
          remain held; new purchasing preparation is paused.
        </p>
      )}
      {!poId && (
        <>
          <section className="panel">
            <h2>Demand and current offers</h2>
            <p className="helper-note">
              Remaining to purchase excludes POs, suitability holds and
              transfers. Unassigned also excludes saved supplier awards.
            </p>
            <div className="table-frame embedded">
              <table>
                <thead>
                  <tr>
                    <th>Material</th>
                    <th>Requested</th>
                    <th>To purchase</th>
                    <th>Unassigned</th>
                    <th>Sourcing</th>
                  </tr>
                </thead>
                <tbody>
                  {request.items.map((item) => {
                    if (
                      !item.quantity ||
                      (!request.procurementReady && !view.claims.length)
                    )
                      return (
                        <tr key={item.id}>
                          <td>
                            {item.name}
                            <small>{item.unit}</small>
                          </td>
                          <td>{item.quantity || "Not recorded"}</td>
                          <td>Unavailable</td>
                          <td>Unavailable</td>
                          <td>Approved demand basis required</td>
                        </tr>
                      );
                    const total = demandTotals(
                      item.quantity || "0",
                      view.claims.filter((c) => c.itemId === item.id),
                    );
                    return (
                      <tr key={item.id}>
                        <td>
                          {item.name}
                          <small>{item.unit}</small>
                        </td>
                        <td>{total.requested}</td>
                        <td>{total.purchase}</td>
                        <td>{total.unassigned}</td>
                        <td>
                          PO {total.ordered} · Awards {total.awarded} · Holds{" "}
                          {total.suitability} · Transfers {total.transfers}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {eligible.map((quote) => (
              <details key={quote.id}>
                <summary>
                  {quote.body.supplierName} · {quote.body.ref} · revision{" "}
                  {quote.revision?.number}
                </summary>
                <p>
                  Full quotation: gross {quote.financial?.calculation?.gross},
                  net {quote.financial?.calculation?.net} PHP. Actual
                  partial-order charges require separate review.
                </p>
                {request.items.map((item) => {
                  const matches = quote.body.lines.filter(
                    (l) =>
                      l.requestItemId === item.id &&
                      quote.matches.includes(l.id) &&
                      quote.financial?.review?.rows.some(
                        (r) => r.id === l.id && r.role === "material",
                      ),
                  );
                  if (matches.length < 2) return null;
                  return (
                    <Field
                      key={item.id}
                      label={`Comparison alternative: ${item.name}`}
                    >
                      <select
                        value={
                          selections.find(
                            (s) =>
                              s.quoteId === quote.id && s.itemId === item.id,
                          )?.lineId || ""
                        }
                        onChange={(e) =>
                          setSelections([
                            ...selections.filter(
                              (s) =>
                                !(
                                  s.quoteId === quote.id && s.itemId === item.id
                                ),
                            ),
                            {
                              quoteId: quote.id,
                              itemId: item.id,
                              lineId: e.target.value,
                            },
                          ])
                        }
                      >
                        <option value="">
                          Choose one offer for comparison
                        </option>
                        {matches.map((line) => (
                          <option key={line.id} value={line.id}>
                            {line.description} · {line.unit} · quoted{" "}
                            {line.quantity}
                          </option>
                        ))}
                      </select>
                    </Field>
                  );
                })}
              </details>
            ))}
            {comparisonError && <p role="status">{comparisonError}</p>}
            {comparison && (
              <div className="table-frame embedded">
                <table>
                  <thead>
                    <tr>
                      <th>Material</th>
                      {comparison.sources.map((s) => (
                        <th key={s.quoteId}>{s.supplierName}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.items.map((item) => (
                      <tr key={item.id}>
                        <td>
                          {item.name}
                          <small>
                            Per {item.unit}; VAT included where applicable
                          </small>
                        </td>
                        {comparison!.sources.map((source) => {
                          const offer = item.offers.find(
                            (o) => o.quoteId === source.quoteId,
                          );
                          return (
                            <td key={source.quoteId}>
                              {offer ? (
                                <>
                                  {`PHP ${offer.price}`}{" "}
                                  {offer.lowest && (
                                    <Badge value="Lowest material price" />
                                  )}
                                  <small>
                                    Comparison amount: {php(offer.amount)}
                                  </small>
                                  <small>
                                    Quoted capacity {offer.capacity} {item.unit}
                                    {!offer.sufficient &&
                                      " · Insufficient for remaining demand"}
                                  </small>
                                </>
                              ) : (
                                "No selected offer"
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {editable && (
              <div className="button-row">
                <button
                  className="button secondary"
                  disabled={operation.busy || (!comparison && !reportIdentity)}
                  onClick={() => void saveComparison()}
                >
                  {reportIdentity
                    ? "Retry comparison save"
                    : "Save comparison PDF / XLSX version"}
                </button>
                {reportIdentity && operation.error && (
                  <button
                    className="button ghost"
                    disabled={operation.busy}
                    onClick={() => {
                      setReportIdentity(null);
                      operation.reviewed();
                    }}
                  >
                    Review latest comparison basis
                  </button>
                )}
              </div>
            )}
          </section>
          {editable && (
            <section className="panel">
              <h2>Confirm supplier awards</h2>
              <p>
                Choose quantities explicitly. Saving an award allocates demand
                immediately; it does not reserve a budget.
              </p>
              <Field label="Eligible supplier quotation">
                <select
                  value={selectedQuote?.id || ""}
                  onChange={(e) => setQuoteId(e.target.value)}
                >
                  <option value="">Choose eligible quotation</option>
                  {eligible.map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.body.supplierName} · {q.body.ref} · r
                      {q.revision?.number}
                    </option>
                  ))}
                </select>
              </Field>
              {selectedQuote &&
              view.records.some(
                (r) =>
                  r.state === "active" &&
                  r.supplierId === selectedQuote.supplierId,
              ) ? (
                <p>
                  An active award or PO exists for this supplier. Edit it below.
                </p>
              ) : (
                <button
                  className="button primary"
                  disabled={
                    operation.busy || !selectedQuote?.revision?.eligible
                  }
                  onClick={() => openEditor()}
                >
                  Prepare supplier award
                </button>
              )}
            </section>
          )}
        </>
      )}
      {(poId ? (selectedPo ? [selectedPo] : []) : view.records).map(
        (record) => (
          <section className="panel" key={record.id}>
            <div className="panel-heading">
              <h2>
                {record.ref ||
                  `${view.quotations.quotes.find((q) => q.id === record.quoteId)?.body.supplierName || "Supplier"} award`}
              </h2>
              <Badge value={record.state} />
            </div>
            <SavedRecord record={record} view={view} />
            {record.kind === "po" && (
              <div className="button-row">
                <Link
                  className="button secondary"
                  href={`/purchase-orders/${record.id}`}
                >
                  Open PO draft
                </Link>
                <a
                  className="button secondary"
                  href={`/api/purchase-order-drafts/${record.id}/preview?version=${record.version}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Preview saved PO
                </a>
              </div>
            )}
            {recordActions(record)}
          </section>
        ),
      )}
      {!poId && (
        <section className="panel">
          <h2>Saved comparison versions</h2>
          {!view.reports.length && <p>No comparison version saved.</p>}
          {view.reports.map((report) => (
            <div className="subform" key={report.id}>
              <h3>Version {report.version}</h3>
              <p>{when(report.createdAt)}</p>
              {report.artifacts.map((artifact) => (
                <div className="button-row" key={artifact.id}>
                  <strong>{artifact.format.toUpperCase()}</strong>
                  <Badge value={artifact.state} />
                  {artifact.message && <span>{artifact.message}</span>}
                  {artifact.state === "complete" ? (
                    <a
                      className="button secondary"
                      href={`/api/comparison-artifacts/${artifact.id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open {artifact.format.toUpperCase()}
                    </a>
                  ) : (
                    editable &&
                    ["failed", "paused"].includes(artifact.state) && (
                      <button
                        className="button secondary"
                        disabled={operation.busy}
                        onClick={() =>
                          void operation.run({
                            type: "retryArtifact",
                            mrfId: request.id,
                            targetId: artifact.id,
                            ...stamp(view),
                          })
                        }
                      >
                        Retry {artifact.format.toUpperCase()}
                      </button>
                    )
                  )}
                </div>
              ))}
            </div>
          ))}
        </section>
      )}
      <section className="panel">
        <h2>Purchasing history</h2>
        {!view.history.length && <p>No purchasing changes recorded.</p>}
        {view.history.map((event) => (
          <div className="subform" key={event.id}>
            <strong>
              {historyLabels[event.action.replace("purchasing.", "")] ||
                "Purchasing record updated"}
            </strong>
            <p>
              {event.actorName} · {event.actorRole} · {when(event.at)}
            </p>
            {typeof event.details.reason === "string" && (
              <p>{event.details.reason}</p>
            )}
          </div>
        ))}
      </section>
      <RecordModal
        open={!!editor}
        title={
          editor?.saved?.kind === "po"
            ? "Edit PO draft preparation"
            : "Prepare supplier award"
        }
        onClose={() => {
          if (
            !operation.busy &&
            (!editor || window.confirm("Discard these unsaved order changes?"))
          )
            setEditor(null);
        }}
      >
        {editor && editorQuote && (
          <>
            <OrderEditor
              body={editor.body}
              quote={editorQuote}
              quotations={view.quotations}
              saved={editor.saved}
              po={editor.saved?.kind === "po"}
              disabled={operation.busy}
              setBody={(body) => setEditor({ ...editor, body })}
              setQuote={changeQuote}
            />
            {(stale || operation.conflict) && (
              <section className="subform">
                <h3>Latest saved values</h3>
                {currentEditorRecord ? (
                  <SavedRecord record={currentEditorRecord} view={view} />
                ) : (
                  <p>
                    No saved record with this identity yet. Review current
                    demand and eligible sources above.
                  </p>
                )}
                <p>
                  Your input is preserved. Reconcile it with this saved version
                  before saving.
                </p>
                <button
                  className="button secondary"
                  disabled={operation.busy}
                  onClick={() => {
                    operation.reviewed();
                    setEditor({
                      ...editor,
                      base: stamp(view),
                      familyVersion: editorQuote.family?.version || "0",
                      saved: currentEditorRecord || editor.saved,
                    });
                  }}
                >
                  I reviewed the latest saved version
                </button>
              </section>
            )}
            {operation.error && (
              <p className="field-error" role="alert">
                {operation.error}
              </p>
            )}
            <div className="form-actions">
              <button
                className="button primary"
                disabled={
                  operation.busy ||
                  stale ||
                  operation.conflict ||
                  !editor.body.lines.length ||
                  editor.body.reason.trim().length < 5 ||
                  (editor.saved?.state === "cancelled" && !editor.rebind)
                }
                onClick={() => void saveEditor()}
              >
                {operation.busy
                  ? "Saving…"
                  : editor.rebind
                    ? "Save reviewed source rebind"
                    : "Save preparation"}
              </button>
            </div>
          </>
        )}
      </RecordModal>
      <RecordModal
        open={!!decision}
        title={
          decision?.type === "convert"
            ? "Create PO from the whole supplier award"
            : decision?.type === "checkPo"
              ? "Confirm saved PO preparation"
              : `${decision?.type === "reopen" ? "Reopen" : "Cancel"} purchasing record`
        }
        onClose={() => {
          if (!operation.busy) setDecision(null);
        }}
      >
        {decision && (
          <>
            <SavedRecord record={decision.record} view={view} />
            {decision.type === "cancel" && (
              <p>
                Cancellation releases this record&apos;s demand. A cancelled PO
                does not recreate supplier awards.
              </p>
            )}
            {decision.type === "convert" && (
              <p>
                All saved quantities for this supplier move to one numbered
                draft in a single transaction.
              </p>
            )}
            {["cancel", "reopen"].includes(decision.type) && (
              <Field label="Reason (at least five characters)">
                <textarea
                  value={decision.reason}
                  maxLength={2000}
                  disabled={operation.busy}
                  onChange={(e) =>
                    setDecision({ ...decision, reason: e.target.value })
                  }
                />
              </Field>
            )}
            {(decision.base.expectedVersion !== view.version ||
              decision.base.expectedDemand !== view.demandVersion ||
              operation.conflict) && (
              <>
                <h3>Latest saved values</h3>
                {view.records.find((r) => r.id === decision.record.id) && (
                  <SavedRecord
                    record={
                      view.records.find((r) => r.id === decision.record.id)!
                    }
                    view={view}
                  />
                )}
                <button
                  className="button secondary"
                  onClick={() => {
                    operation.reviewed();
                    const current = view.records.find(
                      (r) => r.id === decision.record.id,
                    );
                    if (current)
                      setDecision({
                        ...decision,
                        record: current,
                        base: stamp(view),
                      });
                  }}
                >
                  I reviewed the latest saved version
                </button>
              </>
            )}
            {operation.error && (
              <p className="field-error" role="alert">
                {operation.error}
              </p>
            )}
            <div className="form-actions">
              <button
                className="button primary"
                disabled={
                  operation.busy ||
                  operation.conflict ||
                  decision.base.expectedVersion !== view.version ||
                  decision.base.expectedDemand !== view.demandVersion ||
                  (["cancel", "reopen"].includes(decision.type) &&
                    decision.reason.trim().length < 5)
                }
                onClick={() => void runDecision()}
              >
                Confirm{" "}
                {decision.type === "convert"
                  ? "PO creation"
                  : decision.type === "checkPo"
                    ? "saved preparation"
                    : decision.type}
              </button>
            </div>
          </>
        )}
      </RecordModal>
    </div>
  );
}

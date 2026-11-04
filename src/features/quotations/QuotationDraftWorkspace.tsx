"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import { quotationCommandAction } from "@/app/(workspace)/requests/[id]/quotes/actions";
import { useFoundationRealtime } from "@/src/app-state/FoundationRealtime";
import { Field, InlineError, PageHeader } from "@/src/components/ui/Primitives";
import { RecordModal } from "@/src/components/ui/RecordModal";
import { Register } from "@/src/components/ui/Register";
import {
  ADJUSTMENT_FIELDS,
  HEADER_FIELDS,
  LINE_FIELDS,
  emptyQuoteBody,
  emptyQuoteLine,
  parseQuoteBody,
  type QuoteBody,
  type QuoteHistory,
  type QuoteInput,
  type QuoteLine,
  type QuotationDraft,
  type QuotationsView,
} from "@/src/domain/quotations/drafts";
import { record } from "@/src/domain/projects/projects";
import { QuotationOriginals } from "./QuotationOriginals";

const subscribe = () => () => {};
type HeaderKey = keyof typeof HEADER_FIELDS;
type LineKey = keyof typeof LINE_FIELDS;
const supplierFields: HeaderKey[] = [
  "supplierName",
  "address",
  "tin",
  "contactName",
  "email",
  "phone",
];
const financialFields: HeaderKey[] = [
  "currency",
  "taxStatus",
  "priceBasis",
  "vatRate",
  "printedSubtotal",
  "printedTax",
  "printedTotal",
  "financialNotes",
];
const headerFields = (Object.keys(HEADER_FIELDS) as HeaderKey[]).filter(
  (key) => !supplierFields.includes(key) && !financialFields.includes(key),
);

function SavedSource({
  body,
  view,
}: {
  body: QuoteBody;
  view: QuotationsView;
}) {
  return (
    <div className="quotation-saved-source">
      <dl>
        {(Object.keys(HEADER_FIELDS) as HeaderKey[]).map((key) => (
          <div key={key}>
            <dt>{HEADER_FIELDS[key]}</dt>
            <dd>{body[key] || "Not recorded"}</dd>
          </div>
        ))}
      </dl>
      <h3>Offered materials</h3>
      {!body.lines.length && <p>No offered lines recorded.</p>}
      {body.lines.map((line, index) => (
        <details key={line.id}>
          <summary>
            Line {index + 1}: {line.description || "Description not recorded"}
          </summary>
          <dl>
            {(Object.keys(LINE_FIELDS) as LineKey[]).map((key) => (
              <div key={key}>
                <dt>{LINE_FIELDS[key]}</dt>
                <dd>{line[key] || "Not recorded"}</dd>
              </div>
            ))}
            <div>
              <dt>Requested material</dt>
              <dd>
                {view.request?.items.find(
                  (item) => item.id === line.requestItemId,
                )?.name || "Unmatched / extra offer"}
              </dd>
            </div>
          </dl>
        </details>
      ))}
      <h3>Source adjustments</h3>
      {!body.adjustments.length && <p>No source adjustments recorded.</p>}
      {body.adjustments.map((row, index) => (
        <details key={row.id}>
          <summary>
            Adjustment {index + 1}: {row.label || "Label not recorded"}
          </summary>
          <dl>
            {(
              Object.keys(
                ADJUSTMENT_FIELDS,
              ) as (keyof typeof ADJUSTMENT_FIELDS)[]
            ).map((key) => (
              <div key={key}>
                <dt>{ADJUSTMENT_FIELDS[key]}</dt>
                <dd>{row[key] || "Not recorded"}</dd>
              </div>
            ))}
          </dl>
        </details>
      ))}
    </div>
  );
}

const historyActions: Record<string, string> = {
  "quotation.create": "Created quotation draft",
  "quotation.save": "Saved source data",
  "quotation.status": "Changed quotation status",
  "quotation.checkSource": "Checked entered data against originals",
  "quotation.confirmMatch": "Confirmed a material match",
  "quotation.files": "Saved original-file group",
  "quotation.beginGroup": "Started original-file changes",
  "quotation.cancelGroup": "Cancelled original-file changes",
  "quotation.retryJob": "Retried file processing",
};
function HistoryDetails({
  event,
  view,
}: {
  event: QuoteHistory;
  view: QuotationsView;
}) {
  const before = record(event.details.before),
    after = record(event.details.after);
  const savedBody = parseQuoteBody(after?.body);
  return (
    <>
      {typeof event.details.reason === "string" && event.details.reason && (
        <p>Reason: {event.details.reason}</p>
      )}
      {before?.state !== after?.state && typeof after?.state === "string" && (
        <p>Status: {after.state === "draft" ? "Draft" : "Cancelled"}</p>
      )}
      {Array.isArray(event.details.after) && (
        <p>
          {event.details.after.length} originals saved. Earlier file identities
          and hashes remain in retained history.
        </p>
      )}
      {savedBody && (
        <details>
          <summary>Saved source data at this change</summary>
          <SavedSource body={savedBody} view={view} />
        </details>
      )}
    </>
  );
}

function useQuoteOperation() {
  const { refresh } = useFoundationRealtime();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [conflict, setConflict] = useState(false),
    [notice, setNotice] = useState("");
  const running = useRef(false),
    retry = useRef<{ key: string; id: string } | null>(null);
  const run = async (input: QuoteInput) => {
    if (running.current) return null;
    const key = JSON.stringify(input);
    if (retry.current?.key !== key)
      retry.current = { key, id: crypto.randomUUID() };
    running.current = true;
    setBusy(true);
    setError("");
    setConflict(false);
    setNotice("");
    try {
      const result = await quotationCommandAction({
        ...input,
        requestId: retry.current.id,
      });
      if (result.ok) {
        retry.current = null;
        setNotice(result.message);
      } else {
        setError(result.message);
        setConflict(!!result.conflict);
      }
      return result;
    } catch {
      setError(
        "The response was interrupted. Retry the same request to check its saved outcome.",
      );
      return null;
    } finally {
      running.current = false;
      setBusy(false);
      refresh();
    }
  };
  const reviewed = () => {
    setConflict(false);
    setError("");
    retry.current = null;
  };
  return { busy, error, conflict, notice, run, reviewed };
}

function NewQuotation({
  view,
  close,
}: {
  view: QuotationsView;
  close: () => void;
}) {
  const [supplierId, setSupplierId] = useState("");
  const operation = useQuoteOperation(),
    router = useRouter();
  const create = async (event: FormEvent) => {
    event.preventDefault();
    const supplier = view.suppliers.find((s) => s.id === supplierId);
    if (!supplier || !view.request) return;
    const body = emptyQuoteBody();
    for (const key of [
      "address",
      "tin",
      "contactName",
      "email",
      "phone",
    ] as const)
      body[key] = supplier[key];
    body.supplierName = supplier.name;
    const result = await operation.run({
      type: "create",
      mrfId: view.request.id,
      supplierId,
      body,
    });
    if (result?.ok && result.quoteId) {
      close();
      router.push(`/requests/${view.request.id}/quotes/${result.quoteId}`);
    }
  };
  return (
    <RecordModal
      open
      title="Create quotation draft"
      onClose={() => {
        if (!operation.busy) close();
      }}
    >
      <form className="form-stack" onSubmit={create}>
        <p>
          First save permanently links this MRF and business. Later MRF
          corrections can change supporting documents only, even if this
          quotation is cancelled.
        </p>
        <Field label="Active supplier">
          <select
            name="supplierId"
            value={supplierId}
            required
            disabled={operation.busy}
            onChange={(e) => setSupplierId(e.target.value)}
          >
            <option value="">Choose supplier</option>
            {view.suppliers.map((s) => (
              <option
                key={s.id}
                value={s.id}
                disabled={view.quotes.some(
                  (q) => q.supplierId === s.id && q.state === "draft",
                )}
              >
                {s.name}
                {view.quotes.some(
                  (q) => q.supplierId === s.id && q.state === "draft",
                )
                  ? " — active draft already exists"
                  : ""}
              </option>
            ))}
          </select>
        </Field>
        <a
          className="text-link"
          href="/suppliers"
          target="_blank"
          rel="noreferrer"
        >
          Add a missing supplier in the directory
        </a>
        <InlineError message={operation.error} />
        <div className="form-actions">
          <button
            type="button"
            className="button secondary"
            disabled={operation.busy}
            onClick={close}
          >
            Cancel
          </button>
          <button
            className="button primary"
            disabled={operation.busy || !view.request?.procurementReady}
          >
            {operation.busy ? "Saving…" : "Save draft and link MRF"}
          </button>
        </div>
      </form>
    </RecordModal>
  );
}

function SourceEditor({
  quote,
  view,
}: {
  quote: QuotationDraft;
  view: QuotationsView;
}) {
  const [body, setBody] = useState<QuoteBody>(quote.body);
  const [basis, setBasis] = useState({
    body: quote.body,
    version: quote.version,
  });
  const [lineId, setLineId] = useState<string | null>(null);
  const [statusOpen, setStatusOpen] = useState(false),
    [reason, setReason] = useState("");
  const operation = useQuoteOperation();
  const dirty = JSON.stringify(body) !== JSON.stringify(basis.body);
  const stale = basis.version !== quote.version;
  const editable =
    view.role === "Procurement" &&
    quote.state === "draft" &&
    !!view.request?.procurementReady;
  const canStatus =
    view.role === "Procurement" && !!view.request?.procurementReady;
  const busy = operation.busy;
  const selectedLine = body.lines.find((line) => line.id === lineId);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const adopt = (saved: QuotationDraft) => {
    setBody(saved.body);
    setBasis({ body: saved.body, version: saved.version });
  };
  const run = async (command: QuoteInput) => {
    const result = await operation.run(command);
    if (result?.ok && result.quote) adopt(result.quote);
    return result;
  };
  const changeHeader = (key: HeaderKey, value: string) =>
    setBody({ ...body, [key]: value });
  const changeLine = (id: string, changes: Partial<QuoteLine>) =>
    setBody({
      ...body,
      lines: body.lines.map((line) =>
        line.id === id ? { ...line, ...changes } : line,
      ),
    });
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!editable || stale || operation.conflict) return;
    await run({
      type: "save",
      quoteId: quote.id,
      expectedVersion: basis.version,
      body,
    });
  };
  const headerInputs = (keys: HeaderKey[]) => (
    <div className="form-grid">
      {keys.map((key) => (
        <Field key={key} label={HEADER_FIELDS[key]}>
          {key.endsWith("Notes") ||
          ["notes", "address", "paymentTerms", "deliveryTerms"].includes(
            key,
          ) ? (
            <textarea
              disabled={!editable}
              name={key}
              maxLength={4000}
              value={body[key]}
              onChange={(e) => changeHeader(key, e.target.value)}
            />
          ) : (
            <input
              disabled={!editable}
              name={key}
              type={key === "date" || key === "validUntil" ? "date" : "text"}
              maxLength={4000}
              value={body[key]}
              onChange={(e) => changeHeader(key, e.target.value)}
            />
          )}
        </Field>
      ))}
    </div>
  );
  const reviewBlocked =
    !editable ||
    dirty ||
    stale ||
    operation.conflict ||
    busy ||
    !quote.files.length ||
    quote.groups.some((g) => g.state === "uploading");
  return (
    <>
      <div className="panel quotation-review-status">
        <strong>
          {quote.state === "cancelled"
            ? "Cancelled quotation"
            : "Editable quotation draft"}
        </strong>
        <p>
          {quote.checked && !dirty
            ? "Entered data checked against the saved originals."
            : "Entered data has not been checked against the current saved originals."}{" "}
          This is source review, not financial approval.
        </p>
        <p>
          Created by {quote.creatorName}. Business identity and MRF are fixed.
          Financial finalization and purchasing are not available yet.
        </p>
        {canStatus && (
          <div className="form-actions">
            <button
              className="button secondary"
              disabled={busy || dirty || stale}
              onClick={() => {
                setReason("");
                setStatusOpen(true);
              }}
            >
              {quote.state === "draft"
                ? "Cancel quotation"
                : "Reopen quotation"}
            </button>
          </div>
        )}
        {dirty && (
          <p>
            Save or discard your text changes before checking source data or
            changing status.
          </p>
        )}
      </div>
      {(stale || operation.conflict) && (
        <section className="panel" role="status">
          <h2>Review latest saved quotation</h2>
          <p>
            Your input is preserved. The saved quotation changed; review all
            differences before replacing it.
          </p>
          <details>
            <summary>Latest saved fields and lines</summary>
            <SavedSource body={quote.body} view={view} />
          </details>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => {
              setBasis({ body: quote.body, version: quote.version });
              operation.reviewed();
            }}
          >
            I reviewed the latest quotation; keep my draft
          </button>
        </section>
      )}
      <form className="quotation-capture form-stack" onSubmit={save}>
        <fieldset disabled={busy}>
          <details className="panel" open>
            <summary>Supplier details as quoted</summary>
            <p>
              These are quotation-specific source details. Changes do not update
              the supplier directory.
            </p>
            {headerInputs(supplierFields)}
          </details>
          <details className="panel" open>
            <summary>Reference and terms</summary>
            {headerInputs(headerFields)}
          </details>
          <details className="panel">
            <summary>Stated financial source values</summary>
            <p>
              Copy only what the supplier states. Blank means not recorded.
              Values are stored without calculations, rounding, conversion or
              default tax assumptions.
            </p>
            {headerInputs(financialFields)}
          </details>
          <section className="panel">
            <div className="panel-heading">
              <h2>Offered materials</h2>
              {editable && (
                <button
                  type="button"
                  className="button secondary"
                  onClick={() =>
                    setBody({
                      ...body,
                      lines: [...body.lines, emptyQuoteLine()],
                    })
                  }
                >
                  Add offered line
                </button>
              )}
            </div>
            <div className="table-frame quotation-source-table">
              <table>
                <thead>
                  <tr>
                    <th>Description</th>
                    <th>Quantity</th>
                    <th>Unit</th>
                    <th>Unit price as quoted</th>
                    <th>Requested material</th>
                    <th>Source match</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {body.lines.map((line, index) => (
                    <tr key={line.id} data-quote-line={line.id}>
                      {(
                        [
                          "description",
                          "quantity",
                          "unit",
                          "unitPrice",
                        ] as const
                      ).map((key) => (
                        <td key={key}>
                          <input
                            disabled={!editable}
                            aria-label={`${LINE_FIELDS[key]} ${index + 1}`}
                            value={line[key]}
                            maxLength={
                              key === "quantity" || key === "unitPrice"
                                ? 80
                                : 4000
                            }
                            onChange={(e) =>
                              changeLine(line.id, { [key]: e.target.value })
                            }
                          />
                        </td>
                      ))}
                      <td>
                        <select
                          disabled={!editable}
                          aria-label={`Requested material ${index + 1}`}
                          value={line.requestItemId ?? ""}
                          onChange={(e) =>
                            changeLine(line.id, {
                              requestItemId: e.target.value || null,
                            })
                          }
                        >
                          <option value="">Unmatched / extra offer</option>
                          {view.request?.items.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name} · {item.unit}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        {quote.matches.includes(line.id) && !dirty
                          ? "Confirmed"
                          : "Unconfirmed"}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="text-link"
                          onClick={() => setLineId(line.id)}
                        >
                          Line details
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!body.lines.length && <p>No offered lines recorded.</p>}
          </section>
          <details className="panel">
            <summary>
              Stated discounts, charges, tax and source service rows
            </summary>
            {body.adjustments.map((row, index) => (
              <div className="quotation-adjustment" key={row.id}>
                <h3>Source adjustment {index + 1}</h3>
                <div className="form-grid">
                  {(
                    Object.keys(
                      ADJUSTMENT_FIELDS,
                    ) as (keyof typeof ADJUSTMENT_FIELDS)[]
                  ).map((key) => (
                    <Field key={key} label={ADJUSTMENT_FIELDS[key]}>
                      <input
                        disabled={!editable}
                        value={row[key]}
                        maxLength={key === "value" ? 80 : 4000}
                        onChange={(e) =>
                          setBody({
                            ...body,
                            adjustments: body.adjustments.map((r) =>
                              r.id === row.id
                                ? { ...r, [key]: e.target.value }
                                : r,
                            ),
                          })
                        }
                      />
                    </Field>
                  ))}
                </div>
                {editable && (
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() =>
                      setBody({
                        ...body,
                        adjustments: body.adjustments.filter(
                          (r) => r.id !== row.id,
                        ),
                      })
                    }
                  >
                    Remove source adjustment
                  </button>
                )}
              </div>
            ))}
            {editable && (
              <button
                type="button"
                className="button secondary"
                onClick={() =>
                  setBody({
                    ...body,
                    adjustments: [
                      ...body.adjustments,
                      {
                        id: crypto.randomUUID(),
                        label: "",
                        kind: "",
                        basis: "",
                        value: "",
                        taxable: "",
                        sourceDetails: "",
                      },
                    ],
                  })
                }
              >
                Add source adjustment
              </button>
            )}
          </details>
        </fieldset>
        <InlineError message={operation.error} />
        {operation.notice && <p role="status">{operation.notice}</p>}
        {view.role === "Procurement" && (
          <div className="form-actions">
            <button
              type="button"
              className="button secondary"
              disabled={busy || !dirty}
              onClick={() => {
                if (window.confirm("Discard unsaved quotation changes?")) {
                  adopt(quote);
                  operation.reviewed();
                }
              }}
            >
              Discard text changes
            </button>
            <button
              className="button primary"
              disabled={!editable || busy || stale || operation.conflict}
            >
              {busy ? "Saving…" : "Save quotation"}
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={reviewBlocked}
              onClick={() =>
                void run({
                  type: "checkSource",
                  quoteId: quote.id,
                  expectedVersion: basis.version,
                  expectedFiles: quote.fileVersion,
                })
              }
            >
              Entered data checked against originals
            </button>
          </div>
        )}
      </form>
      <QuotationOriginals
        quote={quote}
        editable={editable}
        canRetry={canStatus}
      />
      {selectedLine && (
        <RecordModal
          open
          title="Offered line source details"
          onClose={() => setLineId(null)}
        >
          <fieldset disabled={!editable || busy}>
            <div className="form-grid">
              {(Object.keys(LINE_FIELDS) as LineKey[]).map((key) => (
                <Field key={key} label={LINE_FIELDS[key]}>
                  <input
                    name={`line-${key}`}
                    value={selectedLine[key]}
                    maxLength={4000}
                    onChange={(e) =>
                      changeLine(selectedLine.id, { [key]: e.target.value })
                    }
                  />
                </Field>
              ))}
              <Field label="Source original">
                <select
                  value={selectedLine.sourceFileId ?? ""}
                  onChange={(e) =>
                    changeLine(selectedLine.id, {
                      sourceFileId: e.target.value || null,
                    })
                  }
                >
                  <option value="">Not recorded</option>
                  {quote.files.map((file) => (
                    <option key={file.id} value={file.id}>
                      {file.name}
                    </option>
                  ))}
                  {selectedLine.sourceFileId &&
                    !quote.files.some(
                      (f) => f.id === selectedLine.sourceFileId,
                    ) && (
                      <option value={selectedLine.sourceFileId}>
                        Prior original no longer current
                      </option>
                    )}
                </select>
              </Field>
            </div>
          </fieldset>
          <p>
            Confirm only that this offer meets the requested specifications. A
            match does not change the MRF or reserve demand/stock. Enter a
            positive conversion factor, including 1 for the same units; explain
            unit differences.
          </p>
          <div className="form-actions">
            {editable && (
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  setBody({
                    ...body,
                    lines: body.lines.filter(
                      (line) => line.id !== selectedLine.id,
                    ),
                  });
                  setLineId(null);
                }}
              >
                Remove offered line
              </button>
            )}
            {view.role === "Procurement" && (
              <button
                type="button"
                className="button secondary"
                disabled={
                  reviewBlocked ||
                  !selectedLine.requestItemId ||
                  !selectedLine.conversionFactor
                }
                onClick={() =>
                  void run({
                    type: "confirmMatch",
                    quoteId: quote.id,
                    expectedVersion: basis.version,
                    expectedFiles: quote.fileVersion,
                    lineId: selectedLine.id,
                  })
                }
              >
                Confirm material match
              </button>
            )}
            <button
              type="button"
              className="button secondary"
              onClick={() => setLineId(null)}
            >
              Close line details
            </button>
          </div>
        </RecordModal>
      )}
      {statusOpen && (
        <RecordModal
          open
          title={
            quote.state === "draft" ? "Cancel quotation" : "Reopen quotation"
          }
          onClose={() => {
            if (!busy) setStatusOpen(false);
          }}
        >
          <form
            className="form-stack"
            onSubmit={async (event) => {
              event.preventDefault();
              const result = await run({
                type: "status",
                quoteId: quote.id,
                expectedVersion: basis.version,
                state: quote.state === "draft" ? "cancelled" : "draft",
                reason,
              });
              if (result?.ok) setStatusOpen(false);
            }}
          >
            <p>
              History, current originals and the permanent MRF reference are
              retained.
            </p>
            <Field label="Reason">
              <textarea
                name="statusReason"
                minLength={5}
                maxLength={2000}
                required
                value={reason}
                disabled={busy}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            <InlineError message={operation.error} />
            <button className="button primary" disabled={busy}>
              {quote.state === "draft"
                ? "Cancel quotation"
                : "Reopen quotation"}
            </button>
          </form>
        </RecordModal>
      )}
    </>
  );
}

export function QuotationDraftWorkspace({
  initial,
  quoteId,
}: {
  initial: QuotationsView;
  quoteId?: string;
}) {
  const { view } = useFoundationRealtime();
  const data = view?.kind === "quotations" ? view.data : initial;
  const [create, setCreate] = useState(false),
    [search, setSearch] = useState("");
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const quote = quoteId ? data.quotes.find((q) => q.id === quoteId) : undefined;
  const rows = data.quotes.filter((q) =>
    `${q.body.supplierName} ${q.body.ref} ${q.state}`
      .toLowerCase()
      .includes(search.toLowerCase().trim()),
  );
  return (
    <>
      <Link
        className="back-link"
        href={
          quoteId
            ? `/requests/${initial.request?.id}/quotes`
            : `/requests/${initial.request?.id}`
        }
      >
        ← {quoteId ? "Quotations" : "Material request"}
      </Link>
      <PageHeader
        eyebrow={data.request?.ref}
        title={
          quoteId ? quote?.body.ref || "Quotation draft" : "Supplier quotations"
        }
        description="Capture and check supplier source information. Financial finalization is not available yet."
        actions={
          data.role === "Procurement" &&
          !quoteId && (
            <button
              className="button primary"
              disabled={!hydrated || !data.request?.procurementReady}
              onClick={() => setCreate(true)}
            >
              Create quotation draft
            </button>
          )
        }
      />
      {!data.request?.procurementReady && (
        <p role="status" className="panel">
          MRF approval or required archives are pending. Saved quotations remain
          readable; changes are paused.
        </p>
      )}
      {quoteId ? (
        quote ? (
          <SourceEditor key={quote.id} quote={quote} view={data} />
        ) : (
          <p>Quotation unavailable.</p>
        )
      ) : (
        <Register
          rows={rows}
          unit="quotations"
          resetKey={search}
          filters={
            <Field label="Search quotations">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </Field>
          }
          headers={
            <>
              <th>Supplier as quoted</th>
              <th>Reference</th>
              <th>Status</th>
              <th>Source review</th>
              <th>Originals</th>
              <th>Action</th>
            </>
          }
          renderRow={(q) => (
            <tr key={q.id} data-quotation-id={q.id}>
              <td>{q.body.supplierName || "Name not recorded"}</td>
              <td>{q.body.ref || "Reference not recorded"}</td>
              <td>{q.state}</td>
              <td>{q.checked ? "Entered data checked" : "Unchecked"}</td>
              <td>
                {q.files.length} saved
                {q.groups.length ? " · changes pending" : ""}
              </td>
              <td>
                <Link href={`/requests/${q.mrfId}/quotes/${q.id}`}>
                  Open quotation
                </Link>
              </td>
            </tr>
          )}
        />
      )}
      <section className="panel project-history">
        <h2>Recent quotation changes</h2>
        <p>Latest 30 events; full audit history is retained.</p>
        <ol>
          {data.history
            .filter((h) => !quoteId || h.quoteId === quoteId)
            .map((h) => (
              <li key={h.id}>
                <strong>
                  {historyActions[h.action] || "Quotation updated"}
                </strong>
                <small>
                  {h.actorName} / {h.actorRole} ·{" "}
                  {new Date(h.at).toLocaleString("en-PH", {
                    timeZone: "Asia/Manila",
                  })}
                </small>
                <HistoryDetails event={h} view={data} />
              </li>
            ))}
        </ol>
      </section>
      {create && <NewQuotation view={data} close={() => setCreate(false)} />}
    </>
  );
}

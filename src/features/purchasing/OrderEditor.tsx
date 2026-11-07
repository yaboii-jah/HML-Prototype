"use client";
import { useState } from "react";
import { Field } from "@/src/components/ui/Primitives";
import {
  PO_FIELDS,
  type OrderBody,
  type OrderLine,
  type PurchasingRecord,
} from "@/src/domain/purchasing/contracts";
import {
  calculatePo,
  exactQuantity,
  initialAdjustments,
  makeOrderLine,
  orderPricingBasis,
} from "@/src/domain/purchasing/pricing";
import { decimal, divide, php } from "@/src/domain/quotations/decimal";
import { emptyPayment, type PaymentArrangement } from "@/src/domain/purchasing/accounting";
import type {
  QuotationDraft,
  QuotationsView,
} from "@/src/domain/quotations/drafts";

export function OrderEditor({
  body,
  quote,
  quotations,
  saved,
  po,
  disabled,
  setBody,
  setQuote,
}: {
  body: OrderBody;
  quote: QuotationDraft;
  quotations: QuotationsView;
  saved?: PurchasingRecord;
  po: boolean;
  disabled: boolean;
  setBody: (body: OrderBody) => void;
  setQuote: (id: string) => void;
}) {
  const [newSource, setNewSource] = useState(""),
    [error, setError] = useState("");
  const candidates = quote.body.lines.filter(
    (l) =>
      l.requestItemId &&
      quote.matches.includes(l.id) &&
      quote.financial?.review?.rows.some(
        (r) => r.id === l.id && r.role === "material",
      ),
  );
  const updateLine = (id: string, patch: Partial<OrderLine>) =>
    setBody({
      ...body,
      adjustments: [
        "quantity",
        "offeredQuantity",
        "sourceLineId",
        "fixedDiscount",
      ].some((key) => key in patch)
        ? body.adjustments.map((a) => ({ ...a, confirmed: false }))
        : body.adjustments,
      lines: body.lines.map((line) =>
        line.id === id ? { ...line, ...patch } : line,
      ),
    });
  const updateQuantity = (line: OrderLine, value: string, offered: boolean) => {
    const source = quote.body.lines.find((l) => l.id === line.sourceLineId);
    if (!source) return;
    try {
      const selected = offered
        ? value
        : exactQuantity(
            divide(decimal(value), decimal(source.conversionFactor)),
          );
      const next = makeOrderLine(quote, source.id, selected, line.id);
      updateLine(line.id, {
        ...next,
        fixedDiscount:
          !po || (!line.offeredQuantity && !line.fixedDiscount)
            ? next.fixedDiscount
            : line.fixedDiscount,
        discountReason: line.discountReason,
        discountConfirmed: false,
      });
      setError("");
    } catch (cause) {
      updateLine(
        line.id,
        offered
          ? { offeredQuantity: value, discountConfirmed: false }
          : { quantity: value, discountConfirmed: false },
      );
      setError(
        cause instanceof Error ? cause.message : "Review the exact quantity.",
      );
    }
  };
  const changeSource = (line: OrderLine, sourceLineId: string) => {
    const source = quote.body.lines.find((l) => l.id === sourceLineId);
    if (!source) return;
    try {
      const offered = exactQuantity(
        divide(decimal(line.quantity || "0"), decimal(source.conversionFactor)),
      );
      const next = makeOrderLine(quote, source.id, offered, line.id);
      updateLine(line.id, next);
      setError("");
    } catch {
      updateLine(line.id, {
        sourceLineId,
        offeredQuantity: "",
        fixedDiscount: "",
        discountConfirmed: false,
      });
      setError("Enter an exact quantity for the newly selected source.");
    }
  };
  const calculation = po ? calculatePo(quote, body) : null;
  const payment = body.payment ?? emptyPayment();
  const updatePayment = (patch: Partial<PaymentArrangement>) => setBody({ ...body, payment: { ...payment, ...patch } });
  const savedMaterialBasis =
    !!saved &&
    saved.quoteId === quote.id &&
    orderPricingBasis(saved.body) === orderPricingBasis(body);
  return (
    <>
      <p>
        Linked supplier:{" "}
        <strong>
          {quotations.suppliers.find((s) => s.id === quote.supplierId)?.name ||
            quote.body.supplierName}
        </strong>
        . MRF and supplier ownership remain fixed.
      </p>
      <Field label="Quotation revision">
        <select
          value={quote.id}
          disabled={disabled}
          onChange={(e) => setQuote(e.target.value)}
        >
          {quotations.quotes
            .filter(
              (q) =>
                q.supplierId === quote.supplierId &&
                (q.id === quote.id || q.revision?.eligible),
            )
            .map((q) => (
              <option key={q.id} value={q.id}>
                {q.body.ref} · revision {q.revision?.number} ·{" "}
                {q.revision?.eligible ? "Eligible" : "Blocked"}
              </option>
            ))}
        </select>
      </Field>
      <p className="helper-note">
        PHP · {quote.financial?.review?.vatStatus} ·{" "}
        {quote.financial?.review?.priceBasis}. Unit prices, percentage rates and
        tax treatment come from this quotation.
      </p>
      {quote.revision && !quote.revision.eligible && (
        <p role="status">
          Source blocked:{" "}
          {quote.revision.blockers.join("; ") ||
            "A current replacement must be selected"}
          . Saved demand remains allocated.
        </p>
      )}
      <Field label="Supplier selection reason">
        <textarea
          value={body.reason}
          disabled={disabled}
          minLength={5}
          maxLength={2000}
          onChange={(e) => setBody({ ...body, reason: e.target.value })}
        />
      </Field>
      <h3>Allocated materials</h3>
      {body.lines.map((line, index) => {
        const source = quote.body.lines.find((l) => l.id === line.sourceLineId),
          config = quote.financial?.review?.rows.find(
            (r) => r.id === line.sourceLineId,
          );
        const previous = saved?.body.lines.find((l) => l.id === line.id);
        const savedBasis =
          saved?.quoteId === quote.id &&
          previous?.offeredQuantity === line.offeredQuantity &&
          previous?.fixedDiscount === line.fixedDiscount &&
          previous?.sourceLineId === line.sourceLineId;
        return (
          <fieldset className="subform" key={line.id}>
            <legend>
              Material {index + 1}:{" "}
              {
                quotations.request?.items.find((i) => i.id === line.itemId)
                  ?.name
              }
            </legend>
            <Field label="Confirmed source offer">
              <select
                value={line.sourceLineId}
                disabled={disabled}
                onChange={(e) => changeSource(line, e.target.value)}
              >
                <option value="">Choose the replacement material offer</option>
                {candidates
                  .filter((l) => l.requestItemId === line.itemId)
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.description} · {l.unit} · quoted {l.quantity}
                    </option>
                  ))}
              </select>
            </Field>
            <div className="form-grid">
              <Field
                label={`Offered quantity (${source?.unit || "supplier unit"})`}
              >
                <input
                  inputMode="decimal"
                  value={line.offeredQuantity}
                  disabled={disabled}
                  onChange={(e) => updateQuantity(line, e.target.value, true)}
                />
              </Field>
              <Field
                label={`Requested quantity (${quotations.request?.items.find((i) => i.id === line.itemId)?.unit || "MRF unit"})`}
              >
                <input
                  inputMode="decimal"
                  value={line.quantity}
                  disabled={disabled}
                  onChange={(e) => updateQuantity(line, e.target.value, false)}
                />
              </Field>
            </div>
            <p className="helper-note">
              Quoted unit price: PHP {source?.unitPrice || "unrecorded"};
              conversion: {source?.conversionFactor || "unrecorded"} requested
              units per offered unit.
            </p>
            {po && config?.discountType === "fixed" && (
              <>
                <Field
                  label="Order fixed line discount (PHP)"
                  hint={`Quoted entire-line discount: ${source?.discountValue}. Enter zero explicitly when none applies.`}
                >
                  <input
                    inputMode="decimal"
                    value={line.fixedDiscount}
                    disabled={disabled}
                    onChange={(e) =>
                      updateLine(line.id, {
                        fixedDiscount: e.target.value,
                        discountConfirmed: false,
                      })
                    }
                  />
                </Field>
                <Field label="Reason for changed fixed discount">
                  <input
                    value={line.discountReason}
                    disabled={disabled}
                    maxLength={2000}
                    onChange={(e) =>
                      updateLine(line.id, { discountReason: e.target.value })
                    }
                  />
                </Field>
                <label className="field">
                  <span>
                    <input
                      type="checkbox"
                      checked={line.discountConfirmed}
                      disabled={disabled || !savedBasis}
                      onChange={(e) =>
                        updateLine(line.id, {
                          discountConfirmed: e.target.checked,
                        })
                      }
                    />{" "}
                    Confirm this saved line discount
                  </span>
                  <small>
                    {!savedBasis
                      ? "Save quantity/amount changes first, then confirm the saved discount."
                      : "Confirmation applies to this exact saved quantity and amount."}
                  </small>
                </label>
              </>
            )}
            {config?.discountType === "percentage" && (
              <p>Quoted line discount: {source?.discountValue}%.</p>
            )}
            <button
              type="button"
              className="button secondary"
              disabled={disabled}
              onClick={() =>
                setBody({
                  ...body,
                  lines: body.lines.filter((l) => l.id !== line.id),
                  adjustments: body.adjustments.map((a) => ({
                    ...a,
                    confirmed: false,
                  })),
                })
              }
            >
              Remove material {index + 1}
            </button>
          </fieldset>
        );
      })}
      <div className="toolbar">
        <Field label="Add a confirmed material offer">
          <select
            value={newSource}
            disabled={disabled}
            onChange={(e) => setNewSource(e.target.value)}
          >
            <option value="">Choose material</option>
            {candidates
              .filter(
                (l) => !body.lines.some((row) => row.sourceLineId === l.id),
              )
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {
                    quotations.request?.items.find(
                      (i) => i.id === l.requestItemId,
                    )?.name
                  }{" "}
                  — {l.description}
                </option>
              ))}
          </select>
        </Field>
        <button
          type="button"
          className="button secondary"
          disabled={disabled || !newSource}
          onClick={() => {
            const source = candidates.find((l) => l.id === newSource);
            if (!source?.requestItemId) return;
            setBody({
              ...body,
              adjustments: body.adjustments.map((a) => ({
                ...a,
                confirmed: false,
              })),
              lines: [
                ...body.lines,
                {
                  id: crypto.randomUUID(),
                  sourceLineId: source.id,
                  itemId: source.requestItemId,
                  offeredQuantity: "",
                  quantity: "",
                  fixedDiscount: "",
                  discountReason: "",
                  discountConfirmed: false,
                },
              ],
            });
            setNewSource("");
          }}
        >
          Add material
        </button>
      </div>
      {po && (
        <>
          <h3>Quoted document adjustments</h3>
          {!body.adjustments.length && <p>No quoted document adjustments.</p>}
          {body.adjustments.map((adjustment, index) => {
            const original = initialAdjustments(quote).find(
                (a) =>
                  a.id === adjustment.id &&
                  a.sourceKind === adjustment.sourceKind,
              ),
              old = saved?.body.adjustments.find(
                (a) =>
                  a.id === adjustment.id &&
                  a.sourceKind === adjustment.sourceKind,
              );
            const source =
              adjustment.sourceKind === "line"
                ? quote.body.lines.find((l) => l.id === adjustment.id)
                : quote.body.adjustments.find((a) => a.id === adjustment.id);
            const label =
              source && "description" in source
                ? source.description
                : source && "label" in source
                  ? source.label
                  : "Adjustment";
            const percentage =
              adjustment.sourceKind === "adjustment" &&
              quote.financial?.review?.adjustments.find(
                (a) => a.id === adjustment.id,
              )?.calculation === "percentage";
            const savedBasis =
              savedMaterialBasis &&
              old?.amount === adjustment.amount &&
              old?.include === adjustment.include;
            const update = (patch: Partial<typeof adjustment>) =>
              setBody({
                ...body,
                adjustments: body.adjustments.map((a, n) =>
                  n === index ? { ...a, ...patch } : a,
                ),
              });
            return (
              <fieldset
                className="subform"
                key={`${adjustment.sourceKind}-${adjustment.id}`}
              >
                <legend>{label}</legend>
                <p className="helper-note">
                  Source: {original?.amount}
                  {percentage
                    ? "% of selected material subtotal"
                    : " PHP on the quotation's tax basis"}
                  .
                </p>
                <label className="field">
                  <span>
                    <input
                      type="checkbox"
                      checked={adjustment.include}
                      disabled={disabled}
                      onChange={(e) =>
                        update({ include: e.target.checked, confirmed: false })
                      }
                    />{" "}
                    Include in this order
                  </span>
                </label>
                <Field
                  label={
                    percentage ? "Quoted percentage rate" : "Order amount (PHP)"
                  }
                >
                  <input
                    inputMode="decimal"
                    value={adjustment.amount}
                    readOnly={percentage}
                    disabled={disabled || !adjustment.include}
                    onChange={(e) =>
                      update({ amount: e.target.value, confirmed: false })
                    }
                  />
                </Field>
                <Field label="Reason for changed or excluded adjustment">
                  <input
                    value={adjustment.reason}
                    disabled={disabled}
                    maxLength={2000}
                    onChange={(e) => update({ reason: e.target.value })}
                  />
                </Field>
                <label className="field">
                  <span>
                    <input
                      type="checkbox"
                      checked={adjustment.confirmed}
                      disabled={disabled || !savedBasis}
                      onChange={(e) => update({ confirmed: e.target.checked })}
                    />{" "}
                    Confirm this saved inclusion and amount
                  </span>
                  {!savedBasis && (
                    <small>
                      Save changed amounts/inclusion first, then confirm.
                    </small>
                  )}
                </label>
              </fieldset>
            );
          })}
          <h3>Payment arrangement for Accounting</h3>
          <p>Quoted payment terms: {quote.body.paymentTerms || "Not recorded"}. Confirm the agreed arrangement before submitting.</p>
          <div className="form-grid">
            <Field label="Payment arrangement">
              <select disabled={disabled} value={payment.mode} onChange={(e) => updatePayment({ mode: e.target.value as PaymentArrangement["mode"], dueDate: e.target.value === "upfront" ? "" : payment.dueDate })}>
                <option value="">Choose payment arrangement</option><option value="upfront">Upfront</option><option value="credit">Credit</option>
              </select>
            </Field>
            {payment.mode === "credit" && <Field label="Agreed Credit due date"><input type="date" disabled={disabled} value={payment.dueDate} onChange={(e) => updatePayment({ dueDate: e.target.value })}/></Field>}
            <Field label="Agreement against quotation">
              <select disabled={disabled} value={payment.relation} onChange={(e) => updatePayment({ relation: e.target.value as PaymentArrangement["relation"] })}>
                <option value="">Review quoted terms</option><option value="matches">Arrangement matches quotation</option><option value="differs">Agreed terms differ from quotation</option>
              </select>
            </Field>
          </div>
          {payment.relation === "differs" && <Field label="Agreed difference and reason"><textarea maxLength={2000} disabled={disabled} value={payment.reason} onChange={(e) => updatePayment({ reason: e.target.value })}/></Field>}
          <h3>Printed PO details</h3>
          <div className="form-grid">
            {(Object.keys(PO_FIELDS) as (keyof typeof PO_FIELDS)[]).map(
              (key) => (
                <Field key={key} label={PO_FIELDS[key]}>
                  <input
                    type={key === "date" ? "date" : "text"}
                    value={body.fields[key]}
                    disabled={disabled}
                    maxLength={4000}
                    onChange={(e) =>
                      setBody({
                        ...body,
                        fields: { ...body.fields, [key]: e.target.value },
                      })
                    }
                  />
                </Field>
              ),
            )}
          </div>
          {calculation && (
            <>
              <h3>Order calculation</h3>
              {calculation.issues.length ? (
                <>
                  <p>Pricing review is incomplete. Totals are not confirmed.</p>
                  <ul>
                    {calculation.issues.map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <dl className="data-rows">
                  {(
                    [
                      "materials",
                      "subtotal",
                      "vat",
                      "gross",
                      "ewtGoods",
                      "ewtServices",
                      "net",
                    ] as const
                  ).map((key) => (
                    <div key={key}>
                      <dt>
                        {
                          {
                            materials: "Materials",
                            subtotal: "Subtotal",
                            vat: "VAT",
                            gross: "Gross",
                            ewtGoods: "Goods EWT",
                            ewtServices: "Services EWT",
                            net: "Net payable",
                          }[key]
                        }
                      </dt>
                      <dd>{php(calculation[key])}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </>
          )}
        </>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

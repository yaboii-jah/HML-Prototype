"use client";
import Link from "next/link";
import { useState } from "react";
import { useFoundationRealtime } from "@/src/app-state/FoundationRealtime";
import { PageHeader, Badge } from "@/src/components/ui/Primitives";
import type { PurchasingRecord } from "@/src/domain/purchasing/contracts";
import { PO_STATUSES } from "@/src/domain/purchasing/accounting";
export function PoDirectory({
  initial,
  accounting = false,
}: {
  initial: PurchasingRecord[];
  accounting?: boolean;
}) {
  const live = useFoundationRealtime(),
    [search, setSearch] = useState(""),
    [state, setState] = useState(accounting ? "waiting" : "active");
  const records =
    live.view?.kind === "purchaseOrders" ? live.view.data.records : initial;
  const statusOf = (record: PurchasingRecord) => {
    if (record.review?.status === "rejected") return "rejected";
    if (record.state === "cancelled") return "cancelled";
    return record.review?.status || "draft";
  };
  const shown = records.filter((record) => {
    const status = accounting ? statusOf(record) : record.state;
    const matchesState = state === "all" || (state === "waiting"
      ? ["submitted", "held"].includes(status)
      : status === state);
    const text = `${record.ref} ${record.body.fields.vendorName} ${record.body.reason}`;
    return matchesState && text.toLowerCase().includes(search.toLowerCase());
  });
  return (
    <>
      <PageHeader
        title={accounting ? "Accounting" : "Purchase orders"}
        description={accounting ? "Review submitted purchase orders, payment arrangements and scope commitments." : "Shared purchase orders, Accounting review and supplier sending."}
      />
      <div className="toolbar">
        <label>
          Search POs
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label>
          Status
          <select value={state} onChange={(e) => setState(e.target.value)}>
            {accounting ? (
              <>
                <option value="waiting">Waiting for Accounting</option>
                {[...PO_STATUSES, "cancelled"].map((status) => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </>
            ) : (
              <>
                <option value="active">Active</option>
                <option value="cancelled">Cancelled</option>
              </>
            )}
            <option value="all">All</option>
          </select>
        </label>
      </div>
      <div className="table-frame">
        <table>
          <thead>
            <tr>
              <th>PO</th>
              <th>Printed vendor</th>
              <th>Status</th>
              <th>Preparation</th>
              <th>Supplier sending</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link
                    className="table-primary"
                    href={`/${accounting ? "accounting" : "purchase-orders"}/${r.id}`}
                  >
                    {r.ref}
                  </Link>
                </td>
                <td>{r.body.fields.vendorName || "Not recorded"}</td>
                <td>
                  <Badge value={statusOf(r)} />
                </td>
                <td>
                  {r.review?.status === "approved" ? "Accounting approval retained" : r.checked ? "Confirmed" : "Needs review"}
                  {r.blockers.length > 0 && (
                    <small>{r.blockers.join("; ")}</small>
                  )}
                </td>
                <td>{r.issuance?.status === "issued" ? "Issued" : r.issuance?.status === "prepared" ? "Prepared to send" : "Not issued"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!shown.length && (
          <p className="empty">
            {accounting ? "No purchase orders match this view. Submitted and Held POs appear here for Accounting review." : "No purchase orders match this view. Prepare supplier awards from an approved material request."}
          </p>
        )}
      </div>
    </>
  );
}

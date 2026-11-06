"use client";
import Link from "next/link";
import { useState } from "react";
import { useFoundationRealtime } from "@/src/app-state/FoundationRealtime";
import { PageHeader, Badge } from "@/src/components/ui/Primitives";
import type { PurchasingRecord } from "@/src/domain/purchasing/contracts";
export function PoDirectory({ initial }: { initial: PurchasingRecord[] }) {
  const live = useFoundationRealtime(),
    [search, setSearch] = useState(""),
    [state, setState] = useState("active");
  const records =
    live.view?.kind === "purchaseOrders" ? live.view.data.records : initial;
  const shown = records.filter(
    (r) =>
      (state === "all" || r.state === state) &&
      `${r.ref} ${r.body.fields.vendorName} ${r.body.reason}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <>
      <PageHeader
        title="Purchase orders"
        description="Saved purchasing preparation. Accounting review and supplier issuance remain later workflows."
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
            <option value="active">Active</option>
            <option value="cancelled">Cancelled</option>
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
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link
                    className="table-primary"
                    href={`/purchase-orders/${r.id}`}
                  >
                    {r.ref}
                  </Link>
                </td>
                <td>{r.body.fields.vendorName || "Not recorded"}</td>
                <td>
                  <Badge value={r.state} />
                </td>
                <td>
                  {r.checked ? "Confirmed" : "Needs review"}
                  {r.blockers.length > 0 && (
                    <small>{r.blockers.join("; ")}</small>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!shown.length && (
          <p className="empty">
            No purchase orders match this view. Prepare supplier awards from an
            approved material request.
          </p>
        )}
      </div>
    </>
  );
}

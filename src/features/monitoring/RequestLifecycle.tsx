"use client";

import Link from "next/link";
import { InlineError } from "@/src/components/ui/Primitives";
import { Register } from "@/src/components/ui/Register";
import type { MonitoringView } from "@/src/domain/monitoring/contracts";
import { useMonitoring } from "./useMonitoring";
import "./monitoring.css";

const quantities = [
  ["Requested", "requested"], ["Suitability hold", "hold"], ["Saved awards", "awarded"],
  ["Purchasing in progress", "purchasing"], ["Source release pending", "releasePending"],
  ["Confirmed supply", "confirmed"], ["Unassigned", "unassigned"],
  ["Accepted at site", "accepted"], ["Posted to inventory", "posted"],
] as const;

export function RequestLifecycle({ target, initial }: { target: string; initial: MonitoringView<"lifecycle"> | null }) {
  const filters = { target };
  const { view, error, refresh } = useMonitoring("lifecycle", filters, initial, filters);
  return <section className="panel monitoring-lifecycle" aria-labelledby="request-lifecycle-title">
    <h2 id="request-lifecycle-title">Material lifecycle</h2>
    {error && <><InlineError message={error}/><button className="button secondary" onClick={refresh}>Retry</button></>}
    {!view && !error && <p role="status">Checking material progress…</p>}
    {view && <>
      {view.items.length > 0 ? <Register embedded rows={view.items} unit="materials"
        tableClassName="monitoring-quantity-table"
        headers={<><th scope="col">Material / unit</th>{quantities.map(([title]) => <th key={title} scope="col">{title}</th>)}</>}
        renderRow={item => <tr key={item.id}><th scope="row">{item.material}<small>{item.unit}</small></th>
          {quantities.map(([, key]) => <td key={key}>{item[key]}</td>)}</tr>} />
        : <p>Approved quantities appear here after Project Manager approval.</p>}
      {view.blockers.length > 0 && <ul className="monitoring-dependencies">{view.blockers.map(blocker => <li key={blocker}>{blocker}</li>)}</ul>}
      {view.purchasing.length > 0 && <section aria-label="Payment and clearance">
        <h3>Payment and clearance</h3>
        <ul className="monitoring-records">{view.purchasing.map(po => <li key={po.href}>
          <Link className="text-link" href={po.href}>{po.ref}</Link>
          <span>{po.settled ? "Settled" : "Settlement pending"} · {po.cleared ? "Cleared for delivery" : "Delivery clearance pending"}</span>
          {!po.cleared && po.blockers.map(blocker => <small key={blocker}>{blocker}</small>)}
        </li>)}</ul>
      </section>}
      {view.shipments.length > 0 && <section aria-label="Shipment and evidence">
        <h3>Shipment and evidence</h3>
        <ul className="monitoring-records">{view.shipments.map(shipment => <li key={shipment.ref}>
          <Link className="text-link" href={shipment.href}>{shipment.ref}</Link>
          <span>{shipment.warehouse ? "Warehouse" : "Site"} · {shipment.received ? "Receipt confirmed" : shipment.state === "scheduled" ? "Scheduled" : "Dispatched"}</span>
          {shipment.forward && <small>Awaiting onward delivery</small>}
          {!shipment.warehouse && shipment.received && <small>{shipment.posted ? "Site stock posted" : "Site stock not posted"}</small>}
          {shipment.received && <small>{shipment.evidence === "approved" ? "Evidence approved"
            : shipment.evidence === "needs_evidence" ? "Evidence requested" : "Evidence pending"}</small>}
        </li>)}</ul>
      </section>}
    </>}
  </section>;
}

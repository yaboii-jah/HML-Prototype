"use client";

import Link from "next/link";
import { poStatusLabel } from "@/src/domain/workflow";
import { useState } from "react";
import { useDemo } from "@/src/app-state/DemoProvider";
import { Badge, Empty, PageHeader } from "@/src/components/ui/Primitives";
import { dateText, money } from "@/src/domain/format";
import { budgetFor, deliveryStatus, inventoryFor, paidTotal, poTotal, requestForPO, siteName } from "@/src/domain/selectors";

export function Reports() {
  const { snapshot: state } = useDemo();
  const [siteId, setSiteId] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  if (!state) return null;

  const selectedSite = state.siteFilter !== "all" ? state.siteFilter : siteId;
  const included = (id: string, date: string) =>
    (selectedSite === "all" || id === selectedSite) && (!from || date.slice(0, 10) >= from) && (!to || date.slice(0, 10) <= to);
  const requests = state.requests.filter(request => included(request.siteId, request.createdAt));
  const pos = state.pos.filter(po => {
    const request = requestForPO(state, po);
    return request && included(request.siteId, po.createdAt);
  });
  const batches = state.batches.filter(batch => {
    const po = state.pos.find(value => value.id === batch.poId);
    const request = po && requestForPO(state, po);
    return request && included(request.siteId, batch.createdAt);
  });
  const budgetSites = state.sites.filter(site => selectedSite === "all" || site.id === selectedSite);
  const paymentRequests = state.paymentRequests.filter(value => pos.some(po => po.id === value.poId));
  const pending = paymentRequests.filter(value => ["submitted", "hold"].includes(value.status)).length + requests.filter(request => request.status === "submitted").length + pos.filter(po => ["submitted", "hold"].includes(po.status)).length;
  const exceptions = pos.filter(po => ["hold", "returned", "rejected"].includes(po.status) || state.accounting.find(record => record.poId === po.id)?.review === "Discrepancy" || po.status === "released" && deliveryStatus(state, po) !== "Fully accepted" || paymentRequests.some(value => value.poId === po.id && ["hold", "returned", "rejected"].includes(value.status)));
  const documentGaps = pos.filter(po => ["approved", "released"].includes(po.status) && state.accounting.find(record => record.poId === po.id)?.review !== "Complete");
  const stockRows = budgetSites.flatMap(site => inventoryFor(state, site.id).map(item => ({ ...item, siteId: site.id })));
  const hasActivity = requests.length > 0 || pos.length > 0 || batches.length > 0 || stockRows.length > 0;
  const hasDateError = Boolean(from && to && from > to);

  return <>
    <PageHeader eyebrow="MANAGEMENT OVERVIEW" title="Operations report" description="Project commitments, workflow volume, and exceptions." />
    <div className="toolbar">
      <label>PROJECT <select aria-label="Report project" value={selectedSite} disabled={state.siteFilter !== "all"} onChange={event => setSiteId(event.target.value)}><option value="all">All projects</option>{state.sites.map(site => <option value={site.id} key={site.id}>{site.name}</option>)}</select></label>
      <label>FROM <input aria-label="Report from date" type="date" value={from} onChange={event => setFrom(event.target.value)} /></label>
      <label>TO <input aria-label="Report to date" type="date" value={to} onChange={event => setTo(event.target.value)} /></label>
    </div>
    {hasDateError && <p className="inline-error" role="alert">The From date must be on or before the To date.</p>}
    <div className="metric-strip">
      <div><small>REQUESTS</small><strong>{requests.length}</strong></div>
      <div><small>PURCHASE ORDERS</small><strong>{pos.length}</strong></div>
      <div><small>DELIVERY BATCHES</small><strong>{batches.length}</strong></div>
      <div><small>PENDING REVIEWS</small><strong>{pending}</strong></div>
    </div>

    {!budgetSites.length ? <section className="panel report-empty">
      <h2>No projects to report yet</h2>
      <p>Switch to Administrator to add a project. Reports will fill as the MRF workflow progresses.</p>
      <Link className="button secondary" href="/admin">Open administration</Link>
    </section> : <>
      <div className="content-grid report-summary-grid">
        <section className="panel">
          <h2 className="panel-title">Project budget position</h2>
          <p className="helper-note">Budget position is current; the date filter applies to record counts and the exception list.</p>
          <div className="table-frame embedded"><table><thead><tr><th>Project</th><th>Allocated</th><th>Committed</th><th>Paid</th><th>Available</th></tr></thead><tbody>{budgetSites.map(site => {
            const budget = budgetFor(state, site.id);
            return <tr key={site.id}><td><Link className="table-primary" href={`/projects/${site.id}`}>{site.name}</Link></td><td>{money(budget.allocated)}</td><td>{money(budget.committed)}</td><td>{money(budget.spent)}</td><td>{money(budget.available)}</td></tr>;
          })}</tbody></table></div>
        </section>
        <section className="panel">
          <h2 className="panel-title">Workflow mix</h2>
          <div className="data-rows">
            {["draft", "submitted", "returned", "approved", "rejected"].map(status => <div key={status}><span>{status}</span><strong>{requests.filter(request => request.status === status).length} MRFs</strong></div>)}
            <div><span>PO value in view</span><strong>{money(pos.reduce((sum, po) => sum + poTotal(state, po), 0))}</strong></div>
            <div><span>Payment requests awaiting Finance</span><strong>{paymentRequests.filter(value => ["submitted", "hold", "approved"].includes(value.status)).length}</strong></div><div><span>Disbursements in view</span><strong>{money(pos.reduce((sum, po) => sum + paidTotal(state, po.id), 0))}</strong></div>
          </div>
        </section>
      </div>

      {!hasActivity ? <section className="panel report-empty">
        <h2>{from || to || selectedSite !== "all" ? "No activity matches these filters" : "No operational records yet"}</h2>
        <p>{from || to || selectedSite !== "all" ? "Adjust the project or date range to see requests, purchases, deliveries, and stock." : "Create an MRF as Site Personnel to begin the request, purchase, delivery, and inventory trail."}</p>
        <Link className="button secondary" href="/requests">View material requests</Link>
      </section> : <>
        <div className="content-grid">
          <section className="panel">
            <div className="panel-heading"><h2>Document gaps</h2><Badge>{documentGaps.length} POs</Badge></div>
            {documentGaps.length ? documentGaps.map(po => <Link className="data-link" href={`/accounting/${po.id}`} key={po.id}><div><strong>{po.ref}</strong><small>{siteName(state, requestForPO(state, po)?.siteId || "")}</small></div><Badge value={state.accounting.find(record => record.poId === po.id)?.review || "Incomplete"} /></Link>) : <Empty title="Documents up to date" detail="No approved PO in this view needs document review." />}
          </section>
          <section className="panel">
            <h2 className="panel-title">Current site stock</h2>
            {stockRows.length ? stockRows.map(row => <Link className="data-link" href={`/inventory/${row.siteId}/${row.id}`} key={`${row.siteId}-${row.id}`}><div><strong>{row.name}</strong><small>{siteName(state, row.siteId)}</small></div><span>{row.onHand} {row.unit}</span></Link>) : <Empty title="No posted stock" detail="Accepted deliveries appear here after Site Personnel posts them to inventory." />}
          </section>
        </div>
        <section className="panel">
          <div className="panel-heading"><h2>Exceptions and open deliveries</h2><Badge>{exceptions.length} records</Badge></div>
          {exceptions.length ? <div className="table-frame embedded"><table><thead><tr><th>PO</th><th>Project</th><th>Status</th><th>Delivery</th><th>Amount</th><th>Created</th></tr></thead><tbody>{exceptions.map(po => <tr key={po.id}><td><Link className="table-primary" href={`/purchase-orders/${po.id}`}>{po.ref}</Link></td><td>{siteName(state, requestForPO(state, po)?.siteId || "")}</td><td><Badge value={po.status}>{poStatusLabel(po.status)}</Badge></td><td><Badge value={deliveryStatus(state, po)} /></td><td>{money(poTotal(state, po))}</td><td>{dateText(po.createdAt)}</td></tr>)}</tbody></table></div> : <Empty title="No open exceptions" detail="Held orders, discrepancies, and open deliveries will appear here." />}
        </section>
      </>}
      <p className="helper-note">Figures reflect current project records and selected filters.</p>
    </>}
  </>;
}

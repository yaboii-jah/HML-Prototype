"use client";
import Link from "next/link";
import { useState } from "react";
import { useDemo } from "@/src/app-state/DemoProvider";
import { Field, InlineError } from "@/src/components/ui/Primitives";
import { Register } from "@/src/components/ui/Register";
import { RecordModal } from "@/src/components/ui/RecordModal";
import { businessDate, businessRangeError } from "@/src/domain/business-dates";
import { consumptionRows, consumptionCsv } from "@/src/domain/consumption";
import { actorText, auditTime } from "@/src/domain/audit";
import type { DemoSnapshot } from "@/src/domain/types";

export function Consumption({ state }: { state: DemoSnapshot }) {
  const { access } = useDemo();
  const [from, setFrom] = useState(() => businessDate().slice(0, 8) + "01"), [to, setTo] = useState(() => businessDate());
  const [search, setSearch] = useState(""), [unit, setUnit] = useState("");
  const [selected, setSelected] = useState("");
  const error = !from || !to ? "Choose the start and end dates." : businessRangeError(from, to);
  const projectIds = access.projectIds.filter(id => state.siteFilter === "all" || id === state.siteFilter);
  const units = [...new Set(state.movements.filter(m => projectIds.includes(m.siteId)).map(m => m.unit.trim().toLowerCase()))].sort();
  const rows = error ? [] : consumptionRows(state, { from, to, projectIds, search, unit });
  const row = rows.find(r => `${r.siteId}/${r.id}` === selected);
  function download() {
    if (error) return;
    const url = URL.createObjectURL(new Blob([consumptionCsv(rows, from, to)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `material-consumption-${from}-to-${to}.csv`; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section aria-label="Material consumption" className="consumption-report"><div className="panel consumption-intro"><div className="panel-heading"><div><h2>Material consumption</h2><p className="helper-note">Opening and closing physical stock for an inclusive Philippine date range. Reservations and drafts do not change these balances.</p></div><button type="button" className="button secondary" disabled={!!error || !rows.length} onClick={download}>Export CSV</button></div><div className="consumption-dates"><Field label="From"><input aria-label="Consumption from date" type="date" required value={from} onChange={e => setFrom(e.target.value)}/></Field><Field label="To"><input aria-label="Consumption to date" type="date" required value={to} onChange={e => setTo(e.target.value)}/></Field></div><InlineError message={error}/></div>
    {!!rows.some(r => r.undated) && <p className="storage-warning" role="status">Some movements have no usable date. Affected opening and closing balances are incomplete; dated period movements remain visible.</p>}
    <Register rows={rows} unit="materials" resetKey={JSON.stringify([from, to, state.siteFilter, search, unit])} filters={<><input aria-label="Search consumption" placeholder="Search material, project or unit" value={search} onChange={e => setSearch(e.target.value)}/><select aria-label="Consumption unit" value={unit} onChange={e => setUnit(e.target.value)}><option value="">All units</option>{units.map(u => <option key={u}>{u}</option>)}</select></>} headers={<><th>Material / unit</th><th>Project</th><th className="numeric">Opening</th><th className="numeric">Stock added</th><th className="numeric">Used</th><th className="numeric">Transferred out</th><th className="numeric">Adjustments</th><th className="numeric">Closing</th></>} empty={error || "No materials match this period and view."} renderRow={r => <tr key={`${r.siteId}/${r.id}`}><td><button type="button" className="text-link" onClick={() => setSelected(`${r.siteId}/${r.id}`)}>{r.name}</button><small>{r.unit}</small></td><td>{r.project}</td><td className="numeric">{r.opening ?? "Incomplete"}</td><td className="numeric">{r.added}</td><td className="numeric">{r.used}</td><td className="numeric">{r.transferredOut}</td><td className="numeric">{r.adjustments}</td><td className="numeric"><strong>{r.closing ?? "Incomplete"}</strong></td></tr>}/>
    <p className="helper-note">Stock added includes opening entries, posted receipts and transfers in. Quantities stay separate by project and unit. Usage is pooled across project scopes.</p>
    <RecordModal open={!!row} title={row ? `${row.name} · ${row.unit}` : "Material movements"} onClose={() => setSelected("")}>{row && <><p>{row.project} · {from} through {to}</p><div className="data-rows"><div><span>Opening entries in period</span><strong>{row.openingEntries}</strong></div><div><span>Posted receipts in period</span><strong>{row.receipts}</strong></div><div><span>Transfers in during period</span><strong>{row.transfersIn}</strong></div></div><Link className="button secondary" href={`/inventory/${row.siteId}/${row.id}`}>Open material history</Link><Register embedded rows={[...row.movements].sort((a, b) => (b.at || "").localeCompare(a.at || ""))} unit="movements" headers={<><th>Recorded</th><th>Type</th><th>Quantity</th><th>Reason / recorded by</th></>} renderRow={m => <tr key={m.id}><td>{auditTime(m.at)}</td><td>{m.kind}</td><td>{m.quantity} {m.unit}</td><td>{m.reason}<small>{actorText(m.actor, m.actorIdentity)}</small>{m.usageEntryId && <Link className="text-link" href={`/inventory/usage/${m.usageEntryId}`}>Open usage entry</Link>}</td></tr>}/></>}</RecordModal>
  </section>;
}

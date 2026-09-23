"use client";

import Link from "next/link";
import { useState } from "react";
import { useDemo } from "@/src/app-state/DemoProvider";
import { Empty, PageHeader } from "@/src/components/ui/Primitives";

export function Suppliers() {
  const { snapshot: state } = useDemo(); const [search,setSearch]=useState(""); if(!state)return null;
  const suppliers=state.suppliers.filter(s=>`${s.name} ${s.location}`.toLowerCase().includes(search.toLowerCase()));
  return <><PageHeader eyebrow="PROCUREMENT REFERENCE" title="Supplier directory" description="Accreditation references, contacts, and quotation history."/><div className="toolbar"><input aria-label="Search suppliers" placeholder="Search name or location" value={search} onChange={e=>setSearch(e.target.value)}/></div><div className="supplier-grid">{suppliers.map(s=><section className="panel supplier-panel" key={s.id}><div className="supplier-initial">{s.name.slice(0,1)}</div><h2>{s.name}</h2><p>{s.location}</p><dl><div><dt>Contact</dt><dd>{s.contact}</dd></div><div><dt>Accreditation</dt><dd>{s.accreditation}</dd></div><div><dt>Quotations</dt><dd>{state.quotes.filter(q=>q.supplierId===s.id).length}</dd></div></dl><div className="supplier-history">{state.quotes.filter(q=>q.supplierId===s.id).map(q=><Link href={`/requests/${q.mrfId}/quotes`} key={q.id}>{q.ref}<span>Open comparison →</span></Link>)}</div></section>)}</div>{!suppliers.length&&<Empty detail="No suppliers match the search."/>}</>;
}

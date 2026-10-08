"use client";
import { Register } from "@/src/components/ui/Register";
import { RecordModal } from "@/src/components/ui/RecordModal";

import Link from "next/link";
import { useState } from "react";
import { useDemo } from "@/src/app-state/DemoProvider";
import { PageHeader } from "@/src/components/ui/Primitives";

export function Suppliers() {
  const { snapshot: state } = useDemo(); const [search,setSearch]=useState(""),[selected,setSelected]=useState<string|null>(null); if(!state)return null;
  const rows=state.suppliers.filter(supplier=>`${supplier.name} ${supplier.location} ${supplier.contact}`.toLowerCase().includes(search.toLowerCase()));
  const supplier=state.suppliers.find(value=>value.id===selected);
  return <><PageHeader title="Supplier directory" description="Contacts, accreditation and supplier quotations."/>
    <Register rows={rows} resetKey={search} unit="suppliers" className="suppliers-register" filters={<input type="search" aria-label="Search suppliers" placeholder="Search supplier, location or contact" value={search} onChange={event=>setSearch(event.target.value)}/>} empty={state.suppliers.length?"No suppliers match the search.":"No suppliers yet. Procurement adds them by finalizing supplier quotations."} headers={<><th>Supplier</th><th>Location</th><th>Contact</th><th>Accreditation</th><th>Quotations</th><th>Details</th></>} renderRow={row=><tr key={row.id}><td><strong className="table-primary" title={row.name}>{row.name}</strong></td><td><span className="table-text" title={row.location}>{row.location}</span></td><td><span className="table-text" title={row.contact}>{row.contact||"--"}</span></td><td><span className="table-text" title={row.accreditation}>{row.accreditation||"--"}</span></td><td>{state.quotes.filter(quote=>quote.supplierId===row.id).length}</td><td className="register-actions"><button className="button secondary" id={`supplier-details-${row.id}`} type="button" aria-haspopup="dialog" onClick={()=>setSelected(row.id)}>Details</button></td></tr>}/>
    <RecordModal open={!!supplier} title={supplier?.name||"Supplier details"} onClose={()=>setSelected(null)} returnFocus={()=>document.getElementById(`supplier-details-${selected}`)}>{supplier&&<><div className="data-rows"><div><span>Location</span><strong>{supplier.location}</strong></div><div><span>Contact</span><strong>{supplier.contact||"--"}</strong></div><div><span>Accreditation</span><strong>{supplier.accreditation||"--"}</strong></div></div><h3>Quotation history</h3><Register embedded rows={state.quotes.filter(quote=>quote.supplierId===supplier.id)} unit="quotations" headers={<><th>Reference</th><th>Version</th><th>Status</th></>} empty="No quotations recorded for this supplier." renderRow={quote=><tr key={quote.id}><td><Link href={`/requests/${quote.mrfId}/quotes`}>{quote.ref||"Quotation draft"}</Link></td><td>{quote.version||1}</td><td>{quote.reviewStatus||"Historical quotation"}</td></tr>}/></>}</RecordModal>
  </>;
}

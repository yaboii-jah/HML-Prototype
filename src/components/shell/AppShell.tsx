"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useDemo } from "@/src/app-state/DemoProvider";
import { tasksFor } from "@/src/domain/queues";
import { ROLES, type Role } from "@/src/domain/types";

const NAV = [
  { href:"/dashboard", label:"Dashboard", symbol:"◫" }, { href:"/projects", label:"Projects", symbol:"▦" }, { href:"/requests", label:"Material requests", symbol:"▤" },
  { href:"/suppliers", label:"Suppliers", symbol:"◈" }, { href:"/purchase-orders", label:"Purchase orders", symbol:"▣" }, { href:"/finance", label:"Finance", symbol:"₱" },
  { href:"/deliveries", label:"Deliveries", symbol:"⇢" }, { href:"/inventory", label:"Site inventory", symbol:"▧" }, { href:"/accounting", label:"Accounting", symbol:"◷" },
  { href:"/reports", label:"Reports", symbol:"▥" }, { href:"/admin", label:"Administration", symbol:"⚙" },
];
const primary: Record<Role, string[]> = {
  "Site Personnel":["/dashboard","/requests","/deliveries","/inventory","/projects"],
  "Project Manager":["/dashboard","/requests","/projects","/purchase-orders"],
  Procurement:["/dashboard","/requests","/suppliers","/purchase-orders","/projects"],
  Finance:["/dashboard","/finance","/purchase-orders","/projects"],
  Logistics:["/dashboard","/deliveries","/purchase-orders","/projects"],
  "Accounting / Auditing":["/dashboard","/accounting","/inventory","/purchase-orders"],
  Management:["/dashboard","/reports","/projects","/purchase-orders","/inventory"],
  Administrator:["/dashboard","/admin","/projects","/suppliers"],
};

export function AppShell({ children }: { children: ReactNode }) {
  const { snapshot, run, notice, clearNotice } = useDemo();
  const [rolesOpen, setRolesOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => { if (!notice) return; const timer = setTimeout(clearNotice, 4500); return () => clearTimeout(timer); }, [notice, clearNotice]);
  if (!snapshot) return null;
  const tasks = tasksFor(snapshot);
  const items = [...primary[snapshot.role], ...NAV.map(item=>item.href).filter(href=>!primary[snapshot.role].includes(href))].map(href => NAV.find(item=>item.href===href)!);
  const section = NAV.find(item => pathname === item.href || pathname.startsWith(`${item.href}/`))?.label || "Workspace";
  return <div className="app-frame">
    <header className="masthead"><Link className="wordmark" href="/dashboard"><span>HML</span><strong>BuildSync</strong></Link><span className="masthead-divider"/><span className="product-label">PROJECT OPERATIONS</span><div className="masthead-right"><button className="masthead-role" onClick={()=>setRolesOpen(true)}>{snapshot.role}<span>⌄</span></button></div></header>
    <div className="app-body"><aside className="side-nav"><span className="side-caption">WORKSPACE</span><nav aria-label="Main navigation">{items.map(item => <Link key={item.href} href={item.href} className={`side-link ${pathname===item.href||pathname.startsWith(`${item.href}/`) ? "active" : ""}`}><span className="side-symbol">{item.symbol}</span><span>{item.label}</span>{tasks.some(t=>t.href.startsWith(item.href)) && <i>{tasks.filter(t=>t.href.startsWith(item.href)).length}</i>}</Link>)}</nav><div className="side-foot"><strong>HML BuildSync</strong><span>Project operations</span></div></aside>
    <div className="workspace"><div className="context-bar"><div className="breadcrumb"><span>Workspace</span><b>/</b><strong>{section}</strong></div><div className="context-actions"><label className="site-context">SITE <select aria-label="Site context" value={snapshot.siteFilter} onChange={e=>void run({type:"setSiteFilter",siteId:e.target.value})}><option value="all">All projects</option>{snapshot.sites.map(site=><option key={site.id} value={site.id}>{site.name}</option>)}</select></label><button className="notification-trigger" aria-label="Notifications" onClick={()=>setNotificationsOpen(!notificationsOpen)}>◎{tasks.length>0&&<i>{tasks.length}</i>}</button><button className="role-shortcut" onClick={()=>setRolesOpen(true)}>{snapshot.role.slice(0,1)}</button></div></div>
      {notificationsOpen && <div className="notification-popover"><strong>Needs attention</strong>{tasks.length ? tasks.slice(0,7).map(task=><Link key={task.href+task.title} href={task.href} onClick={()=>setNotificationsOpen(false)}><b>{task.title}</b><small>{task.detail} · {task.waiting} days</small></Link>) : <p>Nothing waiting for this role.</p>}</div>}
      <main className="workspace-content">{children}</main>
    </div></div>
    {rolesOpen && <div className="modal-backdrop" onMouseDown={()=>setRolesOpen(false)}><div className="modal role-modal" role="dialog" aria-modal="true" aria-label="Choose role" onMouseDown={e=>e.stopPropagation()} onKeyDown={e=>{if(e.key==="Escape")setRolesOpen(false);}}><div className="modal-head"><div><span className="eyebrow">WORKSPACE ACCESS</span><h2>Switch role</h2></div><button aria-label="Close role selector" className="icon-button" onClick={()=>setRolesOpen(false)}>×</button></div><p>Choose a role to view its work queue and available actions.</p><div className="role-options">{ROLES.map(role=><button autoFocus={role===snapshot.role} className={role===snapshot.role?"selected":""} key={role} onClick={async()=>{await run({type:"setRole",role});setRolesOpen(false);router.push("/dashboard");}}><span>{role.slice(0,1)}</span><strong>{role}</strong></button>)}</div></div></div>}
    {notice && <div className="toast" role="status">{notice}</div>}
  </div>;
}

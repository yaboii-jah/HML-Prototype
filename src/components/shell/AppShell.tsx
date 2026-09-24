"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useDemo } from "@/src/app-state/DemoProvider";
import { tasksFor } from "@/src/domain/queues";
import { ROLES, type Role } from "@/src/domain/types";

type IconName = "grid" | "building" | "request" | "supplier" | "purchase" | "finance" | "delivery" | "inventory" | "accounting" | "report" | "admin" | "bell" | "menu" | "close" | "chevron" | "moon" | "sun";
const icons: Record<IconName, ReactNode> = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
  building: <><rect x="4" y="4" width="16" height="17" rx="1.5"/><path d="M8 21v-5h8v5M8 8h2m4 0h2M8 12h2m4 0h2"/></>,
  request: <><path d="M7 3h8l4 4v14H5V3h2Z"/><path d="M14 3v5h5M8 12h8M8 16h6"/></>,
  supplier: <><circle cx="8" cy="8" r="3"/><path d="M2.5 20v-2a5.5 5.5 0 0 1 11 0v2M16 7h5m-5 4h5m-5 4h4"/></>,
  purchase: <><path d="M4 6h16v15H4zM8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M4 11h16"/></>,
  finance: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18M8 14h4"/></>,
  delivery: <><path d="M3 6h11v11H3zM14 10h4l3 3v4h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/></>,
  inventory: <><path d="m3 7 9-4 9 4v10l-9 4-9-4V7Zm0 0 9 4 9-4m-9 4v10"/></>,
  accounting: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3ZM9 8h6m-6 4h6m-6 4h4"/></>,
  report: <><path d="M4 20V4m0 16h16M8 16v-4m4 4V8m4 8V6m4 10v-6"/></>,
  admin: <><circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M19 5l-2 2M7 17l-2 2"/></>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4"/></>,
  menu: <path d="M4 6h16M4 12h16M4 18h16"/>,
  close: <path d="M5 5 19 19M19 5 5 19"/>,
  chevron: <path d="m7 10 5 5 5-5"/>,
  moon: <path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z"/>,
  sun: <><circle cx="12" cy="12" r="3.5"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></>,
};
function Icon({ name, size = 18 }: { name: IconName; size?: number }) { return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{icons[name]}</svg>; }
const subscribeTheme = (notify: () => void) => {
  const observer = new MutationObserver(notify);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
};
const getTheme = (): "light" | "dark" => document.documentElement.dataset.theme === "dark" ? "dark" : "light";
const getServerTheme = (): "light" => "light";

const NAV: { href: string; label: string; icon: IconName; group: string }[] = [
  { href: "/dashboard", label: "Dashboard", icon: "grid", group: "Overview" },
  { href: "/projects", label: "Projects", icon: "building", group: "Plan and request" },
  { href: "/requests", label: "Material requests", icon: "request", group: "Plan and request" },
  { href: "/suppliers", label: "Suppliers", icon: "supplier", group: "Purchase" },
  { href: "/purchase-orders", label: "Purchase orders", icon: "purchase", group: "Purchase" },
  { href: "/finance", label: "Finance", icon: "finance", group: "Purchase" },
  { href: "/deliveries", label: "Deliveries", icon: "delivery", group: "Receive and account" },
  { href: "/inventory", label: "Site inventory", icon: "inventory", group: "Receive and account" },
  { href: "/accounting", label: "Accounting", icon: "accounting", group: "Receive and account" },
  { href: "/reports", label: "Reports", icon: "report", group: "Manage" },
  { href: "/admin", label: "Administration", icon: "admin", group: "Manage" },
];
const primary: Record<Role, string[]> = {
  "Site Personnel": ["/dashboard", "/requests", "/deliveries", "/inventory", "/projects"],
  "Project Manager": ["/dashboard", "/requests", "/projects", "/purchase-orders"],
  Procurement: ["/dashboard", "/requests", "/purchase-orders", "/suppliers"],
  Finance: ["/dashboard", "/finance", "/purchase-orders", "/projects"],
  Logistics: ["/dashboard", "/deliveries", "/purchase-orders", "/projects"],
  "Accounting / Auditing": ["/dashboard", "/accounting", "/inventory", "/purchase-orders"],
  Management: ["/dashboard", "/reports", "/projects", "/purchase-orders"],
  Administrator: ["/dashboard", "/admin", "/projects", "/suppliers"],
};

export function AppShell({ children }: { children: ReactNode }) {
  const { snapshot, run, signOut, notice, clearNotice } = useDemo();
  const [rolesOpen, setRolesOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const theme = useSyncExternalStore(subscribeTheme, getTheme, getServerTheme);
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => { if (!notice) return; const timer = setTimeout(clearNotice, 4500); return () => clearTimeout(timer); }, [notice, clearNotice]);
  useEffect(() => { const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") { setRolesOpen(false); setNotificationsOpen(false); setMenuOpen(false); } }; window.addEventListener("keydown", onKeyDown); return () => window.removeEventListener("keydown", onKeyDown); }, []);
  if (!snapshot) return null;
  const tasks = tasksFor(snapshot);
  const section = NAV.find(item => pathname === item.href || pathname.startsWith(`${item.href}/`))?.label || "Workspace";
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const primaryItems = primary[snapshot.role].map(href => NAV.find(item => item.href === href)!);
  const secondaryItems = NAV.filter(item => !primary[snapshot.role].includes(item.href));
  const navLink = (item: typeof NAV[number]) => <Link key={item.href} href={item.href} onClick={() => setMenuOpen(false)} aria-current={isActive(item.href) ? "page" : undefined} className={`side-link ${isActive(item.href) ? "active" : ""}`}><Icon name={item.icon}/><span>{item.label}</span>{tasks.some(task => task.href.startsWith(item.href)) && <i>{tasks.filter(task => task.href.startsWith(item.href)).length}</i>}</Link>;
  return <div className="app-frame">
    {menuOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)}/>}
    <aside className={`side-nav ${menuOpen ? "is-open" : ""}`}>
      <div className="side-brand"><Link className="brand-logo" href="/dashboard" onClick={() => setMenuOpen(false)} aria-label="HML ConstructSync dashboard"><Image src="/company%20-%20logo.webp" alt="HML Technologies and Services Inc." width={190} height={45} priority/></Link><button className="mobile-close icon-button" aria-label="Close navigation" onClick={() => setMenuOpen(false)}><Icon name="close"/></button></div>
      <div className="side-product"><strong>ConstructSync</strong><span>Project operations</span></div>
      <nav aria-label="Main navigation"><div className="nav-group"><span className="side-caption">Your workspace</span>{primaryItems.map(navLink)}</div>{["Plan and request", "Purchase", "Receive and account", "Manage"].map(group => { const items = secondaryItems.filter(item => item.group === group); return items.length ? <div className="nav-group" key={group}><span className="side-caption">{group}</span>{items.map(navLink)}</div> : null; })}</nav>
      <div className="side-foot"><span className="demo-dot"/>Prototype / mock data</div>
    </aside>
    <div className="workspace">
      <header className="masthead">
        <button className="mobile-menu icon-button" aria-label="Open navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}><Icon name="menu"/></button>
        <div className="top-context"><span>Workspace</span><span className="crumb-separator">/</span><strong>{section}</strong></div>
        <div className="masthead-right">
          <label className="site-context"><span>Project</span><select aria-label="Site context" value={snapshot.siteFilter} onChange={event => void run({ type: "setSiteFilter", siteId: event.target.value })}><option value="all">All sites</option>{snapshot.sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
          <button className="theme-toggle icon-button" type="button" aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} aria-pressed={theme === "dark"} title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} onClick={() => { const nextTheme = theme === "dark" ? "light" : "dark"; document.documentElement.dataset.theme = nextTheme; try { localStorage.setItem("constructsync-theme", nextTheme); } catch {} }}><Icon name={theme === "dark" ? "sun" : "moon"}/></button>
          <div className="notification-wrap"><button className="notification-trigger icon-button" aria-label={`Notifications${tasks.length ? `, ${tasks.length} tasks` : ""}`} aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen(!notificationsOpen)}><Icon name="bell"/>{tasks.length > 0 && <i>{tasks.length}</i>}</button>{notificationsOpen && <div className="notification-popover"><div className="popover-heading"><strong>Needs attention</strong><span>{tasks.length} tasks</span></div>{tasks.length ? tasks.slice(0, 7).map(task => <Link key={task.href + task.title} href={task.href} onClick={() => setNotificationsOpen(false)}><b>{task.title}</b><small>{task.detail} · {task.waiting} days</small></Link>) : <p>Nothing waiting for this role.</p>}</div>}</div>
          <button className="masthead-role" onClick={() => setRolesOpen(true)} aria-label={`Current role: ${snapshot.role}. Switch role`}><span className="role-avatar">{snapshot.role.slice(0, 1)}</span><span className="role-label"><strong>{snapshot.role}</strong><small>Switch role</small></span><Icon name="chevron" size={16}/></button>
        </div>
      </header>
      <div className="mobile-demo"><span className="demo-dot"/>Prototype / mock data</div>
      <main className="workspace-content">{children}</main>
    </div>
    {rolesOpen && <div className="modal-backdrop" onMouseDown={() => setRolesOpen(false)}>
      <div className="modal role-modal" role="dialog" aria-modal="true" aria-label="Choose demo role" onMouseDown={event => event.stopPropagation()}>
        <div className="modal-head"><div><span className="eyebrow">Demo access</span><h2>Switch role</h2></div><button aria-label="Close role selector" className="icon-button" onClick={() => setRolesOpen(false)}><Icon name="close"/></button></div>
        <p>Choose a role to see its work queue and available actions.</p>
        <div className="role-options">{ROLES.map(role => <button autoFocus={role === snapshot.role} className={role === snapshot.role ? "selected" : ""} key={role} onClick={async () => { const result = await run({ type: "setRole", role }); if (!result.ok) return; setRolesOpen(false); router.push("/dashboard"); }}><span>{role.slice(0, 1)}</span><strong>{role}</strong></button>)}</div>
        <div className="role-modal-actions"><span>Signed in for this browser only</span><button type="button" className="button secondary" onClick={() => { signOut(); setRolesOpen(false); router.replace("/sign-in"); }}>Sign out</button></div>
      </div>
    </div>}
    {notice && <div className="toast" role="status">{notice}</div>}
  </div>;
}

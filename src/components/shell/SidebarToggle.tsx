"use client";

import { useSyncExternalStore } from "react";

const subscribe = (notify: () => void) => {
  const observer = new MutationObserver(notify);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-sidebar"] });
  return () => observer.disconnect();
};
const getCollapsed = () => document.documentElement.dataset.sidebar === "collapsed";
const getServerCollapsed = () => false;

export function SidebarToggle() {
  const collapsed = useSyncExternalStore(subscribe, getCollapsed, getServerCollapsed);
  const label = collapsed ? "Expand sidebar" : "Collapse sidebar";
  return <button type="button" className="sidebar-toggle icon-button" aria-label={label} title={label} aria-expanded={!collapsed} aria-controls="workspace-navigation" onClick={() => {
    const next = getCollapsed() ? "expanded" : "collapsed";
    document.documentElement.dataset.sidebar = next;
    try { localStorage.setItem("constructsync-sidebar", next); } catch {}
  }}><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/><path d={collapsed ? "m13 9 3 3-3 3" : "m16 9-3 3 3 3"}/></svg></button>;
}

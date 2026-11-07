"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useActionState, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { selectRoleAction } from "@/app/auth/actions";
import { SignOutForm } from "@/src/features/auth/SignOutForm";
import type { WorkspaceSession } from "@/src/domain/auth/session";
import { SidebarToggle } from "./SidebarToggle";
import { CloseButton } from "@/src/components/ui/CloseButton";
import { useFoundationRealtime } from "@/src/app-state/FoundationRealtime";

const subscribeTheme = (notify: () => void) => {
  const observer = new MutationObserver(notify);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
};
const getTheme = () => document.documentElement.dataset.theme === "dark" ? "dark" : "light";
const serverTheme = () => "light";

export function WorkspaceShell({ session: initialSession, children }: { session: WorkspaceSession; children: ReactNode }) {
  const session = useFoundationRealtime().session ?? initialSession;
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const theme = useSyncExternalStore(subscribeTheme, getTheme, serverTheme);
  const accountDialog = useRef<HTMLDialogElement>(null);
  const accountTrigger = useRef<HTMLButtonElement>(null);
  const [roleState, roleAction, rolePending] = useActionState(selectRoleAction, { error: "" });
  const initials = session.displayName.split(/\s+/).map(part => part[0]).slice(0, 2).join("");

  useEffect(() => {
    const closeMenu = (event: KeyboardEvent) => { if (event.key === "Escape") setMenuOpen(false); };
    window.addEventListener("keydown", closeMenu);
    return () => window.removeEventListener("keydown", closeMenu);
  }, []);

  return (
    <div className="app-frame" key={`${session.userId}:${session.revision}:${session.activeRole}`}>
      {menuOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)}/>}
      <aside id="workspace-navigation" className={`side-nav ${menuOpen ? "is-open" : ""}`}>
        <div className="side-brand">
          <Link className="brand-logo" href="/projects" aria-label="HML ConstructSync projects" onClick={() => setMenuOpen(false)}>
            <Image src="/company%20-%20logo.webp" alt="HML Technologies and Services Inc." width={190} height={45} priority/>
            <span className="brand-compact" aria-hidden="true">HML</span>
          </Link>
          <button className="mobile-close icon-button" aria-label="Close navigation" onClick={() => setMenuOpen(false)}>×</button>
        </div>
        <div className="side-product"><strong>ConstructSync</strong><SidebarToggle/></div>
        <div className="compact-navigation">
          <nav aria-label="Main navigation">
            <Link className={`side-link ${pathname.startsWith("/projects") ? "active" : ""}`} href="/projects" aria-label="Projects" aria-current={pathname.startsWith("/projects") ? "page" : undefined} onClick={() => setMenuOpen(false)}>
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h2m4 0h2M8 12h2m4 0h2M10 21v-5h4v5"/></svg>
              <span className="nav-label">Projects</span>
            </Link>
            <Link className={`side-link ${pathname.startsWith("/requests") ? "active" : ""}`} href="/requests" aria-label="Material requests" aria-current={pathname.startsWith("/requests") ? "page" : undefined} onClick={() => setMenuOpen(false)}><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg><span className="nav-label">Material requests</span></Link>{session.activeRole !== "Site Personnel" && <Link className={`side-link ${pathname.startsWith("/suppliers") ? "active" : ""}`} href="/suppliers" aria-label="Suppliers" aria-current={pathname.startsWith("/suppliers") ? "page" : undefined} onClick={() => setMenuOpen(false)}><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M3 21V7l9-4 9 4v14M3 11h18M8 15h2m4 0h2M8 19h2m4 0h2"/></svg><span className="nav-label">Suppliers</span></Link>}{session.activeRole === "Administrator" && <Link className={`side-link ${pathname.startsWith("/admin") ? "active" : ""}`} href="/admin" aria-label="Users" aria-current={pathname.startsWith("/admin") ? "page" : undefined} onClick={() => setMenuOpen(false)}>
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m2-16a3 3 0 0 1 0 6m2 10v-3a6 6 0 0 0-2-4"/></svg><span className="nav-label">Users</span>
            </Link>}
            {session.activeRole !== "Site Personnel" && (
              <Link className={`side-link ${pathname.startsWith("/purchase-orders") ? "active" : ""}`} href="/purchase-orders" aria-label="Purchase orders" aria-current={pathname.startsWith("/purchase-orders") ? "page" : undefined} onClick={() => setMenuOpen(false)}>
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M8 4h8m-9 1H5v16h14V5h-2M8 3h8v4H8zM8 12h8m-8 4h5"/></svg><span className="nav-label">Purchase orders</span>
              </Link>
            )}
            {session.activeRole === "Accounting" && (
              <Link className={`side-link ${pathname.startsWith("/accounting") ? "active" : ""}`} href="/accounting" aria-label="Accounting" aria-current={pathname.startsWith("/accounting") ? "page" : undefined} onClick={() => setMenuOpen(false)}>
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h3m3 0h2M8 15h3m3 0h2M8 18h3m3 0h2"/></svg>
                <span className="nav-label">Accounting</span>
              </Link>
            )}
          </nav>
        </div>
      </aside>
      <div className="workspace">
        <header className="masthead">
          <button className="mobile-menu icon-button" aria-label="Open navigation" aria-expanded={menuOpen} aria-controls="workspace-navigation" onClick={() => setMenuOpen(true)}>☰</button>
          <div className="top-context"><span>Workspace</span><span className="crumb-separator">/</span><strong>{pathname.startsWith("/projects") ? "Projects" : pathname.startsWith("/admin") ? "Users" : pathname.startsWith("/requests") ? "Material requests" : pathname.startsWith("/suppliers") ? "Suppliers" : pathname.startsWith("/purchase-orders") ? "Purchase orders" : pathname.startsWith("/accounting") ? "Accounting" : "Unavailable"}</strong></div>
          <div className="masthead-right">
            <button className="theme-toggle icon-button" type="button" aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} aria-pressed={theme === "dark"} onClick={() => {
              const next = theme === "dark" ? "light" : "dark";
              document.documentElement.dataset.theme = next;
              try { localStorage.setItem("constructsync-theme", next); } catch {}
            }}>{theme === "dark" ? "☀" : "☾"}</button>
            <button ref={accountTrigger} className="masthead-account" aria-haspopup="dialog" aria-label={`Account: ${session.displayName}, ${session.activeRole}`} onClick={() => accountDialog.current?.showModal()}>
              <span className="account-avatar">{initials}</span>
              <span className="account-label"><strong>{session.displayName}</strong><small>{session.activeRole}</small></span>
            </button>
          </div>
        </header>
        <main className="workspace-content">{children}</main>
      </div>
      <dialog ref={accountDialog} className="modal account-modal" aria-labelledby="account-title" onClose={() => accountTrigger.current?.focus({ preventScroll: true })}>
        <div className="modal-head"><h2 id="account-title">Your account</h2><CloseButton iconOnly aria-label="Close account menu" onClick={() => accountDialog.current?.close()}/></div>
        <div className="account-details"><strong>{session.displayName}</strong><small>{session.activeRole}</small><span>{session.email}</span></div>
        {session.roles.length > 1 && (
          <form action={roleAction} className="signin-form">
            <label htmlFor="switch-role">Switch role</label>
            <select id="switch-role" name="role" defaultValue={session.activeRole} required>
              {session.roles.map(role => <option key={role}>{role}</option>)}
            </select>
            <button className="button primary" disabled={rolePending}>{rolePending ? "Switching…" : "Switch role"}</button>
            {roleState.error && <p role="alert">{roleState.error}</p>}
          </form>
        )}
        <SignOutForm/>
      </dialog>
    </div>
  );
}

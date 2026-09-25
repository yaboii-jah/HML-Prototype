"use client";

import Link from "next/link";
import { activityFor } from "@/src/domain/selectors";
import { dateText, statusLabel } from "@/src/domain/format";
import type { DemoSnapshot, DocumentRef } from "@/src/domain/types";
import type { ReactNode } from "react";

const tone = (s: string) => /rejected|discrepancy|overdue/i.test(s) ? "bad" : /returned|hold|partly|review|incomplete|unpaid|low stock|pending/i.test(s) ? "warn" : /approved|served|^posted$|^complete$|^paid$|fully accepted|stock posted|in stock|active/i.test(s) ? "good" : "neutral";
export function Badge({ value, children }: { value?: string; children?: ReactNode }) { const text = value || String(children); return <span className={`badge ${tone(text)}`}>{children || statusLabel(text)}</span>; }
export function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description?: string; actions?: ReactNode }) { return <header className="page-header"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="header-actions">{actions}</div>}</header>; }
export function RecordHeader({ backHref, backLabel, eyebrow, title, badges }: { backHref: string; backLabel: string; eyebrow: string; title: string; badges: ReactNode }) { return <><Link className="back-link" href={backHref}>← {backLabel}</Link><header className="record-header"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><div className="badge-row">{badges}</div></div></header></>; }
export function Field({ label, children, hint, error }: { label: string; children: ReactNode; hint?: string; error?: string }) { return <label className={`field ${error ? "has-error" : ""}`}><span>{label}</span>{children}{hint && <small>{hint}</small>}{error && <small className="field-error">{error}</small>}</label>; }
export function Empty({ title = "No records found", detail }: { title?: string; detail: string }) { return <div className="empty"><strong>{title}</strong><p>{detail}</p></div>; }
export function Documents({ docs }: { docs: DocumentRef[] }) { return <div className="documents">{docs.length ? docs.map((doc, index) => <div className="document" key={`${doc.name}-${index}`}><span>▤</span><div><strong>{doc.name}</strong><small>{doc.type}</small></div></div>) : <p className="muted">No document references recorded.</p>}</div>; }
export function Timeline({ state, ids }: { state: DemoSnapshot; ids: string[] }) { const entries = activityFor(state, ids); return <section className="panel"><h2 className="panel-title">Activity timeline</h2>{entries.length ? <ol className="timeline">{entries.map(a => <li key={a.id}><strong>{a.action}</strong><small>{a.actor} · {dateText(a.at)}</small>{a.reason && <p>{a.reason}</p>}</li>)}</ol> : <p className="muted">No activity recorded yet.</p>}</section>; }
export function InlineError({ message }: { message?: string }) { return message ? <p className="inline-error" role="alert">{message}</p> : null; }

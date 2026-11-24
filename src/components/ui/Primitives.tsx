"use client";

import Link from "next/link";
import { statusLabel } from "@/src/domain/format";
import type { ReactNode } from "react";

const tone = (s: string) => /rejected|discrepancy|overdue/i.test(s) ? "bad" : /returned|hold|partly|review|incomplete|unpaid|low stock|out of stock|pending/i.test(s) ? "warn" : /approved|released|disbursed|^posted$|^complete$|^paid$|fully accepted|stock posted|in stock|active/i.test(s) ? "good" : "neutral";
export function Badge({ value, children }: { value?: string; children?: ReactNode }) { const text = value || String(children); return <span className={`badge ${tone(text)}`}>{children || statusLabel(text)}</span>; }
export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) { return <header className="page-header"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="header-actions">{actions}</div>}</header>; }
export function RecordHeader({ backHref, backLabel, eyebrow, title, badges }: { backHref: string; backLabel: string; eyebrow: string; title: string; badges: ReactNode }) { return <><Link className="back-link" href={backHref}>← {backLabel}</Link><header className="record-header"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><div className="badge-row">{badges}</div></div></header></>; }
export function Field({ label, children, hint, error }: { label: string; children: ReactNode; hint?: string; error?: string }) { return <label className={`field ${error ? "has-error" : ""}`}><span>{label}</span>{children}{hint && <small>{hint}</small>}{error && <small className="field-error">{error}</small>}</label>; }
export function Empty({ title = "No records found", detail }: { title?: string; detail: string }) { return <div className="empty"><strong>{title}</strong><p>{detail}</p></div>; }
export function InlineError({ message }: { message?: string }) { return message ? <p className="inline-error" role="alert">{message}</p> : null; }

import type { DemoSnapshot, PO } from "./types.ts";
import { isExternalCredit } from "./full-disbursement.ts";
import { paidTotal, poTotal } from "./selectors.ts";

export const validPaymentDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
export const philippineDate = (now = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
export const creditBalance = (state: DemoSnapshot, po: PO) => Math.max(0, Math.round((poTotal(state, po) - paidTotal(state, po.id)) * 100) / 100);
export const creditOverdue = (state: DemoSnapshot, po: PO, now = new Date()) => isExternalCredit(po) && !!po.paymentDueDate && po.paymentDueDate < philippineDate(now) && creditBalance(state, po) > 0;

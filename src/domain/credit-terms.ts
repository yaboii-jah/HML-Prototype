import { businessDate, validBusinessDate } from "./business-dates.ts";
import type { DemoSnapshot, PO } from "./types.ts";
import { isExternalCredit } from "./full-disbursement.ts";
import { paidTotal, poTotal } from "./selectors.ts";

export const validPaymentDate = validBusinessDate;
export const philippineDate = businessDate;
export const creditBalance = (state: DemoSnapshot, po: PO) => Math.max(0, Math.round((poTotal(state, po) - paidTotal(state, po.id)) * 100) / 100);
export const creditOverdue = (state: DemoSnapshot, po: PO, now = new Date()) => isExternalCredit(po) && !!po.paymentDueDate && po.paymentDueDate < philippineDate(now) && creditBalance(state, po) > 0;

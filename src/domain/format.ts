import { businessDate } from "./business-dates.ts";
export const money = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
export const dateText = (value: string) => value ? new Date(value.length === 10 ? `${value}T12:00:00` : value).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }) : "—";
export const today = businessDate;
export const roleLabel = (role: string) => role;
export const daysWaiting = (value: string) => Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86400000));
export const statusLabel = (s: string) => ({ finalized:"Finalized", approved:"Approved", released:"Released", disbursed:"Disbursed", expected:"Scheduled", dispatched:"In transit", confirmed:"To post", posted:"Posted", hold:"On hold", returned:"Returned", rejected:"Rejected", submitted:"Submitted", draft:"Draft" } as Record<string,string>)[s] || s;

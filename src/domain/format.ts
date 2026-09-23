export const money = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(value);
export const dateText = (value: string) => value ? new Date(value.length === 10 ? `${value}T12:00:00` : value).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }) : "—";
export const today = () => new Date().toISOString().slice(0, 10);
export const daysWaiting = (value: string) => Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86400000));
export const statusLabel = (s: string) => ({ finalized:"For Finance", approved:"Approved", served:"Served", expected:"Expected", confirmed:"To post", posted:"Posted", hold:"On hold", returned:"Returned", rejected:"Rejected", submitted:"Submitted", draft:"Draft" } as Record<string,string>)[s] || s;

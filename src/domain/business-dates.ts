/** Business calendar dates always refer to the Philippine project workflow. */
export function businessDate(value: Date | string = new Date()): string {
  if (typeof value === "string" && validBusinessDate(value)) return value;
  const date = typeof value === "string" ? new Date(value) : value;
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (type: string) => parts.find(p => p.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function validBusinessDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function businessRangeError(from: string, to: string): string {
  if ([from, to].some(value => value && !validBusinessDate(value))) return "Choose valid dates.";
  return from && to && from > to ? "Choose an end date on or after the start date." : "";
}
export function inBusinessRange(timestamp: string, from: string, to: string): boolean {
  if (businessRangeError(from, to)) return false;
  if (!from && !to) return true;
  const date = typeof timestamp === "string" && timestamp ? businessDate(timestamp) : "";
  return !!date && (!from || date >= from) && (!to || date <= to);
}

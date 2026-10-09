/** Keep editable cents intact while grouping the whole-number portion. */
export function formatBudgetInput(value: string): string {
  const [integer, fraction] = value.replaceAll(",", "").split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

export function budgetInputEdit(value: string, cursor: number) {
  let raw = value.replaceAll(",", "");
  if (!/^\d*(?:\.\d{0,2})?$/.test(raw)) return undefined;
  let position = value.slice(0, cursor).replaceAll(",", "").length;
  if (raw.startsWith(".")) { raw = `0${raw}`; position++; }
  const normalized = raw.replace(/^0+(?=\d)/, "");
  position = Math.max(0, position - (raw.length - normalized.length));
  const display = formatBudgetInput(normalized);
  let caret = 0, count = 0;
  while (caret < display.length && count < position) {
    if (display[caret] !== ",") count++;
    caret++;
  }
  return { raw: normalized, display, caret };
}

export const parseBudgetInput = (value: string) => Number(value.replaceAll(",", ""));

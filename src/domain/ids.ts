export const newId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
export const nextRef = (prefix: string, records: { ref: string }[]) => {
  const max = records.reduce((n, record) => Math.max(n, Number(record.ref.match(/(\d+)$/)?.[1] ?? 0)), 0);
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
};
export const materialId = (name: string, unit: string) => {
  const value = `${name.trim().toLowerCase()}|${unit.trim().toLowerCase()}`;
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `mat-${(hash >>> 0).toString(36)}`;
};

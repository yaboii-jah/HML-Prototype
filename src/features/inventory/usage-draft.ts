import { newId } from "../../domain/ids.ts";

export type UsageDraftLine = { materialId: string; name: string; unit: string; quantity: string; reason: string };
export type UsageDraft = { entryId: string; reason: string; lines: UsageDraftLine[] };
export const USAGE_DRAFT_PREFIX = "constructsync-usage-draft-v1/";
export const usageDraftKey = (account: string, workspace: string, project: string) => USAGE_DRAFT_PREFIX + [account, workspace, project].map(encodeURIComponent).join("/");
export const emptyUsageDraft = (): UsageDraft => ({ entryId: newId("usage"), reason: "", lines: [] });
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;
// Access storage inside the guarded operation, including browsers that deny the getter.
export const browserUsageStorage: Storage = {
  getItem: key => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
  removeItem: key => localStorage.removeItem(key),
};

export function restoreUsageDraft(storage: Storage, key: string): { draft: UsageDraft; error: string; blocked: boolean } {
  let raw: string | null;
  try { raw = storage.getItem(key); }
  catch { return { draft: emptyUsageDraft(), error: "The draft could not be opened. Your changes will stay on this page, but may not survive leaving it.", blocked: false }; }
  try {
    if (raw === null) return { draft: emptyUsageDraft(), error: "", blocked: false };
    const d: unknown = JSON.parse(raw);
    if (d && typeof d === "object" && "entryId" in d && typeof d.entryId === "string" && /^[a-zA-Z0-9-]{1,100}$/.test(d.entryId) && "reason" in d && typeof d.reason === "string" && "lines" in d && Array.isArray(d.lines) && d.lines.length <= 5000 && d.lines.every(line => line && [line.materialId, line.name, line.unit, line.quantity, line.reason].every(value => typeof value === "string")) && new Set(d.lines.map(line => line.materialId)).size === d.lines.length) return { draft: d as UsageDraft, error: "", blocked: false };
    return { draft: emptyUsageDraft(), error: "The saved draft could not be read. Discard it to start again; the stored draft has been preserved.", blocked: true };
  } catch {
    return { draft: emptyUsageDraft(), error: "The saved draft could not be read. Discard it to start again; the stored draft has been preserved.", blocked: true };
  }
}

export function persistUsageDraft(storage: Storage, key: string, draft: UsageDraft): string {
  try { storage.setItem(key, JSON.stringify(draft)); return ""; }
  catch { return "Your draft could not be saved. Keep this page open until you record the usage."; }
}

export function discardUsageDraft(storage: Storage, key: string): string {
  try { storage.removeItem(key); return ""; }
  catch { return "The saved draft could not be cleared. Retry when browser storage is available."; }
}

export function clearUsageDrafts(storage: globalThis.Storage) {
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter((key): key is string => !!key?.startsWith(USAGE_DRAFT_PREFIX));
  keys.forEach(key => storage.removeItem(key));
}

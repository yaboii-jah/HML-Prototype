import { UUID_PATTERN, isAuthRole, type AuthRole } from "../auth/session.ts";
import { record } from "../projects/projects.ts";

export const SUPPLIER_FIELDS = {
  name: { label: "Supplier name", limit: 200 },
  address: { label: "Address", limit: 1000 },
  tin: { label: "TIN", limit: 100 },
  contactName: { label: "Contact person", limit: 254 },
  email: { label: "Email", limit: 254 },
  phone: { label: "Phone", limit: 100 },
  accreditationNote: { label: "Accreditation note", limit: 2000 },
} as const;
export type SupplierProfile = { -readonly [K in keyof typeof SUPPLIER_FIELDS]: string };
export type Supplier = SupplierProfile & { id: string; version: string; active: boolean };
export type SupplierHistory = {
  id: string; supplierId: string; supplierName: string; actorName: string;
  actorRole: AuthRole; at: string; action: string; reason: string | null;
  changes: { before: Supplier | null; after: Supplier };
};
export type SupplierView = { role: AuthRole; suppliers: Supplier[]; history: SupplierHistory[] };
export type SupplierCommand = (
  | { type: "createSupplier"; profile: SupplierProfile }
  | { type: "saveSupplier"; supplierId: string; expectedVersion: string; profile: SupplierProfile }
  | { type: "setSupplierStatus"; supplierId: string; expectedVersion: string; active: boolean; reason: string }
) & { requestId: string };
type WithoutRequest<T> = T extends unknown ? Omit<T, "requestId"> : never;
export type SupplierInput = WithoutRequest<SupplierCommand>;
export type SupplierResult = { ok: boolean; message: string; supplierId?: string; duplicateId?: string; conflict?: boolean };
export const supplierNameKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();
const uuid = (value: unknown): value is string => typeof value === "string" && UUID_PATTERN.test(value);
const version = (value: unknown): value is string => typeof value === "string" && /^[1-9]\d{0,18}$/.test(value);

export function parseSupplierProfile(value: unknown): SupplierProfile | null {
  const raw = record(value);
  if (!raw) return null;
  const profile: SupplierProfile = { name: "", address: "", tin: "", contactName: "", email: "", phone: "", accreditationNote: "" };
  for (const key of Object.keys(SUPPLIER_FIELDS) as (keyof SupplierProfile)[]) {
    const field = raw[key];
    if (typeof field !== "string" || field.trim().length > SUPPLIER_FIELDS[key].limit) return null;
    profile[key] = field.trim();
  }
  if (!profile.name || (profile.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email))) return null;
  return profile;
}
export function parseSupplier(value: unknown): Supplier | null {
  const raw = record(value), profile = parseSupplierProfile(value);
  return raw && profile && uuid(raw.id) && version(raw.version) && typeof raw.active === "boolean"
    ? { ...profile, id: raw.id, version: raw.version, active: raw.active } : null;
}
export function parseSupplierCommand(value: unknown): SupplierCommand | null {
  const raw = record(value);
  if (!raw || !uuid(raw.requestId)) return null;
  const base = { requestId: raw.requestId };
  if (raw.type === "createSupplier") {
    const profile = parseSupplierProfile(raw.profile);
    return profile ? { ...base, type: raw.type, profile } : null;
  }
  if (!uuid(raw.supplierId) || !version(raw.expectedVersion)) return null;
  const edit = { ...base, supplierId: raw.supplierId, expectedVersion: raw.expectedVersion };
  if (raw.type === "saveSupplier") {
    const profile = parseSupplierProfile(raw.profile);
    return profile ? { ...edit, type: raw.type, profile } : null;
  }
  if (raw.type === "setSupplierStatus" && typeof raw.active === "boolean" && typeof raw.reason === "string"
    && raw.reason.trim().length >= 5 && raw.reason.trim().length <= 2000) {
    return { ...edit, type: raw.type, active: raw.active, reason: raw.reason.trim() };
  }
  return null;
}
export function parseSupplierView(value: unknown): SupplierView | null {
  const raw = record(value);
  if (!raw || !isAuthRole(raw.role) || raw.role === "Site Personnel" || !Array.isArray(raw.suppliers) || !Array.isArray(raw.history)) return null;
  const suppliers: Supplier[] = [], history: SupplierHistory[] = [];
  for (const item of raw.suppliers) {
    const supplier = parseSupplier(item);
    if (!supplier) return null;
    suppliers.push(supplier);
  }
  for (const item of raw.history) {
    const h = record(item), changes = record(h?.changes), after = parseSupplier(changes?.after);
    const before = changes?.before === null ? null : parseSupplier(changes?.before);
    if (!h || !uuid(h.id) || !uuid(h.supplierId) || typeof h.supplierName !== "string"
      || typeof h.actorName !== "string" || !isAuthRole(h.actorRole) || typeof h.action !== "string"
      || typeof h.at !== "string" || !Number.isFinite(Date.parse(h.at))
      || !(h.reason === null || typeof h.reason === "string") || !after || (changes?.before !== null && !before)) return null;
    history.push({ id: h.id, supplierId: h.supplierId, supplierName: h.supplierName, actorName: h.actorName,
      actorRole: h.actorRole, at: h.at, action: h.action, reason: h.reason, changes: { before, after } });
  }
  return { role: raw.role, suppliers, history };
}

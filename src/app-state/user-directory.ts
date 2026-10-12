import { ACCOUNT_FIXTURES } from "./account-fixtures.ts";
import { ROLES, type Role, type Activity, type AuditIdentity } from "../domain/types.ts";

export const USER_STORAGE_KEY = "hml-constructsync-users-v1";
const ITERATIONS = 600_000;
type Credential = { salt: string; hash: string };
export type ManagedUser = { id: string; name: string; email: string; role: Role; siteIds?: string[]; active: boolean; revision: number; createdAt: string; updatedAt: string };
type StoredUser = ManagedUser & { credential: Credential };
type Data = { version: 1; users: StoredUser[]; activity: Activity[] };
export type UserDirectoryView = { users: ManagedUser[]; activity: Activity[]; status: "loading" | "ready" | "volatile" | "recovery"; error?: string };
export const serverUserDirectory: UserDirectoryView = { users: [], activity: [], status: "loading" };
export type UserChange = { type: "add"; name: string; email: string; role: Role; password: string; siteIds?: string[] } | { type: "edit"; id: string; revision: number; name: string; email: string; role: Role; siteIds?: string[] } | { type: "status"; id: string; revision: number; active: boolean } | { type: "password"; id: string; revision: number; password: string };
const publicUser = (user: StoredUser): ManagedUser => ({ id: user.id, name: user.name, email: user.email, role: user.role, siteIds: [...(user.siteIds || [])], active: user.active, revision: user.revision, createdAt: user.createdAt, updatedAt: user.updatedAt });
const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
async function derive(password: string, salt: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bytes = Uint8Array.from(salt.match(/.{2}/g)!, value => parseInt(value, 16));
  return hex(new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt: bytes, iterations: ITERATIONS, hash: "SHA-256" }, key, 256)));
}
async function credential(password: string): Promise<Credential> {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  return { salt, hash: await derive(password, salt) };
}
const passwordError = (value: string) => value.length < 8 || value.length > 128 || !value.trim() ? "Use a password between 8 and 128 characters." : "";
const profileError = (name: string, email: string, role: Role) => !name.trim() || name.trim().length > 100 ? "Enter a name of up to 100 characters." : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 ? "Enter a valid email address." : !ROLES.includes(role) ? "Choose an active department role." : "";
function parse(raw: string): Data {
  const data = JSON.parse(raw) as Data;
  if (data.users?.some(user => user.siteIds !== undefined && (!Array.isArray(user.siteIds) || user.siteIds.some(id => typeof id !== "string" || !id.trim()) || new Set(user.siteIds).size !== user.siteIds.length))) throw new Error("Saved project assignments could not be read.");
  if (data.version !== 1 || !Array.isArray(data.users) || !Array.isArray(data.activity) || data.users.some(user => !user || typeof user.id !== "string" || !user.id || typeof user.name !== "string" || typeof user.email !== "string" || profileError(user.name, user.email, user.role) || typeof user.active !== "boolean" || !Number.isInteger(user.revision) || user.revision < 1 || !/^[a-f0-9]{32}$/.test(user.credential?.salt) || !/^[a-f0-9]{64}$/.test(user.credential?.hash)) || new Set(data.users.map(user => user.id)).size !== data.users.length || new Set(data.users.map(user => user.email)).size !== data.users.length || !data.users.some(user => user.active && user.role === "Administrator")) throw new Error("Saved user accounts could not be read. The existing directory has been preserved.");
  return data;
}

export class LocalUserDirectory {
  private data: Data | null = null;
  private view = serverUserDirectory;
  private listeners = new Set<() => void>();
  private loading: Promise<void> | undefined;
  private storage: () => Storage | undefined;
  constructor(storage: () => Storage | undefined = () => typeof window !== "undefined" ? localStorage : undefined) {
    this.storage = storage;
    if (typeof window !== "undefined") window.addEventListener("storage", event => { if (event.key === USER_STORAGE_KEY || event.key === null) this.refresh(); });
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  getSnapshot() { return this.view; }
  private publish(status: UserDirectoryView["status"], error?: string) {
    this.view = { users: this.data?.users.map(publicUser) || [], activity: this.data?.activity || [], status, ...(error ? { error } : {}) };
    this.listeners.forEach(listener => listener());
  }
  refresh() {
    try {
      const raw = this.storage()?.getItem(USER_STORAGE_KEY);
      if (!raw) { this.data = null; this.publish("recovery", "The saved user directory is unavailable. Reload after restoring browser storage."); return; }
      this.data = parse(raw); this.publish("ready");
    } catch (cause) { this.data = null; this.publish("recovery", cause instanceof Error ? cause.message : "User accounts could not be read."); }
  }
  async load() {
    if (this.view.status !== "loading") return;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        const store = this.storage(), raw = store?.getItem(USER_STORAGE_KEY);
        if (raw) { this.data = parse(raw); this.publish("ready"); return; }
        const at = new Date().toISOString();
        const users = await Promise.all(ACCOUNT_FIXTURES.map(async account => ({ id: `bootstrap-${account.role.toLowerCase().replace(/[^a-z]+/g, "-")}`, name: account.name, email: account.email, role: account.role, active: true, revision: 1, createdAt: at, updatedAt: at, credential: await credential(account.password) })));
        // Another tab may have initialized or edited the directory while hashing.
        const existing = store?.getItem(USER_STORAGE_KEY);
        this.data = existing ? parse(existing) : { version: 1, users, activity: [] };
        try { store?.setItem(USER_STORAGE_KEY, JSON.stringify(this.data)); this.publish(store ? "ready" : "volatile"); }
        catch { this.publish("volatile", "Accounts are available for this session, but browser storage could not save them."); }
      } catch (cause) { this.publish("recovery", cause instanceof Error ? cause.message : "User accounts could not be loaded."); }
    })();
    return this.loading;
  }
  async authenticate(email: string, password: string): Promise<ManagedUser | null> {
    await this.load();
    const user = this.data?.users.find(value => value.email === email.trim().toLowerCase() && value.active);
    if (!user || password.length > 128 || await derive(password, user.credential.salt) !== user.credential.hash) return null;
    const current = this.currentData()?.users.find(value => value.id === user.id);
    return current?.active && current.revision === user.revision ? publicUser(current) : null;
  }
  private currentData() {
    const raw = this.storage()?.getItem(USER_STORAGE_KEY);
    return raw ? parse(raw) : this.view.status === "volatile" ? this.data : null;
  }
  async change(actor: AuditIdentity, input: UserChange): Promise<{ ok: boolean; message: string }> {
    await this.load();
    try {
      const before = this.currentData();
      const authorized = (data: Data | null) => data?.users.find(user => user.id === actor.userId && user.email === actor.email && user.role === "Administrator" && actor.role === "Administrator" && user.active && user.revision === actor.sessionRevision);
      if (!authorized(before)) return { ok: false, message: "Sign in as an active Administrator to manage users." };
      if (input.type === "password" || input.type === "add") { const invalid = passwordError(input.password); if (invalid) return { ok: false, message: invalid }; }
      if (input.type === "add" || input.type === "edit") { const invalid = profileError(input.name, input.email.trim().toLowerCase(), input.role); if (invalid) return { ok: false, message: invalid }; }
      if ((input.type === "add" || input.type === "edit") && input.siteIds !== undefined && (!Array.isArray(input.siteIds) || input.siteIds.some(id => typeof id !== "string" || !id.trim()) || new Set(input.siteIds).size !== input.siteIds.length)) return { ok: false, message: "Choose unique project assignments." };
      const newCredential = input.type === "add" || input.type === "password" ? await credential(input.password) : undefined;
      const data = structuredClone(this.currentData());
      const administrator = authorized(data);
      if (!data || !administrator) return { ok: false, message: "Your account changed. Sign in and try again." };
      const user = input.type === "add" ? undefined : data.users.find(value => value.id === input.id);
      if (input.type !== "add" && (!user || user.revision !== input.revision)) return { ok: false, message: "This user changed. Reopen the form and try again." };
      if ((input.type === "add" || input.type === "edit") && data.users.some(value => value.email === input.email.trim().toLowerCase() && value.id !== user?.id)) return { ok: false, message: "This email is already assigned to a user." };
      if (input.type === "status" && !input.active && user?.id === administrator.id) return { ok: false, message: "You cannot deactivate your own account." };
      const removesAdministrator = user?.active && user.role === "Administrator" && (input.type === "status" && !input.active || input.type === "edit" && input.role !== "Administrator");
      if (removesAdministrator && data.users.filter(value => value.active && value.role === "Administrator").length === 1) return { ok: false, message: "Keep at least one active Administrator." };
      const at = new Date().toISOString();
      let target = user, action = "", fields: string[] = [];
      if (input.type === "add") {
        target = { id: crypto.randomUUID(), name: input.name.trim(), email: input.email.trim().toLowerCase(), role: input.role, siteIds: input.role === "Site Personnel" ? [...(input.siteIds || [])] : [], active: true, revision: 1, createdAt: at, updatedAt: at, credential: newCredential! };
        data.users.push(target); action = "User added"; fields = ["Name", "Email", "Role"];
      } else if (input.type === "edit") {
        const email = input.email.trim().toLowerCase(), name = input.name.trim();
        const siteIds = input.role === "Site Personnel" ? [...(input.siteIds ?? target!.siteIds ?? [])].sort() : [];
        const assignmentsChanged = JSON.stringify(siteIds) !== JSON.stringify([...(target!.siteIds || [])].sort());
        fields = [target!.name !== name ? "Name" : "", target!.email !== email ? "Email" : "", target!.role !== input.role ? "Role" : ""].filter(Boolean);
        if (assignmentsChanged) fields.push("Assigned projects");
        if (!fields.length) return { ok: true, message: "User details unchanged." };
        if (target!.email !== email || target!.role !== input.role || assignmentsChanged) target!.revision++;
        Object.assign(target!, { name, email, role: input.role, siteIds }); action = "User details updated";
      } else if (input.type === "password") {
        target!.credential = newCredential!; target!.revision++; action = "User password reset";
      } else {
        if (target!.active === input.active) return { ok: true, message: "User status unchanged." };
        target!.active = input.active; target!.revision++; action = input.active ? "User reactivated" : "User deactivated"; fields = ["Status"];
      }
      target!.updatedAt = at;
      data.activity.unshift({ id: crypto.randomUUID(), entity: target!.id, entityType: "user", entityRef: `${target!.name} / ${target!.email}`, eventType: "user.changed", action, changedFields: fields, actor: "Administrator", actorIdentity: { name: administrator.name, email: administrator.email, role: "Administrator", userId: administrator.id }, at });
      const store = this.storage(); if (!store) return { ok: false, message: "Browser storage is required to save user changes." };
      store.setItem(USER_STORAGE_KEY, JSON.stringify(data)); this.data = data; this.publish("ready");
      return { ok: true, message: `${action}.` };
    } catch { return { ok: false, message: "User changes could not be saved. Existing accounts remain unchanged." }; }
  }
}
export const userDirectory = new LocalUserDirectory();

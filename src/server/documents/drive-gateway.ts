import { createHash } from "node:crypto";

export type DriveMetadata = { id: string; name: string; mimeType: string; size?: string; parents: string[]; trashed: boolean; properties: Record<string, string>; writable: boolean };
const FOLDER = "application/vnd.google-apps.folder";
const fields = "id,name,mimeType,size,parents,trashed,appProperties,capabilities(canAddChildren)";
export class DriveError extends Error {
  readonly status: number;
  constructor(status: number) { super("The document provider could not complete the operation."); this.status = status; }
}
function metadata(raw: unknown): DriveMetadata {
  if (!raw || typeof raw !== "object") throw Error("Invalid Drive metadata");
  const value = raw as Record<string, unknown>;
  if (typeof value.id !== "string" || typeof value.name !== "string" || typeof value.mimeType !== "string"
    || value.size !== undefined && (typeof value.size !== "string" || !/^\d+$/.test(value.size))
    || value.parents !== undefined && (!Array.isArray(value.parents) || value.parents.some(v => typeof v !== "string"))) throw Error("Invalid Drive metadata");
  const properties = value.appProperties;
  if (properties !== undefined && (!properties || typeof properties !== "object" || Object.values(properties).some(v => typeof v !== "string"))) throw Error("Invalid Drive tags");
  const capabilities = value.capabilities as { canAddChildren?: boolean } | undefined;
  return { id: value.id, name: value.name, mimeType: value.mimeType, size: value.size, parents: (value.parents ?? []) as string[], trashed: value.trashed === true,
    properties: (properties ?? {}) as Record<string, string>, writable: capabilities?.canAddChildren === true };
}
/** Provider transport. Tests inject a loopback origin/token; production uses Google's origin. */
export function createDriveGateway(origin: string, accessToken: () => Promise<string>) {
  const api = `${origin}/drive/v3/files`, uploadApi = `${origin}/upload/drive/v3/files`;
  async function request(url: string, init: RequestInit = {}, allowed: number[] = []) {
    const parsed = new URL(url);
    if (parsed.origin !== origin || parsed.username || parsed.password) throw Error("Invalid provider destination");
    const response = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${await accessToken()}` }, cache: "no-store", redirect: "manual", signal: init.signal ?? AbortSignal.timeout(90000) });
    if (!response.ok && !allowed.includes(response.status)) { await response.body?.cancel(); throw new DriveError(response.status); }
    return response;
  }
  async function get(id: string) { return metadata(await (await request(`${api}/${encodeURIComponent(id)}?supportsAllDrives=true&fields=${encodeURIComponent(fields)}`)).json()); }
  async function find(id: string) { try { return await get(id); } catch (e) { if (e instanceof DriveError && e.status === 404) return null; throw e; } }
  async function generateId() {
    const raw: unknown = await (await request(`${api}/generateIds?count=1&space=drive&type=files`)).json();
    const ids = raw && typeof raw === "object" && "ids" in raw ? raw.ids : null;
    if (!Array.isArray(ids) || ids.length !== 1 || typeof ids[0] !== "string" || !/^[\w-]+$/.test(ids[0])) throw Error("Invalid provider file identity");
    return ids[0];
  }
  async function validateFolder(id: string, root: string) {
    if (id === root) throw Error("Choose a project folder below the company root.");
    const file = await get(id);
    if (file.trashed || file.mimeType !== FOLDER || !file.writable) throw Error("Choose a writable project folder.");
    const seen = new Set<string>(); let cursor: DriveMetadata | null = file;
    while (cursor && !seen.has(cursor.id) && seen.size < 100) {
      seen.add(cursor.id);
      if (cursor.parents.includes(root)) {
        const parent = await get(root);
        if (parent.trashed || parent.mimeType !== FOLDER || !parent.writable) throw Error("Company root is unavailable");
        return file;
      }
      cursor = cursor.parents[0] ? await get(cursor.parents[0]) : null;
      if (cursor?.trashed) throw Error("Parent folder is trashed");
    }
    throw Error("Choose a descendant of the configured company root.");
  }
  function verifyIdentity(file: DriveMetadata, parent: string, tags: Record<string, string>, mime = "application/pdf") {
    if (file.trashed || file.mimeType !== mime || !file.parents.includes(parent) || Object.entries(tags).some(([key, value]) => file.properties[key] !== value)) throw Error("Provider file identity does not match this operation");
  }
  async function ensureFolder(id: string, parent: string, name: string, tags: Record<string, string>) {
    let file = await find(id);
    if (!file) {
      const root = await get(parent);
      if (root.trashed || root.mimeType !== FOLDER || !root.writable) throw Error("Destination is unavailable");
      const response = await request(`${api}?supportsAllDrives=true&fields=${encodeURIComponent(fields)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, name, mimeType: FOLDER, parents: [parent], appProperties: tags }) }, [409]);
      await response.body?.cancel(); file = await get(id);
    }
    verifyIdentity(file, parent, tags, FOLDER);
    if (!file.writable) throw Error("Destination cannot receive files");
    return file;
  }
  async function begin(id: string, parent: string, name: string, size: number, tags: Record<string, string>) {
    const response = await request(`${uploadApi}?uploadType=resumable&supportsAllDrives=true&fields=${encodeURIComponent(fields)}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Upload-Content-Type": "application/pdf", "X-Upload-Content-Length": String(size) }, body: JSON.stringify({ id, name, mimeType: "application/pdf", parents: [parent], appProperties: tags }) }, [409]);
    if (response.status === 409) { await response.body?.cancel(); return null; }
    const uri = response.headers.get("location"); await response.body?.cancel();
    if (!uri || !validSession(uri)) throw Error("Invalid upload session");
    return uri;
  }
  function validSession(uri: string) {
    try { const url = new URL(uri); return url.origin === origin && !url.username && !url.password && /^\/upload\/drive\/v3\/files(?:\/[\w-]+)?$/.test(url.pathname) && url.searchParams.get("uploadType") === "resumable" && !!url.searchParams.get("upload_id"); } catch { return false; }
  }
  async function transfer(uri: string, total: number, bytes?: Uint8Array, offset = 0) {
    if (!validSession(uri)) throw Error("Invalid upload session");
    const response = await request(uri, { method: "PUT", headers: { "Content-Type": "application/pdf", "Content-Range": bytes ? `bytes ${offset}-${offset + bytes.length - 1}/${total}` : `bytes */${total}` }, body: bytes ? Buffer.from(bytes) : undefined }, [308, 404, 410]);
    if ([404, 410].includes(response.status)) { await response.body?.cancel(); return { expired: true, offset: 0, complete: false }; }
    const range = response.headers.get("range"); await response.body?.cancel();
    const confirmed = response.status === 308 ? range ? /^bytes=0-(\d+)$/.exec(range) : null : null;
    const next = response.status === 308 ? confirmed ? Number(confirmed[1]) + 1 : 0 : total;
    if (!Number.isSafeInteger(next) || next < 0 || next > total || response.status === 308 && next !== total && next % (256 * 1024)) throw Error("Invalid provider offset");
    return { expired: false, offset: next, complete: response.status !== 308 };
  }
  async function stream(id: string, range?: { start: number; end: number }, signal?: AbortSignal) {
    const response = await request(`${api}/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`, { headers: { "Accept-Encoding": "identity", ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}) }, signal });
    if (range && response.status !== 206) { await response.body?.cancel(); throw Error("Provider did not honor range"); }
    if (range && !response.headers.get("content-range")?.startsWith(`bytes ${range.start}-${range.end}/`)) { await response.body?.cancel(); throw Error("Provider returned a different range"); }
    return response;
  }
  async function bytes(id: string, max: number) {
    const response = await stream(id), reader = response.body?.getReader();
    if (!reader) throw Error("Document body missing");
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > max) throw Error("Document is too large"); chunks.push(next.value); }
    } finally { await reader.cancel(); }
    return Buffer.concat(chunks, size);
  }
  async function verifyPdf(id: string, parent: string, tags: Record<string, string>, size: number, sha256: string) {
    const file = await get(id); verifyIdentity(file, parent, tags);
    if (file.size !== String(size)) throw Error("Document size mismatch");
    const body = await bytes(id, size);
    if (body.length !== size || createHash("sha256").update(body).digest("hex") !== sha256) throw Error("Document integrity mismatch");
    return body;
  }
  async function trash(id: string, tags: Record<string, string>) {
    const file = await find(id);
    if (!file) return;
    if (Object.entries(tags).some(([key, value]) => file.properties[key] !== value)) throw Error("Cleanup ownership mismatch");
    if (!file.trashed) { const response = await request(`${api}/${encodeURIComponent(id)}?supportsAllDrives=true`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: '{"trashed":true}' }); await response.body?.cancel(); }
    if (!(await get(id)).trashed) throw Error("Cleanup was not confirmed");
  }
  return { get, find, generateId, validateFolder, verifyIdentity, ensureFolder, begin, transfer, validSession, stream, bytes, verifyPdf, trash };
}
export type DriveGateway = ReturnType<typeof createDriveGateway>;

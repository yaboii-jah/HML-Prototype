import { buildShowcase } from "./fixtures/showcase.ts";
import { deleteLocalFile, listLocalFiles, saveGeneratedFile } from "../features/requests/quote-files.ts";
import { showcaseAssignments, USER_STORAGE_KEY, userDirectory } from "../app-state/user-directory.ts";
import type { DemoSnapshot } from "../domain/types.ts";
import { localArchiveUrl } from "../domain/archive-destination.ts";

export const SHOWCASE_MARKER = "hml-constructsync-showcase-installed-v1";
const JOURNAL = "hml-constructsync-showcase-installing-v1";
const CURRENT = "hml-constructsync-demo-v12";
export type ShowcaseBackup = { id: string; createdAt: string; records: [string, string][]; directory: string; files: { id: string; blob: Blob }[] };
async function backupStore<T>(action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open("hml-constructsync-showcase-backups", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("backups", { keyPath: "id" });
    open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("backups", "readwrite"), request = action(tx.objectStore("backups"));
      tx.oncomplete = () => resolve(request.result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
export const readShowcaseBackup = (id: string) => backupStore<ShowcaseBackup | undefined>(store => store.get(id));
async function restore(backup: ShowcaseBackup, storage: Storage) {
  for (const key of Object.keys(storage).filter(key => /^hml-(constructsync|buildsync)-demo-v\d+$/.test(key))) storage.removeItem(key);
  for (const [key, value] of backup.records) storage.setItem(key, value);
  storage.setItem(USER_STORAGE_KEY, backup.directory);
}
export async function installShowcase(validate: (raw: string) => DemoSnapshot | null) {
  const install = async () => {
    const storage = localStorage;
    if (storage.getItem(SHOWCASE_MARKER)) return;
    await userDirectory.load();
    if (userDirectory.getSnapshot().status !== "ready") throw new Error("Saved accounts must be available before the populated workspace can be installed.");
    const interrupted = storage.getItem(JOURNAL);
    if (interrupted) {
      const backup = await readShowcaseBackup(interrupted);
      if (!backup) throw new Error("The interrupted installation backup is unavailable. Existing storage has been preserved.");
      await restore(backup, storage); storage.removeItem(JOURNAL);
    }
    const installationId = crypto.randomUUID(), now = new Date();
    const backup: ShowcaseBackup = { id: installationId, createdAt: now.toISOString(), records: Object.keys(storage).filter(key => /^hml-(constructsync|buildsync)-demo-v\d+$/.test(key)).map(key => [key, storage.getItem(key)!]), directory: storage.getItem(USER_STORAGE_KEY)!, files: await listLocalFiles() };
    await backupStore(store => store.put(backup));
    const staged: string[] = [];
    try {
      const { snapshot, documents } = buildShowcase(installationId, now);
      const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
      const metadata = new Map<string, { size: number; sha256: string }>();
      for (const document of documents) {
        const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
        let page = pdf.addPage([612, 792]), y = 740;
        for (const text of ["HML TECHNOLOGIES AND SERVICES INC.", document.name, "", ...document.lines, "", "Demonstration copy - fictional project records"]) {
          // Built-in PDF fonts accept WinAnsi; keep fictional documents portable.
          const plain = text.replace(/[^\x20-\x7e]/g, " ");
          const chunks = plain.match(/.{1,85}(?:\s|$)|.{1,85}/g) || [""];
          for (const chunk of chunks) {
            if (y < 60) { page = pdf.addPage([612, 792]); y = 740; }
            page.drawText(chunk, { x: 42, y, size: 11, font, color: rgb(0.12, 0.19, 0.3) }); y -= 20;
          }
        }
        const bytes = await pdf.save(), blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
        await saveGeneratedFile(document.id, blob); staged.push(document.id);
        metadata.set(document.id, { size: blob.size, sha256: Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())), b => b.toString(16).padStart(2, "0")).join("") });
      }
      const patch = (value: unknown) => {
        if (!value || typeof value !== "object") return;
        const record = value as Record<string, unknown>;
        if (typeof record.localFileId === "string" && metadata.has(record.localFileId)) Object.assign(record, metadata.get(record.localFileId));
        Object.values(record).forEach(child => { if (typeof child === "object") patch(child); });
      };
      patch(snapshot);
      for (const report of snapshot.bidReports) for (const format of ["xlsx", "pdf"] as const) {
        const response = await fetch(`/api/bid-comparisons?format=${format}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(report) });
        if (!response.ok) throw new Error("The local comparison documents could not be generated. Existing records remain unchanged.");
        const blob = await response.blob(), fileId = `local-${installationId}-${report.id}-${format}`;
        await saveGeneratedFile(fileId, blob); staged.push(fileId);
        const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())), b => b.toString(16).padStart(2, "0")).join("");
        const artifact = format === "pdf" ? report.pdf! : report;
        artifact.localFileId = fileId; artifact.sha256 = sha256; artifact.archive = { status: "complete", fileId, url: localArchiveUrl(fileId) };
      }
      const raw = JSON.stringify(snapshot);
      if (!validate(raw)) throw new Error("The populated workspace did not pass validation. Existing records remain unchanged.");
      const directory = showcaseAssignments(storage.getItem(USER_STORAGE_KEY)!, snapshot.sites.map(s => s.id), now.toISOString());
      storage.setItem(JOURNAL, installationId);
      storage.setItem(CURRENT, raw);
      storage.setItem(USER_STORAGE_KEY, directory);
      storage.setItem(SHOWCASE_MARKER, JSON.stringify({ revision: 1, installationId, installedAt: now.toISOString(), backupId: installationId }));
      storage.removeItem(JOURNAL);
      userDirectory.refresh();
    } catch (cause) {
      if (storage.getItem(JOURNAL) === installationId) { await restore(backup, storage); storage.removeItem(JOURNAL); }
      await Promise.allSettled(staged.map(deleteLocalFile));
      throw cause;
    }
  };
  if (navigator.locks) await navigator.locks.request("constructsync-showcase-install", install);
  else await install();
}

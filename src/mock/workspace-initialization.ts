import { blankWorkspace } from "./fixtures/blank.ts";
import { clearQuoteFiles } from "../features/requests/quote-files.ts";
import { clearProjectAssignments, USER_STORAGE_KEY, userDirectory } from "../app-state/user-directory.ts";
import { demoSession, SESSION_STORAGE_KEY } from "../app-state/demo-session.ts";
import type { Role } from "../domain/types.ts";

export const EMPTY_WORKSPACE_MARKER = "hml-constructsync-empty-workspace-v1";
const CURRENT_KEY = "hml-constructsync-demo-v12";
const legacyMarkers = ["hml-constructsync-showcase-installed-v1", "hml-constructsync-showcase-installing-v1"];

export function clearShowcaseBackups(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase("hml-constructsync-showcase-backups");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error("Old workspace backups could not be cleared."));
    request.onblocked = () => reject(new Error("Close other ConstructSync tabs, then retry workspace setup."));
  });
}

type InitializationOptions = {
  storage: Storage;
  clearFiles: () => Promise<void>;
  clearBackups: () => Promise<void>;
  force?: boolean;
  preserveSession?: boolean;
  role?: Role;
};

/** The marker is committed last: an interrupted cleanup must finish before records can be used. */
export async function clearOperationalStorage({ storage, clearFiles, clearBackups, force = false, preserveSession = false, role }: InitializationOptions) {
  if (!force && storage.getItem(EMPTY_WORKSPACE_MARKER) === "1") return;
  const rawDirectory = storage.getItem(USER_STORAGE_KEY);
  const directory = rawDirectory ? clearProjectAssignments(rawDirectory) : null;
  await clearFiles();
  await clearBackups();
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
  for (const key of keys) {
    if (key && (/^hml-(constructsync|buildsync)-demo-v\d+$/.test(key) || key.startsWith("constructsync-usage-draft-v1/") || key.startsWith("constructsync-stock-draft-v1/") || legacyMarkers.includes(key))) storage.removeItem(key);
  }
  storage.setItem(CURRENT_KEY, JSON.stringify({ ...blankWorkspace(), ...(role ? { role } : {}) }));
  // Revoke startup sessions before assignment updates notify other tabs.
  if (!preserveSession) storage.removeItem(SESSION_STORAGE_KEY);
  storage.removeItem("hml-constructsync-demo-session-v1");
  const latestDirectory = storage.getItem(USER_STORAGE_KEY);
  const clearedDirectory = latestDirectory !== rawDirectory && latestDirectory !== null ? clearProjectAssignments(latestDirectory) : directory;
  if (clearedDirectory !== null && clearedDirectory !== latestDirectory) storage.setItem(USER_STORAGE_KEY, clearedDirectory);
  storage.setItem(EMPTY_WORKSPACE_MARKER, "1");
}

let initialization: Promise<void> | undefined;
export function initializeEmptyWorkspace(): Promise<void> {
  if (initialization) return initialization;
  const initialize = async () => {
    if (localStorage.getItem(EMPTY_WORKSPACE_MARKER) === "1") return;
    await userDirectory.load();
    if (userDirectory.getSnapshot().status !== "ready") throw new Error("Saved user accounts must be available before clearing operational data.");
    await clearOperationalStorage({ storage: localStorage, clearFiles: clearQuoteFiles, clearBackups: clearShowcaseBackups });
    demoSession.clear();
    userDirectory.refresh();
  };
  initialization = (async () => {
    if (navigator.locks) await navigator.locks.request("constructsync-workspace-initialization", initialize);
    else await initialize();
  })().finally(() => { initialization = undefined; });
  return initialization;
}

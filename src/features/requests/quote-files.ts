import { newId } from "../../domain/ids.ts";
import type { DocumentRef } from "../../domain/types.ts";

const DATABASE = "hml-quotation-files";
const STORE = "files";

function openFiles(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveQuoteFiles(files: File[]): Promise<DocumentRef[]> {
  const database = await openFiles();
  try {
    const documents: DocumentRef[] = [];
    for (const file of files) {
      const fileId = newId("quote-file");
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(STORE, "readwrite");
        transaction.objectStore(STORE).put(file, fileId);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
      documents.push({ name: file.name, type: file.type, fileId });
    }
    return documents;
  } finally { database.close(); }
}

export async function saveRequestFile(file: File, kind: "Scope" | "Signed MRF" | "Supporting document"): Promise<DocumentRef> {
  const database = await openFiles();
  try {
    const fileId = newId("request-file");
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).put(file, fileId);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    return { name: file.name, type: kind, fileId };
  } finally { database.close(); }
}

export async function deleteLocalFile(fileId: string): Promise<void> {
  const database = await openFiles();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).delete(fileId);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { database.close(); }
}

export async function readQuoteFile(fileId: string): Promise<Blob | undefined> {
  const database = await openFiles();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(STORE, "readonly").objectStore(STORE).get(fileId);
      request.onsuccess = () => resolve(request.result as Blob | undefined);
      request.onerror = () => reject(request.error);
    });
  } finally { database.close(); }
}

export async function openQuoteFile(fileId: string) {
  const file = await readQuoteFile(fileId);
  if (!file) throw new Error("The original file is no longer available in this browser.");
  const url = URL.createObjectURL(file);
  window.open(url, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function clearQuoteFiles() {
  const database = await openFiles();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).clear();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { database.close(); }
}

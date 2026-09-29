import "server-only";
import { GoogleAuth, OAuth2Client } from "google-auth-library";

export type DriveFile = { id: string; name: string; mimeType: string; parents?: string[]; webViewLink?: string; appProperties?: Record<string, string>; capabilities?: { canAddChildren?: boolean } };
const FOLDER = "application/vnd.google-apps.folder";
const API = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const fields = "id,name,mimeType,parents,webViewLink,appProperties,capabilities(canAddChildren)";

export function folderIdFromInput(input: string) {
  const value = input.trim();
  const match = value.match(/\/folders\/([A-Za-z0-9_-]+)/);
  const id = match?.[1] || (/^[A-Za-z0-9_-]+$/.test(value) ? value : "");
  if (!id || id.length < 10) throw new Error("Enter a valid Google Drive folder URL or ID.");
  return id;
}

async function token() {
  if (process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON) {
    const credentials = JSON.parse(process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON) as Record<string, string>;
    if (credentials.private_key) credentials.private_key = credentials.private_key.replace(/\\n/g, "\n");
    const client = await new GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/drive"] }).getClient();
    const access = await client.getAccessToken();
    if (!access.token) throw new Error("Google Drive service-account authentication failed.");
    return access.token;
  }
  const { GOOGLE_DRIVE_OAUTH_CLIENT_ID: clientId, GOOGLE_DRIVE_OAUTH_CLIENT_SECRET: clientSecret, GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN: refreshToken } = process.env;
  if (!clientId || !clientSecret || !refreshToken) throw new Error("Configure Google Drive credentials on the server.");
  const client = new OAuth2Client(clientId, clientSecret);
  client.setCredentials({ refresh_token: refreshToken });
  const access = await client.getAccessToken();
  if (!access.token) throw new Error("Google Drive OAuth authentication failed.");
  return access.token;
}

async function drive(url: string, init: RequestInit = {}) {
  const authorization = await token();
  const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${authorization}`, ...init.headers }, cache: "no-store" });
  if (!response.ok) throw new Error(`Google Drive request failed (${response.status}). Check the folder permissions and retry.`);
  return response;
}

export async function getDriveFile(id: string): Promise<DriveFile> {
  const url = `${API}/${encodeURIComponent(id)}?supportsAllDrives=true&fields=${encodeURIComponent(fields)}`;
  return await (await drive(url)).json() as DriveFile;
}

export async function isWithinFolder(fileId: string, rootId: string): Promise<boolean> {
  if (fileId === rootId) return true;
  const seen = new Set<string>();
  let current = fileId;
  while (current && !seen.has(current)) {
    seen.add(current);
    const file = await getDriveFile(current);
    const parent = file.parents?.[0];
    if (parent === rootId) return true;
    current = parent || "";
  }
  return false;
}

export async function validateProjectFolder(input: string) {
  const root = folderIdFromInput(process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || "");
  const id = folderIdFromInput(input);
  if (!await isWithinFolder(id, root)) throw new Error("This folder is outside the configured company Drive folder.");
  const file = await getDriveFile(id);
  if (file.mimeType !== FOLDER || file.capabilities?.canAddChildren === false) throw new Error("Choose a folder where the Drive connection can add files.");
  return { id, name: file.name };
}

export async function listChildren(parentId: string, pageToken?: string) {
  const query = new URLSearchParams({ q: `'${parentId.replace(/'/g, "\\'")}' in parents and trashed = false`, fields: `nextPageToken,files(${fields})`, pageSize: "100", orderBy: "folder,name", supportsAllDrives: "true", includeItemsFromAllDrives: "true" });
  if (pageToken) query.set("pageToken", pageToken);
  const page = await (await drive(`${API}?${query}`)).json() as { nextPageToken?: string; files?: DriveFile[] };
  return { ...page, files: page.files || [] };
}

async function taggedChild(parentId: string, name: string, tag: Record<string, string>, matchName = true) {
  let pageToken: string | undefined;
  do {
    const page = await listChildren(parentId, pageToken);
    const found = page.files.find(file => (!matchName || file.name === name) && Object.entries(tag).every(([key, value]) => file.appProperties?.[key] === value));
    if (found) return found;
    pageToken = page.nextPageToken;
  } while (pageToken);
  return undefined;
}

async function createFolder(parentId: string, name: string, tag: Record<string, string>, matchName = true) {
  const existing = await taggedChild(parentId, name, tag, matchName);
  if (existing) {
    if (existing.name !== name) return await (await drive(`${API}/${encodeURIComponent(existing.id)}?supportsAllDrives=true&fields=${encodeURIComponent(fields)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) })).json() as DriveFile;
    return existing;
  }
  return await (await drive(`${API}?supportsAllDrives=true&fields=${encodeURIComponent(fields)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, mimeType: FOLDER, parents: [parentId], appProperties: tag }) })).json() as DriveFile;
}

async function uploadPdf(parentId: string, name: string, bytes: Uint8Array, tag: Record<string, string>) {
  const existing = await taggedChild(parentId, name, tag);
  if (existing) return existing;
  const location = await beginPdfUpload(parentId, name, bytes.byteLength, tag);
  const finish = await fetch(location, { method: "PUT", headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/pdf", "Content-Length": String(bytes.byteLength), "Content-Range": `bytes 0-${bytes.byteLength - 1}/${bytes.byteLength}` }, body: Buffer.from(bytes), cache: "no-store", redirect: "manual" });
  if (!finish.ok) throw new Error(`Google Drive could not finish the PDF upload (${finish.status}). Retry from the request.`);
  return await finish.json() as DriveFile;
}

async function beginPdfUpload(parentId: string, name: string, size: number, tag: Record<string, string>) {
  return beginUpload(parentId, name, size, "application/pdf", tag);
}

async function beginUpload(parentId: string, name: string, size: number, mime: string, tag: Record<string, string>) {
  const authorization = await token();
  const start = await fetch(`${UPLOAD}?uploadType=resumable&supportsAllDrives=true&fields=${encodeURIComponent(fields)}`, { method: "POST", headers: { Authorization: `Bearer ${authorization}`, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": mime, "X-Upload-Content-Length": String(size) }, body: JSON.stringify({ name, mimeType: mime, parents: [parentId], appProperties: tag }), cache: "no-store", redirect: "manual" });
  const location = start.headers.get("location");
  if (!start.ok || !location) throw new Error(`Google Drive could not start the file upload (${start.status}).`);
  return location;
}

const fileUrl = (file: DriveFile) => file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`;

export async function prepareQuoteFile(projectFolderId: string, requestId: string, requestRef: string, quoteId: string, supplierId: string, supplier: string, version: number, index: number, name: string, mime: string, size: number) {
  await validateProjectFolder(projectFolderId);
  const requestTag = { hmlRequestId: requestId };
  const requestFolder = await createFolder(projectFolderId, safeName(requestRef), requestTag, false);
  const quotations = await createFolder(requestFolder.id, "Supplier Quotations", requestTag);
  const supplierFolder = await createFolder(quotations.id, safeName(supplier), { ...requestTag, hmlSupplierId: supplierId || quoteId }, false);
  const tag = { hmlQuoteId: quoteId, hmlFileIndex: String(index), hmlType: "quotation" };
  const fileName = `${safeName(requestRef)}-${safeName(supplier)}-v${version}-${index + 1}-${safeName(name)}`;
  const existing = await taggedChild(supplierFolder.id, fileName, tag);
  if (existing) return { driveFileId: existing.id, url: fileUrl(existing) };
  return { sessionUri: await beginUpload(supplierFolder.id, fileName, size, mime, tag) };
}

export async function archivePurchaseOrder(projectFolderId: string, requestId: string, requestRef: string, poId: string, poRef: string, bytes: Uint8Array) {
  await validateProjectFolder(projectFolderId);
  const requestTag = { hmlRequestId: requestId };
  const requestFolder = await createFolder(projectFolderId, safeName(requestRef), requestTag, false);
  const poFolder = await createFolder(requestFolder.id, "Purchase Orders", requestTag);
  const file = await uploadPdf(poFolder.id, `${safeName(poRef)}.pdf`, bytes, { hmlPoId: poId, hmlType: "purchase-order" });
  return { fileId: file.id, url: fileUrl(file) };
}

export async function sendDocumentChunk(sessionUri: string, start: number, total: number, bytes: Uint8Array, mime: string) {
  const end = start + bytes.byteLength - 1;
  const response = await fetch(sessionUri, { method: "PUT", headers: { Authorization: `Bearer ${await token()}`, "Content-Type": mime, "Content-Length": String(bytes.byteLength), "Content-Range": `bytes ${start}-${end}/${total}` }, body: Buffer.from(bytes), cache: "no-store", redirect: "manual" });
  const result = await uploadResult(response);
  return { offset: result.offset, driveFileId: result.supportFileId, url: result.supportUrl };
}

export async function documentUploadStatus(sessionUri: string, total: number) {
  const result = await supportUploadStatus(sessionUri, total);
  return { offset: result.offset, driveFileId: result.supportFileId, url: result.supportUrl };
}

export async function prepareRequestArchive(projectFolderId: string, requestId: string, ref: string, version: number, form: Uint8Array, supportSize: number) {
  await validateProjectFolder(projectFolderId);
  const requestName = safeName(ref);
  const requestTag = { hmlRequestId: requestId };
  const requestFolder = await createFolder(projectFolderId, requestName, requestTag, false);
  const formFolder = await createFolder(requestFolder.id, "MRF Form", requestTag);
  const supportFolder = await createFolder(requestFolder.id, "Supporting Documents", requestTag);
  const formFile = await uploadPdf(formFolder.id, `${requestName}-v${version}.pdf`, form, { ...requestTag, hmlVersion: String(version), hmlType: "form" });
  const supportName = `${requestName}-support-v${version}.pdf`;
  const supportTag = { ...requestTag, hmlVersion: String(version), hmlType: "support" };
  const supportFile = await taggedChild(supportFolder.id, supportName, supportTag);
  const formResult = { formFileId: formFile.id, formUrl: fileUrl(formFile) };
  if (supportFile) return { ...formResult, supportFileId: supportFile.id, supportUrl: fileUrl(supportFile) };
  const sessionUri = await beginPdfUpload(supportFolder.id, supportName, supportSize, supportTag);
  return { ...formResult, sessionUri };
}

export async function sendSupportChunk(sessionUri: string, start: number, total: number, bytes: Uint8Array) {
  const end = start + bytes.byteLength - 1;
  const response = await fetch(sessionUri, { method: "PUT", headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/pdf", "Content-Length": String(bytes.byteLength), "Content-Range": `bytes ${start}-${end}/${total}` }, body: Buffer.from(bytes), cache: "no-store", redirect: "manual" });
  return uploadResult(response);
}

export async function supportUploadStatus(sessionUri: string, total: number) {
  const response = await fetch(sessionUri, { method: "PUT", headers: { Authorization: `Bearer ${await token()}`, "Content-Length": "0", "Content-Range": `bytes */${total}` }, cache: "no-store", redirect: "manual" });
  return uploadResult(response);
}

async function uploadResult(response: Response): Promise<{ offset: number; supportFileId?: string; supportUrl?: string }> {
  if (response.status === 308) {
    const range = response.headers.get("range")?.match(/^bytes=0-(\d+)$/);
    return { offset: range ? Number(range[1]) + 1 : 0 };
  }
  if (response.ok) {
    const file = await response.json() as DriveFile;
    if (!file.id) throw new Error("Drive did not return the uploaded PDF ID.");
    return { offset: -1, supportFileId: file.id, supportUrl: fileUrl(file) };
  }
  if (response.status === 404 || response.status === 410) throw new Error("The Drive upload session expired. Retry the archive from this record.");
  throw new Error(`Google Drive upload failed (${response.status}). Retry from this record.`);
}

const safeName = (value: string) => value.replace(/[\\/:*?"<>|]/g, "-").trim().slice(0, 120) || "MRF";

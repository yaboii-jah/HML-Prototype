import { createHash } from "node:crypto";
import type { StockTransfer, TransferDelivery, TransferEvidence, TransferReceiptVersion } from "../domain/types.ts";
import type { DeliveryReceiptVersion } from "../domain/types.ts";
import type { AccountingDocument, Batch, MRF, PO, PaymentProof } from "../domain/types.ts";
import { ACCOUNTING_MIMES, MAX_ACCOUNTING_FILE } from "../domain/accounting-documents.ts";
import "server-only";
import { GoogleAuth, OAuth2Client } from "google-auth-library";
import { XLSX_MIME } from "../domain/bid-reports.ts";
import { archiveFileName } from "../domain/document-numbering.ts";

export type DriveFile = { id: string; name: string; mimeType: string; size?: string; parents?: string[]; webViewLink?: string; appProperties?: Record<string, string>; capabilities?: { canAddChildren?: boolean } };
const FOLDER = "application/vnd.google-apps.folder";
const API = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const fields = "id,name,mimeType,size,parents,webViewLink,appProperties,capabilities(canAddChildren)";

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

// Stable project tags make interrupted setup and retries reuse the same folder.
const projectFolderRequests = new Map<string, Promise<{ id: string; name: string }>>();
export function createProjectFolder(projectId: string, projectName: string) {
  const key = `${process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID}:${projectId}`;
  const existing = projectFolderRequests.get(key);
  if (existing) return existing;
  const task = (async () => {
    const root = folderIdFromInput(process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || "");
    const parent = await getDriveFile(root);
    if (parent.mimeType !== FOLDER || parent.capabilities?.canAddChildren === false) throw new Error("The Drive connection cannot create folders in the company root.");
    const tag = { hmlProjectId: projectId, hmlKind: "project-folder" };
    const prior = await taggedChild(root, "", tag, false);
    const folder = prior || await createFolder(root, safeName(projectName), tag, false);
    if (folder.mimeType !== FOLDER || folder.capabilities?.canAddChildren === false) throw new Error("The project folder cannot receive files. Link another folder.");
    return { id: folder.id, name: folder.name };
  })().finally(() => projectFolderRequests.delete(key));
  projectFolderRequests.set(key, task);
  return task;
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

async function beginUpload(parentId: string, name: string, size: number, mime: string, tag: Record<string, string>, existingFileId?: string) {
  const authorization = await token();
  const start = await fetch(`${UPLOAD}${existingFileId ? `/${encodeURIComponent(existingFileId)}` : ""}?uploadType=resumable&supportsAllDrives=true&fields=${encodeURIComponent(fields)}`, { method: existingFileId ? "PATCH" : "POST", headers: { Authorization: `Bearer ${authorization}`, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": mime, "X-Upload-Content-Length": String(size) }, body: JSON.stringify({ name, mimeType: mime, ...(existingFileId ? {} : { parents: [parentId] }), appProperties: tag }), cache: "no-store", redirect: "manual" });
  const location = start.headers.get("location");
  if (!start.ok || !location) throw new Error(`Google Drive could not start the file upload (${start.status}).`);
  return location;
}

const fileUrl = (file: DriveFile) => file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`;

export async function prepareBidFile(projectFolderId: string, requestId: string, requestRef: string, reportId: string, version: number, fileName: string, sha256: string, size: number, format: "xlsx" | "pdf" = "xlsx") {
  await validateProjectFolder(projectFolderId);
  const requestTag = { hmlRequestId: requestId };
  const requestFolder = await createFolder(projectFolderId, safeName(requestRef), requestTag, false);
  const folder = await createFolder(requestFolder.id, "Bid Comparisons", requestTag);
  const tag = { ...requestTag, hmlBidId: reportId, hmlVersion: String(version), hmlType: "bid-comparison", hmlFormat: format, hmlSha256: sha256 };
  const legacy = format === "xlsx" ? await taggedChild(folder.id, fileName, { hmlBidId: reportId }, true) : undefined;
  const existing = await taggedChild(folder.id, fileName, { hmlBidId: reportId, hmlFormat: format }, false) || (legacy?.mimeType === XLSX_MIME ? legacy : undefined);
  if (existing) {
    if (existing.appProperties?.hmlSha256 !== sha256) throw new Error("This report version already has a different archived workbook.");
    return { driveFileId: existing.id, url: fileUrl(existing) };
  }
  const extension = format === "pdf" ? ".pdf" : ".xlsx";
  const name = safeName(fileName.slice(0, -extension.length)).slice(0, 120 - extension.length) + extension;
  return { sessionUri: await beginUpload(folder.id, name, size, format === "pdf" ? "application/pdf" : XLSX_MIME, tag) };
}

export async function downloadBidFile(projectFolderId: string, requestId: string, reportId: string, fileId: string, format: "xlsx" | "pdf" = "xlsx") {
  await validateProjectFolder(projectFolderId);
  const file = await getDriveFile(fileId);
  if ((file.mimeType !== (format === "pdf" ? "application/pdf" : XLSX_MIME) || format === "pdf" && file.appProperties?.hmlFormat !== "pdf") || file.appProperties?.hmlType !== "bid-comparison" || file.appProperties?.hmlBidId !== reportId || file.appProperties?.hmlRequestId !== requestId || !await isWithinFolder(fileId, projectFolderId)) throw new Error("The archived workbook is outside this report's project or has invalid report metadata.");
  return Buffer.from(await (await drive(`${API}/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`)).arrayBuffer());
}

export async function prepareQuoteFile(projectFolderId: string, requestId: string, requestRef: string, quoteId: string, supplierId: string, supplier: string, version: number, index: number, name: string, mime: string, size: number, archiveName?: string) {
  await validateProjectFolder(projectFolderId);
  const requestTag = { hmlRequestId: requestId };
  const requestFolder = await createFolder(projectFolderId, safeName(requestRef), requestTag, false);
  const quotations = await createFolder(requestFolder.id, "Supplier Quotations", requestTag);
  const supplierFolder = await createFolder(quotations.id, safeName(supplier), { ...requestTag, hmlSupplierId: supplierId || quoteId }, false);
  const tag = { hmlQuoteId: quoteId, hmlFileIndex: String(index), hmlType: "quotation" };
  const fileName = archiveName ? safeName(archiveName) : `${safeName(requestRef)}-${safeName(supplier)}-v${version}-${index + 1}-${safeName(name)}`;
  const existing = await taggedChild(supplierFolder.id, fileName, tag, false);
  if (existing) return { driveFileId: existing.id, url: fileUrl(existing) };
  return { sessionUri: await beginUpload(supplierFolder.id, fileName, size, mime, tag) };
}

export async function archivePurchaseOrder(projectFolderId: string, requestId: string, requestRef: string, poId: string, poRef: string, bytes: Uint8Array, revision?: number) {
  await validateProjectFolder(projectFolderId);
  const requestTag = { hmlRequestId: requestId };
  const requestFolder = await createFolder(projectFolderId, safeName(requestRef), requestTag, false);
  const poFolder = await createFolder(requestFolder.id, "Purchase Orders", requestTag);
  const file = await uploadPdf(poFolder.id, `${safeName(poRef)}${revision ? `-v${revision}` : ""}.pdf`, bytes, { hmlPoId: poId, hmlType: "purchase-order", ...(revision ? { hmlApprovalVersion: String(revision) } : {}) });
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

export async function prepareRequestArchive(projectFolderId: string, requestId: string, ref: string, version: number, form: Uint8Array | ((supportUrl: string) => Promise<Uint8Array>), supportSize: number, fileRef?: string) {
  await validateProjectFolder(projectFolderId);
  const requestName = safeName(ref);
  const requestTag = { hmlRequestId: requestId };
  const requestFolder = await createFolder(projectFolderId, requestName, requestTag, false);
  const formFolder = await createFolder(requestFolder.id, "MRF Form", requestTag);
  const supportFolder = await createFolder(requestFolder.id, "Supporting Documents", requestTag);
  const supportName = fileRef ? archiveFileName(fileRef, "support", `v${version}`, ".pdf") : `${requestName}-support-v${version}.pdf`;
  const supportTag = { ...requestTag, hmlVersion: String(version), hmlType: "support" };
  let supportFile = await taggedChild(supportFolder.id, supportName, supportTag);
  if (!supportFile) supportFile = await (await drive(`${API}?supportsAllDrives=true&fields=${encodeURIComponent(fields)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: supportName, mimeType: "application/pdf", parents: [supportFolder.id], appProperties: supportTag }) })).json() as DriveFile;
  const formBytes = typeof form === "function" ? await form(fileUrl(supportFile)) : form;
  const formName = fileRef ? `${safeName(fileRef)}-v${version}.pdf` : `${requestName}-v${version}.pdf`;
  const formFile = await uploadPdf(formFolder.id, formName, formBytes, { ...requestTag, hmlVersion: String(version), hmlType: "form" });
  const formResult = { formFileId: formFile.id, formUrl: fileUrl(formFile) };
  if (Number(supportFile.size) > 0) return { ...formResult, supportFileId: supportFile.id, supportUrl: fileUrl(supportFile) };
  const sessionUri = await beginUpload(supportFolder.id, supportName, supportSize, "application/pdf", supportTag, supportFile.id);
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

export async function prepareAccountingFile(projectFolderId: string, mrf: MRF, po: PO, batch: Batch | undefined, document: AccountingDocument) {
  await validateProjectFolder(projectFolderId);
  const requestTag = { hmlRequestId: mrf.id };
  const requestFolder = await createFolder(projectFolderId, safeName(mrf.ref), requestTag, false);
  const accounting = await createFolder(requestFolder.id, "Accounting Documents", requestTag);
  const poFolder = await createFolder(accounting.id, safeName(po.ref), { ...requestTag, hmlPoId: po.id }, false);
  const batchFolder = batch ? await createFolder(poFolder.id, safeName(batch.ref), { ...requestTag, hmlPoId: po.id, hmlBatchId: batch.id }, false) : poFolder;
  const tags = { ...requestTag, hmlPoId: po.id, hmlBatchId: batch?.id || "", hmlDocumentId: document.id, hmlType: "accounting-document", hmlSha256: document.sha256 };
  const existing = await taggedChild(batchFolder.id, document.name, { hmlDocumentId: document.id }, false);
  if (existing) {
    if (existing.appProperties?.hmlSha256 !== document.sha256 || existing.mimeType !== document.mime) throw new Error("This evidence already has a different Drive copy.");
    return { driveFileId: existing.id, url: fileUrl(existing) };
  }
  return { sessionUri: await beginUpload(batchFolder.id, safeName(document.archiveName || document.name), document.size, document.mime, tags) };
}
export async function downloadAccountingFile(projectFolderId: string, requestId: string, poId: string, batchId: string, documentId: string, fileId: string) {
  await validateProjectFolder(projectFolderId);
  const file = await getDriveFile(fileId), tags = file.appProperties;
  if (!ACCOUNTING_MIMES.some(mime => mime === file.mimeType) || tags?.hmlType !== "accounting-document" || tags.hmlRequestId !== requestId || tags.hmlPoId !== poId || tags.hmlBatchId !== batchId || tags.hmlDocumentId !== documentId || Number(file.size) > MAX_ACCOUNTING_FILE || !await isWithinFolder(fileId, projectFolderId)) throw new Error("This accounting file is outside its project or has invalid document metadata.");
  const bytes = Buffer.from(await (await drive(`${API}/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`)).arrayBuffer());
  return { bytes, mime: file.mimeType };
}

export async function preparePaymentProof(projectFolderId: string, mrf: MRF, po: PO, proof: PaymentProof) {
  await validateProjectFolder(projectFolderId);
  const requestTag = { hmlRequestId: mrf.id };
  const requestFolder = await createFolder(projectFolderId, safeName(mrf.ref), requestTag, false);
  const accounting = await createFolder(requestFolder.id, "Accounting Documents", requestTag);
  const poFolder = await createFolder(accounting.id, safeName(po.ref), { ...requestTag, hmlPoId: po.id }, false);
  const proofFolder = await createFolder(poFolder.id, "Payment Proof", { ...requestTag, hmlPoId: po.id });
  const tags = { ...requestTag, hmlPoId: po.id, hmlDocumentId: proof.id, hmlType: "payment-proof", hmlSha256: proof.sha256 };
  const existing = await taggedChild(proofFolder.id, proof.name, { hmlDocumentId: proof.id }, false);
  if (existing) {
    if (existing.appProperties?.hmlSha256 !== proof.sha256 || existing.mimeType !== proof.mime || Number(existing.size) !== proof.size) throw new Error("The existing proof archive does not match this file.");
    return { driveFileId: existing.id, url: fileUrl(existing) };
  }
  return { sessionUri: await beginUpload(proofFolder.id, safeName(proof.archiveName || proof.name), proof.size, proof.mime, tags) };
}
export async function downloadPaymentProof(projectFolderId: string, requestId: string, poId: string, documentId: string, fileId: string) {
  await validateProjectFolder(projectFolderId);
  const file = await getDriveFile(fileId), tags = file.appProperties;
  if (!ACCOUNTING_MIMES.some(mime => mime === file.mimeType) || tags?.hmlType !== "payment-proof" || tags.hmlRequestId !== requestId || tags.hmlPoId !== poId || tags.hmlDocumentId !== documentId || Number(file.size) > MAX_ACCOUNTING_FILE || !await isWithinFolder(fileId, projectFolderId)) throw new Error("This payment proof is outside its project or has invalid metadata.");
  const bytes = Buffer.from(await (await drive(`${API}/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`)).arrayBuffer());
  return { bytes, mime: file.mimeType };
}

// Stable receipt IDs and snapshot fingerprints make retries reuse the original Drive file.
export async function archiveDeliveryReceipt(projectFolderId: string, receipt: DeliveryReceiptVersion, generate: () => Promise<Uint8Array>) {
  await validateProjectFolder(projectFolderId);
  const { request, po, batch } = receipt.data;
  const requestTag = { hmlRequestId: request.id };
  const requestFolder = await createFolder(projectFolderId, safeName(request.ref), requestTag, false);
  const receipts = await createFolder(requestFolder.id, "Delivery Receipts", requestTag);
  const poFolder = await createFolder(receipts.id, safeName(po.ref), { ...requestTag, hmlPoId: po.id }, false);
  const batchFolder = await createFolder(poFolder.id, safeName(batch.ref), { ...requestTag, hmlPoId: po.id, hmlBatchId: batch.id }, false);
  const fingerprint = createHash("sha256").update(JSON.stringify(receipt.data)).digest("hex");
  const tags = { ...requestTag, hmlPoId: po.id, hmlBatchId: batch.id, hmlDocumentId: receipt.id, hmlVersion: String(receipt.version), hmlType: "delivery-receipt", hmlSha256: fingerprint };
  const name = receipt.fileName || `${safeName(batch.ref)}-receipt-v${receipt.version}.pdf`;
  const existing = await taggedChild(batchFolder.id, name, { hmlDocumentId: receipt.id }, false);
  if (existing) {
    if (existing.mimeType !== "application/pdf" || existing.appProperties?.hmlSha256 !== fingerprint) throw new Error("This receipt version already has a different Drive snapshot.");
    return { driveFileId: existing.id, url: fileUrl(existing) };
  }
  const file = await uploadPdf(batchFolder.id, name, await generate(), tags);
  return { driveFileId: file.id, url: fileUrl(file) };
}

async function transferArchiveFolder(projectFolderId: string, request: MRF, transfer: StockTransfer) {
  const project = await validateProjectFolder(projectFolderId);
  const requestTag = { hmlRequestId: request.id };
  const requestFolder = await createFolder(project.id, safeName(request.ref), requestTag, false);
  const root = await createFolder(requestFolder.id, "Stock Transfers", requestTag);
  const tags = { ...requestTag, hmlTransferId: transfer.id, hmlSourceProjectId: transfer.sourceSiteId, hmlDestinationProjectId: transfer.destinationSiteId };
  const folder = await createFolder(root.id, safeName(transfer.ref), tags, false);
  return { folder, tags };
}
export async function archiveTransferReceipt(projectFolderId: string, receipt: TransferReceiptVersion, generate: () => Promise<Uint8Array>) {
  const { request, transfer, delivery } = receipt.data;
  const { folder, tags: owner } = await transferArchiveFolder(projectFolderId, request, transfer);
  const fingerprint = createHash("sha256").update(JSON.stringify(receipt.data)).digest("hex");
  const tags = { ...owner, hmlDeliveryId: delivery.id, hmlDocumentId: receipt.id, hmlVersion: String(receipt.version), hmlType: "transfer-receipt", hmlSha256: fingerprint };
  const existing = await taggedChild(folder.id, receipt.fileName, { hmlDocumentId: receipt.id }, false);
  if (existing) {
    if (existing.mimeType !== "application/pdf" || existing.appProperties?.hmlSha256 !== fingerprint || existing.appProperties?.hmlTransferId !== transfer.id) throw new Error("This transfer receipt has a different archived snapshot.");
    return { driveFileId: existing.id, url: fileUrl(existing) };
  }
  const file = await uploadPdf(folder.id, safeName(receipt.fileName), await generate(), tags);
  return { driveFileId: file.id, url: fileUrl(file) };
}
export async function prepareTransferEvidence(projectFolderId: string, request: MRF, transfer: StockTransfer, delivery: TransferDelivery, document: TransferEvidence) {
  const { folder, tags: owner } = await transferArchiveFolder(projectFolderId, request, transfer);
  const tags = { ...owner, hmlDeliveryId: delivery.id, hmlDocumentId: document.id, hmlVersion: String(document.receiptVersion || 0), hmlType: "transfer-evidence", hmlSha256: document.sha256 };
  const existing = await taggedChild(folder.id, document.name, { hmlDocumentId: document.id }, false);
  if (existing) {
    if (existing.mimeType !== document.mime || Number(existing.size) !== document.size || existing.appProperties?.hmlSha256 !== document.sha256 || existing.appProperties?.hmlDeliveryId !== delivery.id) throw new Error("This transfer evidence differs from its Drive copy.");
    return { driveFileId: existing.id, url: fileUrl(existing) };
  }
  return { sessionUri: await beginUpload(folder.id, safeName(document.archiveName || document.name), document.size, document.mime, tags) };
}
export async function downloadTransferEvidence(projectFolderId: string, requestId: string, transferId: string, deliveryId: string, documentId: string, fileId: string) {
  const project = await validateProjectFolder(projectFolderId), file = await getDriveFile(fileId), tags = file.appProperties;
  if (!ACCOUNTING_MIMES.some(mime => mime === file.mimeType) || tags?.hmlType !== "transfer-evidence" || tags.hmlRequestId !== requestId || tags.hmlTransferId !== transferId || tags.hmlDeliveryId !== deliveryId || tags.hmlDocumentId !== documentId || Number(file.size) > MAX_ACCOUNTING_FILE || !await isWithinFolder(fileId, project.id)) throw new Error("This transfer evidence is outside the destination project or has invalid ownership.");
  const response = await drive(API + "/" + encodeURIComponent(fileId) + "?alt=media&supportsAllDrives=true");
  return { bytes: Buffer.from(await response.arrayBuffer()), mime: file.mimeType };
}

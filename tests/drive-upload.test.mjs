import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { openDriveUploadTicket, sealDriveUploadTicket } from "../src/server/drive-upload-ticket.ts";
import { openQuoteUploadTicket, sealQuoteUploadTicket } from "../src/server/quote-upload-ticket.ts";
import { driveAccessError } from "../src/server/local-drive.ts";

const sessionUri = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=sample";

test("encrypted Drive upload tickets preserve a session and reject tampering and expiration", () => {
  const previous = process.env.GOOGLE_DRIVE_UPLOAD_TOKEN_KEY;
  const previousNow = Date.now;
  process.env.GOOGLE_DRIVE_UPLOAD_TOKEN_KEY = randomBytes(32).toString("base64");
  try {
    const token = sealDriveUploadTicket({ requestId: "mrf-1", version: 2, total: 50 * 1024 * 1024, sessionUri, formFileId: "form-1", formUrl: "https://drive.google.com/form-1" });
    assert.equal(token.includes("upload_id"), false);
    assert.equal(openDriveUploadTicket(token).total, 50 * 1024 * 1024);
    assert.equal(openDriveUploadTicket(token).requestId, "mrf-1");
    assert.throws(() => openDriveUploadTicket(`${token[0] === "A" ? "B" : "A"}${token.slice(1)}`), /invalid/);
    Date.now = () => previousNow() + 61 * 60 * 1000;
    assert.throws(() => openDriveUploadTicket(token), /expired/);
    assert.throws(() => sealDriveUploadTicket({ requestId: "mrf-1", version: 2, total: 100, sessionUri: "https://example.com/upload/drive/v3/files?uploadType=resumable&upload_id=sample", formFileId: "form-1", formUrl: "https://drive.google.com/form-1" }), /invalid upload session/);
  } finally {
    Date.now = previousNow;
    if (previous === undefined) delete process.env.GOOGLE_DRIVE_UPLOAD_TOKEN_KEY;
    else process.env.GOOGLE_DRIVE_UPLOAD_TOKEN_KEY = previous;
  }
});

test("Vercel Drive access requires explicit enablement and same-origin writes", () => {
  const environment = process.env.VERCEL_ENV;
  const enabled = process.env.GOOGLE_DRIVE_ENABLED;
  process.env.VERCEL_ENV = "preview";
  try {
    delete process.env.GOOGLE_DRIVE_ENABLED;
    assert.equal(driveAccessError(new Request("https://demo.vercel.app/api/drive/files"))?.status, 503);
    assert.equal(driveAccessError(new Request("http://localhost:3000/api/drive/files"))?.status, 503);
    process.env.GOOGLE_DRIVE_ENABLED = "true";
    assert.equal(driveAccessError(new Request("https://demo.vercel.app/api/drive/files")), null);
    assert.equal(driveAccessError(new Request("https://demo.vercel.app/api/drive/archive", { method: "POST", headers: { origin: "https://other.example" } }), true)?.status, 403);
    assert.equal(driveAccessError(new Request("https://demo.vercel.app/api/drive/archive", { method: "POST", headers: { origin: "https://demo.vercel.app" } }), true), null);
  } finally {
    if (environment === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = environment;
    if (enabled === undefined) delete process.env.GOOGLE_DRIVE_ENABLED;
    else process.env.GOOGLE_DRIVE_ENABLED = enabled;
  }
});

test("quotation upload tickets bind file type and reject oversized uploads", () => {
  const previous = process.env.GOOGLE_DRIVE_UPLOAD_TOKEN_KEY;
  process.env.GOOGLE_DRIVE_UPLOAD_TOKEN_KEY = randomBytes(32).toString("base64");
  try {
    const ticket = sealQuoteUploadTicket({ quoteId: "quote-1", fileIndex: 2, total: 1024, mime: "image/png", sessionUri });
    assert.equal(openQuoteUploadTicket(ticket).mime, "image/png");
    assert.equal(openQuoteUploadTicket(ticket).fileIndex, 2);
    assert.throws(() => openQuoteUploadTicket(`${ticket[0] === "A" ? "B" : "A"}${ticket.slice(1)}`), /invalid/);
    assert.throws(() => sealQuoteUploadTicket({ quoteId: "quote-1", fileIndex: 0, total: 21 * 1024 * 1024, mime: "image/png", sessionUri }), /invalid/);
  } finally {
    if (previous === undefined) delete process.env.GOOGLE_DRIVE_UPLOAD_TOKEN_KEY;
    else process.env.GOOGLE_DRIVE_UPLOAD_TOKEN_KEY = previous;
  }
});

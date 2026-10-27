import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function encryptionKey() {
  const key = Buffer.from(process.env.GOOGLE_DRIVE_UPLOAD_TOKEN_KEY || "", "base64");
  if (key.length !== 32) throw new Error("Configure a 32-byte GOOGLE_DRIVE_UPLOAD_TOKEN_KEY on the server.");
  return key;
}

export function validUploadSession(value: string, allowExistingFile = false) {
  try {
    const url = new URL(value);
    const path = allowExistingFile ? /^\/upload\/drive\/v3\/files(?:\/[A-Za-z0-9_-]+)?$/ : /^\/upload\/drive\/v3\/files$/;
    return url.protocol === "https:" && url.hostname === "www.googleapis.com" && !url.username && !url.password && !url.port && path.test(url.pathname) && url.searchParams.get("uploadType") === "resumable" && !!url.searchParams.get("upload_id");
  } catch { return false; }
}

/** Keep the existing IV/tag/ciphertext wire format for in-flight upload tickets. */
export function sealUploadTicket(value: object) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const payload = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), payload]).toString("base64url");
}

export function openUploadTicket<T>(encoded: string, valid: (value: T) => boolean, message: string): T {
  try {
    if (!encoded || encoded.length > 8192) throw new Error("Invalid ticket");
    const bytes = Buffer.from(encoded, "base64url");
    if (bytes.length < 29) throw new Error("Invalid ticket");
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const value = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString()) as T;
    if (!valid(value)) throw new Error("Invalid ticket");
    return value;
  } catch { throw new Error(message); }
}

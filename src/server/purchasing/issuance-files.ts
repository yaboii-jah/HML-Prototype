import { createHash } from "node:crypto";
import { record } from "../../domain/projects/projects.ts";
import type { DriveGateway } from "../documents/drive-gateway.ts";
import { validateSupportingPdf } from "../documents/pdf-validation.ts";

/** Verify exact retained files immediately before the checked preparation write. */
export async function verifySendingFiles(value: unknown, drive: Pick<DriveGateway, "get" | "bytes">) {
  const proof = record(value);
  if (!proof || !Array.isArray(proof.files) || proof.files.length !== 3) {
    throw Error("Sending documents are unavailable.");
  }
  for (const raw of proof.files) {
    const file = record(raw), tags = record(file?.tags);
    if (!file || typeof file.id !== "string" || !/^[\w-]+$/.test(file.id)
      || typeof file.size !== "string" || !/^[1-9]\d*$/.test(file.size)
      || !Number.isSafeInteger(Number(file.size)) || Number(file.size) > 50 * 1024 * 1024
      || typeof file.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(file.sha256)
      || !tags || Object.values(tags).some((tag) => typeof tag !== "string")
      || file.parent !== undefined && typeof file.parent !== "string") {
      throw Error("Sending document references are invalid.");
    }
    const metadata = await drive.get(file.id);
    if (metadata.id !== file.id || metadata.trashed || metadata.mimeType !== "application/pdf"
      || metadata.size !== file.size || file.parent && !metadata.parents.includes(file.parent)
      || Object.entries(tags).some(([key, tag]) => metadata.properties[key] !== tag)) {
      throw Error("Sending document identity changed.");
    }
    const bytes = await drive.bytes(file.id, Number(file.size));
    if (bytes.length !== Number(file.size) || createHash("sha256").update(bytes).digest("hex") !== file.sha256) {
      throw Error("Sending document bytes changed.");
    }
    await validateSupportingPdf(bytes);
  }
  return proof;
}

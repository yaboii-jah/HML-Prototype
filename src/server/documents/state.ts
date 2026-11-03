import { record } from "../../domain/projects/projects.ts";

export function textValue(value: unknown): string {
  if (typeof value !== "string" || !value) throw Error("Invalid document state");
  return value;
}
export function rowValue(value: unknown): Record<string, unknown> {
  const row = record(value);
  if (!row) throw Error("Invalid document state");
  return row;
}
export function uploadTags(uploadId: string, requestId: string) {
  return { hmlUploadId: uploadId, hmlRequestId: requestId, hmlKind: "draft-supporting-pdf" };
}

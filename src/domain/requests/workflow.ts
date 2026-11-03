import { record } from "../projects/projects.ts";
import { UUID_PATTERN } from "../auth/session.ts";

export const mrfStatuses = ["draft", "submitted", "returned", "approved", "rejected"] as const;
export type MrfStatus = typeof mrfStatuses[number];
export type ReviewEvent = { id: string; action: string; reason: string; actorId: string; actorName: string; actorRole: string; createdAt: string };
export type MrfWorkflow = {
  status: MrfStatus;
  correctionKind: "full" | "documents" | null;
  correctionState: "editing" | "submitted" | "returned" | null;
  submissionId: string | null;
  submitted: { projectName: string; projectLocation: string } | null;
  procurementReady: boolean;
  submitterIds: string[];
  history: ReviewEvent[];
};
const uuid = (value: unknown): value is string => typeof value === "string" && UUID_PATTERN.test(value);
export function parseMrfWorkflow(value: unknown): MrfWorkflow | null {
  const raw = record(value);
  if (!raw) return null;
  // Old durable draft receipts predate lifecycle fields; fresh reads always include them.
  if (raw.status === undefined) return { status: "draft", correctionKind: null, correctionState: null, submissionId: null, submitted: null, procurementReady: false, submitterIds: [], history: [] };
  if (!mrfStatuses.includes(raw.status as MrfStatus)
    || ![null, "full", "documents"].includes(raw.correctionKind as null)
    || ![null, "editing", "submitted", "returned"].includes(raw.correctionState as null)
    || (raw.correctionKind === null) !== (raw.correctionState === null)
    || !(raw.submissionId === null || uuid(raw.submissionId))
    || typeof raw.procurementReady !== "boolean" || !Array.isArray(raw.submitterIds) || !raw.submitterIds.every(uuid)
    || !Array.isArray(raw.history)) return null;
  const submitted = record(raw.submitted);
  if (raw.submitted !== null && (!submitted || typeof submitted.projectName !== "string" || typeof submitted.projectLocation !== "string")) return null;
  const history: ReviewEvent[] = [];
  for (const value of raw.history) {
    const e = record(value);
    if (!e || !uuid(e.id) || !uuid(e.actorId) || typeof e.action !== "string" || typeof e.reason !== "string" || typeof e.actorName !== "string" || typeof e.actorRole !== "string" || typeof e.createdAt !== "string" || !Number.isFinite(Date.parse(e.createdAt))) return null;
    history.push({ id: e.id, actorId: e.actorId, action: e.action, reason: e.reason, actorName: e.actorName, actorRole: e.actorRole, createdAt: e.createdAt });
  }
  return { status: raw.status as MrfStatus, correctionKind: raw.correctionKind as MrfWorkflow["correctionKind"], correctionState: raw.correctionState as MrfWorkflow["correctionState"],
    submissionId: raw.submissionId, submitted: submitted ? { projectName: String(submitted.projectName), projectLocation: String(submitted.projectLocation) } : null,
    procurementReady: raw.procurementReady, submitterIds: raw.submitterIds, history };
}
export function mrfEditable(mrf: MrfWorkflow) {
  return ["draft", "returned"].includes(mrf.status) || mrf.status === "approved" && ["editing", "returned"].includes(mrf.correctionState ?? "");
}
export function mrfUnderReview(mrf: MrfWorkflow) {
  return mrf.status === "submitted" || mrf.status === "approved" && mrf.correctionState === "submitted";
}
export function mrfStatusLabel(mrf: MrfWorkflow) {
  if (mrf.correctionKind) return `${mrf.correctionKind === "documents" ? "PDF" : "Full"} correction · ${mrf.correctionState}`;
  return mrf.status.charAt(0).toUpperCase() + mrf.status.slice(1);
}

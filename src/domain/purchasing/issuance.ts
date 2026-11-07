import { UUID_PATTERN } from "../auth/session.ts";
import { record } from "../projects/projects.ts";
import { parseActor, type ReviewActor } from "./accounting.ts";

export const SEND_CHANNELS = ["email", "chat", "physical", "other"] as const;
export type SendingDetails = {
  channel: "" | (typeof SEND_CHANNELS)[number];
  recipient: string;
  sentAt: string;
  other: string;
  notes: string;
};
export const emptySendingDetails = (): SendingDetails => ({ channel: "", recipient: "", sentAt: "", other: "", notes: "" });
const uuid = (value: unknown): value is string => typeof value === "string" && UUID_PATTERN.test(value);
const version = (value: unknown): value is string => typeof value === "string" && /^(0|[1-9]\d{0,18})$/.test(value);
const text = (value: unknown, max = 2000): value is string => typeof value === "string" && value.length <= max;
const instant = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));

export function parseSendingDetails(value: unknown): SendingDetails | null {
  const d = record(value);
  if (!d || !SEND_CHANNELS.includes(d.channel as (typeof SEND_CHANNELS)[number])
    || !text(d.recipient, 500) || !d.recipient.trim() || !text(d.notes) || !text(d.other)
    || d.channel === "other" && d.other.trim().length < 5
    || !instant(d.sentAt) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(d.sentAt)) return null;
  // Reject normalized invalid calendar dates such as February 30.
  if (new Date(d.sentAt).toISOString().slice(0, 19) !== d.sentAt.slice(0, 19)) return null;
  return { channel: d.channel as SendingDetails["channel"], recipient: d.recipient.trim(), sentAt: d.sentAt, other: d.other, notes: d.notes };
}

export function sendingTimeIssue(details: SendingDetails, preparedAt: string, dueDate: string | null, now = new Date()): string | null {
  const sent = new Date(details.sentAt);
  if (!Number.isFinite(sent.getTime()) || sent < new Date(preparedAt) || sent > now) {
    return "Use the actual sending time, on or after preparation and no later than now. Sending outside this process needs external escalation.";
  }
  const day = sent.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
  return dueDate && day > dueDate ? "Sending after the approved Credit due date needs external escalation." : null;
}

export type SendPreparation = { id: string; approvalId: string; mrfArchiveId: string; poArchiveId: string; formId: string; supportingId: string; actor: ReviewActor; at: string };
export type PoIssuance = {
  status: "notIssued" | "prepared" | "issued";
  preparation: SendPreparation | null;
  issuance: { id: string; actor: ReviewActor; at: string; originalDetails: SendingDetails; details: SendingDetails; blockersAtRecording: string[] } | null;
  cancellations: { preparationId: string; actor: ReviewActor; at: string; reason: string; preparedBy: ReviewActor; preparedAt: string }[];
  corrections: { id: string; version: string; actor: ReviewActor; at: string; before: SendingDetails; details: SendingDetails; reason: string }[];
};
export function parsePoIssuance(value: unknown): PoIssuance | null {
  const v = record(value);
  if (!v || !["notIssued", "prepared", "issued"].includes(String(v.status)) || !Array.isArray(v.cancellations) || !Array.isArray(v.corrections)) return null;
  let preparation: SendPreparation | null = null;
  if (v.preparation !== null) {
    const p = record(v.preparation), actor = parseActor(p?.actor);
    if (!p || !actor || !uuid(p.id) || !uuid(p.approvalId) || !uuid(p.mrfArchiveId) || !uuid(p.poArchiveId) || !uuid(p.formId) || !uuid(p.supportingId) || !instant(p.at)) return null;
    preparation = { id: p.id, approvalId: p.approvalId, mrfArchiveId: p.mrfArchiveId, poArchiveId: p.poArchiveId, formId: p.formId, supportingId: p.supportingId, actor, at: p.at };
  }
  let issuance: PoIssuance["issuance"] = null;
  if (v.issuance !== null) {
    const i = record(v.issuance), actor = parseActor(i?.actor), originalDetails = parseSendingDetails(i?.originalDetails), details = parseSendingDetails(i?.details);
    if (!i || !actor || !originalDetails || !details || !uuid(i.id) || !instant(i.at)
      || !Array.isArray(i.blockersAtRecording) || !i.blockersAtRecording.every((b) => typeof b === "string")) return null;
    issuance = { id: i.id, actor, at: i.at, originalDetails, details, blockersAtRecording: i.blockersAtRecording };
  }
  const cancellations: PoIssuance["cancellations"] = [], corrections: PoIssuance["corrections"] = [];
  for (const raw of v.cancellations) {
    const c = record(raw), actor = parseActor(c?.actor), preparedBy = parseActor(c?.preparedBy);
    if (!c || !actor || !preparedBy || !uuid(c.preparationId) || !instant(c.at) || !instant(c.preparedAt) || !text(c.reason)) return null;
    cancellations.push({ preparationId: c.preparationId, actor, at: c.at, reason: c.reason, preparedBy, preparedAt: c.preparedAt });
  }
  for (const raw of v.corrections) {
    const c = record(raw), actor = parseActor(c?.actor), before = parseSendingDetails(c?.before), details = parseSendingDetails(c?.details);
    if (!c || !actor || !before || !details || !uuid(c.id) || !version(c.version) || !instant(c.at) || !text(c.reason)) return null;
    corrections.push({ id: c.id, version: c.version, actor, at: c.at, before, details, reason: c.reason });
  }
  if (v.status === "issued" && (!issuance || !preparation) || v.status === "prepared" && (!preparation || issuance)
    || v.status === "notIssued" && (issuance || preparation)) return null;
  return { status: v.status as PoIssuance["status"], preparation, issuance, cancellations, corrections };
}

export const ISSUANCE_ACTIONS = ["prepareSend", "cancelSend", "confirmSent", "correctSent"] as const;
export type IssuanceAction = (typeof ISSUANCE_ACTIONS)[number];
export type IssuanceCommand = {
  type: IssuanceAction; requestId: string; mrfId: string; targetId: string;
  expectedVersion: string; expectedPoVersion: string; expectedProjectVersion: string;
  expectedFamily: string; expectedMrfArchive: string; expectedDemand: string;
  reason: string; preparationId?: string; issuanceId?: string; notSent?: boolean; details?: SendingDetails;
};
export function parseIssuanceCommand(value: unknown): IssuanceCommand | null {
  const c = record(value);
  if (!c || !ISSUANCE_ACTIONS.includes(c.type as IssuanceAction) || !uuid(c.requestId) || !uuid(c.mrfId) || !uuid(c.targetId)
    || !version(c.expectedVersion) || !version(c.expectedPoVersion) || !version(c.expectedProjectVersion)
    || !version(c.expectedFamily) || !version(c.expectedDemand) || !(c.expectedMrfArchive === "" || uuid(c.expectedMrfArchive))
    || !text(c.reason) || ["proof", "snapshot", "actor", "files", "calculation", "totals"].some(key => key in c)) return null;
  const command: IssuanceCommand = {
    type: c.type as IssuanceAction, requestId: c.requestId, mrfId: c.mrfId, targetId: c.targetId,
    expectedVersion: c.expectedVersion, expectedPoVersion: c.expectedPoVersion, expectedProjectVersion: c.expectedProjectVersion,
    expectedFamily: c.expectedFamily, expectedDemand: c.expectedDemand, expectedMrfArchive: c.expectedMrfArchive, reason: c.reason.trim(),
  };
  if (c.type === "cancelSend" || c.type === "confirmSent") {
    if (!uuid(c.preparationId)) return null;
    command.preparationId = c.preparationId;
  }
  if (c.type === "cancelSend") {
    if (c.notSent !== true || command.reason.length < 5) return null;
    command.notSent = true;
  }
  if (c.type === "correctSent") {
    if (!uuid(c.issuanceId) || command.reason.length < 5) return null;
    command.issuanceId = c.issuanceId;
  }
  if (c.type === "confirmSent" || c.type === "correctSent") {
    const details = parseSendingDetails(c.details);
    if (!details) return null;
    command.details = details;
  }
  return command;
}

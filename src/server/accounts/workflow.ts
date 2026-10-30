import "server-only";
import { createHash } from "node:crypto";
import { object, parseAccount, type AccountCommand, type AccountResult } from "../../domain/accounts/accounts.ts";

export type AccountActor = { userId: string; sessionId: string; revision: string; activeRole: "Administrator" };
export type AccountGateway = {
  rpc: (name: string, input: Record<string, unknown>) => Promise<unknown>;
  identity: (id: string) => Promise<{ id: string; email?: string; marker?: unknown } | null>;
  create: (id: string, email: string, requestId: string) => Promise<void>;
  send: (kind: "invite" | "recovery", email: string) => Promise<"accepted" | "failed" | "uncertain">;
  emailEnabled: boolean;
};

function invitationAttempt(requestId: string) {
  const chars = createHash("sha256").update(`account-invitation:${requestId}`).digest("hex").slice(0, 32).split("");
  chars[12] = "5"; chars[16] = "8";
  const s = chars.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

async function message(command: Extract<AccountCommand, { type: "message" }>, actor: AccountActor, gateway: AccountGateway): Promise<AccountResult> {
  if (!gateway.emailEnabled) return { ok: false, message: "Email sending is unavailable. The account is saved; invitation not sent." };
  const input = { actor, operation: command.requestId, target: command.id, expected_version: command.version, message_kind: command.kind };
  const reservation = object(await gateway.rpc("account_message", input));
  if (!reservation) throw Error("Invalid message result");
  let state = reservation.state;
  if (reservation.dispatch === true && typeof reservation.email === "string") {
    // The reservation is durable. Never repeat this external call for the same
    // attempt after a timeout/crash; a deliberate resend uses another attempt.
    let outcome: "accepted" | "failed" | "uncertain";
    try { outcome = await gateway.send(command.kind, reservation.email); } catch { outcome = "uncertain"; }
    const result = object(await gateway.rpc("account_message", { ...input, outcome }));
    state = result?.state;
  }
  return state === "accepted"
    ? { ok: true, message: "Email provider accepted the message. Delivery is not confirmed." }
    : { ok: false, message: state === "failed" ? "The message could not be sent. You can start a new attempt." : "The message outcome is uncertain. Check the recipient before starting a new attempt." };
}

export async function executeAccountCommand(command: AccountCommand, actor: AccountActor, gateway: AccountGateway): Promise<AccountResult> {
  if (command.type === "message") return message(command, actor, gateway);
  if (command.type === "save") {
    const result = parseAccount(await gateway.rpc("account_save", {
      actor, operation: command.requestId, target: command.id, expected_version: command.version, draft: command.draft,
    }));
    if (!result) throw Error("Invalid account result");
    return { ok: true, message: "Account saved. Changes to access require a fresh sign-in." };
  }
  const reservation = object(await gateway.rpc("account_reserve", { actor, operation: command.requestId, draft: command.draft }));
  if (!reservation || typeof reservation.id !== "string") throw Error("Invalid provisioning result");
  if (reservation.state !== "complete") {
    let identity = await gateway.identity(reservation.id);
    if (!identity) {
      try { await gateway.create(reservation.id, command.draft.email, command.requestId); }
      catch {
        // An accepted create can time out. Reconcile the deterministic identity;
        // never search for or adopt an unrelated identity with the same email.
        identity = await gateway.identity(reservation.id);
        if (!identity) throw Error("Provisioning has not completed. Retry the same request.");
      }
      identity = await gateway.identity(reservation.id);
    }
    if (!identity || identity.id !== reservation.id || identity.email?.toLowerCase() !== command.draft.email || identity.marker !== command.requestId) {
      throw Error("The provisioning identity could not be verified. Retry the same request.");
    }
  }
  const account = parseAccount(await gateway.rpc("account_complete", { actor, operation: command.requestId }));
  if (!account) throw Error("Invalid account result");
  if (!gateway.emailEnabled) return { ok: true, accountSaved: true, message: "Account saved. Invitation not sent; email sending is unavailable." };
  if (account.confirmed) return { ok: true, accountSaved: true, message: "Account saved. Email setup is already confirmed; use recovery if a new password is needed." };
  const sent = await message({ type: "message", id: account.id, version: account.version,
    requestId: invitationAttempt(command.requestId), kind: "invite" }, actor, gateway);
  return { ...sent, accountSaved: true, message: "Account saved. " + sent.message };
}

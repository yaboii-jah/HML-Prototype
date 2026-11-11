import "server-only";
import { quotationActor } from "@/src/server/quotations/drafts";
import { serviceRpc, ServiceCommandError } from "@/src/server/auth/service-rpc";
import { parsePaymentCommand, parsePaymentsView } from "@/src/domain/payments/payments";
import { record } from "@/src/domain/projects/projects";
import { dispatchPaymentJobs } from "./files";

export async function paymentsView(poId?: string, mrfId?: string) {
  const actor = await quotationActor();
  if (!actor) return null;
  const view = parsePaymentsView(await serviceRpc("payments_read", { actor, target_po: poId ?? null, target_request: mrfId ?? null }));
  if (!view) throw Error("Payment data could not be loaded.");
  await dispatchPaymentJobs().catch(() => {});
  return view;
}
export async function runPaymentCommand(input: unknown) {
  const command = parsePaymentCommand(input);
  if (!command) return { ok: false, message: "Review the payment details, selected action and required reason." };
  try {
    const actor = await quotationActor();
    if (!actor || actor.activeRole !== (command.type === "coordinate" ? "Finance" : "Accounting")) return { ok: false, message: "Use the responsible Finance or Accounting role for this action." };
    const result = record(await serviceRpc("payment_command", { actor, command }));
    if (!result || result.targetId !== command.poId || typeof result.changed !== "boolean") throw Error("Invalid payment result");
    await dispatchPaymentJobs().catch(() => {});
    return { ok: true, draftId: typeof result.draftId === "string" ? result.draftId : undefined, message: result.changed ? "Action recorded. Review the current balance and retained history." : "The saved values already match. No history or financial effects were added." };
  } catch (error) {
    if (error instanceof ServiceCommandError) {
      const messages: Record<string, string> = {
        "40001": "The payment record changed. Your entries are preserved. Review the latest data before retrying.",
        "42501": "Your access changed. Refresh and sign in again if needed.",
        "23505": "This action is already recorded or a replacement already exists. Review the saved record.",
        "23514": "Check the payment details, proof limits and required reason.",
        "22007": "Enter a valid Philippine date.", "22008": "Enter a valid Philippine date.",
        P4111: "Payment work requires a PO recorded as issued to its supplier.",
        P4112: "The payment exceeds the current outstanding supplier net.",
        P4113: "Finance coordination and settlement require different people on this PO, including after role switching.",
        P4114: "Review the saved payment details, actual date, archived proof and current state before continuing.",
        P4115: "Proof or payment reference is already used. Check retained entries; explain cross-PO reference matches or use a linked replacement for reversed payments.",
        P4116: "Resolve the current delivery-clearance prerequisites first.",
        P4803: "This retry identity was used for different input. Review current values before starting a new action.",
      };
      if (messages[error.code]) return { ok: false, conflict: error.code === "40001", message: messages[error.code] };
    }
    return { ok: false, uncertain: true, message: "The response was interrupted. Retry the same action to check its saved outcome." };
  }
}

import "server-only";
import { record } from "@/src/domain/projects/projects";
import { parseIssuanceCommand } from "@/src/domain/purchasing/issuance";
import type { PurchasingResult } from "@/src/domain/purchasing/contracts";
import { serviceRpc, ServiceCommandError } from "@/src/server/auth/service-rpc";
import { quotationActor } from "@/src/server/quotations/drafts";
import { documentDrive } from "@/src/server/documents/config";
import { verifySendingFiles } from "./issuance-files.ts";

export async function runIssuanceCommand(input: unknown): Promise<PurchasingResult> {
  const command = parseIssuanceCommand(input);
  if (!command) return { ok: false, message: "Review the sending details, selected PO and required declarations." };
  let checkingFiles = false;
  try {
    const actor = await quotationActor();
    if (!actor || actor.activeRole !== "Procurement") {
      return { ok: false, message: "Use your Procurement role to record supplier sending." };
    }
    // Resolve a lost acknowledgement before touching Drive or current prerequisites.
    const receipt = await serviceRpc("issuance_receipt", { actor, command });
    if (receipt !== null) {
      const result = record(receipt);
      if (!result || result.targetId !== command.targetId || result.changed !== true) throw Error("Invalid issuance receipt.");
      return { ok: true, targetId: command.targetId, message: "The original action was recorded. Review the current sending status and history." };
    }
    let proof: Record<string, unknown> | null = null;
    if (command.type === "prepareSend") {
      const files = await serviceRpc("issuance_prepare_files", { actor, target: command.targetId });
      checkingFiles = true;
      proof = await verifySendingFiles(files, documentDrive());
      checkingFiles = false;
    }
    const result = record(await serviceRpc("issuance_command", { actor, command, proof }));
    if (!result || result.targetId !== command.targetId || result.changed !== true) throw Error("Invalid issuance result.");
    const messages = {
      prepareSend: "Prepared to send. Open the checked documents, send them externally, then confirm the actual sending.",
      cancelSend: "Preparation cancelled with your Not sent declaration. Accounting can revoke approval if correction is needed.",
      confirmSent: "PO issued. Sending details and who prepared and recorded it are retained.",
      correctSent: "Sending details corrected. The original declaration remains in history.",
    };
    return { ok: true, targetId: command.targetId, message: messages[command.type] };
  } catch (error) {
    if (error instanceof ServiceCommandError) {
      const messages: Record<string, string> = {
        "40001": "The PO, source, MRF or project changed. Your entries are preserved. Review the latest values before retrying.",
        "42501": "Your access changed. Refresh and sign in again if needed.",
        "23514": "Complete the required sending details, reason and Not sent declaration where requested.",
        "22007": "Enter a valid actual sending date and time.",
        "22008": "Enter a valid actual sending date and time.",
        P4101: "The PO is prepared for sending or permanently issued. Review its current sending status.",
        P4102: "Complete the current approval, source/MRF checks, approved archives and valid Credit terms before preparing to send.",
        P4103: "Sending before preparation, in the future or after the approved Credit due date cannot establish normal issuance. Escalate the actual event outside this workflow.",
        P4801: "The selected PO is unavailable.",
        P4803: "This retry identity was used for different input. Review the latest values and start a new action.",
      };
      if (messages[error.code]) return { ok: false, message: messages[error.code], conflict: error.code === "40001" };
    }
    if (checkingFiles) return { ok: false, message: "The required Drive documents could not be verified. Nothing was prepared. Restore the original files or provider access, then try Prepare to send again." };
    return { ok: false, uncertain: true, message: "The response was interrupted. Check this same request's saved outcome before starting another action." };
  }
}

import "server-only";
import { quotationActor } from "@/src/server/quotations/drafts";
import { serviceRpc, ServiceCommandError } from "@/src/server/auth/service-rpc";
import { record } from "@/src/domain/projects/projects";
import { parseAccountingCommand } from "@/src/domain/purchasing/accounting";
import type { PurchasingResult } from "@/src/domain/purchasing/contracts";
import { purchasingView } from "./purchasing";
import { dispatchApprovedPoArchives } from "./approval-archives";

export async function runAccountingCommand(input: unknown): Promise<PurchasingResult> {
  const command = parseAccountingCommand(input);
  if (!command) return { ok: false, message: "Review the selected PO, versions and required reason." };
  try {
    const actor = await quotationActor();
    const procurement = command.type === "submitPo" || command.type === "recallPo";
    if (!actor || actor.activeRole !== (procurement ? "Procurement" : "Accounting")) {
      return { ok: false, message: `Use your ${procurement ? "Procurement" : "Accounting"} role for this action.` };
    }
    const view = await purchasingView(command.mrfId);
    const po = view?.records.find((r) => r.id === command.targetId && r.kind === "po");
    const quote = view?.quotations.quotes.find((q) => q.id === po?.quoteId);
    if (!view || !po || !quote) return { ok: false, message: "The PO or retained source is unavailable." };
    // Only the trusted server constructs the render snapshot. SQL binds it to the
    // saved PO/calculation and checks all expected live source/budget versions.
    const snapshot = command.type === "submitPo" ? {
      po,
      view: {
        ...view, records: [po], claims: [], reports: [], history: [],
        quotations: { ...view.quotations, quotes: [quote], suppliers: [], history: [] },
      },
    } : null;
    if (snapshot && JSON.stringify(snapshot).length > 10 * 1024 * 1024) {
      return { ok: false, message: "This PO exceeds the supported snapshot size. Reduce source text before submission." };
    }
    const result = record(await serviceRpc("accounting_command", { actor, command, snapshot }));
    if (!result || typeof result.targetId !== "string" || result.changed !== true) throw Error("Invalid Accounting result.");
    await dispatchApprovedPoArchives().catch(() => {});
    const messages = {
      submitPo: "PO submitted to Accounting. Its saved content is locked.",
      recallPo: "PO recalled. Demand is retained; review and resubmit your changes.",
      approvePo: "PO approved and gross committed. Approved PDF archiving is queued.",
      holdPo: "PO placed on hold. Its demand is retained.",
      returnPo: "PO returned to Procurement for correction.",
      rejectPo: "PO rejected permanently. Its demand is available for sourcing.",
      revokePo: "Approval revoked and commitment released. Procurement can edit or cancel the PO.",
      reconfirmPo: "PO applicability confirmed against the corrected approved MRF.",
      retryPoArchive: "Approved PDF archive queued for retry.",
    };
    const replayed = view.version !== command.expectedVersion || po.version !== command.expectedPoVersion;
    return { ok: true, targetId: result.targetId, message: replayed ? "The original action was recorded. Review the current PO status and history below." : messages[command.type] };
  } catch (error) {
    if (error instanceof ServiceCommandError) {
      const messages: Record<string, string> = {
        "40001": "The PO, supplier source, MRF or budget changed. Your reason is preserved. Review the latest values before retrying.",
        "42501": "Your access changed. Refresh and sign in again if needed.",
        "23514": "Check the saved PO, exact amounts and required review fields.",
        P4901: "The approved gross exceeds the uncommitted scope allocation. Ask a Project Manager or Administrator to review the allocation.",
        P4902: "This PO is locked or its review state changed. Refresh before continuing.",
        P4903: "Every historical PO preparer and submitter is barred from approving or reconfirming this PO.",
        P4904: "Complete the saved preparation, current source/MRF checks, payment arrangement and valid Credit date before continuing.",
        P4801: "The selected PO is unavailable.",
        P4803: "This retry identity was used for different input. Review the latest values and retry with a new operation.",
        P4201: "Set up or repair the project's document folder before approval or archive retry.",
      };
      if (messages[error.code]) return { ok: false, message: messages[error.code], conflict: error.code === "40001" };
    }
    return { ok: false, uncertain: true, message: "The response was interrupted. Check the same request's saved outcome." };
  }
}

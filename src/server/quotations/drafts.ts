import "server-only";
import { readSession } from "@/src/server/auth/session";
import { serviceRpc, ServiceCommandError } from "@/src/server/auth/service-rpc";
import { record } from "@/src/domain/projects/projects";
import {
  parseQuoteCommand,
  parseQuotationsView,
  type QuoteResult,
} from "@/src/domain/quotations/drafts";
import { dispatchQuotationJobs } from "./files";
import { dispatchQuotationArchives } from "./revision-archives";
import {
  FINANCIAL_COMMANDS,
  type FinancialCommand,
} from "@/src/domain/quotations/revisions";
import { runFinancialCommand } from "./financial-commands";

const commandMessages: Record<string, string> = {
  finalize: "Revision finalized. Its archive must complete before use.",
  startRevision:
    "Revision draft created. Review all copied information and originals again.",
  withdraw: "Revision withdrawn permanently.",
  checkFinancial: "Saved financial inputs confirmed.",
  saveFinancial: "Financial review saved.",
  reconfirmMrf: "Applicability to the corrected MRF confirmed.",
  activateRevision: "Archived revision is now current.",
  retryArchive: "Quotation archive queued for retry.",
};

export async function quotationActor() {
  const session = await readSession();
  if (!session?.activeRole || session.activeRole === "Site Personnel")
    return null;
  return {
    userId: session.context.userId,
    sessionId: session.sessionId,
    revision: session.context.revision,
    activeRole: session.activeRole,
  };
}
export async function quotationsView(mrfId: string) {
  const actor = await quotationActor();
  if (!actor) return null;
  const raw = record(
    await serviceRpc("quotations_read", { actor, target_request: mrfId }),
  );
  const view = parseQuotationsView({ ...raw, role: actor.activeRole });
  if (!view) throw Error("Quotation data could not be loaded.");
  await dispatchQuotationJobs().catch(() => {});
  await dispatchQuotationArchives().catch(() => {});
  return view;
}
export async function runQuotationCommand(
  input: unknown,
): Promise<QuoteResult> {
  const command = parseQuoteCommand(input);
  try {
    const actor = await quotationActor();
    if (!actor || actor.activeRole !== "Procurement")
      return {
        ok: false,
        message: "Use your Procurement role to maintain quotations.",
      };
    if (!command)
      return {
        ok: false,
        message:
          "Check the entered source fields, exact decimals and selected action.",
      };
    const financial = FINANCIAL_COMMANDS.includes(command.type);
    const result = record(
      financial
        ? await runFinancialCommand(actor, command as FinancialCommand)
        : await serviceRpc("quotation_command", { actor, command }),
    );
    if (typeof result?.error === "string")
      return { ok: false, message: result.error };
    if (
      !result ||
      typeof result.quoteId !== "string" ||
      typeof result.changed !== "boolean"
    )
      throw Error("Invalid quotation result");
    const checked = parseQuotationsView({
      role: actor.activeRole,
      request: null,
      suppliers: [],
      quotes: [result.quote],
      history: [],
    });
    if (!checked) throw Error("Invalid saved quotation");
    await dispatchQuotationJobs().catch(() => {});
    await dispatchQuotationArchives().catch(() => {});
    return {
      ok: true,
      quote: checked.quotes[0],
      quoteId: result.quoteId,
      message: result.changed
        ? commandMessages[command.type] || "Quotation saved."
        : "No changes to save.",
    };
  } catch (error) {
    if (error instanceof ServiceCommandError) {
      const messages: Record<string, string> = {
        "40001":
          "The quotation or originals changed. Your input is preserved. Review the latest saved version.",
        "42501": "Your access changed. Refresh and sign in again if needed.",
        "23514":
          "Check the source values, financial classifications, material links and verified originals.",
        "23505":
          "An active draft or unfinished file group already exists for this MRF and supplier.",
        P4501: "Quotation not found.",
        P4502:
          "A current fully archived MRF and active quotation draft are required. Existing input is preserved.",
        P4503:
          "This retry identity was used for different input. Reopen and review your changes.",
        P4504:
          "Resolve the displayed readiness issues and confirm the current source, material matches and financial review before this action.",
        P4201:
          "Set up or repair the project document folder before archiving this revision.",
      };
      if (messages[error.code])
        return {
          ok: false,
          message: messages[error.code],
          conflict: error.code === "40001",
        };
    }
    return {
      ok: false,
      message:
        "The response was interrupted. Retry the same request to check its saved outcome.",
    };
  }
}

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
    const result = record(
      await serviceRpc("quotation_command", { actor, command }),
    );
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
    return {
      ok: true,
      quote: checked.quotes[0],
      quoteId: result.quoteId,
      message: result.changed ? "Quotation saved." : "No changes to save.",
    };
  } catch (error) {
    if (error instanceof ServiceCommandError) {
      const messages: Record<string, string> = {
        "40001":
          "The quotation or originals changed. Your input is preserved. Review the latest saved version.",
        "42501": "Your access changed. Refresh and sign in again if needed.",
        "23514":
          "Check the source values, material links and verified originals. Financial finalization is unavailable.",
        "23505":
          "An active draft or unfinished file group already exists for this MRF and supplier.",
        P4501: "Quotation not found.",
        P4502:
          "A current fully archived MRF and active quotation draft are required. Existing input is preserved.",
        P4503:
          "This retry identity was used for different input. Reopen and review your changes.",
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

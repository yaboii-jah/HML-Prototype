import "server-only";
import { serviceRpc } from "@/src/server/auth/service-rpc";
import { record } from "@/src/domain/projects/projects";
import { parseQuotationsView } from "@/src/domain/quotations/drafts";
import {
  calculateQuotation,
  quotationHeaderIssues,
} from "@/src/domain/quotations/financial";
import type { FinancialCommand } from "@/src/domain/quotations/revisions";

type Actor = {
  userId: string;
  sessionId: string;
  revision: string;
  activeRole: string;
};

export async function runFinancialCommand(
  actor: Actor,
  command: FinancialCommand,
) {
  let calculation = null;
  if (command.type === "saveFinancial" || command.type === "finalize") {
    const raw = record(
      await serviceRpc("quotation_financial_source", {
        actor,
        quote_id: command.quoteId,
      }),
    );
    const view = parseQuotationsView({ ...raw, role: actor.activeRole });
    const quote = view?.quotes.find((value) => value.id === command.quoteId);
    if (!quote) throw Error("The quotation is no longer available.");
    const review =
      command.type === "saveFinancial"
        ? command.review
        : quote.financial?.review;
    if (!review) throw Error("Save the financial review first.");
    calculation = calculateQuotation(quote.body, review);
    // A finalized source must reach the durable receipt even if its offer later
    // expires. The transaction rejects a new finalization identity for it.
    if (command.type === "finalize" && quote.state !== "finalized") {
      const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Manila",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
      const issues = [
        ...quotationHeaderIssues(quote.body, today),
        ...calculation.issues,
      ];
      if (issues.length) return { error: issues.slice(0, 3).join(" ") };
    }
  }
  // Calculations come from saved authorized data; the transaction rechecks versions.
  return serviceRpc("quotation_financial_command", {
    actor,
    command,
    calculation,
  });
}

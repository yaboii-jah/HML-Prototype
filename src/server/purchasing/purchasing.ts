import "server-only";
import { quotationActor } from "@/src/server/quotations/drafts";
import { serviceRpc, ServiceCommandError } from "@/src/server/auth/service-rpc";
import { record } from "@/src/domain/projects/projects";
import {
  parsePurchasingCommand,
  parsePurchasingView,
  type PurchasingResult,
} from "@/src/domain/purchasing/contracts";
import {
  calculatePo,
  comparisonSnapshot,
  preparePoBody,
} from "@/src/domain/purchasing/pricing";
import { dispatchComparisonArtifacts } from "./artifacts";

export async function purchasingView(mrfId: string) {
  const actor = await quotationActor();
  if (!actor) return null;
  const view = parsePurchasingView(
    await serviceRpc("purchasing_read", { actor, target_request: mrfId }),
  );
  if (!view) throw Error("Purchasing data could not be loaded.");
  for (const saved of view.records)
    if (saved.kind === "po") {
      const quote = view.quotations.quotes.find((q) => q.id === saved.quoteId);
      if (quote) {
        saved.calculation = calculatePo(quote, saved.body);
        if (
          !saved.calculation.issues.length &&
          saved.calculation.gross === "0.00" &&
          !saved.blockers.some((b) => b.startsWith("Zero-value order"))
        )
          saved.blockers.push(
            "Zero-value order: Accounting policy is required before submission",
          );
      }
    }
  await dispatchComparisonArtifacts().catch(() => {});
  return view;
}

export async function purchasingDirectory() {
  const actor = await quotationActor();
  if (!actor) return null;
  const raw = record(await serviceRpc("purchasing_read", { actor }));
  if (!raw || !Array.isArray(raw.records))
    throw Error("Purchase orders could not be loaded.");
  // Reuse the checked record parser with an empty, valid quotation projection.
  const parsed = parsePurchasingView({
    role: actor.activeRole,
    version: "0",
    demandVersion: "0",
    quotations: {
      role: actor.activeRole,
      request: null,
      suppliers: [],
      quotes: [],
      history: [],
    },
    records: raw.records,
    reports: [],
    claims: [],
    history: [],
  });
  if (!parsed) throw Error("Purchase order records are invalid.");
  return parsed.records;
}

export async function runPurchasingCommand(
  input: unknown,
): Promise<PurchasingResult> {
  const command = parsePurchasingCommand(input);
  if (!command)
    return {
      ok: false,
      message: "Check the selected action, exact quantities and order fields.",
    };
  try {
    const actor = await quotationActor();
    if (actor?.activeRole !== "Procurement")
      return {
        ok: false,
        message: "Use your Procurement role to prepare purchasing records.",
      };
    const view = await purchasingView(command.mrfId);
    if (!view?.quotations.request)
      return { ok: false, message: "MRF unavailable." };
    let calculation = null,
      snapshot = null;
    const saved = view.records.find((r) => r.id === command.targetId);
    const quote = view.quotations.quotes.find(
      (q) => q.id === (command.quoteId ?? saved?.quoteId),
    );
    if (
      command.type === "savePo" ||
      command.type === "rebind" ||
      command.type === "checkPo" ||
      command.type === "convert"
    ) {
      const body =
        command.type === "checkPo" || command.type === "convert"
          ? saved?.body
          : command.body;
      if (!quote || !body)
        return {
          ok: false,
          message: "The selected order or quotation is unavailable.",
        };
      calculation = calculatePo(
        quote,
        command.type === "convert" ? preparePoBody(quote, body) : body,
      );
      if (command.type === "checkPo" && calculation.issues.length)
        return { ok: false, message: calculation.issues.slice(0, 3).join(" ") };
    }
    // A completed save must still reach its receipt after an offer/MRF gate changes.
    if (
      command.type === "saveComparison" &&
      !view.reports.some((report) => report.id === command.targetId)
    ) {
      snapshot = comparisonSnapshot(
        view,
        command.selections ?? [],
        "",
        new Date().toISOString(),
      );
      if (JSON.stringify(snapshot).length > 10 * 1024 * 1024)
        return {
          ok: false,
          message:
            "This comparison exceeds the supported document size. Reduce source text before creating another version.",
        };
    }
    const result = record(
      await serviceRpc("purchasing_command", {
        actor,
        command,
        calculation,
        snapshot,
      }),
    );
    if (
      !result ||
      typeof result.targetId !== "string" ||
      typeof result.changed !== "boolean"
    )
      throw Error("Invalid purchasing result.");
    await dispatchComparisonArtifacts().catch(() => {});
    const messages: Record<string, string> = {
      saveAward: "Supplier award saved.",
      savePo: "PO draft saved. Review its current pricing and details.",
      rebind:
        "Source rebound. Review the copied financial basis before confirming preparation.",
      cancel: "Cancelled. Its demand is available for sourcing.",
      reopen: "Reopened after availability checks.",
      convert:
        "PO draft created. Its award quantities were transferred atomically.",
      checkPo:
        "Saved preparation confirmed. Accounting submission remains unavailable.",
      saveComparison:
        "Comparison version saved. PDF and XLSX archiving is queued.",
      retryArtifact: "Artifact queued for retry.",
    };
    return {
      ok: true,
      targetId: result.targetId,
      message: result.changed ? messages[command.type] : "No changes to save.",
    };
  } catch (error) {
    if (error instanceof ServiceCommandError) {
      const messages: Record<string, string> = {
        "40001":
          "Purchasing, demand or the supplier source changed. Your input is preserved. Review the latest saved values before retrying.",
        "42501": "Your access changed. Refresh and sign in again if needed.",
        "23505":
          "An active award or PO already exists for this MRF and supplier. Open that record.",
        "23514":
          "Check source capacity, exact quantities, reviewed adjustments and required reasons.",
        P4801: "The purchasing record is unavailable.",
        P4802:
          "A current eligible archived source is required. Blocked records retain their claims; reduce, cancel or explicitly rebind them.",
        P4803:
          "This retry identity was used for different input. Review and retry with a new operation.",
        P4804:
          "Resolve the current pricing, required details and policy blockers before confirming preparation or retrying.",
        P4201:
          "Set up or repair the project's document folder before saving comparison artifacts.",
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
        error instanceof Error && !(error instanceof ServiceCommandError)
          ? error.message
          : "The response was interrupted. Retry the same request to check its saved outcome.",
    };
  }
}

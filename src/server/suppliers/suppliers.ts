import "server-only";
import { readSession } from "@/src/server/auth/session";
import { serviceRpc, ServiceCommandError } from "@/src/server/auth/service-rpc";
import { record } from "@/src/domain/projects/projects";
import { parseSupplierCommand, parseSupplierView, supplierNameKey, type SupplierResult } from "@/src/domain/suppliers/suppliers";

async function supplierActor() {
  const session = await readSession();
  if (!session?.activeRole || session.activeRole === "Site Personnel") return null;
  return { userId: session.context.userId, sessionId: session.sessionId,
    revision: session.context.revision, activeRole: session.activeRole };
}
export async function supplierView(id?: string) {
  const actor = await supplierActor();
  if (!actor) return null;
  const raw = record(await serviceRpc("suppliers_read", { actor, ...(id ? { target_supplier: id } : {}) }));
  const parsed = parseSupplierView({ ...raw, role: actor.activeRole,
    suppliers: id ? (raw?.supplier ? [raw.supplier] : []) : raw?.suppliers });
  if (!parsed) throw Error("Suppliers could not be loaded.");
  return parsed;
}
export async function runSupplierCommand(input: unknown): Promise<SupplierResult> {
  const command = parseSupplierCommand(input);
  try {
    const actor = await supplierActor();
    if (!actor || actor.activeRole !== "Procurement") return { ok: false, message: "Use your Procurement role to maintain suppliers." };
    if (!command) return { ok: false, message: "Check the supplier name, email and status reason." };
    const result = record(await serviceRpc("supplier_command", { actor, command }));
    if (!result || typeof result.supplierId !== "string" || typeof result.changed !== "boolean") throw Error("Invalid supplier result");
    return { ok: true, supplierId: result.supplierId, message: result.changed ? "Supplier saved." : "No changes to save." };
  } catch (error) {
    if (error instanceof ServiceCommandError) {
      if (error.code === "23505" && command && "profile" in command) {
        const directory = await supplierView().catch(() => null);
        const duplicate = directory?.suppliers.find(s => supplierNameKey(s.name) === supplierNameKey(command.profile.name));
        return { ok: false, message: "That name belongs to an existing supplier, including inactive records.", duplicateId: duplicate?.id };
      }
      const messages: Record<string, string> = {
        "40001": "The supplier changed. Your draft is preserved. Review the latest saved details.",
        "42501": "Your access changed. Refresh and sign in again if needed.",
        "23514": "Check the supplier name, email and status reason.",
        P4401: "This retry identity was used for different changes. Reopen the editor.",
        P4402: "This supplier could not be found.",
      };
      if (messages[error.code]) return { ok: false, message: messages[error.code], conflict: error.code === "40001" };
    }
    return { ok: false, message: "The response was interrupted. Retry the same request to check its saved outcome." };
  }
}

import { materialId } from "./ids.ts";
import type { DemoSnapshot } from "./types.ts";

// Scope identifies where a material was received; stock remains pooled per project.
export function receivedMaterialScopes(state: DemoSnapshot): Map<string, Set<string>> {
  const requests = new Map(state.requests.map(request => [request.id, request]));
  const orders = new Map(state.pos.map(po => [po.id, po]));
  const batches = new Map(state.batches.map(batch => [batch.id, batch]));
  const result = new Map<string, Set<string>>();
  for (const movement of state.movements) {
    if (movement.kind === "transfer-in" && movement.transferId && movement.quantity > 0) { const transfer = state.stockTransfers?.find(value => value.id === movement.transferId); const request = requests.get(transfer?.requestId || ""); if (request?.scopeId && request.siteId === movement.siteId) { const key = movement.siteId + "/" + materialId(movement.itemName, movement.unit); const scopes = result.get(key) || new Set<string>(); scopes.add(request.scopeId); result.set(key, scopes); } continue; }
    if (movement.kind !== "receipt" || movement.quantity <= 0 || !movement.batchId) continue;
    const batch = batches.get(movement.batchId);
    const po = batch && orders.get(batch.poId);
    const request = po && requests.get(po.mrfId);
    if (!request?.scopeId || request.siteId !== movement.siteId) continue;
    const key = `${movement.siteId}/${materialId(movement.itemName, movement.unit)}`;
    const scopes = result.get(key) || new Set<string>();
    scopes.add(request.scopeId);
    result.set(key, scopes);
  }
  return result;
}

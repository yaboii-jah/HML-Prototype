import test from "node:test";
import assert from "node:assert/strict";
import { seedDemo } from "../src/mock/fixtures/seed.ts";
import { materialId } from "../src/domain/ids.ts";
import { receivedMaterialScopes } from "../src/domain/inventory-scopes.ts";
import { inventoryFor } from "../src/domain/selectors.ts";

test("Scope provenance follows the receipt batch and PO while preserving pooled stock", () => {
  const state = seedDemo();
  const siteId = state.sites[0].id;
  state.requests = [{ id: "a", siteId, scopeId: "scope-a" }, { id: "b", siteId, scopeId: "scope-b" }];
  state.pos = [{ id: "pa", mrfId: "a" }, { id: "pb", mrfId: "b" }];
  state.batches = [{ id: "ba", poId: "pa" }, { id: "bb", poId: "pb", leg: "warehouse-site" }];
  const move = (kind, quantity, batchId, itemName = "Cement", unit = "bag") => ({ siteId, itemName, unit, kind, quantity, batchId });
  state.movements = [move("receipt", 10, "ba"), move("receipt", 20, "bb", "CEMENT", "BAG"), move("usage", -5), move("opening", 7), move("adjustment", -2)];
  const scopes = receivedMaterialScopes(state);
  const key = `${siteId}/${materialId("Cement", "bag")}`;
  assert.deepEqual([...scopes.get(key)].sort(), ["scope-a", "scope-b"]);
  const rows = inventoryFor(state, siteId);
  const filtered = rows.filter(row => scopes.get(`${siteId}/${row.id}`)?.has("scope-a"));
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].onHand, 30, "Filtering a scope retains receipts from both scopes, opening stock and usage");
});

test("Opening stock, missing links, wrong projects and zero receipts have no inferred scope", () => {
  const state = seedDemo();
  state.requests = [{ id: "r", siteId: "project-a", scopeId: "scope-a" }];
  state.pos = [{ id: "p", mrfId: "r" }];
  state.batches = [{ id: "b", poId: "p" }];
  state.movements = [
    { siteId: "project-a", itemName: "Opening", unit: "pc", kind: "opening", quantity: 3, batchId: "b" },
    { siteId: "project-a", itemName: "Unknown", unit: "pc", kind: "receipt", quantity: 3, batchId: "missing" },
    { siteId: "project-b", itemName: "Wrong project", unit: "pc", kind: "receipt", quantity: 3, batchId: "b" },
    { siteId: "project-a", itemName: "Zero", unit: "pc", kind: "receipt", quantity: 0, batchId: "b" },
  ];
  assert.equal(receivedMaterialScopes(state).size, 0);
  assert.equal(inventoryFor(state, "project-a").length, 3, "Unattributed materials remain available without a scope filter");
});

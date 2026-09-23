import type { DemoSnapshot } from "../domain/types.ts";

const oldContacts: Record<string, string> = {
  "sales@metrobuild.example": "Lina Cruz · Sales",
  "quotes@pacific.example": "Arnel Lim · Accounts",
  "orders@solidspan.example": "Mika Tan · Trade Desk",
};

const oldActivity: Record<string, string> = {
  "PO served (Demo)": "PO served",
  "Demo assignment updated": "Project assignment updated",
};

export function normalizeKnownPlaceholders(snapshot: DemoSnapshot): DemoSnapshot {
  for (const supplier of snapshot.suppliers) {
    supplier.contact = oldContacts[supplier.contact] ?? supplier.contact;
  }
  for (const movement of snapshot.movements) {
    if (movement.reason === "Opening demo stock") movement.reason = "Opening stock balance";
  }
  for (const entry of snapshot.activity) {
    entry.action = oldActivity[entry.action] ?? entry.action;
  }
  return snapshot;
}

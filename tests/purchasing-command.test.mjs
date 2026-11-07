import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { randomUUID } from "node:crypto";
import { purchasingFixture } from "./helpers/purchasing.mjs";

const fixture = purchasingFixture();
const reportId = randomUUID();
const writes = [];
globalThis.__purchasingCommand = {
  quotationActor: async () => ({
    userId: randomUUID(),
    sessionId: randomUUID(),
    revision: "1",
    activeRole: "Procurement",
  }),
  serviceRpc: async (name, args) => {
    if (name === "purchasing_read") return fixture.view;
    assert.equal(name, "purchasing_command");
    writes.push(args);
    return { targetId: reportId, changed: true };
  },
  dispatchComparisonArtifacts: async () => {},
  dispatchApprovedPoArchives: async () => {},
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only")
      return { url: "data:text/javascript,export{}", shortCircuit: true };
    const names = {
      "@/src/server/quotations/drafts": ["quotationActor"],
      "@/src/server/auth/service-rpc": ["serviceRpc"],
      "./artifacts": ["dispatchComparisonArtifacts"],
      "./approval-archives": ["dispatchApprovedPoArchives"],
    }[specifier];
    if (names)
      return {
        url:
          "data:text/javascript," +
          names
            .map(
              (name) =>
                `export const ${name}=(...args)=>globalThis.__purchasingCommand.${name}(...args);`,
            )
            .join("") +
          (specifier.includes("service-rpc")
            ? "export class ServiceCommandError extends Error{}"
            : ""),
        shortCircuit: true,
      };
    if (specifier.startsWith("@/src/domain/"))
      return nextResolve(
        new URL("../" + specifier.slice(2) + ".ts", import.meta.url).href,
        context,
      );
    return nextResolve(specifier, context);
  },
});
const { runPurchasingCommand } =
  await import("../src/server/purchasing/purchasing.ts");

test("completed comparison retry reaches its receipt after source and MRF eligibility change", async () => {
  fixture.view.reports.push({
    id: reportId,
    version: "1",
    createdAt: new Date().toISOString(),
    artifacts: [],
  });
  fixture.view.quotations.request.procurementReady = false;
  fixture.q.revision.eligible = false;
  const command = {
    type: "saveComparison",
    requestId: randomUUID(),
    targetId: reportId,
    mrfId: fixture.q.mrfId,
    expectedVersion: "0",
    expectedDemand: "0",
    selections: [],
    sources: [{ quoteId: fixture.q.id, familyVersion: "1" }],
  };
  const result = await runPurchasingCommand(command);
  assert.equal(result.ok, true);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].command, command);
  assert.equal(writes[0].snapshot, null);
  const unsaved = await runPurchasingCommand({
    ...command,
    targetId: randomUUID(),
  });
  assert.equal(unsaved.ok, false);
  assert.equal(
    writes.length,
    1,
    "new snapshot cannot bypass current eligibility",
  );
});

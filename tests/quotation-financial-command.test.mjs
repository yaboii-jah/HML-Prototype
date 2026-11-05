import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { randomUUID } from "node:crypto";
import {
  emptyQuoteBody,
  emptyQuoteLine,
} from "../src/domain/quotations/drafts.ts";
import { emptyFinancialReview } from "../src/domain/quotations/financial.ts";

let quote,
  mutations = [];
globalThis.__financialCommandRpc = async (name, values) => {
  if (name === "quotation_financial_source")
    return { request: null, suppliers: [], quotes: [quote], history: [] };
  assert.equal(name, "quotation_financial_command");
  mutations.push(values);
  return { quoteId: quote.id, changed: true };
};
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only")
      return { url: "data:text/javascript,export{}", shortCircuit: true };
    if (specifier === "@/src/server/auth/service-rpc")
      return {
        url: "data:text/javascript,export const serviceRpc=(...args)=>globalThis.__financialCommandRpc(...args)",
        shortCircuit: true,
      };
    if (specifier.startsWith("@/"))
      return next(
        new URL("../" + specifier.slice(2) + ".ts", import.meta.url).href,
        context,
      );
    return next(specifier, context);
  },
});
const { runFinancialCommand } =
  await import("../src/server/quotations/financial-commands.ts");

test("expired draft cannot finalize, while finalized retries reach the checked durable receipt", async () => {
  const body = {
    ...emptyQuoteBody(),
    ref: "RETRY-1",
    date: "2000-01-01",
    validUntil: "2000-01-02",
    paymentTerms: "Credit",
    deliveryTerms: "Delivered",
    lines: [
      {
        ...emptyQuoteLine(),
        description: "Material",
        quantity: "1",
        unit: "pc",
        unitPrice: "112",
      },
    ],
  };
  const review = {
    ...emptyFinancialReview(body),
    vatStatus: "VAT",
    priceBasis: "inclusive",
    vatRate: "12",
  };
  review.rows[0].role = "material";
  quote = {
    id: randomUUID(),
    mrfId: randomUUID(),
    supplierId: randomUUID(),
    body,
    state: "draft",
    version: "1",
    fileVersion: "1",
    creatorName: "Buyer",
    createdAt: "2000-01-01",
    checked: true,
    matches: [],
    files: [],
    groups: [],
    jobs: [],
    financial: {
      version: "1",
      sourceVersion: "1",
      filesVersion: "1",
      review,
      calculation: null,
      checked: true,
    },
  };
  const actor = {
    userId: randomUUID(),
    sessionId: randomUUID(),
    revision: "1",
    activeRole: "Procurement",
  };
  const command = {
    type: "finalize",
    requestId: randomUUID(),
    quoteId: quote.id,
    expectedVersion: "1",
    expectedFiles: "1",
    expectedFinancial: "1",
    expectedFamily: "1",
  };
  const rejected = await runFinancialCommand(actor, command);
  assert.match(rejected.error, /expired/);
  assert.equal(mutations.length, 0);
  quote.state = "finalized";
  const replay = await runFinancialCommand(actor, command);
  assert.equal(replay.quoteId, quote.id);
  assert.equal(mutations.length, 1);
  assert.deepEqual(mutations[0].command, command);
  assert.equal(mutations[0].calculation.gross, "112.00");
  assert.equal(mutations[0].calculation.net, "111.00");
});

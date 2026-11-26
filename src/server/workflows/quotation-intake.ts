import { sleep } from "workflow";

export async function quotationIntakeExtractionWorkflow(id: string) {
  "use workflow";
  await extract(id);
}

export async function quotationIntakeCleanupWorkflow(id: string) {
  "use workflow";
  let retryAt = await cleanup(id);
  while (retryAt) {
    await sleep(new Date(retryAt));
    retryAt = await cleanup(id);
  }
}

async function extract(id: string) {
  "use step";
  const { processIntakeExtraction } = await import("../quotations/intake");
  await processIntakeExtraction(id);
}

async function cleanup(id: string) {
  "use step";
  const { cleanupQuotationIntake } = await import("../quotations/intake");
  return cleanupQuotationIntake(id);
}

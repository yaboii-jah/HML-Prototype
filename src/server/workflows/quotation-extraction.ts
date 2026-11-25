import { sleep } from "workflow";

export async function quotationExtractionWorkflow(jobId: string) {
  "use workflow";
  const expiresAt = await processExtraction(jobId);
  if (expiresAt) {
    await sleep(new Date(expiresAt));
    await purgeExtraction(jobId);
  }
}

async function processExtraction(jobId: string) {
  "use step";
  const { processQuotationExtraction } = await import("../quotations/extraction");
  return processQuotationExtraction(jobId);
}

async function purgeExtraction(jobId: string) {
  "use step";
  const { quotationExtractionWorker } = await import("../quotations/extraction");
  await quotationExtractionWorker(jobId, "purge");
}

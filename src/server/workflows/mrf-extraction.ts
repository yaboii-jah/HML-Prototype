import { sleep } from "workflow";

export async function mrfExtractionWorkflow(jobId: string) {
  "use workflow";
  const expiresAt = await processExtraction(jobId);
  if (expiresAt) {
    await sleep(new Date(expiresAt));
    await purgeExtraction(jobId);
  }
}

async function processExtraction(jobId: string) {
  "use step";
  const { processMrfExtraction } = await import("../requests/extraction");
  return processMrfExtraction(jobId);
}

async function purgeExtraction(jobId: string) {
  "use step";
  const { extractionWorker } = await import("../requests/extraction");
  await extractionWorker(jobId, "purge");
}

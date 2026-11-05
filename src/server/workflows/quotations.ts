/** Small durable intent; provider bytes and credentials remain within server steps. */
export async function quotationFileWorkflow(jobId: string) {
  "use workflow";
  await processStep(jobId);
}
async function processStep(jobId: string) {
  "use step";
  const { processQuotationFileJob } = await import("../quotations/files");
  await processQuotationFileJob(jobId);
}

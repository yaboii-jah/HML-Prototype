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

export async function quotationArchiveWorkflow(jobId: string) {
  "use workflow";
  await archiveStep(jobId);
}
async function archiveStep(jobId: string) {
  "use step";
  const { processQuotationArchive } =
    await import("../quotations/revision-archives");
  await processQuotationArchive(jobId);
}

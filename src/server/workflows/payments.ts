/** Only durable identifiers cross Workflow boundaries; bytes stay in server steps. */
export async function paymentFileWorkflow(jobId: string) {
  "use workflow";
  await processStep(jobId);
}
async function processStep(jobId: string) {
  "use step";
  const { processPaymentFileJob } = await import("../payments/files");
  await processPaymentFileJob(jobId);
}

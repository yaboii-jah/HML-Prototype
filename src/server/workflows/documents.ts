/** The durable run contains a job identifier, never document bytes or credentials. */
export async function documentWorkflow(jobId: string) {
  "use workflow";
  await processStep(jobId);
}

async function processStep(jobId: string) {
  "use step";
  const { processDocumentJob } = await import("../documents/processing");
  await processDocumentJob(jobId);
}

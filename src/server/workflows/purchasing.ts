/** Workflow state carries durable IDs only; bytes/provider calls stay in the step. */
export async function comparisonArtifactWorkflow(jobId: string) {
  "use workflow";
  await archiveStep(jobId);
}
async function archiveStep(jobId: string) {
  "use step";
  const { processComparisonArtifact } = await import("../purchasing/artifacts");
  await processComparisonArtifact(jobId);
}

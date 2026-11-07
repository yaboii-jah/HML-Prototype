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

export async function approvedPoArchiveWorkflow(jobId: string) {
  "use workflow";
  await approvedPoArchiveStep(jobId);
}
async function approvedPoArchiveStep(jobId: string) {
  "use step";
  const { processApprovedPoArchive } = await import("../purchasing/approval-archives");
  await processApprovedPoArchive(jobId);
}

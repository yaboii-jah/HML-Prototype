"use server";
import { revalidatePath } from "next/cache";
import { runDraftCommand } from "@/src/server/requests/drafts";
import { runMrfWorkflow } from "@/src/server/requests/workflow";

export async function mrfWorkflowAction(input: unknown) {
  const result = await runMrfWorkflow(input);
  revalidatePath("/requests");
  if (result.ok) {
    revalidatePath(`/requests/${result.record.id}`);
    revalidatePath(`/requests/${result.record.id}/edit`);
  }
  return result;
}

export async function saveMrfDraftAction(input: unknown) {
  const result = await runDraftCommand(input);
  revalidatePath("/requests");
  if (result.ok) {
    revalidatePath(`/requests/${result.record.id}`);
    revalidatePath(`/requests/${result.record.id}/edit`);
    revalidatePath("/projects");
    revalidatePath(`/projects/${result.record.projectId}`);
  }
  return result;
}

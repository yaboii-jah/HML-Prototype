"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runProjectCommand } from "@/src/server/projects/projects";
import { parseProjectCommand } from "@/src/domain/projects/projects";

export async function projectCommandAction(input: unknown) {
  const result = await runProjectCommand(input);
  revalidatePath("/projects");
  revalidatePath("/admin");
  if (result.projectId) revalidatePath(`/projects/${result.projectId}`);
  const command = parseProjectCommand(input);
  if (result.conflict && command && "projectId" in command) {
    revalidatePath(`/projects/${command.projectId}`);
  }
  if (result.ok && result.deleted) redirect("/projects");
  return result;
}

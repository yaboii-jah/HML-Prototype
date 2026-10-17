import type { CommandRunner } from "@/src/app-state/command-gateway";
import type { OperationTarget, Site } from "@/src/domain/types";
const pending = new Map<string, Promise<boolean>>();
export function setupProjectFolder(site: Site, beginOperation: (target: OperationTarget) => Promise<CommandRunner>) {
  if (site.localArchiveId || site.driveFolderId) return Promise.resolve(true);
  const prior = pending.get(site.id);
  if (prior) return prior;
  const task = (async () => {
    const complete = await beginOperation({ kind: "project", id: site.id });
    try {
      const response = await fetch("/api/drive/projects", { method: "POST", signal: AbortSignal.timeout(30000), headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: site.id, name: site.name }) });
      const result = await response.json();
      if (!response.ok || typeof result.id !== "string" || !result.id.trim()) throw new Error(result.error || "The project folder could not be created.");
      const saved = await complete({ type: "completeProjectFolder", siteId: site.id, folderId: result.id });
      return saved.ok;
    } catch (cause) {
      await complete({ type: "failProjectFolder", siteId: site.id, error: cause instanceof Error ? cause.message : "Folder creation failed. Retry or link an existing folder." });
      return false;
    }
  })().finally(() => pending.delete(site.id));
  pending.set(site.id, task);
  return task;
}

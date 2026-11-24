import "server-only";
import { record } from "@/src/domain/projects/projects";
import { uuid } from "@/src/domain/requests/drafts";
import { serviceRpc } from "@/src/server/auth/service-rpc";
import type { DriveGateway } from "./drive-gateway";

type RequestFileKind = "mrf-original" | "mrf-form" | "mrf-support" | "quotation-original"
  | "quotation-review" | "comparison" | "po" | "payment" | "delivery" | "transfer";

function parsePath(value: unknown) {
  const path = record(value);
  if (!path || !uuid(path.requestId) || !Array.isArray(path.folders) || !path.folders.length) {
    throw Error("Invalid request folder path");
  }
  const folders = path.folders.map((value: unknown) => {
    const segment = record(value);
    if (!segment || typeof segment.key !== "string" || typeof segment.name !== "string"
      || (segment.id !== null && (typeof segment.id !== "string" || !/^[\w-]+$/.test(segment.id)))) {
      throw Error("Invalid request folder");
    }
    return { key: segment.key, name: segment.name, id: segment.id };
  });
  return { requestId: path.requestId, folders };
}

/** A retained original can still be read after its old folder becomes read-only. */
export async function recordedRequestDriveParent(kind: RequestFileKind, target: string, projectFolder: string) {
  const value = await serviceRpc("request_drive_path", {
    resource_kind: kind, target, project_folder: projectFolder, candidates: null,
  });
  if (value === null) return projectFolder;
  const path = parsePath(value);
  const parent = path.folders.at(-1)?.id;
  if (!parent) throw Error("Recorded request folder missing");
  return parent;
}

/** Resolve and verify a new admission's folders. A null path keeps the legacy layout. */
export async function requestDriveParent(
  drive: DriveGateway, kind: RequestFileKind, target: string, projectFolder: string, root: string,
): Promise<string | null> {
  await drive.validateFolder(projectFolder, root);
  const args = { resource_kind: kind, target, project_folder: projectFolder };
  const current = await serviceRpc("request_drive_path", { ...args, candidates: null });
  if (current === null) return null;

  let path = parsePath(current);
  const missing = path.folders.filter(folder => folder.id === null);
  if (missing.length) {
    const candidates = Object.fromEntries(await Promise.all(missing.map(async ({ key }) => [key, await drive.generateId()])));
    path = parsePath(await serviceRpc("request_drive_path", { ...args, candidates }));
  }
  let parent = projectFolder;
  for (const folder of path.folders) {
    if (!folder.id) throw Error("Request folder reservation missing");
    const name = folder.name.replace(/[\\/:*?"<>|]/g, "-").trim().slice(0, 120) || "Documents";
    await drive.ensureFolder(folder.id, parent, name, {
      hmlRequestId: path.requestId,
      hmlKind: "request-folder",
      hmlFolderKey: folder.key,
    });
    parent = folder.id;
  }
  return parent;
}

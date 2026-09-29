import { isWithinFolder, listChildren, validateProjectFolder, type DriveFile } from "@/src/server/drive";
import { driveAccessError, driveError } from "@/src/server/local-drive";

export const runtime = "nodejs";
const FOLDER = "application/vnd.google-apps.folder";

export async function GET(request: Request) {
  const denied = driveAccessError(request);
  if (denied) return denied;
  try {
    const params = new URL(request.url).searchParams;
    const project = await validateProjectFolder(params.get("projectFolderId") || "");
    const query = (params.get("q") || "").trim().toLocaleLowerCase().slice(0, 100);
    if (!query) {
      const folderId = params.get("folderId") || project.id;
      if (!await isWithinFolder(folderId, project.id)) return Response.json({ error: "This folder is outside the project." }, { status: 403 });
      return Response.json(await listChildren(folderId, params.get("pageToken") || undefined));
    }
    const files: DriveFile[] = [];
    const folders = [project.id];
    let scanned = 0;
    while (folders.length && scanned < 5000) {
      const folderId = folders.shift()!;
      let pageToken: string | undefined;
      do {
        const page = await listChildren(folderId, pageToken);
        for (const file of page.files) {
          scanned++;
          if (file.name.toLocaleLowerCase().includes(query)) files.push(file);
          if (file.mimeType === FOLDER) folders.push(file.id);
        }
        pageToken = page.nextPageToken;
      } while (pageToken && scanned < 5000);
    }
    return Response.json({ files: files.slice(0, 100), truncated: !!folders.length || scanned >= 5000 || files.length > 100 });
  } catch (cause) { return Response.json({ error: driveError(cause) }, { status: 502 }); }
}

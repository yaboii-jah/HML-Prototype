import { uuid } from "@/src/domain/requests/drafts";
import { ServiceCommandError } from "@/src/server/auth/service-rpc";
import { DocumentHttpError, privateDocumentRead, projectDocumentFolderId } from "@/src/server/documents/access";

export const runtime = "nodejs";

const headers = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
};

function recovery(status: number, message: string, href: string, label: string) {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Open in Google Drive</title></head><body><main><h1>Could not open the project folder</h1><p>${message}</p><a href="${href}">${label}</a></main></body></html>`,
    { status, headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } },
  );
}

export async function GET(request: Request, { params }: RouteContext<"/api/projects/[projectId]/drive-folder">) {
  const { projectId } = await params;
  if (!uuid(projectId)) {
    return recovery(404, "Choose a saved project to open its folder.", "/projects", "Return to Projects");
  }
  try {
    privateDocumentRead(request);
    const folderId = await projectDocumentFolderId(projectId);
    if (folderId === null) {
      return recovery(404, "This project has no confirmed Drive folder. An Administrator or Project Manager can link one.", "/google-drive", "Return to Google Drive");
    }
    return new Response(null, {
      status: 307,
      headers: { ...headers, Location: `https://drive.google.com/drive/folders/${folderId}` },
    });
  } catch (error) {
    if (error instanceof DocumentHttpError && error.status === 401) {
      return recovery(401, "Sign in to ConstructSync again, then reopen the project folder.", "/sign-in", "Sign in");
    }
    if (error instanceof DocumentHttpError && error.status === 403
      || error instanceof ServiceCommandError && error.code === "42501") {
      return recovery(403, "Open the project folder from ConstructSync with a role that has folder access.", "/projects", "Return to Projects");
    }
    return recovery(503, "The folder could not be checked right now. Return to the directory and try again.", "/google-drive", "Return to Google Drive");
  }
}

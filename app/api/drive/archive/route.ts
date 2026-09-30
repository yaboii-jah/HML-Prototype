import type { MRF } from "@/src/domain/types";
import { supportingPdf } from "@/src/domain/request-archive";
import { prepareRequestArchive } from "@/src/server/drive";
import { sealDriveUploadTicket } from "@/src/server/drive-upload-ticket";
import { driveAccessError, driveError } from "@/src/server/local-drive";
import { generateMrfPdf } from "@/src/server/mrf-pdf";

export const runtime = "nodejs";
export const maxDuration = 60;
const MAX = 50 * 1024 * 1024;

export async function POST(request: Request) {
  const denied = driveAccessError(request, true);
  if (denied) return denied;
  try {
    const body = await request.json() as { request?: MRF; projectFolderId?: string; projectName?: string; projectLocation?: string; supportSize?: number };
    const data = body.request;
    const supportSize = body.supportSize;
    if (!data || data.status !== "approved" || data.archive?.status !== "pending" || !data.id || !data.ref || !data.items?.length || !supportingPdf(data) || !body.projectFolderId || !Number.isInteger(supportSize) || supportSize! < 5 || supportSize! > MAX) return Response.json({ error: "The approved MRF or combined PDF is invalid." }, { status: 400 });
    const version = data.archive.versions.length + 1;
    const prepared = await prepareRequestArchive(body.projectFolderId, data.id, data.ref, version, supportUrl => generateMrfPdf(data, body.projectName || "", body.projectLocation || "", supportUrl), supportSize!);
    if ("supportFileId" in prepared) return Response.json(prepared);
    const ticket = sealDriveUploadTicket({ requestId: data.id, version, total: supportSize!, sessionUri: prepared.sessionUri, formFileId: prepared.formFileId, formUrl: prepared.formUrl });
    return Response.json({ ticket, offset: 0 });
  } catch (cause) { return Response.json({ error: driveError(cause) }, { status: 502 }); }
}

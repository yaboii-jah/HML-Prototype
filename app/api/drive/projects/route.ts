import { createProjectFolder } from "@/src/server/drive";
import { driveAccessError, driveError } from "@/src/server/local-drive";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const denied = driveAccessError(request, true);
  if (denied) return denied;
  try {
    const body = await request.json();
    if (typeof body?.projectId !== "string" || !/^[a-zA-Z0-9_-]{1,105}$/.test(body.projectId) || typeof body?.name !== "string" || !body.name.trim() || body.name.length > 200) return Response.json({ error: "Provide a valid project ID and name." }, { status: 400 });
    return Response.json(await createProjectFolder(body.projectId, body.name.trim()));
  } catch (cause) { return Response.json({ error: driveError(cause) }, { status: 400 }); }
}

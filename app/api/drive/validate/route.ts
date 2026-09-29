import { validateProjectFolder } from "@/src/server/drive";
import { driveAccessError, driveError } from "@/src/server/local-drive";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const denied = driveAccessError(request, true);
  if (denied) return denied;
  try {
    const body = await request.json() as { folder?: string };
    return Response.json(await validateProjectFolder(String(body.folder || "")));
  } catch (cause) { return Response.json({ error: driveError(cause) }, { status: 400 }); }
}

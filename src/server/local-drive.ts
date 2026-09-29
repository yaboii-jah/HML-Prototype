export function driveAccessError(request: Request, write = false): Response | null {
  const enabled = process.env.GOOGLE_DRIVE_ENABLED;
  const host = new URL(request.url).hostname;
  const local = !process.env.VERCEL_ENV && (host === "localhost" || host === "127.0.0.1" || host === "[::1]");
  if ((!local && enabled !== "true") || enabled === "false") {
    return Response.json({ error: "Google Drive is disabled for this deployment." }, { status: 503 });
  }
  if (write) {
    const origin = request.headers.get("origin");
    if (!local && !origin) return Response.json({ error: "A same-origin request is required." }, { status: 403 });
    if (origin) {
      try {
        if (new URL(origin).origin !== new URL(request.url).origin) return Response.json({ error: "A same-origin request is required." }, { status: 403 });
      } catch { return Response.json({ error: "A same-origin request is required." }, { status: 403 }); }
    }
  }
  return null;
}

export function driveError(cause: unknown) {
  return cause instanceof Error ? cause.message : "Google Drive is unavailable. Check the server configuration and retry.";
}

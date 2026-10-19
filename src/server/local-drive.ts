/** Validates the actual browser origin; forwarded headers never establish trust. */
export function validatedRequestOrigin(request: Request): string | null {
  try {
    const url = new URL(request.url);
    const local = !process.env.VERCEL_ENV && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    const origin = request.headers.get("origin");
    if (!local && !origin) return null;
    let expected = url.origin;
    const host = request.headers.get("host");
    if (local && host !== null) {
      if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(host)) return null;
      const browser = new URL(`${url.protocol}//${host}`);
      if (browser.port !== url.port) return null;
      expected = browser.origin;
    }
    if (origin && new URL(origin).origin !== expected) return null;
    return expected;
  } catch { return null; }
}
export function sameOriginError(request: Request): Response | null {
  return validatedRequestOrigin(request) ? null : Response.json({ error: "A same-origin request is required." }, { status: 403 });
}

export function driveAccessError(request: Request, write = false): Response | null {
  const enabled = process.env.GOOGLE_DRIVE_ENABLED;
  const host = new URL(request.url).hostname;
  const local = !process.env.VERCEL_ENV && (host === "localhost" || host === "127.0.0.1" || host === "[::1]");
  if ((!local && enabled !== "true") || enabled === "false") {
    return Response.json({ error: "Google Drive is disabled for this deployment." }, { status: 503 });
  }
  if (write) return sameOriginError(request);
  return null;
}

export function driveError(cause: unknown) {
  return cause instanceof Error ? cause.message : "Google Drive is unavailable. Check the server configuration and retry.";
}

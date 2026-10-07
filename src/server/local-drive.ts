export function sameOriginError(request: Request): Response | null {
  const url = new URL(request.url);
  const local = !process.env.VERCEL_ENV && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const origin = request.headers.get("origin");
  const deny = () => Response.json({ error: "A same-origin request is required." }, { status: 403 });
  if (!local && !origin) return deny();
  try {
    let expectedOrigin = url.origin;
    const browserHost = request.headers.get("host");
    if (local && browserHost !== null) {
      // Next may reconstruct request.url with its listening hostname rather than the browser's.
      // Only correct the loopback hostname; protocol and port must still match the server URL.
      if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(browserHost)) return deny();
      const browserUrl = new URL(`${url.protocol}//${browserHost}`);
      if (browserUrl.port !== url.port) return deny();
      expectedOrigin = browserUrl.origin;
    }
    if (origin && new URL(origin).origin !== expectedOrigin) return deny();
  } catch {
    return deny();
  }
  return null;
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

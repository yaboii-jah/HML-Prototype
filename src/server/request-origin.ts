/** Next may normalize its internal request URL's hostname. Compare browser Origin
 * with the server's canonical application origin when configured, never a forwarded
 * host supplied by the caller. Requests without configuration retain URL matching.
 */
export function sameApplicationOrigin(request: Request, required = false, configured = process.env.APP_ORIGIN) {
  try {
    const expected = new URL(configured || request.url);
    if (!["http:", "https:"].includes(expected.protocol) || expected.username || expected.password) return false;
    const origin = request.headers.get("origin"), site = request.headers.get("sec-fetch-site");
    return (!required || !!origin) && (!origin || origin === expected.origin)
      && (!site || ["same-origin", "none"].includes(site));
  } catch { return false; }
}

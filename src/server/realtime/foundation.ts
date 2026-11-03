import "server-only";
import { readSession } from "@/src/server/auth/session";
import { cookieAuthClient } from "@/src/server/auth/clients";
import { projectDirectory, projectDetail } from "@/src/server/projects/projects";
import { accountDirectory } from "@/src/server/accounts/accounts";
import { UUID_PATTERN } from "@/src/domain/auth/session";
import { requestView } from "@/src/server/requests/drafts";
import { sameApplicationOrigin } from "@/src/server/request-origin";

const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie", "Referrer-Policy": "no-referrer" };
const json = (value: unknown, status = 200) => Response.json(value, { status, headers });
function sameOrigin(request: Request) {
  return sameApplicationOrigin(request);
}
export async function foundationResponse(request: Request, credentials = false) {
  if (!sameOrigin(request)) return json({ error: "Same-origin access required." }, 403);
  try {
    const current = await readSession();
    if (!current) return json({ error: "Sign in again. Your session ended or access changed." }, 401);
    if (!current.activeRole) return json({ error: "Choose a current role." }, 409);
    const session = { ...current.context, activeRole: current.activeRole };
    if (credentials) {
      const client = await cookieAuthClient(true);
      if (!client) return json({ error: "Session checks are unavailable." }, 503);
      const result = await client.auth.getSession();
      if (result.error || !result.data.session) return json({ error: "Sign in again." }, 401);
      let token = result.data.session;
      if ((token.expires_at ?? 0) * 1000 <= Date.now() + 60000) {
        const renewed = await client.auth.refreshSession();
        if (renewed.error || !renewed.data.session) return json({ error: "Session renewal is unavailable. Retry." }, 503);
        token = renewed.data.session;
      }
      const verified = await client.auth.getClaims(token.access_token);
      if (verified.error || verified.data?.claims.sub !== session.userId || verified.data.claims.session_id !== current.sessionId)
        return json({ error: "Sign in again." }, 401);
      return json({ session, sessionId: current.sessionId,
        topic: `foundation:${session.userId}:${session.revision}:${current.sessionId}`,
        accessToken: token.access_token, expiresAt: token.expires_at });
    }
    const query = new URL(request.url).searchParams, view = query.get("view");
    if (view === "requests") {
      const id = query.get("requestId");
      if (id && !UUID_PATTERN.test(id)) return json({ error: "Valid request required." }, 400);
      return json({ session, view: { kind: "requests", data: await requestView(id ?? undefined) } });
    }
    if (view === "projects") return json({ session, view: { kind: "projects", data: await projectDirectory() } });
    if (view === "project") {
      const id = query.get("projectId");
      if (!id || !UUID_PATTERN.test(id)) return json({ error: "Valid project required." }, 400);
      return json({ session, view: { kind: "project", data: await projectDetail(id) } });
    }
    if (view === "accounts") {
      if (session.activeRole !== "Administrator") return json({ error: "Administrator role required." }, 403);
      return json({ session, view: { kind: "accounts", data: await accountDirectory() } });
    }
    if (view === "session") return json({ session });
    return json({ error: "Supported foundation view required." }, 400);
  } catch {
    return json({ error: "Updates could not be checked. Your draft is preserved. Retry." }, 503);
  }
}

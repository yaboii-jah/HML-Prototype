import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { chooseActiveRole, parseSessionContext, rolePreferenceCookie, workspaceEntry, UUID_PATTERN } from "@/src/domain/auth/session";
import { cookieAuthClient } from "./clients";

export class AuthUnavailableError extends Error {}

export const readSession = cache(async () => {
  const client = await cookieAuthClient();
  if (!client) return null;
  const { data: verified, error: verificationError } = await client.auth.getClaims();
  if (verificationError || !verified?.claims || typeof verified.claims.sub !== "string"
    || typeof verified.claims.session_id !== "string" || !UUID_PATTERN.test(verified.claims.session_id)) return null;
  const { data, error } = await client.rpc("auth_session_context");
  if (error) throw new AuthUnavailableError("Access could not be checked. Please try again.");
  const context = parseSessionContext(data);
  if (!context || context.userId !== verified.claims.sub) return null;
  const preference = (await cookies()).get(rolePreferenceCookie(context.userId))?.value;
  return { context, sessionId: verified.claims.session_id, activeRole: chooseActiveRole(context.roles, preference) };
});

export async function requireSession() {
  const session = await readSession();
  if (!session) redirect("/sign-in");
  return session;
}

export async function requireWorkspaceSession() {
  const session = await readSession();
  if (!session?.activeRole) {
    const destination = (await headers()).get("x-constructsync-workspace");
    redirect(workspaceEntry(session ? "/choose-role" : "/sign-in", destination));
  }
  return { ...session.context, activeRole: session.activeRole };
}

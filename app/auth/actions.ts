"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { chooseActiveRole, isAuthRole, parseLoginPreflight, parseSessionContext, rolePreferenceCookie, safeWorkspaceDestination, UUID_PATTERN } from "@/src/domain/auth/session";
import { clearAuthCookies, cookieAuthClient, passwordClient, privilegedAuthClient } from "@/src/server/auth/clients";
import { requireSession } from "@/src/server/auth/session";
import { serviceRpc } from "@/src/server/auth/service-rpc";

export type AuthFormState = { error: string };
const unavailable = "Sign-in is temporarily unavailable. Please try again.";

export async function signInAction(_state: AuthFormState, form: FormData): Promise<AuthFormState> {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password || password.length > 128) {
    return { error: "Enter a valid email and password." };
  }
  let destination = safeWorkspaceDestination(form.get("next"));
  let temporary: ReturnType<typeof passwordClient> | undefined;
  let issuedToken: string | undefined;
  try {
    temporary = passwordClient();
    const privileged = privilegedAuthClient();
    // Capture authority BEFORE the password challenge. A racing grant edit
    // makes completion fail rather than silently authorizing the new revision.
    const { data: rawPreflight, error: preflightError } = await privileged.rpc("auth_login_preflight", { login_email: email });
    const preflight = parseLoginPreflight(rawPreflight);
    if (preflightError) return { error: unavailable };
    const { data, error } = await temporary.auth.signInWithPassword({ email, password });
    if (error || !data.session) return { error: "Invalid email or password." };
    issuedToken = data.session.access_token;
    const verified = await temporary.auth.getClaims(data.session.access_token);
    const sessionId: unknown = verified.data?.claims.session_id;
    if (verified.error || verified.data?.claims.sub !== data.user.id || typeof sessionId !== "string" || !UUID_PATTERN.test(sessionId)
      || !preflight || preflight.userId !== data.user.id) return { error: "Your account has no current workspace access. Contact an Administrator." };
    const bound = await serviceRpc("auth_bind_session", {
      target_user: data.user.id, target_session: sessionId, expected_revision: preflight.revision,
      expected_credential: preflight.credential,
    });
    if (bound !== true) return { error: "Your access changed during sign-in. Sign in again." };
    const client = await cookieAuthClient(true);
    if (!client) return { error: unavailable };
    const { error: saveError } = await client.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
    if (saveError) return { error: unavailable };
    const { data: rawProjection, error: projectionError } = await client.rpc("auth_session_context");
    const projection = parseSessionContext(rawProjection);
    if (projectionError || !projection) return { error: unavailable };
    const preference = (await cookies()).get(rolePreferenceCookie(data.user.id))?.value;
    if (!chooseActiveRole(projection.roles, preference)) destination = "/choose-role";
    issuedToken = undefined;
  } catch {
    return { error: unavailable };
  } finally {
    if (issuedToken) {
      // Revoke unsuccessful fresh sessions, including their bindings via FK.
      await temporary?.auth.signOut({ scope: "local" }).catch(() => undefined);
      const client = await cookieAuthClient(true);
      await client?.auth.signOut({ scope: "local" }).catch(() => undefined);
    }
  }
  redirect(destination);
}

export async function signOutAction(): Promise<AuthFormState> {
  let bindingRemoved = false;
  try {
    const client = await cookieAuthClient(true);
    if (client) {
      try {
        const { data } = await client.auth.getClaims();
        const userId = data?.claims.sub;
        const sessionId: unknown = data?.claims.session_id;
        if (typeof userId === "string" && typeof sessionId === "string" && UUID_PATTERN.test(userId) && UUID_PATTERN.test(sessionId)) {
          const { error } = await privilegedAuthClient().rpc("auth_unbind_session", { target_user: userId, target_session: sessionId });
          bindingRemoved = !error;
        }
      } catch { /* Managed Auth sign-out is still a valid revocation path. */ }
      const { error } = await client.auth.signOut({ scope: "local" });
      if (error && !bindingRemoved) return { error: "Sign-out could not finish. Please try again." };
    }
    await clearAuthCookies();
  } catch {
    if (!bindingRemoved) return { error: "Sign-out could not finish. Please try again." };
    await clearAuthCookies();
  }
  redirect("/sign-in");
}

export async function selectRoleAction(_state: AuthFormState, form: FormData): Promise<AuthFormState> {
  const session = await requireSession();
  const role = form.get("role");
  if (!isAuthRole(role) || !session.context.roles.includes(role)) return { error: "Choose a role currently assigned to your account." };
  (await cookies()).set(rolePreferenceCookie(session.context.userId), role, {
    httpOnly: true, sameSite: "lax", secure: process.env.APP_ORIGIN?.startsWith("https:") ?? false,
    path: "/", maxAge: 60 * 60 * 24 * 365,
  });
  redirect("/projects");
}

export async function confirmPasswordAction(_state: AuthFormState, form: FormData): Promise<AuthFormState> {
  const tokenHash = String(form.get("token_hash") ?? "");
  const type = form.get("type");
  const password = String(form.get("password") ?? "");
  if (!["invite", "recovery"].includes(String(type)) || !/^[a-zA-Z0-9_-]{20,256}$/.test(tokenHash)) return { error: "This link is invalid. Request a new link from an Administrator." };
  if (password.length < 8 || password.length > 128 || password !== form.get("confirmPassword")) return { error: "Use 8–128 characters and matching passwords." };
  let client: ReturnType<typeof passwordClient> | undefined;
  try {
    client = passwordClient();
    const result = await client.auth.verifyOtp({ token_hash: tokenHash, type: type === "invite" ? "invite" : "recovery" });
    if (result.error || !result.data.session) return { error: "This link is invalid or expired. Request a new link from an Administrator." };
    // This request alone possesses the verified one-time proof. Never copy
    // this setup session to the workspace cookies or create an app binding.
    const { error } = await client.auth.updateUser({ password });
    if (error) return { error: "The password could not be saved. Request a new link and try again." };
  } catch {
    return { error: "The password update could not finish. Try signing in, or request a new link." };
  } finally {
    await client?.auth.signOut({ scope: "local" }).catch(() => undefined);
  }
  await clearAuthCookies();
  redirect("/sign-in?password=updated");
}

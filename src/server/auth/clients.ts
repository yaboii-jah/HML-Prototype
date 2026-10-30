import "server-only";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicAuthConfiguration } from "./config";

export function passwordClient() {
  const config = publicAuthConfiguration();
  if (!config) throw new Error("Authentication is unavailable.");
  return createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store", signal: init?.signal ?? AbortSignal.timeout(15000) }) },
  });
}

export function privilegedAuthClient() {
  const config = publicAuthConfiguration();
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!config || !secret) throw new Error("Authentication is unavailable.");
  return createClient(config.url, secret, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store", signal: init?.signal ?? AbortSignal.timeout(15000) }) },
  });
}

/** Per-request client. Proxy owns refresh writes during Server Component renders. */
export async function cookieAuthClient(writable = false) {
  const config = publicAuthConfiguration();
  if (!config) return null;
  const store = await cookies();
  return createServerClient(config.url, config.key, {
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store", signal: init?.signal ?? AbortSignal.timeout(15000) }) },
    cookieOptions: { sameSite: "lax", secure: process.env.APP_ORIGIN?.startsWith("https:") ?? false, httpOnly: true },
    cookies: {
      getAll: () => store.getAll(),
      setAll(values) {
        if (!writable) return;
        for (const { name, value, options } of values) store.set(name, value, options);
      },
    },
  });
}

export async function clearAuthCookies() {
  const config = publicAuthConfiguration();
  if (!config) return;
  const prefix = `sb-${new URL(config.url).hostname.split(".")[0]}-auth-token`;
  const store = await cookies();
  for (const cookie of store.getAll()) {
    if (cookie.name === prefix || (cookie.name.startsWith(prefix + ".") && /^\d+$/.test(cookie.name.slice(prefix.length + 1)))) {
      store.set(cookie.name, "", { path: "/", maxAge: 0, httpOnly: true, sameSite: "lax", secure: process.env.APP_ORIGIN?.startsWith("https:") ?? false });
    }
  }
}

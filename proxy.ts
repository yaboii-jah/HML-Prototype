import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { publicAuthConfiguration } from "@/src/server/auth/config";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Referrer-Policy", "no-referrer");
  const config = publicAuthConfiguration();
  if (!config) return response;
  const client = createServerClient(config.url, config.key, {
    cookieOptions: { sameSite: "lax", secure: request.nextUrl.protocol === "https:", httpOnly: true },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values, headers) {
        for (const { name, value } of values) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        response.headers.set("Cache-Control", "private, no-store, max-age=0");
        response.headers.set("Referrer-Policy", "no-referrer");
        for (const { name, value, options } of values) response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });
  // Identity refresh only. Database/application checks remain in each operation.
  await client.auth.getClaims();
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?)$).*)"],
};

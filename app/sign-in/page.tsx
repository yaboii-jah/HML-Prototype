import type { Metadata } from "next";
import { SignIn } from "@/src/features/auth/SignIn";
import { redirect } from "next/navigation";
import { readSession } from "@/src/server/auth/session";
import { publicAuthConfiguration } from "@/src/server/auth/config";
import { safeWorkspaceDestination } from "@/src/domain/auth/session";

export const metadata: Metadata = {
  title: "Sign in | HML ConstructSync",
  description: "Sign in to manage requests, purchases, deliveries and site inventory.",
};

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const query = await searchParams;
  const destination = safeWorkspaceDestination(query.next);
  let session;
  try { session = await readSession(); } catch { session = null; }
  if (session) redirect(session.activeRole ? destination : "/choose-role");
  return <SignIn destination={destination} configured={Boolean(publicAuthConfiguration() && process.env.SUPABASE_SECRET_KEY)} passwordUpdated={query.password === "updated"}/>;
}

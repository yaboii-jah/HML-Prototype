import Link from "next/link";
import { ConfirmPassword } from "@/src/features/auth/ConfirmPassword";
import { safeWorkspaceDestination } from "@/src/domain/auth/session";

export default async function Page({ searchParams }: PageProps<"/auth/confirm">) {
  const query = await searchParams;
  const type = query.type;
  const tokenHash = query.token_hash;
  const invalidRedirect = query.next !== undefined && (typeof query.next !== "string" || safeWorkspaceDestination(query.next) !== query.next);
  if (invalidRedirect || (type !== "invite" && type !== "recovery") || typeof tokenHash !== "string" || !/^[a-zA-Z0-9_-]{20,256}$/.test(tokenHash)) {
    return <main className="state-screen"><section className="state-card"><h1>Link unavailable</h1><p>This link is invalid or incomplete. Request a new link from an Administrator.</p><Link href="/sign-in">Back to sign in</Link></section></main>;
  }
  return <ConfirmPassword tokenHash={tokenHash} type={type}/>;
}

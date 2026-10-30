import Link from "next/link";
import { requireWorkspaceSession } from "@/src/server/auth/session";

export async function UnavailableWorkspace({ title = "Area temporarily unavailable" }: { title?: string }) {
  await requireWorkspaceSession();
  return (
    <section className="empty-page">
      <span className="eyebrow">HML CONSTRUCTSYNC</span>
      <h1>{title}</h1>
      <p>This area is temporarily unavailable while the workspace is being updated.</p>
      <Link className="button secondary" href="/projects">Back to projects</Link>
    </section>
  );
}

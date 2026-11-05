import { notFound, redirect } from "next/navigation";
import { requireWorkspaceSession } from "@/src/server/auth/session";
import { quoteUuid } from "@/src/domain/quotations/drafts";
import { quotationsView } from "@/src/server/quotations/drafts";
import { QuotationDraftWorkspace } from "@/src/features/quotations/QuotationDraftWorkspace";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requireWorkspaceSession();
  const { id } = await params;
  if (!quoteUuid(id)) notFound();
  const view = await quotationsView(id);
  if (!view) redirect("/projects");
  if (!view.request) notFound();
  return <QuotationDraftWorkspace initial={view} />;
}

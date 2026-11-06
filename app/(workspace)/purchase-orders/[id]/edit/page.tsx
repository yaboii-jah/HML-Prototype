import { redirect, notFound } from "next/navigation";
import { requireWorkspaceSession } from "@/src/server/auth/session";
import { id as uuid } from "@/src/domain/purchasing/contracts";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requireWorkspaceSession();
  const { id } = await params;
  if (!uuid(id)) notFound();
  redirect(`/purchase-orders/${id}`);
}

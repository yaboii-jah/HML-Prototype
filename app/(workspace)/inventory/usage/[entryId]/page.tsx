import { UsageEntryDetail } from "@/src/features/inventory/UsageEntries";

export default async function Page({ params }: { params: Promise<{ entryId: string }> }) {
  return <UsageEntryDetail entryId={(await params).entryId}/>;
}

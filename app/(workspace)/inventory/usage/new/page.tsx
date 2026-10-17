import { RecordUsage } from "@/src/features/inventory/UsageEntries";

export default async function Page({ searchParams }: { searchParams: Promise<{ siteId?: string | string[] }> }) {
  const { siteId } = await searchParams;
  return <RecordUsage initialSiteId={typeof siteId === "string" ? siteId : undefined}/>;
}

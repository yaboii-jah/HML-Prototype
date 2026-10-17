import { Inventory } from "@/src/features/inventory/Inventory";

export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string | string[] }> }) {
  const { view } = await searchParams;
  return <Inventory initialView={typeof view === "string" ? view : undefined}/>;
}

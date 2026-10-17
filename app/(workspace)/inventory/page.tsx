export const metadata = { title: "Site inventory | HML ConstructSync" };
import { Inventory } from "@/src/features/inventory/Inventory";

export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string | string[] }> }) {
  const { view } = await searchParams;
  return <Inventory key={typeof view === "string" ? view : "stock"} initialView={typeof view === "string" ? view : undefined}/>;
}

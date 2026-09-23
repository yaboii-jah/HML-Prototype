import { BatchForm } from "@/src/features/deliveries/Deliveries";

export default async function Page({ searchParams }: { searchParams: Promise<{ poId?: string }> }) { const { poId } = await searchParams; return <BatchForm poId={poId}/>; }

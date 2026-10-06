import { BatchForm } from "@/src/features/deliveries/Deliveries";

export default async function Page({ searchParams }: { searchParams: Promise<{ poId?: string; parentBatchId?: string }> }) { const { poId, parentBatchId } = await searchParams; return <BatchForm poId={poId} parentBatchId={parentBatchId}/>; }

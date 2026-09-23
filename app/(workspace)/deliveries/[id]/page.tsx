import { BatchDetail } from "@/src/features/deliveries/Deliveries";

export default async function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <BatchDetail id={id}/>; }

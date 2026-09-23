import { MaterialDetail } from "@/src/features/inventory/Inventory";

export default async function Page({ params }: { params: Promise<{ siteId: string; materialId: string }> }) { const { siteId, materialId } = await params; return <MaterialDetail siteId={siteId} materialId={materialId}/>; }

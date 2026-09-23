import { PurchaseOrderDetail } from "@/src/features/purchase/PurchaseOrders";

export default async function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <PurchaseOrderDetail id={id}/>; }

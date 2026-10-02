import { QuoteComparison } from "@/src/features/requests/Requests";

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ materialId?: string }> }) { const { id } = await params; const { materialId } = await searchParams; return <QuoteComparison key={`${id}:${materialId || ""}`} id={id} initialMaterialId={typeof materialId === "string" ? materialId : ""}/>; }

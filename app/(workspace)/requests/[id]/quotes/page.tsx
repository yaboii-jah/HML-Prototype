import { QuoteComparison } from "@/src/features/requests/Requests";
import { QuotationReviewPrototype } from "@/src/features/requests/quotation-review-prototype/QuotationReviewPrototype";

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ materialId?: string; reviewPrototype?: string; variant?: string }> }) {
  const { id } = await params;
  const { materialId, reviewPrototype, variant } = await searchParams;
  if (process.env.NODE_ENV !== "production" && reviewPrototype === "1") return <QuotationReviewPrototype variant={typeof variant === "string" ? variant : "A"}/>;
  return <QuoteComparison key={`${id}:${materialId || ""}`} id={id} initialMaterialId={typeof materialId === "string" ? materialId : ""}/>;
}

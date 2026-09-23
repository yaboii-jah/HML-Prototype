import { FinanceReview } from "@/src/features/finance/Finance";

export default async function Page({ params }: { params: Promise<{ poId: string }> }) { const { poId } = await params; return <FinanceReview id={poId}/>; }

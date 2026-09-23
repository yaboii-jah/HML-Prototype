import { AccountingDetail } from "@/src/features/accounting/Accounting";

export default async function Page({ params }: { params: Promise<{ poId: string }> }) { const { poId } = await params; return <AccountingDetail id={poId}/>; }

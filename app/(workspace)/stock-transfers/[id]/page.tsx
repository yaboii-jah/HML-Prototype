import { StockTransferDetail } from "@/src/features/transfers/StockTransfers";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <StockTransferDetail id={id}/>;
}

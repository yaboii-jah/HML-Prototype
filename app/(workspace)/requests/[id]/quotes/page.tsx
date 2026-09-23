import { QuoteComparison } from "@/src/features/requests/Requests";

export default async function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <QuoteComparison id={id}/>; }

import { LocalArchivedDocument } from "@/src/features/projects/LocalArchivedDocument";

export default async function Page({ params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;
  return <LocalArchivedDocument fileId={fileId}/>;
}

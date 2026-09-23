import { ProjectDetail } from "@/src/features/projects/Projects";

export default async function Page({ params }: { params: Promise<{ siteId: string }> }) { const { siteId } = await params; return <ProjectDetail id={siteId}/>; }

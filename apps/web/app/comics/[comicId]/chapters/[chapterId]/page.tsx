import { WorkbenchApp } from "@/app/components/WorkbenchApp";
import { uiCopy } from "@/app/lib/ui-copy";

export const metadata = { title: uiCopy.metadata.workbenchTitle };

export default async function ChapterWorkbenchPage({ params }: { params: Promise<{ comicId: string; chapterId: string }> }) {
  const { comicId, chapterId } = await params;
  return <WorkbenchApp comicId={comicId} chapterId={chapterId} />;
}

import { PreviewApp } from "@/app/components/PreviewApp";
import { uiCopy } from "@/app/lib/ui-copy";

export const metadata = { title: uiCopy.metadata.previewTitle };

export default async function ChapterPreviewPage({ params }: { params: Promise<{ comicId: string; chapterId: string }> }) {
  const { comicId, chapterId } = await params;
  return <PreviewApp comicId={comicId} chapterId={chapterId} />;
}

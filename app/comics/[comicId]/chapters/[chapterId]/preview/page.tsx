import { PreviewApp } from "@/app/components/PreviewApp";

export const metadata = { title: "漫画阅读预览" };

export default async function ChapterPreviewPage({ params }: { params: Promise<{ comicId: string; chapterId: string }> }) {
  const { comicId, chapterId } = await params;
  return <PreviewApp comicId={comicId} chapterId={chapterId} />;
}

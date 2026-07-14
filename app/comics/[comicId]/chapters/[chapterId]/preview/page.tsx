import { PreviewApp } from "@/app/components/PreviewApp";

export const metadata = { title: "窗边的匿名信 · 阅读预览" };

export default async function ChapterPreviewPage({ params }: { params: Promise<{ comicId: string; chapterId: string }> }) {
  const { comicId, chapterId } = await params;
  return <PreviewApp comicId={comicId} chapterId={chapterId} />;
}

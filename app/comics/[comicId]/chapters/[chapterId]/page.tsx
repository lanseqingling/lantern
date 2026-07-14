import { WorkbenchApp } from "@/app/components/WorkbenchApp";

export const metadata = { title: "窗边的匿名信 · 工作台" };

export default async function ChapterWorkbenchPage({ params }: { params: Promise<{ comicId: string; chapterId: string }> }) {
  const { comicId, chapterId } = await params;
  return <WorkbenchApp comicId={comicId} chapterId={chapterId} />;
}

import { ComicOverviewClient } from "@/app/components/ComicOverviewClient";

export const metadata = { title: "漫画详情" };

export default async function ComicPage({ params }: { params: Promise<{ comicId: string }> }) {
  const { comicId } = await params;
  return (
    <main className="chapter-page app-surface">
      <ComicOverviewClient comicId={comicId} />
    </main>
  );
}

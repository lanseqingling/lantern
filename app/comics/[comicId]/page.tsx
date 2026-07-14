import { ComicOverviewClient } from "@/app/components/ComicOverviewClient";

export const metadata = { title: "放学以后" };

export default async function ComicPage({ params }: { params: Promise<{ comicId: string }> }) {
  const { comicId } = await params;
  return (
    <main className="chapter-page">
      <ComicOverviewClient comicId={comicId} />
    </main>
  );
}

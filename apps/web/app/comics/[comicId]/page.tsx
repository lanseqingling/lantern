import { ComicOverviewClient } from "@/app/components/ComicOverviewClient";
import { RouteTransitionSurface } from "@/app/components/RouteTransitionSurface";
import { uiCopy } from "@/app/lib/ui-copy";

export const metadata = { title: uiCopy.metadata.comicTitle };

export default async function ComicPage({ params }: { params: Promise<{ comicId: string }> }) {
  const { comicId } = await params;
  return (
    <RouteTransitionSurface key={comicId} className="chapter-page app-surface">
      <ComicOverviewClient comicId={comicId} />
    </RouteTransitionSurface>
  );
}

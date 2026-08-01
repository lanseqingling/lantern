import { LibraryClient, LibraryCreateComicButton } from "@/app/components/LibraryClient";
import { WorkspaceRouteTransition } from "@/app/components/WorkspaceRouteTransition";
import Link from "next/link";
import { Icon } from "@lantern/ui";
import { uiCopy } from "@/app/lib/ui-copy";

export const metadata = { title: uiCopy.metadata.libraryTitle };

export default function WorkspacePage() {
  return (
    <WorkspaceRouteTransition>
      <header className="library-header">
        <div className="global-header-actions" aria-label={uiCopy.common.navigation.globalEntry}>
          <LibraryCreateComicButton />
          <Link href="/settings?returnTo=%2Fworkspace" className="global-icon-button app-page-corner-button" aria-label={uiCopy.common.navigation.globalSettings}><Icon name="settings" /></Link>
        </div>
      </header>
      <section className="library-hero app-page-wide">
        <span>{uiCopy.library.hero.currentWorkspace}</span>
      </section>
      <LibraryClient />
    </WorkspaceRouteTransition>
  );
}

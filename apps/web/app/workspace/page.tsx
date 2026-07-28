import Link from "next/link";
import { LibraryClient } from "@/app/components/LibraryClient";
import { WorkspaceRouteTransition } from "@/app/components/WorkspaceRouteTransition";
import { Icon, LanternBrand } from "@lantern/ui";
import { uiCopy } from "@/app/lib/ui-copy";

export const metadata = { title: uiCopy.metadata.libraryTitle };

export default function WorkspacePage() {
  return (
    <WorkspaceRouteTransition>
      <header className="library-header">
        <Link href="/" className="library-brand" aria-label={uiCopy.common.navigation.backToHomeAria}><LanternBrand variant="toolbar" primary={uiCopy.brand.name} /></Link>
        <div className="global-header-actions" aria-label={uiCopy.common.navigation.globalEntry}>
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

import Link from "next/link";
import { LibraryClient } from "@/app/components/LibraryClient";
import { WorkspaceRouteTransition } from "@/app/components/WorkspaceRouteTransition";
import { Icon } from "@lantern/ui";

export const metadata = { title: "我的漫画" };

export default function WorkspacePage() {
  return (
    <WorkspaceRouteTransition>
      <header className="library-header">
        <Link href="/" className="library-brand" aria-label="返回 Lantern 首页"><span className="lantern-logo topbar-lantern-logo"><i /></span><strong>Lantern AI</strong></Link>
        <div className="global-header-actions" aria-label="全局入口">
          <Link href="/settings?returnTo=%2Fworkspace" className="global-icon-button app-page-corner-button" aria-label="全局设置"><Icon name="settings" /></Link>
        </div>
      </header>
      <section className="library-hero app-page-wide">
        <span>当前创作空间</span>
      </section>
      <LibraryClient />
    </WorkspaceRouteTransition>
  );
}

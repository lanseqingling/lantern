import Link from "next/link";
import { LibraryClient } from "@/app/components/LibraryClient";
import { Icon } from "@/packages/ui/src";

export const metadata = { title: "我的漫画" };

export default function WorkspacePage() {
  return (
    <main className="library-page">
      <div className="library-ambient" />
      <header className="library-header">
        <Link href="/workspace" className="library-brand"><span className="lantern-logo"><i /></span><strong>Lantern AI</strong></Link>
        <div className="global-header-actions" aria-label="全局入口">
          <button type="button" className="global-icon-button" aria-label="用户页"><Icon name="user" /></button>
          <button type="button" className="global-icon-button" aria-label="全局设置"><Icon name="settings" /></button>
        </div>
      </header>
      <section className="library-hero">
        <span>当前创作空间</span>
      </section>
      <LibraryClient />
    </main>
  );
}

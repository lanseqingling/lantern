import { Suspense } from "react";
import { SettingsClient } from "@/app/components/SettingsClient";
import { uiCopy } from "@/app/lib/ui-copy";

export const metadata = { title: uiCopy.common.navigation.globalSettings };

export default function SettingsPage() {
  return <Suspense fallback={<main className="settings-page app-surface"><div className="settings-loading">{uiCopy.settings.page.loading}</div></main>}><SettingsClient /></Suspense>;
}

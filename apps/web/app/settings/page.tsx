import { Suspense } from "react";
import { SettingsClient } from "@/app/components/SettingsClient";

export const metadata = { title: "全局设置" };

export default function SettingsPage() {
  return <Suspense fallback={<main className="settings-page"><div className="settings-loading">正在载入设置…</div></main>}><SettingsClient /></Suspense>;
}

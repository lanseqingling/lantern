import type { Metadata } from "next";
import "./globals.css";
import { uiCopy } from "@/app/lib/ui-copy";

export const metadata: Metadata = {
  applicationName: uiCopy.metadata.applicationName,
  title: { default: uiCopy.metadata.defaultTitle, template: uiCopy.metadata.titleTemplate("%s") },
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

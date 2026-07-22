import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:18788";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const metadataBase = new URL(`${protocol}://${host}`);
  const description = "把故事、分镜、编排、逐格精修和阅读预览串成一个可持续创作空间。";

  return {
    metadataBase,
    applicationName: "Lantern AI",
    title: { default: "Lantern AI · 漫画创作工作台", template: "%s · Lantern AI" },
    description,
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: {
      type: "website",
      title: "Lantern AI · 让故事，一格一格成为漫画",
      description,
      images: [{ url: new URL("/landing-storyboard.png", metadataBase).toString(), width: 1024, height: 1536, alt: "Lantern AI 首页漫画分镜" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Lantern AI · 让故事，一格一格成为漫画",
      description,
      images: [new URL("/landing-storyboard.png", metadataBase).toString()],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

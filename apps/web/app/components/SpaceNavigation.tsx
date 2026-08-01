"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Icon } from "@lantern/ui";
import { apiGetComic, type ComicListItem } from "@/app/lib/api-client";
import { navigateWithContentTransition } from "@/app/lib/content-route-transition";
import { uiCopy } from "@/app/lib/ui-copy";

const RECENT_PROJECTS_KEY = "lantern-recent-projects";
const SPACE_LEVEL_EXIT_MS = 150;

type SpaceLayer = {
  key: string;
  href: string;
  label: string;
  content: "library" | string;
};

type RenderedSpaceLayer = SpaceLayer & { phase?: "enter" | "exit" };

type RecentProject = {
  comicId: string;
  chapterId: string;
  comicTitle: string;
  chapterTitle: string;
  href: string;
  openedAt: number;
};

type ProjectMetaDetail = {
  comicId: string;
  chapterId: string;
  comicTitle: string;
  chapterTitle: string;
  revision: number;
};

function readRecentProjects(): RecentProject[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECENT_PROJECTS_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is RecentProject => Boolean(
      item && typeof item === "object"
      && typeof (item as RecentProject).comicId === "string"
      && typeof (item as RecentProject).chapterId === "string"
      && typeof (item as RecentProject).comicTitle === "string"
      && typeof (item as RecentProject).chapterTitle === "string"
      && typeof (item as RecentProject).href === "string"
      && typeof (item as RecentProject).openedAt === "number",
    )).slice(0, 5);
  } catch {
    return [];
  }
}

export function SpaceNavigation() {
  const pathname = usePathname();
  const router = useRouter();
  const comicMatch = pathname.match(/^\/comics\/([^/]+)(?:\/|$)/);
  const chapterMatch = pathname.match(/^\/comics\/([^/]+)\/chapters\/([^/]+)(?:\/|$)/);
  const comicId = comicMatch ? decodeURIComponent(comicMatch[1]) : null;
  const chapterId = chapterMatch ? decodeURIComponent(chapterMatch[2]) : null;
  const isAssetSpace = /^\/comics\/[^/]+\/assets(?:\/|$)/.test(pathname);
  const isManagedSpace = pathname === "/workspace" || Boolean(comicId && !isAssetSpace);
  const [comicResult, setComicResult] = useState<{ comicId: string; comic: ComicListItem | null } | null>(null);
  const comic = comicResult?.comicId === comicId ? comicResult.comic : null;
  const [projectMeta, setProjectMeta] = useState<ProjectMetaDetail | null>(null);
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [recentOpen, setRecentOpen] = useState(false);
  const recentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!comicId) return;
    let canceled = false;
    void apiGetComic(comicId).then((next) => {
      if (!canceled) setComicResult({ comicId, comic: next });
    }).catch(() => {
      if (!canceled) setComicResult({ comicId, comic: null });
    });
    return () => { canceled = true; };
  }, [comicId]);

  useEffect(() => {
    const onProjectMeta = (event: Event) => {
      const detail = (event as CustomEvent<ProjectMetaDetail>).detail;
      if (detail?.chapterId) setProjectMeta(detail);
    };
    window.addEventListener("lantern:space-project-meta", onProjectMeta);
    return () => window.removeEventListener("lantern:space-project-meta", onProjectMeta);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (pathname === "/workspace") setRecentProjects(readRecentProjects());
      setRecentOpen(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [pathname]);

  useEffect(() => {
    if (!chapterId || !comicId || projectMeta?.chapterId !== chapterId) return;
    const project: RecentProject = {
      comicId,
      chapterId,
      comicTitle: projectMeta.comicTitle,
      chapterTitle: projectMeta.chapterTitle,
      href: pathname.endsWith("/preview") ? pathname : `/comics/${comicId}/chapters/${chapterId}`,
      openedAt: Date.now(),
    };
    const next = [project, ...readRecentProjects().filter((item) => item.chapterId !== chapterId)].slice(0, 5);
    window.localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(next));
  }, [chapterId, comicId, pathname, projectMeta]);

  useEffect(() => {
    if (!recentOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (!recentRef.current?.contains(event.target as Node)) setRecentOpen(false);
    };
    const dismissWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setRecentOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismissWithEscape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", dismissWithEscape);
    };
  }, [recentOpen]);

  const desiredLayers = useMemo<SpaceLayer[]>(() => {
    if (!isManagedSpace) return [];
    const layers: SpaceLayer[] = [{
      key: "library",
      href: "/workspace",
      label: uiCopy.spaceNavigation.library,
      content: "library",
    }];
    if (!comicId) return layers;
    const comicTitle = comic?.title ?? uiCopy.spaceNavigation.loadingComic;
    layers.push({
      key: `comic:${comicId}`,
      href: `/comics/${comicId}`,
      label: comicTitle,
      content: comic?.title.trim().slice(0, 1) || uiCopy.spaceNavigation.comicFallback,
    });
    if (!chapterId) return layers;
    const chapter = comic?.chapters.find((item) => item.id === chapterId);
    const chapterTitle = projectMeta?.chapterId === chapterId ? projectMeta.chapterTitle : chapter?.title ?? uiCopy.spaceNavigation.loadingChapter;
    const revision = projectMeta?.chapterId === chapterId ? projectMeta.revision : undefined;
    layers.push({
      key: `chapter:${chapterId}`,
      href: `/comics/${comicId}/chapters/${chapterId}`,
      label: uiCopy.spaceNavigation.chapterTooltip(comicTitle, chapterTitle, revision),
      content: Array.from(chapterTitle.trim())[0] || uiCopy.spaceNavigation.chapterFallback,
    });
    return layers;
  }, [chapterId, comic, comicId, isManagedSpace, projectMeta]);

  const [renderedLayers, setRenderedLayers] = useState<RenderedSpaceLayer[]>(desiredLayers);
  const renderedLayersRef = useRef<RenderedSpaceLayer[]>(desiredLayers);
  const desiredKeySignature = desiredLayers.map((layer) => layer.key).join("|");

  useEffect(() => {
    let exitTimer: number | undefined;
    const frame = window.requestAnimationFrame(() => {
      if (!isManagedSpace) {
        renderedLayersRef.current = [];
        setRenderedLayers([]);
        return;
      }
      const desiredKeys = new Set(desiredLayers.map((layer) => layer.key));
      const current = renderedLayersRef.current;
      const hasRemovedLayer = current.some((layer) => !desiredKeys.has(layer.key));
      const retained: RenderedSpaceLayer[] = current.map((layer) => {
        const desired = desiredLayers.find((item) => item.key === layer.key);
        if (desired) return { ...desired, phase: layer.phase === "enter" ? "enter" : undefined };
        return { ...layer, phase: "exit" };
      });
      const currentKeys = new Set(current.map((layer) => layer.key));
      const added: RenderedSpaceLayer[] = desiredLayers
        .filter((layer) => !currentKeys.has(layer.key))
        .map((layer) => ({ ...layer, phase: "enter" }));
      const next = [...retained, ...added];
      renderedLayersRef.current = next;
      setRenderedLayers(next);
      if (!hasRemovedLayer) return;
      exitTimer = window.setTimeout(() => {
        const settled = renderedLayersRef.current.filter((layer) => desiredKeys.has(layer.key));
        renderedLayersRef.current = settled;
        setRenderedLayers(settled);
      }, SPACE_LEVEL_EXIT_MS);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (exitTimer !== undefined) window.clearTimeout(exitTimer);
    };
  }, [desiredKeySignature, desiredLayers, isManagedSpace]);

  useEffect(() => {
    document.documentElement.dataset.lanternSpaceDepth = String(desiredLayers.length);
    return () => { delete document.documentElement.dataset.lanternSpaceDepth; };
  }, [desiredLayers.length]);

  if (!isManagedSpace || (!renderedLayers.length && !desiredLayers.length)) return null;
  const currentKey = desiredLayers.at(-1)?.key;
  const navigate = (href: string) => {
    if (href === pathname) return;
    const targetDepth = href === "/workspace" ? 1 : href.includes("/chapters/") ? 3 : 2;
    const direction = targetDepth < desiredLayers.length ? "back" : "forward";
    navigateWithContentTransition(direction, () => router.push(href));
  };

  return <nav className="space-navigation" aria-label={uiCopy.spaceNavigation.aria}>
    <div className="space-levels">
      {renderedLayers.map((layer) => <button
        type="button"
        key={layer.key}
        className={`space-level-button${layer.key === currentKey ? " current" : ""}${layer.phase ? ` ${layer.phase}` : ""}`}
        data-tooltip={layer.label}
        aria-label={layer.label}
        aria-current={layer.key === currentKey ? "page" : undefined}
        onClick={() => navigate(layer.href)}
      >{layer.content === "library" ? <Icon name="comic" /> : <span>{layer.content}</span>}</button>)}
    </div>
    {pathname === "/workspace" && recentProjects.length ? <div className="recent-projects" ref={recentRef}>
      <button type="button" className="space-utility-button" aria-label={uiCopy.spaceNavigation.recent} aria-expanded={recentOpen} onClick={() => setRecentOpen((open) => !open)}><Icon name="history" /></button>
      {recentOpen ? <div className="recent-project-list" aria-label={uiCopy.spaceNavigation.recentList}>
        {recentProjects.map((project, index) => <button
          type="button"
          className={`recent-project-button tone-${index % 6}`}
          key={project.chapterId}
          data-tooltip={uiCopy.spaceNavigation.recentProjectTooltip(project.comicTitle, project.chapterTitle)}
          aria-label={uiCopy.spaceNavigation.recentProjectTooltip(project.comicTitle, project.chapterTitle)}
          onClick={() => navigate(project.href)}
        >{Array.from(project.chapterTitle.trim())[0] || uiCopy.spaceNavigation.chapterFallback}</button>)}
      </div> : null}
    </div> : null}
  </nav>;
}

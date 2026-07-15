"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ComicRenderer } from "./ComicRenderer";
import { createDefaultWorkbench, loadWorkbench, type PersistedWorkbench } from "@/app/lib/workbench-state";
import { Icon } from "@/packages/ui/src";
import { apiDownloadPage, apiLoadWorkbench, configuredRuntimeAdapter } from "@/app/lib/api-client";

type PreviewSource = "snapshot" | "working";
type PageDisplayMode = "single" | "spread";

export function PreviewApp({ comicId, chapterId }: { comicId: string; chapterId: string }) {
  const router = useRouter();
  const [state, setState] = useState<PersistedWorkbench>(() => createDefaultWorkbench());
  const [source, setSource] = useState<PreviewSource>("working");
  const [pageIndex, setPageIndex] = useState(0);
  const [pageDisplayMode, setPageDisplayMode] = useState<PageDisplayMode>("single");
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [notice, setNotice] = useState("");
  const [loadError, setLoadError] = useState("");
  const verticalReaderRef = useRef<HTMLElement>(null);
  const verticalScrollFrameRef = useRef<number | null>(null);

  useEffect(() => {
    let canceled = false;
    const hydrate = async () => {
      if (configuredRuntimeAdapter() === "demo") {
        const loaded = loadWorkbench();
        if (canceled) return;
        setState(loaded);
        setSource(loaded.fixture.snapshot ? "snapshot" : "working");
        return;
      }
      try {
        const loaded = await apiLoadWorkbench(chapterId);
        if (canceled) return;
        setState(loaded.state);
        setSource(loaded.state.fixture.snapshot ? "snapshot" : "working");
        setPageDisplayMode(loaded.comic.canvasPageMode);
      } catch (error) {
        if (!canceled) setLoadError(error instanceof Error ? error.message : "无法连接 Lantern API");
      }
    };
    void hydrate();
    return () => { canceled = true; };
  }, [chapterId]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 2800);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => () => {
    if (verticalScrollFrameRef.current !== null) window.cancelAnimationFrame(verticalScrollFrameRef.current);
  }, []);

  const sourceEnvelope = source === "snapshot" && state.fixture.snapshot ? state.fixture.snapshot : state.fixture.working;
  const document = sourceEnvelope.document;
  const isVertical = document.format === "vertical";
  const shownPageIndex = Math.min(pageIndex, Math.max(0, document.units.length - 1));
  const trailingUnpairedPage = !isVertical && pageDisplayMode === "spread" && document.units.length % 2 === 1 && shownPageIndex === document.units.length - 1;
  const spreadStartIndex = Math.floor(shownPageIndex / 2) * 2;
  const displayedPageIndices = isVertical
    ? document.units.map((_, index) => index)
    : pageDisplayMode === "spread" && !trailingUnpairedPage
      ? [spreadStartIndex, spreadStartIndex + 1].filter((index) => index < document.units.length)
      : [shownPageIndex];
  const downloadPageIndices = isVertical ? [shownPageIndex] : displayedPageIndices;
  const pageStep = !isVertical && pageDisplayMode === "spread" && !trailingUnpairedPage ? 2 : 1;
  const atFirstPage = shownPageIndex === 0;
  const atLastPage = shownPageIndex >= document.units.length - 1;
  const editUrl = `/comics/${comicId}/chapters/${chapterId}?focus=${shownPageIndex}`;

  const setSourceAndClose = (next: PreviewSource) => {
    if (next === "snapshot" && !state.fixture.snapshot) return;
    setSource(next);
    setDownloadMenuOpen(false);
  };
  const switchPageMode = () => {
    const next = pageDisplayMode === "single" ? "spread" : "single";
    setPageDisplayMode(next);
    if (next === "spread") setPageIndex((index) => Math.floor(index / 2) * 2);
  };
  const goPrevious = () => {
    if (atFirstPage) { setNotice("已经是第一话"); return; }
    setPageIndex((index) => Math.max(0, index - pageStep));
  };
  const goNext = () => {
    if (atLastPage) { setNotice("已经是最后一页"); return; }
    setPageIndex((index) => Math.min(document.units.length - 1, index + pageStep));
  };
  const handleVerticalScroll = () => {
    if (verticalScrollFrameRef.current !== null) return;
    verticalScrollFrameRef.current = window.requestAnimationFrame(() => {
      verticalScrollFrameRef.current = null;
      const reader = verticalReaderRef.current;
      if (!reader) return;
      const readerCenter = reader.getBoundingClientRect().top + reader.clientHeight / 2;
      const pages = Array.from(reader.querySelectorAll<HTMLElement>("[data-preview-page-index]"));
      const focusedPage = pages.reduce<HTMLElement | undefined>((closest, candidate) => {
        if (!closest) return candidate;
        const candidateRect = candidate.getBoundingClientRect();
        const closestRect = closest.getBoundingClientRect();
        return Math.abs(candidateRect.top + candidateRect.height / 2 - readerCenter) < Math.abs(closestRect.top + closestRect.height / 2 - readerCenter) ? candidate : closest;
      }, undefined);
      const nextIndex = Number(focusedPage?.dataset.previewPageIndex);
      if (Number.isInteger(nextIndex)) setPageIndex((current) => current === nextIndex ? current : nextIndex);
    });
  };
  const downloadCurrentPage = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      if (configuredRuntimeAdapter() === "demo") throw new Error("演示模式暂不支持导出，请切换到服务端模式后重试。");
      for (const index of downloadPageIndices) await apiDownloadPage(chapterId, document.units[index]?.id ?? "", source);
      setNotice(downloadPageIndices.length === 2 ? `第 ${downloadPageIndices.map((index) => index + 1).join("、")} 页已开始下载` : `第 ${shownPageIndex + 1} 页已开始下载`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "保存失败，请稍后重试");
    } finally {
      setDownloading(false);
      setDownloadMenuOpen(false);
    }
  };

  if (loadError) return <main className="runtime-unavailable" role="alert"><section><span>LANTERN API</span><h1>预览暂时无法载入</h1><p>{loadError}</p><button type="button" onClick={() => window.location.reload()}>重新连接</button></section></main>;

  return (
    <main className={`preview-shell ${isVertical ? "format-vertical" : "format-page"}`}>
      <section ref={isVertical ? verticalReaderRef : undefined} onScroll={isVertical ? handleVerticalScroll : undefined} className={`reader paged-reader ${isVertical ? "vertical-reader" : pageDisplayMode === "spread" && !trailingUnpairedPage ? "is-spread" : "is-single"}`} data-testid="preview-reader">
        {!isVertical ? <button type="button" className="preview-page-turn previous" aria-label="上一页" onClick={goPrevious} /> : null}
        <div className={isVertical ? "preview-page-wrap vertical-preview-strip" : "preview-page-wrap"}>{displayedPageIndices.map((index) => isVertical ? <div className="vertical-preview-page" data-preview-page-index={index} key={document.units[index]?.id ?? index}><ComicRenderer document={document} resolvedResources={sourceEnvelope.resolvedResources} pageIndex={index} /></div> : <ComicRenderer key={document.units[index]?.id ?? index} document={document} resolvedResources={sourceEnvelope.resolvedResources} pageIndex={index} />)}</div>
        {!isVertical ? <button type="button" className="preview-page-turn next" aria-label="下一页" onClick={goNext} /> : null}
      </section>

      <nav className="preview-dock" aria-label="预览工具">
        <div className="preview-mode-toggle" aria-label="模式切换">
          <button type="button" aria-label="回到创作模式" onClick={() => router.push(`${editUrl}&storyboardBeat=agent`)}><Icon name="ai" /></button>
          <button type="button" className="active" aria-label="当前为预览模式"><Icon name="preview" /></button>
        </div>
        {!isVertical ? <button type="button" className={`page-display-toggle ${pageDisplayMode === "spread" ? "active" : ""}`} aria-label={pageDisplayMode === "single" ? "切换为双页模式" : "切换为单页模式"} onClick={switchPageMode}><Icon name={pageDisplayMode === "single" ? "pageSingle" : "pageSpread"} /></button> : null}
        <div className="preview-source-toggle" aria-label="版本来源">
          <button type="button" className={source === "snapshot" ? "active" : ""} disabled={!state.fixture.snapshot} aria-label="查看已保存版本" onClick={() => setSourceAndClose("snapshot")}><Icon name="versionSaved" /></button>
          <button type="button" className={source === "working" ? "active" : ""} aria-label="查看当前工作稿" onClick={() => setSourceAndClose("working")}><Icon name="versionWorking" /></button>
        </div>
        <div className="preview-save-tool">
          <button type="button" aria-label="下载选项" aria-expanded={downloadMenuOpen} onClick={() => setDownloadMenuOpen((open) => !open)}><Icon name="download" /></button>
          {downloadMenuOpen ? <div className="preview-save-menu" role="menu"><span>下载到本地</span><button type="button" disabled={downloading} onClick={() => void downloadCurrentPage()}>{downloading ? "准备下载…" : downloadPageIndices.length === 2 ? `下载当前双页 · ${downloadPageIndices.map((index) => index + 1).join("、")}` : `下载当前页 · ${shownPageIndex + 1}`}</button></div> : null}
        </div>
      </nav>
      {notice ? <div className="preview-notice" role="status">{notice}</div> : null}
    </main>
  );
}

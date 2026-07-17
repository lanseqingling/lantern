"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ComicRenderer } from "./ComicRenderer";
import { createDefaultWorkbench, loadWorkbench, type PersistedWorkbench } from "@/app/lib/workbench-state";
import { Icon } from "@/packages/ui/src";
import { apiDownloadSurface, apiLoadWorkbench, configuredRuntimeAdapter } from "@/app/lib/api-client";
import { MODE_SWITCH_MOTION_MS, modeSwitchMotionDelay } from "@/app/lib/ui-motion";
import { displayGroupForUnit, orderedUnitSurfaces, pageDisplayGroups, type PageDisplayMode } from "@/packages/shared/src";

export function PreviewApp({ comicId, chapterId }: { comicId: string; chapterId: string }) {
  const router = useRouter();
  const [state, setState] = useState<PersistedWorkbench>(() => createDefaultWorkbench());
  const [loaded, setLoaded] = useState(false);
  const [dockEntering, setDockEntering] = useState(false);
  const [modeSwitching, setModeSwitching] = useState(false);
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
        setLoaded(true);
        return;
      }
      try {
        const loaded = await apiLoadWorkbench(chapterId);
        if (canceled) return;
        setState(loaded.state);
        setPageDisplayMode(loaded.comic.canvasPageMode);
        setLoaded(true);
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

  const sourceEnvelope = state.fixture.snapshot;
  const document = sourceEnvelope?.document ?? state.fixture.working.document;
  const orderedUnits = document.reading.unitOrder.flatMap((unitId) => {
    const unit = document.units.find((item) => item.id === unitId);
    return unit ? [unit] : [];
  });
  useEffect(() => {
    if (!loaded || !sourceEnvelope) return;
    setDockEntering(true);
    const timer = window.setTimeout(() => setDockEntering(false), MODE_SWITCH_MOTION_MS + 40);
    return () => window.clearTimeout(timer);
  }, [loaded, sourceEnvelope]);
  const isVertical = document.format === "vertical";
  const shownPageIndex = Math.min(pageIndex, Math.max(0, orderedUnits.length - 1));
  const displayGroups = pageDisplayGroups(document, pageDisplayMode);
  const currentGroup = displayGroupForUnit(displayGroups, shownPageIndex);
  const currentGroupIndex = Math.max(0, displayGroups.indexOf(currentGroup));
  const displayedPageIndices = isVertical
    ? orderedUnits.map((_, index) => index)
    : currentGroup?.unitIndices ?? [shownPageIndex];
  const downloadPageIndices = isVertical ? [shownPageIndex] : displayedPageIndices;
  const downloadSurfaces = downloadPageIndices.flatMap((index) => {
    const unit = orderedUnits[index];
    return unit ? orderedUnitSurfaces(unit, document.reading.direction).map((surface) => ({ unit, surface })) : [];
  });
  const atFirstPage = isVertical ? shownPageIndex === 0 : currentGroupIndex === 0;
  const atLastPage = isVertical ? shownPageIndex >= orderedUnits.length - 1 : currentGroupIndex >= displayGroups.length - 1;
  const editUrl = `/comics/${comicId}/chapters/${chapterId}?focus=${shownPageIndex}`;
  const returnToCanvas = () => {
    if (modeSwitching) return;
    setDownloadMenuOpen(false);
    setDockEntering(false);
    setModeSwitching(true);
    window.setTimeout(() => router.push(`${editUrl}&storyboardBeat=agent`), modeSwitchMotionDelay());
  };

  const switchPageMode = () => {
    const next = pageDisplayMode === "single" ? "spread" : "single";
    setPageDisplayMode(next);
  };
  const goPrevious = () => {
    if (atFirstPage) { setNotice("已经是第一话"); return; }
    if (isVertical) setPageIndex((index) => Math.max(0, index - 1));
    else setPageIndex(displayGroups[currentGroupIndex - 1]?.unitIndices[0] ?? 0);
  };
  const goNext = () => {
    if (atLastPage) { setNotice("已经是最后一页"); return; }
    if (isVertical) setPageIndex((index) => Math.min(orderedUnits.length - 1, index + 1));
    else setPageIndex(displayGroups[currentGroupIndex + 1]?.unitIndices[0] ?? shownPageIndex);
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
      for (const { unit, surface } of downloadSurfaces) await apiDownloadSurface(chapterId, unit.id, surface.id);
      const numbers = downloadSurfaces.map(({ surface }) => surface.pageNumber).filter((number): number is number => typeof number === "number");
      setNotice(numbers.length > 1 ? `第 ${numbers.join("、")} 页已开始下载` : `第 ${numbers[0] ?? shownPageIndex + 1} 页已开始下载`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "保存失败，请稍后重试");
    } finally {
      setDownloading(false);
      setDownloadMenuOpen(false);
    }
  };
  const downloadLcd = () => {
    const bytes = new Blob([`${JSON.stringify(document, null, 2)}\n`], { type: "application/json" });
    const objectUrl = URL.createObjectURL(bytes);
    const link = window.document.createElement("a");
    link.href = objectUrl;
    link.download = `${chapterId}-saved.lcd.json`;
    window.document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    setNotice("LCD 已开始下载");
    setDownloadMenuOpen(false);
  };

  if (loadError) return <main className="runtime-unavailable" role="alert"><section><span>LANTERN API</span><h1>预览暂时无法载入</h1><p>{loadError}</p><button type="button" onClick={() => window.location.reload()}>重新连接</button></section></main>;
  if (!loaded) return <main className="runtime-unavailable"><section><span>LANTERN PREVIEW</span><h1>正在载入已保存版本</h1></section></main>;
  if (!sourceEnvelope) return <main className="runtime-unavailable" role="status"><section><span>LANTERN PREVIEW</span><h1>还没有已保存版本</h1><p>请先返回工作台保存当前一话，再进入阅读预览。</p><button type="button" onClick={() => router.push(editUrl)}>返回工作台</button></section></main>;

  return (
    <main className={`preview-shell ${isVertical ? "format-vertical" : "format-page"}`}>
      <section ref={isVertical ? verticalReaderRef : undefined} onScroll={isVertical ? handleVerticalScroll : undefined} className={`reader paged-reader ${isVertical ? "vertical-reader" : displayedPageIndices.length === 2 || currentGroup?.trueSpread ? "is-spread" : "is-single"} ${currentGroup?.trueSpread ? "is-true-spread" : ""}`} data-testid="preview-reader">
        {!isVertical ? <button type="button" className="preview-page-turn previous" aria-label="上一页" onClick={goPrevious} /> : null}
        <div className={isVertical ? "preview-page-wrap vertical-preview-strip" : "preview-page-wrap"}>{displayedPageIndices.map((index) => isVertical ? <div className="vertical-preview-page" data-preview-page-index={index} key={orderedUnits[index]?.id ?? index}><ComicRenderer document={document} resolvedResources={sourceEnvelope.resolvedResources} pageIndex={index} /></div> : <ComicRenderer key={orderedUnits[index]?.id ?? index} document={document} resolvedResources={sourceEnvelope.resolvedResources} pageIndex={index} />)}</div>
        {!isVertical ? <button type="button" className="preview-page-turn next" aria-label="下一页" onClick={goNext} /> : null}
      </section>

      <nav className={`preview-dock ${dockEntering ? "mode-entering" : ""} ${modeSwitching ? "mode-exiting" : ""}`} aria-label="预览工具">
        <div className="preview-mode-toggle" aria-label="模式切换">
          <button type="button" aria-label="回到创作模式" disabled={modeSwitching} onClick={returnToCanvas}><Icon name="ai" /></button>
          <button type="button" className="active" aria-label="当前为预览模式"><Icon name="preview" /></button>
        </div>
        {!isVertical ? <button type="button" className={`page-display-toggle ${pageDisplayMode === "spread" ? "active" : ""}`} aria-label={pageDisplayMode === "single" ? "切换为双页模式" : "切换为单页模式"} onClick={switchPageMode}><Icon name={pageDisplayMode === "single" ? "pageSingle" : "pageSpread"} /></button> : null}
        <div className="preview-save-tool">
          <button type="button" aria-label="下载选项" aria-expanded={downloadMenuOpen} onClick={() => setDownloadMenuOpen((open) => !open)}><Icon name="download" /></button>
          {downloadMenuOpen ? <div className="preview-save-menu" role="menu"><button type="button" disabled={downloading} onClick={() => void downloadCurrentPage()}>{downloading ? "准备下载…" : downloadSurfaces.length > 1 ? "下载当前物理页" : "下载当前页"}</button><button type="button" disabled={downloading} onClick={downloadLcd}>下载 LCD 文件</button></div> : null}
        </div>
      </nav>
      {notice ? <div className="preview-notice" role="status">{notice}</div> : null}
    </main>
  );
}

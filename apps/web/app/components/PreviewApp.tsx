"use client";

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ComicRenderer } from "./ComicRenderer";
import { createBlankWorkbench, loadDemoWorkbench, persistDemoWorkbench, type PersistedWorkbench } from "@/app/lib/workbench-state";
import { Icon } from "@lantern/ui";
import { apiDownloadChapterArchive, apiDownloadChapterImages, apiDownloadPage, apiDownloadPreviewSpread, apiDownloadSurface, apiLoadWorkbench, apiUpdateProjectWorkspaceSettings, configuredRuntimeAdapter } from "@/app/lib/api-client";
import { MODE_SWITCH_MOTION_MS, modeSwitchMotionDelay } from "@/app/lib/ui-motion";
import { prepareContentRouteEntry, useContentRouteEntryTransition } from "@/app/lib/content-route-transition";
import { displayGroupForUnit, orderedUnitSurfaces, pageDisplayGroups, type PageDisplayMode } from "@lantern/shared";
import { uiCopy } from "@/app/lib/ui-copy";

export function PreviewApp({ comicId, chapterId }: { comicId: string; chapterId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const entryTransition = useContentRouteEntryTransition();
  const [state, setState] = useState<PersistedWorkbench>(() => createBlankWorkbench());
  const [loaded, setLoaded] = useState(false);
  const [dockEntering, setDockEntering] = useState(false);
  const [modeSwitching, setModeSwitching] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageDisplayMode, setPageDisplayMode] = useState<PageDisplayMode>("single");
  const [workspaceProjectId, setWorkspaceProjectId] = useState<string | null>(null);
  const [previewProjectMeta, setPreviewProjectMeta] = useState<{ comicTitle: string; chapterTitle: string } | null>(null);
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [notice, setNotice] = useState("");
  const [loadError, setLoadError] = useState("");
  const [progressVisible, setProgressVisible] = useState(false);
  const verticalReaderRef = useRef<HTMLElement>(null);
  const verticalScrollFrameRef = useRef<number | null>(null);
  const progressVisibleRef = useRef(false);
  const progressDraggingRef = useRef(false);
  const workspaceSettingsCommitQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let canceled = false;
    const hydrate = async () => {
      if (configuredRuntimeAdapter() === "demo") {
        const loaded = loadDemoWorkbench();
        if (canceled) return;
        setState(loaded);
        setPageDisplayMode(loaded.workspaceSettings?.pageDisplayMode ?? "single");
        setLoaded(true);
        return;
      }
      try {
        const loaded = await apiLoadWorkbench(chapterId);
        if (canceled) return;
        setState(loaded.state);
        setPageDisplayMode(loaded.state.workspaceSettings?.pageDisplayMode ?? "single");
        setWorkspaceProjectId(loaded.ids.projectId);
        setPreviewProjectMeta({ comicTitle: loaded.comic.title, chapterTitle: loaded.chapter.title });
        setLoaded(true);
      } catch (error) {
        if (!canceled) setLoadError(error instanceof Error ? error.message : uiCopy.workbench.error.apiUnavailable);
      }
    };
    void hydrate();
    return () => { canceled = true; };
  }, [chapterId]);

  useEffect(() => {
    if (!loaded || !previewProjectMeta) return;
    window.dispatchEvent(new CustomEvent("lantern:space-project-meta", { detail: {
      comicId,
      chapterId,
      comicTitle: previewProjectMeta.comicTitle,
      chapterTitle: previewProjectMeta.chapterTitle,
      revision: state.fixture.working.revision,
    } }));
  }, [chapterId, comicId, loaded, previewProjectMeta, state.fixture.working.revision]);

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
    // This state drives the entrance transition after the persisted snapshot is ready.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
  const displayedUnitRatios = displayedPageIndices.map((index) => {
    const unit = orderedUnits[index];
    return unit ? unit.canvas.width / unit.canvas.height : 0;
  }).filter((ratio) => ratio > 0);
  const previewGroupAspect = displayedUnitRatios.reduce((sum, ratio) => sum + ratio, 0);
  const previewColumnBase = Math.min(...displayedUnitRatios);
  const previewPageWrapStyle = !isVertical && previewGroupAspect > 0 ? {
    aspectRatio: `${previewGroupAspect}`,
    gridTemplateColumns: displayedUnitRatios.map((ratio) => `${ratio / previewColumnBase}fr`).join(" "),
    "--preview-width-at-full-height": `${previewGroupAspect * 100}dvh`,
    "--preview-height-at-full-width": `${100 / previewGroupAspect}vw`,
  } as CSSProperties : undefined;
  const downloadPageIndices = isVertical ? [shownPageIndex] : displayedPageIndices;
  const downloadSurfaces = downloadPageIndices.flatMap((index) => {
    const unit = orderedUnits[index];
    return unit ? orderedUnitSurfaces(unit, document.reading.direction).map((surface) => ({ unit, surface })) : [];
  });
  const downloadSpreadUnit = !isVertical && currentGroup?.trueSpread
    ? orderedUnits[currentGroup.unitIndices[0] ?? -1]
    : undefined;
  const downloadPreviewSpreadUnits = !isVertical && !currentGroup?.trueSpread && displayedPageIndices.length === 2
    ? displayedPageIndices.map((index) => orderedUnits[index]).filter((unit): unit is NonNullable<typeof unit> => Boolean(unit))
    : [];
  const downloadsAsSpread = Boolean(downloadSpreadUnit || downloadPreviewSpreadUnits.length === 2);
  const atFirstPage = isVertical ? shownPageIndex === 0 : currentGroupIndex === 0;
  const atLastPage = isVertical ? shownPageIndex >= orderedUnits.length - 1 : currentGroupIndex >= displayGroups.length - 1;
  const progressValue = isVertical ? shownPageIndex : currentGroupIndex;
  const progressMaximum = Math.max(0, (isVertical ? orderedUnits.length : displayGroups.length) - 1);
  const progressPercent = progressMaximum > 0 ? progressValue / progressMaximum * 100 : 0;
  const editUrl = `/comics/${comicId}/chapters/${chapterId}?focus=${shownPageIndex}`;
  const openedFromChapters = searchParams.get("from") === "chapters";
  const returnUrl = openedFromChapters ? `/comics/${comicId}` : editUrl;
  const returnToSource = () => {
    if (modeSwitching) return;
    setDownloadMenuOpen(false);
    setDockEntering(false);
    setModeSwitching(true);
    prepareContentRouteEntry("back");
    window.setTimeout(() => router.push(returnUrl), modeSwitchMotionDelay());
  };
  const returnToCanvas = () => {
    if (modeSwitching) return;
    setDownloadMenuOpen(false);
    setDockEntering(false);
    setModeSwitching(true);
    prepareContentRouteEntry("back");
    window.setTimeout(() => router.push(`${editUrl}&storyboardBeat=agent`), modeSwitchMotionDelay());
  };

  const switchPageMode = () => {
    const next: PageDisplayMode = pageDisplayMode === "single" ? "spread" : "single";
    setPageDisplayMode(next);
    setState((current) => {
      const nextState = { ...current, workspaceSettings: { ...current.workspaceSettings, pageDisplayMode: next } };
      if (configuredRuntimeAdapter() === "demo") persistDemoWorkbench(nextState);
      return nextState;
    });
    if (workspaceProjectId) {
      workspaceSettingsCommitQueueRef.current = workspaceSettingsCommitQueueRef.current
        .then(() => apiUpdateProjectWorkspaceSettings(workspaceProjectId, { pageDisplayMode: next }))
        .then(() => undefined)
        .catch((error) => {
          setNotice(error instanceof Error ? error.message : uiCopy.workbench.error.apiUnavailable);
        });
    }
  };
  const goToProgress = (value: number, behavior: ScrollBehavior = "auto") => {
    const nextValue = Math.max(0, Math.min(progressMaximum, value));
    if (!isVertical) {
      setPageIndex(displayGroups[nextValue]?.unitIndices[0] ?? 0);
      return;
    }
    setPageIndex(nextValue);
    const reader = verticalReaderRef.current;
    const page = reader?.querySelector<HTMLElement>(`[data-preview-page-index="${nextValue}"]`);
    if (reader && page) reader.scrollTo({ top: page.offsetTop, behavior });
  };
  const goPrevious = () => {
    if (atFirstPage) { setNotice(uiCopy.toast.preview.firstChapter); return; }
    goToProgress(progressValue - 1, "smooth");
  };
  const goNext = () => {
    if (atLastPage) { setNotice(uiCopy.toast.common.lastPage); return; }
    goToProgress(progressValue + 1, "smooth");
  };
  const setProgressVisibility = (visible: boolean) => {
    if (progressVisibleRef.current === visible) return;
    progressVisibleRef.current = visible;
    setProgressVisible(visible);
  };
  const handlePreviewPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType !== "mouse" || progressDraggingRef.current) return;
    const inHorizontalTrigger = event.clientX >= window.innerWidth * .25 && event.clientX <= window.innerWidth * .75;
    const inVerticalTrigger = event.clientY >= window.innerHeight * .75;
    setProgressVisibility(inHorizontalTrigger && inVerticalTrigger);
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
      if (configuredRuntimeAdapter() === "demo") throw new Error(uiCopy.toast.preview.demoExportUnsupported);
      if (downloadSpreadUnit) await apiDownloadPage(chapterId, downloadSpreadUnit.id);
      else if (downloadPreviewSpreadUnits.length === 2) await apiDownloadPreviewSpread(chapterId, downloadPreviewSpreadUnits[0].id, downloadPreviewSpreadUnits[1].id);
      else for (const { unit, surface } of downloadSurfaces) await apiDownloadSurface(chapterId, unit.id, surface.id);
      const numbers = (downloadSpreadUnit?.surfaces ?? downloadSurfaces.map(({ surface }) => surface))
        .map((surface) => surface.pageNumber)
        .filter((number): number is number => typeof number === "number")
        .sort((a, b) => a - b);
      setNotice(uiCopy.toast.preview.pageDownloadStarted(numbers.length > 1 ? numbers.join("、") : String(numbers[0] ?? shownPageIndex + 1)));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : uiCopy.toast.preview.downloadFailed);
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
    setNotice(uiCopy.toast.preview.lcdDownloadStarted);
    setDownloadMenuOpen(false);
  };
  const downloadChapterImages = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      if (configuredRuntimeAdapter() === "demo") throw new Error(uiCopy.toast.preview.demoExportUnsupported);
      await apiDownloadChapterImages(chapterId);
      setNotice(uiCopy.toast.preview.chapterImagesDownloadStarted);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : uiCopy.toast.preview.chapterImagesDownloadFailed);
    } finally {
      setDownloading(false);
      setDownloadMenuOpen(false);
    }
  };
  const downloadChapterArchive = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      if (configuredRuntimeAdapter() === "demo") throw new Error(uiCopy.toast.preview.demoArchiveExportUnsupported);
      await apiDownloadChapterArchive(chapterId);
      setNotice(uiCopy.toast.preview.archiveDownloadStarted);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : uiCopy.toast.preview.archiveDownloadFailed);
    } finally {
      setDownloading(false);
      setDownloadMenuOpen(false);
    }
  };

  if (loadError) return <main className="runtime-unavailable" role="alert"><section><span>{uiCopy.brand.api}</span><h1>{uiCopy.preview.page.loadFailed}</h1><p>{loadError}</p><button type="button" onClick={() => window.location.reload()}>{uiCopy.common.action.reconnect}</button></section></main>;
  if (!loaded) return <main className="runtime-unavailable"><section><span>{uiCopy.brand.preview}</span><h1>{uiCopy.preview.page.loadingSavedVersion}</h1></section></main>;
  if (!sourceEnvelope) return <main className={`runtime-unavailable route-page-transition ${entryTransition}`} role="status"><section><span>{uiCopy.brand.preview}</span><h1>{uiCopy.preview.page.noSavedVersion}</h1><p>{uiCopy.preview.page.noSavedVersionDescription}</p><button type="button" onClick={returnToSource}>{openedFromChapters ? uiCopy.preview.action.backToChapters : uiCopy.preview.action.backToWorkbench}</button></section></main>;

  return (
    <main
      className={`preview-shell route-page-transition ${entryTransition} ${isVertical ? "format-vertical" : "format-page"} ${progressVisible ? "progress-visible" : ""}`}
      onPointerMove={handlePreviewPointerMove}
      onPointerLeave={() => { if (!progressDraggingRef.current) setProgressVisibility(false); }}
    >
      <div className="ambient ambient-cyan" /><div className="ambient ambient-amber" />
      <button type="button" className="preview-back app-page-corner-button" aria-label={openedFromChapters ? uiCopy.preview.action.backToChapters : uiCopy.preview.action.backToWorkbench} disabled={modeSwitching} onClick={returnToSource}><Icon name="collapse" /></button>
      <section ref={isVertical ? verticalReaderRef : undefined} onScroll={isVertical ? handleVerticalScroll : undefined} className={`reader paged-reader ${isVertical ? "vertical-reader" : displayedPageIndices.length === 2 || currentGroup?.trueSpread ? "is-spread" : "is-single"} ${currentGroup?.trueSpread ? "is-true-spread" : ""}`} data-testid="preview-reader">
        {!isVertical ? <button type="button" className="preview-page-turn previous" aria-label={uiCopy.viewer.action.previousPage} onClick={goPrevious} /> : null}
        <div className={isVertical ? "preview-page-wrap vertical-preview-strip" : "preview-page-wrap"} style={previewPageWrapStyle}>{displayedPageIndices.map((index) => isVertical ? <div className="vertical-preview-page" data-preview-page-index={index} key={orderedUnits[index]?.id ?? index}><ComicRenderer document={document} resolvedResources={sourceEnvelope.resolvedResources} pageIndex={index} /></div> : <ComicRenderer key={orderedUnits[index]?.id ?? index} document={document} resolvedResources={sourceEnvelope.resolvedResources} pageIndex={index} />)}</div>
        {!isVertical ? <button type="button" className="preview-page-turn next" aria-label={uiCopy.viewer.action.nextPage} onClick={goNext} /> : null}
      </section>

      <nav className="preview-progress-capsule" aria-label={uiCopy.preview.progress.navigationAria}>
        <button type="button" aria-label={uiCopy.viewer.action.previousPage} disabled={atFirstPage} onClick={goPrevious}><Icon name="collapse" /></button>
        <input
          type="range"
          min={0}
          max={progressMaximum}
          step={1}
          value={progressValue}
          disabled={progressMaximum === 0}
          aria-label={uiCopy.preview.progress.navigationAria}
          aria-valuetext={uiCopy.preview.progress.position(progressValue + 1, progressMaximum + 1)}
          style={{ "--preview-progress": `${progressPercent}%` } as CSSProperties}
          onChange={(event) => goToProgress(Number(event.currentTarget.value))}
          onPointerDown={() => { progressDraggingRef.current = true; setProgressVisibility(true); }}
          onPointerUp={() => { progressDraggingRef.current = false; }}
          onPointerCancel={() => { progressDraggingRef.current = false; setProgressVisibility(false); }}
        />
        <button type="button" aria-label={uiCopy.viewer.action.nextPage} disabled={atLastPage} onClick={goNext}><Icon name="expand" /></button>
      </nav>

      <nav className={`preview-dock ${dockEntering ? "mode-entering" : ""} ${modeSwitching ? "mode-exiting" : ""}`} aria-label={uiCopy.preview.toolbar.previewAria}>
        <div className="preview-mode-toggle" aria-label={uiCopy.preview.toolbar.modeSwitchAria}>
          <button type="button" aria-label={uiCopy.preview.toolbar.creationModeAria} disabled={modeSwitching} onClick={returnToCanvas}><Icon name="workbench" /></button>
          <button type="button" className="active" aria-label={uiCopy.preview.toolbar.currentModeAria}><Icon name="preview" /></button>
        </div>
        {!isVertical ? <button type="button" className={`page-display-toggle ${pageDisplayMode === "spread" ? "active" : ""}`} aria-label={pageDisplayMode === "single" ? uiCopy.viewer.action.spread : uiCopy.viewer.action.singlePage} onClick={switchPageMode}><Icon name={pageDisplayMode === "single" ? "pageSingle" : "pageSpread"} /></button> : null}
        <div className="preview-save-tool">
          <button type="button" aria-label={uiCopy.preview.toolbar.downloadOptionsAria} aria-expanded={downloadMenuOpen} onClick={() => setDownloadMenuOpen((open) => !open)}><Icon name="download" /></button>
          {downloadMenuOpen ? <div className="preview-save-menu" role="menu"><button type="button" disabled={downloading} onClick={() => void downloadCurrentPage()}>{downloading ? uiCopy.preview.progress.preparingDownload : downloadsAsSpread ? uiCopy.preview.action.downloadSpread : uiCopy.preview.action.downloadPage}</button><button type="button" disabled={downloading} onClick={() => void downloadChapterImages()}>{uiCopy.preview.action.downloadChapterImages}</button><button type="button" disabled={downloading} onClick={downloadLcd}>{uiCopy.preview.action.downloadLcd}</button><button type="button" disabled={downloading} onClick={() => void downloadChapterArchive()}>{uiCopy.preview.action.downloadFullLcd}</button></div> : null}
        </div>
      </nav>
      {notice ? <div className="preview-notice" role="status">{notice}</div> : null}
    </main>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@lantern/ui";
import {
  apiApplyChangeProposal,
  apiDiscardChangeProposal,
  apiDeleteSavedSnapshot,
  apiGetVersionComparison,
  apiRestoreSavedSnapshot,
  apiRetainChangeProposal,
  type VersionComparison,
} from "@/app/lib/api-client";
import { ComicRenderer } from "./ComicRenderer";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog";
import {
  formatVersionTime,
  resolveVersionDisplayUnit,
  resolveVersionScrollAnchor,
  splitTrailingVersionBlanks,
  versionComparisonBounds,
  versionScrollTopForAnchor,
  versionSideItems,
  type VersionScrollMetric,
} from "@/app/lib/version-display";
import { fitVerticalNavigatorPaper, verticalNavigatorWindow } from "@/app/lib/vertical-workspace";
import { uiCopy } from "@/app/lib/ui-copy";

const versionNavigatorHideMs = 700;

function orderedUnitIndex(document: VersionComparison["current"]["document"], unitId?: string) {
  return unitId ? document.reading.unitOrder.indexOf(unitId) : -1;
}

function FittedBlankPage({
  unit,
  comparisonBounds,
}: {
  unit?: VersionComparison["current"]["document"]["units"][number];
  comparisonBounds: { width: number; height: number };
}) {
  if (!unit) return <div className="version-difference-placeholder" />;
  return (
    <div
      className="version-page-fit"
      style={{ "--version-comparison-aspect": comparisonBounds.width / comparisonBounds.height } as CSSProperties}
    >
      <div className="version-page-comparison-plane">
        <div
          aria-hidden="true"
          className="version-page-paper blank"
          style={{
            width: `${unit.canvas.width / comparisonBounds.width * 100}%`,
            height: `${unit.canvas.height / comparisonBounds.height * 100}%`,
          }}
        />
      </div>
    </div>
  );
}

function FittedComicPage({
  document,
  resolvedResources,
  pageIndex,
  comparisonBounds,
}: {
  document: VersionComparison["current"]["document"];
  resolvedResources: VersionComparison["current"]["resolvedResources"];
  pageIndex: number;
  comparisonBounds: { width: number; height: number };
}) {
  const unit = resolveVersionDisplayUnit(document, pageIndex);
  if (!unit) return null;
  return (
    <div
      className="version-page-fit"
      style={{ "--version-comparison-aspect": comparisonBounds.width / comparisonBounds.height } as CSSProperties}
    >
      <div className="version-page-comparison-plane">
        <div
          className="version-page-paper"
          style={{
            width: `${unit.canvas.width / comparisonBounds.width * 100}%`,
            height: `${unit.canvas.height / comparisonBounds.height * 100}%`,
          }}
        >
          <ComicRenderer document={document} resolvedResources={resolvedResources} pageIndex={pageIndex} />
        </div>
      </div>
    </div>
  );
}

function elementMetric(container: HTMLElement, element: HTMLElement): VersionScrollMetric {
  const containerRect = container.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  return {
    unitId: element.dataset.compareUnit ?? "",
    top: elementRect.top - containerRect.top + container.scrollTop,
    height: elementRect.height,
  };
}

function comparisonAnchor(container: HTMLElement, comparisonId: string) {
  return [...container.querySelectorAll<HTMLElement>("[data-compare-unit]")]
    .find((element) => element.dataset.compareUnit === comparisonId);
}

export function VersionCompareApp({ targetKind, targetId }: {
  targetKind: "saved_snapshot" | "change_proposal";
  targetId: string;
}) {
  const router = useRouter();
  const [comparison, setComparison] = useState<VersionComparison | null>(null);
  const [differenceIndex, setDifferenceIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [acting, setActing] = useState(false);
  const [confirmation, setConfirmation] = useState<"apply_stale" | "discard" | "restore" | "delete" | null>(null);
  const syncingScroll = useRef(false);
  const currentScrollRef = useRef<HTMLDivElement>(null);
  const targetScrollRef = useRef<HTMLDivElement>(null);
  const navigatorRef = useRef<HTMLElement>(null);
  const navigatorFrameRef = useRef<number | null>(null);
  const navigatorHideTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let canceled = false;
    void (async () => {
      await Promise.resolve();
      if (canceled) return;
      setLoading(true);
      try {
        const result = await apiGetVersionComparison(targetKind, targetId);
        if (canceled) return;
        setComparison(result);
        setDifferenceIndex(result.firstDifferenceIndex >= 0 ? result.firstDifferenceIndex : 0);
      } catch (reason) {
        if (!canceled) setError(reason instanceof Error ? reason.message : uiCopy.workbench.versions.actionFailed);
      } finally {
        if (!canceled) setLoading(false);
      }
    })();
    return () => { canceled = true; };
  }, [targetId, targetKind]);

  const differencePositions = useMemo(() => comparison?.differences
    .map((difference, index) => difference.state === "unchanged" ? -1 : index)
    .filter((index) => index >= 0) ?? [], [comparison]);
  const selected = comparison?.differences[differenceIndex];
  const isVertical = comparison?.project.comicFormat === "vertical";
  const selectedCurrentUnit = comparison && selected?.currentUnitId
    ? comparison.current.document.units.find((unit) => unit.id === selected.currentUnitId)
    : undefined;
  const selectedTargetUnit = comparison && selected?.targetUnitId
    ? comparison.target.document.units.find((unit) => unit.id === selected.targetUnitId)
    : undefined;
  const pageBounds = useMemo(
    () => versionComparisonBounds([selectedCurrentUnit, selectedTargetUnit]),
    [selectedCurrentUnit, selectedTargetUnit],
  );
  const verticalCanvasWidth = useMemo(() => comparison ? Math.max(
    1,
    ...comparison.current.document.units.map((unit) => unit.canvas.width),
    ...comparison.target.document.units.map((unit) => unit.canvas.width),
  ) : 1, [comparison]);
  const verticalNavigatorSegments = useMemo(() => comparison?.differences.map((difference) => {
    const currentUnit = difference.currentUnitId
      ? comparison.current.document.units.find((unit) => unit.id === difference.currentUnitId)
      : undefined;
    const targetUnit = difference.targetUnitId
      ? comparison.target.document.units.find((unit) => unit.id === difference.targetUnitId)
      : undefined;
    return Math.max(currentUnit?.canvas.height ?? 0, targetUnit?.canvas.height ?? 0, 1);
  }) ?? [], [comparison]);
  const verticalNavigatorPaperSize = useMemo(
    () => fitVerticalNavigatorPaper(
      verticalCanvasWidth,
      verticalNavigatorSegments.reduce((height, segmentHeight) => height + segmentHeight, 0),
    ),
    [verticalCanvasWidth, verticalNavigatorSegments],
  );

  useEffect(() => () => {
    if (navigatorFrameRef.current !== null) cancelAnimationFrame(navigatorFrameRef.current);
    if (navigatorHideTimerRef.current !== null) clearTimeout(navigatorHideTimerRef.current);
  }, []);

  useEffect(() => {
    if (!isVertical || !selected) return;
    const frame = requestAnimationFrame(() => {
      syncingScroll.current = true;
      for (const container of [currentScrollRef.current, targetScrollRef.current]) {
        if (!container) continue;
        const anchor = comparisonAnchor(container, selected.unitId);
        if (!anchor) continue;
        container.scrollTop = versionScrollTopForAnchor(
          elementMetric(container, anchor),
          anchor.dataset.versionUnit ? .5 : 0,
          container.clientHeight,
          container.scrollHeight,
        );
      }
      requestAnimationFrame(() => { syncingScroll.current = false; });
    });
    return () => cancelAnimationFrame(frame);
  }, [differenceIndex, isVertical, selected]);

  const backToWorkbench = () => {
    if (!comparison) return router.back();
    router.push(`/comics/${comparison.project.comicId}/chapters/${comparison.project.chapterId}?versions=open`);
  };
  const act = async (operation: () => Promise<unknown>, returnAfter = true) => {
    setActing(true);
    setError("");
    try {
      await operation();
      if (returnAfter) backToWorkbench();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : uiCopy.workbench.versions.actionFailed);
    } finally {
      setActing(false);
    }
  };
  const showScrollNavigator = (source: HTMLDivElement) => {
    if (!isVertical || navigatorFrameRef.current !== null) return;
    navigatorFrameRef.current = requestAnimationFrame(() => {
      navigatorFrameRef.current = null;
      const navigator = navigatorRef.current;
      const metrics = [...source.querySelectorAll<HTMLElement>("[data-version-unit]")]
        .map((element) => elementMetric(source, element));
      const first = metrics[0];
      const last = metrics.at(-1);
      if (!navigator || !first || !last) return;
      const viewport = verticalNavigatorWindow({
        scrollTop: source.scrollTop,
        viewportHeight: source.clientHeight,
        contentTop: first.top,
        contentHeight: last.top + last.height - first.top,
      });
      navigator.style.setProperty("--navigator-window-top", `${viewport.top * 100}%`);
      navigator.style.setProperty("--navigator-window-height", `${viewport.height * 100}%`);
      navigator.classList.add("visible");
      if (navigatorHideTimerRef.current !== null) clearTimeout(navigatorHideTimerRef.current);
      navigatorHideTimerRef.current = window.setTimeout(
        () => navigator.classList.remove("visible"),
        versionNavigatorHideMs,
      );
    });
  };
  const syncScroll = (source: HTMLDivElement, targetSide: "current" | "target") => {
    showScrollNavigator(source);
    const target = targetSide === "current" ? currentScrollRef.current : targetScrollRef.current;
    if (!target || syncingScroll.current) return;
    const metrics = [...source.querySelectorAll<HTMLElement>("[data-version-unit]")]
      .map((element) => elementMetric(source, element));
    const anchor = resolveVersionScrollAnchor(metrics, source.scrollTop + source.clientHeight / 2);
    if (!anchor) return;
    const targetAnchor = comparisonAnchor(target, anchor.unitId);
    if (!targetAnchor) return;
    syncingScroll.current = true;
    target.scrollTop = versionScrollTopForAnchor(
      elementMetric(target, targetAnchor),
      targetAnchor.dataset.versionUnit ? anchor.progress : 0,
      target.clientHeight,
      target.scrollHeight,
    );
    requestAnimationFrame(() => { syncingScroll.current = false; });
  };
  const moveDifference = (direction: -1 | 1) => {
    const next = direction < 0
      ? [...differencePositions].reverse().find((index) => index < differenceIndex)
      : differencePositions.find((index) => index > differenceIndex);
    if (next !== undefined) setDifferenceIndex(next);
  };

  if (loading) return <main className="version-compare-loading"><span className="spinner" />{uiCopy.workbench.versions.loading}</main>;
  if (!comparison || error && !comparison) return <main className="version-compare-loading error"><p>{error || uiCopy.workbench.versions.actionFailed}</p><button type="button" onClick={() => router.back()}>{uiCopy.common.action.back}</button></main>;

  const currentIndex = orderedUnitIndex(comparison.current.document, selected?.currentUnitId);
  const targetIndex = orderedUnitIndex(comparison.target.document, selected?.targetUnitId);
  const statusLabel = selected?.state === "added"
    ? uiCopy.workbench.versions.added
    : selected?.state === "removed"
      ? uiCopy.workbench.versions.removed
      : selected?.state === "unchanged"
        ? uiCopy.workbench.versions.noDifference
        : uiCopy.workbench.versions.hasDifference;
  const proposalStatus = comparison.target.kind === "change_proposal" ? comparison.target.status : undefined;
  const stale = proposalStatus === "stale";
  const canApplyProposal = comparison.target.kind === "change_proposal"
    && ["available", "retained", "stale"].includes(proposalStatus ?? "");
  const canDiscardProposal = comparison.target.kind === "change_proposal"
    && ["available", "retained", "stale"].includes(proposalStatus ?? "");
  const previousDifferenceIndex = [...differencePositions].reverse().find((index) => index < differenceIndex);
  const nextDifferenceIndex = differencePositions.find((index) => index > differenceIndex);

  const verticalSide = (
    source: "current" | "target",
  ) => {
    const envelope = comparison[source];
    const otherEnvelope = comparison[source === "current" ? "target" : "current"];
    const items = versionSideItems(
      source,
      envelope.document.reading.unitOrder,
      otherEnvelope.document.reading.unitOrder,
      comparison.differences,
    );
    const { paperItems, trailingBlankItems } = splitTrailingVersionBlanks(items);
    const blankReferenceUnits = items.flatMap((item) => {
      if (item.kind !== "blank") return [];
      const unit = otherEnvelope.document.units.find((candidate) => candidate.id === item.referenceUnitId);
      return unit ? [unit] : [];
    });
    const sideCanvasWidth = Math.max(
      1,
      ...envelope.document.units.map((unit) => unit.canvas.width),
      ...blankReferenceUnits.map((unit) => unit.canvas.width),
    );
    const renderItem = (
      item: (typeof items)[number],
      outsidePaper = false,
    ) => {
      if (item.kind === "blank") {
        const referenceUnit = otherEnvelope.document.units.find((unit) => unit.id === item.referenceUnitId);
        return referenceUnit ? (
          <div
            aria-hidden="true"
            className={`version-vertical-unit version-vertical-blank ${outsidePaper ? "outside-paper" : ""}`}
            data-compare-unit={item.comparisonId}
            data-version-unit={item.comparisonId}
            key={`${source}:blank:${item.comparisonId}`}
            style={{
              width: `${referenceUnit.canvas.width / sideCanvasWidth * 100}%`,
              aspectRatio: `${referenceUnit.canvas.width} / ${referenceUnit.canvas.height}`,
            }}
          />
        ) : null;
      }
      const index = orderedUnitIndex(envelope.document, item.unitId);
      const unit = resolveVersionDisplayUnit(envelope.document, index);
      return index >= 0 && unit ? (
        <div
          className={`version-vertical-unit ${item.comparisonId === selected?.unitId ? "active" : ""}`}
          data-compare-unit={item.comparisonId}
          data-version-unit={item.unitId}
          key={`${source}:${item.unitId}`}
          style={{ width: `${unit.canvas.width / sideCanvasWidth * 100}%` }}
        >
          <ComicRenderer document={envelope.document} resolvedResources={envelope.resolvedResources} pageIndex={index} />
        </div>
      ) : null;
    };
    return (
      <div
        ref={source === "current" ? currentScrollRef : targetScrollRef}
        className="version-vertical-scroll"
        data-version-scroll={source}
        onScroll={(event) => syncScroll(event.currentTarget, source === "current" ? "target" : "current")}
      >
        <div
          className="version-vertical-paper"
          style={{ width: `${sideCanvasWidth / verticalCanvasWidth * 100}%` }}
        >
          {paperItems.map((item) => renderItem(item))}
        </div>
        {trailingBlankItems.length ? <div className="version-vertical-tail-space" style={{ width: `${sideCanvasWidth / verticalCanvasWidth * 100}%` }}>{trailingBlankItems.map((item) => renderItem(item, true))}</div> : null}
      </div>
    );
  };

  return (
    <main className="version-compare-shell">
      <button type="button" className="version-compare-back" aria-label={uiCopy.workbench.versions.backAria} onClick={backToWorkbench}><Icon name="collapse" /></button>
      <section className={`version-compare-stage ${isVertical ? "vertical" : ""}`}>
        <article>
          <header className="version-compare-meta">
            <i className="current">{uiCopy.workbench.versions.type.current}</i>
            <strong>r{comparison.current.revision}</strong>
            <time>{formatVersionTime(comparison.current.createdAt)}</time>
          </header>
          <div className="version-compare-canvas">
            {isVertical ? verticalSide("current") : currentIndex >= 0
              ? <FittedComicPage document={comparison.current.document} resolvedResources={comparison.current.resolvedResources} pageIndex={currentIndex} comparisonBounds={pageBounds} />
              : <FittedBlankPage unit={selectedTargetUnit} comparisonBounds={pageBounds} />}
          </div>
        </article>
        <div className="version-compare-divider" aria-hidden="true" />
        <i className={`version-difference-status ${selected?.state ?? "unchanged"}`}>{statusLabel}</i>
        {isVertical ? <aside ref={navigatorRef} className="vertical-scroll-navigator version-compare-scroll-navigator" aria-hidden="true"><div className="vertical-scroll-map" style={{ width: verticalNavigatorPaperSize.width, height: verticalNavigatorPaperSize.height }}>{verticalNavigatorSegments.map((height, index) => <span key={comparison.differences[index]?.unitId ?? index} style={{ flexGrow: height }} />)}<i /></div></aside> : null}
        <article className="target">
          <header className="version-compare-meta">
            <i className={comparison.target.kind === "saved_snapshot" ? "saved" : "proposal"}>{comparison.target.kind === "saved_snapshot" ? uiCopy.workbench.versions.type.saved : uiCopy.workbench.versions.type.proposal}</i>
            <strong>{comparison.target.kind === "saved_snapshot" ? `r${comparison.target.sourceWorkingRevision}` : comparison.target.title}</strong>
            <time>{formatVersionTime(comparison.target.createdAt)}</time>
          </header>
          <div className="version-compare-canvas">
            {isVertical ? verticalSide("target") : targetIndex >= 0
              ? <FittedComicPage
                  document={comparison.target.document}
                  resolvedResources={comparison.target.resolvedResources}
                  pageIndex={targetIndex}
                  comparisonBounds={pageBounds}
                />
              : <FittedBlankPage unit={selectedCurrentUnit} comparisonBounds={pageBounds} />}
          </div>
        </article>
      </section>
      <nav className="version-compare-toolbar" aria-label={uiCopy.workbench.versions.compareTitle}>
        <button type="button" aria-label={uiCopy.workbench.versions.previousUnit} disabled={differenceIndex <= 0} onClick={() => setDifferenceIndex((index) => Math.max(0, index - 1))}><Icon name="collapse" /></button>
        <span>{differenceIndex + 1} / {comparison.differences.length || 1}</span>
        <button type="button" aria-label={uiCopy.workbench.versions.nextUnit} disabled={differenceIndex >= comparison.differences.length - 1} onClick={() => setDifferenceIndex((index) => Math.min(comparison.differences.length - 1, index + 1))}><Icon name="expand" /></button>
        <button type="button" className="difference-jump" disabled={previousDifferenceIndex === undefined} onClick={() => moveDifference(-1)}>{uiCopy.workbench.versions.previousDifference}</button>
        <button type="button" className="difference-jump" disabled={nextDifferenceIndex === undefined} onClick={() => moveDifference(1)}>{uiCopy.workbench.versions.nextDifference}</button>
        <i />
        {comparison.target.kind === "change_proposal" ? <>
          <button type="button" className="secondary" disabled={acting || comparison.target.status !== "available"} onClick={() => void act(() => apiRetainChangeProposal(comparison.target.id))}>{uiCopy.workbench.versions.retain}</button>
          <button type="button" className="danger" disabled={acting || !canDiscardProposal} onClick={() => setConfirmation("discard")}>{uiCopy.workbench.versions.discard}</button>
          <button type="button" className="primary" disabled={acting || !canApplyProposal} title={stale ? uiCopy.workbench.versions.stale : undefined} onClick={() => { if (stale) setConfirmation("apply_stale"); else void act(() => apiApplyChangeProposal(comparison.target.id, comparison.current.revision)); }}>{uiCopy.workbench.versions.applyAndSave}</button>
        </> : <>
          <button type="button" className="primary" disabled={acting} onClick={() => setConfirmation("restore")}>{uiCopy.workbench.versions.restore}</button>
          <button type="button" className="secondary" disabled={acting} onClick={() => setConfirmation("delete")}>{uiCopy.workbench.versions.deleteVersion}</button>
        </>}
      </nav>
      {stale ? <p className="version-compare-notice">{uiCopy.workbench.versions.stale}</p> : error ? <p className="version-compare-notice error">{error}</p> : null}
      {confirmation === "apply_stale" && comparison.target.kind === "change_proposal" ? <DeleteConfirmDialog
        dialogId="stale-change-proposal-apply"
        tone="neutral"
        icon="history"
        title={uiCopy.workbench.versions.staleApplyConfirmTitle}
        description={uiCopy.workbench.versions.confirmStaleApply}
        confirmLabel={uiCopy.workbench.versions.applyAndSave}
        disabled={acting}
        onCancel={() => setConfirmation(null)}
        onConfirm={() => {
          setConfirmation(null);
          void act(() => apiApplyChangeProposal(comparison.target.id, comparison.current.revision));
        }}
      /> : null}
      {confirmation === "discard" && comparison.target.kind === "change_proposal" ? <DeleteConfirmDialog
        dialogId="change-proposal-discard"
        title={uiCopy.workbench.versions.discardConfirmTitle}
        description={uiCopy.workbench.versions.confirmDiscard}
        confirmLabel={uiCopy.workbench.versions.discard}
        disabled={acting}
        onCancel={() => setConfirmation(null)}
        onConfirm={() => {
          setConfirmation(null);
          void act(() => apiDiscardChangeProposal(comparison.target.id));
        }}
      /> : null}
      {confirmation === "restore" && comparison.target.kind === "saved_snapshot" ? <DeleteConfirmDialog
        dialogId="saved-snapshot-restore"
        tone="neutral"
        icon="history"
        title={uiCopy.workbench.versions.restoreConfirmTitle}
        description={uiCopy.workbench.versions.confirmRestore}
        confirmLabel={uiCopy.workbench.versions.restore}
        disabled={acting}
        onCancel={() => setConfirmation(null)}
        onConfirm={() => {
          setConfirmation(null);
          void act(() => apiRestoreSavedSnapshot(comparison.target.id, comparison.current.revision));
        }}
      /> : null}
      {confirmation === "delete" && comparison.target.kind === "saved_snapshot" ? <DeleteConfirmDialog
        dialogId="saved-snapshot-delete"
        title={uiCopy.workbench.versions.deleteVersionConfirmTitle}
        description={uiCopy.workbench.versions.confirmDeleteVersion}
        confirmLabel={uiCopy.workbench.versions.deleteVersion}
        disabled={acting}
        onCancel={() => setConfirmation(null)}
        onConfirm={() => {
          setConfirmation(null);
          void act(() => apiDeleteSavedSnapshot(comparison.target.id));
        }}
      /> : null}
    </main>
  );
}

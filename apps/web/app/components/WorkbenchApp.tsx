"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode, WheelEvent as ReactWheelEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CustomSelect } from "./CustomSelect";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog";
import { ImageViewer, type ImageViewerRequest } from "./ImageViewer";
import { ComicRenderer, type ComicContextPoint } from "./ComicRenderer";
import { AgentWorkspace, CanvasStage, CreationDock, CreationDrawer, ObjectToolbar, SessionDrawer, WorkbenchShell } from "./workbench/WorkbenchLayout";
import { FloatingMenu, MenuDivider, MenuSection } from "./workbench/FloatingPrimitives";
import { ReferenceCard } from "./workbench/ReferenceCard";
import { WorkbenchTour } from "./workbench/WorkbenchTour";
import { VersionPanel } from "./workbench/VersionPanel";
import { useOutsidePointerDismiss } from "./workbench/useOutsidePointerDismiss";
import { Icon, type IconName } from "@lantern/ui";
import type {
  Candidate,
  AssetSummary,
  CanvasElement,
  ComicFrameElement,
  ComicPage,
  ImageElement,
  PresentationUnit,
  ReferencePlacement,
  SpeechBalloonElement,
  TextCanvasElement,
  WorkspaceChangeSet,
  WorkspaceOperation,
  Geometry,
} from "@lantern/shared";
import { createComicPageViews, deriveLocalTransform, displayGroupForUnit, orderedUnitSurfaces, pageDisplayGroups, physicalPageCount, type PageDisplayMode } from "@lantern/shared";
import { applyWorkspaceChangeSet, createSnapshot, planEditorCapabilities, verticalSegmentAspectRatios, verticalSegmentHeight, type EditorCapabilityId, type EditorCapabilityRequest, type VerticalSegmentAspectRatio } from "@lantern/editor-core";
import {
  createBlankWorkbench,
  loadDemoWorkbench,
  persistDemoWorkbench,
  type ActiveTaskLike,
  type AgentMessage,
  type PersistedWorkbench,
  type Selection,
} from "@/app/lib/workbench-state";
import { saveUploadedImage } from "@/app/lib/local-assets-client";
import { assetKindTag, isAssetVisibleInAssetSpace } from "@/app/lib/asset-kind";
import { buildFrameImageChoices, type FrameImageChoice } from "@/app/lib/frame-image-choices";
import { MODE_SWITCH_MOTION_MS, modeSwitchMotionDelay } from "@/app/lib/ui-motion";
import { navigateWithContentTransition, prepareContentRouteEntry, useContentRouteEntryTransition, useDelayedLoadingIndicator } from "@/app/lib/content-route-transition";
import { fitVerticalNavigatorPaper, fitVerticalViewportWidth, nextVerticalViewportMode, verticalNavigatorWindow, verticalViewportModeMeta, type VerticalViewportMode } from "@/app/lib/vertical-workspace";
import { findAvailableFrameImageCandidateForTask, isCandidatePreviewTargetVisible, resolveReadingUnitIndex, resolveWorkbenchPageIndex } from "@/app/lib/workbench-location";
import {
  apiApplyCandidate,
  apiCancelTask,
  apiCommitChangeSet,
  apiCreateConversation,
  apiCreateTask,
  configuredRuntimeAdapter,
  apiDeletePlacement,
  apiDownloadImage,
  apiImportChapterArchive,
  LanternApiError,
  apiDiscardCandidate,
  apiGetContextDebugSnapshot,
  apiLoadWorkbench,
  apiImportAssetToCanvasList,
  apiPlaceAsset,
  apiResolveAgentMessage,
  apiRestoreSnapshot,
  apiRetryAgentInteraction,
  apiRetryTask,
  apiSaveSnapshot,
  apiStreamInteraction,
  apiUpdateCanvasAssetListItem,
  apiUpdateProjectWorkspaceSettings,
  apiUpdateConversation,
  apiUpdatePlacement,
  apiUploadAgentAttachment,
  apiUploadAsset,
  apiSaveCanvasAssetToLibrary,
  type RuntimeIds,
} from "@/app/lib/api-client";
import { uiCopy } from "@/app/lib/ui-copy";

type HistoryEntry = { fixture: PersistedWorkbench["fixture"]; label: string; kind: "working" | "placement" };
type ActiveTask = ActiveTaskLike;
type StreamingAgentTurn = { id: string; text: string; status: "thinking" | "writing" };
type ComposerAttachment = {
  id: string;
  name: string;
  imageUrl: string;
  status: "uploading" | "ready" | "failed";
  assetId?: string;
  versionId?: string;
};
type ToolbarSide = "top" | "bottom" | "left" | "right";
type ToolbarPlacement = { x: number; y: number; side: ToolbarSide };
type CanvasMode = "focus" | "free";
type CanvasObjectInteractionMode = "select" | "move" | "crop";
type FrameImageCandidatePreview = {
  candidateId: string;
  mode: "candidate" | "original";
  target: Selection;
  previousSelection: Selection;
  previousPageIndex: number;
  previousCanvasMode: CanvasMode;
  previousInteractionMode: CanvasObjectInteractionMode;
  previousInspectorOpen: boolean;
};
type CanvasCreationMode = "dialogue" | "narration" | null;
const bleedEdgeIcon: Record<"top" | "right" | "bottom" | "left", IconName> = { top: "chevronUp", right: "expand", bottom: "chevronDown", left: "collapse" };
type ComicContextMenuState = { target: Selection; point: ComicContextPoint; bleedMenu?: { left: number; top: number }; backgroundMenu?: { left: number; top: number }; imageMoreMenu?: { left: number; top: number } };
type ComicDeleteTarget = { kind: "frame" | "image" | "dialogue" | "narration"; selection: Selection };
type FrameImageTarget = { selection: Selection; left: number; top: number; position?: { x: number; y: number }; placement?: "cross_page" | "cross_segment" };
type CanvasAssetSaveKind = "character" | "scene" | "prop" | "reference_image";
type MarqueeState = { startX: number; startY: number; currentX: number; currentY: number; moved: boolean };
type MultiMoveState = { startX: number; startY: number; currentX: number; currentY: number; moved: boolean };
type MultiSelectionState = {
  comic: Selection[];
  canvasIds: string[];
  comicActive: boolean;
  canvasActive: boolean;
  moveActive: boolean;
};
type StoryboardEditorTarget = { unitId: string; frameId: string; label: string };
type StoryboardFrameRow = {
  frame: ComicFrameElement;
  page: ComicPage;
  pageIndex: number;
  beat?: PersistedWorkbench["fixture"]["storyboardBeats"][number];
  label: string;
};

type LeftView = "assets" | "storyboard" | "pages";
type PageEditorMode = "edit" | "delete";
type PageStructureAction = "merge_pages" | "split_spread" | "merge_segments" | "split_segments";
type ContextDebugSection = "input" | "world" | "assets" | "storyboard" | "page" | "activity" | "raw";
type ComposerReference = {
  id: string;
  objectType: string;
  objectId: string;
  versionId?: string;
  label: string;
  kind: "asset" | "comic_frame" | "canvas_element" | "storyboard_beat" | "speech_balloon";
  imageUrl?: string;
  balloonNumber?: number;
  dialogueText?: string;
};

const noSelection: Selection = { type: "none", label: uiCopy.workbench.selection.none };

function referenceMention(reference: NonNullable<AgentMessage["explicitReferences"]>[number]) {
  const fallback = reference.objectType === "canvas_element" ? uiCopy.workbench.defaultLabel.currentObject : reference.objectType === "storyboard_beat" ? uiCopy.workbench.creationSpace.frameSectionTitle : uiCopy.asset.label.asset;
  const label = (reference.label?.trim() || fallback).split("·")[0].replace(/\s+/g, "");
  return `@${label}`;
}

function ComicMenuGroup({ label, children }: { label: string; children: ReactNode }) {
  return <div className="comic-menu-group" aria-label={label}><MenuSection>{children}</MenuSection></div>;
}

function NumberStepper({ ariaLabel, value, step = 1, onChange, onAdjust }: { ariaLabel: string; value: string; step?: number; onChange: (value: string) => void; onAdjust: (delta: number) => void }) {
  const decimal = !Number.isInteger(step);
  const sanitize = (raw: string) => {
    if (!decimal) return raw.replace(/[^0-9]/g, "");
    const cleaned = raw.replace(/[^0-9.]/g, "");
    const [whole = "", ...fraction] = cleaned.split(".");
    return fraction.length ? `${whole}.${fraction.join("")}` : whole;
  };
  return <div className="font-size-stepper"><input type="text" inputMode={decimal ? "decimal" : "numeric"} aria-label={ariaLabel} value={value} onChange={(event) => onChange(sanitize(event.target.value))} /><span><button type="button" aria-label={uiCopy.workbench.aria.increment(ariaLabel, step)} onClick={() => onAdjust(step)}>＋</button><button type="button" aria-label={uiCopy.workbench.aria.decrement(ariaLabel, step)} onClick={() => onAdjust(-step)}>−</button></span></div>;
}
const uid = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
// Keep new references clear of the left creation drawer while still close enough
// to be used alongside the page.
const canvasReferenceDropX = 320;
const verticalWheelThreshold = 180;
const verticalWheelResetMs = 220;
const verticalWheelLockMs = 320;
const verticalNavigatorHideMs = 700;
const canvasAssetSaveTypeOptions: Array<{ value: CanvasAssetSaveKind; label: string }> = [
  { value: "character", label: uiCopy.asset.kind.character },
  { value: "scene", label: uiCopy.asset.kind.scene },
  { value: "prop", label: uiCopy.asset.kind.prop },
  { value: "reference_image", label: uiCopy.asset.kind.image },
];
const canvasAssetThumbnail = (asset: AssetSummary) => asset.images?.find((image) => image.isPrimary && image.contentUrl)?.contentUrl
  ?? asset.images?.find((image) => image.contentUrl)?.contentUrl
  ?? asset.contentUrl
  ?? asset.versions?.find((version) => version.contentUrl)?.contentUrl;
const balloonStyleOptions = [
  { value: "normal", label: uiCopy.workbench.balloonStyle.dialogue },
  { value: "thought", label: uiCopy.workbench.balloonStyle.noTail },
  { value: "cut_corner", label: uiCopy.workbench.balloonStyle.cutCorner },
  { value: "caption_box", label: uiCopy.workbench.balloonStyle.box },
  { value: "thought_balloon", label: uiCopy.workbench.balloonStyle.thought, disabled: true },
  { value: "burst_balloon", label: uiCopy.workbench.balloonStyle.shout, disabled: true },
  { value: "whisper_balloon", label: uiCopy.workbench.balloonStyle.whisper, disabled: true },
  { value: "broadcast_balloon", label: uiCopy.workbench.balloonStyle.electronic, disabled: true },
  { value: "wavy_balloon", label: uiCopy.workbench.balloonStyle.tremble, disabled: true },
];

function AspectRatioGlyph({ ratio }: { ratio: VerticalSegmentAspectRatio }) {
  const [width, height] = ratio.split(":").map(Number);
  const scale = Math.min(18 / width, 18 / height);
  return <span className="aspect-ratio-glyph" aria-hidden="true"><i style={{ width: width * scale, height: height * scale }} /></span>;
}

function DeviceViewportGlyph({ mode }: { mode: VerticalViewportMode }) {
  const viewport = mode === "off" ? { width: 9, height: 16 } : verticalViewportModeMeta[mode];
  return <span className={`device-viewport-glyph mode-${mode}`} aria-hidden="true"><i style={{ aspectRatio: `${viewport.width} / ${viewport.height}` }} /></span>;
}

function defaultComicPageName(page: ComicPage, index: number) {
  if (page.pageRole === "cover") return uiCopy.workbench.pageFlow.pageRole.cover;
  if (page.pageRole === "interlude") return uiCopy.workbench.pageFlow.pageRole.interlude;
  const number = String(index + 1).padStart(2, "0");
  return page.kind === "vertical_segment" ? uiCopy.workbench.label.segment(number) : page.kind === "four_panel_unit" ? uiCopy.workbench.label.fourPanel(number) : uiCopy.workbench.label.page(number);
}

function presentationUnitNumberLabel(unit: PresentationUnit, fallbackIndex: number) {
  if (unit.pageRole === "cover") return uiCopy.workbench.pageFlow.pageRole.cover;
  if (unit.pageRole === "interlude") return uiCopy.workbench.pageFlow.pageRole.interlude;
  const numbers = unit.surfaces.map((surface) => surface.pageNumber).filter((number): number is number => typeof number === "number").sort((a, b) => a - b);
  const range = numbers.length > 1 ? `${String(numbers[0]).padStart(2, "0")}–${String(numbers.at(-1)).padStart(2, "0")}` : String(numbers[0] ?? fallbackIndex + 1).padStart(2, "0");
  return unit.kind === "vertical_segment" ? uiCopy.workbench.label.segment(range) : unit.kind === "four_panel_unit" ? uiCopy.workbench.label.fourPanel(range) : uiCopy.workbench.label.page(range);
}

function closestVerticalSegmentRatio(width: number, height: number): VerticalSegmentAspectRatio {
  return verticalSegmentAspectRatios.reduce((closest, ratio) =>
    Math.abs(verticalSegmentHeight(width, ratio) - height) < Math.abs(verticalSegmentHeight(width, closest) - height) ? ratio : closest,
  verticalSegmentAspectRatios[0]);
}

function verticalSegmentRatioLabel(width: number, height: number) {
  const preset = verticalSegmentAspectRatios.find((ratio) => Math.abs(verticalSegmentHeight(width, ratio) - height) <= 1);
  if (preset) return preset;
  let left = Math.max(1, Math.round(width));
  let right = Math.max(1, Math.round(height));
  const originalLeft = left;
  const originalRight = right;
  while (right) [left, right] = [right, left % right];
  return `${originalLeft / left}:${originalRight / left}`;
}

const clampValue = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const isCanvasReference = (reference: ReferencePlacement) => reference.kind !== "style";
const debugRecord = (value: unknown): Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
const debugArray = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

function repairSelectionForState(current: Selection, nextState: PersistedWorkbench): Selection {
  if (current.type === "none" || current.type === "reference_card" || current.type === "presentation_unit" || current.type === "storyboard_beat") return current;
  const pages = createComicPageViews(nextState.fixture.working.document);
  const found = current.id && current.pageId
    ? pages.find((page) => page.id === current.pageId)?.elements.some((element) => element.id === current.id)
    : false;
  if (found) return current;
  const page = pages[nextState.currentPageIndex] ?? pages[0];
  const firstFrame = page?.elements.find((element) => element.type === "comic_frame");
  return firstFrame ? { type: "comic_frame", id: firstFrame.id, pageId: page.id, label: uiCopy.workbench.label.frame(1) } : noSelection;
}

function overlapArea(a: DOMRect | { left: number; top: number; right: number; bottom: number }, b: { left: number; top: number; right: number; bottom: number }) {
  const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return width * height;
}

function frameImageCandidateTarget(candidate: Candidate): Selection | undefined {
  for (const command of candidate.commands ?? []) {
    const value = command as unknown as Record<string, unknown>;
    if (typeof value.unitId === "string" && typeof value.frameId === "string") {
      return { type: "comic_frame", id: value.frameId, pageId: value.unitId, label: candidate.targetLabel };
    }
  }
  return undefined;
}

function frameImageCandidateAssetVersionId(candidate: Candidate) {
  if (candidate.metadata?.outputAssetVersionId) return candidate.metadata.outputAssetVersionId;
  for (const command of candidate.commands ?? []) {
    const value = command as unknown as Record<string, unknown>;
    const resource = value.resource as Record<string, unknown> | undefined;
    if (typeof resource?.assetVersionId === "string") return resource.assetVersionId;
    const element = value.element as Record<string, unknown> | undefined;
    if (typeof element?.assetVersionId === "string") return element.assetVersionId;
  }
  return undefined;
}

function projectFrameImageCandidate(fixture: PersistedWorkbench["fixture"], candidate: Candidate) {
  if (candidate.kind !== "frame_image" || !candidate.commands?.length) throw new Error(uiCopy.workbench.candidate.noFramePreview);
  if (candidate.baseRevision !== fixture.working.revision) throw new Error(uiCopy.workbench.candidate.stalePreview);
  return applyWorkspaceChangeSet(
    { working: fixture.working, storyboardBeats: fixture.storyboardBeats },
    {
      id: `preview:${candidate.id}`,
      projectId: fixture.working.projectId,
      baseRevision: fixture.working.revision,
      source: "candidate",
      sourceCandidateId: candidate.id,
      commands: candidate.commands,
    },
  );
}

function containsRect(container: { left: number; top: number; right: number; bottom: number }, item: DOMRect, tolerance = 0.5) {
  return item.left >= container.left - tolerance
    && item.top >= container.top - tolerance
    && item.right <= container.right + tolerance
    && item.bottom <= container.bottom + tolerance;
}

function isFloatingCanvasControl(target: EventTarget | null) {
  return target instanceof Element && target.closest(".image-viewer-overlay, .reference-card, .canvas-page-turn-zone, .object-toolbar, .object-inspector, .balloon-editor-popover, .asset-reference-menu-floating, [role='menu'], input, textarea, select");
}


export function WorkbenchApp({ comicId, chapterId }: { comicId: string; chapterId: string }) {
  const router = useRouter();
  const entryTransition = useContentRouteEntryTransition();
  const navigate = (href: string, direction: "forward" | "back" = "forward") => navigateWithContentTransition(direction, () => router.push(href));
  const searchParams = useSearchParams();
  const assetCreateIntent = searchParams.get("assetCreate");
  const assetCreateDraft = searchParams.get("assetDraft");
  const previewRoute = `/comics/${comicId}/chapters/${chapterId}/preview`;
  const [state, setState] = useState<PersistedWorkbench>(() => createBlankWorkbench());
  const [hydrated, setHydrated] = useState(false);
  const [dockEntering, setDockEntering] = useState(false);
  const [modeSwitching, setModeSwitching] = useState(false);
  const [runtimeAdapter, setRuntimeAdapter] = useState<"loading" | "server" | "demo">("loading");
  const [runtimeError, setRuntimeError] = useState("");
  const showInitialLoading = useDelayedLoadingIndicator(!hydrated && !runtimeError);
  const [runtimeIds, setRuntimeIds] = useState<RuntimeIds | null>(null);
  const [workbenchMeta, setWorkbenchMeta] = useState<{ comicTitle: string; chapterTitle: string }>({ comicTitle: uiCopy.workbench.defaultLabel.loading, chapterTitle: uiCopy.workbench.defaultLabel.currentChapter });
  const [selection, setSelection] = useState<Selection>(noSelection);
  const [scope, setScope] = useState<string>(uiCopy.workbench.defaultLabel.currentChapter);
  const [composer, setComposer] = useState("");
  const [explicitReferences, setExplicitReferences] = useState<ComposerReference[]>([]);
  const [composerAttachments, setComposerAttachments] = useState<ComposerAttachment[]>([]);
  const [composerReferenceOrder, setComposerReferenceOrder] = useState<string[]>([]);
  const [activeTask, setActiveTask] = useState<ActiveTask | null>(null);
  const [taskCancelConfirmOpen, setTaskCancelConfirmOpen] = useState(false);
  const [modelSettingsPromptOpen, setModelSettingsPromptOpen] = useState(false);
  const [streamingTurn, setStreamingTurn] = useState<StreamingAgentTurn | null>(null);
  const [resolvedCardIds, setResolvedCardIds] = useState<Set<string>>(() => new Set());
  const [expandedTerminalCandidateIds, setExpandedTerminalCandidateIds] = useState<Set<string>>(() => new Set());
  const [collapsedTerminalCandidateIds, setCollapsedTerminalCandidateIds] = useState<Set<string>>(() => new Set());
  const [agentScrollRequest, setAgentScrollRequest] = useState(0);
  const [leftView, setLeftView] = useState<LeftView>("assets");
  const [assetMenuId, setAssetMenuId] = useState<string | null>(null);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [assetMenuPosition, setAssetMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [assetListOrder, setAssetListOrder] = useState<string[]>([]);
  const [assetRenameId, setAssetRenameId] = useState<string | null>(null);
  const [assetRenameDraft, setAssetRenameDraft] = useState("");
  const [assetSaveFormId, setAssetSaveFormId] = useState<string | null>(null);
  const [assetSaveDraft, setAssetSaveDraft] = useState<{ name: string; kind: CanvasAssetSaveKind }>({ name: "", kind: "reference_image" });
  const [assetSaveSubmitting, setAssetSaveSubmitting] = useState(false);
  const [storyboardMenuFrameId, setStoryboardMenuFrameId] = useState<string | null>(null);
  const [storyboardMenuPosition, setStoryboardMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [pageMenuId, setPageMenuId] = useState<string | null>(null);
  const [pageMenuPosition, setPageMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [pageCreateMenuOpen, setPageCreateMenuOpen] = useState(false);
  const [pageEditor, setPageEditor] = useState<{ unitId: string; mode: PageEditorMode } | null>(null);
  const [pageStructureConfirm, setPageStructureConfirm] = useState<{ unitId: string; action: PageStructureAction } | null>(null);
  const [pageEditDraft, setPageEditDraft] = useState<{ name: string; aspectRatio: VerticalSegmentAspectRatio; aspectRatioChanged: boolean }>({ name: "", aspectRatio: "9:16", aspectRatioChanged: false });
  const [sessionDrawerOpen, setSessionDrawerOpen] = useState(false);
  const [sessionCreateOpen, setSessionCreateOpen] = useState(false);
  const [sessionTitleDraft, setSessionTitleDraft] = useState("");
  const [sessionMenuId, setSessionMenuId] = useState<string | null>(null);
  const [sessionMenuPosition, setSessionMenuPosition] = useState<{ top: number; right: number } | null>(null);
  const [sessionRenameId, setSessionRenameId] = useState<string | null>(null);
  const [sessionRenameDraft, setSessionRenameDraft] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [future, setFuture] = useState<HistoryEntry[]>([]);
  const [leftOpen, setLeftOpen] = useState(true);
  const [agentOpen, setAgentOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(() => searchParams.get("versions") === "open");
  const openAgentWorkspace = useCallback(() => {
    setVersionsOpen(false);
    setAgentOpen(true);
  }, []);
  const setAgentWorkspaceOpen = useCallback((open: boolean) => {
    if (open) setVersionsOpen(false);
    setAgentOpen(open);
  }, []);
  const setVersionWorkspaceOpen = useCallback((open: boolean) => {
    if (open) setAgentOpen(false);
    setVersionsOpen(open);
  }, []);
  const handleNewProposalDetected = useCallback(() => {
    setVersionWorkspaceOpen(true);
  }, [setVersionWorkspaceOpen]);
  const [projectMenu, setProjectMenu] = useState(false);
  const [saveChapterConfirmOpen, setSaveChapterConfirmOpen] = useState(false);
  const [savingChapter, setSavingChapter] = useState(false);
  const [versionTimelineRefreshKey, setVersionTimelineRefreshKey] = useState(0);
  const [importingArchive, setImportingArchive] = useState(false);
  const [archiveImportFile, setArchiveImportFile] = useState<File | null>(null);
  const [restoringSnapshot, setRestoringSnapshot] = useState(false);
  const [verticalSegmentMenuPosition, setVerticalSegmentMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const [pageDisplayMode, setPageDisplayMode] = useState<PageDisplayMode>("single");
  const [pageFlowPulse, setPageFlowPulse] = useState(0);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [editingStoryboardBeatId, setEditingStoryboardBeatId] = useState<string | null>(null);
  const [editingStoryboardTarget, setEditingStoryboardTarget] = useState<StoryboardEditorTarget | null>(null);
  const [objectInteractionMode, setObjectInteractionMode] = useState<CanvasObjectInteractionMode>("select");
  const [creationMode, setCreationMode] = useState<CanvasCreationMode>(null);
  const [creationPointer, setCreationPointer] = useState<{ x: number; y: number } | null>(null);
  const [comicContextMenu, setComicContextMenu] = useState<ComicContextMenuState | null>(null);
  const [downloadingCanvasImageId, setDownloadingCanvasImageId] = useState<string | null>(null);
  const [addingCanvasImageAssetId, setAddingCanvasImageAssetId] = useState<string | null>(null);

  const [imageViewer, setImageViewer] = useState<ImageViewerRequest | null>(null);
  const [frameImageTarget, setFrameImageTarget] = useState<FrameImageTarget | null>(null);
  const [frameImageCandidatePreview, setFrameImageCandidatePreview] = useState<FrameImageCandidatePreview | null>(null);
  const [autoPreviewCandidateId, setAutoPreviewCandidateId] = useState<string | null>(null);
  const [comicDeleteTarget, setComicDeleteTarget] = useState<ComicDeleteTarget | null>(null);
  const [toolbarPlacement, setToolbarPlacement] = useState<ToolbarPlacement | null>(null);
  const [balloonEditorPlacement, setBalloonEditorPlacement] = useState<{ x: number; y: number } | null>(null);
  const [canvasMode, setCanvasMode] = useState<CanvasMode>("focus");
  const [canvasOffset, setCanvasOffset] = useState({ x: 0, y: 0 });
  const [canvasScale, setCanvasScale] = useState(1);
  const [verticalViewportMode, setVerticalViewportMode] = useState<VerticalViewportMode>("off");
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [pageCanvasFitSize, setPageCanvasFitSize] = useState({ width: 0, height: 0 });
  const [isCanvasPanning, setIsCanvasPanning] = useState(false);
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);
  const [multiSelection, setMultiSelection] = useState<MultiSelectionState | null>(null);
  const [multiMoveDelta, setMultiMoveDelta] = useState({ x: 0, y: 0 });
  const [toast, setToast] = useState("");
  const [contextDebugOpen, setContextDebugOpen] = useState(false);
  const [contextDebugLoading, setContextDebugLoading] = useState(false);
  const [contextDebugText, setContextDebugText] = useState("");
  const [contextDebugSnapshot, setContextDebugSnapshot] = useState<Record<string, unknown> | null>(null);
  const [contextDebugSection, setContextDebugSection] = useState<ContextDebugSection>("raw");
  const [contextDebugError, setContextDebugError] = useState("");
  const [editDraft, setEditDraft] = useState<Record<string, string>>({});
  const [creationListOverflows, setCreationListOverflows] = useState(false);
  const chatUploadRef = useRef<HTMLInputElement>(null);
  const composerInputRef = useRef<HTMLTextAreaElement>(null);
  const creationListRef = useRef<HTMLDivElement>(null);
  const dockUploadRef = useRef<HTMLInputElement>(null);
  const frameImageUploadRef = useRef<HTMLInputElement>(null);
  const archiveImportRef = useRef<HTMLInputElement>(null);
  const agentMessagesRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const pageCanvasFitStageRef = useRef<HTMLDivElement>(null);
  const verticalStripRef = useRef<HTMLDivElement>(null);
  const verticalNavigatorRef = useRef<HTMLElement>(null);
  const verticalNavigatorFrameRef = useRef<number | null>(null);
  const verticalNavigatorHideTimerRef = useRef<number | null>(null);
  const verticalWheelIntentRef = useRef({ amount: 0, direction: 0, lastAt: 0, lockedUntil: 0 });
  const panRef = useRef<{ startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null);
  const marqueeRef = useRef<MarqueeState | null>(null);
  const multiMoveRef = useRef<MultiMoveState | null>(null);
  const suppressStageClickRef = useRef(false);
  const contextGestureRef = useRef<{ key: string; at: number } | null>(null);
  const stateRef = useRef(state);
  const activeTaskRef = useRef<ActiveTask | null>(activeTask);
  const serverCommitQueueRef = useRef<Promise<void>>(Promise.resolve());
  const workspaceSettingsCommitQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pageFlowSignatureRef = useRef<string | null>(null);
  const pageFlowPulseArmedRef = useRef(false);
  const serverCommitGenerationRef = useRef(0);
  const serverPendingCommitCountRef = useRef(0);
  const initialConversationIdRef = useRef(searchParams.get("conversationId"));
  const initialPageIdRef = useRef(searchParams.get("pageId"));

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { activeTaskRef.current = activeTask; }, [activeTask]);

  const closeFloatingMenus = (keep?: "project" | "asset" | "storyboard" | "page" | "page_create" | "session" | "vertical_segment") => {
    setComicContextMenu(null);
    setFrameImageTarget(null);
    if (keep !== "project") setProjectMenu(false);
    if (keep !== "asset") {
      setAssetMenuId(null);
      setAssetSaveFormId(null);
    }
    if (keep !== "storyboard") setStoryboardMenuFrameId(null);
    if (keep !== "page") setPageMenuId(null);
    if (keep !== "page_create") setPageCreateMenuOpen(false);
    if (keep !== "session") setSessionMenuId(null);
    if (keep !== "vertical_segment") setVerticalSegmentMenuPosition(null);
  };

  useOutsidePointerDismiss(Boolean(assetMenuId || assetSaveFormId), ".asset-row, .asset-reference-menu-floating, .asset-save-form-floating", () => {
    setAssetMenuId(null);
    setAssetSaveFormId(null);
  });
  useOutsidePointerDismiss(Boolean(storyboardMenuFrameId), ".storyboard-frame-row, .storyboard-row-menu-floating", () => setStoryboardMenuFrameId(null));
  useOutsidePointerDismiss(Boolean(pageMenuId), ".draft-page-more, .page-item-menu-floating", () => setPageMenuId(null));
  useOutsidePointerDismiss(pageCreateMenuOpen, ".drawer-page-create, .page-create-menu", () => setPageCreateMenuOpen(false));
  useOutsidePointerDismiss(Boolean(pageEditor), ".page-edit-card-floating, .delete-confirm-overlay", () => setPageEditor(null));
  useOutsidePointerDismiss(Boolean(frameImageTarget), ".frame-image-picker", () => setFrameImageTarget(null));

  useLayoutEffect(() => {
    const input = composerInputRef.current;
    if (!input) return;
    const style = window.getComputedStyle(input);
    const lineHeight = Number.parseFloat(style.lineHeight);
    const verticalPadding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
    const maxHeight = (Number.isFinite(lineHeight) ? lineHeight : 18.6) * 8 + verticalPadding;
    input.style.height = "0px";
    const nextHeight = Math.min(maxHeight, Math.max(52, input.scrollHeight));
    input.style.height = `${nextHeight}px`;
    input.style.overflowY = input.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [composer]);

  useLayoutEffect(() => {
    const list = creationListRef.current;
    if (!list) return;
    // The scroll rail extends through the card's visual bottom padding. Do not
    // treat that small reserved space as content overflow.
    const updateOverflow = () => setCreationListOverflows(list.scrollHeight - list.clientHeight > 12);
    updateOverflow();
    const resizeObserver = new ResizeObserver(updateOverflow);
    const mutationObserver = new MutationObserver(updateOverflow);
    resizeObserver.observe(list);
    mutationObserver.observe(list, { childList: true, subtree: true, characterData: true });
    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [leftView, state.assets, state.fixture.working.document]);

  useLayoutEffect(() => {
    if (!pageMenuId) return;
    const menu = document.querySelector<HTMLElement>(".page-item-menu-floating");
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    const padding = 12;
    const deltaX = rect.right > window.innerWidth - padding
      ? window.innerWidth - padding - rect.right
      : rect.left < padding ? padding - rect.left : 0;
    const deltaY = rect.bottom > window.innerHeight - padding
      ? window.innerHeight - padding - rect.bottom
      : rect.top < padding ? padding - rect.top : 0;
    if (!deltaX && !deltaY) return;
    // The rendered menu must be measured before its corrected position is known.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPageMenuPosition((current) => current ? { x: current.x + deltaX, y: current.y + deltaY } : current);
  }, [pageMenuId]);

  useEffect(() => {
    if (!comicContextMenu && !frameImageTarget && !comicDeleteTarget && !creationMode) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setComicContextMenu(null);
      setFrameImageTarget(null);
      setComicDeleteTarget(null);
      setCreationMode(null);
      setCreationPointer(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [comicContextMenu, comicDeleteTarget, creationMode, frameImageTarget]);

  useEffect(() => {
    if (!verticalSegmentMenuPosition) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setVerticalSegmentMenuPosition(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [verticalSegmentMenuPosition]);

  useEffect(() => () => {
    if (verticalNavigatorFrameRef.current !== null) window.cancelAnimationFrame(verticalNavigatorFrameRef.current);
    if (verticalNavigatorHideTimerRef.current !== null) window.clearTimeout(verticalNavigatorHideTimerRef.current);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    // Hydration completion is the trigger for this one-shot entrance transition.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDockEntering(true);
    const timer = window.setTimeout(() => setDockEntering(false), MODE_SWITCH_MOTION_MS + 40);
    return () => window.clearTimeout(timer);
  }, [hydrated]);

  useEffect(() => {
    const ids = (state.assets ?? []).map((asset) => asset.id);
    const timer = window.setTimeout(() => setAssetListOrder((current) => {
        const retained = current.filter((id) => ids.includes(id));
        const missing = ids.filter((id) => !retained.includes(id));
        return retained.length === current.length && missing.length === 0 ? current : [...retained, ...missing];
      }), 0);
    return () => window.clearTimeout(timer);
  }, [state.assets]);

  useEffect(() => {
    if (!hydrated || !assetCreateIntent) return;
    let copy: string = assetCreateIntent === "character" ? uiCopy.asset.create.intent.character : assetCreateIntent === "scene" ? uiCopy.asset.create.intent.scene : assetCreateIntent === "prop" ? uiCopy.asset.create.intent.prop : assetCreateIntent === "reference" ? uiCopy.asset.create.intent.reference : uiCopy.asset.create.intent.asset;
    if (assetCreateDraft) {
      try {
        const draft = JSON.parse(assetCreateDraft) as { kind?: string; name?: string; description?: string };
        const kind = draft.kind === "character" ? uiCopy.asset.kind.character : draft.kind === "scene" ? uiCopy.asset.kind.scene : draft.kind === "prop" ? uiCopy.asset.kind.prop : draft.kind === "reference_image" ? uiCopy.asset.kind.image : uiCopy.asset.label.asset;
      copy = uiCopy.asset.create.agentPrompt(kind, draft.name?.trim(), draft.description?.trim());
      } catch {
        // Keep the intent-only draft when a stale route parameter cannot be parsed.
      }
    }
    const timer = window.setTimeout(() => {
      setComposer(copy);
      setScope(uiCopy.workbench.scope.currentComicAssets);
      openAgentWorkspace();
      setLeftView("assets");
      setToast(uiCopy.toast.workbench.assetCreation.readyForAgent);
      const params = new URLSearchParams(window.location.search);
      params.delete("assetCreate");
      params.delete("assetDraft");
      if (runtimeIds?.conversationId) params.set("conversationId", runtimeIds.conversationId);
      const query = params.toString();
      router.replace(`/comics/${comicId}/chapters/${chapterId}${query ? `?${query}` : ""}`, { scroll: false });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [assetCreateDraft, assetCreateIntent, chapterId, comicId, hydrated, openAgentWorkspace, router, runtimeIds?.conversationId]);

  const resolvedExplicitReferences = () => [...new Map(explicitReferences.map(({ objectType, objectId, versionId, label }) => {
    const normalizedLabel = label.trim().slice(0, 120);
    return [
      `${objectType}:${objectId}:${versionId ?? ""}`,
      { objectType, objectId, versionId, ...(normalizedLabel ? { label: normalizedLabel } : {}) },
    ];
  })).values()];

  const visiblePageIdsForAgent = () => {
    const units = state.fixture.working.document.units;
    if (isVerticalCanvas) return units[state.currentPageIndex] ? [units[state.currentPageIndex].id] : [];
    const groups = pageDisplayGroups(state.fixture.working.document, pageDisplayMode);
    const group = displayGroupForUnit(groups, state.currentPageIndex);
    return group?.unitIds.slice(0, 2) ?? (units[state.currentPageIndex] ? [units[state.currentPageIndex].id] : []);
  };

  const refreshContextDebug = async () => {
    if (runtimeAdapter !== "server" || !runtimeIds) {
      setContextDebugError(uiCopy.workbench.contextDebug.offline);
      return;
    }
    setContextDebugLoading(true);
    setContextDebugError("");
    try {
      const visiblePageIds = visiblePageIdsForAgent();
      const snapshot = await apiGetContextDebugSnapshot(runtimeIds.projectId, {
        conversationId: runtimeIds.conversationId,
        message: composer,
        scope,
        currentPageId: visiblePageIds[0],
        visiblePageIds,
        selection: { type: selection.type, id: selection.id, pageId: selection.pageId ?? state.fixture.working.document.units[state.currentPageIndex]?.id, label: selection.label },
        explicitReferences: resolvedExplicitReferences(),
        currentPageIndex: state.currentPageIndex,
        workspaceMode: "comic",
        pendingAttachments: composerAttachments.map((attachment) => ({ name: attachment.name })),
      });
      setContextDebugSnapshot(snapshot);
      setContextDebugText(JSON.stringify(snapshot, null, 2));
    } catch (error) {
      setContextDebugError(error instanceof Error ? error.message : uiCopy.workbench.contextDebug.loadFailed);
    } finally {
      setContextDebugLoading(false);
    }
  };

  const openContextDebug = () => {
    setProjectMenu(false);
    setContextDebugSection("raw");
    setContextDebugOpen(true);
    void refreshContextDebug();
  };
  const syncConversationUrl = useCallback((conversationId: string) => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("conversationId") === conversationId) return;
    params.set("conversationId", conversationId);
    const query = params.toString();
    router.replace(`/comics/${comicId}/chapters/${chapterId}${query ? `?${query}` : ""}`, { scroll: false });
  }, [chapterId, comicId, router]);
  const refreshServerWorkbench = async (conversationId = runtimeIds?.conversationId, force = false) => {
    if (!force && serverPendingCommitCountRef.current) await serverCommitQueueRef.current;
    const previousActiveTask = activeTaskRef.current;
    const loaded = await apiLoadWorkbench(runtimeIds?.chapterId ?? chapterId, conversationId || undefined);
    const currentState = stateRef.current;
    const currentPageId = currentState.fixture.working.document.reading.unitOrder[currentState.currentPageIndex];
    const nextState = {
      ...loaded.state,
      currentPageIndex: resolveWorkbenchPageIndex(
        loaded.state.fixture.working.document.reading.unitOrder.map((id) => ({ id })),
        currentPageId,
        currentState.currentPageIndex,
      ),
    };
    stateRef.current = nextState;
    setState(nextState);
    setSelection((current) => repairSelectionForState(current, nextState));
    setRuntimeIds(loaded.ids);
    setWorkbenchMeta({ comicTitle: loaded.comic.title, chapterTitle: loaded.chapter.title });
    setActiveTask(loaded.activeTask);
    activeTaskRef.current = loaded.activeTask;
    if (previousActiveTask?.status === "running" && previousActiveTask.name === "frame_image_generate") {
      const completedCandidate = findAvailableFrameImageCandidateForTask(loaded.state.candidates, previousActiveTask.id);
      const target = completedCandidate ? frameImageCandidateTarget(completedCandidate) : undefined;
      const targetPageIndex = resolveReadingUnitIndex(nextState.fixture.working.document, target?.pageId);
      if (completedCandidate && targetPageIndex >= 0 && isCandidatePreviewTargetVisible(
        pageDisplayGroups(nextState.fixture.working.document, pageDisplayMode),
        nextState.currentPageIndex,
        targetPageIndex,
      )) {
        setAutoPreviewCandidateId(completedCandidate.id);
      }
    }
    syncConversationUrl(loaded.ids.conversationId);
    return loaded;
  };

  const importChapterArchive = async (file?: File) => {
    if (!file || importingArchive) return;
    setProjectMenu(false);
    if (runtimeAdapter !== "server" || !runtimeIds) {
      setToast(uiCopy.toast.workbench.archive.demoImportUnsupported);
      return;
    }
    if (activeTaskRef.current?.status === "running") {
      setToast(uiCopy.toast.workbench.archive.stopTaskBeforeImport);
      return;
    }
    setImportingArchive(true);
    try {
      if (serverPendingCommitCountRef.current) await serverCommitQueueRef.current;
      const result = await apiImportChapterArchive(chapterId, stateRef.current.fixture.working.revision, file);
      serverCommitGenerationRef.current += 1;
      setHistory([]);
      setFuture([]);
      setFrameImageCandidatePreview(null);
      setMultiSelection(null);
      await refreshServerWorkbench(runtimeIds.conversationId, true);
      setToast(uiCopy.toast.workbench.archive.imported(result.revision));
    } catch (error) {
      setToast(error instanceof Error ? error.message : uiCopy.toast.workbench.archive.importFailed);
    } finally {
      setImportingArchive(false);
    }
  };

  useEffect(() => {
    let canceled = false;
    const hydrate = async () => {
      if (configuredRuntimeAdapter() === "demo") {
        const loaded = loadDemoWorkbench();
        if (canceled) return;
        const nextState = {
          ...loaded,
          currentPageIndex: resolveWorkbenchPageIndex(
            loaded.fixture.working.document.reading.unitOrder.map((id) => ({ id })),
            initialPageIdRef.current,
            loaded.currentPageIndex,
          ),
        };
        stateRef.current = nextState;
        setState(nextState);
        setSelection((current) => repairSelectionForState(current, nextState));
        setPageDisplayMode(nextState.workspaceSettings?.pageDisplayMode ?? "single");
        setRuntimeAdapter("demo");
        setAgentScrollRequest((request) => request + 1);
        setHydrated(true);
        return;
      }
      try {
        const loaded = await apiLoadWorkbench(chapterId, initialConversationIdRef.current || undefined);
        if (canceled) return;
        const nextState = {
          ...loaded.state,
          currentPageIndex: resolveWorkbenchPageIndex(
            loaded.state.fixture.working.document.reading.unitOrder.map((id) => ({ id })),
            initialPageIdRef.current,
            loaded.state.currentPageIndex,
          ),
        };
        stateRef.current = nextState;
        setState(nextState);
        setSelection((current) => repairSelectionForState(current, nextState));
        setRuntimeIds(loaded.ids);
        setWorkbenchMeta({ comicTitle: loaded.comic.title, chapterTitle: loaded.chapter.title });
        setPageDisplayMode(nextState.workspaceSettings?.pageDisplayMode ?? "single");
        setActiveTask(loaded.activeTask);
        activeTaskRef.current = loaded.activeTask;
        syncConversationUrl(loaded.ids.conversationId);
        setRuntimeAdapter("server");
        setRuntimeError("");
        setAgentScrollRequest((request) => request + 1);
      } catch (error) {
        if (canceled) return;
        setRuntimeAdapter("server");
        setRuntimeError(error instanceof Error ? error.message : uiCopy.workbench.error.apiUnavailable);
      } finally {
        if (!canceled) setHydrated(true);
      }
    };
    void hydrate();
    return () => { canceled = true; };
  }, [chapterId, syncConversationUrl]);

  useEffect(() => {
    if (hydrated && runtimeAdapter === "demo") persistDemoWorkbench(state);
  }, [hydrated, runtimeAdapter, state]);

  const currentPageId = state.fixture.working.document.units[state.currentPageIndex]?.id;
  useEffect(() => {
    if (!hydrated || !currentPageId) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("pageId") === currentPageId) return;
    params.set("pageId", currentPageId);
    const query = params.toString();
    router.replace(`/comics/${comicId}/chapters/${chapterId}${query ? `?${query}` : ""}`, { scroll: false });
  }, [chapterId, comicId, currentPageId, hydrated, router]);

  useLayoutEffect(() => {
    if (!hydrated || !agentScrollRequest) return;
    const frame = window.requestAnimationFrame(() => {
      const messages = agentMessagesRef.current;
      if (messages) messages.scrollTop = messages.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [agentScrollRequest, hydrated]);

  useEffect(() => {
    if (runtimeAdapter !== "server") return;
    const hasPendingTask = activeTask?.status === "running";
    if (!hasPendingTask) return;
    const timer = window.setInterval(() => { if (!serverPendingCommitCountRef.current) void refreshServerWorkbench().catch(() => undefined); }, 900);
    return () => window.clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtimeAdapter, activeTask?.id, activeTask?.status]);

  useEffect(() => {
    if (activeTask?.status === "running") return;
    // A task transition invalidates the confirmation dialog immediately.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTaskCancelConfirmOpen(false);
  }, [activeTask?.status]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const workingPages = useMemo(() => createComicPageViews(state.fixture.working.document), [state.fixture.working.document]);
  const readerPageDisplayGroups = useMemo(() => pageDisplayGroups(state.fixture.working.document, "spread"), [state.fixture.working.document]);
  const pageFlowSignature = useMemo(() => readerPageDisplayGroups.map((group) => `${group.unitIds.join(":")}${group.virtualTrailingPage ? "+" : ""}`).join("|"), [readerPageDisplayGroups]);
  useEffect(() => {
    const previous = pageFlowSignatureRef.current;
    if (previous !== null && previous !== pageFlowSignature) {
      if (pageDisplayMode === "spread" && pageFlowPulseArmedRef.current) setPageFlowPulse((value) => value + 1);
      pageFlowPulseArmedRef.current = false;
    }
    pageFlowSignatureRef.current = pageFlowSignature;
  }, [pageDisplayMode, pageFlowSignature]);
  const storyboardFrameRows = useMemo<StoryboardFrameRow[]>(() => {
    const beatById = new Map(state.fixture.storyboardBeats.map((beat) => [beat.id, beat]));
    return workingPages.flatMap((comicPage, pageIndex) => comicPage.elements
      .filter((element): element is ComicFrameElement => element.type === "comic_frame")
      .sort((left, right) => left.readingOrder - right.readingOrder)
      .map((frame) => ({
        frame,
        page: comicPage,
        pageIndex,
        beat: frame.linkedStoryboardBeatId === "unassigned" ? undefined : beatById.get(frame.linkedStoryboardBeatId),
      })))
      .map((row, index) => ({ ...row, label: uiCopy.workbench.label.frame(index + 1) }));
  }, [state.fixture.storyboardBeats, workingPages]);
  const page = workingPages[state.currentPageIndex] ?? workingPages[0];
  const previewCandidate = frameImageCandidatePreview
    ? state.candidates.find((candidate) => candidate.id === frameImageCandidatePreview.candidateId)
    : undefined;
  const previewProjection = useMemo(() => {
    if (frameImageCandidatePreview?.mode !== "candidate" || !previewCandidate) return undefined;
    try {
      return projectFrameImageCandidate(state.fixture, previewCandidate);
    } catch {
      return undefined;
    }
  }, [frameImageCandidatePreview?.mode, previewCandidate, state.fixture]);
  const canvasDocument = previewProjection?.working.document ?? state.fixture.working.document;
  const canvasUnits = canvasDocument.reading.unitOrder.flatMap((unitId) => {
    const unit = canvasDocument.units.find((item) => item.id === unitId);
    return unit ? [unit] : [];
  });
  const isVerticalWorkbench = state.fixture.working.document.format === "vertical";
  const isVerticalCanvas = canvasDocument.format === "vertical";
  const verticalCanvasLayoutKey = canvasUnits.map((unit) => `${unit.id}:${unit.canvas.width}x${unit.canvas.height}`).join("|");
  const previewAssetVersionId = previewCandidate ? frameImageCandidateAssetVersionId(previewCandidate) : undefined;
  const previewUrl = previewCandidate?.metadata?.previewUrl ?? previewCandidate?.metadata?.imageSrc;
  const canvasResolvedResources = previewProjection && previewAssetVersionId && previewUrl
    ? { ...state.fixture.working.resolvedResources, [previewAssetVersionId]: { url: previewUrl } }
    : state.fixture.working.resolvedResources;

  useEffect(() => {
    if (!frameImageCandidatePreview) return;
    if (previewCandidate?.status === "available" && previewCandidate.baseRevision === state.fixture.working.revision) return;
    // Candidate invalidation restores the complete pre-preview interaction snapshot.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelection(frameImageCandidatePreview.previousSelection);
    setCanvasMode(frameImageCandidatePreview.previousCanvasMode);
    setObjectInteractionMode(frameImageCandidatePreview.previousInteractionMode);
    setInspectorOpen(frameImageCandidatePreview.previousInspectorOpen);
    setState((current) => ({ ...current, currentPageIndex: frameImageCandidatePreview.previousPageIndex }));
    setFrameImageCandidatePreview(null);
  }, [frameImageCandidatePreview, previewCandidate, state.fixture.working.revision]);

  useEffect(() => {
    if (isVerticalWorkbench) return;
    // The vertical-only viewport state is invalid when the document format changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVerticalViewportMode("off");
    setVerticalSegmentMenuPosition(null);
  }, [isVerticalWorkbench]);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!isVerticalCanvas || !stage) return;
    const update = () => setStageSize({ width: stage.clientWidth, height: stage.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [hydrated, isVerticalCanvas]);

  useLayoutEffect(() => {
    const fitStage = pageCanvasFitStageRef.current;
    if (isVerticalCanvas || !fitStage) return;
    const update = () => setPageCanvasFitSize({ width: fitStage.clientWidth, height: fitStage.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(fitStage);
    return () => observer.disconnect();
  }, [hydrated, isVerticalCanvas]);

  useLayoutEffect(() => {
    const strip = verticalStripRef.current;
    if (!isVerticalCanvas || canvasMode !== "focus" || !strip) {
      verticalWheelIntentRef.current = { amount: 0, direction: 0, lastAt: 0, lockedUntil: 0 };
      return;
    }
    const target = strip.querySelector<HTMLElement>(`[data-page-index="${state.currentPageIndex}"]`);
    if (!target) return;
    const top = clampValue(target.offsetTop - (strip.clientHeight - target.offsetHeight) / 2, 0, Math.max(0, strip.scrollHeight - strip.clientHeight));
    strip.scrollTo({ top, behavior: "smooth" });
  }, [canvasMode, isVerticalCanvas, stageSize.height, stageSize.width, state.currentPageIndex, verticalCanvasLayoutKey, verticalViewportMode]);

  const activeConversation = state.conversations?.find((conversation) => conversation.id === runtimeIds?.conversationId);
  const sessionMenuConversation = state.conversations?.find((conversation) => conversation.id === sessionMenuId);
  const composerReferenceItems = useMemo(() => {
    const items = [
      ...explicitReferences.map((reference) => ({ key: `reference:${reference.id}`, type: "reference" as const, value: reference })),
      ...composerAttachments.map((attachment) => ({ key: `attachment:${attachment.id}`, type: "attachment" as const, value: attachment })),
    ];
    const byKey = new Map(items.map((item) => [item.key, item]));
    const ordered = composerReferenceOrder.map((key) => byKey.get(key)).filter((item): item is typeof items[number] => Boolean(item));
    return [...ordered, ...items.filter((item) => !composerReferenceOrder.includes(item.key))];
  }, [composerAttachments, composerReferenceOrder, explicitReferences]);
  const selectedElement = useMemo<CanvasElement | undefined>(() => {
    if (!selection.id || !selection.pageId) return undefined;
    return workingPages
      .find((item) => item.id === selection.pageId)
      ?.elements.find((element) => element.id === selection.id);
  }, [selection.id, selection.pageId, workingPages]);
  const selectedBalloonTailTarget = selectedElement?.type === "speech_balloon"
    ? selectedElement.content.tailTarget
    : undefined;
  const rawSelectedStoryboardBeatId = selection.type === "storyboard_beat" ? selection.id : selectedElement?.linkedStoryboardBeatId;
  const selectedStoryboardBeatId = rawSelectedStoryboardBeatId === "unassigned" ? undefined : rawSelectedStoryboardBeatId;
  const selectedStoryboardBeat = state.fixture.storyboardBeats.find((storyboardBeat) => storyboardBeat.id === selectedStoryboardBeatId);
  const selectedBalloonNumber = useMemo(() => {
    if (selection.type !== "speech_balloon" || !selection.id) return 0;
    return workingPages.flatMap((comicPage) => comicPage.elements.filter((element): element is SpeechBalloonElement => element.type === "speech_balloon")).findIndex((balloon) => balloon.id === selection.id) + 1;
  }, [selection.id, selection.type, workingPages]);
  const selectedNarrationNumber = useMemo(() => {
    if (selection.type !== "text" || !selection.id || !selection.pageId) return 0;
    const page = workingPages.find((item) => item.id === selection.pageId);
    return (page?.elements.filter((element): element is TextCanvasElement => element.type === "text" && element.content.role === "narration").findIndex((text) => text.id === selection.id) ?? -1) + 1;
  }, [selection.id, selection.pageId, selection.type, workingPages]);
  const assetSrcByKey = useMemo(
    () => new Map(state.fixture.working.document.resources.map((resource) => [`${resource.assetId}:${resource.assetVersionId}`, state.fixture.working.resolvedResources?.[resource.assetVersionId]?.url]).filter((entry): entry is [string, string] => Boolean(entry[1]))),
    [state.fixture.working.document.resources, state.fixture.working.resolvedResources],
  );
  const contextDebugSections = useMemo(() => {
    const snapshot = contextDebugSnapshot;
    if (!snapshot) return [] as Array<{ id: ContextDebugSection; label: string; detail: string; value: unknown }>;
    const modelInput = debugRecord(snapshot.modelInput);
    const contextIndex = debugRecord(snapshot.contextIndex);
    const indexAssets = debugRecord(contextIndex.assets);
    const indexWorld = debugRecord(contextIndex.world);
    const indexStoryboard = debugRecord(contextIndex.storyboard);
    const indexLayout = debugRecord(contextIndex.layout);
    const indexActivity = debugRecord(contextIndex.activity);
    const assets = debugArray(modelInput.assets);
    const storyboardBeats = debugArray(modelInput.storyboardBeats);
    const pages = debugArray(debugRecord(snapshot.resolvedWorkspace).pages);
    return [
      { id: "raw" as const, label: uiCopy.workbench.contextDebug.section.rawJson, detail: uiCopy.workbench.contextDebug.snapshotLabel, value: snapshot },
      { id: "input" as const, label: uiCopy.workbench.contextDebug.section.inputAndFocus, detail: uiCopy.workbench.contextDebug.currentInstruction(String(debugRecord(modelInput.task).type ?? "")), value: { clientInput: snapshot.clientInput, modelTask: modelInput.task, focus: contextIndex.focus } },
      { id: "world" as const, label: uiCopy.workbench.contextDebug.section.worldBackground, detail: indexWorld.summary ? uiCopy.workbench.contextDebug.longTermSetting : uiCopy.workbench.contextDebug.emptySetting, value: Object.keys(indexWorld).length ? indexWorld : { summary: debugRecord(modelInput.comic).worldSummary ?? "" } },
      { id: "assets" as const, label: uiCopy.workbench.contextDebug.section.castAndScenes, detail: uiCopy.workbench.contextDebug.assetCount(assets.length), value: Object.keys(indexAssets).length ? indexAssets : { assets } },
      { id: "storyboard" as const, label: uiCopy.workbench.frameEditor.storyboardTitle, detail: uiCopy.workbench.contextDebug.storyboardCount(storyboardBeats.length), value: Object.keys(indexStoryboard).length ? indexStoryboard : { storyboardBeats, omittedContext: modelInput.omittedContext } },
      { id: "page" as const, label: uiCopy.workbench.scope.currentPage, detail: uiCopy.workbench.contextDebug.pageCount(pages.length), value: Object.keys(indexLayout).length ? indexLayout : { pages } },
      { id: "activity" as const, label: uiCopy.workbench.contextDebug.section.tasksAndSessions, detail: uiCopy.workbench.contextDebug.recentActivity, value: Object.keys(indexActivity).length ? indexActivity : { tasks: debugRecord(snapshot.resolvedWorkspace).taskHistory, conversation: snapshot.conversation } },
    ];
  }, [contextDebugSnapshot]);
  const pageThumbSrc = (comicPage: ComicPage) => {
    const firstImage = comicPage.elements.find((element): element is ImageElement => element.type === "image");
    return firstImage ? assetSrcByKey.get(`${firstImage.assetId}:${firstImage.assetVersionId}`) : undefined;
  };

  const selectedFrameImage = selectedElement?.type === "image" && selectedElement.location.space === "frame"
    ? selectedElement
    : undefined;
  // Frame images use the frame's toolbar geometry and transform controls. Their
  // own selection is retained so crop mode can still address the image itself.
  const toolbarTarget = frameImageCandidatePreview?.target ?? (selectedFrameImage?.comicFrameId && selection.pageId
    ? { type: "comic_frame" as const, id: selectedFrameImage.comicFrameId, pageId: selection.pageId, label: selection.label }
    : selection);

  useLayoutEffect(() => {
    const isCanvasSelection = toolbarTarget.type !== "none" && toolbarTarget.type !== "presentation_unit" && toolbarTarget.type !== "reference_card";
    if (canvasMode !== "focus" || !isCanvasSelection || !toolbarTarget.id || !stageRef.current) {
      setToolbarPlacement(null);
      return;
    }

    const updateToolbar = () => {
      const stage = stageRef.current;
      const element = stage?.querySelector<HTMLElement>(`[data-element-id="${toolbarTarget.id}"]`);
      if (!stage || !element) {
        setToolbarPlacement(null);
        return;
      }

      const stageRect = stage.getBoundingClientRect();
      const elementRect = element.getBoundingClientRect();
      const selectedRect = {
        left: elementRect.left - stageRect.left,
        top: elementRect.top - stageRect.top,
        right: elementRect.right - stageRect.left,
        bottom: elementRect.bottom - stageRect.top,
      };
      if (frameImageCandidatePreview) {
        const previewToolbar = { width: 218, height: 44 };
        setToolbarPlacement({
          x: clampValue(
            selectedRect.left + (elementRect.width - previewToolbar.width) / 2,
            8,
            Math.max(8, stageRect.width - previewToolbar.width - 8),
          ),
          y: clampValue(
            selectedRect.bottom + 10,
            8,
            Math.max(8, stageRect.height - previewToolbar.height - 12),
          ),
          side: "bottom",
        });
        return;
      }
      const editorHandleRects = toolbarTarget.type === "speech_balloon"
        ? [...element.querySelectorAll<HTMLElement>(".balloon-resize-handle, .balloon-tail-handle")].map((handle) => {
          const rect = handle.getBoundingClientRect();
          return { left: rect.left - stageRect.left, top: rect.top - stageRect.top, right: rect.right - stageRect.left, bottom: rect.bottom - stageRect.top };
        })
        : [];
      const obstacleNodes = [...document.querySelectorAll<HTMLElement>(
        ".agent-workspace.open, .version-workspace.open, .reference-card, .canvas-session-drawer, .object-inspector, .balloon-editor-popover, .frame-image-picker",
      )].filter((node) => node !== element && !node.contains(element));
      const obstacleRects = obstacleNodes.flatMap((node) => {
        const rect = node.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0 || rect.right <= stageRect.left || rect.left >= stageRect.right || rect.bottom <= stageRect.top || rect.top >= stageRect.bottom) return [];
        return [{
          left: rect.left - stageRect.left,
          top: rect.top - stageRect.top,
          right: rect.right - stageRect.left,
          bottom: rect.bottom - stageRect.top,
        }];
      });
      const gap = 10;
      const horizontal = { width: 190, height: 44 };
      const vertical = { width: 44, height: 190 };
      const candidates = [
        {
          side: "top" as const,
          width: horizontal.width,
          height: horizontal.height,
          x: selectedRect.left + (elementRect.width - horizontal.width) / 2,
          y: selectedRect.top - horizontal.height - gap,
          free: selectedRect.top,
        },
        {
          side: "bottom" as const,
          width: horizontal.width,
          height: horizontal.height,
          x: selectedRect.left + (elementRect.width - horizontal.width) / 2,
          y: selectedRect.bottom + gap,
          free: stageRect.height - selectedRect.bottom,
        },
        {
          side: "left" as const,
          width: vertical.width,
          height: vertical.height,
          x: selectedRect.left - vertical.width - gap,
          y: selectedRect.top + (elementRect.height - vertical.height) / 2,
          free: selectedRect.left,
        },
        {
          side: "right" as const,
          width: vertical.width,
          height: vertical.height,
          x: selectedRect.right + gap,
          y: selectedRect.top + (elementRect.height - vertical.height) / 2,
          free: stageRect.width - selectedRect.right,
        },
      ];

      const scored = candidates.map((candidate) => {
        const x = clampValue(candidate.x, 8, Math.max(8, stageRect.width - candidate.width - 8));
        const y = clampValue(candidate.y, 8, Math.max(8, stageRect.height - candidate.height - 72));
        const rect = { left: x, top: y, right: x + candidate.width, bottom: y + candidate.height };
        const rawOutside =
          Math.max(0, -candidate.x) +
          Math.max(0, -candidate.y) +
          Math.max(0, candidate.x + candidate.width - stageRect.width) +
          Math.max(0, candidate.y + candidate.height - stageRect.height + 64);
        return {
          ...candidate,
          x,
          y,
          score: rawOutside * 28
            + overlapArea(rect, selectedRect) * 2.5
            + editorHandleRects.reduce((total, handleRect) => total + overlapArea(rect, handleRect) * 18, 0)
            + obstacleRects.reduce((total, obstacleRect) => total + overlapArea(rect, obstacleRect) * 36, 0)
            - candidate.free * 0.18,
        };
      });

      const best = scored.sort((a, b) => a.score - b.score)[0];
      setToolbarPlacement({ x: best.x, y: best.y, side: best.side });
    };

    updateToolbar();
    window.addEventListener("resize", updateToolbar);
    const observer = new ResizeObserver(updateToolbar);
    observer.observe(stageRef.current);
    const element = stageRef.current.querySelector<HTMLElement>(`[data-element-id="${toolbarTarget.id}"]`);
    if (element) observer.observe(element);
    document.querySelectorAll<HTMLElement>(".agent-workspace.open, .version-workspace.open, .reference-card, .canvas-session-drawer, .object-inspector, .balloon-editor-popover, .frame-image-picker").forEach((node) => observer.observe(node));
    return () => {
      window.removeEventListener("resize", updateToolbar);
      observer.disconnect();
    };
  }, [agentOpen, canvasMode, canvasOffset.x, canvasOffset.y, frameImageCandidatePreview, inspectorOpen, leftOpen, objectInteractionMode, selectedBalloonTailTarget, selectedElement?.geometry, toolbarTarget.id, toolbarTarget.pageId, toolbarTarget.type, versionsOpen]);

  useLayoutEffect(() => {
    if (canvasMode !== "focus" || !inspectorOpen || (selection.type !== "speech_balloon" && selection.type !== "text") || !selection.id || !stageRef.current) {
      setBalloonEditorPlacement(null);
      return;
    }
    const updatePlacement = () => {
      const stage = stageRef.current;
      const element = stage?.querySelector<HTMLElement>(`[data-element-id="${selection.id}"]`);
      if (!stage || !element) return setBalloonEditorPlacement(null);
      const stageRect = stage.getBoundingClientRect();
      const elementRect = element.getBoundingClientRect();
      const width = 226;
      const height = selection.type === "text" ? 214 : 330;
      const gap = 12;
      const candidates = [
        { x: elementRect.right - stageRect.left + gap, y: elementRect.top - stageRect.top },
        { x: elementRect.left - stageRect.left - width - gap, y: elementRect.top - stageRect.top },
        { x: elementRect.left - stageRect.left, y: elementRect.bottom - stageRect.top + gap },
        { x: elementRect.left - stageRect.left, y: elementRect.top - stageRect.top - height - gap },
      ];
      const candidate = candidates.find((item) => item.x >= 8 && item.y >= 8 && item.x + width <= stageRect.width - 8 && item.y + height <= stageRect.height - 76) ?? candidates[0];
      setBalloonEditorPlacement({ x: clampValue(candidate.x, 8, Math.max(8, stageRect.width - width - 8)), y: clampValue(candidate.y, 8, Math.max(8, stageRect.height - height - 76)) });
    };
    updatePlacement();
    window.addEventListener("resize", updatePlacement);
    return () => window.removeEventListener("resize", updatePlacement);
  }, [canvasMode, inspectorOpen, selectedElement?.geometry, selection.id, selection.type]);

  const replaceMessages = (updater: (messages: AgentMessage[]) => AgentMessage[]) =>
    setState((current) => ({ ...current, messages: updater(current.messages) }));

  const addMessage = (message: Omit<AgentMessage, "id">) => {
    replaceMessages((messages) => [...messages, { ...message, id: uid("message") }]);
    setAgentScrollRequest((request) => request + 1);
  };

  const switchConversation = async (conversationId: string) => {
    if (activeTask?.status === "running") {
      setToast(uiCopy.toast.workbench.session.stopTaskBeforeSwitch);
      return;
    }
    try {
      await refreshServerWorkbench(conversationId);
      setAgentScrollRequest((request) => request + 1);
      setSessionDrawerOpen(false);
      setResolvedCardIds(new Set());
      setToast(uiCopy.toast.workbench.session.switched);
    } catch (error) {
      setToast(error instanceof Error ? error.message : uiCopy.toast.workbench.session.switchFailed);
    }
  };

  const createConversation = async () => {
    const title = sessionTitleDraft.trim();
    if (!title) {
      setToast(uiCopy.toast.workbench.session.createNameRequired);
      return;
    }
    if (runtimeAdapter !== "server" || !runtimeIds) {
      const now = new Date().toISOString();
      setState((current) => ({ ...current, messages: [], candidates: [], conversations: [{ id: uid("conversation"), title, createdAt: now, updatedAt: now }, ...(current.conversations ?? [])] }));
      setAgentScrollRequest((request) => request + 1);
      setSessionDrawerOpen(false);
      setSessionCreateOpen(false);
      setSessionTitleDraft("");
      setToast(uiCopy.toast.workbench.session.offlineCreated);
      return;
    }
    try {
      const created = await apiCreateConversation(runtimeIds.projectId, title);
      await refreshServerWorkbench(created.id);
      setAgentScrollRequest((request) => request + 1);
      setSessionDrawerOpen(false);
      setSessionCreateOpen(false);
      setSessionTitleDraft("");
      setResolvedCardIds(new Set());
      setToast(uiCopy.toast.workbench.session.created);
    } catch (error) {
      setToast(error instanceof Error ? error.message : uiCopy.toast.workbench.session.createFailed);
    }
  };

  const renameConversation = async (conversationId: string) => {
    const title = sessionRenameDraft.trim();
    if (!title) {
      setToast(uiCopy.toast.workbench.session.renameNameRequired);
      return;
    }
    try {
      if (runtimeAdapter === "server") {
        await apiUpdateConversation(conversationId, { title });
        await refreshServerWorkbench();
      } else {
        setState((current) => ({ ...current, conversations: current.conversations?.map((conversation) => conversation.id === conversationId ? { ...conversation, title, updatedAt: new Date().toISOString() } : conversation) }));
      }
      setSessionRenameId(null);
      setSessionMenuId(null);
      setSessionRenameDraft("");
      setToast(uiCopy.toast.workbench.session.renamed);
    } catch (error) {
      setToast(error instanceof Error ? error.message : uiCopy.toast.common.renameFailed);
    }
  };

  const deleteConversation = async (conversationId: string) => {
    if (activeTask?.status === "running") {
      setToast(uiCopy.toast.workbench.session.stopTaskBeforeDelete);
      return;
    }
    try {
      if (runtimeAdapter === "server" && runtimeIds) {
        const isCurrent = conversationId === runtimeIds.conversationId;
        const next = state.conversations?.find((conversation) => conversation.id !== conversationId);
        const replacement = isCurrent && !next ? await apiCreateConversation(runtimeIds.projectId, uiCopy.workbench.chat.newConversationTitle) : undefined;
        await apiUpdateConversation(conversationId, { archived: true });
        await refreshServerWorkbench(isCurrent ? (next?.id ?? replacement?.id) : undefined);
        if (isCurrent) setAgentScrollRequest((request) => request + 1);
      } else {
        setState((current) => ({ ...current, conversations: current.conversations?.filter((conversation) => conversation.id !== conversationId) }));
      }
      setSessionRenameId(null);
      setSessionMenuId(null);
      setToast(uiCopy.toast.workbench.session.deleted);
    } catch (error) {
      setToast(error instanceof Error ? error.message : uiCopy.toast.workbench.session.deleteFailed);
    }
  };

  const stopActiveTask = async () => {
    if (!activeTask || activeTask.status !== "running") return;
    if (runtimeAdapter === "server" && !activeTask.id.includes("pending")) {
      try {
        await apiCancelTask(activeTask.id);
        await refreshServerWorkbench();
      } catch (error) {
        setToast(error instanceof Error ? error.message : uiCopy.toast.common.cancelFailed);
      }
      return;
    }
    setActiveTask({ ...activeTask, status: "canceled" });
    addMessage({ role: "agent", kind: "canceled", text: uiCopy.workbench.task.cancelledMessage });
  };

  const pushHistory = (fixture: PersistedWorkbench["fixture"], label: string, kind: HistoryEntry["kind"]) => {
    setHistory((entries) => [...entries.slice(-39), { fixture: structuredClone(fixture), label, kind }]);
    setFuture([]);
  };

  const commitOperations = (operations: WorkspaceOperation[], label: string, source: WorkspaceChangeSet["source"], candidateId?: string, nextPageIndex?: number, onApplied?: () => void, options?: { recordHistory?: boolean; resolvedResources?: PersistedWorkbench["fixture"]["working"]["resolvedResources"] }) => {
    if (restoringSnapshot) {
      setToast(uiCopy.toast.workbench.draft.restoring);
      return false;
    }
    const currentState = stateRef.current;
    const currentFixture = currentState.fixture;
    let result: ReturnType<typeof applyWorkspaceChangeSet>;
    try {
      result = applyWorkspaceChangeSet(
        { working: currentFixture.working, storyboardBeats: currentFixture.storyboardBeats },
        {
          id: uid("changeset"),
          projectId: currentFixture.working.projectId,
          baseRevision: currentFixture.working.revision,
          source,
          sourceCandidateId: candidateId,
          commands: operations,
        },
      );
    } catch (error) {
      setToast(error instanceof Error && error.message.includes("REVISION_CONFLICT") ? uiCopy.toast.workbench.draft.revisionConflict : error instanceof Error ? error.message : uiCopy.toast.workbench.draft.changeNotApplied);
      return false;
    }
    const changeSet = {
      id: uid("changeset"),
      projectId: currentFixture.working.projectId,
      baseRevision: currentFixture.working.revision,
      source,
      sourceCandidateId: candidateId,
      commands: operations,
    } satisfies WorkspaceChangeSet;
    if (options?.recordHistory !== false) pushHistory(currentFixture, label, "working");
    const nextState: PersistedWorkbench = {
      ...currentState,
      fixture: {
        ...currentFixture,
        ...result,
        working: {
          ...result.working,
          resolvedResources: { ...currentFixture.working.resolvedResources, ...options?.resolvedResources },
        },
      },
      ...(typeof nextPageIndex === "number" ? { currentPageIndex: nextPageIndex } : {}),
    };
    stateRef.current = nextState;
    setState(nextState);
    onApplied?.();

    if (runtimeAdapter === "server" && runtimeIds) {
      setToast(uiCopy.toast.workbench.draft.persisting(label));
      const generation = serverCommitGenerationRef.current;
      serverPendingCommitCountRef.current += 1;
      const persist = serverCommitQueueRef.current.then(async () => {
        if (generation !== serverCommitGenerationRef.current) return;
        const persisted = await apiCommitChangeSet(runtimeIds.projectId, changeSet);
        if (generation !== serverCommitGenerationRef.current) return;
        serverPendingCommitCountRef.current = Math.max(0, serverPendingCommitCountRef.current - 1);
        setState((current) => {
          if (current.fixture.working.revision !== persisted.working.revision) return current;
          const next = { ...current, fixture: { ...current.fixture, ...persisted } };
          stateRef.current = next;
          return next;
        });
        if (!serverPendingCommitCountRef.current) setToast(uiCopy.toast.workbench.draft.persisted(label, persisted.working.revision));
      }).catch(async (error) => {
        if (generation !== serverCommitGenerationRef.current) return;
        serverCommitGenerationRef.current += 1;
        serverPendingCommitCountRef.current = 0;
        setHistory([]);
        setFuture([]);
        setToast(error instanceof Error ? uiCopy.toast.workbench.draft.reloadedAfterError(error.message) : uiCopy.toast.workbench.draft.persistenceFailed);
        await refreshServerWorkbench(undefined, true).catch(() => undefined);
      });
      serverCommitQueueRef.current = persist.then(() => undefined);
      return true;
    }
    setToast(uiCopy.toast.workbench.draft.persisted(label, result.working.revision));
    return true;
  };

  const planCapabilities = (requests: EditorCapabilityRequest[]) =>
    planEditorCapabilities(requests, {
      fixture: { working: stateRef.current.fixture.working, storyboardBeats: stateRef.current.fixture.storyboardBeats },
      createId: uid,
      actor: "human",
    });

  const commitCapabilities = (requests: EditorCapabilityRequest[], label: string, nextPageIndex?: number) => {
    if (!requests.length) return false;
    try {
      const plan = planCapabilities(requests);
      return commitOperations(plan.commands, label, "manual", undefined, nextPageIndex);
    } catch (error) {
      const message = error instanceof Error ? error.message : uiCopy.toast.workbench.draft.invalidCapabilityInput;
      setToast(message);
      return false;
    }
  };

  const commitCapability = (id: EditorCapabilityId, input: unknown, label: string, nextPageIndex?: number) =>
    commitCapabilities([{ id, input }], label, nextPageIndex);

  const commitPageFlowStructureChanges = (requests: EditorCapabilityRequest[], label: string, nextPageIndex?: number) => {
    pageFlowPulseArmedRef.current = pageDisplayMode === "spread";
    const committed = commitCapabilities(requests, label, nextPageIndex);
    if (!committed) pageFlowPulseArmedRef.current = false;
    return committed;
  };

  const commitPageFlowStructureChange = (id: EditorCapabilityId, input: unknown, label: string, nextPageIndex?: number) =>
    commitPageFlowStructureChanges([{ id, input }], label, nextPageIndex);

  const elementForSelection = (target: Selection) => target.pageId && target.id
    ? workingPages.find((comicPage) => comicPage.id === target.pageId)?.elements.find((element) => element.id === target.id)
    : undefined;

  const frameAndImageForSelection = (target: Selection) => {
    const comicPage = workingPages.find((candidate) => candidate.id === target.pageId);
    const element = comicPage?.elements.find((candidate) => candidate.id === target.id);
    const frame = element?.type === "comic_frame"
      ? element
      : element?.comicFrameId
        ? comicPage?.elements.find((candidate): candidate is ComicFrameElement => candidate.type === "comic_frame" && candidate.id === element.comicFrameId)
        : undefined;
    const image = element?.type === "image"
      ? element
      : frame
        ? comicPage?.elements.find((candidate): candidate is ImageElement => candidate.type === "image" && candidate.comicFrameId === frame.id && candidate.location.space === "frame")
        : undefined;
    return { comicPage, frame, image };
  };

  const selectCreatedObject = (next: Selection, editImmediately = false) => {
    setSelection(next);
    setObjectInteractionMode("select");
    setEditingStoryboardBeatId(null);
    setEditingStoryboardTarget(null);
    setEditDraft(editImmediately && next.type === "speech_balloon" ? { dialogue: "" } : {});
    setInspectorOpen(editImmediately);
    setScope(next.type === "speech_balloon" ? uiCopy.workbench.scope.balloon : next.type === "text" ? uiCopy.workbench.scope.narration : next.type === "image" ? uiCopy.workbench.scope.frameImageCrop : uiCopy.workbench.scope.comicFrame);
  };

  const createFrameAt = (unitId: string, position: { x: number; y: number }) => {
    try {
      const plan = planCapabilities([{ id: "create_frame", input: { unitId, position } }]);
      const command = plan.commands.find((operation) => operation.type === "add_frame");
      if (!command || command.type !== "add_frame") return;
      setComicContextMenu(null);
      commitOperations(plan.commands, uiCopy.workbench.action.addFrame, "manual", undefined, undefined, () => selectCreatedObject({ type: "comic_frame", id: command.frame.id, pageId: unitId, label: uiCopy.workbench.defaultLabel.newFrame }));
    } catch (error) {
      setToast(error instanceof Error ? error.message : uiCopy.toast.workbench.editing.addFrameFailed);
    }
  };

  const duplicateFrame = (target: Selection) => {
    if (!target.pageId || !target.id) return;
    try {
      const plan = planCapabilities([{ id: "duplicate_frame", input: { unitId: target.pageId, frameId: target.id } }]);
      const command = plan.commands.find((operation) => operation.type === "add_frame");
      if (!command || command.type !== "add_frame") return;
      setComicContextMenu(null);
      commitOperations(plan.commands, uiCopy.workbench.action.duplicateFrame, "manual", undefined, undefined, () => selectCreatedObject({ type: "comic_frame", id: command.frame.id, pageId: target.pageId, label: command.frame.name ?? uiCopy.workbench.defaultLabel.frameCopy }));
    } catch (error) {
      setToast(error instanceof Error ? error.message : uiCopy.toast.workbench.editing.duplicateFrameFailed);
    }
  };

  const deleteFrame = (target: Selection) => {
    if (!target.pageId || !target.id) return;
    if (commitCapability("delete_frame", { unitId: target.pageId, frameId: target.id }, uiCopy.workbench.action.deleteFrame)) {
      setComicDeleteTarget(null);
      setComicContextMenu(null);
      setSelection(noSelection);
      setInspectorOpen(false);
    }
  };

  const removeFrameImage = (target: Selection) => {
    const { frame, image } = frameAndImageForSelection(target);
    if (!target.pageId || !image) return;
    const label = image.location.space === "frame" ? uiCopy.workbench.operation.removeFrameImage : image.location.purpose === "cross_page" ? uiCopy.workbench.operation.removeCrossPageImage : image.location.purpose === "cross_segment" ? uiCopy.workbench.operation.removeCrossSegmentImage : uiCopy.workbench.operation.removePaperImage;
    if (commitCapability("remove_frame_image", { unitId: target.pageId, frameId: image.location.space === "frame" ? image.location.frameId : undefined, layerId: image.layerId, elementId: image.id }, label)) {
      setComicDeleteTarget(null);
      setComicContextMenu(null);
      if (frame) selectCreatedObject({ type: "comic_frame", id: frame.id, pageId: target.pageId, label: uiCopy.workbench.scope.currentFrame });
      else selectCreatedObject({ type: "presentation_unit", id: target.pageId, pageId: target.pageId, label: uiCopy.workbench.scope.currentPage });
    }
  };

  const openFrameImagePicker = (target: Selection, anchor?: { left: number; top: number }, placement?: FrameImageTarget["placement"]) => {
    const fallback = comicContextMenu?.point;
    const targetElement = elementForSelection(target);
    if (targetElement?.type === "image" && targetElement.location.space === "overlay" && !placement) {
      setComicContextMenu(null);
      setToast(uiCopy.toast.workbench.editing.replaceImageFirst);
      return;
    }
    setComicContextMenu(null);
    setFrameImageTarget({ selection: target, left: anchor?.left ?? fallback?.clientX ?? window.innerWidth / 2, top: anchor?.top ?? fallback?.clientY ?? window.innerHeight / 2, position: fallback ? { x: fallback.canvasX, y: fallback.canvasY } : undefined, placement });
  };

  const placeFrameImage = (choice: FrameImageChoice, target = frameImageTarget?.selection) => {
    if (!target?.pageId) return false;
    const { frame, image } = frameAndImageForSelection(target);
    try {
      const resource = { assetId: choice.assetId, assetVersionId: choice.assetVersionId, mediaType: choice.mediaType, width: choice.width, height: choice.height };
      const request: EditorCapabilityRequest = choice.source.kind === "page" && frame
        ? { id: "return_element_to_frame", input: { unitId: choice.source.unitId, layerId: choice.source.layerId, elementId: choice.source.elementId, frameId: frame.id, replaceExistingImage: Boolean(image) } }
        : frameImageTarget?.placement === "cross_page"
        ? { id: "create_cross_page_image", input: { unitId: target.pageId, ...resource } }
        : frameImageTarget?.placement === "cross_segment"
          ? { id: "create_cross_segment_image", input: { unitId: target.pageId, ...resource } }
          : image
        ? { id: "replace_frame_image", input: { unitId: target.pageId, frameId: image.location.space === "frame" ? image.location.frameId : undefined, layerId: image.layerId, elementId: image.id, ...resource } }
        : frame
          ? { id: "place_frame_image", input: { unitId: target.pageId, frameId: frame.id, ...resource } }
          : { id: "create_page_image", input: { unitId: target.pageId, position: frameImageTarget?.position ?? { x: 360, y: 540 }, ...resource } };
      const plan = planCapabilities([request]);
      const added = plan.commands.find((operation) => (operation.type === "add_layer_element" || operation.type === "add_overlay_element") && operation.element.kind === "image");
      const elementId = added && (added.type === "add_layer_element" || added.type === "add_overlay_element") ? added.element.id : image?.id;
      setFrameImageTarget(null);
      const label = frameImageTarget?.placement === "cross_page" ? uiCopy.workbench.imagePicker.placeCrossPage : frameImageTarget?.placement === "cross_segment" ? uiCopy.workbench.imagePicker.placeCrossSegment : image ? uiCopy.asset.action.changeImage : frame ? uiCopy.workbench.action.placeFrameImage : uiCopy.workbench.imagePicker.placePaper;
      return commitOperations(plan.commands, label, "manual", undefined, undefined, () => {
        if (choice.url && runtimeAdapter !== "server") {
          setState((current) => ({ ...current, fixture: { ...current.fixture, working: { ...current.fixture.working, resolvedResources: { ...current.fixture.working.resolvedResources, [choice.assetVersionId]: { url: choice.url! } } } } }));
        }
        if (elementId) selectCreatedObject({ type: "image", id: elementId, pageId: target.pageId, label: frameImageTarget?.placement === "cross_page" ? uiCopy.workbench.object.crossPageImage : frameImageTarget?.placement === "cross_segment" ? uiCopy.workbench.object.crossSegmentImage : frame ? uiCopy.workbench.defaultLabel.framePrimaryImage : uiCopy.workbench.defaultLabel.paperImage });
      });
    } catch (error) {
      setToast(error instanceof Error ? error.message : uiCopy.toast.workbench.editing.placeImageFailed);
      return false;
    }
  };

  const convertImageToCrossSurface = (target: Selection, purpose: "cross_page" | "cross_segment") => {
    const element = elementForSelection(target);
    if (!target.pageId || !element || element.type !== "image") return;
    const frameId = element.location.space === "frame" ? element.location.frameId : undefined;
    const capability = purpose === "cross_page" ? "convert_image_to_cross_page" : "convert_image_to_cross_segment";
    if (commitCapability(capability, { unitId: target.pageId, frameId, layerId: element.location.layerId, elementId: element.id }, purpose === "cross_page" ? uiCopy.workbench.action.placeCrossPageImage : uiCopy.workbench.action.placeCrossSegmentImage)) {
      setComicContextMenu(null);
    }
  };

  const convertBalloonToCrossPage = (target: Selection) => {
    const element = elementForSelection(target);
    if (!target.pageId || element?.type !== "speech_balloon") return;
    const frameId = element.location.space === "frame" ? element.location.frameId : undefined;
    if (commitCapability("convert_balloon_to_cross_page", { unitId: target.pageId, frameId, layerId: element.layerId, elementId: element.id }, uiCopy.workbench.action.placeCrossPageBalloon)) {
      setComicContextMenu(null);
      setObjectInteractionMode("move");
    }
  };

  const createDialogueBalloon = (unitId: string, frameId: string, position: { x: number; y: number }) => {
    try {
      const plan = planCapabilities([{ id: "create_dialogue_balloon", input: { unitId, frameId, position } }]);
      const command = plan.commands.find((operation) => operation.type === "add_layer_element" && operation.element.kind === "balloon");
      if (!command || command.type !== "add_layer_element") return;
      setCreationMode(null);
      setCreationPointer(null);
      setComicContextMenu(null);
      commitOperations(plan.commands, uiCopy.workbench.action.addDialogue, "manual", undefined, undefined, () => selectCreatedObject({ type: "speech_balloon", id: command.element.id, pageId: unitId, label: uiCopy.workbench.defaultLabel.newDialogue }, true));
    } catch (error) {
      setToast(error instanceof Error ? error.message : uiCopy.toast.workbench.editing.addDialogueFailed);
    }
  };

  const createPageDialogueBalloon = (unitId: string, position: { x: number; y: number }) => {
    try {
      const plan = planCapabilities([{ id: "create_page_dialogue_balloon", input: { unitId, position } }]);
      const command = plan.commands.find((operation) => operation.type === "add_overlay_element" && operation.element.kind === "balloon");
      if (!command || command.type !== "add_overlay_element") return;
      setCreationMode(null);
      setCreationPointer(null);
      setComicContextMenu(null);
      commitOperations(plan.commands, uiCopy.workbench.action.addPaperDialogue, "manual", undefined, undefined, () => selectCreatedObject({ type: "speech_balloon", id: command.element.id, pageId: unitId, label: uiCopy.workbench.defaultLabel.paperDialogue }, true));
    } catch (error) {
      setToast(error instanceof Error ? error.message : uiCopy.toast.workbench.editing.addPaperDialogueFailed);
    }
  };

  const createNarration = (unitId: string, position: { x: number; y: number }) => {
    try {
      const plan = planCapabilities([{ id: "create_narration", input: { unitId, position } }]);
      const command = plan.commands.find((operation) => operation.type === "add_overlay_element" && operation.element.kind === "text");
      if (!command || command.type !== "add_overlay_element") return;
      setCreationMode(null);
      setCreationPointer(null);
      setComicContextMenu(null);
      const order = (workingPages.find((page) => page.id === unitId)?.elements.filter((element) => element.type === "text" && element.content.role === "narration").length ?? 0) + 1;
      commitOperations(plan.commands, uiCopy.workbench.operation.addNarration, "manual", undefined, undefined, () => selectCreatedObject({ type: "text", id: command.element.id, pageId: unitId, label: uiCopy.workbench.label.narration(order) }, true));
    } catch (error) {
      setToast(error instanceof Error ? error.message : uiCopy.toast.workbench.editing.addNarrationFailed);
    }
  };

  const createDialogueFromContext = (target: Selection, point?: ComicContextPoint) => {
    const { frame } = frameAndImageForSelection(target);
    if (!target.pageId || !frame) return;
    const position = point
      ? { x: clampValue((point.canvasX - frame.geometry.x) / frame.geometry.width, 0, 1), y: clampValue((point.canvasY - frame.geometry.y) / frame.geometry.height, 0, 1) }
      : { x: .28, y: .22 };
    createDialogueBalloon(target.pageId, frame.id, position);
  };

  const duplicateDialogueBalloon = (target: Selection) => {
    const element = elementForSelection(target);
    if (!target.pageId || element?.type !== "speech_balloon") return;
    try {
      const plan = planCapabilities([{ id: "duplicate_dialogue_balloon", input: { unitId: target.pageId, frameId: element.location.space === "frame" ? element.location.frameId : undefined, layerId: element.layerId, elementId: element.id } }]);
      const command = plan.commands.find((operation) => (operation.type === "add_layer_element" || operation.type === "add_overlay_element") && operation.element.kind === "balloon");
      if (!command || (command.type !== "add_layer_element" && command.type !== "add_overlay_element")) return;
      setComicContextMenu(null);
      commitOperations(plan.commands, uiCopy.workbench.action.duplicateDialogue, "manual", undefined, undefined, () => selectCreatedObject({ type: "speech_balloon", id: command.element.id, pageId: target.pageId, label: uiCopy.workbench.defaultLabel.dialogueCopy }));
    } catch (error) {
      setToast(error instanceof Error ? error.message : uiCopy.toast.workbench.editing.duplicateDialogueFailed);
    }
  };

  const deleteDialogueBalloon = (target: Selection) => {
    const element = elementForSelection(target);
    if (!target.pageId || element?.type !== "speech_balloon") return;
    if (commitCapability("delete_dialogue_balloon", { unitId: target.pageId, frameId: element.location.space === "frame" ? element.location.frameId : undefined, layerId: element.layerId, elementId: element.id }, uiCopy.workbench.action.deleteDialogue)) {
      setComicDeleteTarget(null);
      setComicContextMenu(null);
      setSelection(element.comicFrameId ? { type: "comic_frame", id: element.comicFrameId, pageId: target.pageId, label: uiCopy.workbench.scope.currentFrame } : { type: "presentation_unit", id: target.pageId, pageId: target.pageId, label: uiCopy.workbench.scope.currentPage });
      setInspectorOpen(false);
    }
  };

  const duplicateNarration = (target: Selection) => {
    const element = elementForSelection(target);
    if (!target.pageId || element?.type !== "text" || element.location.space !== "overlay") return;
    try {
      const plan = planCapabilities([{ id: "duplicate_narration", input: { unitId: target.pageId, layerId: element.layerId, elementId: element.id } }]);
      const command = plan.commands.find((operation) => operation.type === "add_overlay_element" && operation.element.kind === "text");
      if (!command || command.type !== "add_overlay_element") return;
      setComicContextMenu(null);
      const order = (workingPages.find((page) => page.id === target.pageId)?.elements.filter((item) => item.type === "text" && item.content.role === "narration").length ?? 0) + 1;
      commitOperations(plan.commands, uiCopy.workbench.action.duplicateNarration, "manual", undefined, undefined, () => selectCreatedObject({ type: "text", id: command.element.id, pageId: target.pageId, label: uiCopy.workbench.label.narration(order) }));
    } catch (error) {
      setToast(error instanceof Error ? error.message : uiCopy.toast.workbench.editing.duplicateNarrationFailed);
    }
  };

  const deleteNarration = (target: Selection) => {
    const element = elementForSelection(target);
    if (!target.pageId || element?.type !== "text" || element.location.space !== "overlay") return;
    if (commitCapability("delete_narration", { unitId: target.pageId, layerId: element.layerId, elementId: element.id }, uiCopy.workbench.action.deleteNarration)) {
      setComicDeleteTarget(null);
      setComicContextMenu(null);
      setSelection({ type: "presentation_unit", id: target.pageId, pageId: target.pageId, label: uiCopy.workbench.scope.currentPage });
      setInspectorOpen(false);
    }
  };

  const promoteSelectionToOverlay = (target: Selection) => {
    const element = elementForSelection(target);
    if (!target.pageId || !element || element.type === "comic_frame" || element.location.space !== "frame") return;
    if (commitCapability("promote_element_to_overlay", { unitId: target.pageId, frameId: element.location.frameId, layerId: element.location.layerId, elementId: element.id }, uiCopy.workbench.action.enableBreakout)) {
      setComicContextMenu(null);
      setObjectInteractionMode("move");
      setToast(uiCopy.toast.workbench.layout.breakoutEnabled);
    }
  };

  const convertSelectionToPage = (target: Selection) => {
    const element = elementForSelection(target);
    if (!target.pageId || !element || element.type === "comic_frame") return;
    const crossPurpose = element.location.space === "overlay" && (element.location.purpose === "cross_page" || element.location.purpose === "cross_segment") ? element.location.purpose : undefined;
    if (element.location.space === "overlay" && element.location.anchor.type === "unit" && !crossPurpose) return;
    const frameId = element.location.space === "frame" ? element.location.frameId : undefined;
    const label = crossPurpose === "cross_page" ? uiCopy.workbench.action.cancelCrossPage : crossPurpose === "cross_segment" ? uiCopy.workbench.action.cancelCrossSegment : element.type === "image" ? uiCopy.workbench.action.convertToPaperImage : uiCopy.workbench.action.convertToPaperDialogue;
    if (commitCapability("convert_element_to_page", { unitId: target.pageId, frameId, layerId: element.location.layerId, elementId: element.id }, label)) {
      setComicContextMenu(null);
      setObjectInteractionMode("move");
      setToast(crossPurpose === "cross_page" ? uiCopy.toast.workbench.layout.crossPageCanceled(element.type === "image" ? uiCopy.asset.kind.image : uiCopy.workbench.object.dialogue) : crossPurpose === "cross_segment" ? uiCopy.toast.workbench.layout.crossSegmentCanceled : element.type === "image" ? uiCopy.toast.workbench.layout.convertedToPaperImage : uiCopy.toast.workbench.layout.convertedToPaperDialogue);
    }
  };

  const returnSelectionToFrame = (target: Selection) => {
    const element = elementForSelection(target);
    if (!target.pageId || !element || element.type === "comic_frame" || element.location.space !== "overlay" || element.location.anchor.type !== "frame") return;
    if (commitCapability("return_element_to_frame", { unitId: target.pageId, frameId: element.location.anchor.frameId, layerId: element.location.layerId, elementId: element.id }, uiCopy.workbench.action.returnToFrame)) {
      setComicContextMenu(null);
      setObjectInteractionMode("select");
      setToast(uiCopy.toast.workbench.layout.returnedToFrame);
    }
  };

  const changeOverlayElementLayer = (target: Selection, position: "front" | "back") => {
    const element = elementForSelection(target);
    if (!target.pageId || !element || element.type === "comic_frame" || element.location.space !== "overlay") return;
    if (commitCapability("reorder_overlay_element", { unitId: target.pageId, layerId: element.location.layerId, elementId: element.id, position }, position === "front" ? uiCopy.workbench.operation.moveObjectToFront : uiCopy.workbench.operation.moveObjectToBack)) setComicContextMenu(null);
  };

  const toggleFrameOverlap = (target: Selection) => {
    if (!target.pageId || !target.id) return;
    const unit = state.fixture.working.document.units.find((item) => item.id === target.pageId);
    const frame = unit?.frames.find((item) => item.id === target.id);
    if (!unit || !frame) return;
    const next = unit.layoutPolicy.frameOverlap === "allow" ? "forbid" : "allow";
    const requests: EditorCapabilityRequest[] = [{ id: "set_frame_overlap_policy", input: { unitId: unit.id, frameOverlap: next } }];
    if (next === "allow") {
      requests.push({ id: "reorder_frame", input: { unitId: unit.id, frameId: frame.id, zIndex: Math.max(0, ...unit.frames.map((item) => item.zIndex), ...unit.overlayLayers.map((item) => item.zIndex)) + 1 } });
    }
    if (commitCapabilities(requests, next === "allow" ? uiCopy.workbench.operation.allowFrameOverlap : uiCopy.workbench.operation.forbidFrameOverlap)) {
      setComicContextMenu(null);
      setToast(next === "allow" ? uiCopy.toast.workbench.layout.overlapEnabled : uiCopy.toast.workbench.layout.overlapDisabled);
    }
  };

  const toggleFrameCrossPage = (target: Selection) => {
    if (!target.pageId || !target.id) return;
    const unit = state.fixture.working.document.units.find((item) => item.id === target.pageId);
    const frame = unit?.frames.find((item) => item.id === target.id);
    if (!unit || !frame) return;
    const enabled = frame.surfaceScope !== "unit";
    if (commitCapability("set_frame_cross_page", { unitId: unit.id, frameId: frame.id, enabled }, enabled ? uiCopy.workbench.action.enableCrossPageFrame : uiCopy.workbench.operation.cancelFrameCrossPage)) {
      setComicContextMenu(null);
      setObjectInteractionMode(enabled ? "move" : "select");
      setToast(enabled ? uiCopy.toast.workbench.layout.crossPageFrameEnabled : uiCopy.toast.workbench.layout.crossPageFrameDisabled);
    }
  };

  const toggleFrameBleedEdge = (target: Selection, edge: "top" | "right" | "bottom" | "left") => {
    if (!target.pageId || !target.id) return;
    const frame = state.fixture.working.document.units.find((item) => item.id === target.pageId)?.frames.find((item) => item.id === target.id);
    if (!frame) return;
    const enabled = !frame.bleedEdges?.[edge];
    const edgeLabel = { top: uiCopy.workbench.direction.top, right: uiCopy.workbench.direction.right, bottom: uiCopy.workbench.direction.bottom, left: uiCopy.workbench.direction.left }[edge];
    if (commitCapability("update_frame_bleed", { unitId: target.pageId, frameId: target.id, edge, enabled }, uiCopy.workbench.operation.toggleFrameBleed(enabled, edgeLabel))) {
      setComicContextMenu(null);
      setToast(enabled ? uiCopy.toast.workbench.layout.bleedEnabled(edgeLabel) : uiCopy.toast.workbench.layout.bleedDisabled(edgeLabel));
    }
  };

  const contextSubmenuPosition = (button: HTMLButtonElement, width: number, height: number) => {
    const item = button.getBoundingClientRect();
    const gap = 6;
    const left = item.right + gap + width <= window.innerWidth - 12
      ? item.right + gap
      : Math.max(12, item.left - width - gap);
    const top = clampValue(item.top, 12, Math.max(12, window.innerHeight - height - 12));
    return { left, top };
  };

  const openFrameBleedMenu = (button: HTMLButtonElement) => {
    setComicContextMenu((current) => current ? { ...current, bleedMenu: contextSubmenuPosition(button, 160, 134) } : current);
  };

  const openPageBackgroundMenu = (button: HTMLButtonElement) => {
    setComicContextMenu((current) => current ? { ...current, backgroundMenu: contextSubmenuPosition(button, 150, 82) } : current);
  };

  const setPageBackground = (target: Selection, color: "#ffffff" | "#000000") => {
    if (!target.pageId) return;
    const label = color === "#ffffff" ? uiCopy.workbench.action.white : uiCopy.workbench.action.black;
    if (commitCapability("set_presentation_unit_background", { unitId: target.pageId, color }, uiCopy.workbench.operation.setPageBackground(label))) setComicContextMenu(null);
  };

  const openImageMoreMenu = (button: HTMLButtonElement) => {
    setComicContextMenu((current) => current ? { ...current, imageMoreMenu: contextSubmenuPosition(button, 184, 116) } : current);
  };

  const downloadCanvasImage = async (target: Selection) => {
    const element = elementForSelection(target);
    if (element?.type !== "image" || downloadingCanvasImageId) return;
    const contentUrl = state.fixture.working.resolvedResources?.[element.assetVersionId]?.url;
    if (!contentUrl) {
      setToast(uiCopy.toast.workbench.image.downloadUnavailable);
      return;
    }
    setDownloadingCanvasImageId(element.id);
    try {
      await apiDownloadImage(contentUrl, element.name?.trim() || target.label || uiCopy.workbench.defaultLabel.comicImage);
      setComicContextMenu(null);
      setToast(uiCopy.toast.workbench.image.downloadStarted);
    } catch (error) {
      setToast(error instanceof Error ? error.message : uiCopy.toast.workbench.image.downloadFailed);
    } finally {
      setDownloadingCanvasImageId(null);
    }
  };

  const openCanvasImageViewer = (target: Selection) => {
    const element = elementForSelection(target);
    if (element?.type !== "image") return;
    const contentUrl = state.fixture.working.resolvedResources?.[element.assetVersionId]?.url;
    if (!contentUrl) {
      setToast(uiCopy.toast.workbench.image.viewUnavailable);
      return;
    }
    setComicContextMenu(null);
    setImageViewer({
      images: [{ id: element.id, src: contentUrl, alt: element.name?.trim() || target.label || uiCopy.workbench.defaultLabel.comicImage }],
    });
  };

  const addCanvasImageToAssetList = async (target: Selection) => {
    const element = elementForSelection(target);
    if (element?.type !== "image" || addingCanvasImageAssetId) return;
    if (state.assets?.some((asset) => asset.id === element.assetId)) {
      setToast(uiCopy.toast.workbench.image.alreadyInAssetList);
      return;
    }
    setAddingCanvasImageAssetId(element.assetId);
    try {
      if (runtimeAdapter === "server" && runtimeIds) {
        await apiImportAssetToCanvasList(runtimeIds.projectId, element.assetId);
        await refreshServerWorkbench();
      } else {
        const resource = state.fixture.working.document.resources.find((item) => item.assetId === element.assetId && item.assetVersionId === element.assetVersionId);
        const contentUrl = state.fixture.working.resolvedResources?.[element.assetVersionId]?.url;
        const name = element.name?.trim() || target.label || uiCopy.workbench.defaultLabel.comicImage;
        setState((current) => current.assets?.some((asset) => asset.id === element.assetId) ? current : {
          ...current,
          assets: [...(current.assets ?? []), {
            id: element.assetId,
            kind: "reference_image",
            name,
            description: uiCopy.workbench.defaultDescription.restoredCanvasAsset,
            versionId: element.assetVersionId,
            contentUrl,
            versions: [{ id: element.assetVersionId, version: 1, contentUrl, width: resource?.width, height: resource?.height }],
            libraryStatus: "canvas_only",
          }],
        });
      }
      setComicContextMenu(null);
      setToast(uiCopy.toast.workbench.image.addedToAssetList);
    } catch (error) {
      setToast(error instanceof Error ? error.message : uiCopy.toast.workbench.image.addToAssetListFailed);
    } finally {
      setAddingCanvasImageAssetId(null);
    }
  };

  const changeFrameLayer = (target: Selection, direction: "forward" | "backward") => {
    if (!target.pageId || !target.id) return;
    const unit = state.fixture.working.document.units.find((item) => item.id === target.pageId);
    const frame = unit?.frames.find((item) => item.id === target.id);
    if (!unit || !frame) return;
    const levels = [...unit.frames.map((item) => item.zIndex), ...unit.overlayLayers.map((item) => item.zIndex)];
    const zIndex = direction === "forward" ? Math.max(0, ...levels) + 1 : Math.min(0, ...levels) - 1;
    if (commitCapability("reorder_frame", { unitId: unit.id, frameId: frame.id, zIndex }, direction === "forward" ? uiCopy.workbench.operation.moveFrameToFront : uiCopy.workbench.operation.moveFrameToBack)) setComicContextMenu(null);
  };

  const handleComicContextAction = (target: Selection, point: ComicContextPoint) => {
    const key = `${target.pageId ?? ""}:${target.type}:${target.id ?? ""}`;
    const now = Date.now();
    const previous = contextGestureRef.current;
    const isDoubleContext = previous?.key === key && now - previous.at <= 420;
    contextGestureRef.current = isDoubleContext ? null : { key, at: now };
    if (isDoubleContext) {
      const { frame, image } = frameAndImageForSelection(target);
      const cropImage = image;
      if ((frame || cropImage) && target.pageId) {
        closeFloatingMenus();
        setCreationMode(null);
        setCreationPointer(null);
        setInspectorOpen(false);
        if (objectInteractionMode === "crop") {
          setObjectInteractionMode("select");
          setSelection(cropImage
            ? { type: "image", id: cropImage.id, pageId: target.pageId, label: cropImage.location.space === "frame" ? uiCopy.workbench.defaultLabel.framePrimaryImage : uiCopy.workbench.object.image }
            : { type: "comic_frame", id: frame!.id, pageId: target.pageId, label: uiCopy.workbench.label.frame(frame!.readingOrder) });
          setToast(uiCopy.toast.workbench.mode.cropExited);
        } else {
          setSelection(cropImage
            ? { type: "image", id: cropImage.id, pageId: target.pageId, label: uiCopy.workbench.defaultLabel.framePrimaryImage }
            : { type: "comic_frame", id: frame!.id, pageId: target.pageId, label: uiCopy.workbench.label.frame(frame!.readingOrder) });
          setObjectInteractionMode("crop");
          setToast(cropImage ? uiCopy.toast.workbench.mode.cropEntered : uiCopy.toast.workbench.mode.cornerEditEntered);
        }
        return;
      }
    }
    closeFloatingMenus();
    setCreationMode(null);
    setCreationPointer(null);
    setInspectorOpen(false);
    setComicContextMenu({ target, point });
  };

  const handleComicObjectDoubleClick = (target: Selection) => {
    const element = elementForSelection(target);
    if (!target.pageId || !element) return;
    if (element.type === "image") {
      handleCanvasSelection(target);
      openCanvasImageViewer(target);
      return;
    }
    const nextTarget: Selection | undefined = element.type === "comic_frame"
      ? target
      : element.type === "speech_balloon"
        ? target
        : element.type === "text"
          ? target
          : undefined;
    if (!nextTarget) return;
    closeFloatingMenus();
    setInspectorOpen(false);
    setCreationMode(null);
    setCreationPointer(null);
    setSelection(nextTarget);
    const shouldExit = objectInteractionMode === "move" && selection.id === nextTarget.id && selection.pageId === nextTarget.pageId;
    setObjectInteractionMode(shouldExit ? "select" : "move");
    setToast(shouldExit ? uiCopy.toast.workbench.mode.moveExited : uiCopy.toast.workbench.mode.moveEntered);
  };

  const openSelectionManagement = (button: HTMLButtonElement) => {
    if (!selection.id || !selection.pageId) return;
    const rect = button.getBoundingClientRect();
    const { frame } = frameAndImageForSelection(selection);
    setComicContextMenu({ target: selection, point: { clientX: rect.right + 6, clientY: rect.top, canvasX: frame ? frame.geometry.x + frame.geometry.width / 2 : 0, canvasY: frame ? frame.geometry.y + frame.geometry.height / 2 : 0 } });
  };

  const capabilitiesForElementPatch = (unitId: string, elementId: string, patch: Record<string, unknown>): EditorCapabilityRequest[] => {
    const pageView = workingPages.find((item) => item.id === unitId);
    const element = pageView?.elements.find((item) => item.id === elementId);
    if (!pageView || !element) return [];
    if (element.type === "comic_frame") {
      const geometry = patch.geometry as ComicFrameElement["geometry"] | undefined;
      const shape = patch.shape as ComicFrameElement["shape"] | undefined;
      if (shape) return [{ id: "reshape_frame", input: { unitId, frameId: element.id, geometry: geometry ?? element.geometry, shape } }];
      if (geometry) return geometry.width === element.geometry.width && geometry.height === element.geometry.height
        ? [{ id: "move_frame", input: { unitId, frameId: element.id, position: { x: geometry.x, y: geometry.y } } }]
        : [{ id: "resize_frame", input: { unitId, frameId: element.id, geometry } }];
    }
    if (element.type === "image") {
      if (patch.crop) return [{ id: "set_art_crop", input: { unitId, frameId: element.location.space === "frame" ? element.location.frameId : undefined, layerId: element.layerId, elementId, crop: patch.crop as NonNullable<ImageElement["crop"]> } }];
      if (patch.transform) return [{ id: "set_element_transform", input: { unitId, frameId: element.location.space === "frame" ? element.location.frameId : undefined, layerId: element.layerId, elementId, transform: patch.transform } }];
      if (patch.geometry) {
        const anchorFrameId = element.location.space === "frame" ? element.location.frameId : element.location.anchor.type === "frame" ? element.location.anchor.frameId : undefined;
        const frame = anchorFrameId ? pageView.elements.find((item): item is ComicFrameElement => item.type === "comic_frame" && item.id === anchorFrameId) : undefined;
        const transform = frame ? deriveLocalTransform(frame.geometry, patch.geometry as ImageElement["geometry"]) : patch.geometry;
        return [{ id: "set_element_transform", input: { unitId, frameId: element.location.space === "frame" ? element.location.frameId : undefined, layerId: element.layerId, elementId, transform } }];
      }
      if (typeof patch.zIndex === "number" && element.location.space === "frame") return [{ id: "reorder_layer", input: { unitId, frameId: element.location.frameId, layerId: element.layerId, zIndex: patch.zIndex } }];
    }
    if (element.type === "speech_balloon") {
      const anchorFrameId = element.location.space === "frame" ? element.location.frameId : element.location.anchor.type === "frame" ? element.location.anchor.frameId : undefined;
      const frame = anchorFrameId ? pageView.elements.find((item): item is ComicFrameElement => item.type === "comic_frame" && item.id === anchorFrameId) : undefined;
      const changes: Record<string, unknown> = {};
      if (patch.transform) changes.transform = patch.transform;
      if (patch.tailTarget) changes.tailTarget = patch.tailTarget;
      if (patch.geometry && frame) changes.transform = deriveLocalTransform(frame.geometry, patch.geometry as SpeechBalloonElement["geometry"]);
      const content = patch.content as SpeechBalloonElement["content"] | undefined;
      const style = patch.style as SpeechBalloonElement["style"] | undefined;
      if (content?.shape && content.shape !== element.content.shape) changes.shape = content.shape;
      if (content?.cutCorners && JSON.stringify(content.cutCorners) !== JSON.stringify(element.content.cutCorners)) changes.cutCorners = content.cutCorners;
      if (content?.tailTarget && frame) changes.tailTarget = { x: (content.tailTarget.x - frame.geometry.x) / frame.geometry.width, y: (content.tailTarget.y - frame.geometry.y) / frame.geometry.height };
      if (style && (style.fontSize !== element.style.fontSize || style.strokeWidth !== element.style.strokeWidth || style.writingMode !== element.style.writingMode)) changes.style = style;
      const requests: EditorCapabilityRequest[] = Object.keys(changes).length ? [{ id: "update_balloon", input: { unitId, frameId: element.location.space === "frame" ? element.location.frameId : undefined, layerId: element.layerId, elementId, changes } }] : [];
      if (content && content.text !== element.content.text) requests.push({ id: "update_dialogue", input: { dialogueId: element.dialogueId, content: content.text } });
      if (typeof patch.zIndex === "number" && element.location.space === "frame") requests.push({ id: "reorder_layer", input: { unitId, frameId: element.location.frameId, layerId: element.layerId, zIndex: patch.zIndex } });
      return requests;
    }
    if (element.type === "text") {
      if (patch.transform) return [{ id: "set_element_transform", input: { unitId, layerId: element.layerId, elementId, transform: patch.transform } }];
      if (patch.geometry) return [{ id: "set_element_transform", input: { unitId, layerId: element.layerId, elementId, transform: patch.geometry } }];
      const content = patch.content as TextCanvasElement["content"] | undefined;
      const style = patch.style as TextCanvasElement["style"] | undefined;
      const changes = {
        ...(content && content.text !== element.content.text ? { content: content.text } : {}),
        ...(style?.fontSize !== undefined && style.fontSize !== element.style.fontSize ? { fontSize: style.fontSize } : {}),
        ...(style?.writingMode && style.writingMode !== element.style.writingMode ? { writingMode: style.writingMode } : {}),
      };
      return Object.keys(changes).length ? [{ id: "update_narration", input: { unitId, layerId: element.layerId, elementId, changes } }] : [];
    }
    return [];
  };

  const commitElementPatches = (unitId: string, patches: Array<{ elementId: string; patch: Record<string, unknown> }>, label: string) =>
    commitCapabilities(patches.flatMap(({ elementId, patch }) => capabilitiesForElementPatch(unitId, elementId, patch)), label);

  const commitPlacement = (nextReferences: ReferencePlacement[], label: string) => {
    const current = stateRef.current;
    pushHistory(current.fixture, label, "placement");
    const next = { ...current, fixture: { ...current.fixture, references: nextReferences } };
    stateRef.current = next;
    setState(next);
    setToast(label);
  };

  const undo = () => {
    const entry = history[history.length - 1];
    if (!entry) return;
    const current = stateRef.current;
    if (entry.kind === "working") {
      const plan = planCapabilities([{ id: "restore_workspace_version", input: { document: entry.fixture.working.document, storyboardBeats: entry.fixture.storyboardBeats } }]);
      if (!commitOperations(plan.commands, uiCopy.workbench.operation.undo(entry.label), "undo", undefined, undefined, undefined, { recordHistory: false, resolvedResources: entry.fixture.working.resolvedResources })) return;
    } else {
      const next = { ...current, fixture: { ...current.fixture, references: structuredClone(entry.fixture.references) } };
      stateRef.current = next;
      setState(next);
    }
    setFuture((entries) => [...entries, { fixture: structuredClone(current.fixture), label: entry.label, kind: entry.kind }]);
    setHistory((entries) => entries.slice(0, -1));
    setToast(uiCopy.toast.workbench.history.undone(entry.label));
  };

  const redo = () => {
    const entry = future[future.length - 1];
    if (!entry) return;
    const current = stateRef.current;
    if (entry.kind === "working") {
      const plan = planCapabilities([{ id: "restore_workspace_version", input: { document: entry.fixture.working.document, storyboardBeats: entry.fixture.storyboardBeats } }]);
      if (!commitOperations(plan.commands, uiCopy.workbench.operation.redo(entry.label), "redo", undefined, undefined, undefined, { recordHistory: false, resolvedResources: entry.fixture.working.resolvedResources })) return;
    } else {
      const next = { ...current, fixture: { ...current.fixture, references: structuredClone(entry.fixture.references) } };
      stateRef.current = next;
      setState(next);
    }
    setHistory((entries) => [...entries, { fixture: structuredClone(current.fixture), label: entry.label, kind: entry.kind }]);
    setFuture((entries) => entries.slice(0, -1));
    setToast(uiCopy.toast.workbench.history.redone(entry.label));
  };

  const runTask = (name = "storyboard", option?: string, explicitInstruction?: string, explicitScope?: string, explicitSelection?: Selection) => {
    if (name !== "storyboard" && name !== "frame_image_generate" && name !== "asset_image_generate") {
      setToast(uiCopy.toast.workbench.agent.taskUnavailable);
      return;
    }
    const label = name === "asset_image_generate" ? uiCopy.workbench.taskLabel.generateAssetImage : name === "frame_image_generate" ? uiCopy.workbench.action.generateFrameImage : uiCopy.workbench.action.editStoryboard;
    const taskScope = explicitScope ?? scope;
    const instruction = explicitInstruction ?? option ?? [...state.messages].reverse().find((message) => message.role === "user")?.text ?? label;
    const currentSelection = explicitSelection ?? selection;
    const currentState = state;
    const currentTargetElement = currentSelection.id && currentSelection.pageId
      ? createComicPageViews(currentState.fixture.working.document).find((item) => item.id === currentSelection.pageId)?.elements.find((item) => item.id === currentSelection.id)
      : undefined;
    if (activeTask?.status === "running") {
      setToast(uiCopy.toast.workbench.agent.taskAlreadyRunning);
      return;
    }
    if (name === "storyboard" && currentTargetElement?.type !== "comic_frame") {
      setToast(uiCopy.toast.workbench.agent.selectCurrentFrame);
      return;
    }
    if (runtimeAdapter !== "server" || !runtimeIds) {
      setToast(uiCopy.toast.workbench.agent.demoOffline);
      return;
    }
    const task: ActiveTask = { id: uid("task-pending"), name, label, scope: taskScope, progress: 3, status: "running", selection: currentSelection };
    setActiveTask(task);
    void apiCreateTask(runtimeIds, {
      taskType: name,
      instruction,
      scope: taskScope,
      selection: { type: currentSelection.type, id: currentSelection.id, pageId: currentSelection.pageId, label: currentSelection.label },
    }).then(() => refreshServerWorkbench()).catch((error) => {
      setActiveTask(null);
      if (error instanceof LanternApiError && error.code === "provider_not_configured") setModelSettingsPromptOpen(true);
      setToast(error instanceof Error ? error.message : uiCopy.toast.workbench.agent.taskCreateFailed);
    });
  };

  const sendMessage = () => {
    if (activeTask?.status === "running") {
      return;
    }
    const message = composer.trim();
    const attachments = composerAttachments;
    if (attachments.some((attachment) => attachment.status === "uploading")) {
      setToast(uiCopy.toast.workbench.agent.imageUploading);
      return;
    }
    if (runtimeAdapter === "server" && attachments.some((attachment) => attachment.status !== "ready" || !attachment.assetId || !attachment.versionId)) {
      setToast(uiCopy.toast.workbench.agent.imageUploadFailed);
      return;
    }
    const interactionSelection = selection;
    if (!message && !attachments.length) return;
    const userText = message || uiCopy.workbench.chat.uploadedReferences(attachments.length);
    const sentReferences = resolvedExplicitReferences();
    const visiblePageIds = visiblePageIdsForAgent();
    addMessage({ role: "user", kind: "plain", text: userText, attachments, explicitReferences: sentReferences });
    setComposer("");
    setComposerAttachments([]);
    setExplicitReferences([]);
    setComposerReferenceOrder([]);
    if (runtimeAdapter === "server" && runtimeIds) {
      const streamingId = uid("agent-stream");
      setStreamingTurn({ id: streamingId, text: "", status: "thinking" });
      void apiStreamInteraction(runtimeIds, {
        message: userText,
        scope,
        currentPageId: visiblePageIds[0],
        visiblePageIds,
        selection: { type: interactionSelection.type, id: interactionSelection.id, pageId: interactionSelection.pageId ?? state.fixture.working.document.units[state.currentPageIndex]?.id, label: interactionSelection.label },
        explicitReferences: sentReferences,
        imageAttachments: attachments.flatMap((attachment) => attachment.assetId && attachment.versionId
          ? [{ assetId: attachment.assetId, versionId: attachment.versionId, name: attachment.name }]
          : []),
      }, {
        onDecision: () => setStreamingTurn((current) => current?.id === streamingId ? { ...current, status: "writing" } : current),
        onTextDelta: (delta) => setStreamingTurn((current) => current?.id === streamingId ? { ...current, status: "writing", text: current.text + delta } : current),
      }).then(async (result) => {
        if (result.task && ["created", "queued", "running"].includes(result.task.status)) {
          const taskType = result.task.type;
          const nextActiveTask: ActiveTask = {
            id: result.task.id,
            name: taskType,
            label: taskType === "asset_image_generate" ? uiCopy.workbench.taskLabel.generateAssetImage : taskType === "frame_image_generate" ? uiCopy.workbench.action.generateFrameImage : uiCopy.workbench.action.editStoryboard,
            scope: interactionSelection.label ?? result.task.scope,
            progress: result.task.progress,
            status: "running",
            stage: result.task.status === "created" ? "preparing" : result.task.status === "queued" ? "queued" : "generating",
            selection: interactionSelection,
            targetLabel: interactionSelection.label,
            createdAt: result.task.createdAt,
            elapsedSeconds: 0,
          };
          setActiveTask(nextActiveTask);
          activeTaskRef.current = nextActiveTask;
        }
        await refreshServerWorkbench();
        if (result.decision.kind === "ready_to_run") {
          setScope(result.decision.scope);
        }
      }).catch((error) => {
        void refreshServerWorkbench().catch(() => undefined);
        if (error instanceof LanternApiError && error.code === "provider_not_configured") setModelSettingsPromptOpen(true);
        setToast(error instanceof Error ? error.message : uiCopy.toast.workbench.agent.unavailable);
      }).finally(() => {
        setStreamingTurn((current) => current?.id === streamingId ? null : current);
      });
      return;
    }
    addMessage({ role: "agent", kind: "plain", text: uiCopy.workbench.chat.offlineDemo });
  };

  const applyCandidate = (candidate: Candidate, expectedFrameTarget?: { unitId: string; frameId: string }) => {
    if (candidate.status !== "available") {
      setToast(uiCopy.toast.workbench.candidate.cannotApplyEnded);
      return;
    }
    if (runtimeAdapter === "server") {
      void apiApplyCandidate(candidate.id, state.fixture.working.revision, expectedFrameTarget)
        .then(() => refreshServerWorkbench())
        .catch((error) => { void refreshServerWorkbench().catch(() => undefined); setToast(error instanceof Error ? error.message : uiCopy.toast.workbench.candidate.applyFailed); });
      return;
    }
    if (candidate.baseRevision !== state.fixture.working.revision) {
      setState((current) => ({ ...current, candidates: current.candidates.map((item) => item.id === candidate.id ? { ...item, status: "stale" } : item) }));
      setToast(uiCopy.toast.workbench.candidate.stale);
      return;
    }
    let operations: WorkspaceOperation[];
    if (candidate.commands?.length) {
      operations = candidate.commands;
    } else if (candidate.document) {
      operations = [{ type: "replace_chapter_presentation", document: candidate.document }];
    } else {
      setToast(uiCopy.toast.workbench.candidate.noApplicableContent);
      return;
    }
    if (commitOperations(operations, uiCopy.workbench.operation.applyCandidate(candidate.title), "candidate", candidate.id)) {
      setState((current) => ({ ...current, candidates: current.candidates.map((item) => item.id === candidate.id ? { ...item, status: "applied" } : item) }));
      addMessage({ role: "agent", kind: "plain", text: uiCopy.workbench.candidate.appliedMessage(candidate.title) });
    }
  };

  const startFrameImageCandidatePreview = (candidate: Candidate) => {
    if (candidate.status !== "available") {
      setToast(uiCopy.toast.workbench.candidate.cannotPreviewEnded);
      return;
    }
    const target = frameImageCandidateTarget(candidate);
    const targetPageIndex = resolveReadingUnitIndex(state.fixture.working.document, target?.pageId);
    if (!target || targetPageIndex < 0) {
      setToast(uiCopy.toast.workbench.candidate.targetMissing);
      return;
    }
    const targetUnit = state.fixture.working.document.units.find((unit) => unit.id === target.pageId)!;
    const targetPageLabel = presentationUnitNumberLabel(targetUnit, targetPageIndex);
    if (!isCandidatePreviewTargetVisible(
      pageDisplayGroups(state.fixture.working.document, pageDisplayMode),
      state.currentPageIndex,
      targetPageIndex,
    )) {
      setToast(uiCopy.toast.workbench.candidate.wrongPage(targetPageLabel));
      return;
    }
    try {
      projectFrameImageCandidate(state.fixture, candidate);
    } catch (error) {
      setToast(error instanceof Error ? error.message : uiCopy.toast.workbench.candidate.previewFailed);
      return;
    }
    const previous = frameImageCandidatePreview;
    closeFloatingMenus();
    setCanvasMode("focus");
    setInspectorOpen(false);
    setObjectInteractionMode("select");
    setSelection(target);
    setFrameImageCandidatePreview({
      candidateId: candidate.id,
      mode: "candidate",
      target,
      previousSelection: previous?.previousSelection ?? selection,
      previousPageIndex: previous?.previousPageIndex ?? state.currentPageIndex,
      previousCanvasMode: previous?.previousCanvasMode ?? canvasMode,
      previousInteractionMode: previous?.previousInteractionMode ?? objectInteractionMode,
      previousInspectorOpen: previous?.previousInspectorOpen ?? inspectorOpen,
    });
  };

  const cancelFrameImageCandidatePreview = () => {
    if (!frameImageCandidatePreview) return;
    setSelection(frameImageCandidatePreview.previousSelection);
    setCanvasMode(frameImageCandidatePreview.previousCanvasMode);
    setObjectInteractionMode(frameImageCandidatePreview.previousInteractionMode);
    setInspectorOpen(frameImageCandidatePreview.previousInspectorOpen);
    setState((current) => ({ ...current, currentPageIndex: frameImageCandidatePreview.previousPageIndex }));
    setFrameImageCandidatePreview(null);
  };

  const applyFrameImageCandidatePreview = () => {
    if (!frameImageCandidatePreview) return;
    const candidate = state.candidates.find((item) => item.id === frameImageCandidatePreview.candidateId);
    if (!candidate || candidate.status !== "available") {
      setFrameImageCandidatePreview(null);
      setToast(uiCopy.toast.workbench.candidate.cannotApplyEnded);
      return;
    }
    const target = frameImageCandidateTarget(candidate);
    if (!target?.id || !target.pageId || target.id !== frameImageCandidatePreview.target.id || target.pageId !== frameImageCandidatePreview.target.pageId) {
      setToast(uiCopy.toast.workbench.candidate.previewTargetChanged);
      return;
    }
    setFrameImageCandidatePreview(null);
    applyCandidate(candidate, { unitId: target.pageId, frameId: target.id });
  };

  useEffect(() => {
    if (!autoPreviewCandidateId) return;
    // This id is a one-shot task-completion event and is consumed by this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAutoPreviewCandidateId(null);
    if (frameImageCandidatePreview) return;
    const candidate = state.candidates.find((item) => item.id === autoPreviewCandidateId);
    const target = candidate ? frameImageCandidateTarget(candidate) : undefined;
    const targetPageIndex = resolveReadingUnitIndex(state.fixture.working.document, target?.pageId);
    if (!candidate || candidate.status !== "available" || targetPageIndex < 0 || !isCandidatePreviewTargetVisible(
      pageDisplayGroups(state.fixture.working.document, pageDisplayMode),
      state.currentPageIndex,
      targetPageIndex,
    )) return;
    startFrameImageCandidatePreview(candidate);
  // The candidate id is a one-shot completion event; current workspace state is revalidated inside the effect.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPreviewCandidateId]);

  const discardCandidate = (candidateId: string) => {
    if (frameImageCandidatePreview?.candidateId === candidateId) cancelFrameImageCandidatePreview();
    if (runtimeAdapter === "server") {
      void apiDiscardCandidate(candidateId)
        .then(() => refreshServerWorkbench())
        .catch((error) => setToast(error instanceof Error ? error.message : uiCopy.toast.workbench.candidate.discardFailed));
      return;
    }
    setState((current) => ({ ...current, candidates: current.candidates.map((item) => item.id === candidateId ? { ...item, status: "discarded" } : item) }));
  };

  const requestSaveChapter = () => {
    if (savingChapter) return;
    setProjectMenu(false);
    setSaveChapterConfirmOpen(true);
  };

  const saveChapter = () => {
    if (savingChapter) return;
    setSaveChapterConfirmOpen(false);
    setSavingChapter(true);
    if (runtimeAdapter === "server" && runtimeIds) {
      void serverCommitQueueRef.current
        .then(() => {
          const revision = stateRef.current.fixture.working.revision;
          return apiSaveSnapshot(runtimeIds.chapterId, revision).then(() => revision);
        })
        .then((revision) => refreshServerWorkbench().then(() => revision))
        .then((revision) => {
          setVersionTimelineRefreshKey((key) => key + 1);
          setToast(uiCopy.toast.workbench.snapshot.saved(revision));
        })
        .catch((error) => setToast(error instanceof Error ? error.message : uiCopy.toast.common.saveFailed))
        .finally(() => setSavingChapter(false));
      setProjectMenu(false);
      return;
    }
    try {
      const current = stateRef.current;
      const snapshot = createSnapshot(current.fixture.working, current.fixture.working.revision);
      const next = { ...current, fixture: { ...current.fixture, snapshot } };
      stateRef.current = next;
      setState(next);
      setVersionTimelineRefreshKey((key) => key + 1);
      setProjectMenu(false);
      setToast(uiCopy.toast.workbench.snapshot.saved(snapshot.sourceWorkingRevision));
    } catch {
      setToast(uiCopy.toast.workbench.snapshot.draftChanged);
    } finally {
      setSavingChapter(false);
    }
  };

  const restoreLastSaved = () => {
    const snapshot = stateRef.current.fixture.snapshot;
    if (!snapshot || restoringSnapshot) return;
    setProjectMenu(false);
    if (runtimeAdapter === "server" && runtimeIds) {
      setRestoringSnapshot(true);
      serverPendingCommitCountRef.current += 1;
      void serverCommitQueueRef.current
        .then(async () => {
          const before = stateRef.current;
          const result = await apiRestoreSnapshot(runtimeIds.chapterId, before.fixture.working.revision);
          pushHistory(before.fixture, uiCopy.workbench.action.returnToSaved, "working");
          const next = { ...before, fixture: { ...before.fixture, ...result } };
          stateRef.current = next;
          setState(next);
          setSelection((current) => repairSelectionForState(current, next));
          setToast(uiCopy.toast.workbench.snapshot.restored(snapshot.sourceWorkingRevision));
        })
        .catch((error) => setToast(error instanceof Error ? error.message : uiCopy.toast.workbench.snapshot.restoreFailed))
        .finally(() => {
          serverPendingCommitCountRef.current = Math.max(0, serverPendingCommitCountRef.current - 1);
          setRestoringSnapshot(false);
        });
      return;
    }
    const current = stateRef.current;
    const plan = planCapabilities([{ id: "restore_workspace_version", input: { document: snapshot.document, storyboardBeats: current.fixture.storyboardBeats } }]);
    commitOperations(plan.commands, uiCopy.workbench.action.returnToSaved, "undo", undefined, undefined, undefined, { resolvedResources: snapshot.resolvedResources });
  };

  const updateReference = (id: string, patch: Partial<ReferencePlacement>, label: string) => {
    if (runtimeAdapter === "server") {
      setState((current) => ({
        ...current,
        fixture: { ...current.fixture, references: current.fixture.references.map((item) => item.id === id ? { ...item, ...patch } : item) },
      }));
      void apiUpdatePlacement(id, {
        x: patch.x,
        y: patch.y,
        zoom: patch.zoom,
        zIndex: patch.zIndex,
        collapsed: patch.collapsed,
        pinned: patch.pinned,
      }).then(() => setToast(label)).catch((error) => {
        setToast(error instanceof Error ? error.message : uiCopy.toast.workbench.image.cardSaveFailed);
        void refreshServerWorkbench().catch(() => undefined);
      });
      return;
    }
    commitPlacement(state.fixture.references.map((item) => item.id === id ? { ...item, ...patch } : item), label);
  };

  const cycleReferenceImage = (reference: ReferencePlacement) => {
    const images = reference.images ?? [];
    if (images.length < 2) return;
    const currentIndex = images.findIndex((image) => image.versionId === reference.assetVersionId);
    const next = images[(currentIndex + 1 + images.length) % images.length];
    const patch = { assetVersionId: next.versionId, imageSrc: next.imageSrc };
    setState((current) => ({
      ...current,
      fixture: { ...current.fixture, references: current.fixture.references.map((item) => item.id === reference.id ? { ...item, ...patch } : item) },
    }));
    if (runtimeAdapter === "server") {
      void apiUpdatePlacement(reference.id, { assetVersionId: next.versionId })
        .then(() => setToast(uiCopy.toast.workbench.image.assetImageSwitched(next.label)))
        .catch((error) => {
          setToast(error instanceof Error ? error.message : uiCopy.toast.workbench.image.assetImageSwitchFailed);
          void refreshServerWorkbench().catch(() => undefined);
        });
    } else {
      setToast(uiCopy.toast.workbench.image.assetImageSwitched(next.label));
    }
  };

  const deleteReference = (id: string) => {
    if (runtimeAdapter === "server") {
      setState((current) => ({ ...current, fixture: { ...current.fixture, references: current.fixture.references.filter((item) => item.id !== id) } }));
      setSelection(noSelection);
      void apiDeletePlacement(id).then(() => setToast(uiCopy.toast.workbench.canvas.objectDeleted)).catch((error) => {
        setToast(error instanceof Error ? error.message : uiCopy.toast.workbench.canvas.objectDeleteFailed);
        void refreshServerWorkbench().catch(() => undefined);
      });
      return;
    }
    commitPlacement(state.fixture.references.filter((item) => item.id !== id), uiCopy.workbench.operation.deleteCanvasObject);
    setSelection(noSelection);
  };

  const moveReferences = (ids: string[], deltaX: number, deltaY: number) => {
    if (!ids.length || (!deltaX && !deltaY)) return;
    const selectedIds = new Set(ids);
    const nextReferences = state.fixture.references.map((item) => selectedIds.has(item.id) ? { ...item, x: item.x + deltaX, y: item.y + deltaY } : item);
    if (runtimeAdapter === "server") {
      setState((current) => ({ ...current, fixture: { ...current.fixture, references: nextReferences } }));
      void Promise.all(nextReferences.filter((item) => selectedIds.has(item.id)).map((item) => apiUpdatePlacement(item.id, { x: item.x, y: item.y })))
        .then(() => setToast(uiCopy.toast.workbench.canvas.elementsMoved(ids.length)))
        .catch((error) => {
          setToast(error instanceof Error ? error.message : uiCopy.toast.workbench.canvas.moveElementsFailed);
          void refreshServerWorkbench().catch(() => undefined);
        });
      return;
    }
    commitPlacement(nextReferences, uiCopy.workbench.operation.moveCanvasElements(ids.length));
  };

  const removeReferences = (ids: string[]) => {
    if (!ids.length) return;
    const selectedIds = new Set(ids);
    const nextReferences = state.fixture.references.filter((item) => !selectedIds.has(item.id));
    if (runtimeAdapter === "server") {
      setState((current) => ({ ...current, fixture: { ...current.fixture, references: nextReferences } }));
      void Promise.all(ids.map((id) => apiDeletePlacement(id)))
        .then(() => setToast(uiCopy.toast.workbench.canvas.elementsRemoved(ids.length)))
        .catch((error) => {
          setToast(error instanceof Error ? error.message : uiCopy.toast.workbench.canvas.removeElementsFailed);
          void refreshServerWorkbench().catch(() => undefined);
        });
      return;
    }
    commitPlacement(nextReferences, uiCopy.workbench.operation.removeCanvasElements(ids.length));
  };

  const changeReferenceLayer = (reference: ReferencePlacement, action: "up" | "down" | "top" | "bottom") => {
    const levels = state.fixture.references.map((item) => item.zIndex ?? 10);
    const current = reference.zIndex ?? 10;
    const next = action === "top" ? Math.max(...levels, 10) + 1
      : action === "bottom" ? Math.max(0, Math.min(...levels, 10) - 1)
        : action === "up" ? current + 1 : Math.max(0, current - 1);
    updateReference(reference.id, { zIndex: next }, action === "top" ? uiCopy.workbench.operation.movedToFront : action === "bottom" ? uiCopy.workbench.operation.movedToBack : action === "up" ? uiCopy.workbench.operation.movedLayerUp : uiCopy.workbench.operation.movedLayerDown);
  };

  const addComposerReference = (reference: ComposerReference) => {
    setExplicitReferences((items) => items.some((item) => item.id === reference.id) ? items : [reference, ...items]);
    setComposerReferenceOrder((items) => [`reference:${reference.id}`, ...items.filter((item) => item !== `reference:${reference.id}`)]);
  };

  const addAssetReference = (asset: AssetSummary) => {
    if (!asset.versionId) {
      setToast(uiCopy.toast.workbench.reference.assetVersionMissing);
      return;
    }
    addComposerReference({
      id: `asset:${asset.id}:${asset.versionId}`,
      objectType: asset.kind === "character" || asset.kind === "scene" || asset.kind === "style" ? asset.kind : "asset",
      objectId: asset.id,
      versionId: asset.versionId,
      label: asset.name,
      kind: "asset",
      imageUrl: asset.contentUrl,
    });
  };

  const addCanvasAssetReference = (reference: ReferencePlacement) => {
    const asset = state.assets?.find((item) => item.id === reference.assetId || item.name === reference.name);
    if (asset) addAssetReference(asset);
    else setToast(uiCopy.toast.workbench.reference.canvasAssetVersionMissing);
  };

  const addSelectionReference = (targetSelection: Selection = selection) => {
    if (!targetSelection.id || targetSelection.type === "none" || targetSelection.type === "presentation_unit" || targetSelection.type === "reference_card") return;
    if (targetSelection.type === "storyboard_beat") {
      const beat = state.fixture.storyboardBeats.find((item) => item.id === targetSelection.id);
      if (!beat) return;
      addComposerReference({ id: `storyboard:${beat.id}:${beat.versionId}`, objectType: "storyboard_beat", objectId: beat.id, versionId: beat.versionId, label: targetSelection.label, kind: "storyboard_beat" });
      openAgentWorkspace();
      return;
    }
    if (!targetSelection.pageId) return;
    const targetPage = workingPages.find((item) => item.id === targetSelection.pageId);
    const targetElement = targetPage?.elements.find((element) => element.id === targetSelection.id);
    if (!targetPage || !targetElement) return;
    if (targetElement.type === "speech_balloon") {
      const balloonNumber = workingPages.flatMap((comicPage) => comicPage.elements.filter((element): element is SpeechBalloonElement => element.type === "speech_balloon")).findIndex((balloon) => balloon.id === targetElement.id) + 1;
      addComposerReference({
        id: `dialogue:${targetElement.id}`,
        objectType: "canvas_element",
        objectId: targetElement.id,
        label: uiCopy.workbench.label.dialogue(balloonNumber || 1),
        kind: "speech_balloon",
        balloonNumber: balloonNumber || 1,
        dialogueText: targetElement.content.text,
      });
      setScope(uiCopy.workbench.scope.balloon);
      openAgentWorkspace();
      return;
    }
    const frame = targetElement.type === "comic_frame"
      ? targetElement
      : targetElement.type === "image" && targetElement.comicFrameId
        ? targetPage.elements.find((element): element is ComicFrameElement => element.type === "comic_frame" && element.id === targetElement.comicFrameId)
        : undefined;
    if (frame) {
      const frameImage = targetPage.elements.find((element): element is ImageElement => element.type === "image" && element.comicFrameId === frame.id);
      const imageUrl = frameImage ? assetSrcByKey.get(`${frameImage.assetId}:${frameImage.assetVersionId}`) : undefined;
      addComposerReference({
        id: `comic-frame:${frame.id}`,
        objectType: "canvas_element",
        objectId: frame.id,
        label: uiCopy.workbench.label.frameFinal(frame.readingOrder),
        kind: "comic_frame",
        imageUrl,
      });
      setScope(uiCopy.workbench.scope.currentFrame);
      openAgentWorkspace();
      return;
    }
    addComposerReference({ id: `canvas:${targetElement.id}`, objectType: "canvas_element", objectId: targetElement.id, label: targetSelection.label, kind: "canvas_element" });
    openAgentWorkspace();
  };

  const applyInspectorEdit = () => {
    if (selection.type === "speech_balloon") {
      const balloon = selectedElement as SpeechBalloonElement | undefined;
      const value = editDraft.dialogue ?? balloon?.content.text ?? "";
      if (balloon && selection.pageId) {
        const parsedFontSize = Number(editDraft.fontSize ?? balloon.style.fontSize);
        const parsedStrokeWidth = Number(editDraft.strokeWidth ?? balloon.style.strokeWidth);
        const fontSize = Number.isFinite(parsedFontSize) ? clampValue(parsedFontSize, 6, 240) : balloon.style.fontSize;
        const strokeWidth = Number.isFinite(parsedStrokeWidth) ? clampValue(parsedStrokeWidth, 0, 20) : balloon.style.strokeWidth;
        commitCapabilities(capabilitiesForElementPatch(selection.pageId, balloon.id, {
          content: { ...balloon.content, text: value },
          style: { ...balloon.style, fontSize, strokeWidth },
        }), uiCopy.workbench.operation.editBalloon);
      }
    } else if (selection.type === "text" && selectedElement?.type === "text" && selection.pageId) {
      const content = editDraft.narration ?? selectedElement.content.text;
      const parsedSize = Number(editDraft.fontSize ?? selectedElement.style.fontSize);
      const fontSize = Number.isFinite(parsedSize) ? clampValue(parsedSize, 6, 240) : selectedElement.style.fontSize;
      commitCapabilities(capabilitiesForElementPatch(selection.pageId, selectedElement.id, { content: { ...selectedElement.content, text: content }, style: { ...selectedElement.style, fontSize } }), uiCopy.workbench.operation.editNarration);
    } else if (editingStoryboardTarget) {
      const title = (editDraft.title ?? editingStoryboardBeat?.title ?? "").trim();
      const description = (editDraft.description ?? editingStoryboardBeat?.description ?? "").trim();
      if (!title) {
        setToast(uiCopy.toast.workbench.editing.frameTitleRequired);
        return;
      }
      if (editingStoryboardBeatId) {
        const patch = {
          ...(editDraft.title !== undefined ? { title: editDraft.title.trim() } : {}),
          ...(editDraft.description !== undefined ? { description: editDraft.description.trim() } : {}),
        };
        if (Object.keys(patch).length) {
          commitCapability("update_storyboard_beat", { storyboardBeatId: editingStoryboardBeatId, patch }, uiCopy.workbench.action.editFrameImage);
        }
      } else {
        commitCapability("create_frame_storyboard_beat", {
          unitId: editingStoryboardTarget.unitId,
          frameId: editingStoryboardTarget.frameId,
          title,
          description,
        }, uiCopy.workbench.action.createStoryboard);
      }
    }
    setEditDraft({});
    if (selection.type === "speech_balloon" || selection.type === "text" || editingStoryboardTarget) {
      setEditingStoryboardBeatId(null);
      setEditingStoryboardTarget(null);
      setInspectorOpen(false);
    }
  };

  const adjustNarrationFontSize = (delta: number) => {
    if (selectedElement?.type !== "text") return;
    const current = Number(editDraft.fontSize ?? selectedElement.style.fontSize);
    const next = clampValue(Number.isFinite(current) ? current + delta : selectedElement.style.fontSize + delta, 6, 240);
    setEditDraft((draft) => ({ ...draft, fontSize: String(next) }));
  };

  const adjustBalloonStyleNumber = (field: "fontSize" | "strokeWidth", delta: number) => {
    if (selectedElement?.type !== "speech_balloon") return;
    const fallback = selectedElement.style[field];
    const current = Number(editDraft[field] ?? fallback);
    const next = clampValue(Number.isFinite(current) ? current + delta : fallback + delta, field === "fontSize" ? 6 : 0, field === "fontSize" ? 240 : 20);
    setEditDraft((draft) => ({ ...draft, [field]: String(next) }));
  };

  const adjustFrameBorderWidth = (delta: number) => {
    if (!editingStoryboardFrame) return;
    const current = Number(editDraft.frameBorderWidth ?? editingStoryboardFrame.border.width);
    const next = clampValue(Number.isFinite(current) ? current + delta : editingStoryboardFrame.border.width + delta, 0, 24);
    setEditDraft((draft) => ({ ...draft, frameBorderWidth: String(next) }));
  };

  const applyFrameBorderEdit = () => {
    if (!editingStoryboardTarget || !editingStoryboardFrame) return;
    const parsedWidth = Number(editDraft.frameBorderWidth ?? editingStoryboardFrame.border.width);
    if (!Number.isFinite(parsedWidth)) {
      setToast(uiCopy.toast.workbench.editing.invalidBorderWidth);
      return;
    }
    const width = clampValue(parsedWidth, 0, 24);
    if (commitCapability("update_frame_border", {
      unitId: editingStoryboardTarget.unitId,
      frameId: editingStoryboardTarget.frameId,
      width,
    }, uiCopy.workbench.operation.adjustFrameBorder)) {
      setEditDraft((draft) => ({ ...draft, frameBorderWidth: String(width) }));
    }
  };

  const beginCrop = () => {
    if (selection.type === "speech_balloon") {
      setInspectorOpen(false);
      setObjectInteractionMode("crop");
      setToast(uiCopy.toast.workbench.mode.balloonRotationEntered);
      return;
    }
    if (selection.type === "text") {
      setInspectorOpen(false);
      setObjectInteractionMode("crop");
      setToast(uiCopy.toast.workbench.mode.narrationRotationEntered);
      return;
    }
    const { frame, image: frameImage } = frameAndImageForSelection(selection);
    const image = selectedElement?.type === "image" ? selectedElement : frameImage;
    if (image && selection.pageId) {
      setSelection({ type: "image", id: image.id, pageId: selection.pageId, label: image.location.space === "frame" ? uiCopy.workbench.label.frameCrop(selection.label) : selection.label });
      setInspectorOpen(false);
      setObjectInteractionMode("crop");
      setToast(uiCopy.toast.workbench.mode.cropEntered);
      return;
    }
    if (!frame || !selection.pageId) {
      setToast(uiCopy.toast.workbench.mode.cropUnsupported);
      return;
    }
    setSelection({ type: "comic_frame", id: frame.id, pageId: selection.pageId, label: selection.label });
    setInspectorOpen(false);
    setObjectInteractionMode("crop");
    setToast(uiCopy.toast.workbench.mode.cornerEditEntered);
  };

  const endCrop = () => {
    const image = selectedElement?.type === "image" ? selectedElement : undefined;
    if (image?.comicFrameId && selection.pageId) {
      setSelection({ type: "comic_frame", id: image.comicFrameId, pageId: selection.pageId, label: uiCopy.workbench.scope.currentFrame });
      setScope(uiCopy.workbench.scope.comicFrame);
    }
    setObjectInteractionMode("select");
    setToast(uiCopy.toast.workbench.mode.cropExited);
  };

  const openStoryboardEditorForFrame = (unitId: string, frameId: string, label: string) => {
    const frame = workingPages.find((comicPage) => comicPage.id === unitId)?.elements
      .find((element): element is ComicFrameElement => element.type === "comic_frame" && element.id === frameId);
    const beatId = frame?.linkedStoryboardBeatId && frame.linkedStoryboardBeatId !== "unassigned"
      ? frame.linkedStoryboardBeatId
      : null;
    const keepsCurrentPlacement = selection.type === "comic_frame" && selection.id === frameId && selection.pageId === unitId;
    if (!keepsCurrentPlacement) setToolbarPlacement(null);
    setEditingStoryboardTarget({ unitId, frameId, label });
    setEditingStoryboardBeatId(beatId);
    setEditDraft({});
    setInspectorOpen(true);
  };

  const openStoryboardRowEditor = (row: StoryboardFrameRow) => {
    setCurrentComicPage(row.pageIndex);
    setSelection({ type: "comic_frame", id: row.frame.id, pageId: row.page.id, label: row.label });
    setScope(uiCopy.workbench.scope.comicFrame);
    setStoryboardMenuFrameId(null);
    openStoryboardEditorForFrame(row.page.id, row.frame.id, row.label);
  };

  const openSelectionEditor = () => {
    setObjectInteractionMode("select");
    if (selection.type === "speech_balloon") {
      setEditDraft({});
      setInspectorOpen(true);
      return;
    }
    if (selection.type === "text") {
      setEditDraft({});
      setInspectorOpen(true);
      return;
    }
    const frameId = selectedElement?.type === "image" ? selectedElement.comicFrameId : selectedElement?.type === "comic_frame" ? selectedElement.id : undefined;
    if ((selection.type === "comic_frame" || selection.type === "image") && selection.pageId && frameId) {
      openStoryboardEditorForFrame(selection.pageId, frameId, selection.label);
      return;
    }
    setToast(uiCopy.toast.workbench.editing.selectFrame);
  };

  const updateBalloonShape = (shape: SpeechBalloonElement["content"]["shape"]) => {
    if (selection.type !== "speech_balloon" || selectedElement?.type !== "speech_balloon" || !selection.pageId) return;
    commitCapabilities(capabilitiesForElementPatch(selection.pageId, selectedElement.id, { content: { ...selectedElement.content, shape } }), uiCopy.workbench.operation.adjustBalloonStyle);
  };

  const handleAgentUpload = async (file?: File) => {
    if (!file) return;
    if (composerAttachments.length >= 3) {
      setToast(uiCopy.toast.workbench.agent.attachmentLimit);
      return;
    }
    const imageUrl = URL.createObjectURL(file);
    const attachment: ComposerAttachment = { id: uid("chat-image"), name: file.name, imageUrl, status: runtimeAdapter === "server" ? "uploading" : "ready" };
    setComposerAttachments((items) => [attachment, ...items]);
    setComposerReferenceOrder((items) => [`attachment:${attachment.id}`, ...items]);
    if (runtimeAdapter !== "server" || !runtimeIds) return;
    try {
      const uploaded = await apiUploadAgentAttachment(runtimeIds.projectId, file);
      setComposerAttachments((items) => items.map((item) => item.id === attachment.id ? { ...item, ...uploaded, status: "ready" } : item));
    } catch (error) {
      setComposerAttachments((items) => items.map((item) => item.id === attachment.id ? { ...item, status: "failed" } : item));
      setToast(error instanceof Error ? error.message : uiCopy.toast.workbench.agent.attachmentUploadFailed);
    }
  };

  const removeComposerAttachment = (id: string) => {
    setComposerAttachments((items) => {
      const target = items.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.imageUrl);
      setComposerReferenceOrder((order) => order.filter((item) => item !== `attachment:${id}`));
      return items.filter((item) => item.id !== id);
    });
  };

  const handleCanvasUpload = async (file?: File) => {
    if (!file) return;
    try {
      if (runtimeAdapter === "server" && runtimeIds) {
        await apiUploadAsset(runtimeIds.projectId, file, "reference_image", {
          x: canvasReferenceDropX,
          y: 220 + canvasReferences.length * 42,
        });
        try {
          await refreshServerWorkbench();
          setToast(uiCopy.toast.workbench.asset.imageAddedToCanvasAndList);
        } catch (error) {
          // Upload has already succeeded. Avoid presenting a stale-workbench
          // refresh failure as an upload failure, which encourages duplicate
          // retries and makes a canvas-only image look incorrectly imported.
          setToast(error instanceof Error ? uiCopy.toast.workbench.asset.imageSavedRefreshFailed(error.message) : uiCopy.toast.workbench.asset.imageSavedRefreshFallback);
        }
        return;
      }
      const asset = await saveUploadedImage(file);
      const assetId = `asset-${asset.id}`;
      const name = file.name.replace(/\.[^.]+$/, "") || uiCopy.workbench.operation.uploadImage;
      const reference: ReferencePlacement = {
        id: uid("reference-upload"),
        kind: "reference_image",
        name,
        detail: uiCopy.workbench.operation.uploadedCanvasImageDetail,
        imageSrc: asset.url,
        assetId,
        assetVersionId: asset.id,
        localAssetId: asset.id,
        localAssetSource: "upload",
        x: canvasReferenceDropX,
        y: 220 + canvasReferences.length * 42,
        zoom: 1,
        collapsed: false,
        pinned: false,
      };
      const summary: AssetSummary = {
        id: assetId,
        kind: "reference_image",
        name,
        description: uiCopy.workbench.defaultDescription.uploadedImage,
        versionId: asset.id,
        contentUrl: asset.url,
        versions: [{ id: asset.id, version: 1, contentUrl: asset.url, createdAt: asset.createdAt }],
        libraryStatus: "canvas_only",
      };
      pushHistory(state.fixture, uiCopy.workbench.operation.uploadToCanvasAndAssets, "placement");
      setState((current) => ({
        ...current,
        assets: [...(current.assets ?? []).filter((item) => item.id !== summary.id), summary],
        fixture: { ...current.fixture, references: [...current.fixture.references, reference] },
      }));
      setSelection({ type: "reference_card", id: reference.id, label: reference.name });
      setToast(uiCopy.toast.workbench.asset.imageAddedToCanvasAndList);
    } catch (error) {
      setToast(error instanceof Error ? error.message : uiCopy.toast.workbench.asset.imageSaveFailed);
    }
  };

  const handleFrameImageUpload = async (file?: File) => {
    const target = frameImageTarget?.selection;
    if (!file || !target?.pageId) return;
    try {
      if (runtimeAdapter === "server" && runtimeIds) {
        const uploaded = await apiUploadAsset(runtimeIds.projectId, file);
        const uploadedVersion = uploaded.versions[0];
        if (!uploadedVersion) throw new Error(uiCopy.toast.workbench.asset.imageSaveFailed);
        await apiImportAssetToCanvasList(runtimeIds.projectId, uploaded.id);
        const loaded = await refreshServerWorkbench();
        const asset = loaded.state.assets?.find((candidate) => candidate.id === uploaded.id);
        const version = asset?.versions?.find((candidate) => candidate.id === uploadedVersion.id) ?? uploadedVersion;
        placeFrameImage({
          id: `asset:${uploaded.id}:${uploadedVersion.id}`,
          assetId: uploaded.id,
          assetVersionId: uploadedVersion.id,
          label: uploaded.name,
          url: asset?.contentUrl ?? asset?.versions?.find((candidate) => candidate.id === uploadedVersion.id)?.contentUrl,
          mediaType: uploadedVersion.contentType ?? "image/png",
          width: typeof version.width === "number" ? version.width : undefined,
          height: typeof version.height === "number" ? version.height : undefined,
          source: { kind: "asset" },
        }, target);
        return;
      }

      const uploaded = await saveUploadedImage(file);
      const assetId = `asset-${uploaded.id}`;
      const name = file.name.replace(/\.[^.]+$/, "") || uiCopy.workbench.operation.uploadImage;
      const summary: AssetSummary = {
        id: assetId,
        kind: "reference_image",
        name,
        description: uiCopy.workbench.defaultDescription.uploadedImage,
        versionId: uploaded.id,
        contentUrl: uploaded.url,
        versions: [{ id: uploaded.id, version: 1, contentUrl: uploaded.url, createdAt: uploaded.createdAt }],
        libraryStatus: "library",
      };
      const currentState = stateRef.current;
      const nextState = {
        ...currentState,
        assets: [...(currentState.assets ?? []).filter((item) => item.id !== summary.id), summary],
      };
      stateRef.current = nextState;
      setState(nextState);
      placeFrameImage({
        id: `asset:${assetId}:${uploaded.id}`,
        assetId,
        assetVersionId: uploaded.id,
        label: name,
        url: uploaded.url,
        mediaType: uploaded.contentType,
        source: { kind: "asset" },
      }, target);
    } catch (error) {
      setToast(error instanceof Error ? error.message : uiCopy.toast.workbench.asset.imageSaveFailed);
    }
  };

  const placeLibraryAssetOnCanvas = async (asset: AssetSummary) => {
    const x = canvasReferenceDropX;
    const y = 150 + canvasReferences.length * 34;
    if (!asset.contentUrl) {
      setToast(uiCopy.toast.workbench.asset.confirmedImageMissing);
      return;
    }
    if (runtimeAdapter === "server" && runtimeIds) {
      try {
        await apiPlaceAsset(runtimeIds.projectId, asset.id, x, y);
        await refreshServerWorkbench();
        setToast(uiCopy.toast.workbench.asset.placedOnCanvas(asset.name));
      } catch (error) {
        setToast(error instanceof Error ? error.message : uiCopy.toast.workbench.asset.placementFailed);
      }
      return;
    }
    const reference: ReferencePlacement = {
      id: uid("reference-library"),
      kind: asset.kind === "character" || asset.kind === "scene" || asset.kind === "prop" || asset.kind === "style" || asset.kind === "sketch" || asset.kind === "reference_image" ? asset.kind : "sketch",
      name: asset.name,
      detail: asset.description,
      imageSrc: asset.contentUrl,
      assetId: asset.id,
      assetVersionId: asset.versionId,
      x,
      y,
      zoom: 1,
      collapsed: false,
      pinned: false,
    };
    commitPlacement([...state.fixture.references, reference], uiCopy.workbench.operation.placeAssetOnCanvas(asset.name));
  };

  const openSaveAssetForm = (asset: AssetSummary, position?: { x: number; y: number }) => {
    if (!asset.canvasListItemId || isAssetVisibleInAssetSpace(asset)) return;
    const savedKind: CanvasAssetSaveKind = asset.kind === "character" || asset.kind === "scene" || asset.kind === "prop" ? asset.kind : "reference_image";
    setAssetSaveDraft({ name: asset.name, kind: savedKind });
    setAssetMenuId(null);
    if (position) setAssetMenuPosition(position);
    setAssetSaveFormId(asset.id);
  };

  const openReferenceSaveAssetForm = (reference: ReferencePlacement, anchor: { left: number; right: number; top: number; bottom: number }) => {
    const asset = state.assets?.find((item) => item.id === reference.assetId || item.id === reference.localAssetId);
    if (!asset) {
      setToast(uiCopy.toast.workbench.asset.imageNotInCanvasList);
      return;
    }
    const workbenchRect = document.querySelector<HTMLElement>(".workbench")?.getBoundingClientRect();
    if (!workbenchRect) return;
    const formWidth = 248;
    const formHeight = 224;
    const drawerRight = document.querySelector<HTMLElement>(".creation-drawer:not(.closed)")?.getBoundingClientRect().right;
    const agentLeft = document.querySelector<HTMLElement>(".agent-workspace.open, .version-workspace.open")?.getBoundingClientRect().left;
    const leftLimit = Math.max(16, (drawerRight ?? workbenchRect.left) - workbenchRect.left + 12);
    const rightLimit = Math.max(leftLimit, Math.min(workbenchRect.width - formWidth - 16, (agentLeft ?? workbenchRect.right) - workbenchRect.left - formWidth - 12));
    const imageCenter = (anchor.left + anchor.right) / 2;
    const preferredX = imageCenter < workbenchRect.left + workbenchRect.width / 2
      ? anchor.right - workbenchRect.left + 12
      : anchor.left - workbenchRect.left - formWidth - 12;
    openSaveAssetForm(asset, {
      x: clampValue(preferredX, leftLimit, rightLimit),
      y: clampValue(anchor.top - workbenchRect.top + ((anchor.bottom - anchor.top) - formHeight) / 2, 16, Math.max(16, workbenchRect.height - formHeight - 16)),
    });
  };

  const saveCanvasAssetToLibrary = async (asset: AssetSummary) => {
    const name = assetSaveDraft.name.trim();
    if (!name || !asset.canvasListItemId) return;
    if (runtimeAdapter !== "server") {
      setState((current) => ({ ...current, assets: current.assets?.map((item) => item.id === asset.id ? { ...item, name, kind: assetSaveDraft.kind, libraryStatus: "library" } : item) }));
      setAssetSaveFormId(null);
      setToast(uiCopy.toast.workbench.asset.savedToSpace);
      return;
    }
    setAssetSaveSubmitting(true);
    try {
      await apiSaveCanvasAssetToLibrary(asset.canvasListItemId, { name, kind: assetSaveDraft.kind });
      setAssetSaveFormId(null);
      navigate(`/comics/${comicId}/assets?from=workbench&chapterId=${chapterId}&filter=${assetSaveDraft.kind === "reference_image" ? "reference" : assetSaveDraft.kind}`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : uiCopy.toast.workbench.asset.saveToSpaceFailed);
    } finally {
      setAssetSaveSubmitting(false);
    }
  };

  const pinAssetInList = (asset: AssetSummary) => {
    setAssetMenuId(null);
    if (runtimeAdapter === "server" && asset.canvasListItemId) {
      void apiUpdateCanvasAssetListItem(asset.canvasListItemId, { pinned: true }).then(() => {
        setState((current) => ({ ...current, assets: current.assets?.map((item) => item.id === asset.id ? { ...item, pinned: true } : item) }));
        setToast(uiCopy.toast.workbench.asset.pinned(asset.name));
      }).catch((error) => setToast(error instanceof Error ? error.message : uiCopy.toast.workbench.asset.pinFailed));
      return;
    }
    setAssetListOrder((current) => [asset.id, ...current.filter((id) => id !== asset.id)]);
    setState((current) => ({ ...current, assets: current.assets?.map((item) => item.id === asset.id ? { ...item, pinned: true } : item) }));
    setToast(uiCopy.toast.workbench.asset.pinned(asset.name));
  };

  const removeAssetFromList = (asset: AssetSummary) => {
    setAssetMenuId(null);
    if (runtimeAdapter === "server" && asset.canvasListItemId) {
      void apiUpdateCanvasAssetListItem(asset.canvasListItemId, { hidden: true }).then(() => {
        setState((current) => ({ ...current, assets: current.assets?.filter((item) => item.id !== asset.id) }));
        setToast(uiCopy.toast.workbench.asset.removedFromList(asset.name));
      }).catch((error) => setToast(error instanceof Error ? error.message : uiCopy.toast.workbench.asset.removeFromListFailed));
      return;
    }
    setState((current) => ({ ...current, assets: current.assets?.filter((item) => item.id !== asset.id) }));
    setToast(uiCopy.toast.workbench.asset.removedFromList(asset.name));
  };

  const renameAssetInList = (asset: AssetSummary) => {
    const displayName = assetRenameDraft.trim();
    if (!displayName) return;
    if (runtimeAdapter === "server" && asset.canvasListItemId) {
      void apiUpdateCanvasAssetListItem(asset.canvasListItemId, { displayName }).then(() => {
        setState((current) => ({ ...current, assets: current.assets?.map((item) => item.id === asset.id ? { ...item, name: displayName } : item) }));
        setAssetRenameId(null);
        setAssetRenameDraft("");
        setToast(uiCopy.toast.workbench.asset.renamed(displayName));
      }).catch((error) => setToast(error instanceof Error ? error.message : uiCopy.toast.common.renameFailed));
      return;
    }
    setState((current) => ({ ...current, assets: current.assets?.map((item) => item.id === asset.id ? { ...item, name: displayName } : item) }));
    setAssetRenameId(null);
    setAssetRenameDraft("");
  };

  const applyAssetCandidate = async (candidate: Candidate) => {
    if (runtimeAdapter !== "server") {
      setToast(uiCopy.toast.workbench.agent.demoOffline);
      return;
    }
    await apiApplyCandidate(candidate.id, state.fixture.working.revision);
    await refreshServerWorkbench();
  };

  const exitMultiSelection = () => {
    setMultiSelection(null);
    setMultiMoveDelta({ x: 0, y: 0 });
    multiMoveRef.current = null;
  };

  const switchCanvasMode = (mode: CanvasMode) => {
    if (frameImageCandidatePreview) cancelFrameImageCandidatePreview();
    exitMultiSelection();
    setCreationMode(null);
    setCreationPointer(null);
    setCanvasMode(mode);
    if (mode === "focus") {
      setCanvasOffset({ x: 0, y: 0 });
      setCanvasScale(1);
      setToast(uiCopy.toast.workbench.mode.focusCanvas);
    } else {
      setToast(uiCopy.toast.workbench.mode.freeCanvas);
    }
  };

  const cycleVerticalViewportMode = () => {
    const next = nextVerticalViewportMode(verticalViewportMode);
    setVerticalViewportMode(next);
    if (next !== "off" && canvasMode !== "focus") switchCanvasMode("focus");
    setToast(next === "off" ? uiCopy.toast.workbench.mode.viewportDisabled : uiCopy.toast.workbench.mode.viewportEnabled(verticalViewportModeMeta[next].label));
  };

  const commitMultiMove = (deltaX: number, deltaY: number) => {
    if (!multiSelection || (!deltaX && !deltaY)) return;
    const comicActive = multiSelection.comicActive && multiSelection.comic.length > 0;
    const canvasActive = multiSelection.canvasActive && multiSelection.canvasIds.length > 0;
    if (Number(comicActive) + Number(canvasActive) !== 1) return;
    if (canvasActive) {
      moveReferences(multiSelection.canvasIds, deltaX / canvasScale, deltaY / canvasScale);
      return;
    }
    const stage = stageRef.current;
    if (!stage) return;
    const pageNodes = new Map(Array.from(stage.querySelectorAll<HTMLElement>(".comic-page[data-page-id]")).map((node) => [node.dataset.pageId ?? "", node]));
    const selectedFrameIds = new Set(multiSelection.comic.filter((item) => item.type === "comic_frame" && item.id).map((item) => item.id!));
    const requests: EditorCapabilityRequest[] = [];
    multiSelection.comic.forEach((item) => {
      if (!item.id || !item.pageId) return;
      const comicPage = workingPages.find((candidate) => candidate.id === item.pageId);
      const element = comicPage?.elements.find((candidate) => candidate.id === item.id);
      const pageNode = pageNodes.get(item.pageId);
      const pageRect = pageNode?.getBoundingClientRect();
      if (!comicPage || !element || !pageRect?.width || !pageRect.height) return;
      if (element.type !== "comic_frame" && element.comicFrameId && selectedFrameIds.has(element.comicFrameId)) return;
      const canvasDeltaX = deltaX / pageRect.width * comicPage.canvas.width;
      const canvasDeltaY = deltaY / pageRect.height * comicPage.canvas.height;
      const parentFrame = element.type === "comic_frame" ? undefined : comicPage.elements.find((candidate): candidate is ComicFrameElement => candidate.type === "comic_frame" && candidate.id === element.comicFrameId);
      const bounds = parentFrame?.geometry ?? { x: 0, y: 0, width: comicPage.canvas.width, height: comicPage.canvas.height };
      const geometry = {
        ...element.geometry,
        x: clampValue(element.geometry.x + canvasDeltaX, bounds.x, bounds.x + bounds.width - element.geometry.width),
        y: clampValue(element.geometry.y + canvasDeltaY, bounds.y, bounds.y + bounds.height - element.geometry.height),
      };
      requests.push(...capabilitiesForElementPatch(item.pageId, item.id, { geometry }));
    });
    if (requests.length) commitCapabilities(requests, uiCopy.workbench.operation.moveComicElements(multiSelection.comic.length));
  };

  const finishMarqueeSelection = (selectionBox: MarqueeState) => {
    const stage = stageRef.current;
    if (!stage || !selectionBox.moved) return;
    const stageRect = stage.getBoundingClientRect();
    const hitRect = {
      left: stageRect.left + Math.min(selectionBox.startX, selectionBox.currentX),
      top: stageRect.top + Math.min(selectionBox.startY, selectionBox.currentY),
      right: stageRect.left + Math.max(selectionBox.startX, selectionBox.currentX),
      bottom: stageRect.top + Math.max(selectionBox.startY, selectionBox.currentY),
    };
    const hitElementKeys = new Set<string>();
    stage.querySelectorAll<HTMLElement>("[data-element-id][data-page-id]").forEach((node) => {
      if (containsRect(hitRect, node.getBoundingClientRect()) && node.dataset.elementId && node.dataset.pageId) hitElementKeys.add(`${node.dataset.pageId}:${node.dataset.elementId}`);
    });
    const balloonOrder = new Map(workingPages.flatMap((comicPage) => comicPage.elements.filter((element): element is SpeechBalloonElement => element.type === "speech_balloon")).map((element, index) => [element.id, index + 1]));
    const comic = workingPages.flatMap((comicPage) => comicPage.elements.flatMap((element): Selection[] => {
      if (!hitElementKeys.has(`${comicPage.id}:${element.id}`)) return [];
      if (element.type === "comic_frame") return [{ type: "comic_frame", id: element.id, pageId: comicPage.id, label: uiCopy.workbench.label.frame(element.readingOrder) }];
      if (element.type === "image") return [{ type: "image", id: element.id, pageId: comicPage.id, label: element.name ?? uiCopy.workbench.defaultLabel.frameImage }];
      if (element.type === "speech_balloon") return [{ type: "speech_balloon", id: element.id, pageId: comicPage.id, label: uiCopy.workbench.label.dialogue(balloonOrder.get(element.id) ?? 1) }];
      return [];
    }));
    const canvasIds = Array.from(stage.querySelectorAll<HTMLElement>(".reference-card[data-reference-id]"))
      .filter((node) => containsRect(hitRect, node.querySelector<HTMLElement>(".reference-image")?.getBoundingClientRect() ?? node.getBoundingClientRect()))
      .map((node) => node.dataset.referenceId)
      .filter((id): id is string => Boolean(id));
    if (!comic.length && !canvasIds.length) {
      setMultiSelection(null);
      return;
    }
    setSelection(noSelection);
    setInspectorOpen(false);
    setObjectInteractionMode("select");
    setMultiSelection({ comic, canvasIds, comicActive: comic.length > 0, canvasActive: canvasIds.length > 0, moveActive: false });
    setToast(uiCopy.toast.workbench.mode.multiSelectEntered);
  };

  const handleCanvasPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (frameImageCandidatePreview) return;
    if (event.button !== 0) return;
    if (creationMode) return;
    const stage = stageRef.current;
    if (!stage) return;
    const comicMoveActive = Boolean(multiSelection?.moveActive && multiSelection.comicActive && multiSelection.comic.length);
    const canvasMoveActive = Boolean(multiSelection?.moveActive && multiSelection.canvasActive && multiSelection.canvasIds.length);
    if (multiSelection?.moveActive && Number(comicMoveActive) + Number(canvasMoveActive) === 1) {
      const pointInsideSelection = Array.from(stage.querySelectorAll<HTMLElement>(".multi-selected")).some((node) => {
        const rect = node.getBoundingClientRect();
        return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
      });
      if (pointInsideSelection) {
        event.preventDefault();
        event.stopPropagation();
        multiMoveRef.current = { startX: event.clientX, startY: event.clientY, currentX: event.clientX, currentY: event.clientY, moved: false };
        setMultiMoveDelta({ x: 0, y: 0 });
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
    }
    const target = event.target instanceof Element ? event.target : null;
    const objectTarget = target?.closest("[data-element-id], .reference-card, button, input, textarea, select, [role='menu']");
    if (canvasMode === "focus" && objectInteractionMode === "select" && !objectTarget) {
      const stageRect = stage.getBoundingClientRect();
      event.preventDefault();
      event.stopPropagation();
      const next = { startX: event.clientX - stageRect.left, startY: event.clientY - stageRect.top, currentX: event.clientX - stageRect.left, currentY: event.clientY - stageRect.top, moved: false };
      marqueeRef.current = next;
      setMarquee(next);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (canvasMode !== "free" || objectTarget || isFloatingCanvasControl(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    panRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: canvasOffset.x,
      originY: canvasOffset.y,
      moved: false,
    };
    setIsCanvasPanning(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleCanvasWheel = (event: ReactWheelEvent<HTMLElement>) => {
    if (isVerticalCanvas && canvasMode === "focus" && !isFloatingCanvasControl(event.target)) {
      const stage = stageRef.current;
      if (!stage) return;
      event.preventDefault();
      event.stopPropagation();
      const now = event.timeStamp;
      const intent = verticalWheelIntentRef.current;
      if (now < intent.lockedUntil) return;
      const delta = event.deltaY * (event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? stage.clientHeight : 1);
      if (!delta) return;
      const direction = Math.sign(delta);
      if (now - intent.lastAt > verticalWheelResetMs || direction !== intent.direction) intent.amount = 0;
      intent.amount += Math.abs(delta);
      intent.direction = direction;
      intent.lastAt = now;
      if (intent.amount < verticalWheelThreshold) return;
      intent.amount = 0;
      intent.lockedUntil = now + verticalWheelLockMs;
      setCurrentComicPage(state.currentPageIndex + direction);
      return;
    }
    if (canvasMode !== "free" || isFloatingCanvasControl(event.target)) return;
    const stage = stageRef.current;
    if (!stage) return;
    event.preventDefault();
    event.stopPropagation();
    const stageRect = stage.getBoundingClientRect();
    const pointerX = event.clientX - stageRect.left;
    const pointerY = event.clientY - stageRect.top;
    const factor = Math.exp(-event.deltaY * .0015);
    setCanvasScale((current) => {
      const next = clampValue(current * factor, .55, 2.2);
      if (next === current) return current;
      setCanvasOffset((offset) => ({
        x: offset.x + (current - next) * pointerX,
        y: offset.y + (current - next) * pointerY,
      }));
      return next;
    });
  };

  const handleVerticalStripScroll = () => {
    if (canvasMode !== "focus" || verticalNavigatorFrameRef.current !== null) return;
    verticalNavigatorFrameRef.current = window.requestAnimationFrame(() => {
      verticalNavigatorFrameRef.current = null;
      const strip = verticalStripRef.current;
      const navigator = verticalNavigatorRef.current;
      if (!strip || !navigator) return;
      const pages = strip.querySelectorAll<HTMLElement>("[data-page-index]");
      const first = pages.item(0);
      const last = pages.item(pages.length - 1);
      if (!first || !last) return;
      const contentTop = first.offsetTop;
      const contentHeight = last.offsetTop + last.offsetHeight - contentTop;
      const viewport = verticalNavigatorWindow({ scrollTop: strip.scrollTop, viewportHeight: strip.clientHeight, contentTop, contentHeight });
      navigator.style.setProperty("--navigator-window-top", `${viewport.top * 100}%`);
      navigator.style.setProperty("--navigator-window-height", `${viewport.height * 100}%`);
      navigator.classList.add("visible");
      if (verticalNavigatorHideTimerRef.current !== null) window.clearTimeout(verticalNavigatorHideTimerRef.current);
      verticalNavigatorHideTimerRef.current = window.setTimeout(() => navigator.classList.remove("visible"), verticalNavigatorHideMs);
    });
  };

  const handleCanvasPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (creationMode) setCreationPointer({ x: event.clientX, y: event.clientY });
    const multiMove = multiMoveRef.current;
    if (multiMove) {
      multiMove.currentX = event.clientX;
      multiMove.currentY = event.clientY;
      const deltaX = event.clientX - multiMove.startX;
      const deltaY = event.clientY - multiMove.startY;
      multiMove.moved = multiMove.moved || Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3;
      if (multiMove.moved) suppressStageClickRef.current = true;
      setMultiMoveDelta({ x: deltaX, y: deltaY });
      return;
    }
    const activeMarquee = marqueeRef.current;
    if (activeMarquee) {
      const stageRect = stageRef.current?.getBoundingClientRect();
      if (!stageRect) return;
      activeMarquee.currentX = event.clientX - stageRect.left;
      activeMarquee.currentY = event.clientY - stageRect.top;
      activeMarquee.moved = activeMarquee.moved || Math.abs(activeMarquee.currentX - activeMarquee.startX) > 4 || Math.abs(activeMarquee.currentY - activeMarquee.startY) > 4;
      if (activeMarquee.moved) suppressStageClickRef.current = true;
      setMarquee({ ...activeMarquee });
      return;
    }
    const pan = panRef.current;
    if (!pan) return;
    const dx = event.clientX - pan.startX;
    const dy = event.clientY - pan.startY;
    pan.moved = pan.moved || Math.abs(dx) > 3 || Math.abs(dy) > 3;
    if (pan.moved) suppressStageClickRef.current = true;
    setCanvasOffset({ x: pan.originX + dx, y: pan.originY + dy });
  };

  const finishCanvasPointer = (event: ReactPointerEvent<HTMLElement>) => {
    const multiMove = multiMoveRef.current;
    if (multiMove) {
      multiMoveRef.current = null;
      const deltaX = multiMove.currentX - multiMove.startX;
      const deltaY = multiMove.currentY - multiMove.startY;
      setMultiMoveDelta({ x: 0, y: 0 });
      if (multiMove.moved) commitMultiMove(deltaX, deltaY);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      return;
    }
    const activeMarquee = marqueeRef.current;
    if (activeMarquee) {
      marqueeRef.current = null;
      setMarquee(null);
      finishMarqueeSelection(activeMarquee);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      return;
    }
    const pan = panRef.current;
    if (!pan) return;
    panRef.current = null;
    setIsCanvasPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const handleStageClick = () => {
    if (frameImageCandidatePreview) return;
    if (creationMode) {
      setCreationMode(null);
      setCreationPointer(null);
      return;
    }
    if (objectInteractionMode !== "select") return;
    if (suppressStageClickRef.current) {
      suppressStageClickRef.current = false;
      return;
    }
    if (multiSelection) return;
    if (canvasMode === "focus") {
      setSelectedAssetId(null);
      setSelection(noSelection);
    }
  };

  const handleWorkbenchPointerDownCapture = (event: ReactPointerEvent<HTMLElement>) => {
    const target = event.target instanceof Element ? event.target : null;
    if (comicContextMenu && !target?.closest(".comic-context-menu, .comic-frame-bleed-menu, .comic-page-background-menu, .comic-image-more-menu, .object-toolbar")) {
      setComicContextMenu(null);
      setSelection(noSelection);
    }
    if (!verticalSegmentMenuPosition) return;
    if (target?.closest(".drawer-add-page, .vertical-segment-ratio-menu")) return;
    setVerticalSegmentMenuPosition(null);
  };

  const createComicPage = (pageRole: PresentationUnit["pageRole"]) => {
    const cover = state.fixture.working.document.units.find((unit) => unit.pageRole === "cover");
    if (pageRole === "cover" && cover) {
      const coverIndex = workingPages.findIndex((page) => page.id === cover.id);
      if (coverIndex >= 0) setCurrentComicPage(coverIndex);
      setToast(uiCopy.workbench.pageFlow.coverAlreadyExists);
      setPageCreateMenuOpen(false);
      return;
    }
    const currentUnitId = workingPages[state.currentPageIndex]?.id;
    const input = pageRole === "story" || pageRole === "cover"
      ? { pageRole }
      : { pageRole, ...(currentUnitId ? { relativeToUnitId: currentUnitId, side: "after" as const } : {}) };
    const nextPageIndex = pageRole === "cover" ? 0 : pageRole === "story" ? workingPages.length : currentUnitId ? state.currentPageIndex + 1 : workingPages.length;
    if (commitPageFlowStructureChange("create_page", input, pageRole === "story" ? uiCopy.workbench.action.addStoryPage : pageRole === "cover" ? uiCopy.workbench.action.addCoverPage : uiCopy.workbench.action.addInterludePage, nextPageIndex)) setSelection(noSelection);
    setPageCreateMenuOpen(false);
  };

  const insertBlankComicPage = (unitId: string, side: "before" | "after") => {
    const targetIndex = workingPages.findIndex((page) => page.id === unitId);
    if (targetIndex < 0) return;
    const nextPageIndex = targetIndex + (side === "after" ? 1 : 0);
    if (commitPageFlowStructureChange("create_page", { relativeToUnitId: unitId, side }, side === "before" ? uiCopy.workbench.action.insertPageBefore : uiCopy.workbench.action.insertPageAfter, nextPageIndex)) {
      setSelection(noSelection);
      setPageMenuId(null);
    }
  };

  const duplicateComicPage = (unitId: string) => {
    const pageIndex = workingPages.findIndex((page) => page.id === unitId);
    if (pageIndex < 0) return;
    if (commitCapability("duplicate_presentation_unit", { unitId }, uiCopy.workbench.action.duplicateCurrentPage, pageIndex + 1)) {
      setSelection(noSelection);
      setPageMenuId(null);
    }
  };

  const moveComicPage = (unitId: string, direction: "up" | "down") => {
    const pageIndex = workingPages.findIndex((page) => page.id === unitId);
    const nextPageIndex = pageIndex + (direction === "up" ? -1 : 1);
    if (pageIndex < 0 || nextPageIndex < 0 || nextPageIndex >= workingPages.length) return;
    if (commitPageFlowStructureChange("move_presentation_unit", { unitId, direction }, direction === "up" ? uiCopy.workbench.action.movePageUp : uiCopy.workbench.action.movePageDown, nextPageIndex)) {
      setPageMenuId(null);
    }
  };

  const moveComicPageToVirtualSlot = (unitId: string, afterUnitId: string) => {
    const pageIndex = workingPages.findIndex((page) => page.id === unitId);
    const targetIndex = workingPages.findIndex((page) => page.id === afterUnitId);
    if (pageIndex < 0 || targetIndex < 0 || pageIndex === targetIndex || pageIndex === targetIndex + 1) return;
    const direction = pageIndex < targetIndex ? "down" : "up";
    const steps = pageIndex < targetIndex ? targetIndex - pageIndex : pageIndex - targetIndex - 1;
    if (commitPageFlowStructureChanges(Array.from({ length: steps }, () => ({ id: "move_presentation_unit" as const, input: { unitId, direction } })), uiCopy.workbench.pageFlow.movePageToVirtualSlot, targetIndex)) {
      setPageMenuId(null);
    }
  };

  const addVerticalSegment = (aspectRatio: VerticalSegmentAspectRatio) => {
    setVerticalSegmentMenuPosition(null);
    const pageIndex = state.fixture.working.document.units.length;
    if (commitCapability("create_vertical_segment", { aspectRatio }, uiCopy.workbench.operation.addVerticalSegment(aspectRatio), pageIndex)) setSelection(noSelection);
  };

  const openVerticalSegmentMenu = (button: HTMLButtonElement) => {
    if (verticalSegmentMenuPosition) {
      setVerticalSegmentMenuPosition(null);
      return;
    }
    closeFloatingMenus("vertical_segment");
    const rect = button.getBoundingClientRect();
    const width = 224;
    const height = 176;
    setVerticalSegmentMenuPosition({
      left: clampValue(rect.right + 10, 12, Math.max(12, window.innerWidth - width - 12)),
      top: clampValue(rect.top - 10, 12, Math.max(12, window.innerHeight - height - 12)),
    });
  };

  const currentPages = workingPages;
  const activePageMenu = currentPages.find((comicPage) => comicPage.id === pageMenuId);
  const activePageMenuIndex = activePageMenu ? currentPages.findIndex((comicPage) => comicPage.id === activePageMenu.id) : -1;
  const activePageMenuUnit = activePageMenu ? state.fixture.working.document.units.find((unit) => unit.id === activePageMenu.id) : undefined;
  const activePageMenuNextUnit = activePageMenuIndex >= 0 ? state.fixture.working.document.units.find((unit) => unit.id === currentPages[activePageMenuIndex + 1]?.id) : undefined;
  const activePageEditorPage = currentPages.find((comicPage) => comicPage.id === pageEditor?.unitId);
  const activePageEditorUnit = state.fixture.working.document.units.find((unit) => unit.id === pageEditor?.unitId);
  const activePageEditorIndex = activePageEditorPage ? currentPages.findIndex((comicPage) => comicPage.id === activePageEditorPage.id) : -1;
  const pageEditTargetHeight = activePageEditorUnit?.kind === "vertical_segment"
    ? verticalSegmentHeight(activePageEditorUnit.canvas.width, pageEditDraft.aspectRatio)
    : undefined;
  const pageEditError = pageEditDraft.aspectRatioChanged && activePageEditorUnit?.kind === "vertical_segment" && pageEditTargetHeight !== undefined
    && activePageEditorUnit.frames.some((frame) => frame.geometry.y + frame.geometry.height > pageEditTargetHeight)
    ? uiCopy.workbench.pageFlow.ratioWouldCrop
    : "";

  const openPageMenu = (button: HTMLButtonElement, unitId: string) => {
    const workbench = button.closest<HTMLElement>(".workbench");
    const buttonRect = button.getBoundingClientRect();
    const workbenchRect = workbench?.getBoundingClientRect();
    setPageMenuPosition({
      x: buttonRect.right - (workbenchRect?.left ?? 0) + 12,
      y: clampValue(buttonRect.top - (workbenchRect?.top ?? 0) - 4, 12, window.innerHeight - 100),
    });
    closeFloatingMenus("page");
    setPageMenuId((current) => current === unitId ? null : unitId);
  };

  const openPageEditor = (comicPage: ComicPage, mode: PageEditorMode) => {
    const unit = state.fixture.working.document.units.find((item) => item.id === comicPage.id);
    if (!unit) return;
    setPageEditDraft({
      name: unit.name ?? "",
      aspectRatio: unit.kind === "vertical_segment" ? closestVerticalSegmentRatio(unit.canvas.width, unit.canvas.height) : "9:16",
      aspectRatioChanged: false,
    });
    setPageMenuPosition((position) => position ? {
      ...position,
      y: clampValue(position.y, 12, Math.max(12, window.innerHeight - (unit.kind === "vertical_segment" && mode === "edit" ? 270 : 210))),
    } : position);
    setPageEditor({ unitId: unit.id, mode });
    setPageMenuId(null);
  };

  const savePageEditor = () => {
    if (!activePageEditorUnit || !activePageEditorPage || pageEditError) {
      if (pageEditError) setToast(pageEditError);
      return;
    }
    const input = {
      unitId: activePageEditorUnit.id,
      name: pageEditDraft.name,
      ...(activePageEditorUnit.kind === "vertical_segment" && activePageEditorUnit.surfaces.length === 1 && pageEditDraft.aspectRatioChanged ? { aspectRatio: pageEditDraft.aspectRatio } : {}),
    };
    if (commitCapability("update_presentation_unit", input, uiCopy.workbench.operation.editUnit(activePageEditorPage.name || defaultComicPageName(activePageEditorPage, activePageEditorIndex)), activePageEditorIndex)) {
      setPageEditor(null);
    }
  };

  const deletePage = () => {
    if (!activePageEditorPage || activePageEditorIndex < 0) return;
    const nextPageIndex = Math.min(activePageEditorIndex, currentPages.length - 2);
    if (commitPageFlowStructureChange("delete_presentation_unit", { unitId: activePageEditorPage.id }, uiCopy.workbench.operation.deleteUnit(activePageEditorPage.name || defaultComicPageName(activePageEditorPage, activePageEditorIndex)), nextPageIndex)) {
      setSelection(noSelection);
      setPageEditor(null);
    }
  };

  const confirmPageStructureChange = () => {
    if (!pageStructureConfirm) return;
    const index = currentPages.findIndex((item) => item.id === pageStructureConfirm.unitId);
    const unit = state.fixture.working.document.units.find((item) => item.id === pageStructureConfirm.unitId);
    const nextUnitId = currentPages[index + 1]?.id;
    if (!unit || index < 0) return;
    try {
      const request: EditorCapabilityRequest = pageStructureConfirm.action === "merge_pages"
        ? { id: "merge_pages_to_spread", input: { unitId: unit.id, nextUnitId } }
        : pageStructureConfirm.action === "split_spread"
          ? { id: "split_spread_to_pages", input: { unitId: unit.id } }
          : pageStructureConfirm.action === "merge_segments"
            ? { id: "merge_vertical_segments", input: { unitId: unit.id, nextUnitId } }
            : { id: "split_vertical_segments", input: { unitId: unit.id } };
      const plan = planCapabilities([request]);
      const firstAdded = plan.commands.find((command) => command.type === "add_presentation_unit");
      const label = pageStructureConfirm.action === "merge_pages" ? uiCopy.workbench.operation.mergeSpread : pageStructureConfirm.action === "split_spread" ? uiCopy.workbench.operation.splitSpread : pageStructureConfirm.action === "merge_segments" ? uiCopy.workbench.operation.mergeSegments : uiCopy.workbench.action.splitSegment;
      setPageStructureConfirm(null);
      const shouldPulsePageFlow = pageStructureConfirm.action === "merge_pages" && pageDisplayMode === "spread";
      pageFlowPulseArmedRef.current = shouldPulsePageFlow;
      const committed = commitOperations(plan.commands, label, "manual", undefined, index, () => {
        if (firstAdded?.type === "add_presentation_unit") setSelection({ type: "presentation_unit", id: firstAdded.unit.id, pageId: firstAdded.unit.id, label });
      });
      if (!committed) pageFlowPulseArmedRef.current = false;
    } catch (error) {
      setToast(error instanceof Error ? error.message : uiCopy.toast.workbench.layout.pageStructureFailed);
      setPageStructureConfirm(null);
    }
  };

  const displayGroups = pageDisplayGroups(canvasDocument, pageDisplayMode);
  const currentDisplayGroup = displayGroupForUnit(displayGroups, state.currentPageIndex);
  const currentDisplayGroupIndex = Math.max(0, displayGroups.indexOf(currentDisplayGroup));
  const displayedPageIndices = isVerticalCanvas
    ? canvasDocument.reading.unitOrder.map((_, index) => index)
    : currentDisplayGroup?.unitIndices ?? [state.currentPageIndex].filter((index) => index < currentPages.length);
  const showingSpread = !isVerticalCanvas && (Boolean(currentDisplayGroup?.trueSpread) || displayedPageIndices.length === 2);
  const pageCanvasAspect = displayedPageIndices.reduce((aspect, index) => {
    const unit = canvasUnits[index];
    return aspect + (unit && unit.canvas.height > 0 ? unit.canvas.width / unit.canvas.height : 0);
  }, 0);
  const crossPageSnapFrames = (pageIndex: number): Array<{ id: string; geometry: Geometry }> => {
    if (displayedPageIndices.length !== 2) return [];
    const currentUnit = canvasUnits[pageIndex];
    const currentPosition = displayedPageIndices.indexOf(pageIndex);
    if (!currentUnit || currentPosition < 0) return [];
    return displayedPageIndices.flatMap((otherPageIndex, otherPosition) => {
      if (otherPageIndex === pageIndex) return [];
      const otherUnit = canvasUnits[otherPageIndex];
      if (!otherUnit) return [];
      const scale = currentUnit.canvas.width / otherUnit.canvas.width;
      const horizontalOffset = otherPosition < currentPosition ? -currentUnit.canvas.width : currentUnit.canvas.width;
      return otherUnit.frames.map((frame) => ({
        id: `${otherUnit.id}:${frame.id}`,
        geometry: {
          ...frame.geometry,
          x: horizontalOffset + frame.geometry.x * scale,
          y: frame.geometry.y * scale,
          width: frame.geometry.width * scale,
          height: frame.geometry.height * scale,
        },
      }));
    });
  };
  const displayedPhysicalNumbers = displayedPageIndices.flatMap((index) => {
    const unit = canvasUnits[index];
    return unit ? orderedUnitSurfaces(unit, canvasDocument.reading.direction).map((surface) => surface.pageNumber).filter((number): number is number => typeof number === "number") : [];
  });
  const setCurrentComicPage = (index: number) => {
    if (frameImageCandidatePreview) cancelFrameImageCandidatePreview();
    const nextPageIndex = clampValue(index, 0, Math.max(0, state.fixture.working.document.units.length - 1));
    if (nextPageIndex !== state.currentPageIndex) {
      setSelection(noSelection);
      setInspectorOpen(false);
      setObjectInteractionMode("select");
    }
    setState((current) => ({ ...current, currentPageIndex: nextPageIndex }));
  };
  const turnCanvasPage = (direction: -1 | 1) => {
    const nextPageIndex = displayGroups[currentDisplayGroupIndex + direction]?.unitIndices[0];
    if (nextPageIndex === undefined) {
      setToast(direction < 0 ? uiCopy.toast.common.firstPage : uiCopy.toast.common.lastPage);
      return;
    }
    closeFloatingMenus();
    setSelection(noSelection);
    setInspectorOpen(false);
    setCurrentComicPage(nextPageIndex);
  };
  const togglePageDisplayMode = () => {
    const next = pageDisplayMode === "single" ? "spread" : "single";
    setPageDisplayMode(next);
    setState((current) => ({ ...current, workspaceSettings: { ...current.workspaceSettings, pageDisplayMode: next } }));
    if (runtimeAdapter === "server" && runtimeIds) {
      workspaceSettingsCommitQueueRef.current = workspaceSettingsCommitQueueRef.current
        .then(() => apiUpdateProjectWorkspaceSettings(runtimeIds.projectId, { pageDisplayMode: next }))
        .then(() => undefined)
        .catch((error) => {
          setToast(error instanceof Error ? error.message : uiCopy.toast.workbench.draft.invalidCapabilityInput);
        });
    }
  };
  const handleCanvasSelection = (next: Selection) => {
    if (multiSelection) return;
    setSelectedAssetId(null);
    const selectedPageIndex = next.pageId ? workingPages.findIndex((item) => item.id === next.pageId) : -1;
    if (selectedPageIndex >= 0 && selectedPageIndex !== state.currentPageIndex) setCurrentComicPage(selectedPageIndex);
    setSelection(next);
    setEditingStoryboardBeatId(null);
    setEditingStoryboardTarget(null);
    setInspectorOpen(false);
    const element = workingPages.find((item) => item.id === next.pageId)?.elements.find((item) => item.id === next.id);
    setScope(next.type === "presentation_unit" ? uiCopy.workbench.scope.currentPage : next.type === "reference_card" ? uiCopy.workbench.scope.imageOnly : next.type === "comic_frame" ? uiCopy.workbench.scope.comicFrame : next.type === "image" ? uiCopy.workbench.scope.frameImageCrop : next.type === "speech_balloon" ? uiCopy.workbench.scope.balloon : next.type === "text" ? uiCopy.workbench.scope.narration : uiCopy.workbench.scope.currentFrame);
    if (element?.linkedStoryboardBeatId) setEditDraft({});
  };
  const canvasReferences = state.fixture.references.filter(isCanvasReference);
  const selectedReference = selection.type === "reference_card"
    ? state.fixture.references.find((item) => item.id === selection.id)
    : undefined;
  const highlightedAssetId = selection.type === "reference_card"
    ? selectedReference?.assetId ?? selectedReference?.localAssetId ?? null
    : selection.type === "none"
      ? selectedAssetId
      : null;
  // The sidebar is the asset library. Canvas objects are merely placements
  // linking back to these assets, so removing one never removes its row here.
  const canvasAssetLibrary = [...(state.assets ?? [])].sort((left, right) => {
    if (Boolean(left.pinned) !== Boolean(right.pinned)) return left.pinned ? -1 : 1;
    if ((left.sortIndex ?? 0) !== (right.sortIndex ?? 0)) return (left.sortIndex ?? 0) - (right.sortIndex ?? 0);
    const leftIndex = assetListOrder.indexOf(left.id);
    const rightIndex = assetListOrder.indexOf(right.id);
    return (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex);
  });
  const frameImagePickerSelection = frameImageTarget ? frameAndImageForSelection(frameImageTarget.selection) : undefined;
  const frameImageChoices = buildFrameImageChoices({
    assets: canvasAssetLibrary,
    canvasImages: canvasReferences,
    resources: state.fixture.working.document.resources,
    resolvedResources: state.fixture.working.resolvedResources,
    currentPage: frameImageTarget?.selection.pageId ? workingPages.find((candidate) => candidate.id === frameImageTarget.selection.pageId) : undefined,
    includeCurrentPageImages: !frameImageTarget?.placement && Boolean(frameImagePickerSelection?.frame || frameImagePickerSelection?.image?.location.space === "frame"),
  });

  const activeAssetMenu = canvasAssetLibrary.find((asset) => asset.id === assetMenuId);
  const activeAssetPlacement = activeAssetMenu
    ? canvasReferences.find((reference) => reference.assetId === activeAssetMenu.id)
    : undefined;
  const handleActiveAssetPlacement = () => {
    if (!activeAssetMenu) return;
    if (activeAssetPlacement) {
      setSelectedAssetId(activeAssetMenu.id);
      setSelection({ type: "reference_card", id: activeAssetPlacement.id, label: activeAssetMenu.name });
      setCreationSpaceOpen(false);
    } else {
      void placeLibraryAssetOnCanvas(activeAssetMenu);
    }
    setAssetMenuId(null);
  };
  const activeAssetSave = canvasAssetLibrary.find((asset) => asset.id === assetSaveFormId);
  const activeStoryboardRow = storyboardFrameRows.find((row) => row.frame.id === storyboardMenuFrameId);
  const previewDisabled = currentPages.length === 0 || !state.fixture.snapshot || modeSwitching;
  const previewTitle = !state.fixture.snapshot ? uiCopy.workbench.toolbar.previewDisabledTitle : undefined;
  const goToPreview = () => {
    if (previewDisabled) return;
    setProjectMenu(false);
    setDockEntering(false);
    setModeSwitching(true);
    prepareContentRouteEntry("forward");
    window.setTimeout(() => router.push(previewRoute), modeSwitchMotionDelay());
  };
  const toolbarStyle: CSSProperties | undefined = toolbarPlacement ? { left: toolbarPlacement.x, top: toolbarPlacement.y } : undefined;
  const viewportWidth = typeof window === "undefined" ? 1440 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 900 : window.innerHeight;
  const contextTargetElement = comicContextMenu ? elementForSelection(comicContextMenu.target) : undefined;
  const contextTargetFrameData = comicContextMenu ? frameAndImageForSelection(comicContextMenu.target) : undefined;
  const contextTargetPageIndex = comicContextMenu?.target.pageId ? workingPages.findIndex((candidate) => candidate.id === comicContextMenu.target.pageId) : -1;
  const contextTargetPage = contextTargetPageIndex >= 0 ? workingPages[contextTargetPageIndex] : undefined;
  const contextTargetUnit = comicContextMenu?.target.pageId ? state.fixture.working.document.units.find((unit) => unit.id === comicContextMenu.target.pageId) : undefined;
  const objectLocationLabel = (element?: CanvasElement) => !element
    ? undefined
    : element.type === "text"
      ? undefined
    : element.type === "comic_frame"
      ? element.surfaceScope === "unit" ? uiCopy.workbench.object.crossPage : undefined
    : element.location.space === "frame"
      ? uiCopy.workbench.object.insideFrame
      : element.location.purpose === "cross_page"
        ? uiCopy.workbench.object.crossPage
        : element.location.purpose === "cross_segment"
          ? uiCopy.workbench.object.crossSegment
      : element.location.anchor.type === "frame"
        ? uiCopy.workbench.object.breakout
        : uiCopy.workbench.object.paper;
  const contextObjectNumber = (elements: CanvasElement[], id?: string) => String(Math.max(1, elements.findIndex((element) => element.id === id) + 1)).padStart(2, "0");
  const comicContextHeader = (() => {
    if (!comicContextMenu) return { icon: "layout" as IconName, label: uiCopy.workbench.defaultLabel.object };
    const target = comicContextMenu.target;
    if (target.type === "presentation_unit") return {
      icon: (contextTargetPage?.kind === "vertical_segment" ? "pages" : "pageSingle") as IconName,
      label: contextTargetUnit ? presentationUnitNumberLabel(contextTargetUnit, contextTargetPageIndex) : contextTargetPage?.kind === "vertical_segment" ? uiCopy.workbench.label.segment(String(Math.max(1, contextTargetPageIndex + 1)).padStart(2, "0")) : uiCopy.workbench.label.page(String(Math.max(1, contextTargetPageIndex + 1)).padStart(2, "0")),
    };
    if (target.type === "comic_frame") return {
      icon: "layout" as IconName,
      label: `${contextTargetFrameData?.frame?.surfaceScope === "unit" ? uiCopy.workbench.object.crossPageFrame : uiCopy.workbench.object.frame} ${String(contextTargetFrameData?.frame?.readingOrder ?? 1).padStart(2, "0")}`,
    };
    if (target.type === "image") {
      const frameId = contextTargetElement?.type === "image" ? contextTargetElement.comicFrameId : undefined;
      const isOverlayImage = contextTargetElement?.type === "image" && contextTargetElement.location.space === "overlay";
      const overlayPurpose = contextTargetElement?.type === "image" && contextTargetElement.location.space === "overlay" ? contextTargetElement.location.purpose : undefined;
      const siblingImages = contextTargetPage?.elements.filter((element) => element.type === "image" && (isOverlayImage ? element.location.space === "overlay" && element.location.purpose === overlayPurpose : element.comicFrameId === frameId && element.location.space === "frame")) ?? [];
      const imageLabel = overlayPurpose === "cross_page" ? uiCopy.workbench.object.crossPageImage : overlayPurpose === "cross_segment" ? uiCopy.workbench.object.crossSegmentImage : isOverlayImage ? uiCopy.workbench.object.image : uiCopy.asset.image.primary;
      return { icon: "asset" as IconName, label: `${imageLabel} ${contextObjectNumber(siblingImages, target.id)}` };
    }
    if (target.type === "speech_balloon") {
      const isCrossPage = contextTargetElement?.type === "speech_balloon" && contextTargetElement.location.space === "overlay" && contextTargetElement.location.purpose === "cross_page";
      const siblingBalloons = contextTargetPage?.elements.filter((element) => element.type === "speech_balloon" && (isCrossPage ? element.location.space === "overlay" && element.location.purpose === "cross_page" : !(element.location.space === "overlay" && element.location.purpose === "cross_page"))) ?? [];
      const balloonLabel = isCrossPage ? uiCopy.workbench.object.crossPageBalloon : uiCopy.workbench.object.dialogue;
      return { icon: "message" as IconName, label: `${balloonLabel} ${contextObjectNumber(siblingBalloons, target.id)}` };
    }
    if (target.type === "text") {
      const siblingNarrations = contextTargetPage?.elements.filter((element) => element.type === "text" && element.content.role === "narration") ?? [];
      return { icon: "text" as IconName, label: uiCopy.workbench.label.narration(contextObjectNumber(siblingNarrations, target.id)) };
    }
    return { icon: "layout" as IconName, label: target.label };
  })();
  const contextImagePurpose = contextTargetElement?.type === "image" && contextTargetElement.location.space === "overlay" ? contextTargetElement.location.purpose : undefined;
  const contextImageIsPaperOwned = contextTargetElement?.type === "image" && contextTargetElement.location.space === "overlay" && contextTargetElement.location.anchor.type === "unit";
  const contextImageAlreadyInAssetList = contextTargetElement?.type === "image" && Boolean(state.assets?.some((asset) => asset.id === contextTargetElement.assetId));
  const contextBalloonPurpose = contextTargetElement?.type === "speech_balloon" && contextTargetElement.location.space === "overlay" ? contextTargetElement.location.purpose : undefined;
  const contextImageReplaceLabel = contextTargetElement?.type === "image"
    ? uiCopy.workbench.action.replaceFrameImage
    : uiCopy.asset.action.changeImage;
  const comicContextMenuStyle: CSSProperties | undefined = comicContextMenu ? (() => {
    const width = 196;
    const height = 390;
    const gap = 8;
    return {
      left: comicContextMenu.point.clientX + gap + width <= viewportWidth - 12
        ? comicContextMenu.point.clientX + gap
        : Math.max(12, comicContextMenu.point.clientX - width - gap),
      top: comicContextMenu.point.clientY + gap + height <= viewportHeight - 12
        ? comicContextMenu.point.clientY + gap
        : Math.max(12, comicContextMenu.point.clientY - height - gap),
    };
  })() : undefined;
  const frameImagePickerStyle: CSSProperties | undefined = frameImageTarget ? {
    left: clampValue(frameImageTarget.left, 12, Math.max(12, viewportWidth - 330)),
    top: clampValue(frameImageTarget.top, 12, Math.max(12, viewportHeight - 390)),
  } : undefined;
  const comicDeleteSelection = comicDeleteTarget?.selection;
  const comicDeleteData = comicDeleteSelection ? frameAndImageForSelection(comicDeleteSelection) : undefined;
  const comicDeleteElementCount = comicDeleteTarget?.kind === "frame"
    ? comicDeleteData?.comicPage?.elements.filter((element) => element.type !== "comic_frame" && element.comicFrameId === comicDeleteData.frame?.id).length ?? 0
    : 0;
  const comicDeleteTitle = comicDeleteTarget?.kind === "image"
    ? uiCopy.workbench.dialog.removeTitle(comicDeleteSelection?.label ?? "")
    : uiCopy.workbench.dialog.deleteTitle(comicDeleteSelection?.label ?? "");
  const comicDeleteLocation = comicDeleteSelection ? objectLocationLabel(elementForSelection(comicDeleteSelection)) : undefined;
  const comicDeleteDescription = comicDeleteTarget?.kind === "frame"
    ? comicDeleteElementCount
      ? uiCopy.workbench.dialog.frameDeleteDescription(comicDeleteElementCount)
      : uiCopy.workbench.dialog.emptyFrameDeleteDescription
    : comicDeleteTarget?.kind === "image"
      ? uiCopy.workbench.dialog.imageDeleteDescription(comicDeleteLocation === uiCopy.workbench.object.crossPage ? "cross_page" : comicDeleteLocation === uiCopy.workbench.object.crossSegment ? "cross_segment" : comicDeleteLocation === uiCopy.workbench.object.paper ? "paper" : "frame")
      : comicDeleteTarget?.kind === "narration"
        ? uiCopy.workbench.dialog.narrationDeleteDescription
      : uiCopy.workbench.dialog.balloonDeleteDescription(comicDeleteLocation === uiCopy.workbench.object.paper ? uiCopy.workbench.object.paper : uiCopy.workbench.object.frame);
  const confirmComicDelete = () => {
    if (!comicDeleteTarget) return;
    if (comicDeleteTarget.kind === "frame") deleteFrame(comicDeleteTarget.selection);
    else if (comicDeleteTarget.kind === "image") removeFrameImage(comicDeleteTarget.selection);
    else if (comicDeleteTarget.kind === "narration") deleteNarration(comicDeleteTarget.selection);
    else deleteDialogueBalloon(comicDeleteTarget.selection);
  };
  const editingStoryboardBeat = editingStoryboardBeatId ? state.fixture.storyboardBeats.find((beat) => beat.id === editingStoryboardBeatId) : undefined;
  const editingStoryboardFrame = editingStoryboardTarget
    ? workingPages.find((page) => page.id === editingStoryboardTarget.unitId)?.elements.find((element): element is ComicFrameElement => element.type === "comic_frame" && element.id === editingStoryboardTarget.frameId)
    : undefined;
  const editorStyle: CSSProperties | undefined = editingStoryboardTarget && toolbarPlacement
    ? { left: toolbarPlacement.x, top: toolbarPlacement.y, right: "auto", bottom: "auto" }
    : undefined;
  const canvasWorldStyle: CSSProperties = { transform: `translate(${canvasOffset.x}px, ${canvasOffset.y}px) scale(${canvasScale})` };
  const pageCanvasFitWidth = pageCanvasAspect > 0 && pageCanvasFitSize.width > 0 && pageCanvasFitSize.height > 0
    ? Math.min(pageCanvasFitSize.width, pageCanvasFitSize.height * pageCanvasAspect)
    : undefined;
  const pageCanvasStageStyle = pageCanvasFitWidth
    ? { maxWidth: `${pageCanvasFitWidth}px` }
    : undefined;
  const baseVerticalPageDisplayWidth = stageSize.width ? Math.min(430, stageSize.width * .56) : 430;
  const verticalPageDisplayWidth = fitVerticalViewportWidth(baseVerticalPageDisplayWidth, Math.max(240, stageSize.height - 144), verticalViewportMode);
  const activeVerticalViewport = verticalViewportMode === "off" ? undefined : verticalViewportModeMeta[verticalViewportMode];
  const verticalStageWrapStyle: CSSProperties | undefined = isVerticalCanvas ? { width: verticalPageDisplayWidth + 40 } : undefined;
  const verticalViewportStyle: CSSProperties | undefined = activeVerticalViewport
    ? { width: verticalPageDisplayWidth, aspectRatio: `${activeVerticalViewport.width} / ${activeVerticalViewport.height}` }
    : undefined;
  const firstVerticalUnit = isVerticalCanvas ? canvasUnits[0] : undefined;
  const lastVerticalUnit = isVerticalCanvas ? canvasUnits.at(-1) : undefined;
  const verticalStripViewportHeight = stageSize.height || 720;
  const firstVerticalDisplayHeight = firstVerticalUnit ? verticalPageDisplayWidth * firstVerticalUnit.canvas.height / firstVerticalUnit.canvas.width : 0;
  const lastVerticalDisplayHeight = lastVerticalUnit ? verticalPageDisplayWidth * lastVerticalUnit.canvas.height / lastVerticalUnit.canvas.width : 0;
  const verticalStripTopSpace = Math.max(clampValue(verticalStripViewportHeight * .1, 72, 104), (verticalStripViewportHeight - firstVerticalDisplayHeight) / 2);
  const verticalStripBottomSpace = Math.max(clampValue(verticalStripViewportHeight * .12, 92, 124), (verticalStripViewportHeight - lastVerticalDisplayHeight) / 2);
  const verticalStripStyle = isVerticalCanvas ? {
    "--vertical-strip-top-space": `${verticalStripTopSpace}px`,
    "--vertical-strip-bottom-space": `${verticalStripBottomSpace}px`,
  } as CSSProperties : undefined;
  const verticalNavigatorPaperSize = fitVerticalNavigatorPaper(
    canvasUnits[0]?.canvas.width ?? 0,
    canvasUnits.reduce((height, unit) => height + unit.canvas.height, 0),
  );
  const verticalNavigatorPaperStyle: CSSProperties = {
    width: verticalNavigatorPaperSize.width,
    height: verticalNavigatorPaperSize.height,
  };
  const verticalViewportLabel = activeVerticalViewport ? uiCopy.workbench.label.viewport(activeVerticalViewport.label) : uiCopy.viewport.disabled;
  const activeMultiComicIds = new Set(multiSelection?.comicActive ? multiSelection.comic.flatMap((item) => item.id ? [item.id] : []) : []);
  const activeMultiCanvasIds = new Set(multiSelection?.canvasActive ? multiSelection.canvasIds : []);
  const multiComicActive = Boolean(multiSelection?.comicActive && multiSelection.comic.length);
  const multiCanvasActive = Boolean(multiSelection?.canvasActive && multiSelection.canvasIds.length);
  const multiMoveEnabled = Number(multiComicActive) + Number(multiCanvasActive) === 1;
  const multiMoving = Boolean(multiMoveDelta.x || multiMoveDelta.y);
  const marqueeStyle: CSSProperties | undefined = marquee ? {
    left: Math.min(marquee.startX, marquee.currentX),
    top: Math.min(marquee.startY, marquee.currentY),
    width: Math.abs(marquee.currentX - marquee.startX),
    height: Math.abs(marquee.currentY - marquee.startY),
  } : undefined;

  const toggleMultiGroup = (group: "comic" | "canvas") => {
    setMultiSelection((current) => {
      if (!current) return current;
      if ((group === "comic" && !current.comic.length) || (group === "canvas" && !current.canvasIds.length)) return current;
      return {
        ...current,
        comicActive: group === "comic" ? !current.comicActive : current.comicActive,
        canvasActive: group === "canvas" ? !current.canvasActive : current.canvasActive,
        moveActive: false,
      };
    });
    setMultiMoveDelta({ x: 0, y: 0 });
  };

  const addMultiSelectionToDialogue = () => {
    if (!multiSelection) return;
    if (multiSelection.comicActive) multiSelection.comic.forEach((item) => addSelectionReference(item));
    if (multiSelection.canvasActive) multiSelection.canvasIds.forEach((id) => {
      const reference = canvasReferences.find((item) => item.id === id);
      if (reference) addCanvasAssetReference(reference);
    });
    openAgentWorkspace();
  };

  const removeMultiCanvasElements = () => {
    if (!multiSelection?.canvasActive || multiSelection.comicActive || !multiSelection.canvasIds.length) return;
    removeReferences(multiSelection.canvasIds);
    setMultiSelection((current) => {
      if (!current) return current;
      const next = { ...current, canvasIds: [], canvasActive: false, moveActive: false };
      return next.comic.length ? next : null;
    });
  };

  const resolveAgentCard = (messageId: string) => {
    setResolvedCardIds((current) => new Set(current).add(messageId));
    if (runtimeAdapter === "server") {
      void apiResolveAgentMessage(messageId).catch((error) => setToast(error instanceof Error ? error.message : uiCopy.toast.workbench.message.cardStateSaveFailed));
    }
  };

  const retryAgentTask = (message: AgentMessage) => {
    if (runtimeAdapter === "server" && message.taskId) {
      setResolvedCardIds((current) => new Set(current).add(message.id));
      void apiRetryTask(message.taskId).then(() => {
        setResolvedCardIds((current) => { const next = new Set(current); next.delete(message.id); return next; });
        return refreshServerWorkbench();
      }).catch((error) => {
        setResolvedCardIds((current) => { const next = new Set(current); next.delete(message.id); return next; });
        setToast(error instanceof Error ? error.message : uiCopy.toast.common.retryFailed);
      });
      return;
    }
    if (runtimeAdapter === "server") {
      setResolvedCardIds((current) => new Set(current).add(message.id));
      void apiRetryAgentInteraction(message.id).then(() => {
        setResolvedCardIds((current) => { const next = new Set(current); next.delete(message.id); return next; });
        return refreshServerWorkbench();
      }).catch((error) => {
        setResolvedCardIds((current) => { const next = new Set(current); next.delete(message.id); return next; });
        void refreshServerWorkbench().catch(() => undefined);
        setToast(error instanceof Error ? error.message : uiCopy.toast.common.retryFailed);
      });
      return;
    }
    runTask(message.taskName ?? "failure", undefined, message.instruction);
  };

  const renderAgentMessageContent = (message: AgentMessage, candidate: Candidate | undefined, resolved: boolean) => {
    if (resolved && message.kind === "failed") return null;
    if (message.kind === "task") {
      const runningHere = activeTask?.status === "running" && (!message.taskId || message.taskId === activeTask.id);
      const stageLabel = activeTask?.stage === "preparing" ? uiCopy.workbench.taskStage.preparing : activeTask?.stage === "queued" ? uiCopy.workbench.taskStage.queued : activeTask?.stage === "validating" ? uiCopy.workbench.taskStage.validating : activeTask?.stage === "saving" ? uiCopy.workbench.taskStage.saving : uiCopy.workbench.taskStage.generating;
      return runningHere ? <div className="task-message"><i className="spinner"/><span><strong>{activeTask.label}</strong><small>{stageLabel}</small></span><button type="button" className="task-cancel-trigger" aria-label={uiCopy.workbench.task.cancelAria} onClick={() => setTaskCancelConfirmOpen(true)}><Icon name="x" /></button></div> : <div className="muted-card">{message.text}</div>;
    }
    if (message.kind === "failed") return <div className="failed-card"><strong>{uiCopy.workbench.task.failed}</strong><p>{message.text}</p><div className="card-actions failed-card-actions"><button type="button" className="failed-retry" onClick={() => retryAgentTask(message)}>{uiCopy.common.action.retry}</button><button type="button" className="failed-close" onClick={() => resolveAgentCard(message.id)}>{uiCopy.common.action.close}</button></div></div>;
    if (message.kind === "canceled") return <div className="muted-card">{message.text}</div>;
    if (message.kind === "question") return <div className="agent-inline-question"><p>{message.text}</p>{!resolved && message.options?.length ? <div>{message.options.map((option) => <button type="button" key={option} onClick={() => { resolveAgentCard(message.id); setComposer(option); }}>{option}</button>)}</div> : null}</div>;
    if (message.kind === "candidate" && candidate) {
      const isAsset = candidate.kind === "asset";
      const isStoryboard = candidate.kind === "storyboard";
      const isFrameImage = candidate.kind === "frame_image";
      if (candidate.kind === "storyboard" && !candidate.metadata?.storyboardMode) return null;
      const frameImageTarget = isFrameImage ? frameImageCandidateTarget(candidate) : undefined;
      const frameImagePageIndex = resolveReadingUnitIndex(state.fixture.working.document, frameImageTarget?.pageId);
      const frameImageUnit = frameImageTarget?.pageId
        ? state.fixture.working.document.units.find((unit) => unit.id === frameImageTarget.pageId)
        : undefined;
      const frameImagePageLabel = frameImageUnit ? presentationUnitNumberLabel(frameImageUnit, frameImagePageIndex) : undefined;
      const frameImageTargetLabel = frameImagePageLabel && !candidate.targetLabel.includes(frameImagePageLabel)
        ? `${frameImagePageLabel} · ${candidate.targetLabel}`
        : candidate.targetLabel;
      const candidateCardTitle = isStoryboard
        ? uiCopy.workbench.candidate.editStoryboard(candidate.targetLabel)
        : isFrameImage && frameImagePageLabel
          ? `${candidate.title.split("·")[0].trim()} · ${frameImageTargetLabel}`
          : candidate.title;
      const terminalCandidate = candidate.status !== "available";
      const terminalStartsCollapsed = candidate.status === "discarded" || candidate.status === "stale";
      const terminalExpanded = expandedTerminalCandidateIds.has(candidate.id);
      const terminalCollapsed = terminalCandidate && (terminalStartsCollapsed ? !terminalExpanded : collapsedTerminalCandidateIds.has(candidate.id));
      const toggleTerminalCandidate = () => setExpandedTerminalCandidateIds((current) => {
        const next = new Set(current);
        if (next.has(candidate.id)) next.delete(candidate.id);
        else next.add(candidate.id);
        return next;
      });
      const toggleCollapsedTerminalCandidate = () => setCollapsedTerminalCandidateIds((current) => {
        const next = new Set(current);
        if (next.has(candidate.id)) next.delete(candidate.id);
        else next.add(candidate.id);
        return next;
      });
      const openSavedAsset = candidate.metadata?.outputAssetId
        ? () => navigate(`/comics/${comicId}/assets?from=workbench&chapterId=${chapterId}&asset=${encodeURIComponent(candidate.metadata?.outputAssetId ?? "")}`)
        : undefined;
      const candidateStatusLabel = candidate.status === "available"
        ? isStoryboard ? uiCopy.workbench.candidate.pending : candidate.targetLabel
        : candidate.status === "applied" && isAsset
          ? uiCopy.workbench.candidate.saved
          : candidate.status === "applied"
            ? uiCopy.workbench.candidate.applied
            : candidate.status === "reverted"
              ? uiCopy.workbench.candidate.reverted
              : candidate.status === "stale"
                ? uiCopy.workbench.candidate.expired
                : uiCopy.workbench.candidate.discarded;
      const toggleTerminal = terminalStartsCollapsed ? toggleTerminalCandidate : toggleCollapsedTerminalCandidate;
      const showSavedAssetView = isAsset && candidate.status === "applied" && openSavedAsset;
      return <div className={`candidate-card ${candidate.status} ${terminalCollapsed ? "terminal-collapsed compact" : ""}`}>
        <div className="candidate-title"><strong>{candidateCardTitle}</strong><span>{candidateStatusLabel}</span></div>
        {!terminalCollapsed && (candidate.metadata?.previewUrl || candidate.metadata?.imageSrc) ? <button type="button" className="candidate-result-preview-button" aria-label={uiCopy.workbench.aria.candidateImage(candidate.title)} onClick={() => setImageViewer({ images: [{ id: candidate.id, src: candidate.metadata?.previewUrl ?? candidate.metadata?.imageSrc ?? "", alt: uiCopy.workbench.aria.candidatePreview(candidate.title) }] })}><img className="candidate-result-preview" src={candidate.metadata.previewUrl ?? candidate.metadata.imageSrc} alt={uiCopy.workbench.aria.candidatePreview(candidate.title)} /></button> : null}
        {!terminalCollapsed && candidate.metadata?.storyboardTitle ? <strong className="candidate-storyboard-title">{candidate.metadata.storyboardTitle}</strong> : null}
        {!terminalCollapsed && candidate.metadata?.storyboardDescription ? <p className="candidate-storyboard-description">{candidate.metadata.storyboardDescription}</p> : null}
        {!terminalCollapsed ? <p>{candidate.changeSummary}</p> : null}
        {candidate.status === "available" ? <div className="candidate-actions"><button type="button" className="candidate-primary-action" onClick={() => { if (isFrameImage) startFrameImageCandidatePreview(candidate); else if (isAsset) void applyAssetCandidate(candidate); else applyCandidate(candidate); }}>{isFrameImage ? uiCopy.common.action.preview : isAsset ? uiCopy.workbench.candidate.saveToAsset : uiCopy.workbench.candidate.apply}</button><button type="button" className="candidate-secondary-action" onClick={() => discardCandidate(candidate.id)}>{uiCopy.common.action.discard}</button></div> : terminalCandidate ? <div className="terminal-candidate-actions">{showSavedAssetView ? <button type="button" className="saved-asset-view" onClick={openSavedAsset}>{uiCopy.common.action.view}</button> : null}<button type="button" className="terminal-candidate-toggle" aria-expanded={!terminalCollapsed} onClick={toggleTerminal}>{terminalCollapsed ? uiCopy.common.action.expand : uiCopy.common.action.collapse}<Icon name={terminalCollapsed ? "chevronDown" : "chevronUp"} /></button></div> : null}
      </div>;
    }
    return <p>{message.text}</p>;
  };

  const projectSubtitle = uiCopy.workbench.navigation.projectSubtitle(workbenchMeta.comicTitle, workbenchMeta.chapterTitle, state.fixture.working.revision, runtimeAdapter === "server" || runtimeAdapter === "demo" ? runtimeAdapter : "other");
  const setCreationSpaceOpen = (open: boolean) => {
    setLeftOpen(open);
    if (!open) setProjectMenu(false);
  };

  if (hydrated && runtimeError) {
    return <main className="runtime-unavailable" role="alert"><section><span>{uiCopy.brand.api}</span><h1>{uiCopy.workbench.page.loadFailed}</h1><p>{runtimeError}</p><button type="button" onClick={() => window.location.reload()}>{uiCopy.common.action.reconnect}</button></section></main>;
  }

  if (!hydrated) {
    if (!showInitialLoading) return <main className="workbench-loading-blank" aria-busy="true" />;
    return <main className="runtime-unavailable"><section><span>{uiCopy.workbench.navigation.loadingBrand}</span><h1>{uiCopy.workbench.page.loadingDraft}</h1></section></main>;
  }

  return (
    <WorkbenchShell className={`route-page-transition ${entryTransition} mode-${canvasMode} ${leftOpen ? "left-open" : ""} ${agentOpen ? "agent-open" : ""} ${versionsOpen ? "version-open" : ""}`} data-testid="workbench" onPointerDownCapture={handleWorkbenchPointerDownCapture}>
      <div className="ambient ambient-cyan" /><div className="ambient ambient-amber" />
      <header className="project-chip" data-testid="project-chip">
        <button className="project-back app-page-corner-button" type="button" aria-label={uiCopy.workbench.navigation.backToComic} onClick={() => navigate(`/comics/${comicId}`, "back")}><Icon name="collapse" /></button>
        <button className="project-main" type="button" onClick={() => { closeFloatingMenus("project"); setProjectMenu((open) => !open); }} aria-label={uiCopy.workbench.navigation.projectMenuAria}>
          <span className="project-main-card">
            <span><strong>{uiCopy.brand.name}</strong><small className="project-subtitle" data-full-text={projectSubtitle} tabIndex={0}><span>{projectSubtitle}</span></small></span>
            <Icon name="hamburger" />
          </span>
        </button>
        {projectMenu ? (
          <div className="project-menu" role="menu">
            <button type="button" className="route-item" onClick={() => navigate("/workspace", "back")}><span className="menu-action-label"><Icon name="home" />{uiCopy.workbench.navigation.backToHome}</span></button>
            <button type="button" className="route-item" onClick={() => navigate(`/comics/${comicId}`, "back")}><span className="menu-action-label"><Icon name="comic" />{uiCopy.workbench.navigation.backToComic}</span></button>
            <button type="button" className="route-item" onClick={() => {
              setProjectMenu(false);
              navigate(`/comics/${comicId}/assets?from=workbench&chapterId=${chapterId}`);
            }}><span className="menu-action-label"><Icon name="folder" />{uiCopy.asset.navigation.space}</span></button>
            <i className="project-menu-divider" />
            <button type="button" onClick={requestSaveChapter} disabled={savingChapter}><span className="menu-action-label"><Icon name="save" />{savingChapter ? uiCopy.common.progress.savingPlain : uiCopy.common.action.save}</span></button>
            <button type="button" onClick={restoreLastSaved} disabled={!state.fixture.snapshot || state.fixture.snapshot.sourceWorkingRevision === state.fixture.working.revision || restoringSnapshot}><span className="menu-action-label"><Icon name="undo" />{uiCopy.workbench.action.returnToSaved}</span></button>
            <button type="button" onClick={goToPreview} disabled={previewDisabled} title={previewTitle}><span className="menu-action-label"><Icon name="preview" />{uiCopy.comic.action.readingPreview}</span></button>
            <i className="project-menu-divider" />
            <button type="button" disabled={importingArchive || activeTask?.status === "running"} onClick={() => archiveImportRef.current?.click()}><span className="menu-action-label"><Icon name="publish" />{importingArchive ? uiCopy.workbench.action.importingArchive : uiCopy.workbench.action.importArchive}</span></button>
            <i className="project-menu-divider" />
            <button type="button" className="context-debug-entry" onClick={openContextDebug}><span className="menu-action-label"><Icon name="context" />{uiCopy.workbench.action.viewCurrentContext}</span></button>
          </div>
        ) : null}
      </header>

      <CreationDrawer className={leftOpen ? "open" : "closed"} aria-label={uiCopy.workbench.panel.creationSpace}>
        <div className="drawer-stack">
        <div className="drawer-top-card" data-tour-id="creation-space">
        <div className="drawer-heading"><strong>{uiCopy.workbench.panel.creationSpace}</strong><button type="button" onClick={() => setCreationSpaceOpen(false)} aria-label={uiCopy.workbench.creationSpace.collapseAria}><Icon name="collapse" /></button></div>
        <nav className="drawer-tabs" aria-label={uiCopy.workbench.creationSpace.categoriesAria}>
          {([['assets', uiCopy.asset.label.asset], ['storyboard', uiCopy.workbench.creationSpace.storyboardTab]] as Array<[LeftView, string]>).map(([value, label]) => <button type="button" key={value} className={leftView === value ? "active" : ""} onClick={() => setLeftView(value)}>{label}</button>)}
        </nav>
        <div ref={creationListRef} className={`drawer-main ${leftView === "assets" ? "assets-view" : ""} ${leftView === "storyboard" ? "storyboard-view" : ""} ${creationListOverflows ? "has-scroll-overflow" : ""}`}>
        {leftView === "assets" ? <section className="drawer-view asset-reference-list">
          <div className="asset-sidebar-head"><h2><span><Icon name="asset" /></span>{uiCopy.asset.label.asset}</h2><div className="asset-sidebar-actions"><button type="button" className="asset-studio-entry" onClick={() => navigate(`/comics/${comicId}/assets?from=workbench&chapterId=${chapterId}`)}><Icon name="folder" /><span>{uiCopy.asset.navigation.space}</span></button><button type="button" className="drawer-add-page asset-upload-button" aria-label={uiCopy.workbench.creationSpace.uploadAssetAria} onClick={() => dockUploadRef.current?.click()}><Icon name="add" /></button></div></div>
          <div className="asset-reference-items">
            {canvasAssetLibrary.map((asset) => {
              const placement = canvasReferences.find((reference) => reference.assetId === asset.id);
              const thumbnail = canvasAssetThumbnail(asset);
              const kindTag = assetKindTag(asset.kind);
              const thumbnailNode = <span className="asset-row-thumbnail">{thumbnail ? <img src={thumbnail} alt="" loading="lazy" decoding="async" draggable={false} /> : <Icon name="asset" />}</span>;
              return <div className={`asset-row ${highlightedAssetId === asset.id ? "active" : ""}`} key={asset.id}>
                {assetRenameId === asset.id ? <form className="asset-row-rename" onSubmit={(event) => { event.preventDefault(); renameAssetInList(asset); }}>{thumbnailNode}<span className="asset-kind-tag">{kindTag}</span><input autoFocus value={assetRenameDraft} onChange={(event) => setAssetRenameDraft(event.target.value)} maxLength={120}/><button type="submit">{uiCopy.common.action.save}</button><button type="button" aria-label={uiCopy.workbench.creationSpace.cancelRenameAria} onClick={() => { setAssetRenameId(null); setAssetRenameDraft(""); }}><Icon name="x" /></button></form> : <><button type="button" className="asset-row-main" onClick={() => { closeFloatingMenus(); setSelectedAssetId(asset.id); setSelection(placement ? { type: "reference_card", id: placement.id, label: asset.name } : noSelection); setScope(uiCopy.workbench.scope.imageOnly); }} onDoubleClick={() => { if (!thumbnail) { setToast(uiCopy.toast.workbench.asset.imageUnavailable(asset.name)); return; } setImageViewer({ images: [{ id: asset.id, src: thumbnail, alt: asset.name }] }); }}>{thumbnailNode}<span className="asset-kind-tag">{kindTag}</span><b>{asset.name}</b></button>
                <button className="asset-more" type="button" aria-label={uiCopy.workbench.aria.assetMore(asset.name)} onClick={(event) => { const workbench = event.currentTarget.closest<HTMLElement>(".workbench"); const button = event.currentTarget.getBoundingClientRect(); const workbenchRect = workbench?.getBoundingClientRect(); closeFloatingMenus("asset"); setAssetMenuPosition({ x: button.right - (workbenchRect?.left ?? 0) + 16, y: button.top - (workbenchRect?.top ?? 0) - 4 }); setAssetMenuId((id) => id === asset.id ? null : asset.id); }}><Icon name="moreVertical" /></button></>}
              </div>;
            })}
            {!canvasAssetLibrary.length ? <p className="drawer-empty">{uiCopy.workbench.creationSpace.emptyAssets}</p> : null}
          </div>
        </section> : null}
        {leftView === "storyboard" ? <section className="drawer-view">
          <h2><span><Icon name="storyboard" /></span>{uiCopy.workbench.creationSpace.frameSectionTitle}</h2>
          <div className="storyboard-frame-list">
            {storyboardFrameRows.map((row, index) => <div className={`storyboard-frame-row ${selection.id === row.frame.id ? "active" : ""}`} key={row.frame.id}>
              <button type="button" className="storyboard-frame-main" onClick={() => {
                setCurrentComicPage(row.pageIndex);
                setSelection({ type: "comic_frame", id: row.frame.id, pageId: row.page.id, label: row.label });
                setEditingStoryboardBeatId(null);
                setEditingStoryboardTarget(null);
                setInspectorOpen(false);
                setScope(uiCopy.workbench.scope.comicFrame);
              }}>
                <b>{String(index + 1).padStart(2, "0")}</b>
                <strong>{row.beat?.title || uiCopy.workbench.creationSpace.emptyFrame}</strong>
              </button>
              <button type="button" className="storyboard-frame-more" aria-label={uiCopy.workbench.aria.assetMore(row.label)} aria-expanded={storyboardMenuFrameId === row.frame.id} onClick={(event) => {
                const workbench = event.currentTarget.closest<HTMLElement>(".workbench");
                const button = event.currentTarget.getBoundingClientRect();
                const workbenchRect = workbench?.getBoundingClientRect();
                setStoryboardMenuPosition({ x: button.right - (workbenchRect?.left ?? 0) + 12, y: button.top - (workbenchRect?.top ?? 0) - 4 });
                closeFloatingMenus("storyboard");
                setStoryboardMenuFrameId((id) => id === row.frame.id ? null : row.frame.id);
              }}><Icon name="moreVertical" /></button>
            </div>)}
            {!storyboardFrameRows.length ? <p className="drawer-empty">{uiCopy.workbench.creationSpace.emptyFrames}</p> : null}
          </div>
        </section> : null}
        </div>
        </div>
        <section className="drawer-pages-fixed" aria-label={isVerticalWorkbench ? uiCopy.comic.unit.segment : uiCopy.comic.unit.page} data-tour-id="comic-pages">
          <div className="drawer-pages-heading"><span><Icon name="pages" /></span><strong>{isVerticalWorkbench ? uiCopy.comic.unit.segment : uiCopy.comic.unit.page}</strong><small>{physicalPageCount(state.fixture.working.document)} {isVerticalWorkbench ? uiCopy.workbench.label.segmentUnit : uiCopy.workbench.label.pageUnit}</small><div className="drawer-page-create"><button type="button" className="drawer-add-page" aria-label={isVerticalWorkbench ? uiCopy.workbench.pageFlow.addSegment : uiCopy.workbench.pageFlow.addPageAria} aria-expanded={isVerticalWorkbench ? Boolean(verticalSegmentMenuPosition) : pageCreateMenuOpen} onClick={(event) => isVerticalWorkbench ? openVerticalSegmentMenu(event.currentTarget) : (closeFloatingMenus("page_create"), setPageCreateMenuOpen((open) => !open))}><Icon name="add" /></button>{!isVerticalWorkbench && pageCreateMenuOpen ? <FloatingMenu className="page-create-menu" aria-label={uiCopy.workbench.pageFlow.addPageMenuAria}><MenuSection className="asset-menu-section"><button type="button" onClick={() => createComicPage("story")}><span><Icon name="pageSingle" />{uiCopy.workbench.action.addStoryPage}</span></button><button type="button" onClick={() => createComicPage("cover")}><span><Icon name="pageSingle" />{uiCopy.workbench.action.addCoverPage}</span></button><button type="button" onClick={() => createComicPage("interlude")}><span><Icon name="pageSingle" />{uiCopy.workbench.action.addInterludePage}</span></button></MenuSection></FloatingMenu> : null}</div></div>
          <div className={`draft-pages ${pageDisplayMode === "spread" && !isVerticalWorkbench ? "spread-layout" : ""}`}>{(pageDisplayMode === "spread" && !isVerticalWorkbench ? readerPageDisplayGroups : currentPages.map((comicPage, index) => ({ unitIndices: [index], unitIds: [comicPage.id], trueSpread: false, virtualTrailingPage: undefined }))).map((group) => <div key={group.unitIds.join("-")} className={`page-flow-group ${group.unitIndices.length > 1 || group.virtualTrailingPage ? "paired" : "single"} ${pageFlowPulse ? `page-flow-pulse-${pageFlowPulse % 2}` : ""}`}>{group.unitIndices.map((index) => {
            const comicPage = currentPages[index];
            if (!comicPage) return null;
            const thumbnail = pageThumbSrc(comicPage);
            const unit = state.fixture.working.document.units.find((item) => item.id === comicPage.id);
            const pageNumber = unit ? presentationUnitNumberLabel(unit, index).replace(/^(Page|滚动段|四格)\s/, "") : String(index + 1).padStart(2, "0");
            const pageName = comicPage.name || (unit ? presentationUnitNumberLabel(unit, index) : defaultComicPageName(comicPage, index));
            const composite = Boolean(unit && unit.surfaces.length > 1);
            return <div key={comicPage.id} className={`draft-page ${index === state.currentPageIndex ? "active" : ""} ${composite ? "composite" : ""} ${unit?.kind === "spread" ? "true-spread" : ""}`}>
              <button type="button" draggable className="draft-page-main" onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", comicPage.id); }} onClick={() => setCurrentComicPage(index)}>
                <span className="draft-page-thumbnail">{thumbnail ? <img src={thumbnail} alt={uiCopy.workbench.pageFlow.pageThumbnailAlt} loading="lazy" decoding="async"/> : <span className="draft-page-empty" aria-label={uiCopy.workbench.pageFlow.blankPageAria}/>}{composite ? <i className="draft-page-seam" /> : null}</span>
                <span className="draft-page-copy"><b>{pageName}</b><small><em className={comicPage.pageRole === "cover" ? "page-cover-tag" : comicPage.pageRole === "interlude" ? "page-role-tag" : undefined}>{pageNumber}</em>{comicPage.kind === "vertical_segment" ? <em className="page-ratio-tag">{composite ? uiCopy.workbench.label.crossSegmentCount(unit?.surfaces.length ?? 0) : verticalSegmentRatioLabel(comicPage.canvas.width, comicPage.canvas.height)}</em> : null}<span>{uiCopy.workbench.label.pageFrameStatus(comicPage.elements.filter((element) => element.type === "comic_frame").length, index === state.currentPageIndex)}</span></small></span>
              </button>
              <button type="button" className="draft-page-more" aria-label={uiCopy.workbench.aria.pageMore(pageName)} aria-expanded={pageMenuId === comicPage.id} onClick={(event) => openPageMenu(event.currentTarget, comicPage.id)}><Icon name="moreVertical" /></button>
            </div>;
          })}{group.virtualTrailingPage ? <div className="draft-page virtual-page-slot" onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }} onDrop={(event) => { event.preventDefault(); const unitId = event.dataTransfer.getData("text/plain"); const afterUnitId = group.unitIds.at(-1); if (unitId && afterUnitId) moveComicPageToVirtualSlot(unitId, afterUnitId); }}><span className="draft-page-main" aria-label={uiCopy.workbench.pageFlow.virtualPageAria}><span className="draft-page-thumbnail draft-page-virtual-thumbnail"/></span><button type="button" className="draft-page-more virtual-page-add" aria-label={uiCopy.workbench.pageFlow.createVirtualPageAria} onClick={() => { const unitId = group.unitIds.at(-1); if (unitId) insertBlankComicPage(unitId, "after"); }}><Icon name="add" /></button></div> : null}</div>)}</div>
        </section>
        </div>
      </CreationDrawer>
      {!leftOpen ? <button className="drawer-reopen left" type="button" onClick={() => setCreationSpaceOpen(true)} aria-label={uiCopy.workbench.pageFlow.expandAria}><Icon name="expand" /></button> : null}
      {activeAssetMenu && assetMenuPosition ? (() => {
        const visibleInAssetSpace = isAssetVisibleInAssetSpace(activeAssetMenu);
        return <FloatingMenu className="asset-reference-menu-floating" style={{ left: assetMenuPosition.x, top: assetMenuPosition.y }}>
          <MenuSection className="asset-menu-section">
            <button type="button" onClick={() => { addAssetReference(activeAssetMenu); openAgentWorkspace(); setAssetMenuId(null); }}><span><Icon name="ai" />{uiCopy.asset.action.referenceInChat}</span></button>
            <button type="button" onClick={handleActiveAssetPlacement}><span><Icon name="pointer" />{activeAssetPlacement ? uiCopy.workbench.action.locateOnCanvas : uiCopy.workbench.action.addToCanvas}</span></button>
          </MenuSection>
          <MenuDivider className="asset-menu-divider" />
          <MenuSection className="asset-menu-section">
            {(activeAssetMenu.libraryStatus === "library" || activeAssetMenu.kind === "reference_image" || activeAssetMenu.kind === "generated_image") ? <button type="button" disabled={visibleInAssetSpace} onClick={() => openSaveAssetForm(activeAssetMenu)}><span><Icon name="save" />{visibleInAssetSpace ? uiCopy.asset.status.linked : uiCopy.asset.action.saveToLibrary}</span></button> : null}
            <button type="button" onClick={() => { setAssetRenameId(activeAssetMenu.id); setAssetRenameDraft(activeAssetMenu.name); setAssetMenuId(null); }}><span><Icon name="edit" />{uiCopy.workbench.chat.rename}</span></button>
            <button type="button" onClick={() => pinAssetInList(activeAssetMenu)}><span><Icon name="pin" />{uiCopy.workbench.action.pin}</span></button>
            <button type="button" className="asset-list-delete" onClick={() => removeAssetFromList(activeAssetMenu)}><span><Icon name="trash" />{uiCopy.workbench.action.removeFromList}</span></button>
          </MenuSection>
        </FloatingMenu>;
      })() : null}
      {activeStoryboardRow && storyboardMenuPosition ? <div className="storyboard-row-menu-floating" style={{ left: storyboardMenuPosition.x, top: storyboardMenuPosition.y }} role="menu">
        <button type="button" onClick={() => openStoryboardRowEditor(activeStoryboardRow)}><Icon name="edit" /><span>{activeStoryboardRow.beat ? uiCopy.workbench.action.editFrameImage : uiCopy.workbench.action.createStoryboard}</span></button>
      </div> : null}
      {activePageMenu && pageMenuPosition ? <FloatingMenu className="page-item-menu-floating" style={{ left: pageMenuPosition.x, top: pageMenuPosition.y }}>
        <MenuSection className="asset-menu-section">
          <button type="button" onClick={() => openPageEditor(activePageMenu, "edit")}><span><Icon name="edit" />{uiCopy.workbench.action.editPage}</span></button>
        </MenuSection>
        <MenuDivider />
        <MenuSection className="asset-menu-section">
          <button type="button" disabled={activePageMenuUnit?.pageRole === "cover"} onClick={() => duplicateComicPage(activePageMenu.id)}><span><Icon name="copy" />{uiCopy.workbench.action.duplicateCurrentPage}</span></button>
          <button type="button" disabled={activePageMenuIndex <= 0 || activePageMenuUnit?.pageRole === "cover" || (activePageMenuIndex === 1 && state.fixture.working.document.units.find((unit) => unit.id === currentPages[0]?.id)?.pageRole === "cover")} onClick={() => moveComicPage(activePageMenu.id, "up")}><span><Icon name="moveUp" />{uiCopy.workbench.action.movePageUp}</span></button>
          <button type="button" disabled={activePageMenuIndex >= workingPages.length - 1} onClick={() => moveComicPage(activePageMenu.id, "down")}><span><Icon name="moveDown" />{uiCopy.workbench.action.movePageDown}</span></button>
        </MenuSection>
        <MenuDivider />
        <MenuSection className="asset-menu-section">
          {!isVerticalWorkbench && activePageMenuUnit ? <><button type="button" onClick={() => insertBlankComicPage(activePageMenuUnit.id, "before")}><span><Icon name="add" />{uiCopy.workbench.action.insertPageBefore}</span></button><button type="button" onClick={() => insertBlankComicPage(activePageMenuUnit.id, "after")}><span><Icon name="add" />{uiCopy.workbench.action.insertPageAfter}</span></button></> : null}
          {activePageMenuUnit?.kind === "single_page" && activePageMenuUnit.pageRole !== "cover" && activePageMenuNextUnit?.kind === "single_page" && activePageMenuNextUnit.pageRole === activePageMenuUnit.pageRole ? <button type="button" onClick={() => { setPageStructureConfirm({ unitId: activePageMenuUnit.id, action: "merge_pages" }); setPageMenuId(null); }}><span><Icon name="pageSpread" />{uiCopy.workbench.action.mergeNextPage}</span></button> : null}
          {activePageMenuUnit?.kind === "spread" ? <button type="button" onClick={() => { setPageStructureConfirm({ unitId: activePageMenuUnit.id, action: "split_spread" }); setPageMenuId(null); }}><span><Icon name="pageSingle" />{uiCopy.workbench.action.splitToSinglePages}</span></button> : null}
          {activePageMenuUnit?.kind === "vertical_segment" && activePageMenuUnit.surfaces.length === 1 && activePageMenuNextUnit?.kind === "vertical_segment" && activePageMenuNextUnit.surfaces.length === 1 ? <button type="button" onClick={() => { setPageStructureConfirm({ unitId: activePageMenuUnit.id, action: "merge_segments" }); setPageMenuId(null); }}><span><Icon name="pages" />{uiCopy.workbench.action.mergeNextSegment}</span></button> : null}
          {activePageMenuUnit?.kind === "vertical_segment" && activePageMenuUnit.surfaces.length > 1 ? <button type="button" onClick={() => { setPageStructureConfirm({ unitId: activePageMenuUnit.id, action: "split_segments" }); setPageMenuId(null); }}><span><Icon name="pages" />{uiCopy.workbench.action.splitSegment}</span></button> : null}
        </MenuSection>
        <MenuDivider />
        <MenuSection className="asset-menu-section">
          <button type="button" onClick={() => openPageEditor(activePageMenu, "delete")}><span><Icon name="trash" />{uiCopy.common.action.delete}{activePageMenuUnit?.kind === "spread" ? uiCopy.workbench.label.spreadUnit : activePageMenuUnit?.kind === "vertical_segment" ? uiCopy.comic.unit.segment : uiCopy.workbench.label.pageUnit}</span></button>
        </MenuSection>
      </FloatingMenu> : null}
      {activePageEditorPage && activePageEditorUnit && pageEditor?.mode === "edit" && pageMenuPosition ? <form className="page-edit-card-floating mode-edit" style={{ left: pageMenuPosition.x, top: pageMenuPosition.y }} onSubmit={(event) => { event.preventDefault(); savePageEditor(); }}>
        <header><strong>{uiCopy.workbench.aria.editUnit(activePageEditorPage.kind === "vertical_segment" ? uiCopy.comic.unit.segment : uiCopy.comic.unit.page)}</strong><button type="button" aria-label={uiCopy.workbench.pageFlow.closeCardAria} onClick={() => setPageEditor(null)}><Icon name="x" /></button></header>
        <label><span>{uiCopy.common.field.name}</span><input autoFocus value={pageEditDraft.name} maxLength={80} placeholder={defaultComicPageName(activePageEditorPage, activePageEditorIndex)} onChange={(event) => setPageEditDraft((current) => ({ ...current, name: event.target.value }))} /></label>
        {activePageEditorUnit.kind === "vertical_segment" && activePageEditorUnit.surfaces.length === 1 ? <label><span>{uiCopy.workbench.pageFlow.pageRatio} <small>{uiCopy.workbench.pageFlow.cropBottomHint}</small></span><CustomSelect ariaLabel={uiCopy.workbench.pageFlow.pageRatioAria} className="page-ratio-select" value={pageEditDraft.aspectRatio} options={verticalSegmentAspectRatios.map((ratio) => ({ value: ratio, label: ratio }))} onChange={(value) => setPageEditDraft((current) => ({ ...current, aspectRatio: value as VerticalSegmentAspectRatio, aspectRatioChanged: true }))} /></label> : null}
        {pageEditError ? <p className="page-edit-warning">{pageEditError}</p> : null}
        <footer><button type="button" onClick={() => setPageEditor(null)}>{uiCopy.common.action.cancel}</button><button type="submit" disabled={Boolean(pageEditError)}>{uiCopy.common.action.save}</button></footer>
      </form> : null}
      {activePageEditorPage && activePageEditorUnit && pageEditor?.mode === "delete" ? <DeleteConfirmDialog dialogId="page-delete" title={uiCopy.workbench.aria.deletePage(activePageEditorPage.name || presentationUnitNumberLabel(activePageEditorUnit, activePageEditorIndex))} description={currentPages.length <= 1 ? uiCopy.workbench.dialog.keepOneUnit : uiCopy.workbench.dialog.unitDeleteDescription(activePageEditorUnit.surfaces.length, activePageEditorUnit.kind === "spread" ? "page" : "segment", activePageEditorPage.elements.filter((element) => element.type === "comic_frame").length)} disabled={currentPages.length <= 1} onCancel={() => setPageEditor(null)} onConfirm={deletePage} /> : null}
      {pageStructureConfirm ? <DeleteConfirmDialog dialogId="page-structure-confirm" tone="neutral" icon="pages" title={pageStructureConfirm.action === "merge_pages" ? uiCopy.workbench.pageFlow.mergeSpreadTitle : pageStructureConfirm.action === "split_spread" ? uiCopy.workbench.pageFlow.splitSpreadTitle : pageStructureConfirm.action === "merge_segments" ? uiCopy.workbench.pageFlow.mergeSegmentTitle : uiCopy.workbench.pageFlow.splitSegmentTitle} description={pageStructureConfirm.action === "merge_pages" ? uiCopy.workbench.dialog.mergePagesDescription : pageStructureConfirm.action === "merge_segments" ? uiCopy.workbench.dialog.mergeSegmentsDescription : uiCopy.workbench.dialog.splitDescription} confirmLabel={pageStructureConfirm.action.startsWith("merge") ? uiCopy.common.action.confirmMerge : uiCopy.common.action.confirmSplit} onCancel={() => setPageStructureConfirm(null)} onConfirm={confirmPageStructureChange} /> : null}
      {taskCancelConfirmOpen && activeTask?.status === "running" ? <DeleteConfirmDialog dialogId="task-cancel-confirm" tone="neutral" icon="x" title={uiCopy.workbench.task.cancelTitle} description={uiCopy.workbench.dialog.cancelTaskDescription} confirmLabel={uiCopy.common.action.confirmCancel} onCancel={() => setTaskCancelConfirmOpen(false)} onConfirm={async () => { setTaskCancelConfirmOpen(false); await stopActiveTask(); }} /> : null}
      {activeAssetSave && assetMenuPosition ? <form className="asset-save-form-floating" style={{ left: assetMenuPosition.x, top: assetMenuPosition.y }} onSubmit={(event) => { event.preventDefault(); void saveCanvasAssetToLibrary(activeAssetSave); }} onPointerDown={(event) => event.stopPropagation()}>
        <header><span>{uiCopy.asset.action.saveToLibrary}</span><button type="button" aria-label={uiCopy.workbench.saveAssetDialog.cancelAria} onClick={() => setAssetSaveFormId(null)}><Icon name="x" /></button></header>
        <p>{uiCopy.workbench.saveAssetDialog.description(activeAssetSave.name)}</p>
        <label>{uiCopy.common.field.name}<input autoFocus value={assetSaveDraft.name} maxLength={120} onChange={(event) => setAssetSaveDraft((current) => ({ ...current, name: event.target.value }))} /></label>
        <label>{uiCopy.workbench.saveAssetDialog.typeLabel}<CustomSelect ariaLabel={uiCopy.asset.label.type} className="asset-save-kind-select" value={assetSaveDraft.kind} options={canvasAssetSaveTypeOptions} onChange={(value) => setAssetSaveDraft((current) => ({ ...current, kind: value as CanvasAssetSaveKind }))} /></label>
        <footer><button type="button" onClick={() => setAssetSaveFormId(null)}>{uiCopy.common.action.cancel}</button><button type="submit" disabled={!assetSaveDraft.name.trim() || assetSaveSubmitting}>{assetSaveSubmitting ? uiCopy.common.progress.saving : uiCopy.common.action.confirmSave}</button></footer>
      </form> : null}
      {isVerticalWorkbench && verticalSegmentMenuPosition ? <FloatingMenu className="vertical-segment-ratio-menu" style={verticalSegmentMenuPosition} aria-label={uiCopy.workbench.segmentDialog.ratioAria}>
        <header><strong>{uiCopy.workbench.pageFlow.addSegment}</strong><small>{uiCopy.workbench.segmentDialog.ratioLabel}</small></header>
        <div>{verticalSegmentAspectRatios.map((ratio) => <button type="button" key={ratio} onClick={() => addVerticalSegment(ratio)}><AspectRatioGlyph ratio={ratio} /><span>{ratio}</span></button>)}</div>
      </FloatingMenu> : null}

      <CanvasStage
        ref={stageRef}
        className={`${leftOpen ? "left-open" : ""} ${agentOpen ? "agent-open" : ""} ${versionsOpen ? "version-open" : ""} mode-${canvasMode} ${creationMode ? `creation-${creationMode}` : ""} ${isCanvasPanning ? "is-panning" : ""} ${marquee ? "is-marquee" : ""} ${multiSelection ? "multi-selecting" : ""} ${multiSelection?.moveActive ? "multi-move-ready" : ""}`}
        onPointerDownCapture={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUpCapture={finishCanvasPointer}
        onPointerCancelCapture={finishCanvasPointer}
        onLostPointerCapture={finishCanvasPointer}
        onPointerLeave={() => { if (creationMode) setCreationPointer(null); }}
        onWheel={handleCanvasWheel}
        onClickCapture={(event) => {
          if (canvasMode !== "free" || isFloatingCanvasControl(event.target)) return;
          const target = event.target instanceof Element ? event.target : null;
          if (target?.closest("[data-element-id], .reference-card, button, input, textarea, select, [role='menu']")) return;
          event.stopPropagation();
        }}
        onClick={handleStageClick}
      >
        <div className="canvas-world" style={canvasWorldStyle}>
          {canvasReferences.map((reference) => <ReferenceCard key={reference.id} reference={reference} selected={!multiSelection && selection.id === reference.id} multiSelected={activeMultiCanvasIds.has(reference.id)} multiMode={Boolean(multiSelection)} multiMoving={multiMoving && multiCanvasActive} multiMoveDelta={multiMoveDelta} onSelect={() => { if (multiSelection) return; setSelectedAssetId(reference.assetId ?? reference.localAssetId ?? null); setSelection({ type: "reference_card", id: reference.id, label: reference.name }); setScope(uiCopy.workbench.scope.imageOnly); }} onMove={(x, y) => updateReference(reference.id, { x, y }, uiCopy.workbench.operation.moveCanvasImage(reference.name))} onZoom={(zoom) => updateReference(reference.id, { zoom }, uiCopy.workbench.operation.zoomCanvasImage(reference.name))} onReference={() => addCanvasAssetReference(reference)} onSaveToAssets={(anchor) => openReferenceSaveAssetForm(reference, anchor)} onOpenContextMenu={() => closeFloatingMenus()} assetSaved={reference.libraryStatus === "library" || Boolean(reference.localAssetId && state.assets?.some((asset) => asset.id === reference.localAssetId && asset.libraryStatus === "library"))} onDelete={() => deleteReference(reference.id)} onLayer={(action) => changeReferenceLayer(reference, action)} onCycleImage={() => cycleReferenceImage(reference)} onView={() => { closeFloatingMenus(); setImageViewer({ images: canvasReferences.map((item) => ({ id: item.id, src: item.imageSrc, alt: item.name })), initialIndex: canvasReferences.findIndex((item) => item.id === reference.id), allowNavigation: true }); }} />)}
          <div ref={!isVerticalCanvas ? pageCanvasFitStageRef : undefined} className={`page-canvas-fit-stage ${isVerticalCanvas ? "vertical" : ""}`}>
            <div className={`comic-stage-wrap ${isVerticalCanvas ? "vertical" : showingSpread ? "spread" : ""} ${currentDisplayGroup?.trueSpread ? "true-spread" : ""}`} style={isVerticalCanvas ? verticalStageWrapStyle : pageCanvasStageStyle}>
              <span className="page-tag">{isVerticalCanvas ? (canvasUnits[state.currentPageIndex] ? presentationUnitNumberLabel(canvasUnits[state.currentPageIndex], state.currentPageIndex).toUpperCase() : uiCopy.workbench.pageFlow.defaultSegment) : page?.pageRole === "cover" ? uiCopy.workbench.pageFlow.pageRole.cover : page?.pageRole === "interlude" ? uiCopy.workbench.pageFlow.pageRole.interlude : showingSpread ? uiCopy.workbench.label.pageRangeTag(displayedPhysicalNumbers.map((number) => String(number).padStart(2, "0")).join("–")) : page?.kind === "four_panel_unit" ? uiCopy.workbench.label.fourPanelTag : uiCopy.workbench.label.pageTag(String(displayedPhysicalNumbers[0] ?? state.currentPageIndex + 1).padStart(2, "0"))}</span>
              <div ref={isVerticalCanvas ? verticalStripRef : undefined} className={`comic-page-spread ${isVerticalCanvas ? "vertical-strip-pages" : displayedPageIndices.length === 1 ? "one" : ""}`} style={verticalStripStyle} onScroll={isVerticalCanvas ? handleVerticalStripScroll : undefined}>{displayedPageIndices.map((pageIndex) => <div className={`spread-page ${isVerticalCanvas && pageIndex === state.currentPageIndex ? "active" : ""}`} data-page-index={isVerticalCanvas ? pageIndex : undefined} key={canvasUnits[pageIndex]?.id ?? pageIndex}><ComicRenderer document={canvasDocument} resolvedResources={canvasResolvedResources} pageIndex={pageIndex} selection={frameImageCandidatePreview?.target ?? selection} editable={canvasMode === "focus"} interactionMode={frameImageCandidatePreview ? "preview" : objectInteractionMode} creationMode={frameImageCandidatePreview ? undefined : creationMode ?? undefined} multiSelectedIds={frameImageCandidatePreview ? undefined : activeMultiComicIds} multiMoving={!frameImageCandidatePreview && multiMoving && multiComicActive} multiMoveDelta={multiMoveDelta} crossPageSnapFrames={crossPageSnapFrames(pageIndex)} onSelect={frameImageCandidatePreview ? undefined : handleCanvasSelection} onContextAction={frameImageCandidatePreview ? undefined : handleComicContextAction} onObjectDoubleClick={frameImageCandidatePreview ? undefined : handleComicObjectDoubleClick} onPlaceDialogue={frameImageCandidatePreview ? undefined : createDialogueBalloon} onPlacePageDialogue={frameImageCandidatePreview ? undefined : createPageDialogueBalloon} onPlaceNarration={frameImageCandidatePreview ? undefined : createNarration} onCommitElement={frameImageCandidatePreview ? undefined : (unitId, elementId, patch, label) => commitCapabilities(capabilitiesForElementPatch(unitId, elementId, patch), label)} onCommitElements={frameImageCandidatePreview ? undefined : commitElementPatches} /></div>)}</div>
              {canvasMode === "free" && !isVerticalCanvas ? <div className="canvas-page-turn-zones" aria-label={uiCopy.workbench.pageFlow.freeModePaginationAria}><button type="button" className="canvas-page-turn-zone previous" aria-label={uiCopy.viewer.action.previousPage} onClick={() => turnCanvasPage(-1)} /><button type="button" className="canvas-page-turn-zone next" aria-label={uiCopy.viewer.action.nextPage} onClick={() => turnCanvasPage(1)} /></div> : null}
            </div>
          </div>
        </div>
        {isVerticalCanvas && canvasMode === "focus" && activeVerticalViewport ? <div className="device-viewport-guide" style={verticalViewportStyle} aria-hidden="true" /> : null}
        {isVerticalCanvas && canvasMode === "focus" ? <aside ref={verticalNavigatorRef} className="vertical-scroll-navigator" aria-hidden="true"><div className="vertical-scroll-map" style={verticalNavigatorPaperStyle}>{canvasUnits.map((unit) => <span key={unit.id} style={{ flexGrow: unit.canvas.height }} />)}<i /></div></aside> : null}
        {marquee && marqueeStyle ? <div className="canvas-marquee" style={marqueeStyle} aria-hidden="true" /> : null}

        {frameImageCandidatePreview && toolbarPlacement ? <ObjectToolbar className={`candidate-preview-toolbar side-${toolbarPlacement.side}`} style={toolbarStyle} aria-label={uiCopy.workbench.candidate.previewToolbarAria} onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
          <button type="button" className="candidate-preview-apply" onClick={applyFrameImageCandidatePreview}><Icon name="save" />{uiCopy.workbench.candidate.apply}</button>
          <button type="button" className="candidate-preview-toggle" aria-pressed={frameImageCandidatePreview.mode === "candidate"} onClick={() => setFrameImageCandidatePreview((current) => current ? { ...current, mode: current.mode === "candidate" ? "original" : "candidate" } : current)}><Icon name={frameImageCandidatePreview.mode === "candidate" ? "undo" : "preview"} />{frameImageCandidatePreview.mode === "candidate" ? uiCopy.asset.action.restore : uiCopy.common.action.preview}</button>
          <button type="button" className="candidate-preview-cancel" onClick={cancelFrameImageCandidatePreview}><Icon name="x" />{uiCopy.common.action.cancel}</button>
        </ObjectToolbar> : null}
        {canvasMode === "focus" && !frameImageCandidatePreview && !multiSelection && !inspectorOpen && !comicContextMenu && toolbarPlacement && selection.type !== "none" && selection.type !== "presentation_unit" && selection.type !== "reference_card" ? <ObjectToolbar className={`side-${toolbarPlacement.side}`} style={toolbarStyle} aria-label={uiCopy.workbench.objectEditor.toolbarAria} onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
          <button type="button" aria-label={uiCopy.workbench.objectEditor.referenceAria} onClick={() => { addSelectionReference(); openAgentWorkspace(); }}><Icon name="ai" /></button>
          <button type="button" className={objectInteractionMode === "move" ? "active" : ""} aria-pressed={objectInteractionMode === "move"} aria-label={selection.type === "speech_balloon" ? uiCopy.workbench.objectEditor.toggleBalloonTransformAria : selection.type === "text" ? uiCopy.workbench.objectEditor.toggleNarrationTransformAria : selectedFrameImage ? uiCopy.workbench.objectEditor.toggleFrameMoveAria : selection.type === "image" ? uiCopy.workbench.objectEditor.togglePaperImageTransformAria : uiCopy.workbench.objectEditor.toggleFrameMoveAria} disabled={(selection.type !== "comic_frame" && selection.type !== "speech_balloon" && selection.type !== "text" && selectedElement?.type !== "image") || objectInteractionMode === "crop"} onClick={() => { setInspectorOpen(false); setObjectInteractionMode((mode) => mode === "move" ? "select" : "move"); }}><Icon name="move" /></button>
          <button type="button" className={objectInteractionMode === "crop" ? "active" : ""} aria-pressed={objectInteractionMode === "crop"} aria-label={selection.type === "text" ? uiCopy.workbench.action.rotateNarration : selection.type === "speech_balloon" ? uiCopy.workbench.action.rotateBalloon : selectedElement?.type === "image" && selectedElement.location.space === "overlay" ? uiCopy.workbench.objectEditor.cropPaperImageAria : uiCopy.workbench.objectEditor.cropFrameImageAria} disabled={selection.type !== "text" && selection.type !== "speech_balloon" && selection.type !== "comic_frame" && selectedElement?.type !== "image"} onClick={() => { if (objectInteractionMode === "crop") endCrop(); else beginCrop(); }}><Icon name="crop" /></button>
          <button type="button" aria-label={selection.type === "speech_balloon" ? uiCopy.workbench.objectEditor.editBalloonAria : selection.type === "text" ? uiCopy.workbench.objectEditor.editNarrationAria : selectedStoryboardBeat ? uiCopy.workbench.action.editFrameImage : uiCopy.workbench.action.createStoryboard} onClick={openSelectionEditor}><Icon name="edit" /></button>
          <button type="button" aria-label={uiCopy.workbench.objectEditor.manageAria} aria-expanded={false} onClick={(event) => openSelectionManagement(event.currentTarget)}><Icon name="moreVertical" /></button>
        </ObjectToolbar> : null}
        {inspectorOpen && editingStoryboardTarget && editingStoryboardFrame && editorStyle ? <aside className="object-inspector near-selection frame-editor" data-testid="storyboard-editor" style={editorStyle} onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}><div className="inspector-head"><span><i />{uiCopy.workbench.frameEditor.editTitle(editingStoryboardTarget.label)}</span><button type="button" aria-label={uiCopy.workbench.frameEditor.closeAria} onClick={() => { setInspectorOpen(false); setEditingStoryboardBeatId(null); setEditingStoryboardTarget(null); setEditDraft({}); }}><Icon name="x" /></button></div><section className="frame-editor-section"><strong>{uiCopy.workbench.frameEditor.storyboardTitle}</strong><label>{uiCopy.common.field.title}<input value={editDraft.title ?? editingStoryboardBeat?.title ?? ""} maxLength={40} placeholder={uiCopy.workbench.frameEditor.titlePlaceholder} onChange={(event) => setEditDraft((current) => ({ ...current, title: event.target.value }))}/></label><label>{uiCopy.common.field.description}<textarea value={editDraft.description ?? editingStoryboardBeat?.description ?? ""} maxLength={1200} placeholder={uiCopy.workbench.frameEditor.descriptionPlaceholder} onChange={(event) => setEditDraft((current) => ({ ...current, description: event.target.value }))}/></label><button className="inspector-save compact-save" type="button" disabled={!(editDraft.title ?? editingStoryboardBeat?.title ?? "").trim()} onClick={applyInspectorEdit}>{editingStoryboardBeat ? uiCopy.common.action.save : uiCopy.workbench.frameEditor.createAndBind}</button></section><section className="frame-editor-section"><strong>{uiCopy.workbench.object.frame}</strong><label>{uiCopy.workbench.frameEditor.borderWidthLabel}<NumberStepper ariaLabel={uiCopy.workbench.frameEditor.borderWidthAria} step={.5} value={editDraft.frameBorderWidth ?? String(editingStoryboardFrame.border.width)} onChange={(value) => setEditDraft((current) => ({ ...current, frameBorderWidth: value }))} onAdjust={adjustFrameBorderWidth} /></label><button className="inspector-save compact-save" type="button" onClick={applyFrameBorderEdit}>{uiCopy.workbench.frameEditor.saveBorder}</button></section></aside> : null}

      </CanvasStage>

      {comicContextMenu && comicContextMenuStyle ? <FloatingMenu className="comic-context-menu reference-context-menu" style={comicContextMenuStyle} aria-label={uiCopy.workbench.objectEditor.manageMenuAria} onPointerDown={(event) => event.stopPropagation()} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); handleComicContextAction(comicContextMenu.target, comicContextMenu.point); }}>
        <header><strong><Icon name={comicContextHeader.icon} />{comicContextHeader.label}</strong>{objectLocationLabel(contextTargetElement) ? <em className="object-location-badge">{objectLocationLabel(contextTargetElement)}</em> : null}</header>
        {comicContextMenu.target.type === "presentation_unit" ? <ComicMenuGroup label={uiCopy.workbench.action.backgroundColor}><button type="button" aria-haspopup="menu" aria-expanded={Boolean(comicContextMenu.backgroundMenu)} onClick={(event) => openPageBackgroundMenu(event.currentTarget)}><span><Icon name="pageSingle" />{uiCopy.workbench.action.backgroundColor}<span className="reference-menu-chevron"><Icon name="expand" /></span></span></button></ComicMenuGroup> : null}
        {comicContextMenu.target.type === "presentation_unit" ? <ComicMenuGroup label={uiCopy.workbench.menuGroup.add}>{contextTargetUnit?.pageRole === "story" ? <><button type="button" onClick={() => comicContextMenu.target.pageId && createFrameAt(comicContextMenu.target.pageId, { x: comicContextMenu.point.canvasX, y: comicContextMenu.point.canvasY })}><span><Icon name="add" />{uiCopy.workbench.action.addFrame}</span></button><button type="button" onClick={() => comicContextMenu.target.pageId && createPageDialogueBalloon(comicContextMenu.target.pageId, { x: comicContextMenu.point.canvasX, y: comicContextMenu.point.canvasY })}><span><Icon name="message" />{uiCopy.workbench.action.addPaperDialogue}</span></button></> : null}<button type="button" onClick={() => openFrameImagePicker(comicContextMenu.target)}><span><Icon name="asset" />{uiCopy.workbench.imagePicker.placePaper}</span></button>{contextTargetUnit?.kind === "spread" ? <button type="button" onClick={() => openFrameImagePicker(comicContextMenu.target, undefined, "cross_page")}><span><Icon name="pageSpread" />{uiCopy.workbench.imagePicker.placeCrossPage}</span></button> : null}{contextTargetUnit?.kind === "vertical_segment" && contextTargetUnit.surfaces.length > 1 ? <button type="button" onClick={() => openFrameImagePicker(comicContextMenu.target, undefined, "cross_segment")}><span><Icon name="pages" />{uiCopy.workbench.imagePicker.placeCrossSegment}</span></button> : null}</ComicMenuGroup> : null}
        {comicContextMenu.target.type === "comic_frame" ? <>
          <ComicMenuGroup label={uiCopy.asset.label.content}><button type="button" onClick={() => openFrameImagePicker(comicContextMenu.target)}><span><Icon name="asset" />{contextTargetFrameData?.image ? uiCopy.workbench.action.replaceFrameImage : uiCopy.workbench.action.placeFrameImage}</span></button><button type="button" onClick={() => createDialogueFromContext(comicContextMenu.target, comicContextMenu.point)}><span><Icon name="message" />{uiCopy.workbench.action.addDialogue}</span></button></ComicMenuGroup>
          <MenuDivider />
          <ComicMenuGroup label={uiCopy.workbench.menuGroup.frameLayout}><button type="button" onClick={() => toggleFrameOverlap(comicContextMenu.target)}><span><Icon name="layout" />{contextTargetUnit?.layoutPolicy.frameOverlap === "allow" ? uiCopy.workbench.action.cancelOverlap : uiCopy.workbench.action.allowOverlap}</span></button>{contextTargetUnit?.kind === "spread" ? <button type="button" onClick={() => toggleFrameCrossPage(comicContextMenu.target)}><span><Icon name={contextTargetFrameData?.frame?.surfaceScope === "unit" ? "collapse" : "pageSpread"} />{contextTargetFrameData?.frame?.surfaceScope === "unit" ? uiCopy.workbench.action.cancelCrossPage : uiCopy.workbench.action.enableCrossPageFrame}</span></button> : null}<button type="button" aria-haspopup="menu" aria-expanded={Boolean(comicContextMenu.bleedMenu)} onClick={(event) => openFrameBleedMenu(event.currentTarget)}><span><Icon name="expand" />{uiCopy.workbench.action.extendToPageEdge}<span className="reference-menu-chevron"><Icon name="expand" /></span></span></button></ComicMenuGroup>
          {contextTargetUnit?.layoutPolicy.frameOverlap === "allow" ? <><MenuDivider /><ComicMenuGroup label={uiCopy.workbench.action.layer}><button type="button" onClick={() => changeFrameLayer(comicContextMenu.target, "forward")}><span><Icon name="layers" />{uiCopy.workbench.action.moveToFront}</span></button><button type="button" onClick={() => changeFrameLayer(comicContextMenu.target, "backward")}><span><Icon name="layers" />{uiCopy.workbench.action.moveToBack}</span></button></ComicMenuGroup></> : null}
          <MenuDivider />
          <ComicMenuGroup label={uiCopy.workbench.defaultLabel.object}><button type="button" onClick={() => duplicateFrame(comicContextMenu.target)}><span><Icon name="copy" />{uiCopy.workbench.action.duplicateFrame}</span></button></ComicMenuGroup>
          <MenuDivider />
          <ComicMenuGroup label={uiCopy.common.action.delete}><button type="button" onClick={() => { setComicDeleteTarget({ kind: "frame", selection: comicContextMenu.target }); setComicContextMenu(null); }}><span><Icon name="trash" />{uiCopy.workbench.action.deleteFrame}</span></button></ComicMenuGroup>
        </> : null}
        {comicContextMenu.target.type === "image" && contextTargetElement?.type === "image" ? <>
          {contextTargetElement.location.space === "frame" ? <><ComicMenuGroup label={uiCopy.asset.label.content}><button type="button" onClick={() => openFrameImagePicker(comicContextMenu.target)}><span><Icon name="replace" />{contextImageReplaceLabel}</span></button></ComicMenuGroup><MenuDivider /></> : null}
          {contextImagePurpose === "cross_page" || contextImagePurpose === "cross_segment" ? <><ComicMenuGroup label={contextImagePurpose === "cross_page" ? uiCopy.workbench.menuGroup.crossPage : uiCopy.workbench.menuGroup.crossSegment}><button type="button" onClick={() => convertSelectionToPage(comicContextMenu.target)}><span><Icon name="collapse" />{contextImagePurpose === "cross_page" ? uiCopy.workbench.action.cancelCrossPage : uiCopy.workbench.action.cancelCrossSegment}</span></button></ComicMenuGroup><MenuDivider /></> : contextImageIsPaperOwned && contextTargetUnit?.kind === "spread" ? <><ComicMenuGroup label={uiCopy.workbench.menuGroup.crossPage}><button type="button" onClick={() => convertImageToCrossSurface(comicContextMenu.target, "cross_page")}><span><Icon name="pageSpread" />{uiCopy.workbench.action.placeCrossPageImage}</span></button></ComicMenuGroup><MenuDivider /></> : contextImageIsPaperOwned && contextTargetUnit?.kind === "vertical_segment" && contextTargetUnit.surfaces.length > 1 ? <><ComicMenuGroup label={uiCopy.workbench.menuGroup.crossSegment}><button type="button" onClick={() => convertImageToCrossSurface(comicContextMenu.target, "cross_segment")}><span><Icon name="pages" />{uiCopy.workbench.action.placeCrossSegmentImage}</span></button></ComicMenuGroup><MenuDivider /></> : null}
          {contextTargetElement.location.space === "frame" ? <><ComicMenuGroup label={uiCopy.workbench.menuGroup.ownership}><button type="button" onClick={() => promoteSelectionToOverlay(comicContextMenu.target)}><span><Icon name="expand" />{uiCopy.workbench.action.enableBreakout}</span></button><button type="button" onClick={() => convertSelectionToPage(comicContextMenu.target)}><span><Icon name="pageSingle" />{uiCopy.workbench.action.convertToPaperImage}</span></button></ComicMenuGroup><MenuDivider /></> : contextTargetElement.location.anchor.type === "frame" ? <><ComicMenuGroup label={uiCopy.workbench.menuGroup.ownership}><button type="button" onClick={() => convertSelectionToPage(comicContextMenu.target)}><span><Icon name="pageSingle" />{uiCopy.workbench.action.convertToPaperImage}</span></button><button type="button" onClick={() => returnSelectionToFrame(comicContextMenu.target)}><span><Icon name="collapse" />{uiCopy.workbench.action.returnToFrame}</span></button></ComicMenuGroup><MenuDivider /></> : null}
          {contextTargetElement.location.space === "overlay" ? <><ComicMenuGroup label={uiCopy.workbench.action.layer}><button type="button" onClick={() => changeOverlayElementLayer(comicContextMenu.target, "front")}><span><Icon name="layers" />{uiCopy.workbench.action.moveToFront}</span></button><button type="button" onClick={() => changeOverlayElementLayer(comicContextMenu.target, "back")}><span><Icon name="layers" />{uiCopy.workbench.action.moveToBack}</span></button></ComicMenuGroup><MenuDivider /></> : null}
          <ComicMenuGroup label={uiCopy.workbench.menuGroup.more}><button type="button" aria-haspopup="menu" aria-expanded={Boolean(comicContextMenu.imageMoreMenu)} onClick={(event) => openImageMoreMenu(event.currentTarget)}><span><Icon name="more" />{uiCopy.common.action.more}<span className="reference-menu-chevron"><Icon name="expand" /></span></span></button></ComicMenuGroup>
          <MenuDivider />
          <ComicMenuGroup label={uiCopy.common.action.delete}><button type="button" onClick={() => { setComicDeleteTarget({ kind: "image", selection: comicContextMenu.target }); setComicContextMenu(null); }}><span><Icon name="trash" />{uiCopy.workbench.action.removeImage}</span></button></ComicMenuGroup>
        </> : null}
        {comicContextMenu.target.type === "speech_balloon" && contextTargetElement?.type === "speech_balloon" ? <>
          <ComicMenuGroup label={uiCopy.workbench.defaultLabel.object}><button type="button" onClick={() => duplicateDialogueBalloon(comicContextMenu.target)}><span><Icon name="copy" />{uiCopy.workbench.action.duplicateDialogue}</span></button><button type="button" onClick={() => { if (!comicContextMenu.target.pageId) return; commitCapabilities(capabilitiesForElementPatch(comicContextMenu.target.pageId, contextTargetElement.id, { style: { ...contextTargetElement.style, writingMode: contextTargetElement.style.writingMode === "vertical" ? "horizontal" : "vertical" } }), contextTargetElement.style.writingMode === "vertical" ? uiCopy.workbench.operation.horizontalDialogue : uiCopy.workbench.operation.verticalDialogue); setComicContextMenu(null); }}><span><Icon name="text" />{contextTargetElement.style.writingMode === "vertical" ? uiCopy.workbench.action.horizontal : uiCopy.workbench.action.vertical}</span></button></ComicMenuGroup>
          <MenuDivider />
          {contextBalloonPurpose === "cross_page" ? <><ComicMenuGroup label={uiCopy.workbench.menuGroup.crossPage}><button type="button" onClick={() => convertSelectionToPage(comicContextMenu.target)}><span><Icon name="collapse" />{uiCopy.workbench.action.cancelCrossPage}</span></button></ComicMenuGroup><MenuDivider /></> : contextTargetUnit?.kind === "spread" ? <><ComicMenuGroup label={uiCopy.workbench.menuGroup.crossPage}><button type="button" onClick={() => convertBalloonToCrossPage(comicContextMenu.target)}><span><Icon name="pageSpread" />{uiCopy.workbench.action.placeCrossPageBalloon}</span></button></ComicMenuGroup><MenuDivider /></> : null}
          {contextTargetElement.location.space === "frame" ? <><ComicMenuGroup label={uiCopy.workbench.menuGroup.ownership}><button type="button" onClick={() => promoteSelectionToOverlay(comicContextMenu.target)}><span><Icon name="expand" />{uiCopy.workbench.action.enableBreakout}</span></button><button type="button" onClick={() => convertSelectionToPage(comicContextMenu.target)}><span><Icon name="pageSingle" />{uiCopy.workbench.action.convertToPaperDialogue}</span></button></ComicMenuGroup><MenuDivider /></> : contextTargetElement.location.anchor.type === "frame" ? <><ComicMenuGroup label={uiCopy.workbench.menuGroup.ownership}><button type="button" onClick={() => convertSelectionToPage(comicContextMenu.target)}><span><Icon name="pageSingle" />{uiCopy.workbench.action.convertToPaperDialogue}</span></button><button type="button" onClick={() => returnSelectionToFrame(comicContextMenu.target)}><span><Icon name="collapse" />{uiCopy.workbench.action.returnToFrame}</span></button></ComicMenuGroup><MenuDivider /></> : null}
          {contextTargetElement.location.space === "overlay" ? <><ComicMenuGroup label={uiCopy.workbench.action.layer}><button type="button" onClick={() => changeOverlayElementLayer(comicContextMenu.target, "front")}><span><Icon name="layers" />{uiCopy.workbench.action.moveToFront}</span></button><button type="button" onClick={() => changeOverlayElementLayer(comicContextMenu.target, "back")}><span><Icon name="layers" />{uiCopy.workbench.action.moveToBack}</span></button></ComicMenuGroup><MenuDivider /></> : null}
          <ComicMenuGroup label={uiCopy.common.action.delete}><button type="button" onClick={() => { setComicDeleteTarget({ kind: "dialogue", selection: comicContextMenu.target }); setComicContextMenu(null); }}><span><Icon name="trash" />{uiCopy.workbench.action.deleteDialogue}</span></button></ComicMenuGroup>
        </> : null}
        {comicContextMenu.target.type === "text" && contextTargetElement?.type === "text" ? <>
          <ComicMenuGroup label={uiCopy.workbench.defaultLabel.object}><button type="button" onClick={() => duplicateNarration(comicContextMenu.target)}><span><Icon name="copy" />{uiCopy.workbench.action.duplicateNarration}</span></button><button type="button" onClick={() => { if (!comicContextMenu.target.pageId) return; commitCapabilities(capabilitiesForElementPatch(comicContextMenu.target.pageId, contextTargetElement.id, { style: { ...contextTargetElement.style, writingMode: contextTargetElement.style.writingMode === "vertical" ? "horizontal" : "vertical" } }), contextTargetElement.style.writingMode === "vertical" ? uiCopy.workbench.operation.horizontalNarration : uiCopy.workbench.operation.verticalNarration); setComicContextMenu(null); }}><span><Icon name="text" />{contextTargetElement.style.writingMode === "vertical" ? uiCopy.workbench.action.horizontal : uiCopy.workbench.action.vertical}</span></button></ComicMenuGroup>
          <MenuDivider />
          <ComicMenuGroup label={uiCopy.common.action.delete}><button type="button" onClick={() => { setComicDeleteTarget({ kind: "narration", selection: comicContextMenu.target }); setComicContextMenu(null); }}><span><Icon name="trash" />{uiCopy.workbench.action.deleteNarration}</span></button></ComicMenuGroup>
        </> : null}
      </FloatingMenu> : null}
      {comicContextMenu?.bleedMenu && contextTargetFrameData?.frame ? <FloatingMenu className="reference-context-menu comic-frame-bleed-menu" style={comicContextMenu.bleedMenu} aria-label={uiCopy.workbench.objectEditor.selectBleedEdgeAria} onPointerDown={(event) => event.stopPropagation()} onContextMenu={(event) => event.preventDefault()}><MenuSection>{(["top", "right", "bottom", "left"] as const).map((edge) => <button type="button" key={edge} aria-pressed={Boolean(contextTargetFrameData.frame?.bleedEdges?.[edge])} onClick={() => toggleFrameBleedEdge(comicContextMenu.target, edge)}><span><Icon name={bleedEdgeIcon[edge]} />{uiCopy.workbench.bleed.action(contextTargetFrameData.frame?.bleedEdges?.[edge] ? "cancel" : "extend", { top: uiCopy.workbench.direction.top, right: uiCopy.workbench.direction.right, bottom: uiCopy.workbench.direction.bottom, left: uiCopy.workbench.direction.left }[edge])}</span></button>)}</MenuSection></FloatingMenu> : null}
      {comicContextMenu?.backgroundMenu && contextTargetUnit ? <FloatingMenu className="reference-context-menu comic-page-background-menu" style={comicContextMenu.backgroundMenu} aria-label={uiCopy.workbench.action.backgroundColor} onPointerDown={(event) => event.stopPropagation()} onContextMenu={(event) => event.preventDefault()}><MenuSection>{(["#ffffff", "#000000"] as const).map((color) => { const label = color === "#ffffff" ? uiCopy.workbench.action.white : uiCopy.workbench.action.black; return <button type="button" key={color} aria-pressed={contextTargetUnit.canvas.background.color === color} onClick={() => setPageBackground(comicContextMenu.target, color)}><span><i className={`page-background-swatch ${color === "#000000" ? "black" : "white"}`} />{label}</span></button>; })}</MenuSection></FloatingMenu> : null}
      {comicContextMenu?.imageMoreMenu && contextTargetElement?.type === "image" ? <FloatingMenu className="reference-context-menu comic-image-more-menu" style={comicContextMenu.imageMoreMenu} aria-label={uiCopy.workbench.imagePicker.moreAria} onPointerDown={(event) => event.stopPropagation()} onContextMenu={(event) => event.preventDefault()}><MenuSection><button type="button" onClick={() => openCanvasImageViewer(comicContextMenu.target)}><span><Icon name="referenceImage" />{uiCopy.common.action.viewImage}</span></button><button type="button" disabled={Boolean(downloadingCanvasImageId)} onClick={() => void downloadCanvasImage(comicContextMenu.target)}><span><Icon name="download" />{downloadingCanvasImageId === contextTargetElement.id ? uiCopy.common.progress.downloading : uiCopy.common.action.download}</span></button><button type="button" disabled={contextImageAlreadyInAssetList || Boolean(addingCanvasImageAssetId)} onClick={() => void addCanvasImageToAssetList(comicContextMenu.target)}><span><Icon name="add" />{contextImageAlreadyInAssetList ? uiCopy.asset.status.addedToList : addingCanvasImageAssetId === contextTargetElement.assetId ? uiCopy.workbench.action.addInProgress : uiCopy.asset.action.addToList}</span></button></MenuSection></FloatingMenu> : null}

      {frameImageTarget && frameImagePickerStyle ? <FloatingMenu role="dialog" className="frame-image-picker" style={frameImagePickerStyle} aria-label={uiCopy.workbench.imagePicker.selectAria} onPointerDown={(event) => event.stopPropagation()}>
        <header><div><strong>{frameImageTarget.placement === "cross_page" ? uiCopy.workbench.imagePicker.placeCrossPage : frameImageTarget.placement === "cross_segment" ? uiCopy.workbench.imagePicker.placeCrossSegment : (() => { const image = frameAndImageForSelection(frameImageTarget.selection).image; return image ? image.location.space === "frame" ? uiCopy.workbench.action.replaceFrameImage : image.location.purpose === "cross_page" ? uiCopy.workbench.imagePicker.replaceCrossPage : image.location.purpose === "cross_segment" ? uiCopy.workbench.imagePicker.replaceCrossSegment : image.location.anchor.type === "unit" ? uiCopy.workbench.imagePicker.replacePaper : uiCopy.workbench.imagePicker.replaceBreakout : frameImageTarget.selection.type === "presentation_unit" ? uiCopy.workbench.imagePicker.placePaper : uiCopy.workbench.action.placeFrameImage; })()}</strong><small>{frameImagePickerSelection?.frame ? uiCopy.workbench.imagePicker.sourceHint : uiCopy.workbench.imagePicker.assetSourceHint}</small></div><button type="button" aria-label={uiCopy.workbench.imagePicker.closeAria} onClick={() => setFrameImageTarget(null)}><Icon name="x" /></button></header>
        <div className="frame-image-grid">{frameImageChoices.map((choice) => <button type="button" key={choice.id} onClick={() => placeFrameImage(choice)}>{choice.url ? <img src={choice.url} alt="" /> : <span className="frame-image-placeholder"><Icon name="asset" /></span>}<strong>{choice.label}</strong></button>)}</div>
        {!frameImageChoices.length ? <p>{uiCopy.workbench.imagePicker.empty}</p> : null}
        {frameImagePickerSelection?.frame ? <div className="frame-image-picker-actions"><button type="button" aria-label={uiCopy.workbench.imagePicker.uploadToFrameAria} onClick={() => frameImageUploadRef.current?.click()}><Icon name="asset" /></button></div> : null}
      </FloatingMenu> : null}

      {comicDeleteTarget && comicDeleteSelection ? <DeleteConfirmDialog dialogId="comic-delete" title={comicDeleteTitle} description={comicDeleteDescription} confirmLabel={comicDeleteTarget.kind === "image" ? uiCopy.common.action.confirmRemove : uiCopy.common.action.confirmDelete} onCancel={() => setComicDeleteTarget(null)} onConfirm={confirmComicDelete} /> : null}
      {archiveImportFile ? <DeleteConfirmDialog dialogId="chapter-archive-import" title={uiCopy.workbench.dialog.overwriteChapterTitle} description={uiCopy.workbench.dialog.importArchiveDescription(archiveImportFile.name)} confirmLabel={uiCopy.common.action.confirmImport} onCancel={() => setArchiveImportFile(null)} onConfirm={() => { const file = archiveImportFile; setArchiveImportFile(null); void importChapterArchive(file); }} /> : null}
      {modelSettingsPromptOpen ? <DeleteConfirmDialog dialogId="model-settings-required" tone="neutral" icon="settings" title={uiCopy.workbench.dialog.configureModelTitle} description={uiCopy.workbench.dialog.configureModelDescription} confirmLabel={uiCopy.common.action.goToSettings} onCancel={() => setModelSettingsPromptOpen(false)} onConfirm={() => navigate(`/settings?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`)} /> : null}
      {saveChapterConfirmOpen ? <DeleteConfirmDialog dialogId="save-chapter-confirm" tone="neutral" icon="save" title={uiCopy.workbench.dialog.saveVersionTitle} description={uiCopy.workbench.dialog.saveVersionDescription} confirmLabel={uiCopy.workbench.action.saveVersion} disabled={savingChapter} onCancel={() => setSaveChapterConfirmOpen(false)} onConfirm={saveChapter} /> : null}

      {creationMode === "dialogue" && creationPointer ? <div className="dialogue-cursor-preview" aria-hidden="true" style={{ left: creationPointer.x, top: creationPointer.y }}><Icon name="message" /><i>+</i></div> : null}
      {creationMode === "narration" && creationPointer ? <div className="narration-cursor-preview" aria-hidden="true" style={{ left: creationPointer.x, top: creationPointer.y }}>{uiCopy.workbench.narrationEditor.placementPreview}</div> : null}

      {inspectorOpen && selection.type === "speech_balloon" && selectedElement?.type === "speech_balloon" && balloonEditorPlacement ? <aside className="balloon-editor-popover" style={{ left: balloonEditorPlacement.x, top: balloonEditorPlacement.y }} onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}><div className="balloon-editor-head"><span><i />{uiCopy.workbench.object.dialogue}{String(selectedBalloonNumber || 1).padStart(2, "0")}</span><button type="button" aria-label={uiCopy.workbench.balloonEditor.closeAria} onClick={() => setInspectorOpen(false)}><Icon name="x" /></button></div><label>{uiCopy.workbench.object.dialogue}<textarea autoFocus value={editDraft.dialogue ?? selectedElement.content.text ?? ""} onChange={(event) => setEditDraft((current) => ({ ...current, dialogue: event.target.value }))} /></label><label>{uiCopy.workbench.balloonEditor.textStyleLabel}<CustomSelect ariaLabel={uiCopy.workbench.balloonEditor.textStyleLabel} className="balloon-style-select" value={selectedElement.content.shape} onChange={(value) => updateBalloonShape(value as SpeechBalloonElement["content"]["shape"])} options={balloonStyleOptions} /></label><label>{uiCopy.workbench.balloonEditor.fontSizeLabel}<NumberStepper ariaLabel={uiCopy.workbench.balloonEditor.fontSizeAria} value={editDraft.fontSize ?? String(selectedElement.style.fontSize)} onChange={(value) => setEditDraft((current) => ({ ...current, fontSize: value }))} onAdjust={(delta) => adjustBalloonStyleNumber("fontSize", delta)} /></label><label>{uiCopy.workbench.frameEditor.borderWidthLabel}<NumberStepper ariaLabel={uiCopy.workbench.balloonEditor.borderWidthAria} step={.5} value={editDraft.strokeWidth ?? String(selectedElement.style.strokeWidth)} onChange={(value) => setEditDraft((current) => ({ ...current, strokeWidth: value }))} onAdjust={(delta) => adjustBalloonStyleNumber("strokeWidth", delta)} /></label><div className="balloon-editor-actions"><button type="button" onClick={applyInspectorEdit}>{uiCopy.common.action.save}</button></div></aside> : null}
      {inspectorOpen && selection.type === "text" && selectedElement?.type === "text" && balloonEditorPlacement ? <aside className="balloon-editor-popover narration-editor-popover" style={{ left: balloonEditorPlacement.x, top: balloonEditorPlacement.y }} onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}><div className="balloon-editor-head"><span><i />{uiCopy.workbench.label.narration(selectedNarrationNumber || 1)}</span><button type="button" aria-label={uiCopy.workbench.narrationEditor.closeAria} onClick={() => setInspectorOpen(false)}><Icon name="x" /></button></div><label>{uiCopy.workbench.narrationEditor.textLabel}<textarea autoFocus value={editDraft.narration ?? selectedElement.content.text} onChange={(event) => setEditDraft((current) => ({ ...current, narration: event.target.value }))} /></label><label>{uiCopy.workbench.balloonEditor.fontSizeLabel}<NumberStepper ariaLabel={uiCopy.workbench.narrationEditor.fontSizeAria} value={editDraft.fontSize ?? String(selectedElement.style.fontSize)} onChange={(value) => setEditDraft((current) => ({ ...current, fontSize: value }))} onAdjust={adjustNarrationFontSize} /></label><div className="balloon-editor-actions"><button type="button" onClick={applyInspectorEdit}>{uiCopy.common.action.save}</button></div></aside> : null}

      <div className="canvas-global-actions" aria-label={uiCopy.common.navigation.globalEntry}><WorkbenchTour leftOpen={leftOpen} agentOpen={agentOpen} versionsOpen={versionsOpen} onLeftOpenChange={setCreationSpaceOpen} onAgentOpenChange={setAgentWorkspaceOpen} onVersionsOpenChange={setVersionWorkspaceOpen} /><button type="button" className={`global-icon-button ${versionsOpen ? "active" : ""}`} data-tour-id="version-history" aria-label={uiCopy.workbench.versions.entryAria} aria-pressed={versionsOpen} onClick={() => setVersionWorkspaceOpen(!versionsOpen)}><Icon name="history" /></button><button type="button" className="global-icon-button" aria-label={uiCopy.common.navigation.globalSettings} onClick={() => navigate(`/settings?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`)}><Icon name="settings" /></button></div>
      <VersionPanel projectId={runtimeIds?.projectId} open={versionsOpen} refreshKey={`${state.fixture.snapshot?.documentId ?? "draft"}:${versionTimelineRefreshKey}`} onClose={() => setVersionsOpen(false)} onNewProposalDetected={handleNewProposalDetected} />
      <AgentWorkspace className={agentOpen ? "open" : "closed"} aria-label={uiCopy.workbench.chat.panelAria}>
        <div className="agent-head">
          <div className="agent-head-actions"><span className="agent-session-entry"><button type="button" className={`session-drawer-trigger ${sessionDrawerOpen ? "active" : ""}`} aria-label={uiCopy.workbench.chat.sessionsAria} aria-expanded={sessionDrawerOpen} onClick={() => setSessionDrawerOpen((open) => { if (!open) setInspectorOpen(false); return !open; })}><Icon name="message" /></button></span><button type="button" aria-label={uiCopy.workbench.chat.collapseAria} onClick={() => setAgentOpen(false)}><Icon name="expand" /></button></div>
        </div>
        <div className="agent-access-card" role="note">
          <span><Icon name="connection" /></span>
          <div>
            <p>{uiCopy.agentAccess.externalDescription}</p>
            <a href={uiCopy.agentAccess.guideUrl} target="_blank" rel="noreferrer">{uiCopy.agentAccess.guideAction}</a>
          </div>
        </div>
        {sessionDrawerOpen ? <SessionDrawer aria-label={uiCopy.workbench.chat.currentSessionsAria}><header><div><small>{uiCopy.workbench.chat.currentCanvasLabel}</small><strong>{workbenchMeta.chapterTitle}</strong></div><button type="button" aria-label={uiCopy.workbench.chat.newSessionAria} onClick={() => { setSessionCreateOpen((open) => !open); setSessionMenuId(null); setSessionRenameId(null); }}><Icon name="add" /></button></header>{sessionCreateOpen ? <form className="session-create-form" onSubmit={(event) => { event.preventDefault(); void createConversation(); }}><input autoFocus value={sessionTitleDraft} onChange={(event) => setSessionTitleDraft(event.target.value)} placeholder={uiCopy.workbench.chat.sessionNamePlaceholder} maxLength={80}/><button type="submit" aria-label={uiCopy.workbench.chat.createSessionAria}><Icon name="add" /></button><button type="button" aria-label={uiCopy.workbench.chat.cancelNewSessionAria} onClick={() => { setSessionCreateOpen(false); setSessionTitleDraft(""); }}><Icon name="x" /></button></form> : null}<div className="canvas-session-list">{state.conversations?.map((conversation) => <div className={`canvas-session-row ${conversation.id === runtimeIds?.conversationId ? "active" : ""}`} key={conversation.id}>{sessionRenameId === conversation.id ? <form className="session-rename-form" onSubmit={(event) => { event.preventDefault(); void renameConversation(conversation.id); }}><input autoFocus value={sessionRenameDraft} onChange={(event) => setSessionRenameDraft(event.target.value)} maxLength={80}/><button type="submit" aria-label={uiCopy.workbench.chat.saveSessionNameAria}><Icon name="save" /></button><button type="button" aria-label={uiCopy.workbench.creationSpace.cancelRenameAria} onClick={() => { setSessionRenameId(null); setSessionRenameDraft(""); }}><Icon name="x" /></button></form> : <><button type="button" className="session-select" onClick={() => void switchConversation(conversation.id)}><span><strong>{conversation.title}</strong><small>{new Date(conversation.updatedAt).toLocaleDateString("zh-CN")}</small></span></button><button type="button" className="session-more" aria-label={uiCopy.workbench.aria.manageConversation(conversation.title)} aria-expanded={sessionMenuId === conversation.id} onClick={(event) => { const drawer = event.currentTarget.closest<HTMLElement>(".canvas-session-drawer"); const button = event.currentTarget.getBoundingClientRect(); const drawerRect = drawer?.getBoundingClientRect(); const top = drawerRect ? clampValue(button.top - drawerRect.top + button.height + 4, 58, Math.max(58, drawerRect.height - 72)) : 58; closeFloatingMenus("session"); setSessionMenuPosition({ top, right: 10 }); setSessionMenuId((id) => id === conversation.id ? null : conversation.id); setSessionRenameId(null); }}><Icon name="moreVertical" /></button></>}</div>)}</div>{sessionMenuConversation && sessionMenuPosition ? <div className="session-row-menu" style={{ top: sessionMenuPosition.top, right: sessionMenuPosition.right }}><button type="button" onClick={() => { setSessionRenameId(sessionMenuConversation.id); setSessionRenameDraft(sessionMenuConversation.title); setSessionMenuId(null); }}><Icon name="edit" />{uiCopy.workbench.chat.rename}</button><button type="button" onClick={() => void deleteConversation(sessionMenuConversation.id)}><Icon name="trash" />{uiCopy.common.action.delete}</button></div> : null}</SessionDrawer> : null}
        <div ref={agentMessagesRef} className="agent-messages" data-testid="agent-messages">
          {state.messages.map((message) => {
            const candidate = message.candidateId ? state.candidates.find((item) => item.id === message.candidateId) : undefined;
            if (message.kind === "candidate" && (!candidate || (candidate.kind === "storyboard" && !candidate.metadata?.storyboardMode))) return null;
            const resolved = message.resolved === true || resolvedCardIds.has(message.id);
            const attachments = message.attachments?.length ? (
              <div className="message-attachments">
                {message.attachments.map((attachment) => (
                  <figure key={attachment.id}>
                    <button type="button" className="message-attachment-preview" aria-label={uiCopy.workbench.aria.viewAttachment(attachment.name)} onClick={() => setImageViewer({ images: [{ id: attachment.id, src: attachment.imageUrl, alt: uiCopy.workbench.aria.attachmentReference(attachment.name) }] })}><img src={attachment.imageUrl} alt={uiCopy.workbench.aria.attachmentReference(attachment.name)} /></button>
                    <figcaption>{attachment.name}</figcaption>
                  </figure>
                ))}
              </div>
            ) : null;
            const referenceQuote = message.role === "user" && message.explicitReferences?.length ? (
              <blockquote className="message-reference-quote">{message.explicitReferences.map(referenceMention).join(" ")}</blockquote>
            ) : null;
            return (
              <div className={`agent-message ${message.role} ${message.kind}`} key={message.id}>
                {attachments}
                {referenceQuote}
                {renderAgentMessageContent(message, candidate, resolved)}
              </div>
            );
          })}
          {activeTask?.status === "running" && !state.messages.some((message) => message.kind === "task" && (!message.taskId || message.taskId === activeTask.id)) ? <div className="agent-message agent task"><div className="task-message"><i className="spinner"/><span><strong>{activeTask.label}</strong><small>{activeTask.stage === "preparing" ? uiCopy.workbench.taskStage.preparing : activeTask.stage === "queued" ? uiCopy.workbench.taskStage.queued : activeTask.stage === "validating" ? uiCopy.workbench.taskStage.validating : activeTask.stage === "saving" ? uiCopy.workbench.taskStage.saving : uiCopy.workbench.taskStage.generating}</small></span><button type="button" className="task-cancel-trigger" aria-label={uiCopy.workbench.task.cancelAria} onClick={() => setTaskCancelConfirmOpen(true)}><Icon name="x" /></button></div></div> : null}
          {streamingTurn ? <div className="agent-message agent plain streaming" aria-live="polite">{streamingTurn.status === "thinking" ? <span className="agent-thinking" aria-label={uiCopy.workbench.chat.thinkingAria}><i/><i/><i/></span> : <p>{streamingTurn.text}<span className="streaming-cursor" aria-hidden="true" /></p>}</div> : null}
        </div>
        <div className="composer-box" data-tour-id="agent-composer">
          <div className="reference-tags">{composerReferenceItems.map((item) => { if (item.type === "attachment") { const attachment = item.value; return <div className={`composer-image-reference ${attachment.status}`} key={item.key}><button type="button" className="composer-image-reference-preview" aria-label={uiCopy.workbench.aria.viewAttachment(attachment.name)} onClick={() => setImageViewer({ images: [{ id: attachment.id, src: attachment.imageUrl, alt: uiCopy.workbench.aria.attachmentPending(attachment.name) }] })}><img src={attachment.imageUrl} alt={uiCopy.workbench.aria.attachmentPending(attachment.name)} /><span>{attachment.status === "uploading" ? uiCopy.common.progress.uploading : attachment.status === "failed" ? uiCopy.asset.error.genericUpload : attachment.name}</span></button><button type="button" className="composer-image-reference-remove" aria-label={uiCopy.workbench.aria.cancelAttachmentReference(attachment.name)} onClick={() => removeComposerAttachment(attachment.id)}><Icon name="x" /></button></div>; } const reference = item.value; const removeReference = () => { setExplicitReferences((items) => items.filter((current) => current.id !== reference.id)); setComposerReferenceOrder((items) => items.filter((key) => key !== item.key)); }; return reference.kind === "comic_frame" ? <button type="button" className="composer-frame-reference" key={item.key} onClick={removeReference}>{reference.imageUrl ? <img src={reference.imageUrl} alt={uiCopy.workbench.aria.referenceThumbnail(reference.label)} /> : <span className="frame-reference-placeholder"><Icon name="layout" /></span>}<span>{reference.label}</span><Icon name="x" /></button> : reference.kind === "speech_balloon" ? <button type="button" className="composer-dialogue-reference" key={item.key} onClick={removeReference}><Icon name="reference" /><span>{uiCopy.workbench.object.dialogue}{String(reference.balloonNumber ?? 1).padStart(2, "0")}</span><Icon name="x" /></button> : <button type="button" key={item.key} onClick={removeReference}><Icon name="reference" /> {reference.label} <Icon name="x" /></button>; })}</div>
          <textarea ref={composerInputRef} data-testid="agent-input" value={composer} onChange={(event) => setComposer(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendMessage(); } }} placeholder={activeTask?.status === "running" ? uiCopy.workbench.composer.queuedPlaceholder : uiCopy.workbench.composer.placeholder} />
          <div className="composer-actions"><input ref={chatUploadRef} type="file" accept="image/png,image/jpeg,image/jpg,image/webp,.png,.jpg,.jpeg,.webp" hidden onChange={(event) => { void handleAgentUpload(event.target.files?.[0]); event.currentTarget.value = ""; }}/><button type="button" className="plus" aria-label={uiCopy.workbench.composer.addReferenceAria} onClick={() => chatUploadRef.current?.click()}><Icon name="add" /></button><span className="composer-mode-label"><Icon name="ai" />{uiCopy.common.action.createContent}</span><button type="button" className="at-button" aria-label={uiCopy.workbench.composer.referenceCurrentAria} onClick={() => addSelectionReference()}><Icon name="reference" /><span>{uiCopy.workbench.chat.referenceLabel}</span></button><button type="button" className="send" aria-label={activeTask?.status === "running" ? uiCopy.workbench.composer.taskRunningAria : composerAttachments.some((attachment) => attachment.status === "uploading") ? uiCopy.workbench.composer.imageUploadingAria : uiCopy.workbench.composer.sendAria} disabled={activeTask?.status === "running" || composerAttachments.some((attachment) => attachment.status === "uploading")} onClick={sendMessage}><Icon name="send" /></button></div>
        </div>
      </AgentWorkspace>
      {!agentOpen && !versionsOpen ? <button className="drawer-reopen right" type="button" onClick={openAgentWorkspace} aria-label={uiCopy.workbench.chat.expandAria}><Icon name="ai" /></button> : null}

      <><input ref={dockUploadRef} type="file" accept="image/png,image/jpeg,image/jpg,image/webp,.png,.jpg,.jpeg,.webp" hidden onChange={(event) => { handleCanvasUpload(event.target.files?.[0]); event.currentTarget.value = ""; }} />
      <input ref={frameImageUploadRef} type="file" accept="image/png,image/jpeg,image/jpg,image/webp,.png,.jpg,.jpeg,.webp" hidden onChange={(event) => { void handleFrameImageUpload(event.target.files?.[0]); event.currentTarget.value = ""; }} />
      <input ref={archiveImportRef} type="file" accept="application/zip,.zip" hidden onChange={(event) => { const file = event.target.files?.[0]; setProjectMenu(false); if (file) setArchiveImportFile(file); event.currentTarget.value = ""; }} />
      <CreationDock className={[multiSelection ? "multi-hidden" : "", dockEntering ? "mode-entering" : "", modeSwitching ? "mode-exiting" : ""].filter(Boolean).join(" ")} aria-label={uiCopy.workbench.toolbar.creationAria}>
        <div><span className="dock-canvas-mode-pair" data-tour-id="tool-canvas-modes"><button type="button" className={canvasMode === "focus" ? "active" : ""} aria-label={uiCopy.workbench.toolbar.focusModeAria} onClick={() => switchCanvasMode("focus")}><Icon name="select" /></button><button type="button" className={canvasMode === "free" ? "active" : ""} aria-label={uiCopy.workbench.toolbar.freeModeAria} onClick={() => switchCanvasMode("free")}><Icon name="pan" /></button></span><i/>{!isVerticalWorkbench ? <button type="button" data-tour-id="tool-display" className={`page-display-toggle ${pageDisplayMode === "spread" ? "active" : ""}`} aria-label={pageDisplayMode === "single" ? uiCopy.viewer.action.spread : uiCopy.viewer.action.singlePage} onClick={togglePageDisplayMode}><Icon name={pageDisplayMode === "single" ? "pageSingle" : "pageSpread"} /></button> : <button type="button" data-tour-id="tool-display" className={`device-viewport-toggle ${verticalViewportMode !== "off" ? "active" : ""}`} aria-label={uiCopy.workbench.aria.switchViewport(verticalViewportLabel)} title={verticalViewportLabel} onClick={cycleVerticalViewportMode}><DeviceViewportGlyph mode={verticalViewportMode} /></button>}<button type="button" aria-label={uiCopy.workbench.toolbar.uploadCanvasImageAria} onClick={() => dockUploadRef.current?.click()}><Icon name="asset" /></button><button type="button" className={creationMode === "narration" ? "active" : ""} aria-label={creationMode === "narration" ? uiCopy.workbench.toolbar.cancelNarrationAria : uiCopy.workbench.toolbar.placeNarrationAria} aria-pressed={creationMode === "narration"} onClick={() => { if (canvasMode !== "focus") switchCanvasMode("focus"); setInspectorOpen(false); setObjectInteractionMode("select"); setCreationMode((mode) => mode === "narration" ? null : "narration"); setCreationPointer(null); }}><Icon name="text" /></button></div><div className="dock-history" data-tour-id="tool-history"><button type="button" aria-label={uiCopy.workbench.toolbar.undoAria} disabled={!history.length} onClick={undo}><Icon name="undo" /></button><button type="button" aria-label={uiCopy.workbench.toolbar.redoAria} disabled={!future.length} onClick={redo}><Icon name="redo" /></button><button type="button" aria-label={uiCopy.workbench.toolbar.saveVersionAria} disabled={savingChapter} onClick={requestSaveChapter}><Icon name="save" /></button></div><div className="ai-tools mode-toggle creative-active" data-tour-id="tool-mode"><button type="button" className="mode-workbench mode-active" aria-label={uiCopy.workbench.toolbar.aiEditStoryboardAria} onClick={() => { setComposer(uiCopy.workbench.chat.editStoryboardPrompt); }}><Icon name="workbench" /></button><button type="button" className="mode-preview mode-idle" aria-label={uiCopy.workbench.toolbar.previewAria} title={previewTitle} disabled={previewDisabled} onClick={goToPreview}><Icon name="preview" /></button></div>
      </CreationDock>
      <nav className={`multi-selection-dock ${multiSelection ? "active" : ""}`} aria-label={uiCopy.workbench.multiSelect.toolbarAria}>
        <button type="button" aria-label={uiCopy.workbench.multiSelect.referenceAria} disabled={!multiComicActive && !multiCanvasActive} onClick={addMultiSelectionToDialogue}><Icon name="ai" /></button>
        <i />
        <button type="button" className={`multi-group-button ${multiComicActive ? "active" : ""}`} aria-label={multiComicActive ? uiCopy.workbench.multiSelect.disableComicAria : uiCopy.workbench.multiSelect.enableComicAria} aria-pressed={multiComicActive} disabled={!multiSelection?.comic.length} onClick={() => toggleMultiGroup("comic")}><Icon name="comic" /><small>{multiSelection?.comic.length ?? 0}</small></button>
        <button type="button" className={`multi-group-button ${multiCanvasActive ? "active" : ""}`} aria-label={multiCanvasActive ? uiCopy.workbench.multiSelect.disableCanvasAria : uiCopy.workbench.multiSelect.enableCanvasAria} aria-pressed={multiCanvasActive} disabled={!multiSelection?.canvasIds.length} onClick={() => toggleMultiGroup("canvas")}><Icon name="asset" /><small>{multiSelection?.canvasIds.length ?? 0}</small></button>
        <i />
        <button type="button" className={multiSelection?.moveActive ? "active" : ""} aria-label={uiCopy.workbench.multiSelect.moveAria} aria-pressed={Boolean(multiSelection?.moveActive)} disabled={!multiMoveEnabled} onClick={() => setMultiSelection((current) => current ? { ...current, moveActive: !current.moveActive } : current)}><Icon name="move" /></button>
        <button type="button" aria-label={uiCopy.workbench.multiSelect.removeAria} disabled={!multiCanvasActive || multiComicActive} onClick={removeMultiCanvasElements}><Icon name="trash" /></button>
        <i />
        <button type="button" className="multi-mode-exit active" aria-label={uiCopy.workbench.multiSelect.exitAria} onClick={exitMultiSelection}><Icon name="select" /></button>
      </nav>

      </>

      <div className={`toast ${toast ? "show" : ""}`} role="status" aria-live="polite">{toast}</div>
      {contextDebugOpen ? <div className="context-debug-overlay" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) setContextDebugOpen(false); }}>
        <section className="context-debug-dialog" role="dialog" aria-modal="true" aria-labelledby="context-debug-title" onPointerDown={(event) => event.stopPropagation()}>
          <header>
            <div><span>{uiCopy.workbench.contextDebug.eyebrow}</span><h2 id="context-debug-title">{uiCopy.workbench.contextDebug.title}</h2></div>
            <button type="button" className="context-debug-close" aria-label={uiCopy.workbench.contextDebug.closeAria} onClick={() => setContextDebugOpen(false)}><Icon name="x" /></button>
          </header>
          <div className="context-debug-meta"><span>{uiCopy.workbench.contextDebug.workingRevision(state.fixture.working.revision)}</span><span>{uiCopy.workbench.contextDebug.page(state.currentPageIndex + 1)}</span><span>{activeConversation?.title ?? uiCopy.workbench.contextDebug.currentConversation}</span><span>{selection.label}</span></div>
          {contextDebugError ? <div className="context-debug-error">{contextDebugError}</div> : null}
          <div className="context-debug-workspace">
            <nav className="context-debug-nav" aria-label={uiCopy.workbench.contextDebug.navigationAria}>
              {contextDebugSections.map((section) => <button type="button" key={section.id} className={contextDebugSection === section.id ? "active" : ""} onClick={() => setContextDebugSection(section.id)}><strong>{section.label}</strong><small>{section.detail}</small></button>)}
            </nav>
            <section className="context-debug-content" aria-live="polite">
              {contextDebugLoading ? <div className="context-debug-loading">{uiCopy.workbench.contextDebug.loading}</div> : (() => {
                const current = contextDebugSections.find((section) => section.id === contextDebugSection) ?? contextDebugSections[0];
                if (!current) return <div className="context-debug-loading">{uiCopy.workbench.contextDebug.waiting}</div>;
                const sectionText = current.id === "raw" ? contextDebugText : JSON.stringify(current.value, null, 2);
                return <div className="context-debug-code-shell"><div className="context-debug-code-actions"><button type="button" title={uiCopy.workbench.contextDebug.copyAria} aria-label={uiCopy.workbench.contextDebug.copyAria} onClick={() => void navigator.clipboard.writeText(sectionText)}><Icon name="copy" /></button><button type="button" title={uiCopy.workbench.contextDebug.refreshAria} aria-label={uiCopy.workbench.contextDebug.refreshAria} onClick={() => void refreshContextDebug()} disabled={contextDebugLoading}><Icon name="replace" /></button></div>{current.id === "raw" ? <textarea aria-label={uiCopy.workbench.contextDebug.rawJsonAria} readOnly spellCheck={false} value={sectionText} /> : <pre>{sectionText}</pre>}</div>;
              })()}
            </section>
          </div>
        </section>
      </div> : null}
      {imageViewer ? <ImageViewer {...imageViewer} onClose={() => setImageViewer(null)} /> : null}
    </WorkbenchShell>
  );
}

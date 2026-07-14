"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CustomSelect } from "./CustomSelect";
import { ComicRenderer } from "./ComicRenderer";
import { AgentWorkspace, CanvasStage, CreationDock, CreationDrawer, ObjectToolbar, SessionDrawer, WorkbenchShell } from "./workbench/WorkbenchLayout";
import { FloatingMenu, MenuDivider, MenuSection } from "./workbench/FloatingPrimitives";
import { ReferenceCard } from "./workbench/ReferenceCard";
import { useOutsidePointerDismiss } from "./workbench/useOutsidePointerDismiss";
import { Icon } from "@/packages/ui/src";
import type {
  Candidate,
  AssetSummary,
  CanvasElement,
  ComicFrameElement,
  ComicPage,
  ImageElement,
  PageVariant,
  ReferencePlacement,
  SpeechBalloonElement,
  WorkspaceChangeSet,
  WorkspaceOperation,
} from "@/packages/shared/src";
import { createComicPageViews, deriveLocalTransform } from "@/packages/shared/src";
import { applyWorkspaceChangeSet, createSnapshot, planEditorCapability, type EditorCapabilityId } from "@/packages/editor-core/src";
import {
  createContinuationCandidate,
  createStoryboardLayoutCandidate,
  decideDemoInteraction,
  previewFixtures,
} from "@/packages/demo-runtime/src";
import {
  createDefaultWorkbench,
  loadWorkbench,
  persistWorkbench,
  type ActiveTaskLike,
  type AgentMessage,
  type PersistedWorkbench,
  type Selection,
} from "@/app/lib/workbench-state";
import { saveGeneratedImageFromUrl, saveUploadedImage } from "@/app/lib/local-assets-client";
import {
  apiApplyCandidate,
  apiApplyPageVariant,
  apiCancelTask,
  apiCommitChangeSet,
  apiCreateConversation,
  apiCreateTask,
  configuredRuntimeAdapter,
  apiDeletePlacement,
  apiDeletePageVariant,
  apiDiscardCandidate,
  apiGetContextDebugSnapshot,
  apiLoadWorkbench,
  apiPlaceAsset,
  apiRevertCandidate,
  apiSaveSnapshot,
  apiSaveCandidateVariant,
  apiSendInteraction,
  apiUpdateCanvasAssetListItem,
  apiUpdateComic,
  apiUpdateConversation,
  apiUpdatePlacement,
  apiUploadAsset,
  apiSaveCanvasAssetToLibrary,
  type RuntimeIds,
} from "@/app/lib/api-client";

type HistoryEntry = { fixture: PersistedWorkbench["fixture"]; label: string; kind: "working" | "placement" };
type ActiveTask = ActiveTaskLike;
type ToolbarSide = "top" | "bottom" | "left" | "right";
type ToolbarPlacement = { x: number; y: number; side: ToolbarSide };
type CanvasMode = "focus" | "free";
type CanvasObjectInteractionMode = "select" | "move" | "crop";
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
type PageDisplayMode = "single" | "spread";
type ContextDebugSection = "input" | "world" | "assets" | "storyboard" | "page_layout" | "activity" | "raw";
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

const noSelection: Selection = { type: "none", label: "未选择对象" };
const uid = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
// Keep new references clear of the left creation drawer while still close enough
// to be used alongside the page.
const canvasReferenceDropX = 320;
const intentOptions = ["分镜", "编排", "精修", "人物", "场景", "修改"].map((value) => ({ value, label: value }));
const canvasAssetSaveTypeOptions: Array<{ value: CanvasAssetSaveKind; label: string }> = [
  { value: "character", label: "角色" },
  { value: "scene", label: "场景" },
  { value: "prop", label: "道具" },
  { value: "reference_image", label: "参考图" },
];
const balloonStyleOptions = [
  { value: "normal", label: "对话气泡" },
  { value: "thought", label: "无尾气泡" },
  { value: "caption_box", label: "旁白框" },
  { value: "thought_balloon", label: "思考气泡", disabled: true },
  { value: "burst_balloon", label: "喊叫气泡", disabled: true },
  { value: "whisper_balloon", label: "低语气泡", disabled: true },
  { value: "broadcast_balloon", label: "电子气泡", disabled: true },
  { value: "wavy_balloon", label: "颤抖气泡", disabled: true },
];
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
  return firstFrame ? { type: "comic_frame", id: firstFrame.id, pageId: page.id, label: "格子 1" } : noSelection;
}

function overlapArea(a: DOMRect | { left: number; top: number; right: number; bottom: number }, b: { left: number; top: number; right: number; bottom: number }) {
  const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return width * height;
}

function containsRect(container: { left: number; top: number; right: number; bottom: number }, item: DOMRect, tolerance = 0.5) {
  return item.left >= container.left - tolerance
    && item.top >= container.top - tolerance
    && item.right <= container.right + tolerance
    && item.bottom <= container.bottom + tolerance;
}

function isFloatingCanvasControl(target: EventTarget | null) {
  return target instanceof Element && target.closest(".reference-card, .object-toolbar, .object-inspector, .balloon-editor-popover, .asset-reference-menu-floating, [role='menu'], input, textarea, select");
}


export function WorkbenchApp({ comicId, chapterId }: { comicId: string; chapterId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const assetCreateIntent = searchParams.get("assetCreate");
  const previewRoute = `/comics/${comicId}/chapters/${chapterId}/preview`;
  const [state, setState] = useState<PersistedWorkbench>(() => createDefaultWorkbench());
  const [hydrated, setHydrated] = useState(false);
  const [runtimeAdapter, setRuntimeAdapter] = useState<"loading" | "server" | "demo">("loading");
  const [runtimeError, setRuntimeError] = useState("");
  const [runtimeIds, setRuntimeIds] = useState<RuntimeIds | null>(null);
  const [workbenchMeta, setWorkbenchMeta] = useState({ comicTitle: "放学以后", chapterTitle: "第 1 话" });
  const [selection, setSelection] = useState<Selection>(noSelection);
  const [intent, setIntent] = useState("分镜");
  const [scope, setScope] = useState("当前一话");
  const [composer, setComposer] = useState("");
  const [explicitReferences, setExplicitReferences] = useState<ComposerReference[]>([]);
  const [composerAttachments, setComposerAttachments] = useState<Array<{ id: string; name: string; imageUrl: string }>>([]);
  const [composerReferenceOrder, setComposerReferenceOrder] = useState<string[]>([]);
  const [activeTask, setActiveTask] = useState<ActiveTask | null>(null);
  const [previewCandidateId, setPreviewCandidateId] = useState<string | null>(null);
  const [previewVariantId, setPreviewVariantId] = useState<string | null>(null);
  const [candidatePreviewMode, setCandidatePreviewMode] = useState<"original" | "candidate">("candidate");
  const [resolvedCardIds, setResolvedCardIds] = useState<Set<string>>(() => new Set());
  const [leftView, setLeftView] = useState<LeftView>("assets");
  const [assetMenuId, setAssetMenuId] = useState<string | null>(null);
  const [assetMenuPosition, setAssetMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [assetListOrder, setAssetListOrder] = useState<string[]>([]);
  const [assetRenameId, setAssetRenameId] = useState<string | null>(null);
  const [assetRenameDraft, setAssetRenameDraft] = useState("");
  const [assetSaveFormId, setAssetSaveFormId] = useState<string | null>(null);
  const [assetSaveDraft, setAssetSaveDraft] = useState<{ name: string; kind: CanvasAssetSaveKind }>({ name: "", kind: "reference_image" });
  const [assetSaveSubmitting, setAssetSaveSubmitting] = useState(false);
  const [storyboardMenuFrameId, setStoryboardMenuFrameId] = useState<string | null>(null);
  const [storyboardMenuPosition, setStoryboardMenuPosition] = useState<{ x: number; y: number } | null>(null);
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
  const [agentOpen, setAgentOpen] = useState(true);
  const [projectMenu, setProjectMenu] = useState(false);
  const [pageDisplayMode, setPageDisplayMode] = useState<PageDisplayMode>("single");
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [editingStoryboardBeatId, setEditingStoryboardBeatId] = useState<string | null>(null);
  const [editingStoryboardTarget, setEditingStoryboardTarget] = useState<StoryboardEditorTarget | null>(null);
  const [objectInteractionMode, setObjectInteractionMode] = useState<CanvasObjectInteractionMode>("select");
  const [toolbarPlacement, setToolbarPlacement] = useState<ToolbarPlacement | null>(null);
  const [balloonEditorPlacement, setBalloonEditorPlacement] = useState<{ x: number; y: number } | null>(null);
  const [canvasMode, setCanvasMode] = useState<CanvasMode>("focus");
  const [canvasOffset, setCanvasOffset] = useState({ x: 0, y: 0 });
  const [canvasScale, setCanvasScale] = useState(1);
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
  const chatUploadRef = useRef<HTMLInputElement>(null);
  const dockUploadRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const panRef = useRef<{ startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null);
  const marqueeRef = useRef<MarqueeState | null>(null);
  const multiMoveRef = useRef<MultiMoveState | null>(null);
  const suppressStageClickRef = useRef(false);
  const scenarioHandled = useRef(false);

  const closeFloatingMenus = (keep?: "project" | "asset" | "storyboard" | "session") => {
    if (keep !== "project") setProjectMenu(false);
    if (keep !== "asset") {
      setAssetMenuId(null);
      setAssetSaveFormId(null);
    }
    if (keep !== "storyboard") setStoryboardMenuFrameId(null);
    if (keep !== "session") setSessionMenuId(null);
  };

  useOutsidePointerDismiss(Boolean(assetMenuId || assetSaveFormId), ".asset-row, .asset-reference-menu-floating, .asset-save-form-floating", () => {
    setAssetMenuId(null);
    setAssetSaveFormId(null);
  });
  useOutsidePointerDismiss(Boolean(storyboardMenuFrameId), ".storyboard-frame-row, .storyboard-row-menu-floating", () => setStoryboardMenuFrameId(null));

  useEffect(() => {
    const ids = (state.assets ?? []).filter((asset) => asset.kind !== "generated_image").map((asset) => asset.id);
    const timer = window.setTimeout(() => setAssetListOrder((current) => {
        const retained = current.filter((id) => ids.includes(id));
        const missing = ids.filter((id) => !retained.includes(id));
        return retained.length === current.length && missing.length === 0 ? current : [...retained, ...missing];
      }), 0);
    return () => window.clearTimeout(timer);
  }, [state.assets]);

  useEffect(() => {
    if (!hydrated || !assetCreateIntent) return;
    const copy = assetCreateIntent === "character" ? "创建一个角色" : assetCreateIntent === "scene" ? "创建一个场景" : assetCreateIntent === "prop" ? "创建一个道具" : assetCreateIntent === "reference" ? "我想添加一张参考图" : "创建一个新资产";
    const timer = window.setTimeout(() => {
      setComposer(copy);
      setIntent(assetCreateIntent === "scene" ? "场景" : assetCreateIntent === "character" ? "人物" : "资产");
      setScope("当前漫画资产");
      setAgentOpen(true);
      setLeftView("assets");
      setToast("已准备好创建资产，补充描述后发送给 Agent。");
      router.replace(`/comics/${comicId}/chapters/${chapterId}`);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [assetCreateIntent, chapterId, comicId, hydrated, router]);

  const resolvedExplicitReferences = () => explicitReferences.map(({ objectType, objectId, versionId }) => ({ objectType, objectId, versionId }));

  const refreshContextDebug = async () => {
    if (runtimeAdapter !== "server" || !runtimeIds) {
      setContextDebugError("当前处于离线演示模式，无法读取服务端上下文。");
      return;
    }
    setContextDebugLoading(true);
    setContextDebugError("");
    try {
      const snapshot = await apiGetContextDebugSnapshot(runtimeIds.projectId, {
        conversationId: runtimeIds.conversationId,
        message: composer,
        intent,
        scope,
        selection: { type: selection.type, id: selection.id, pageId: selection.pageId, label: selection.label },
        explicitReferences: resolvedExplicitReferences(),
        currentPageIndex: state.currentPageIndex,
        workspaceMode: "comic",
        pendingAttachments: composerAttachments.map((attachment) => ({ name: attachment.name })),
      });
      setContextDebugSnapshot(snapshot);
      setContextDebugText(JSON.stringify(snapshot, null, 2));
    } catch (error) {
      setContextDebugError(error instanceof Error ? error.message : "读取当前上下文失败");
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
  const refreshServerWorkbench = async (conversationId = runtimeIds?.conversationId) => {
    const loaded = await apiLoadWorkbench(runtimeIds?.chapterId ?? chapterId, conversationId || undefined);
    const nextState = { ...loaded.state, currentPageIndex: Math.min(state.currentPageIndex, Math.max(0, loaded.state.fixture.working.document.units.length - 1)) };
    setState(nextState);
    setSelection((current) => repairSelectionForState(current, nextState));
    setRuntimeIds(loaded.ids);
    setWorkbenchMeta({ comicTitle: loaded.comic.title, chapterTitle: loaded.chapter.title });
    setPageDisplayMode(loaded.comic.canvasPageMode);
    setActiveTask(loaded.activeTask);
    return loaded;
  };

  useEffect(() => {
    let canceled = false;
    const hydrate = async () => {
      if (configuredRuntimeAdapter() === "demo") {
        const loaded = loadWorkbench();
        if (canceled) return;
        setState(loaded);
        setSelection((current) => repairSelectionForState(current, loaded));
        setRuntimeAdapter("demo");
        setHydrated(true);
        return;
      }
      try {
        const loaded = await apiLoadWorkbench(chapterId);
        if (canceled) return;
        setState(loaded.state);
        setSelection((current) => repairSelectionForState(current, loaded.state));
        setRuntimeIds(loaded.ids);
        setWorkbenchMeta({ comicTitle: loaded.comic.title, chapterTitle: loaded.chapter.title });
        setPageDisplayMode(loaded.comic.canvasPageMode);
        setActiveTask(loaded.activeTask);
        setRuntimeAdapter("server");
        setRuntimeError("");
      } catch (error) {
        if (canceled) return;
        setRuntimeAdapter("server");
        setRuntimeError(error instanceof Error ? error.message : "无法连接 Lantern API");
      } finally {
        if (!canceled) setHydrated(true);
      }
    };
    void hydrate();
    return () => { canceled = true; };
  }, [chapterId]);

  useEffect(() => {
    if (hydrated && runtimeAdapter === "demo") persistWorkbench(state);
  }, [hydrated, runtimeAdapter, state]);

  useEffect(() => {
    if (runtimeAdapter !== "server") return;
    const hasPendingTask = activeTask?.status === "running";
    if (!hasPendingTask) return;
    const timer = window.setInterval(() => void refreshServerWorkbench().catch(() => undefined), 900);
    return () => window.clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtimeAdapter, activeTask?.id, activeTask?.status]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!previewCandidateId && !previewVariantId) return;
    const timer = window.setTimeout(() => setCandidatePreviewMode("candidate"), 0);
    return () => window.clearTimeout(timer);
  }, [previewCandidateId, previewVariantId]);

  const workingPages = useMemo(() => createComicPageViews(state.fixture.working.document), [state.fixture.working.document]);
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
      .map((row, index) => ({ ...row, label: `画格 ${String(index + 1).padStart(2, "0")}` }));
  }, [state.fixture.storyboardBeats, workingPages]);
  const page = workingPages[state.currentPageIndex] ?? workingPages[0];
  const previewingCandidate = previewCandidateId
    ? state.candidates.find((candidate) => candidate.id === previewCandidateId && candidate.kind !== "asset" && candidate.status === "available")
    : undefined;
  const previewingVariant = previewVariantId ? state.pageVariants.find((variant) => variant.id === previewVariantId) : undefined;
  const variantPreviewDocument = useMemo(() => {
    if (!previewingVariant) return undefined;
    try {
      return applyWorkspaceChangeSet({ working: state.fixture.working, storyboardBeats: state.fixture.storyboardBeats }, {
        id: `preview:${previewingVariant.id}`,
        projectId: state.fixture.working.projectId,
        baseRevision: state.fixture.working.revision,
        source: "candidate",
        sourceCandidateId: previewingVariant.id,
        commands: previewingVariant.commands,
      }).working.document;
    } catch { return undefined; }
  }, [previewingVariant, state.fixture.storyboardBeats, state.fixture.working]);
  const candidateDocument = previewingCandidate?.document ?? variantPreviewDocument;
  const canvasDocument = candidatePreviewMode === "candidate" && candidateDocument ? candidateDocument : state.fixture.working.document;
  const canvasResolvedResources = useMemo(() => {
    const next = { ...(state.fixture.working.resolvedResources ?? {}) };
    const versionId = previewingCandidate?.metadata?.outputAssetVersionId;
    const previewUrl = previewingCandidate?.metadata?.previewUrl;
    if (versionId && previewUrl) next[versionId] = { url: previewUrl };
    return next;
  }, [previewingCandidate, state.fixture.working.resolvedResources]);
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
  const rawSelectedStoryboardBeatId = selection.type === "storyboard_beat" ? selection.id : selectedElement?.linkedStoryboardBeatId;
  const selectedStoryboardBeatId = rawSelectedStoryboardBeatId === "unassigned" ? undefined : rawSelectedStoryboardBeatId;
  const selectedStoryboardBeat = state.fixture.storyboardBeats.find((storyboardBeat) => storyboardBeat.id === selectedStoryboardBeatId);
  const selectedBalloonNumber = useMemo(() => {
    if (selection.type !== "speech_balloon" || !selection.id) return 0;
    return workingPages.flatMap((comicPage) => comicPage.elements.filter((element): element is SpeechBalloonElement => element.type === "speech_balloon")).findIndex((balloon) => balloon.id === selection.id) + 1;
  }, [selection.id, selection.type, workingPages]);
  const selectedFrameImage = useMemo(() => {
    const selectedPage = selection.pageId ? workingPages.find((item) => item.id === selection.pageId) : undefined;
    if (!selectedPage || selectedElement?.type !== "comic_frame") return undefined;
    return selectedPage.elements.find((element): element is ImageElement => element.type === "image" && element.comicFrameId === selectedElement.id);
  }, [selection.pageId, selectedElement, workingPages]);
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
      { id: "raw" as const, label: "原始 JSON", detail: "完整可复制快照", value: snapshot },
      { id: "input" as const, label: "输入与焦点", detail: `当前指令 · ${debugRecord(modelInput.task).type ?? "未指定"}`, value: { clientInput: snapshot.clientInput, modelTask: modelInput.task, focus: contextIndex.focus } },
      { id: "world" as const, label: "世界观背景", detail: indexWorld.summary ? "漫画级长期设定" : "尚未填写", value: Object.keys(indexWorld).length ? indexWorld : { summary: debugRecord(modelInput.comic).worldSummary ?? "" } },
      { id: "assets" as const, label: "角色与场景", detail: `${assets.length} 个上下文资产`, value: Object.keys(indexAssets).length ? indexAssets : { assets } },
      { id: "storyboard" as const, label: "分镜条目", detail: `${storyboardBeats.length} 个实际送入模型`, value: Object.keys(indexStoryboard).length ? indexStoryboard : { storyboardBeats, omittedContext: modelInput.omittedContext } },
      { id: "page_layout" as const, label: "编排与页面", detail: `${pages.length} 页工作稿`, value: Object.keys(indexLayout).length ? indexLayout : { pages } },
      { id: "activity" as const, label: "任务与会话", detail: "候选、任务、最近消息", value: Object.keys(indexActivity).length ? indexActivity : { tasks: debugRecord(snapshot.resolvedWorkspace).taskHistory, conversation: snapshot.conversation } },
    ];
  }, [contextDebugSnapshot]);
  const pageThumbSrc = (comicPage: ComicPage) => {
    const firstImage = comicPage.elements.find((element): element is ImageElement => element.type === "image");
    return firstImage ? assetSrcByKey.get(`${firstImage.assetId}:${firstImage.assetVersionId}`) : undefined;
  };

  useLayoutEffect(() => {
    const isCanvasSelection = selection.type !== "none" && selection.type !== "presentation_unit" && selection.type !== "reference_card";
    if (canvasMode !== "focus" || !isCanvasSelection || !selection.id || !stageRef.current) {
      setToolbarPlacement(null);
      return;
    }

    const updateToolbar = () => {
      const stage = stageRef.current;
      const element = stage?.querySelector<HTMLElement>(`[data-element-id="${selection.id}"]`);
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
          score: rawOutside * 28 + overlapArea(rect, selectedRect) * 2.5 - candidate.free * 0.18,
        };
      });

      const best = scored.sort((a, b) => a.score - b.score)[0];
      setToolbarPlacement({ x: best.x, y: best.y, side: best.side });
    };

    updateToolbar();
    window.addEventListener("resize", updateToolbar);
    const observer = new ResizeObserver(updateToolbar);
    observer.observe(stageRef.current);
    const element = stageRef.current.querySelector<HTMLElement>(`[data-element-id="${selection.id}"]`);
    if (element) observer.observe(element);
    return () => {
      window.removeEventListener("resize", updateToolbar);
      observer.disconnect();
    };
  }, [agentOpen, canvasMode, canvasOffset.x, canvasOffset.y, inspectorOpen, leftOpen, selectedElement?.geometry, selection.id, selection.pageId, selection.type]);

  useLayoutEffect(() => {
    if (canvasMode !== "focus" || !inspectorOpen || selection.type !== "speech_balloon" || !selection.id || !stageRef.current) {
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
      const height = 228;
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

  const addMessage = (message: Omit<AgentMessage, "id">) =>
    replaceMessages((messages) => [...messages, { ...message, id: uid("message") }]);

  const switchConversation = async (conversationId: string) => {
    if (activeTask?.status === "running") {
      setToast("请先停止当前任务，再切换对话");
      return;
    }
    try {
      await refreshServerWorkbench(conversationId);
      setSessionDrawerOpen(false);
      setResolvedCardIds(new Set());
      setToast("已切换对话");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "对话切换失败");
    }
  };

  const createConversation = async () => {
    const title = sessionTitleDraft.trim();
    if (!title) {
      setToast("请先填写对话名称");
      return;
    }
    if (runtimeAdapter !== "server" || !runtimeIds) {
      const initial = createDefaultWorkbench();
      const now = new Date().toISOString();
      setState((current) => ({ ...current, messages: initial.messages.slice(0, 0), candidates: [], conversations: [{ id: uid("conversation"), title, createdAt: now, updatedAt: now }, ...(current.conversations ?? [])] }));
      setSessionDrawerOpen(false);
      setSessionCreateOpen(false);
      setSessionTitleDraft("");
      setToast("已创建新的离线对话");
      return;
    }
    try {
      const created = await apiCreateConversation(runtimeIds.projectId, title);
      await refreshServerWorkbench(created.id);
      setSessionDrawerOpen(false);
      setSessionCreateOpen(false);
      setSessionTitleDraft("");
      setResolvedCardIds(new Set());
      setToast("新对话已创建");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "创建对话失败");
    }
  };

  const renameConversation = async (conversationId: string) => {
    const title = sessionRenameDraft.trim();
    if (!title) {
      setToast("请填写对话名称");
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
      setToast("对话已重命名");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "重命名失败");
    }
  };

  const deleteConversation = async (conversationId: string) => {
    if (activeTask?.status === "running") {
      setToast("请先停止当前任务，再删除对话");
      return;
    }
    try {
      if (runtimeAdapter === "server" && runtimeIds) {
        const isCurrent = conversationId === runtimeIds.conversationId;
        const next = state.conversations?.find((conversation) => conversation.id !== conversationId);
        const replacement = isCurrent && !next ? await apiCreateConversation(runtimeIds.projectId, "新的创作对话") : undefined;
        await apiUpdateConversation(conversationId, { archived: true });
        await refreshServerWorkbench(isCurrent ? (next?.id ?? replacement?.id) : undefined);
      } else {
        setState((current) => ({ ...current, conversations: current.conversations?.filter((conversation) => conversation.id !== conversationId) }));
      }
      setSessionRenameId(null);
      setSessionMenuId(null);
      setToast("对话已删除");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "删除对话失败");
    }
  };

  const stopActiveTask = async () => {
    if (!activeTask || activeTask.status !== "running") return;
    if (runtimeAdapter === "server" && !activeTask.id.includes("pending")) {
      try {
        await apiCancelTask(activeTask.id);
        await refreshServerWorkbench();
        setToast("任务取消请求已发送");
      } catch (error) {
        setToast(error instanceof Error ? error.message : "取消失败");
      }
      return;
    }
    setActiveTask({ ...activeTask, status: "canceled" });
    addMessage({ role: "agent", kind: "canceled", text: "任务已取消，没有产生可应用结果。" });
  };

  const pushHistory = (fixture: PersistedWorkbench["fixture"], label: string, kind: HistoryEntry["kind"]) => {
    setHistory((entries) => [...entries.slice(-39), { fixture: structuredClone(fixture), label, kind }]);
    setFuture([]);
  };

  const commitOperations = (operations: WorkspaceOperation[], label: string, source: "manual" | "candidate" = "manual", candidateId?: string, nextPageIndex?: number) => {
    if (runtimeAdapter === "server" && runtimeIds) {
      const changeSet = {
        id: uid("changeset"),
        projectId: runtimeIds.projectId,
        baseRevision: state.fixture.working.revision,
        source,
        sourceCandidateId: candidateId,
        commands: operations,
      } satisfies WorkspaceChangeSet;
      pushHistory(state.fixture, label, "working");
      setToast(`${label} · 正在持久化`);
      void apiCommitChangeSet(runtimeIds.projectId, changeSet)
        .then((result) => {
          setState((current) => ({ ...current, fixture: { ...current.fixture, ...result }, ...(typeof nextPageIndex === "number" ? { currentPageIndex: nextPageIndex } : {}) }));
          setToast(`${label} · 工作稿 r${result.working.revision}`);
        })
        .catch((error) => {
          setHistory((entries) => entries.slice(0, -1));
          setToast(error instanceof Error ? error.message : "持久化失败，旧内容保持不变");
          void refreshServerWorkbench().catch(() => undefined);
        });
      return true;
    }
    try {
      const result = applyWorkspaceChangeSet(
        { working: state.fixture.working, storyboardBeats: state.fixture.storyboardBeats },
        {
          id: uid("changeset"),
          projectId: state.fixture.working.projectId,
          baseRevision: state.fixture.working.revision,
          source,
          sourceCandidateId: candidateId,
          commands: operations,
        },
      );
      pushHistory(state.fixture, label, "working");
      setState((current) => ({ ...current, fixture: { ...current.fixture, ...result }, ...(typeof nextPageIndex === "number" ? { currentPageIndex: nextPageIndex } : {}) }));
      setToast(`${label} · 工作稿 r${result.working.revision}`);
      return true;
    } catch (error) {
      setToast(error instanceof Error && error.message.includes("REVISION_CONFLICT") ? "工作稿已变化，请重新生成候选" : "变更未应用，旧内容保持不变");
      return false;
    }
  };

  const commitCapability = (id: EditorCapabilityId, input: unknown, label: string, nextPageIndex?: number) => {
    try {
      const plan = planEditorCapability(id, input, {
        fixture: { working: state.fixture.working, storyboardBeats: state.fixture.storyboardBeats },
        createId: uid,
        actor: "human",
      });
      return commitOperations(plan.commands, label, "manual", undefined, nextPageIndex);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "编辑能力输入无效");
      return false;
    }
  };

  const commandsForElementPatch = (unitId: string, elementId: string, patch: Record<string, unknown>): WorkspaceOperation[] => {
    const pageView = workingPages.find((item) => item.id === unitId);
    const element = pageView?.elements.find((item) => item.id === elementId);
    if (!pageView || !element) return [];
    if (element.type === "comic_frame" && patch.geometry) {
      const geometry = patch.geometry as ComicFrameElement["geometry"];
      return geometry.width === element.geometry.width && geometry.height === element.geometry.height
        ? [{ type: "move_frame", unitId, frameId: element.id, position: { x: geometry.x, y: geometry.y } }]
        : [{ type: "resize_frame", unitId, frameId: element.id, geometry }];
    }
    if (element.type === "image") {
      if (patch.crop) return [{ type: "set_art_crop", unitId, frameId: element.comicFrameId!, layerId: element.layerId, elementId, crop: patch.crop as NonNullable<ImageElement["crop"]> }];
      if (patch.geometry && element.comicFrameId) {
        const frame = pageView.elements.find((item): item is ComicFrameElement => item.type === "comic_frame" && item.id === element.comicFrameId);
        if (frame) return [{ type: "set_element_transform", unitId, frameId: frame.id, layerId: element.layerId, elementId, transform: deriveLocalTransform(frame.geometry, patch.geometry as ImageElement["geometry"]) }];
      }
      if (typeof patch.zIndex === "number") return [{ type: "reorder_layer", unitId, frameId: element.comicFrameId!, layerId: element.layerId, zIndex: patch.zIndex }];
    }
    if (element.type === "speech_balloon") {
      const frame = pageView.elements.find((item): item is ComicFrameElement => item.type === "comic_frame" && item.id === element.comicFrameId);
      const changes: Record<string, unknown> = {};
      if (patch.transform) changes.transform = patch.transform;
      if (patch.tailTarget) changes.tailTarget = patch.tailTarget;
      if (patch.geometry && frame) changes.transform = deriveLocalTransform(frame.geometry, patch.geometry as SpeechBalloonElement["geometry"]);
      const content = patch.content as SpeechBalloonElement["content"] | undefined;
      if (content?.shape) changes.shape = content.shape;
      if (content?.tailTarget && frame) changes.tailTarget = { x: (content.tailTarget.x - frame.geometry.x) / frame.geometry.width, y: (content.tailTarget.y - frame.geometry.y) / frame.geometry.height };
      const commands: WorkspaceOperation[] = Object.keys(changes).length ? [{ type: "update_balloon", unitId, frameId: element.comicFrameId, layerId: element.layerId, elementId, changes: changes as never }] : [];
      if (content && content.text !== element.content.text) commands.push({ type: "update_dialogue", dialogueId: element.dialogueId, content: content.text });
      if (typeof patch.zIndex === "number") commands.push({ type: "reorder_layer", unitId, frameId: element.comicFrameId, layerId: element.layerId, zIndex: patch.zIndex });
      return commands;
    }
    return [];
  };

  const commitElementPatches = (unitId: string, patches: Array<{ elementId: string; patch: Record<string, unknown> }>, label: string) =>
    commitOperations(patches.flatMap(({ elementId, patch }) => commandsForElementPatch(unitId, elementId, patch)), label);

  const commitPlacement = (nextReferences: ReferencePlacement[], label: string) => {
    pushHistory(state.fixture, label, "placement");
    setState((current) => ({ ...current, fixture: { ...current.fixture, references: nextReferences } }));
    setToast(label);
  };

  const undo = () => {
    const entry = history[history.length - 1];
    if (!entry) return;
    setFuture((entries) => [...entries, { fixture: structuredClone(state.fixture), label: entry.label, kind: entry.kind }]);
    setHistory((entries) => entries.slice(0, -1));
    setState((current) => ({
      ...current,
      fixture:
        entry.kind === "placement"
          ? { ...current.fixture, references: structuredClone(entry.fixture.references) }
          : {
              ...entry.fixture,
              references: current.fixture.references,
              working: { ...entry.fixture.working, revision: current.fixture.working.revision + 1, createdAt: new Date().toISOString() },
            },
    }));
    setToast(`已撤销：${entry.label}`);
  };

  const redo = () => {
    const entry = future[future.length - 1];
    if (!entry) return;
    setHistory((entries) => [...entries, { fixture: structuredClone(state.fixture), label: entry.label, kind: entry.kind }]);
    setFuture((entries) => entries.slice(0, -1));
    setState((current) => ({
      ...current,
      fixture:
        entry.kind === "placement"
          ? { ...current.fixture, references: structuredClone(entry.fixture.references) }
          : {
              ...entry.fixture,
              references: current.fixture.references,
              working: { ...entry.fixture.working, revision: current.fixture.working.revision + 1, createdAt: new Date().toISOString() },
            },
    }));
    setToast(`已重做：${entry.label}`);
  };

  const finishTask = (task: ActiveTask, option?: string) => {
    if (task.name === "failure") {
      setActiveTask({ ...task, status: "failed", progress: 58 });
      addMessage({ role: "agent", kind: "failed", text: "图片 Provider 暂时不可用。旧工作稿没有改变，可以直接重试。", taskName: "failure" });
      return;
    }

    const baseRevision = state.fixture.working.revision;
    let candidates: Candidate[] = [];
    if (task.name === "continuation") {
      candidates = [createContinuationCandidate(baseRevision)];
    } else if (task.name === "frame_image_refine" || task.name === "frame_image_generate") {
      const targetImageId = selectedElement?.type === "image" ? selectedElement.id : selectedFrameImage?.id ?? "image-fixture-rain-beat-4";
      candidates = [{
        id: uid("candidate-storyboard"),
        kind: task.name === "frame_image_generate" ? "frame_image" : "frame_image_patch",
        title: task.name === "frame_image_generate" ? "当前格图片候选" : "撩发动作更自然",
        changeSummary: task.name === "frame_image_generate" ? "已生成一张新的格内成稿图候选；应用前不会替换当前画格。" : "只更新第 4 画格主图的裁切重心和关联分镜条目的动作描述；前三个画格保持不变。",
        targetLabel: selection.label || "当前格 04",
        baseRevision,
        status: "available",
        metadata: { pageId: selection.pageId ?? "page-1", elementId: targetImageId, storyboardBeatId: selectedStoryboardBeatId ?? "fixture-rain-beat-4", previewUrl: "/samples/rainy-station/frame-04.png" },
      }];
    } else if (task.name === "asset_parse") {
      const isScene = (option ?? "").includes("场景") || intent === "场景";
      candidates = [{ id: uid("candidate-asset"), kind: "asset", title: isScene ? "新场景候选" : "新角色候选", changeSummary: "已生成可编辑的资产描述和参考图；确认后才进入资产库与画布参考层。", targetLabel: "资产与画布参考层", baseRevision, status: "available", metadata: { imageSrc: isScene ? "/samples/rainy-station/scene-rain-bus-stop.png" : "/samples/rainy-station/character-lincheng.png", name: isScene ? "新场景" : "新角色" } }];
    } else if (option?.includes("条漫")) {
      candidates = [{ id: uid("candidate-vertical"), kind: "page_layout", title: "条漫慢节奏", changeSummary: "切换为条漫滚动段，并在回头前加入纵向停顿。", targetLabel: "整话格式", baseRevision, status: "available", document: previewFixtures.vertical }];
    } else if (option?.includes("固定四格")) {
      candidates = [{ id: uid("candidate-four"), kind: "page_layout", title: "固定四格 2×2", changeSummary: "切换为固定四格单元，不覆盖当前页漫布局。", targetLabel: "整话格式", baseRevision, status: "available", document: previewFixtures.four_panel }];
    } else if (task.name === "page_layout") {
      candidates = [createStoryboardLayoutCandidate(baseRevision, "cinematic")];
    } else {
      candidates = [createStoryboardLayoutCandidate(baseRevision, "quiet"), createStoryboardLayoutCandidate(baseRevision, "cinematic")];
    }

    candidates = candidates.map((candidate) => ({
      ...candidate,
      metadata: { ...candidate.metadata, taskId: task.id },
    }));
    setState((current) => ({ ...current, candidates: [...current.candidates, ...candidates] }));
    candidates.forEach((candidate) => addMessage({ role: "agent", kind: "candidate", text: candidate.changeSummary, scope: candidate.targetLabel, candidateId: candidate.id }));
    setActiveTask(null);
  };

  const runTask = (name = "storyboard", option?: string, explicitInstruction?: string, explicitScope?: string, explicitSelection?: Selection) => {
    const label = name === "continuation" ? "继续生成后续分镜" : name === "frame_image_generate" ? "生成当前格图片" : name === "frame_image_refine" ? "精修当前格" : name === "asset_parse" ? "创建角色或场景资产" : name === "failure" ? "模拟失败任务" : "生成分镜与编排候选";
    const taskScope = explicitScope ?? scope;
    const instruction = explicitInstruction ?? option ?? [...state.messages].reverse().find((message) => message.role === "user")?.text ?? label;
    const currentSelection = explicitSelection ?? selection;
    const currentState = state;
    const currentTargetElement = currentSelection.id && currentSelection.pageId
      ? createComicPageViews(currentState.fixture.working.document).find((item) => item.id === currentSelection.pageId)?.elements.find((item) => item.id === currentSelection.id)
      : undefined;
    if (activeTask?.status === "running") {
      setToast("当前会话已有任务运行中，请先等待或取消");
      return;
    }
    if ((name === "frame_image_generate" || name === "frame_image_refine") && currentTargetElement?.type !== "comic_frame" && currentTargetElement?.type !== "image") {
      setToast("请先选择当前工作稿中的漫画格或格内图片");
      return;
    }
    if (runtimeAdapter === "server" && runtimeIds) {
      const taskType = name === "continuation" ? "storyboard" : name === "failure" ? "storyboard" : name;
      const task: ActiveTask = { id: uid("task-pending"), name: taskType, label, scope: taskScope, progress: 3, status: "running" };
      setActiveTask(task);
      setToast(`${label} · 正在创建任务`);
      void apiCreateTask(runtimeIds, {
        taskType,
        instruction,
        scope: name === "continuation" ? "after_current" : taskScope,
        selection: { type: currentSelection.type, id: currentSelection.id, pageId: currentSelection.pageId, label: currentSelection.label },
      }).then(() => refreshServerWorkbench()).catch((error) => {
        setActiveTask(null);
        setToast(error instanceof Error ? error.message : "任务创建失败");
      });
      return;
    }
    const task: ActiveTask = { id: uid("task"), name, label, scope: taskScope, progress: 18, status: "running" };
    setActiveTask(task);
    addMessage({ role: "agent", kind: "task", text: `${label}正在进行。旧内容会一直保留到你应用候选。`, scope: taskScope, taskName: name, taskId: task.id });
    window.setTimeout(() => setActiveTask((current) => current?.id === task.id ? { ...current, progress: 62 } : current), 360);
    window.setTimeout(() => finishTask(task, option), 920);
  };

  const sendMessage = () => {
    if (activeTask?.status === "running") {
      setToast("任务运行期间已锁定对话；可以使用停止按钮取消任务");
      return;
    }
    const message = composer.trim();
    const attachments = composerAttachments;
    const interactionSelection = selection;
    if (!message && !attachments.length) return;
    const userText = message || `上传了 ${attachments.length} 张图片作为本轮参考。`;
    addMessage({ role: "user", kind: "plain", text: userText, attachments });
    if (runtimeAdapter === "server" && runtimeIds) {
      setComposer("");
      setComposerAttachments([]);
      setToast("Agent 正在理解当前工作台上下文");
      void apiSendInteraction(runtimeIds, {
        message: userText,
        intent,
        scope,
        selection: { type: interactionSelection.type, id: interactionSelection.id, pageId: interactionSelection.pageId, label: interactionSelection.label },
        explicitReferences: resolvedExplicitReferences(),
      }).then(async (result) => {
        await refreshServerWorkbench();
        if (result.decision.kind === "ready_to_run") {
          setScope(result.decision.scope);
          runTask(result.decision.taskType, undefined, userText, result.decision.scope, interactionSelection);
        }
      }).catch((error) => {
        setToast(error instanceof Error ? error.message : "Agent 暂时不可用");
      });
      return;
    }
    const decision = decideDemoInteraction(userText, selection.type);
    setComposer("");
    setComposerAttachments([]);
    if (decision.kind === "direct_answer") {
      addMessage({ role: "agent", kind: "plain", text: decision.message });
    } else if (decision.kind === "needs_input") {
      addMessage({ role: "agent", kind: "question", text: decision.message, options: decision.options, taskName: "storyboard" });
    } else if (decision.kind === "needs_confirmation") {
      setScope(decision.scope);
      addMessage({ role: "agent", kind: "confirmation", text: `${decision.message} ${decision.summary}`, scope: decision.scope, taskName: decision.task });
    } else {
      setScope(decision.scope);
      addMessage({ role: "agent", kind: "plain", text: decision.message, scope: decision.scope });
      runTask(decision.task);
    }
  };

  const applyCandidate = (candidate: Candidate, applyWithoutPreview = false) => {
    if (candidate.status !== "available") {
      setToast("这个候选已经终结，不能重复应用");
      return;
    }
    if (!applyWithoutPreview && previewCandidateId !== candidate.id) {
      setPreviewCandidateId(candidate.id);
      setToast("候选已在画布展开，请确认预览后再应用");
      return;
    }
    if (runtimeAdapter === "server") {
      setToast(`正在应用「${candidate.title}」`);
      void apiApplyCandidate(candidate.id, state.fixture.working.revision)
        .then(() => refreshServerWorkbench())
        .then(() => { setPreviewCandidateId(null); setCandidatePreviewMode("original"); setToast(`「${candidate.title}」已进入工作稿`); })
        .catch((error) => setToast(error instanceof Error ? error.message : "候选应用失败"));
      return;
    }
    if (candidate.baseRevision !== state.fixture.working.revision) {
      setState((current) => ({ ...current, candidates: current.candidates.map((item) => item.id === candidate.id ? { ...item, status: "stale" } : item) }));
      setToast("候选基于旧工作稿，需要重新生成");
      return;
    }
    let operations: WorkspaceOperation[];
    if (candidate.kind === "frame_image_patch" || candidate.kind === "frame_image") {
      const targetPage = candidate.metadata?.pageId ?? selection.pageId ?? "page-1";
      const targetElementCandidate = candidate.metadata?.elementId ?? selection.id ?? "image-fixture-rain-beat-4";
      const targetStoryboardBeat = candidate.metadata?.storyboardBeatId ?? selectedStoryboardBeatId ?? "fixture-rain-beat-4";
      const targetPageElements = workingPages.find((item) => item.id === targetPage)?.elements ?? [];
      const candidateElement = targetPageElements.find((item) => item.id === targetElementCandidate);
      const image =
        candidateElement?.type === "image"
          ? candidateElement
          : targetPageElements.find((item): item is ImageElement => item.type === "image" && item.comicFrameId === targetElementCandidate);
      const targetElement = image?.id ?? "image-fixture-rain-beat-4";
      const crop = image?.crop ?? { x: 0, y: 0.68, width: 1, height: 0.32 };
      operations = [
        ...commandsForElementPatch(targetPage, targetElement, { crop: { ...crop, x: Math.min(1 - crop.width, crop.x + 0.02), y: Math.max(0, crop.y - 0.025) } }),
        { type: "update_storyboard_beat", storyboardBeatId: targetStoryboardBeat, patch: { description: "少女更松弛地抬手，指尖轻轻拨开发梢。" } },
      ];
    } else if (candidate.document) {
      operations = candidate.commands ?? [{ type: "replace_chapter_presentation", document: candidate.document }];
    } else {
      setToast("这个候选没有可应用内容");
      return;
    }
    if (commitOperations(operations, `应用候选「${candidate.title}」`, "candidate", candidate.id)) {
      setPreviewCandidateId(null);
      setCandidatePreviewMode("original");
      setState((current) => ({ ...current, candidates: current.candidates.map((item) => item.id === candidate.id ? { ...item, status: "applied" } : item) }));
      addMessage({ role: "agent", kind: "plain", text: `「${candidate.title}」已作为一次原子变更进入工作稿。你可以一次撤销回到应用前。` });
    }
  };

  const discardCandidate = (candidateId: string) => {
    if (runtimeAdapter === "server") {
      void apiDiscardCandidate(candidateId)
        .then(() => refreshServerWorkbench())
        .then(() => setToast("候选已丢弃，工作稿未改变"))
        .catch((error) => setToast(error instanceof Error ? error.message : "候选丢弃失败"));
      return;
    }
    setState((current) => ({ ...current, candidates: current.candidates.map((item) => item.id === candidateId ? { ...item, status: "discarded" } : item) }));
    setToast("候选已丢弃，工作稿未改变");
  };

  const saveCandidateVariant = (candidate: Candidate) => {
    if (runtimeAdapter === "server") {
      void apiSaveCandidateVariant(candidate.id)
        .then(() => refreshServerWorkbench())
        .then(() => setToast(`已保存页面方案「${candidate.title}」`))
        .catch((error) => setToast(error instanceof Error ? error.message : "页面方案保存失败"));
      return;
    }
    const commands = candidate.commands ?? (candidate.document ? [{ type: candidate.kind === "page_layout" ? "replace_chapter_layout" as const : "replace_chapter_presentation" as const, document: candidate.document }] : []);
    if (!commands.length) { setToast("这个候选没有可保存的页面变更"); return; }
    const unitId = "unitId" in commands[0] && typeof commands[0].unitId === "string" ? commands[0].unitId : candidate.document?.reading.unitOrder[0] ?? page?.id ?? "chapter";
    const variant: PageVariant = {
      id: uid("page-variant"), projectId: state.fixture.working.projectId, unitId, name: candidate.title,
      kind: candidate.kind === "page_layout" ? "layout_only" : "partial_frames", baseRevision: candidate.baseRevision,
      scope: candidate.scope ?? { type: "presentation_unit", unitId }, commands, sourceCandidateId: candidate.id,
      createdAt: new Date().toISOString(), status: "saved",
    };
    setState((current) => ({ ...current, pageVariants: [...current.pageVariants, variant] }));
    setToast(`已保存页面方案「${candidate.title}」`);
  };

  const applySavedVariant = (variant: PageVariant) => {
    if (runtimeAdapter === "server") {
      void apiApplyPageVariant(variant.id, state.fixture.working.revision).then(() => refreshServerWorkbench()).then(() => { setPreviewVariantId(null); setCandidatePreviewMode("original"); setToast(`已应用页面方案「${variant.name}」`); }).catch((error) => setToast(error instanceof Error ? error.message : "页面方案应用失败"));
      return;
    }
    if (commitOperations(variant.commands, `应用页面方案「${variant.name}」`, "candidate", variant.id)) { setState((current) => ({ ...current, pageVariants: current.pageVariants.map((item) => item.id === variant.id ? { ...item, status: "applied" } : item) })); setPreviewVariantId(null); setCandidatePreviewMode("original"); }
  };

  const removeSavedVariant = (variant: PageVariant) => {
    if (runtimeAdapter === "server") {
      void apiDeletePageVariant(variant.id).then(() => refreshServerWorkbench()).then(() => setToast("页面方案已删除")).catch((error) => setToast(error instanceof Error ? error.message : "页面方案删除失败"));
      return;
    }
    setState((current) => ({ ...current, pageVariants: current.pageVariants.filter((item) => item.id !== variant.id) }));
    if (previewVariantId === variant.id) setPreviewVariantId(null);
    setToast("页面方案已删除");
  };

  const revertCandidate = (candidate: Candidate) => {
    if (candidate.status !== "applied") return;
    if (runtimeAdapter === "server") {
      void apiRevertCandidate(candidate.id)
        .then(() => refreshServerWorkbench())
        .then(() => setToast(`已撤回「${candidate.title}」的应用`))
        .catch((error) => setToast(error instanceof Error ? error.message : "候选回退失败"));
      return;
    }
    const entry = history[history.length - 1];
    if (!entry || !entry.label.includes(candidate.title)) {
      setToast("应用后已有其他修改，请使用版本历史回退");
      return;
    }
    undo();
    setState((current) => ({ ...current, candidates: current.candidates.map((item) => item.id === candidate.id ? { ...item, status: "reverted" } : item) }));
  };

  const saveChapter = () => {
    if (runtimeAdapter === "server" && runtimeIds) {
      void apiSaveSnapshot(runtimeIds.chapterId, state.fixture.working.revision)
        .then(() => refreshServerWorkbench())
        .then(() => setToast(`一话已保存 · 快照 r${state.fixture.working.revision}`))
        .catch((error) => setToast(error instanceof Error ? error.message : "保存失败"));
      setProjectMenu(false);
      return;
    }
    try {
      const snapshot = createSnapshot(state.fixture.working, state.fixture.working.revision);
      setState((current) => ({ ...current, fixture: { ...current.fixture, snapshot } }));
      setProjectMenu(false);
      setToast(`一话已保存 · 快照 r${snapshot.sourceWorkingRevision}`);
    } catch {
      setToast("工作稿已变化，请重新保存");
    }
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
        setToast(error instanceof Error ? error.message : "参考卡保存失败");
        void refreshServerWorkbench().catch(() => undefined);
      });
      return;
    }
    commitPlacement(state.fixture.references.map((item) => item.id === id ? { ...item, ...patch } : item), label);
  };

  const deleteReference = (id: string) => {
    if (runtimeAdapter === "server") {
      setState((current) => ({ ...current, fixture: { ...current.fixture, references: current.fixture.references.filter((item) => item.id !== id) } }));
      setSelection(noSelection);
      void apiDeletePlacement(id).then(() => setToast("画布对象已删除；资产库内容保持不变")).catch((error) => {
        setToast(error instanceof Error ? error.message : "删除画布对象失败");
        void refreshServerWorkbench().catch(() => undefined);
      });
      return;
    }
    commitPlacement(state.fixture.references.filter((item) => item.id !== id), "删除画布对象");
    setSelection(noSelection);
  };

  const moveReferences = (ids: string[], deltaX: number, deltaY: number) => {
    if (!ids.length || (!deltaX && !deltaY)) return;
    const selectedIds = new Set(ids);
    const nextReferences = state.fixture.references.map((item) => selectedIds.has(item.id) ? { ...item, x: item.x + deltaX, y: item.y + deltaY } : item);
    if (runtimeAdapter === "server") {
      setState((current) => ({ ...current, fixture: { ...current.fixture, references: nextReferences } }));
      void Promise.all(nextReferences.filter((item) => selectedIds.has(item.id)).map((item) => apiUpdatePlacement(item.id, { x: item.x, y: item.y })))
        .then(() => setToast(`已移动 ${ids.length} 个画布元素`))
        .catch((error) => {
          setToast(error instanceof Error ? error.message : "批量移动画布元素失败");
          void refreshServerWorkbench().catch(() => undefined);
        });
      return;
    }
    commitPlacement(nextReferences, `已移动 ${ids.length} 个画布元素`);
  };

  const removeReferences = (ids: string[]) => {
    if (!ids.length) return;
    const selectedIds = new Set(ids);
    const nextReferences = state.fixture.references.filter((item) => !selectedIds.has(item.id));
    if (runtimeAdapter === "server") {
      setState((current) => ({ ...current, fixture: { ...current.fixture, references: nextReferences } }));
      void Promise.all(ids.map((id) => apiDeletePlacement(id)))
        .then(() => setToast(`已从画布移除 ${ids.length} 个元素；资产库内容保持不变`))
        .catch((error) => {
          setToast(error instanceof Error ? error.message : "批量移除画布元素失败");
          void refreshServerWorkbench().catch(() => undefined);
        });
      return;
    }
    commitPlacement(nextReferences, `已从画布移除 ${ids.length} 个元素`);
  };

  const changeReferenceLayer = (reference: ReferencePlacement, action: "up" | "down" | "top" | "bottom") => {
    const levels = state.fixture.references.map((item) => item.zIndex ?? 10);
    const current = reference.zIndex ?? 10;
    const next = action === "top" ? Math.max(...levels, 10) + 1
      : action === "bottom" ? Math.max(0, Math.min(...levels, 10) - 1)
        : action === "up" ? current + 1 : Math.max(0, current - 1);
    updateReference(reference.id, { zIndex: next }, action === "top" ? "已置于顶层" : action === "bottom" ? "已置于底层" : action === "up" ? "已上移一层" : "已下移一层");
  };

  const addComposerReference = (reference: ComposerReference) => {
    setExplicitReferences((items) => items.some((item) => item.id === reference.id) ? items : [reference, ...items]);
    setComposerReferenceOrder((items) => [`reference:${reference.id}`, ...items.filter((item) => item !== `reference:${reference.id}`)]);
  };

  const addAssetReference = (asset: AssetSummary) => {
    if (!asset.versionId) {
      setToast("这个资产还没有可引用的版本。");
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
    else setToast("这个画布参考还没有可引用的资产版本。");
  };

  const addSelectionReference = (targetSelection: Selection = selection) => {
    if (!targetSelection.id || targetSelection.type === "none" || targetSelection.type === "presentation_unit" || targetSelection.type === "reference_card") return;
    if (targetSelection.type === "storyboard_beat") {
      const beat = state.fixture.storyboardBeats.find((item) => item.id === targetSelection.id);
      if (!beat) return;
      addComposerReference({ id: `storyboard:${beat.id}:${beat.versionId}`, objectType: "storyboard_beat", objectId: beat.id, versionId: beat.versionId, label: targetSelection.label, kind: "storyboard_beat" });
      setAgentOpen(true);
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
        label: `对白 ${String(balloonNumber || 1).padStart(2, "0")}`,
        kind: "speech_balloon",
        balloonNumber: balloonNumber || 1,
        dialogueText: targetElement.content.text,
      });
      setScope("当前气泡");
      setAgentOpen(true);
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
        label: `画格 ${String(frame.readingOrder).padStart(2, "0")} · 格内成稿`,
        kind: "comic_frame",
        imageUrl,
      });
      setScope("当前画格");
      setAgentOpen(true);
      return;
    }
    addComposerReference({ id: `canvas:${targetElement.id}`, objectType: "canvas_element", objectId: targetElement.id, label: targetSelection.label, kind: "canvas_element" });
    setAgentOpen(true);
  };

  const navigateToCandidateImage = (candidate: Candidate) => {
    const reference = state.fixture.references.find((item) => item.assetId === candidate.metadata?.outputAssetId);
    setAgentOpen(true);
    if (!reference) {
      setToast("生成图已保留在主画布；刷新后可定位");
      return;
    }
    const stage = stageRef.current?.getBoundingClientRect();
    if (stage) setCanvasOffset({ x: Math.round(stage.width * 0.5 - reference.x - 120), y: Math.round(stage.height * 0.45 - reference.y - 100) });
    setSelection({ type: "reference_card", id: reference.id, label: reference.name });
    setScope("生成图片");
    setToast(`已定位「${reference.name}」`);
  };

  const applyInspectorEdit = () => {
    if (selection.type === "speech_balloon") {
      const balloon = selectedElement as SpeechBalloonElement | undefined;
      const value = editDraft.dialogue ?? balloon?.content.text ?? "";
      if (balloon?.dialogueId) commitCapability("update_dialogue", { dialogueId: balloon.dialogueId, content: value }, "编辑气泡对白");
    } else if (editingStoryboardTarget) {
      const title = (editDraft.title ?? editingStoryboardBeat?.title ?? "").trim();
      const description = (editDraft.description ?? editingStoryboardBeat?.description ?? "").trim();
      if (!title) {
        setToast("请先填写单格标题");
        return;
      }
      if (editingStoryboardBeatId) {
        const patch = {
          ...(editDraft.title !== undefined ? { title: editDraft.title.trim() } : {}),
          ...(editDraft.description !== undefined ? { description: editDraft.description.trim() } : {}),
        };
        if (Object.keys(patch).length) {
          commitCapability("update_storyboard_beat", { storyboardBeatId: editingStoryboardBeatId, patch }, "编辑单格画面");
        }
      } else {
        commitCapability("create_frame_storyboard_beat", {
          unitId: editingStoryboardTarget.unitId,
          frameId: editingStoryboardTarget.frameId,
          title,
          description,
        }, "创建单格画面");
      }
    }
    setEditDraft({});
    if (selection.type === "speech_balloon" || editingStoryboardTarget) {
      setEditingStoryboardBeatId(null);
      setEditingStoryboardTarget(null);
      setInspectorOpen(false);
    }
  };

  const cropImage = (direction: "in" | "out" | "left" | "right" | "up" | "down" | "reset") => {
    if (!selectedElement || selectedElement.type !== "image" || !selection.pageId) return;
    const crop = selectedElement.crop ?? { x: 0, y: 0, width: 1, height: 1 };
    const next = { ...crop };
    if (direction === "in") { next.width = Math.max(0.45, crop.width - 0.08); next.height = Math.max(0.22, crop.height - 0.05); }
    if (direction === "out") { next.width = Math.min(1, crop.width + 0.08); next.height = Math.min(1, crop.height + 0.05); }
    if (direction === "left") next.x = Math.max(0, crop.x - 0.03);
    if (direction === "right") next.x = Math.min(1 - next.width, crop.x + 0.03);
    if (direction === "up") next.y = Math.max(0, crop.y - 0.03);
    if (direction === "down") next.y = Math.min(1 - next.height, crop.y + 0.03);
    if (direction === "reset") Object.assign(next, { x: 0, y: 0, width: 1, height: 1 });
    next.x = Math.min(next.x, 1 - next.width); next.y = Math.min(next.y, 1 - next.height);
    commitCapability("set_art_crop", {
      unitId: selection.pageId,
      frameId: selectedElement.comicFrameId,
      layerId: selectedElement.layerId,
      elementId: selectedElement.id,
      crop: next,
    }, "调整图片裁切");
  };

  const beginCrop = () => {
    if (selection.type === "speech_balloon") {
      setToast("对白气泡不支持裁切；请使用移动模式调整位置、大小和尖尾");
      return;
    }
    const image = selectedElement?.type === "image" ? selectedElement : selectedFrameImage;
    if (!image || !selection.pageId) {
      setToast("当前对象没有可裁切的格内图片");
      return;
    }
    setSelection({ type: "image", id: image.id, pageId: selection.pageId, label: `${selection.label} · 格内图片裁切` });
    setInspectorOpen(false);
    setObjectInteractionMode("crop");
    setToast("已进入裁切模式：拖动图片调整当前画格取景");
  };

  const endCrop = () => {
    const image = selectedElement?.type === "image" ? selectedElement : undefined;
    if (image?.comicFrameId && selection.pageId) {
      setSelection({ type: "comic_frame", id: image.comicFrameId, pageId: selection.pageId, label: "当前画格" });
      setScope("当前漫画格");
    }
    setObjectInteractionMode("select");
    setToast("已退出裁切模式");
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
    setScope("当前漫画格");
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
    const frameId = selectedElement?.type === "image" ? selectedElement.comicFrameId : selectedElement?.type === "comic_frame" ? selectedElement.id : undefined;
    if ((selection.type === "comic_frame" || selection.type === "image") && selection.pageId && frameId) {
      openStoryboardEditorForFrame(selection.pageId, frameId, selection.label);
      return;
    }
    setToast("请选择一个画格");
  };

  const updateBalloonShape = (shape: SpeechBalloonElement["content"]["shape"]) => {
    if (selection.type !== "speech_balloon" || selectedElement?.type !== "speech_balloon" || !selection.pageId) return;
    commitOperations(commandsForElementPatch(selection.pageId, selectedElement.id, { content: { ...selectedElement.content, shape } }), "调整对白气泡样式");
  };

  const handleAgentUpload = (file?: File) => {
    if (!file) return;
    const imageUrl = URL.createObjectURL(file);
    const attachment = { id: uid("chat-image"), name: file.name, imageUrl };
    setComposerAttachments((items) => [attachment, ...items]);
    setComposerReferenceOrder((items) => [`attachment:${attachment.id}`, ...items]);
    setToast("图片已作为本轮对话引用");
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
          setToast("图片已加入当前画布与资产列表");
        } catch (error) {
          // Upload has already succeeded. Avoid presenting a stale-workbench
          // refresh failure as an upload failure, which encourages duplicate
          // retries and makes a canvas-only image look incorrectly imported.
          setToast(error instanceof Error ? `图片已保存，刷新列表失败：${error.message}` : "图片已保存，刷新列表失败，请刷新页面");
        }
        return;
      }
      const asset = await saveUploadedImage(file);
      const reference: ReferencePlacement = {
        id: uid("reference-upload"),
        kind: "reference_image",
        name: file.name.replace(/\.[^.]+$/, "") || "上传参考",
        detail: "手动上传 · 画布参考",
        imageSrc: asset.url,
        localAssetId: asset.id,
        localAssetSource: "upload",
        x: canvasReferenceDropX,
        y: 220 + canvasReferences.length * 42,
        zoom: 1,
        collapsed: false,
        pinned: false,
      };
      commitPlacement([...state.fixture.references, reference], "上传图片到画布参考区");
      setSelection({ type: "reference_card", id: reference.id, label: reference.name });
      setToast("图片已放到画布参考层");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "图片保存失败，请重试");
    }
  };

  const placeLibraryAssetOnCanvas = async (asset: AssetSummary) => {
    const x = canvasReferenceDropX;
    const y = 150 + canvasReferences.length * 34;
    if (!asset.contentUrl) {
      setToast("这个资产还没有确认图片，请先生成或上传一个版本");
      return;
    }
    if (runtimeAdapter === "server" && runtimeIds) {
      try {
        await apiPlaceAsset(runtimeIds.projectId, asset.id, x, y);
        await refreshServerWorkbench();
        setToast(`「${asset.name}」已放到画布参考层`);
      } catch (error) {
        setToast(error instanceof Error ? error.message : "资产放置失败");
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
    commitPlacement([...state.fixture.references, reference], `把「${asset.name}」放到画布参考层`);
  };

  const openSaveAssetForm = (asset: AssetSummary, position?: { x: number; y: number }) => {
    if (!asset.canvasListItemId || asset.libraryStatus === "library") return;
    const savedKind: CanvasAssetSaveKind = asset.kind === "character" || asset.kind === "scene" || asset.kind === "prop" ? asset.kind : "reference_image";
    setAssetSaveDraft({ name: asset.name, kind: savedKind });
    setAssetMenuId(null);
    if (position) setAssetMenuPosition(position);
    setAssetSaveFormId(asset.id);
  };

  const openReferenceSaveAssetForm = (reference: ReferencePlacement, anchor: { left: number; right: number; top: number; bottom: number }) => {
    const asset = state.assets?.find((item) => item.id === reference.assetId || item.id === reference.localAssetId);
    if (!asset) {
      setToast("这张图片尚未写入画布资产列表，暂时无法保存到资产空间。");
      return;
    }
    const workbenchRect = document.querySelector<HTMLElement>(".workbench")?.getBoundingClientRect();
    if (!workbenchRect) return;
    const formWidth = 248;
    const formHeight = 224;
    const drawerRight = document.querySelector<HTMLElement>(".creation-drawer:not(.closed)")?.getBoundingClientRect().right;
    const agentLeft = document.querySelector<HTMLElement>(".agent-workspace.open")?.getBoundingClientRect().left;
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
      setToast("已保存到资产空间");
      return;
    }
    setAssetSaveSubmitting(true);
    try {
      await apiSaveCanvasAssetToLibrary(asset.canvasListItemId, { name, kind: assetSaveDraft.kind });
      setAssetSaveFormId(null);
      router.push(`/comics/${comicId}/assets?from=workbench&chapterId=${chapterId}&filter=${assetSaveDraft.kind === "reference_image" ? "reference" : assetSaveDraft.kind}`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "保存到资产空间失败");
    } finally {
      setAssetSaveSubmitting(false);
    }
  };

  const pinAssetInList = (asset: AssetSummary) => {
    setAssetMenuId(null);
    if (runtimeAdapter === "server" && asset.canvasListItemId) {
      void apiUpdateCanvasAssetListItem(asset.canvasListItemId, { pinned: true }).then(() => {
        setState((current) => ({ ...current, assets: current.assets?.map((item) => item.id === asset.id ? { ...item, pinned: true } : item) }));
        setToast(`已置顶「${asset.name}」`);
      }).catch((error) => setToast(error instanceof Error ? error.message : "置顶失败"));
      return;
    }
    setAssetListOrder((current) => [asset.id, ...current.filter((id) => id !== asset.id)]);
    setState((current) => ({ ...current, assets: current.assets?.map((item) => item.id === asset.id ? { ...item, pinned: true } : item) }));
    setToast(`已置顶「${asset.name}」`);
  };

  const removeAssetFromList = (asset: AssetSummary) => {
    setAssetMenuId(null);
    if (runtimeAdapter === "server" && asset.canvasListItemId) {
      void apiUpdateCanvasAssetListItem(asset.canvasListItemId, { hidden: true }).then(() => {
        setState((current) => ({ ...current, assets: current.assets?.filter((item) => item.id !== asset.id) }));
        setToast(`已从列表移除「${asset.name}」`);
      }).catch((error) => setToast(error instanceof Error ? error.message : "从列表移除失败"));
      return;
    }
    setState((current) => ({ ...current, assets: current.assets?.filter((item) => item.id !== asset.id) }));
    setToast(`已从列表移除「${asset.name}」`);
  };

  const renameAssetInList = (asset: AssetSummary) => {
    const displayName = assetRenameDraft.trim();
    if (!displayName) return;
    if (runtimeAdapter === "server" && asset.canvasListItemId) {
      void apiUpdateCanvasAssetListItem(asset.canvasListItemId, { displayName }).then(() => {
        setState((current) => ({ ...current, assets: current.assets?.map((item) => item.id === asset.id ? { ...item, name: displayName } : item) }));
        setAssetRenameId(null);
        setAssetRenameDraft("");
        setToast(`已修改当前画布中的名称为「${displayName}」`);
      }).catch((error) => setToast(error instanceof Error ? error.message : "重命名失败"));
      return;
    }
    setState((current) => ({ ...current, assets: current.assets?.map((item) => item.id === asset.id ? { ...item, name: displayName } : item) }));
    setAssetRenameId(null);
    setAssetRenameDraft("");
  };

  const applyAssetCandidate = async (candidate: Candidate) => {
    if (runtimeAdapter === "server") {
      const result = await apiApplyCandidate(candidate.id, state.fixture.working.revision);
      const loaded = await refreshServerWorkbench();
      const savedAsset = result.asset?.id ? loaded.state.assets?.find((asset) => asset.id === result.asset?.id) : undefined;
      if (savedAsset) router.push(`/comics/${comicId}/assets?from=workbench&chapterId=${chapterId}&asset=${encodeURIComponent(savedAsset.id)}`);
      setToast(`「${candidate.title}」已保存到资产，并可回到主画布引用`);
      return;
    }
    let imageSrc = candidate.metadata?.imageSrc;
    if (!imageSrc) {
      setToast("这个候选还没有可用参考图。");
      return;
    }
    let localAssetId = candidate.metadata?.localAssetId;
    if (!localAssetId && imageSrc) {
      try {
        const asset = await saveGeneratedImageFromUrl(imageSrc, `${candidate.title || "generated-reference"}.png`);
        imageSrc = asset.url;
        localAssetId = asset.id;
      } catch {
        setToast("生成图保存失败，请重试");
        return;
      }
    }
    const localAssetSource = localAssetId ? (candidate.metadata?.localAssetSource === "upload" ? "upload" : "generated") : undefined;
    const reference: ReferencePlacement = { id: uid("reference"), kind: "sketch", name: candidate.metadata?.name ?? "新草稿", detail: "已确认 · 构图参考", imageSrc, localAssetId, localAssetSource, x: 24, y: 220, zoom: 1, collapsed: false, pinned: false };
    commitPlacement([...state.fixture.references, reference], "把草稿放到画布参考区");
    setState((current) => ({ ...current, candidates: current.candidates.map((item) => item.id === candidate.id ? { ...item, status: "applied" } : item) }));
  };

  useEffect(() => {
    if (!hydrated || scenarioHandled.current) return;
    scenarioHandled.current = true;
    const scenario = new URLSearchParams(window.location.search).get("scenario");
    const timer = window.setTimeout(() => {
      if (scenario === "failure") runTask("failure");
      if (scenario === "stale") {
        const stale = { ...createStoryboardLayoutCandidate(Math.max(0, state.fixture.working.revision - 1)), id: uid("candidate-stale"), status: "stale" as const, title: "基于旧工作稿的编排" };
        setState((current) => ({ ...current, candidates: [...current.candidates, stale] }));
        addMessage({ role: "agent", kind: "candidate", text: "这个候选基于旧工作稿，不能直接应用。", scope: "已过期", candidateId: stale.id });
      }
      if (scenario === "story") {
        setComposer("我想做一个雨夜末班车的轻悬疑短篇");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  const exitMultiSelection = () => {
    setMultiSelection(null);
    setMultiMoveDelta({ x: 0, y: 0 });
    multiMoveRef.current = null;
  };

  const switchCanvasMode = (mode: CanvasMode) => {
    exitMultiSelection();
    setCanvasMode(mode);
    if (mode === "focus") {
      setCanvasOffset({ x: 0, y: 0 });
      setCanvasScale(1);
      setToast("聚焦模式 · 页面回到画面中心");
    } else {
      setToast("自由模式 · 拖动画布查看参考和页面");
    }
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
    const operations: WorkspaceOperation[] = [];
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
      operations.push(...commandsForElementPatch(item.pageId, item.id, { geometry }));
    });
    if (operations.length) commitOperations(operations, `已移动 ${multiSelection.comic.length} 个漫画元素`);
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
      if (element.type === "comic_frame") return [{ type: "comic_frame", id: element.id, pageId: comicPage.id, label: `画格 ${String(element.readingOrder).padStart(2, "0")}` }];
      if (element.type === "image") return [{ type: "image", id: element.id, pageId: comicPage.id, label: element.name ?? "画格图片" }];
      if (element.type === "speech_balloon") return [{ type: "speech_balloon", id: element.id, pageId: comicPage.id, label: `对白 ${String(balloonOrder.get(element.id) ?? 1).padStart(2, "0")}` }];
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
    setToast("已进入多选模式");
  };

  const handleCanvasPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
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
    if (canvasMode !== "free" || isFloatingCanvasControl(event.target)) return;
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

  const handleCanvasPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
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
    if (objectInteractionMode !== "select") return;
    if (suppressStageClickRef.current) {
      suppressStageClickRef.current = false;
      return;
    }
    if (multiSelection) return;
    if (canvasMode === "focus") setSelection(noSelection);
  };

  const addBlankComicPage = () => {
    const pageIndex = state.fixture.working.document.units.length;
    if (commitCapability("create_page", {}, "新增空白页", pageIndex)) setSelection(noSelection);
  };

  const currentPages = workingPages;
  const trailingUnpairedPage = pageDisplayMode === "spread" && currentPages.length % 2 === 1 && state.currentPageIndex === currentPages.length - 1;
  const spreadStartIndex = Math.floor(state.currentPageIndex / 2) * 2;
  const displayedPageIndices = pageDisplayMode === "spread" && !trailingUnpairedPage
    ? [spreadStartIndex, spreadStartIndex + 1].filter((index) => index < currentPages.length)
    : [state.currentPageIndex].filter((index) => index < currentPages.length);
  const setCurrentComicPage = (index: number) => {
    setState((current) => ({ ...current, currentPageIndex: clampValue(index, 0, Math.max(0, current.fixture.working.document.units.length - 1)) }));
  };
  const togglePageDisplayMode = () => {
    const previous = pageDisplayMode;
    const mode: PageDisplayMode = previous === "single" ? "spread" : "single";
    setPageDisplayMode(mode);
    if (runtimeAdapter !== "server") return;
    void apiUpdateComic(comicId, { canvasPageMode: mode })
      .catch(() => {
        setPageDisplayMode(previous);
        setToast("页面模式未保存，请稍后重试");
      });
  };
  const openBalloonEditor = (balloon?: SpeechBalloonElement, comicPage: ComicPage | undefined = page) => {
    if (!balloon || !comicPage) {
      setToast("当前页还没有对白气泡");
      return;
    }
    setSelection({ type: "speech_balloon", id: balloon.id, pageId: comicPage.id, label: balloon.name ?? "对白气泡" });
    setEditingStoryboardBeatId(null);
    setEditingStoryboardTarget(null);
    setInspectorOpen(false);
    setEditDraft({});
    setScope("当前气泡");
  };
  const handleCanvasSelection = (next: Selection) => {
    if (multiSelection) return;
    const selectedPageIndex = next.pageId ? workingPages.findIndex((item) => item.id === next.pageId) : -1;
    if (selectedPageIndex >= 0 && selectedPageIndex !== state.currentPageIndex) setCurrentComicPage(selectedPageIndex);
    setSelection(next);
    setEditingStoryboardBeatId(null);
    setEditingStoryboardTarget(null);
    setInspectorOpen(false);
    const element = workingPages.find((item) => item.id === next.pageId)?.elements.find((item) => item.id === next.id);
    setScope(next.type === "presentation_unit" ? "当前页" : next.type === "reference_card" ? "仅参考" : next.type === "comic_frame" ? "当前漫画格" : next.type === "image" ? "格内图片裁切" : next.type === "speech_balloon" ? "当前气泡" : "当前格");
    if (element?.linkedStoryboardBeatId) setEditDraft({});
  };
  const availableCandidates = state.candidates.filter((candidate) => candidate.status === "available" || candidate.status === "stale");
  const canvasCandidates = state.candidates
    .filter((candidate) => candidate.kind !== "asset" && candidate.kind !== "frame_image" && (candidate.status === "available" || candidate.status === "stale") && (candidate.id === previewCandidateId || (candidate.metadata?.canvasX && candidate.metadata?.canvasY)))
    .slice(-6);
  const canvasReferences = state.fixture.references.filter(isCanvasReference);
  // The sidebar is the asset library. Canvas objects are merely placements
  // linking back to these assets, so removing one never removes its row here.
  const canvasAssetLibrary = (state.assets ?? []).filter((asset) => asset.kind !== "generated_image").sort((left, right) => {
    if (Boolean(left.pinned) !== Boolean(right.pinned)) return left.pinned ? -1 : 1;
    if ((left.sortIndex ?? 0) !== (right.sortIndex ?? 0)) return (left.sortIndex ?? 0) - (right.sortIndex ?? 0);
    const leftIndex = assetListOrder.indexOf(left.id);
    const rightIndex = assetListOrder.indexOf(right.id);
    return (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex);
  });
  const activeAssetMenu = canvasAssetLibrary.find((asset) => asset.id === assetMenuId);
  const activeAssetSave = canvasAssetLibrary.find((asset) => asset.id === assetSaveFormId);
  const activeStoryboardRow = storyboardFrameRows.find((row) => row.frame.id === storyboardMenuFrameId);
  const previewDisabled = currentPages.length === 0;
  const goToPreview = () => {
    if (previewDisabled) return;
    setProjectMenu(false);
    router.push(previewRoute);
  };
  const toolbarStyle: CSSProperties | undefined = toolbarPlacement ? { left: toolbarPlacement.x, top: toolbarPlacement.y } : undefined;
  const editingStoryboardBeat = editingStoryboardBeatId ? state.fixture.storyboardBeats.find((beat) => beat.id === editingStoryboardBeatId) : undefined;
  const editorStyle: CSSProperties | undefined = editingStoryboardTarget && toolbarPlacement
    ? { left: toolbarPlacement.x, top: toolbarPlacement.y, right: "auto", bottom: "auto" }
    : undefined;
  const canvasWorldStyle: CSSProperties = { transform: `translate(${canvasOffset.x}px, ${canvasOffset.y}px) scale(${canvasScale})` };
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
    setAgentOpen(true);
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

  const renderAgentMessageContent = (message: AgentMessage, candidate: Candidate | undefined, resolved: boolean) => {
    if (resolved && (message.kind === "confirmation" || message.kind === "question" || message.kind === "failed")) return <div className="muted-card">这张卡片已经处理，不能重复操作。</div>;
    if (message.kind === "task") {
      const runningHere = activeTask?.status === "running" && (!message.taskId || message.taskId === activeTask.id);
      return runningHere ? <div className="task-message"><i className="spinner"/><span><strong>{activeTask.label}</strong><small>{message.text} · {activeTask.progress}%</small></span><button type="button" onClick={() => void stopActiveTask()}>停止</button></div> : <div className="muted-card">{message.text} {message.taskName === "frame_image_generate" || message.taskName === "frame_image_refine" ? "生成完成后图片会保留在画布，并在下方决定是否应用到漫画格。" : "任务状态与结果已同步。"}</div>;
    }
    if (message.kind === "failed") return <div className="failed-card"><strong>生成失败</strong><p>{message.text}</p><div className="card-actions"><button type="button" onClick={() => runTask(message.taskName ?? "failure")}>重试</button><button type="button" onClick={() => setResolvedCardIds((current) => new Set(current).add(message.id))}>关闭</button></div></div>;
    if (message.kind === "canceled") return <div className="muted-card">{message.text}</div>;
    if (message.kind === "confirmation") return <div className="confirmation-card"><div><strong>执行前确认</strong><span>{message.scope}</span></div><p>{message.text}</p><div className="card-actions"><button type="button" className="confirm-run" onClick={() => { setResolvedCardIds((current) => new Set(current).add(message.id)); runTask(message.taskName ?? "storyboard"); }}>确认并生成</button><button type="button" onClick={() => setResolvedCardIds((current) => new Set(current).add(message.id))}>取消</button></div></div>;
    if (message.kind === "question") return <div className="question-card"><p>{message.text}</p><div>{message.options?.map((option) => <button type="button" key={option} onClick={() => { setResolvedCardIds((current) => new Set(current).add(message.id)); runTask(message.taskName ?? "storyboard", option); }}>{option}</button>)}<button type="button" className="cancel-card" onClick={() => setResolvedCardIds((current) => new Set(current).add(message.id))}>取消</button></div></div>;
    if (message.kind === "candidate" && candidate) {
      const isAsset = candidate.kind === "asset";
      const isFrameImage = candidate.kind === "frame_image";
      const isPreviewing = previewCandidateId === candidate.id;
      return <div className={`candidate-card ${candidate.status} ${isFrameImage ? "frame-image-decision" : ""}`}>
        <div className="candidate-title"><strong>{candidate.title}</strong><span>{candidate.status === "available" ? candidate.targetLabel : candidate.status === "applied" ? "已应用" : candidate.status === "reverted" ? "已回退" : candidate.status === "stale" ? "基于旧版本" : "已取消"}</span></div>
        <p>{isFrameImage ? "图片已经生成并保留在主画布，可定位查看；是否应用到目标漫画格由你决定。" : candidate.changeSummary}</p>
        {isFrameImage && candidate.status === "available" ? <button type="button" className="candidate-navigate" onClick={() => navigateToCandidateImage(candidate)}>定位到画布图片 →</button> : null}
        {candidate.status === "available" ? isFrameImage ? <div className="candidate-actions frame-image-actions">
          <button type="button" className="apply-candidate" onClick={() => applyCandidate(candidate, true)}>应用</button>
          <button type="button" onClick={() => { setPreviewCandidateId(isPreviewing ? null : candidate.id); setToast(isPreviewing ? "已取消格内预览，画布图片仍然保留" : "正在目标漫画格内临时预览"); }}>{isPreviewing ? "取消预览" : "预览"}</button>
          <button type="button" className="discard-candidate" onClick={() => discardCandidate(candidate.id)}>取消</button>
        </div> : <div className="candidate-actions"><button type="button" className="apply-candidate" onClick={() => { setPreviewCandidateId(candidate.id); if (!isAsset) setAgentOpen(false); setToast(isAsset ? "资产候选将在确认保存后进入资产空间" : "候选已在画布展开，预览后可应用"); }}>{isAsset ? "查看候选" : "在画布预览"}</button><button type="button" className="discard-candidate" onClick={() => discardCandidate(candidate.id)}>丢弃</button></div> : candidate.status === "applied" && !isAsset ? <button type="button" className="revert-candidate" onClick={() => revertCandidate(candidate)}>撤回本次应用</button> : candidate.status === "stale" ? <button type="button" onClick={() => runTask("storyboard")}>基于当前工作稿重新生成</button> : null}
      </div>;
    }
    return <p>{message.text}</p>;
  };

  const projectSubtitle = `${workbenchMeta.comicTitle} · ${workbenchMeta.chapterTitle} · r${state.fixture.working.revision}${runtimeAdapter === "server" ? " · 已持久化" : runtimeAdapter === "demo" ? " · 离线演示" : ""}`;

  if (hydrated && runtimeError) {
    return <main className="runtime-unavailable" role="alert"><section><span>LANTERN API</span><h1>工作台暂时无法载入</h1><p>{runtimeError}</p><button type="button" onClick={() => window.location.reload()}>重新连接</button></section></main>;
  }

  return (
    <WorkbenchShell data-testid="workbench">
      <div className="ambient ambient-cyan" /><div className="ambient ambient-amber" />
      <header className="project-chip" data-testid="project-chip">
        <button className="project-main" type="button" onClick={() => { closeFloatingMenus("project"); setProjectMenu((open) => !open); }} aria-label="打开项目菜单">
          <span className="lantern-logo"><i /></span>
          <span><strong>Lantern AI</strong><small className="project-subtitle" data-full-text={projectSubtitle} tabIndex={0}><span>{projectSubtitle}</span></small></span>
          <Icon name="hamburger" />
        </button>
        {projectMenu ? (
          <div className="project-menu" role="menu">
            <button type="button" className="route-item" onClick={() => router.push("/workspace")}><span className="menu-action-label"><Icon name="home" />返回首页</span></button>
            <button type="button" className="route-item" onClick={() => router.push(`/comics/${comicId}`)}><span className="menu-action-label"><Icon name="comic" />返回漫画</span></button>
            <button type="button" className="route-item" onClick={() => {
              setProjectMenu(false);
              router.push(`/comics/${comicId}/assets?from=workbench&chapterId=${chapterId}`);
            }}><span className="menu-action-label"><Icon name="asset" />资产空间</span></button>
            <i className="project-menu-divider" />
            <button type="button" onClick={saveChapter}><span className="menu-action-label"><Icon name="save" />保存</span></button>
            <button type="button" onClick={goToPreview} disabled={previewDisabled}><span className="menu-action-label"><Icon name="preview" />阅读预览</span></button>
            <i className="project-menu-divider" />
            <button type="button" className="context-debug-entry" onClick={openContextDebug}><span className="menu-action-label"><Icon name="context" />查看当前上下文</span></button>
          </div>
        ) : null}
      </header>

      <CreationDrawer className={leftOpen ? "open" : "closed"} aria-label="创作空间">
        <div className="drawer-stack">
        <div className="drawer-top-card">
        <div className="drawer-heading"><strong>创作空间</strong><button type="button" onClick={() => setLeftOpen(false)} aria-label="收起创作空间"><Icon name="collapse" /></button></div>
        <nav className="drawer-tabs" aria-label="创作空间分类">
          {([['assets', '资产'], ['storyboard', '分镜']] as Array<[LeftView, string]>).map(([value, label]) => <button type="button" key={value} className={leftView === value ? "active" : ""} onClick={() => setLeftView(value)}>{label}</button>)}
        </nav>
        <div className={`drawer-main ${leftView === "assets" ? "assets-view" : ""} ${leftView === "storyboard" ? "storyboard-view" : ""}`}>
        {leftView === "assets" ? <section className="drawer-view asset-reference-list">
          <div className="asset-sidebar-head"><h2><span><Icon name="asset" /></span>资产</h2><button type="button" className="asset-studio-entry" onClick={() => router.push(`/comics/${comicId}/assets?from=workbench&chapterId=${chapterId}`)}><Icon name="asset" /><span>从资产空间导入</span></button></div>
          <div className="asset-reference-items">
            {canvasAssetLibrary.map((asset) => {
              const placement = canvasReferences.find((reference) => reference.assetId === asset.id);
              const glyph = asset.kind === "character" ? "人" : asset.kind === "scene" ? "景" : asset.kind === "prop" ? "物" : "图";
              return <div className={`asset-row ${placement && selection.id === placement.id ? "active" : ""}`} key={asset.id}>
                {assetRenameId === asset.id ? <form className="asset-row-rename" onSubmit={(event) => { event.preventDefault(); renameAssetInList(asset); }}><input autoFocus value={assetRenameDraft} onChange={(event) => setAssetRenameDraft(event.target.value)} maxLength={120}/><button type="submit">保存</button><button type="button" aria-label="取消重命名" onClick={() => { setAssetRenameId(null); setAssetRenameDraft(""); }}><Icon name="x" /></button></form> : <><button type="button" onClick={() => { if (placement) setSelection({ type: "reference_card", id: placement.id, label: asset.name }); else setToast(`「${asset.name}」尚未添加到当前画布`); }}><span>{glyph}</span><b>{asset.name}</b></button>
                <button className="asset-more" type="button" aria-label={`${asset.name}更多选项`} onClick={(event) => { const workbench = event.currentTarget.closest<HTMLElement>(".workbench"); const button = event.currentTarget.getBoundingClientRect(); const workbenchRect = workbench?.getBoundingClientRect(); closeFloatingMenus("asset"); setAssetMenuPosition({ x: button.right - (workbenchRect?.left ?? 0) + 16, y: button.top - (workbenchRect?.top ?? 0) - 4 }); setAssetMenuId((id) => id === asset.id ? null : asset.id); }}><Icon name="moreVertical" /></button></>}
              </div>;
            })}
            {!canvasAssetLibrary.length ? <p className="drawer-empty">还没有可用资产。</p> : null}
          </div>
        </section> : null}
        {leftView === "storyboard" ? <section className="drawer-view">
          <h2><span><Icon name="layout" /></span>页面方案</h2>
          <div className="layout-grid">
            {availableCandidates.filter((candidate) => candidate.kind === "page_layout").slice(-6).map((candidate) => <button type="button" key={candidate.id} className="layout-card" onClick={() => { setPreviewVariantId(null); setPreviewCandidateId(candidate.id); setToast(`已在画布展开「${candidate.title}」`); }}><span className="page-layout-preview"><i/><i/><i/><i/></span><b>{candidate.title}</b><em>{candidate.status === "stale" ? "过期" : "待预览"}</em></button>)}
            {state.pageVariants.map((variant) => <button type="button" key={variant.id} className={`layout-card ${previewVariantId === variant.id ? "active" : ""}`} onClick={() => { setPreviewCandidateId(null); setPreviewVariantId(variant.id); setToast(`正在预览页面方案「${variant.name}」`); }}><span className="page-layout-preview"><i/><i/><i/><i/></span><b>{variant.name}</b><em>{variant.kind === "layout_only" ? "仅编排" : variant.kind === "partial_frames" ? "局部画格" : "完整页面"}</em></button>)}
          </div>
          <h2><span><Icon name="storyboard" /></span>单格画面</h2>
          <div className="storyboard-frame-list">
            {storyboardFrameRows.map((row, index) => <div className={`storyboard-frame-row ${selection.id === row.frame.id ? "active" : ""}`} key={row.frame.id}>
              <button type="button" className="storyboard-frame-main" onClick={() => {
                setCurrentComicPage(row.pageIndex);
                setSelection({ type: "comic_frame", id: row.frame.id, pageId: row.page.id, label: row.label });
                setEditingStoryboardBeatId(null);
                setEditingStoryboardTarget(null);
                setInspectorOpen(false);
                setScope("当前漫画格");
              }}>
                <b>{String(index + 1).padStart(2, "0")}</b>
                <strong>{row.beat?.title || "未填写单格内容"}</strong>
              </button>
              <button type="button" className="storyboard-frame-more" aria-label={`${row.label}更多选项`} aria-expanded={storyboardMenuFrameId === row.frame.id} onClick={(event) => {
                const workbench = event.currentTarget.closest<HTMLElement>(".workbench");
                const button = event.currentTarget.getBoundingClientRect();
                const workbenchRect = workbench?.getBoundingClientRect();
                setStoryboardMenuPosition({ x: button.right - (workbenchRect?.left ?? 0) + 12, y: button.top - (workbenchRect?.top ?? 0) - 4 });
                closeFloatingMenus("storyboard");
                setStoryboardMenuFrameId((id) => id === row.frame.id ? null : row.frame.id);
              }}><Icon name="moreVertical" /></button>
            </div>)}
            {!storyboardFrameRows.length ? <p className="drawer-empty">当前页面还没有画格。</p> : null}
          </div>
        </section> : null}
        </div>
        </div>
        <section className="drawer-pages-fixed" aria-label="漫画页">
          <div className="drawer-pages-heading"><span><Icon name="pages" /></span><strong>漫画页</strong><small>{currentPages.length} 页</small><button type="button" className="drawer-add-page" aria-label="新增一页" onClick={addBlankComicPage}><Icon name="add" /></button></div>
          <div className="draft-pages">{currentPages.map((comicPage, index) => { const thumbnail = pageThumbSrc(comicPage); return <button type="button" key={comicPage.id} className={`draft-page ${index === state.currentPageIndex ? "active" : ""}`} onClick={() => setCurrentComicPage(index)}>{thumbnail ? <img src={thumbnail} alt="漫画页缩略图" loading="lazy" decoding="async"/> : <div className="draft-page-empty" aria-label="空白漫画页"/>}<span><b>{comicPage.kind === "page" ? `Page ${String(index + 1).padStart(2, "0")}` : comicPage.kind === "vertical_segment" ? `滚动段 ${String(index + 1).padStart(2, "0")}` : `四格 ${String(index + 1).padStart(2, "0")}`}</b><small>{comicPage.elements.filter((element) => element.type === "comic_frame").length} 格 · {index === state.currentPageIndex ? "当前查看" : "工作稿"}</small></span></button>; })}</div>
        </section>
        </div>
      </CreationDrawer>
      {!leftOpen ? <button className="drawer-reopen left" type="button" onClick={() => setLeftOpen(true)} aria-label="展开创作流"><Icon name="expand" /></button> : null}
      {activeAssetMenu && assetMenuPosition ? (() => {
        const placement = canvasReferences.find((reference) => reference.assetId === activeAssetMenu.id);
        return <FloatingMenu className="asset-reference-menu-floating" style={{ left: assetMenuPosition.x, top: assetMenuPosition.y }}>
          <MenuSection className="asset-menu-section">
            <button type="button" onClick={() => { addAssetReference(activeAssetMenu); setAgentOpen(true); setAssetMenuId(null); }}><span><Icon name="ai" />引用到对话</span></button>
            <button type="button" onClick={() => { if (placement) { setSelection({ type: "reference_card", id: placement.id, label: activeAssetMenu.name }); setLeftOpen(false); } else void placeLibraryAssetOnCanvas(activeAssetMenu); setAssetMenuId(null); }}><span><Icon name="pointer" />{placement ? "定位到画布" : "添加到画布"}</span></button>
          </MenuSection>
          <MenuDivider className="asset-menu-divider" />
          <MenuSection className="asset-menu-section">
            {(activeAssetMenu.libraryStatus === "library" || activeAssetMenu.kind === "reference_image") ? <button type="button" disabled={activeAssetMenu.libraryStatus === "library"} onClick={() => openSaveAssetForm(activeAssetMenu)}><span><Icon name="save" />{activeAssetMenu.libraryStatus === "library" ? "已关联资产" : "保存为资产"}</span></button> : null}
            <button type="button" onClick={() => { setAssetRenameId(activeAssetMenu.id); setAssetRenameDraft(activeAssetMenu.name); setAssetMenuId(null); }}><span><Icon name="edit" />重命名</span></button>
            <button type="button" onClick={() => pinAssetInList(activeAssetMenu)}><span><Icon name="pin" />置顶</span></button>
            <button type="button" className="asset-list-delete" onClick={() => removeAssetFromList(activeAssetMenu)}><span><Icon name="trash" />从列表移除</span></button>
          </MenuSection>
        </FloatingMenu>;
      })() : null}
      {activeStoryboardRow && storyboardMenuPosition ? <div className="storyboard-row-menu-floating" style={{ left: storyboardMenuPosition.x, top: storyboardMenuPosition.y }} role="menu">
        <button type="button" onClick={() => openStoryboardRowEditor(activeStoryboardRow)}><Icon name="edit" /><span>{activeStoryboardRow.beat ? "编辑单格画面" : "创建单格画面"}</span></button>
      </div> : null}
      {activeAssetSave && assetMenuPosition ? <form className="asset-save-form-floating" style={{ left: assetMenuPosition.x, top: assetMenuPosition.y }} onSubmit={(event) => { event.preventDefault(); void saveCanvasAssetToLibrary(activeAssetSave); }} onPointerDown={(event) => event.stopPropagation()}>
        <header><span>保存为资产</span><button type="button" aria-label="取消保存为资产" onClick={() => setAssetSaveFormId(null)}><Icon name="x" /></button></header>
        <p>原始文件名：{typeof activeAssetSave.attributes?.originalFilename === "string" ? activeAssetSave.attributes.originalFilename : activeAssetSave.name}</p>
        <label>名称<input autoFocus value={assetSaveDraft.name} maxLength={120} onChange={(event) => setAssetSaveDraft((current) => ({ ...current, name: event.target.value }))} /></label>
        <label>类型<CustomSelect ariaLabel="资产类型" className="asset-save-kind-select" value={assetSaveDraft.kind} options={canvasAssetSaveTypeOptions} onChange={(value) => setAssetSaveDraft((current) => ({ ...current, kind: value as CanvasAssetSaveKind }))} /></label>
        <footer><button type="button" onClick={() => setAssetSaveFormId(null)}>取消</button><button type="submit" disabled={!assetSaveDraft.name.trim() || assetSaveSubmitting}>{assetSaveSubmitting ? "保存中…" : "确认保存"}</button></footer>
      </form> : null}

      <CanvasStage
        ref={stageRef}
        className={`${leftOpen ? "left-open" : ""} ${agentOpen ? "agent-open" : ""} mode-${canvasMode} ${isCanvasPanning ? "is-panning" : ""} ${marquee ? "is-marquee" : ""} ${multiSelection ? "multi-selecting" : ""} ${multiSelection?.moveActive ? "multi-move-ready" : ""}`}
        onPointerDownCapture={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUpCapture={finishCanvasPointer}
        onPointerCancelCapture={finishCanvasPointer}
        onLostPointerCapture={finishCanvasPointer}
        onWheel={handleCanvasWheel}
        onClickCapture={(event) => {
          if (canvasMode !== "free" || isFloatingCanvasControl(event.target)) return;
          event.stopPropagation();
        }}
        onClick={handleStageClick}
      >
        <div className="canvas-world" style={canvasWorldStyle}>
          {canvasReferences.map((reference) => <ReferenceCard key={reference.id} reference={reference} selected={!multiSelection && selection.id === reference.id} multiSelected={activeMultiCanvasIds.has(reference.id)} multiMode={Boolean(multiSelection)} multiMoving={multiMoving && multiCanvasActive} multiMoveDelta={multiMoveDelta} onSelect={() => { if (multiSelection) return; setSelection({ type: "reference_card", id: reference.id, label: reference.name }); setScope("仅参考"); }} onMove={(x, y) => updateReference(reference.id, { x, y }, `移动参考图「${reference.name}」`)} onZoom={(zoom) => updateReference(reference.id, { zoom }, `缩放参考图「${reference.name}」`)} onReference={() => addCanvasAssetReference(reference)} onSaveToAssets={(anchor) => openReferenceSaveAssetForm(reference, anchor)} onOpenContextMenu={() => closeFloatingMenus()} assetSaved={reference.libraryStatus === "library" || Boolean(reference.localAssetId && state.assets?.some((asset) => asset.id === reference.localAssetId && asset.libraryStatus === "library"))} onDelete={() => deleteReference(reference.id)} onLayer={(action) => changeReferenceLayer(reference, action)} />)}
          <div className={`comic-stage-wrap ${pageDisplayMode === "spread" && !trailingUnpairedPage ? "spread" : ""}`}>
            <span className="page-tag">{pageDisplayMode === "spread" && !trailingUnpairedPage ? `PAGES ${displayedPageIndices.map((index) => String(index + 1).padStart(2, "0")).join("–")}` : page?.kind === "vertical_segment" ? `SCROLL ${String(state.currentPageIndex + 1).padStart(2, "0")}` : page?.kind === "four_panel_unit" ? "4-KOMA 01" : `PAGE ${String(state.currentPageIndex + 1).padStart(2, "0")}`}</span>
            <div className={`comic-page-spread ${displayedPageIndices.length === 1 ? "one" : ""}`}>{displayedPageIndices.map((pageIndex) => <div className="spread-page" key={canvasDocument.units[pageIndex]?.id ?? pageIndex}><ComicRenderer document={canvasDocument} resolvedResources={canvasResolvedResources} pageIndex={pageIndex} selection={selection} editable={canvasMode === "focus" && !candidateDocument} interactionMode={objectInteractionMode} multiSelectedIds={activeMultiComicIds} multiMoving={multiMoving && multiComicActive} multiMoveDelta={multiMoveDelta} onSelect={handleCanvasSelection} onCommitElement={(unitId, elementId, patch, label) => commitOperations(commandsForElementPatch(unitId, elementId, patch), label)} onCommitElements={commitElementPatches} /></div>)}</div>
          </div>
          {candidateDocument && (previewingCandidate || previewingVariant) ? <nav className="candidate-compare-toolbar" aria-label="页面方案对比">
            <div className="candidate-version-switch"><button type="button" className={candidatePreviewMode === "original" ? "active" : ""} onClick={() => setCandidatePreviewMode("original")}>原稿</button><button type="button" className={candidatePreviewMode === "candidate" ? "active" : ""} onClick={() => setCandidatePreviewMode("candidate")}>新方案</button></div>
            {previewingCandidate ? <button type="button" onClick={() => saveCandidateVariant(previewingCandidate)}>保存方案</button> : null}
            <button type="button" className="primary" onClick={() => previewingCandidate ? applyCandidate(previewingCandidate, true) : previewingVariant ? applySavedVariant(previewingVariant) : undefined}>应用</button>
            {previewingVariant ? <button type="button" onClick={() => removeSavedVariant(previewingVariant)}>删除方案</button> : <button type="button" onClick={() => { setPreviewCandidateId(null); setCandidatePreviewMode("original"); }}>取消</button>}
          </nav> : null}
        </div>
        {marquee && marqueeStyle ? <div className="canvas-marquee" style={marqueeStyle} aria-hidden="true" /> : null}

        {canvasMode === "focus" && !multiSelection && !inspectorOpen && toolbarPlacement && selection.type !== "none" && selection.type !== "presentation_unit" && selection.type !== "reference_card" ? <ObjectToolbar className={`side-${toolbarPlacement.side}`} style={toolbarStyle} aria-label="对象工具条" onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}><button type="button" className="object-ai-reference" aria-label="将当前对象引用到 Agent 对话" onClick={() => { addSelectionReference(); setIntent("精修"); setAgentOpen(true); }}><Icon name="ai" /></button><button type="button" className={objectInteractionMode === "move" ? "active" : ""} aria-pressed={objectInteractionMode === "move"} aria-label={selection.type === "speech_balloon" ? "开启或关闭气泡移动、缩放和尖尾调整" : "开启或关闭移动画格"} disabled={selection.type !== "comic_frame" && selection.type !== "speech_balloon" || objectInteractionMode === "crop"} onClick={() => { setInspectorOpen(false); setObjectInteractionMode((mode) => mode === "move" ? "select" : "move"); }}><Icon name="move" /></button><button type="button" className={objectInteractionMode === "crop" ? "active" : ""} aria-pressed={objectInteractionMode === "crop"} aria-label="裁切当前画格的格内图片" disabled={selection.type !== "comic_frame" && selection.type !== "image" || objectInteractionMode === "move"} onClick={() => { if (objectInteractionMode === "crop") endCrop(); else beginCrop(); }}><Icon name="crop" /></button><button type="button" aria-label={selection.type === "speech_balloon" ? "编辑对白和气泡样式" : selectedStoryboardBeat ? "编辑单格画面" : "创建单格画面"} onClick={openSelectionEditor}><Icon name="edit" /></button><button type="button" disabled aria-label="更多对象操作（即将支持）"><Icon name="moreVertical" /></button></ObjectToolbar> : null}
        {canvasCandidates.map((candidate, index) => {
          const expanded = previewCandidateId === candidate.id;
          const x = Number(candidate.metadata?.canvasX ?? 300 + (index % 2) * 210);
          const y = Number(candidate.metadata?.canvasY ?? 84 + Math.floor(index / 2) * 150);
          const previewUrl = candidate.metadata?.previewUrl;
          const statusLabel = candidate.status === "available" ? "候选" : candidate.status === "applied" ? "已应用" : candidate.status === "reverted" ? "已回退" : candidate.status === "discarded" ? "已丢弃" : "已过期";
          return <article key={candidate.id} className={`canvas-candidate-card ${candidate.status} ${expanded ? "expanded" : ""}`} style={{ left: x, top: y }} data-testid={`canvas-candidate-${candidate.id}`} onClick={(event) => event.stopPropagation()}>
            {previewUrl ? <img src={previewUrl} alt={`${candidate.title} 预览`} /> : <span className="candidate-storyboard-preview"><i/><i/><i/><i/></span>}
            <div className="canvas-candidate-head"><strong>{candidate.title}</strong><em>{statusLabel}</em></div>
            {expanded ? <p>{candidate.changeSummary}</p> : null}
            {candidate.status === "available" ? <div className="canvas-candidate-actions">
              {!expanded ? <button type="button" onClick={() => setPreviewCandidateId(candidate.id)}>预览</button> : <>
                <button type="button" className="primary" onClick={() => candidate.kind === "asset" ? void applyAssetCandidate(candidate) : applyCandidate(candidate)}>{candidate.kind === "asset" ? "保存到资产" : "应用到工作稿"}</button>
                <button type="button" onClick={() => { setComposer(`继续完善「${candidate.title}」：`); setIntent(candidate.kind === "asset" ? (candidate.metadata?.assetKind === "scene" ? "场景" : "人物") : "修改"); setAgentOpen(true); }}>继续完善</button>
              </>}
              <button type="button" className="danger" onClick={() => discardCandidate(candidate.id)}>丢弃</button>
            </div> : candidate.status === "applied" && candidate.kind !== "asset" ? <button type="button" className="revert-candidate" onClick={() => revertCandidate(candidate)}>撤回本次应用</button> : candidate.status === "applied" ? <span className="candidate-terminal-state">已保存到资产库</span> : null}
          </article>;
        })}

        {inspectorOpen && selection.type === "speech_balloon" && selectedElement?.type === "speech_balloon" && balloonEditorPlacement ? <aside className="balloon-editor-popover" style={{ left: balloonEditorPlacement.x, top: balloonEditorPlacement.y }} onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}><div className="balloon-editor-head"><span><i />对白 {String(selectedBalloonNumber || 1).padStart(2, "0")}</span><button type="button" aria-label="关闭对白编辑" onClick={() => setInspectorOpen(false)}><Icon name="x" /></button></div><label>对白<textarea value={editDraft.dialogue ?? selectedElement.content.text ?? ""} onChange={(event) => setEditDraft({ dialogue: event.target.value })} /></label><label>文字样式<CustomSelect ariaLabel="文字样式" className="balloon-style-select" value={selectedElement.content.shape} onChange={(value) => updateBalloonShape(value as SpeechBalloonElement["content"]["shape"])} options={balloonStyleOptions} /></label><div className="balloon-editor-actions"><button type="button" onClick={applyInspectorEdit}>保存</button></div></aside> : null}

        {inspectorOpen && editingStoryboardTarget && editorStyle ? <aside className="object-inspector near-selection" data-testid="storyboard-editor" style={editorStyle} onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}><div className="inspector-head"><span><i />{editingStoryboardBeat ? "编辑单格画面" : "创建单格画面"} · {editingStoryboardTarget.label}</span><button type="button" aria-label="关闭单格画面编辑" onClick={() => { setInspectorOpen(false); setEditingStoryboardBeatId(null); setEditingStoryboardTarget(null); setEditDraft({}); }}><Icon name="x" /></button></div><label>标题<input value={editDraft.title ?? editingStoryboardBeat?.title ?? ""} maxLength={40} placeholder="例如：空站来信" onChange={(event) => setEditDraft((current) => ({ ...current, title: event.target.value }))}/></label><label>描述<textarea value={editDraft.description ?? editingStoryboardBeat?.description ?? ""} maxLength={1200} placeholder="描述这一格的场景、人物、动作、情绪或叙事作用" onChange={(event) => setEditDraft((current) => ({ ...current, description: event.target.value }))}/></label><button className="inspector-save compact-save" type="button" disabled={!(editDraft.title ?? editingStoryboardBeat?.title ?? "").trim()} onClick={applyInspectorEdit}>{editingStoryboardBeat ? "保存" : "创建并绑定"}</button></aside> : null}

        {inspectorOpen && selection.type !== "none" && selection.type !== "presentation_unit" && selection.type !== "reference_card" && selection.type !== "speech_balloon" && selection.type !== "comic_frame" && selection.type !== "storyboard_beat" ? <aside className="object-inspector" data-testid="object-inspector" onClick={(event) => event.stopPropagation()}><div className="inspector-head"><span><i />{selection.label}</span><button type="button" aria-label="关闭对象编辑器" onClick={() => setInspectorOpen(false)}><Icon name="panelRightClose" /></button></div>{selectedElement?.type === "image" ? <><p>正在编辑格内图片裁切。拖动画面或使用下面动作，只改变图片在漫画格里的取景。</p><div className="crop-controls"><button type="button" onClick={() => cropImage("in")}>放大</button><button type="button" onClick={() => cropImage("out")}>缩小</button><button type="button" onClick={() => cropImage("left")}>左移</button><button type="button" onClick={() => cropImage("up")}>上移</button><button type="button" onClick={() => cropImage("down")}>下移</button><button type="button" onClick={() => cropImage("right")}>右移</button><button type="button" onClick={() => cropImage("reset")}>重置</button></div><button className="text-edit-link" type="button" onClick={() => selectedElement.comicFrameId && setSelection({ type: "comic_frame", id: selectedElement.comicFrameId, pageId: selection.pageId, label: `画格 ${selectedElement.comicFrameId.split("-").pop()}` })}>回到画格</button><button className="text-edit-link" type="button" onClick={() => selection.pageId && selectedElement.comicFrameId && openStoryboardEditorForFrame(selection.pageId, selectedElement.comicFrameId, selection.label)}>{selectedStoryboardBeat ? "编辑单格画面" : "创建单格画面"}</button></> : null}</aside> : null}
      </CanvasStage>

      <div className="canvas-global-actions" aria-label="全局入口"><button type="button" className="global-icon-button" aria-label="用户页" onClick={() => setToast("个人中心即将支持")}><Icon name="user" /></button><button type="button" className="global-icon-button" aria-label="全局设置" onClick={() => setToast("全局设置即将支持")}><Icon name="settings" /></button></div>
      <AgentWorkspace className={agentOpen ? "open" : "closed"} aria-label="Agent 对话">
        <div className="agent-head">
          <div className="agent-head-actions"><button type="button" className={`session-drawer-trigger ${sessionDrawerOpen ? "active" : ""}`} aria-label="打开当前画布的会话列表" aria-expanded={sessionDrawerOpen} onClick={() => setSessionDrawerOpen((open) => { if (!open) setInspectorOpen(false); return !open; })}><Icon name="message" /></button><button type="button" aria-label="收起 Agent 工作区" onClick={() => setAgentOpen(false)}><Icon name="expand" /></button></div>
        </div>
        {sessionDrawerOpen ? <SessionDrawer aria-label="当前画布会话"><header><div><small>当前画布</small><strong>{workbenchMeta.chapterTitle}</strong></div><button type="button" aria-label="新建会话" onClick={() => { setSessionCreateOpen((open) => !open); setSessionMenuId(null); setSessionRenameId(null); }}><Icon name="add" /></button></header>{sessionCreateOpen ? <form className="session-create-form" onSubmit={(event) => { event.preventDefault(); void createConversation(); }}><input autoFocus value={sessionTitleDraft} onChange={(event) => setSessionTitleDraft(event.target.value)} placeholder="输入新对话名称" maxLength={80}/><button type="submit">创建</button><button type="button" aria-label="取消新建会话" onClick={() => { setSessionCreateOpen(false); setSessionTitleDraft(""); }}><Icon name="x" /></button></form> : null}<div className="canvas-session-list">{state.conversations?.map((conversation) => <div className={`canvas-session-row ${conversation.id === runtimeIds?.conversationId ? "active" : ""}`} key={conversation.id}>{sessionRenameId === conversation.id ? <form className="session-rename-form" onSubmit={(event) => { event.preventDefault(); void renameConversation(conversation.id); }}><input autoFocus value={sessionRenameDraft} onChange={(event) => setSessionRenameDraft(event.target.value)} maxLength={80}/><button type="submit">保存</button><button type="button" aria-label="取消重命名" onClick={() => { setSessionRenameId(null); setSessionRenameDraft(""); }}><Icon name="x" /></button></form> : <><button type="button" className="session-select" onClick={() => void switchConversation(conversation.id)}><span><strong>{conversation.title}</strong><small>{new Date(conversation.updatedAt).toLocaleDateString("zh-CN")}</small></span></button><button type="button" className="session-more" aria-label={`管理「${conversation.title}」`} aria-expanded={sessionMenuId === conversation.id} onClick={(event) => { const drawer = event.currentTarget.closest<HTMLElement>(".canvas-session-drawer"); const button = event.currentTarget.getBoundingClientRect(); const drawerRect = drawer?.getBoundingClientRect(); const top = drawerRect ? clampValue(button.top - drawerRect.top + button.height + 4, 58, Math.max(58, drawerRect.height - 72)) : 58; closeFloatingMenus("session"); setSessionMenuPosition({ top, right: 10 }); setSessionMenuId((id) => id === conversation.id ? null : conversation.id); setSessionRenameId(null); }}><Icon name="moreVertical" /></button></>}</div>)}</div>{sessionMenuConversation && sessionMenuPosition ? <div className="session-row-menu" style={{ top: sessionMenuPosition.top, right: sessionMenuPosition.right }}><button type="button" onClick={() => { setSessionRenameId(sessionMenuConversation.id); setSessionRenameDraft(sessionMenuConversation.title); setSessionMenuId(null); }}><Icon name="edit" />重命名</button><button type="button" onClick={() => void deleteConversation(sessionMenuConversation.id)}><Icon name="trash" />删除</button></div> : null}</SessionDrawer> : null}
        <div className="agent-messages" data-testid="agent-messages">
          {state.messages.map((message) => {
            const candidate = message.candidateId ? state.candidates.find((item) => item.id === message.candidateId) : undefined;
            const resolved = message.resolved === true || resolvedCardIds.has(message.id);
            const attachments = message.attachments?.length ? (
              <div className="message-attachments">
                {message.attachments.map((attachment) => (
                  <figure key={attachment.id}>
                    <img src={attachment.imageUrl} alt={`${attachment.name} 对话引用`} />
                    <figcaption>{attachment.name}</figcaption>
                  </figure>
                ))}
              </div>
            ) : null;
            return (
              <div className={`agent-message ${message.role} ${message.kind}`} key={message.id}>
                {attachments}
                {renderAgentMessageContent(message, candidate, resolved)}
              </div>
            );
          })}
          {activeTask?.status === "running" && !state.messages.some((message) => message.kind === "task" && (!message.taskId || message.taskId === activeTask.id)) ? <div className="agent-message agent task"><div className="task-message"><i className="spinner"/><span><strong>{activeTask.label}</strong><small>{activeTask.scope} · {activeTask.progress}%</small></span><button type="button" onClick={() => void stopActiveTask()}>停止</button></div></div> : null}
        </div>
        <div className="composer-box">
          <div className="reference-tags">{composerReferenceItems.map((item) => { if (item.type === "attachment") { const attachment = item.value; return <button type="button" className="composer-image-reference" key={item.key} onClick={() => removeComposerAttachment(attachment.id)}><img src={attachment.imageUrl} alt={`${attachment.name} 待发送`} /><span>{attachment.name}</span><Icon name="x" /></button>; } const reference = item.value; const removeReference = () => { setExplicitReferences((items) => items.filter((current) => current.id !== reference.id)); setComposerReferenceOrder((items) => items.filter((key) => key !== item.key)); }; return reference.kind === "comic_frame" ? <button type="button" className="composer-frame-reference" key={item.key} onClick={removeReference}>{reference.imageUrl ? <img src={reference.imageUrl} alt={`${reference.label} 缩略图`} /> : <span className="frame-reference-placeholder"><Icon name="layout" /></span>}<span>{reference.label}</span><Icon name="x" /></button> : reference.kind === "speech_balloon" ? <button type="button" className="composer-dialogue-reference" key={item.key} onClick={removeReference}><Icon name="reference" /><span>对白 {String(reference.balloonNumber ?? 1).padStart(2, "0")}</span><Icon name="x" /></button> : <button type="button" key={item.key} onClick={removeReference}><Icon name="reference" /> {reference.label} <Icon name="x" /></button>; })}</div>
          <textarea data-testid="agent-input" value={composer} disabled={activeTask?.status === "running"} onChange={(event) => setComposer(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendMessage(); } }} placeholder={activeTask?.status === "running" ? "当前任务运行中；完成或取消后可继续对话" : "描述你想让 AI 生成、修改或确认的内容…"} />
          <div className="composer-actions"><input ref={chatUploadRef} type="file" accept="image/png,image/jpeg,image/jpg,image/webp,.png,.jpg,.jpeg,.webp" hidden onChange={(event) => { handleAgentUpload(event.target.files?.[0]); event.currentTarget.value = ""; }}/><button type="button" className="plus" disabled={activeTask?.status === "running"} aria-label="添加对话引用或 Agent 选项" onClick={() => chatUploadRef.current?.click()}><span aria-hidden="true">＋</span></button><CustomSelect ariaLabel="当前创作意图" className="composer-mode-picker" value={intent} options={intentOptions} onChange={setIntent} /><button type="button" className="at-button" disabled={activeTask?.status === "running"} aria-label="引用当前对象" onClick={() => addSelectionReference()}><Icon name="reference" /></button><button type="button" className={`send ${activeTask?.status === "running" ? "stop" : ""}`} aria-label={activeTask?.status === "running" ? "停止任务" : "发送"} onClick={activeTask?.status === "running" ? () => void stopActiveTask() : sendMessage}><Icon name={activeTask?.status === "running" ? "x" : "send"} /></button></div>
        </div>
      </AgentWorkspace>
      {!agentOpen ? <button className="drawer-reopen right" type="button" onClick={() => setAgentOpen(true)} aria-label="展开 Agent 工作区"><Icon name="ai" /></button> : null}

      <><input ref={dockUploadRef} type="file" accept="image/png,image/jpeg,image/jpg,image/webp,.png,.jpg,.jpeg,.webp" hidden onChange={(event) => { handleCanvasUpload(event.target.files?.[0]); event.currentTarget.value = ""; }} />
      <CreationDock className={multiSelection ? "multi-hidden" : ""} aria-label="创作工具">
        <div><button type="button" className={canvasMode === "focus" ? "active" : ""} aria-label="聚焦选择模式" onClick={() => switchCanvasMode("focus")}><Icon name="select" /></button><button type="button" className={canvasMode === "free" ? "active" : ""} aria-label="自由拖动画布" onClick={() => switchCanvasMode("free")}><Icon name="pan" /></button><i/><button type="button" className={`page-display-toggle ${pageDisplayMode === "spread" ? "active" : ""}`} aria-label={pageDisplayMode === "single" ? "切换为双页模式" : "切换为单页模式"} onClick={togglePageDisplayMode}><Icon name={pageDisplayMode === "single" ? "pageSingle" : "pageSpread"} /></button><button type="button" aria-label="上传图片到画布参考层" onClick={() => dockUploadRef.current?.click()}><Icon name="asset" /></button><button type="button" aria-label="画格和页面编排" onClick={() => { setIntent("编排"); setComposer("重新编排当前漫画页，突出最后一个画格"); }}><Icon name="layout" /></button><button type="button" aria-label="文字和气泡" onClick={() => openBalloonEditor(page?.elements.find((element): element is SpeechBalloonElement => element.type === "speech_balloon"), page)}><Icon name="text" /></button></div><div className="dock-history"><button type="button" aria-label="撤销" disabled={!history.length} onClick={undo}><Icon name="undo" /></button><button type="button" aria-label="重做" disabled={!future.length} onClick={redo}><Icon name="redo" /></button></div><div className="ai-tools mode-toggle creative-active"><button type="button" className="mode-star mode-active" aria-label="AI 修改当前焦点" onClick={() => { setComposer("只精修当前画格的格内成稿图，让动作更自然，不改其他画格"); setIntent("精修"); }}><Icon name="ai" /></button><button type="button" className="mode-preview mode-idle" aria-label="切换到阅读预览" disabled={previewDisabled} onClick={goToPreview}><Icon name="preview" /></button></div>
      </CreationDock>
      <nav className={`multi-selection-dock ${multiSelection ? "active" : ""}`} aria-label="多选工具">
        <button type="button" aria-label="将选中对象引用到对话" disabled={!multiComicActive && !multiCanvasActive} onClick={addMultiSelectionToDialogue}><Icon name="ai" /></button>
        <i />
        <button type="button" className={`multi-group-button ${multiComicActive ? "active" : ""}`} aria-label={multiComicActive ? "暂时取消选中的漫画元素" : "重新选中漫画元素"} aria-pressed={multiComicActive} disabled={!multiSelection?.comic.length} onClick={() => toggleMultiGroup("comic")}><Icon name="comic" /><small>{multiSelection?.comic.length ?? 0}</small></button>
        <button type="button" className={`multi-group-button ${multiCanvasActive ? "active" : ""}`} aria-label={multiCanvasActive ? "暂时取消选中的画布元素" : "重新选中画布元素"} aria-pressed={multiCanvasActive} disabled={!multiSelection?.canvasIds.length} onClick={() => toggleMultiGroup("canvas")}><Icon name="asset" /><small>{multiSelection?.canvasIds.length ?? 0}</small></button>
        <i />
        <button type="button" className={multiSelection?.moveActive ? "active" : ""} aria-label="批量移动选中对象" aria-pressed={Boolean(multiSelection?.moveActive)} disabled={!multiMoveEnabled} onClick={() => setMultiSelection((current) => current ? { ...current, moveActive: !current.moveActive } : current)}><Icon name="move" /></button>
        <button type="button" aria-label="从画布批量移除选中对象" disabled={!multiCanvasActive || multiComicActive} onClick={removeMultiCanvasElements}><Icon name="trash" /></button>
        <i />
        <button type="button" className="multi-mode-exit active" aria-label="退出多选模式" onClick={exitMultiSelection}><Icon name="select" /></button>
      </nav>

      </>

      <div className={`toast ${toast ? "show" : ""}`} role="status" aria-live="polite">{toast}</div>
      {contextDebugOpen ? <div className="context-debug-overlay" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) setContextDebugOpen(false); }}>
        <section className="context-debug-dialog" role="dialog" aria-modal="true" aria-labelledby="context-debug-title" onPointerDown={(event) => event.stopPropagation()}>
          <header>
            <div><span>DEVELOPMENT · LIVE SNAPSHOT</span><h2 id="context-debug-title">当前上下文</h2></div>
            <button type="button" className="context-debug-close" aria-label="关闭上下文调试" onClick={() => setContextDebugOpen(false)}><Icon name="x" /></button>
          </header>
          <div className="context-debug-meta"><span>工作稿 r{state.fixture.working.revision}</span><span>Page {String(state.currentPageIndex + 1).padStart(2, "0")}</span><span>{activeConversation?.title ?? "当前对话"}</span><span>{selection.label}</span></div>
          {contextDebugError ? <div className="context-debug-error">{contextDebugError}</div> : null}
          <div className="context-debug-workspace">
            <nav className="context-debug-nav" aria-label="上下文定位目录">
              {contextDebugSections.map((section) => <button type="button" key={section.id} className={contextDebugSection === section.id ? "active" : ""} onClick={() => setContextDebugSection(section.id)}><strong>{section.label}</strong><small>{section.detail}</small></button>)}
            </nav>
            <section className="context-debug-content" aria-live="polite">
              {contextDebugLoading ? <div className="context-debug-loading">正在重新读取数据库并构建上下文…</div> : (() => {
                const current = contextDebugSections.find((section) => section.id === contextDebugSection) ?? contextDebugSections[0];
                if (!current) return <div className="context-debug-loading">等待上下文快照…</div>;
                const sectionText = current.id === "raw" ? contextDebugText : JSON.stringify(current.value, null, 2);
                return <div className="context-debug-code-shell"><div className="context-debug-code-actions"><button type="button" title="复制当前内容" aria-label="复制当前内容" onClick={() => void navigator.clipboard.writeText(sectionText)}><Icon name="copy" /></button><button type="button" title="重新计算上下文" aria-label="重新计算上下文" onClick={() => void refreshContextDebug()} disabled={contextDebugLoading}><Icon name="replace" /></button></div>{current.id === "raw" ? <textarea aria-label="当前上下文原始 JSON" readOnly spellCheck={false} value={sectionText} /> : <pre>{sectionText}</pre>}</div>;
              })()}
            </section>
          </div>
        </section>
      </div> : null}
    </WorkbenchShell>
  );
}

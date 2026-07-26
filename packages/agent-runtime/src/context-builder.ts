import { AssetKind, AssetLibraryStatus } from "@prisma/client";
import { prisma } from "@lantern/server/db";
import { AppError } from "@lantern/server/errors";
import { agentContextSnapshotSchema, workspaceRefSchema, type WorkspaceReference } from "./schemas";
import { createComicPageViews, normalizeStoryboardBeats, unitElements, validateComicDocument, type ComicPage, type StoryboardBeat } from "@lantern/shared";

export type ContextSelection = { type: string; id?: string; pageId?: string; label?: string; canvasX?: number; canvasY?: number };

function numberedLabel(prefix: string, index: number) {
  return `${prefix} ${String(index).padStart(2, "0")}`;
}

function compactAliases(values: Array<string | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))].slice(0, 8);
}

function compactSummary(values: Array<string | undefined>) {
  return values.map((value) => value?.trim()).filter(Boolean).join("；").slice(0, 600);
}

function buildPageTargetCatalog(page: ComicPage, storyboardBeats: StoryboardBeat[], pagePosition: number) {
  const elements = page.elements;
  const frames = elements.filter((element) => element.type === "comic_frame").sort((left, right) => left.readingOrder - right.readingOrder);
  const frameLabels = new Map(frames.map((frame, index) => [frame.id, numberedLabel(frame.surfaceScope === "unit" ? "跨页格" : "画格", index + 1)]));
  const balloons = elements.filter((element) => element.type === "speech_balloon");
  const images = elements.filter((element) => element.type === "image");
  const texts = elements.filter((element) => element.type === "text");
  const storyboardBeatById = new Map(storyboardBeats.map((storyboardBeat) => [storyboardBeat.id, storyboardBeat]));
  const pageLabel = page.name?.trim() || `${page.kind === "vertical_segment" ? "滚动段" : "Page"} ${String(page.pageIndex + 1).padStart(2, "0")}`;
  const handlePrefix = `current-page:${pagePosition}`;
  const frameResources = (frameId: string) => elements.flatMap((element) =>
    "comicFrameId" in element && element.comicFrameId === frameId && "assetVersionId" in element && typeof element.assetVersionId === "string"
      ? [element.assetVersionId]
      : []);
  const frameDialogues = (frameId: string) => balloons.flatMap((balloon) => balloon.comicFrameId === frameId ? [balloon.dialogueId] : []);
  return [
    {
      handle: `${handlePrefix}:unit`,
      type: "presentation_unit" as const,
      label: pageLabel,
      aliases: compactAliases([pageLabel, page.name, page.kind === "vertical_segment" ? `滚动段${page.pageIndex + 1}` : `第${page.pageIndex + 1}页`]),
      summary: `${frames.length} 个画格、${images.length} 张图片、${balloons.length} 个气泡、${texts.length} 个文字元素`,
      pageId: page.id,
      pageLabel,
      assetVersionIds: [...new Set(images.map((element) => element.assetVersionId))].slice(0, 12),
      dialogueIds: balloons.map((balloon) => balloon.dialogueId).slice(0, 12),
    },
    ...frames.map((frame, index) => {
      const label = frameLabels.get(frame.id) ?? numberedLabel("画格", index + 1);
      const storyboardBeat = storyboardBeatById.get(frame.linkedStoryboardBeatId);
      return {
        handle: `${handlePrefix}:frame:${index + 1}`,
        type: "comic_frame" as const,
        label,
        aliases: compactAliases([`${pageLabel}${label}`, `画格${index + 1}`, `画格${String(index + 1).padStart(2, "0")}`, `第${index + 1}格`, frame.name, storyboardBeat?.title]),
        summary: compactSummary([storyboardBeat?.title, storyboardBeat?.description]),
        pageId: page.id,
        pageLabel,
        elementId: frame.id,
        frameId: frame.id,
        frameLabel: label,
        ...(storyboardBeat ? { storyboardBeatId: storyboardBeat.id } : {}),
        assetVersionIds: frameResources(frame.id).slice(0, 12),
        dialogueIds: frameDialogues(frame.id).slice(0, 12),
      };
    }),
    ...frames.flatMap((frame, index) => {
      const storyboardBeat = storyboardBeatById.get(frame.linkedStoryboardBeatId);
      if (!storyboardBeat) return [];
      const frameLabel = frameLabels.get(frame.id) ?? numberedLabel("画格", index + 1);
      return [{
        handle: `${handlePrefix}:storyboard:${index + 1}`,
        type: "storyboard_beat" as const,
        label: storyboardBeat.title,
        aliases: compactAliases([storyboardBeat.title, `${pageLabel}${storyboardBeat.title}`, `分镜${index + 1}`, `分镜条目${index + 1}`, `${frameLabel}分镜`]),
        summary: compactSummary([storyboardBeat.title, storyboardBeat.description]),
        pageId: page.id,
        pageLabel,
        frameId: frame.id,
        frameLabel,
        storyboardBeatId: storyboardBeat.id,
        assetVersionIds: frameResources(frame.id).slice(0, 12),
        dialogueIds: frameDialogues(frame.id).slice(0, 12),
      }];
    }),
    ...balloons.map((balloon, index) => {
      const localNumber = index + 1;
      const frameLabel = balloon.comicFrameId ? frameLabels.get(balloon.comicFrameId) : undefined;
      const label = numberedLabel("对白", localNumber);
      return {
        handle: `${handlePrefix}:dialogue:${localNumber}`,
        type: "speech_balloon" as const,
        label,
        aliases: compactAliases([`${pageLabel}${label}`, `对白${localNumber}`, `对白${String(localNumber).padStart(2, "0")}`, `气泡${localNumber}`, `气泡${String(localNumber).padStart(2, "0")}`]),
        summary: balloon.content.text.slice(0, 600),
        pageId: page.id,
        pageLabel,
        elementId: balloon.id,
        ...(balloon.comicFrameId ? { frameId: balloon.comicFrameId } : {}),
        ...(frameLabel ? { frameLabel } : {}),
        ...(balloon.linkedStoryboardBeatId ? { storyboardBeatId: balloon.linkedStoryboardBeatId } : {}),
        assetVersionIds: balloon.appearance?.assetVersionId ? [balloon.appearance.assetVersionId] : [],
        dialogueIds: [balloon.dialogueId],
      };
    }),
    ...images.map((element, index) => ({
      handle: `${handlePrefix}:image:${index + 1}`,
      type: "image" as const,
      label: element.name?.trim() || numberedLabel("图片", index + 1),
      aliases: compactAliases([`${pageLabel}图片${index + 1}`, element.name, `图片${index + 1}`, `图${index + 1}`]),
      summary: element.comicFrameId ? `${frameLabels.get(element.comicFrameId) ?? "当前画格"}中的图片` : "当前页图片",
      pageId: page.id,
      pageLabel,
      elementId: element.id,
      ...(element.comicFrameId ? { frameId: element.comicFrameId } : {}),
      ...(element.comicFrameId && frameLabels.get(element.comicFrameId) ? { frameLabel: frameLabels.get(element.comicFrameId) } : {}),
      ...(element.linkedStoryboardBeatId ? { storyboardBeatId: element.linkedStoryboardBeatId } : {}),
      assetVersionIds: [element.assetVersionId],
      dialogueIds: [],
    })),
    ...texts.map((element, index) => ({
      handle: `${handlePrefix}:text:${index + 1}`,
      type: "text" as const,
      label: numberedLabel(element.content.role === "narration" ? "旁白" : "文字", index + 1),
      aliases: compactAliases([`${pageLabel}文字${index + 1}`, `旁白${index + 1}`, `文字${index + 1}`, element.content.text.slice(0, 40)]),
      summary: element.content.text.slice(0, 600),
      pageId: page.id,
      pageLabel,
      elementId: element.id,
      ...(element.comicFrameId ? { frameId: element.comicFrameId } : {}),
      ...(element.comicFrameId && frameLabels.get(element.comicFrameId) ? { frameLabel: frameLabels.get(element.comicFrameId) } : {}),
      ...(element.linkedStoryboardBeatId ? { storyboardBeatId: element.linkedStoryboardBeatId } : {}),
      assetVersionIds: element.appearance?.assetVersionId ? [element.appearance.assetVersionId] : [],
      dialogueIds: [],
    })),
  ];
}

export function normalizeSelectionForCurrentView(
  selection: ContextSelection | undefined,
  currentPageId: string | undefined,
  visiblePageIds: string[],
): ContextSelection {
  if (visiblePageIds.length && selection?.pageId && !visiblePageIds.includes(selection.pageId)) {
    return { type: "none", ...(currentPageId ? { pageId: currentPageId, label: "当前页面" } : {}) };
  }
  return selection ?? { type: "none" };
}

export type ContextRequest = {
  ownerUserId: string;
  projectId: string;
  workingRevision?: number;
  conversationId?: string;
  taskType: string;
  instruction: string;
  scope: string;
  currentPageId?: string;
  visiblePageIds?: string[];
  selection?: ContextSelection;
  explicitReferences?: WorkspaceReference[];
};

export async function buildAgentContext(request: ContextRequest) {
  const project = await prisma.project.findFirst({
    where: { id: request.projectId, ownerUserId: request.ownerUserId },
    include: {
      chapter: {
        include: {
          comic: {
            include: {
              settings: {
                where: { ownerUserId: request.ownerUserId, archivedAt: null, contextEnabled: true },
                orderBy: [{ sortIndex: "asc" }, { createdAt: "asc" }],
                take: 25,
              },
              assets: {
                where: { archivedAt: null, kind: { not: AssetKind.STYLE } },
                orderBy: { updatedAt: "desc" },
                take: 24,
                include: {
                  versions: { orderBy: { version: "desc" }, take: 1 },
                  images: { orderBy: [{ sortIndex: "asc" }, { createdAt: "asc" }, { id: "asc" }], take: 12 },
                },
              },
            },
          },
        },
      },
      conversations: {
        where: {
          archivedAt: null,
          ...(request.conversationId ? { id: request.conversationId } : {}),
        },
        orderBy: { updatedAt: "desc" },
        take: 1,
        include: { messages: { orderBy: { createdAt: "desc" }, take: 16 } },
      },
    },
  });
  if (!project) throw new AppError("not_found", "创作空间不存在。", 404);
  const comicStyleAssets = await prisma.asset.findMany({
    where: {
      ownerUserId: request.ownerUserId,
      comicId: project.chapter.comic.id,
      kind: AssetKind.STYLE,
      libraryStatus: AssetLibraryStatus.LIBRARY,
      variantOfAssetId: null,
      archivedAt: null,
    },
    include: {
      versions: { orderBy: { version: "desc" }, take: 1 },
      images: { orderBy: [{ sortIndex: "asc" }, { createdAt: "asc" }, { id: "asc" }], take: 12 },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 1,
  });
  const regularAssets = project.chapter.comic.assets;
  const availableContextAssets = comicStyleAssets.length
    ? [...regularAssets.slice(0, 23), ...comicStyleAssets]
    : regularAssets.slice(0, 24);
  const working = request.workingRevision
    ? await prisma.workingRevision.findUnique({
        where: { projectId_revision: { projectId: project.id, revision: request.workingRevision } },
      })
    : await prisma.workingRevision.findFirst({
        where: { projectId: project.id },
        orderBy: { revision: "desc" },
      });
  if (!working) throw new AppError("not_found", "工作稿不存在。", 404);

  const explicitReferences = (request.explicitReferences ?? []).map((reference) => workspaceRefSchema.parse(reference));
  const document = validateComicDocument(working.document);
  const pages = createComicPageViews(document);
  await Promise.all(explicitReferences.map(async (reference) => {
    let owned = false;
    if (reference.objectType === "project") owned = reference.objectId === project.id;
    else if (reference.objectType === "chapter") owned = reference.objectId === project.chapter.id;
    else if (["asset", "character", "scene", "style"].includes(reference.objectType)) {
      const version = await prisma.assetVersion.findFirst({
        where: {
          id: reference.versionId,
          assetId: reference.objectId,
          asset: { ownerUserId: request.ownerUserId, comicId: project.chapter.comicId },
        },
        include: { asset: { select: { kind: true } } },
      });
      const expectedKind = reference.objectType === "character"
        ? "CHARACTER"
        : reference.objectType === "scene"
          ? "SCENE"
          : reference.objectType === "style"
            ? "STYLE"
            : undefined;
      owned = Boolean(version && (!expectedKind || version.asset.kind === expectedKind));
    } else if (reference.objectType === "storyboard_beat") {
      owned = Boolean(await prisma.storyboardBeatVersion.findFirst({
        where: {
          id: reference.versionId,
          storyboardBeatId: reference.objectId,
          storyboardBeat: { ownerUserId: request.ownerUserId, projectId: project.id },
        },
        select: { id: true },
      }));
    } else if (reference.objectType === "presentation_unit") {
      owned = Boolean(document.units.some((unit) => unit.id === reference.objectId));
    } else if (reference.objectType === "canvas_element") {
      owned = Boolean(pages.some((page) => page.elements.some((element) => element.id === reference.objectId)));
    }
    if (!owned) throw new AppError("not_found", "引用对象不存在或不属于当前创作空间。", 404);
  }));

  const storyboardBeats = normalizeStoryboardBeats(working.storyboardBeats);
  const explicitCanvasMatches = explicitReferences.flatMap((reference) => {
    if (reference.objectType !== "canvas_element") return [];
    for (const page of pages) {
      const element = page.elements.find((candidate) => candidate.id === reference.objectId);
      if (element) return [{ reference, page, element }];
    }
    return [];
  });
  const explicitComicFrameReferences = [...new Map(explicitCanvasMatches.flatMap(({ reference, page, element }) => {
    const frame = element.type === "comic_frame"
      ? element
      : "comicFrameId" in element && typeof element.comicFrameId === "string"
        ? page.elements.find((candidate) => candidate.type === "comic_frame" && candidate.id === element.comicFrameId)
        : undefined;
    if (!frame || frame.type !== "comic_frame") return [];
    const storyboardBeat = frame.linkedStoryboardBeatId
      ? storyboardBeats.find((candidate) => candidate.id === frame.linkedStoryboardBeatId)
      : undefined;
    return [[frame.id, {
      frameId: frame.id,
      pageId: page.id,
      pageIndex: page.pageIndex,
      readingOrder: frame.readingOrder,
      ...(reference.label ? { label: reference.label } : {}),
      ...(storyboardBeat ? { storyboardBeat } : {}),
    }] as const];
  })).values()];
  const requestedVisiblePages = [...new Set(request.visiblePageIds ?? [])]
    .slice(0, 2)
    .flatMap((pageId) => {
      const page = pages.find((candidate) => candidate.id === pageId);
      return page ? [page] : [];
    });
  const requestedCurrentPage = pages.find((page) => page.id === request.currentPageId) ?? requestedVisiblePages[0];
  const pageContainingSelectedElement = request.selection?.id
    ? pages.find((page) => page.elements?.some((element) => element.id === request.selection?.id))
    : undefined;
  const pageContainingExplicitReference = explicitCanvasMatches[0]?.page;
  const selectedPage = pages.find((page) => page.id === request.selection?.pageId) ?? pageContainingSelectedElement;
  const currentPage = requestedCurrentPage ?? selectedPage ?? pageContainingExplicitReference ?? pages[0];
  const currentUnit = document.units.find((unit) => unit.id === currentPage?.id);
  const visiblePages = requestedVisiblePages.length ? requestedVisiblePages : currentPage ? [currentPage] : [];
  const effectiveSelection = normalizeSelectionForCurrentView(
    request.selection,
    currentPage?.id,
    requestedVisiblePages.map((page) => page.id),
  );
  const effectiveSelectedPage = effectiveSelection.id
    ? pages.find((page) => page.elements?.some((element) => element.id === effectiveSelection.id))
    : pages.find((page) => page.id === effectiveSelection.pageId);
  const selectedElement = effectiveSelection.id
    ? effectiveSelectedPage?.elements?.find((element) => element.id === effectiveSelection.id)
    : undefined;
  const selectedComicFrame = selectedElement?.type === "comic_frame"
    ? selectedElement
    : selectedElement && "comicFrameId" in selectedElement && typeof selectedElement.comicFrameId === "string"
      ? effectiveSelectedPage?.elements?.find((element) => element.id === selectedElement.comicFrameId && element.type === "comic_frame")
      : undefined;
  const selectedFrame = selectedComicFrame?.type === "comic_frame" ? selectedComicFrame : undefined;
  const selectedStoryboardBeatId = effectiveSelection.type === "storyboard_beat"
    ? effectiveSelection.id
    : selectedFrame?.linkedStoryboardBeatId ?? (selectedElement && "linkedStoryboardBeatId" in selectedElement ? selectedElement.linkedStoryboardBeatId : undefined);
  const selectedIndex = selectedStoryboardBeatId
    ? storyboardBeats.findIndex((storyboardBeat) => typeof storyboardBeat === "object" && storyboardBeat !== null && "id" in storyboardBeat && storyboardBeat.id === selectedStoryboardBeatId)
    : -1;
  const interactionPlanning = request.taskType === "interaction";
  const visibleUnits = visiblePages.flatMap((page) => {
    const unit = document.units.find((candidate) => candidate.id === page.id);
    return unit ? [unit] : [];
  });
  const contextUnits = interactionPlanning && visibleUnits.length ? visibleUnits : currentUnit ? [currentUnit] : [];
  const currentPageStoryboardBeatIds = new Set(contextUnits.flatMap((unit) => unit.frames.flatMap((frame) => frame.storyRefs.map((reference) => reference.storyboardBeatId))));
  const pageStoryboardBeats = storyboardBeats.filter((storyboardBeat) => currentPageStoryboardBeatIds.has(storyboardBeat.id));
  const localStoryboardBeats = selectedIndex >= 0
    ? storyboardBeats.slice(Math.max(0, selectedIndex - 2), selectedIndex + 3)
    : pageStoryboardBeats.slice(0, 12);
  const currentStoryboardBeat = selectedIndex >= 0 ? storyboardBeats[selectedIndex] : undefined;
  const pageFrameCount = currentPage?.elements?.filter((element) => element.type === "comic_frame").length ?? 0;
  const frameChildren = selectedFrame
    ? effectiveSelectedPage?.elements?.filter((element) => "comicFrameId" in element && element.comicFrameId === selectedFrame.id) ?? []
    : [];
  const speechBalloons = pages.flatMap((page) => page.elements
    .filter((element) => element.type === "speech_balloon")
    .map((element) => ({ page, element })));
  const explicitDialogueReferences = explicitReferences.flatMap((reference) => {
    if (reference.objectType !== "canvas_element") return [];
    const index = speechBalloons.findIndex(({ element }) => element.id === reference.objectId);
    const matched = speechBalloons[index];
    if (!matched) return [];
    return [{
      elementId: matched.element.id,
      dialogueId: matched.element.dialogueId,
      pageId: matched.page.id,
      pageIndex: matched.page.pageIndex,
      ...(matched.element.comicFrameId ? { comicFrameId: matched.element.comicFrameId } : {}),
      balloonNumber: index + 1,
      text: matched.element.content.text,
      shape: matched.element.content.shape,
    }];
  });
  const pageContextTask = request.taskType === "storyboard" || request.taskType === "frame_image_generate" || interactionPlanning;
  const basicContextTask = request.taskType === "asset_image_generate" || pageContextTask;
  const settingsLimit = basicContextTask ? 6 : 12;
  const settingContentLimit = basicContextTask ? 1200 : 4000;
  const comicSettings = project.chapter.comic.settings.slice(0, settingsLimit).map((setting) => ({
    id: setting.id,
    title: setting.title,
    content: setting.content.slice(0, settingContentLimit),
  }));
  const currentViewElements = contextUnits.flatMap((unit) => unitElements(unit));
  const primaryPageElements = currentUnit ? unitElements(currentUnit) : [];
  const currentViewAssetIds = new Set(currentViewElements.flatMap((element) => "assetId" in element && typeof element.assetId === "string" ? [element.assetId] : []));
  const primaryPageAssetVersionIds = new Set(primaryPageElements.flatMap((element) => "assetVersionId" in element && typeof element.assetVersionId === "string" ? [element.assetVersionId] : []));
  const explicitAssetIds = new Set(explicitReferences.filter((reference) => ["asset", "character", "scene", "style"].includes(reference.objectType)).map((reference) => reference.objectId));
  const basicContextAssets = [
    ...availableContextAssets.filter((asset) => asset.kind === AssetKind.STYLE),
    ...availableContextAssets.filter((asset) => asset.kind !== AssetKind.STYLE && (explicitAssetIds.has(asset.id) || (pageContextTask && currentViewAssetIds.has(asset.id)))),
  ];
  const contextAssets = basicContextTask
    ? basicContextAssets.slice(0, 6)
    : availableContextAssets;
  const recentConversationLimit = basicContextTask ? 4 : 16;
  const recentConversation = (project.conversations[0]?.messages ?? []).slice(0, recentConversationLimit).reverse().map((message) => ({
    role: message.role.toLowerCase(),
    content: message.content,
  }));
  const primaryPageDialogueIds = new Set(primaryPageElements.flatMap((element) => "dialogueId" in element && typeof element.dialogueId === "string" ? [element.dialogueId] : []));
  const targetPages = interactionPlanning && visiblePages.length ? visiblePages : currentPage ? [currentPage] : [];
  const pageTargetCatalogs = targetPages.map((page, index) => buildPageTargetCatalog(page, storyboardBeats, index + 1));
  const allCurrentPageTargets = pageTargetCatalogs.flat();
  const currentPageTargets = [
    ...allCurrentPageTargets.filter((target) => target.type === "presentation_unit"),
    ...allCurrentPageTargets.filter((target) => target.type !== "presentation_unit"),
  ].slice(0, 64);
  const includeCurrentPageLcd = request.taskType === "storyboard" || request.taskType === "frame_image_generate" || interactionPlanning;
  const contextStoryboardBeats = request.taskType === "asset_image_generate" ? [] : localStoryboardBeats;
  const omittedContext = [
    ...(storyboardBeats.length > contextStoryboardBeats.length ? [{ type: "storyboard_beat", reason: contextStoryboardBeats.length ? `仅发送与当前任务最相关的 ${contextStoryboardBeats.length} 个分镜条目` : "当前任务不需要分镜历史，未发送分镜条目" }] : []),
    ...(project.chapter.comic.settings.length > comicSettings.length ? [{ type: "comic_setting", reason: `仅发送排序最前的 ${comicSettings.length} 张漫画设定卡` }] : []),
    ...(project.chapter.comic.settings.some((setting) => setting.content.length > settingContentLimit) ? [{ type: "comic_setting_content", reason: `过长的漫画设定卡正文按 ${settingContentLimit} 字符截取` }] : []),
    ...(availableContextAssets.length > contextAssets.length ? [{ type: "asset", reason: basicContextTask ? interactionPlanning ? "规划上下文只发送视觉风格、当前页关联资产与用户显式引用" : pageContextTask ? "页面创作任务只发送视觉风格、当前页关联资产与用户显式引用" : "资产任务只发送视觉风格与用户显式引用的资产" : `仅发送最近更新的 ${contextAssets.length} 个资产` }] : []),
    ...((project.conversations[0]?.messages.length ?? 0) > recentConversation.length ? [{ type: "conversation", reason: `仅保留最近 ${recentConversation.length} 条对话用于短期连续性` }] : []),
    ...(allCurrentPageTargets.length > currentPageTargets.length ? [{ type: "current_page_target", reason: `当前页目标目录仅保留前 ${currentPageTargets.length} 个元素` }] : []),
    ...(!includeCurrentPageLcd && currentUnit ? [{ type: "lcd", reason: "当前任务不需要画面结构，未发送当前页 LCD" }] : []),
  ];

  return agentContextSnapshotSchema.parse({
    task: { type: request.taskType, instruction: request.instruction, scope: request.scope },
    comic: {
      id: project.chapter.comic.id,
      title: project.chapter.comic.title,
      summary: project.chapter.comic.summary,
      worldSummary: project.chapter.comic.worldSummary,
      format: project.chapter.comic.format.toLowerCase(),
      defaultReadingDirection: project.chapter.comic.defaultReadingDirection.toLowerCase(),
      styleSummary: project.chapter.comic.styleSummary,
      settings: comicSettings,
    },
    chapter: {
      id: project.chapter.id,
      title: project.chapter.title,
      summary: project.chapter.summary,
    },
    projectId: project.id,
    workingRevision: working.revision,
    selection: effectiveSelection,
    storyboardBeats: contextStoryboardBeats,
    currentView: includeCurrentPageLcd && visibleUnits.length ? {
      unitIds: visibleUnits.map((unit) => unit.id),
      label: (() => {
        const pageNumbers = visibleUnits.flatMap((unit) => unit.surfaces.flatMap((surface) => typeof surface.pageNumber === "number" ? [surface.pageNumber] : [])).sort((left, right) => left - right);
        if (!pageNumbers.length) return visibleUnits.map((unit) => unit.name ?? unit.id).join("、");
        const range = pageNumbers.length > 1 ? `${String(pageNumbers[0]).padStart(2, "0")}–${String(pageNumbers.at(-1)).padStart(2, "0")}` : String(pageNumbers[0]).padStart(2, "0");
        return project.chapter.comic.format === "VERTICAL" ? `滚动段 ${range}` : `Page ${range}`;
      })(),
      physicalPageNumbers: visibleUnits.flatMap((unit) => unit.surfaces.flatMap((surface) => typeof surface.pageNumber === "number" ? [surface.pageNumber] : [])).sort((left, right) => left - right),
    } : undefined,
    currentPage: includeCurrentPageLcd && currentPage ? {
      id: currentPage.id ?? "",
      pageIndex: typeof currentPage.pageIndex === "number" ? currentPage.pageIndex : 0,
      kind: typeof currentPage.kind === "string" ? currentPage.kind : "page",
      comicFrameCount: pageFrameCount,
    } : undefined,
    currentPageTargets: includeCurrentPageLcd ? currentPageTargets : [],
    currentPageLcd: includeCurrentPageLcd && currentUnit ? {
      unit: currentUnit,
      resources: document.resources.filter((resource) => primaryPageAssetVersionIds.has(resource.assetVersionId)),
      dialogues: document.dialogues.filter((dialogue) => primaryPageDialogueIds.has(dialogue.id)),
    } : undefined,
    visiblePageLcd: includeCurrentPageLcd ? contextUnits.map((unit) => {
      const elements = unitElements(unit);
      const assetVersionIds = new Set(elements.flatMap((element) => "assetVersionId" in element && typeof element.assetVersionId === "string" ? [element.assetVersionId] : []));
      const dialogueIds = new Set(elements.flatMap((element) => "dialogueId" in element && typeof element.dialogueId === "string" ? [element.dialogueId] : []));
      return {
        unit,
        resources: document.resources.filter((resource) => assetVersionIds.has(resource.assetVersionId)),
        dialogues: document.dialogues.filter((dialogue) => dialogueIds.has(dialogue.id)),
      };
    }) : [],
    currentComicFrame: selectedFrame && effectiveSelectedPage ? {
      id: selectedFrame.id ?? "",
      pageId: effectiveSelectedPage.id ?? "",
      pageIndex: typeof effectiveSelectedPage.pageIndex === "number" ? effectiveSelectedPage.pageIndex : 0,
      readingOrder: selectedFrame.readingOrder,
      ...(selectedFrame.linkedStoryboardBeatId ? { linkedStoryboardBeatId: selectedFrame.linkedStoryboardBeatId } : {}),
      ...(selectedFrame.linkedStoryboardBeatVersionId ? { linkedStoryboardBeatVersionId: selectedFrame.linkedStoryboardBeatVersionId } : {}),
      hasFrameImage: frameChildren.some((element) => element.type === "image"),
      dialogueElementCount: frameChildren.filter((element) => element.type === "speech_balloon" || element.type === "text").length,
    } : undefined,
    currentStoryboardBeat,
    assets: contextAssets.map((asset) => ({
      id: asset.id,
      kind: asset.kind.toLowerCase(),
      name: asset.name,
      description: asset.kind === AssetKind.STYLE ? project.chapter.comic.styleSummary : asset.description,
      versionId: asset.images[0]?.assetVersionId ?? asset.versions[0]?.id,
      images: asset.images.map((image, index) => ({ versionId: image.assetVersionId, isPrimary: index === 0 })),
    })),
    explicitReferences,
    explicitComicFrameReferences,
    explicitDialogueReferences,
    recentConversation,
    omittedContext,
  });
}

type ContextDebugClientState = {
  currentPageIndex?: number;
  workspaceMode?: string;
  pendingAttachments?: Array<{ name: string }>;
};

export async function buildAgentContextDebugSnapshot(request: ContextRequest, clientState: ContextDebugClientState = {}) {
  const modelInput = await buildAgentContext(request);
  const [working, conversation, tasks, candidates] = await Promise.all([
    prisma.workingRevision.findFirst({ where: { projectId: request.projectId }, orderBy: { revision: "desc" } }),
    request.conversationId
      ? prisma.agentConversation.findFirst({
          where: { id: request.conversationId, ownerUserId: request.ownerUserId, projectId: request.projectId, archivedAt: null },
          include: {
            messages: {
              orderBy: { createdAt: "desc" },
              take: 24,
              include: { references: true },
            },
          },
        })
      : null,
    prisma.generationTask.findMany({
      where: {
        ownerUserId: request.ownerUserId,
        projectId: request.projectId,
        ...(request.conversationId ? { conversationId: request.conversationId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 12,
    }),
    prisma.candidate.findMany({
      where: {
        ownerUserId: request.ownerUserId,
        projectId: request.projectId,
        ...(request.conversationId ? { conversationId: request.conversationId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 16,
    }),
  ]);
  if (!working) throw new AppError("not_found", "工作稿不存在。", 404);
  if (request.conversationId && !conversation) throw new AppError("not_found", "当前对话不存在。", 404);

  const document = validateComicDocument(working.document);
  const storyboardBeats = normalizeStoryboardBeats(working.storyboardBeats);
  const storyboardBeatById = new Map(storyboardBeats.map((storyboardBeat) => [storyboardBeat.id, storyboardBeat]));
  const unitById = new Map(document.units.map((unit) => [unit.id, unit]));
  const dialogueById = new Map(document.dialogues.map((dialogue) => [dialogue.id, dialogue.content]));
  const pages = document.reading.unitOrder.flatMap((unitId, pageIndex) => {
    const unit = unitById.get(unitId);
    if (!unit) return [];
    const order = new Map(unit.readingSequence.map((entry, index) => [entry.frameId, index + 1]));
    const frames = [...unit.frames]
      .sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0))
      .map((frame) => {
        const primary = frame.storyRefs.find((reference) => reference.role === "primary") ?? frame.storyRefs[0];
        const storyboardBeatId = primary?.storyboardBeatId;
        const storyboardBeat = storyboardBeatId ? storyboardBeatById.get(storyboardBeatId) : undefined;
        const art = frame.layers.flatMap((layer) => layer.kind === "art" ? layer.elements : []);
        const dialogueElements = frame.layers.flatMap((layer) => layer.kind === "text" ? layer.elements : []);
        return {
          comicFrameId: frame.id,
          readingOrder: order.get(frame.id),
          geometry: frame.geometry,
          zIndex: frame.zIndex,
          surfaceScope: frame.surfaceScope ?? "surface",
          shape: frame.shape,
          mask: frame.mask,
          storyboardBeat: storyboardBeat ? {
            id: storyboardBeat.id,
            versionId: storyboardBeat.versionId,
            title: storyboardBeat.title,
            description: storyboardBeat.description,
          } : undefined,
          images: art.map((image) => ({ elementId: image.id, assetId: image.assetId, assetVersionId: image.assetVersionId, transform: image.transform, crop: image.crop })),
          dialogueElements: dialogueElements.map((element) => element.kind === "balloon"
            ? { id: element.id, type: element.kind, dialogueId: element.dialogueId, content: dialogueById.get(element.dialogueId), transform: element.transform, appearance: element.appearance }
            : { id: element.id, type: element.kind, content: element.content, transform: element.transform, appearance: element.appearance }),
          layers: frame.layers.map((layer) => ({ id: layer.id, kind: layer.kind, name: layer.name, zIndex: layer.zIndex, overflow: layer.overflow, elementIds: layer.elements.map((element) => element.id) })),
        };
      });
    return [{
      id: unit.id,
      pageIndex,
      kind: unit.kind,
      canvas: unit.canvas,
      surfaces: unit.surfaces,
      layoutPolicy: unit.layoutPolicy,
      frameCount: frames.length,
      frames,
      overlayLayers: unit.overlayLayers.map((layer) => ({
        id: layer.id,
        purpose: layer.purpose,
        anchor: layer.anchor,
        surfaceId: layer.surfaceId,
        composite: "unit_overlay" as const,
        clip: "none" as const,
        zIndex: layer.zIndex,
        visible: layer.visible,
        locked: layer.locked ?? false,
        elements: layer.elements.map((element) => ({
          ...element,
          owner: layer.anchor.type === "frame" ? { type: "frame" as const, frameId: layer.anchor.frameId } : { type: "unit" as const, unitId: unit.id },
          anchor: layer.anchor,
          composite: "unit_overlay" as const,
          clip: "none" as const,
        })),
      })),
    }];
  });
  const assetsByKind = (kind: string) => modelInput.assets
    .filter((asset) => asset.kind === kind)
    .map((asset) => ({ id: asset.id, versionId: asset.versionId, images: asset.images, name: asset.name, description: asset.description }));

  return {
    debugContractVersion: "context-debug-0.5",
    computedAt: new Date().toISOString(),
    note: "这是只读即时快照。modelInput 与主流程共用 buildAgentContext；不会创建消息、任务或候选。",
    clientInput: {
      instruction: request.instruction,
      intentOrTaskType: request.taskType,
      scope: request.scope,
      currentPageId: request.currentPageId,
      visiblePageIds: request.visiblePageIds ?? [],
      selection: request.selection ?? { type: "none" },
      explicitReferences: request.explicitReferences ?? [],
      currentPageIndex: clientState.currentPageIndex ?? 0,
      workspaceMode: clientState.workspaceMode ?? "comic",
      pendingAttachments: clientState.pendingAttachments ?? [],
      attachmentNote: "已上传并形成资产引用的图片会进入 explicitReferences；仍停留在浏览器内的附件只在此处提示。",
    },
    modelInput,
    // A deliberate navigation layer for humans. It derives from the same
    // snapshot below and does not add data that the model cannot receive.
    contextIndex: {
      focus: {
        task: modelInput.task,
        selection: modelInput.selection,
        explicitReferences: modelInput.explicitReferences,
        explicitDialogueReferences: modelInput.explicitDialogueReferences,
        omittedContext: modelInput.omittedContext,
      },
      world: {
        summary: modelInput.comic.worldSummary,
        settings: modelInput.comic.settings,
        note: modelInput.comic.worldSummary ? "漫画级世界观背景，会与故事梗概和章节内容一起进入模型上下文。" : "尚未填写世界观背景。可在资产空间补充。",
      },
      assets: {
        characters: assetsByKind("character"),
        scenes: assetsByKind("scene"),
        styles: assetsByKind("style"),
        props: assetsByKind("prop"),
        otherReferences: modelInput.assets
          .filter((asset) => !["character", "scene", "style", "prop"].includes(asset.kind))
          .map((asset) => ({ id: asset.id, versionId: asset.versionId, images: asset.images, kind: asset.kind, name: asset.name, description: asset.description })),
      },
      storyboard: {
        modelStoryboardBeatWindow: modelInput.storyboardBeats,
        storyboardBeatWindowNote: modelInput.omittedContext.find((item) => item.type === "storyboard_beat")?.reason,
        currentStoryboardBeat: modelInput.currentStoryboardBeat,
      },
      layout: {
        format: modelInput.comic.format,
        defaultReadingDirection: modelInput.comic.defaultReadingDirection,
        currentView: modelInput.currentView,
        currentPage: modelInput.currentPage,
        currentPageTargets: modelInput.currentPageTargets,
        currentPageLcd: modelInput.currentPageLcd,
        visiblePageLcd: modelInput.visiblePageLcd,
        currentComicFrame: modelInput.currentComicFrame,
        pages: pages.map((page) => ({
          id: page.id,
          pageIndex: page.pageIndex,
          kind: page.kind,
          frameCount: page.frameCount,
          readingOrder: page.frames.map((frame) => ({
            comicFrameId: frame.comicFrameId,
            readingOrder: frame.readingOrder,
            storyboardBeatId: frame.storyboardBeat?.id,
            storyboardBeatVersionId: frame.storyboardBeat?.versionId,
            imageAssetVersionId: frame.images[0]?.assetVersionId,
            dialogue: frame.dialogueElements.find((element) => element.type === "balloon")?.content,
          })),
        })),
      },
      activity: {
        tasks: tasks.map((task) => ({ id: task.id, type: task.type.toLowerCase(), status: task.status.toLowerCase(), progress: task.progress, baseRevision: task.baseRevision })),
        candidates: candidates.map((candidate) => ({ id: candidate.id, kind: candidate.kind.toLowerCase(), status: candidate.status.toLowerCase(), title: candidate.title, baseRevision: candidate.baseRevision })),
        conversation: conversation ? {
          id: conversation.id,
          title: conversation.title,
          recentMessages: conversation.messages.slice(0, 8).reverse().map((message) => ({ role: message.role.toLowerCase(), kind: message.kind.toLowerCase(), content: message.content, references: message.references })),
        } : null,
      },
    },
    resolvedWorkspace: {
      workingRevision: working.revision,
      currentPage: modelInput.currentPage?.id ?? pages[clientState.currentPageIndex ?? 0]?.id,
      visiblePages: modelInput.currentView?.unitIds ?? [],
      pages,
      assets: modelInput.assets,
      taskHistory: tasks.map((task) => ({
        id: task.id,
        type: task.type.toLowerCase(),
        status: task.status.toLowerCase(),
        scope: task.scope,
        progress: task.progress,
        target: task.target,
        input: task.input,
        provider: task.provider,
        model: task.model,
        createdAt: task.createdAt.toISOString(),
        completedAt: task.completedAt?.toISOString(),
      })),
      candidates: candidates.map((candidate) => ({
        id: candidate.id,
        kind: candidate.kind.toLowerCase(),
        status: candidate.status.toLowerCase(),
        title: candidate.title,
        changeSummary: candidate.changeSummary,
        targetLabel: candidate.targetLabel,
        baseRevision: candidate.baseRevision,
      })),
    },
    conversation: conversation ? {
      id: conversation.id,
      title: conversation.title,
      messages: conversation.messages.reverse().map((message) => ({
        id: message.id,
        role: message.role.toLowerCase(),
        kind: message.kind.toLowerCase(),
        content: message.content,
        metadata: message.metadata,
        references: message.references.map((reference) => ({
          objectType: reference.objectType,
          objectId: reference.objectId,
          versionId: reference.versionId,
        })),
        createdAt: message.createdAt.toISOString(),
      })),
    } : null,
    omittedContext: modelInput.omittedContext,
  };
}

import { prisma } from "../../server/src/db";
import { AppError } from "../../server/src/errors";
import { agentContextSnapshotSchema, workspaceRefSchema } from "./schemas";
import { createComicPageViews, normalizeStoryboardBeats, validateComicDocument } from "../../shared/src";

export type ContextRequest = {
  ownerUserId: string;
  projectId: string;
  conversationId?: string;
  taskType: string;
  instruction: string;
  scope: string;
  selection?: { type: string; id?: string; pageId?: string; label?: string; canvasX?: number; canvasY?: number };
  explicitReferences?: Array<{ objectType: string; objectId: string; versionId?: string }>;
};

export async function buildAgentContext(request: ContextRequest) {
  const project = await prisma.project.findFirst({
    where: { id: request.projectId, ownerUserId: request.ownerUserId },
    include: {
      chapter: { include: { comic: true } },
      assets: {
        where: { archivedAt: null },
        orderBy: { updatedAt: "desc" },
        take: 24,
        include: { versions: { orderBy: { version: "desc" }, take: 1 } },
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
  const working = await prisma.workingRevision.findFirst({
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
          asset: { ownerUserId: request.ownerUserId, projectId: project.id },
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
  const requestedPage = pages.find((page) => page.id === request.selection?.pageId);
  const pageContainingSelectedElement = request.selection?.id
    ? pages.find((page) => page.elements?.some((element) => element.id === request.selection?.id))
    : undefined;
  const currentPage = requestedPage ?? pageContainingSelectedElement ?? pages[0];
  const selectedElement = request.selection?.id
    ? currentPage?.elements?.find((element) => element.id === request.selection?.id)
    : undefined;
  const selectedComicFrame = selectedElement?.type === "comic_frame"
    ? selectedElement
    : selectedElement && "comicFrameId" in selectedElement && typeof selectedElement.comicFrameId === "string"
      ? currentPage?.elements?.find((element) => element.id === selectedElement.comicFrameId && element.type === "comic_frame")
      : undefined;
  const selectedFrame = selectedComicFrame?.type === "comic_frame" ? selectedComicFrame : undefined;
  const selectedStoryboardBeatId = request.selection?.type === "storyboard_beat"
    ? request.selection.id
    : selectedFrame?.linkedStoryboardBeatId ?? (selectedElement && "linkedStoryboardBeatId" in selectedElement ? selectedElement.linkedStoryboardBeatId : undefined);
  const selectedIndex = selectedStoryboardBeatId
    ? storyboardBeats.findIndex((storyboardBeat) => typeof storyboardBeat === "object" && storyboardBeat !== null && "id" in storyboardBeat && storyboardBeat.id === selectedStoryboardBeatId)
    : -1;
  const localStoryboardBeats = selectedIndex >= 0 ? storyboardBeats.slice(Math.max(0, selectedIndex - 2), selectedIndex + 3) : storyboardBeats.slice(0, 12);
  const currentStoryboardBeat = selectedIndex >= 0 ? storyboardBeats[selectedIndex] : undefined;
  const pageFrameCount = currentPage?.elements?.filter((element) => element.type === "comic_frame").length ?? 0;
  const frameChildren = selectedFrame
    ? currentPage?.elements?.filter((element) => "comicFrameId" in element && element.comicFrameId === selectedFrame.id) ?? []
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
      comicFrameId: matched.element.comicFrameId,
      balloonNumber: index + 1,
      text: matched.element.content.text,
      shape: matched.element.content.shape,
    }];
  });

  return agentContextSnapshotSchema.parse({
    task: { type: request.taskType, instruction: request.instruction, scope: request.scope },
    comic: {
      id: project.chapter.comic.id,
      title: project.chapter.comic.title,
      summary: project.chapter.comic.summary,
      worldSummary: project.chapter.comic.worldSummary,
      format: project.chapter.comic.format.toLowerCase(),
      readingDirection: project.chapter.comic.readingDirection,
      styleSummary: project.chapter.comic.styleSummary,
    },
    chapter: {
      id: project.chapter.id,
      title: project.chapter.title,
      summary: project.chapter.summary,
    },
    projectId: project.id,
    workingRevision: working.revision,
    selection: request.selection ?? { type: "none" },
    storyboardBeats: localStoryboardBeats,
    currentPage: currentPage ? {
      id: currentPage.id ?? "",
      pageIndex: typeof currentPage.pageIndex === "number" ? currentPage.pageIndex : 0,
      kind: typeof currentPage.kind === "string" ? currentPage.kind : "page",
      comicFrameCount: pageFrameCount,
    } : undefined,
    currentComicFrame: selectedFrame && currentPage ? {
      id: selectedFrame.id ?? "",
      pageId: currentPage.id ?? "",
      pageIndex: typeof currentPage.pageIndex === "number" ? currentPage.pageIndex : 0,
      readingOrder: selectedFrame.readingOrder,
      linkedStoryboardBeatId: selectedFrame.linkedStoryboardBeatId ?? "",
      linkedStoryboardBeatVersionId: selectedFrame.linkedStoryboardBeatVersionId ?? "",
      hasFrameImage: frameChildren.some((element) => element.type === "image"),
      dialogueElementCount: frameChildren.filter((element) => element.type === "speech_balloon" || element.type === "text").length,
    } : undefined,
    currentStoryboardBeat,
    assets: project.assets.map((asset) => ({
      id: asset.id,
      kind: asset.kind.toLowerCase(),
      name: asset.name,
      description: asset.description,
      attributes: asset.attributes,
      versionId: asset.versions[0]?.id,
    })),
    explicitReferences,
    explicitDialogueReferences,
    recentConversation: (project.conversations[0]?.messages ?? []).reverse().map((message) => ({
      role: message.role.toLowerCase(),
      content: message.content,
    })),
    omittedContext: storyboardBeats.length > localStoryboardBeats.length ? [{ type: "storyboard_beat", reason: `仅发送与当前任务最相关的 ${localStoryboardBeats.length} 个分镜条目` }] : [],
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
      overlayLayers: unit.overlayLayers.map((layer) => ({ id: layer.id, purpose: layer.purpose, anchor: layer.anchor, zIndex: layer.zIndex, elementIds: layer.elements.map((element) => element.id) })),
    }];
  });
  const assetsByKind = (kind: string) => modelInput.assets
    .filter((asset) => asset.kind === kind)
    .map((asset) => ({ id: asset.id, versionId: asset.versionId, name: asset.name, description: asset.description, attributes: asset.attributes }));

  return {
    debugContractVersion: "context-debug-0.4",
    computedAt: new Date().toISOString(),
    note: "这是只读即时快照。modelInput 与主流程共用 buildAgentContext；不会创建消息、任务或候选。",
    clientInput: {
      instruction: request.instruction,
      intentOrTaskType: request.taskType,
      scope: request.scope,
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
        note: modelInput.comic.worldSummary ? "漫画级世界观背景，会与故事梗概和章节内容一起进入模型上下文。" : "尚未填写世界观背景。可在漫画设置中补充。",
      },
      assets: {
        characters: assetsByKind("character"),
        scenes: assetsByKind("scene"),
        styles: assetsByKind("style"),
        props: assetsByKind("prop"),
        otherReferences: modelInput.assets
          .filter((asset) => !["character", "scene", "style", "prop"].includes(asset.kind))
          .map((asset) => ({ id: asset.id, versionId: asset.versionId, kind: asset.kind, name: asset.name, description: asset.description })),
      },
      storyboard: {
        modelStoryboardBeatWindow: modelInput.storyboardBeats,
        storyboardBeatWindowNote: modelInput.omittedContext.find((item) => item.type === "storyboard_beat")?.reason,
        currentStoryboardBeat: modelInput.currentStoryboardBeat,
      },
      layout: {
        format: modelInput.comic.format,
        readingDirection: modelInput.comic.readingDirection,
        currentPage: modelInput.currentPage,
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
      currentPage: pages[clientState.currentPageIndex ?? 0]?.id,
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

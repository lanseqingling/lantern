import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { AppError } from "./errors";
import { createSignedAssetPath } from "./signed-assets";
import { applyWorkspaceChangeSet } from "../../editor-core/src";
import { mergeAssetVersionHeads, normalizeStoryboardBeats, validateComicDocument, type StoryboardBeat, type WorkspaceChangeSet, type WorkspaceCommand } from "../../shared/src";

function json<T>(value: Prisma.JsonValue) {
  return structuredClone(value) as T;
}

async function withResolvedResources(documentValue: Prisma.JsonValue) {
  const document = validateComicDocument(json<unknown>(documentValue));
  return {
    document,
    resolvedResources: Object.fromEntries(document.resources.map((resource) => [resource.assetVersionId, { url: createSignedAssetPath(resource.assetVersionId) }])),
  };
}

export async function getOwnedProject(ownerUserId: string, projectId: string) {
  const project = await prisma.project.findFirst({ where: { id: projectId, ownerUserId } });
  if (!project) throw new AppError("not_found", "创作空间不存在。", 404);
  return project;
}

export async function getLatestWorking(projectId: string) {
  const working = await prisma.workingRevision.findFirst({ where: { projectId }, orderBy: { revision: "desc" } });
  if (!working) throw new AppError("not_found", "工作稿不存在。", 404);
  return working;
}

async function syncStoryboardBeatRecords(
  tx: Prisma.TransactionClient,
  ownerUserId: string,
  projectId: string,
  storyboardBeats: StoryboardBeat[],
  sourceTaskId?: string,
) {
  const storyboardBeatVersionHeads: Record<string, string> = {};
  const currentStoryboardBeatIds = storyboardBeats.map((storyboardBeat) => storyboardBeat.id);
  await tx.storyboardBeat.updateMany({
    where: { projectId, id: { notIn: currentStoryboardBeatIds }, archivedAt: null },
    data: { archivedAt: new Date() },
  });
  for (const storyboardBeat of storyboardBeats) {
    storyboardBeatVersionHeads[storyboardBeat.id] = storyboardBeat.versionId;
    const existingStoryboardBeat = await tx.storyboardBeat.findUnique({ where: { id: storyboardBeat.id } });
    if (existingStoryboardBeat && (existingStoryboardBeat.ownerUserId !== ownerUserId || existingStoryboardBeat.projectId !== projectId)) {
      throw new AppError("conflict", "分镜条目 ID 已属于其他创作空间。", 409);
    }
    const existingVersion = await tx.storyboardBeatVersion.findUnique({ where: { id: storyboardBeat.versionId } });
    if (existingVersion && existingVersion.storyboardBeatId !== storyboardBeat.id) {
      throw new AppError("conflict", "分镜条目版本与分镜条目 ID 不匹配。", 409);
    }
    const nextVersionNumber = existingVersion?.version ?? (existingStoryboardBeat?.currentVersionNumber ?? 0) + 1;
    if (!existingStoryboardBeat) {
      await tx.storyboardBeat.create({
        data: { id: storyboardBeat.id, ownerUserId, projectId, currentVersionNumber: nextVersionNumber },
      });
    } else {
      await tx.storyboardBeat.update({
        where: { id: storyboardBeat.id },
        data: { archivedAt: null, currentVersionNumber: nextVersionNumber },
      });
    }
    if (!existingVersion) {
      await tx.storyboardBeatVersion.create({
        data: {
          id: storyboardBeat.versionId,
          storyboardBeatId: storyboardBeat.id,
          version: nextVersionNumber,
          title: storyboardBeat.title,
          description: storyboardBeat.description,
          sourceTaskId,
        },
      });
    }
  }
  return storyboardBeatVersionHeads;
}

export async function getWorkbench(ownerUserId: string, chapterId: string, requestedConversationId?: string) {
  const project = await prisma.project.findFirst({
    where: { chapterId, ownerUserId, chapter: { archivedAt: null, comic: { archivedAt: null } } },
    include: {
      chapter: { include: { comic: true } },
      placements: { include: { asset: true, assetVersion: true }, orderBy: { createdAt: "asc" } },
      canvasAssetItems: {
        where: { hiddenAt: null },
        include: { asset: { include: { versions: { orderBy: { version: "desc" }, take: 12 } } } },
        orderBy: [{ pinned: "desc" }, { sortIndex: "asc" }, { createdAt: "asc" }],
      },
      assets: {
        where: { archivedAt: null },
        include: { versions: { orderBy: { version: "desc" }, take: 12 } },
        orderBy: { updatedAt: "desc" },
        take: 200,
      },
      conversations: {
        where: { archivedAt: null },
        orderBy: { updatedAt: "desc" },
        take: 8,
      },
    },
  });
  if (!project) throw new AppError("not_found", "一话工作台不存在。", 404);
  const conversation = requestedConversationId
    ? project.conversations.find((item) => item.id === requestedConversationId)
    : project.conversations[0];
  if (requestedConversationId && !conversation) throw new AppError("not_found", "对话不存在或已归档。", 404);
  const [working, snapshot, candidates, tasks, pageVariants] = await Promise.all([
    getLatestWorking(project.id),
    prisma.savedSnapshot.findFirst({ where: { projectId: project.id, ownerUserId }, orderBy: { createdAt: "desc" } }),
    prisma.candidate.findMany({ where: { projectId: project.id, ownerUserId, conversationId: conversation?.id }, orderBy: { createdAt: "asc" }, take: 80 }),
    prisma.generationTask.findMany({ where: { projectId: project.id, ownerUserId, conversationId: conversation?.id }, orderBy: { createdAt: "desc" }, take: 20, include: { attempts: { orderBy: { attempt: "desc" }, take: 1 } } }),
    prisma.pageVariant.findMany({ where: { projectId: project.id, ownerUserId, archivedAt: null }, orderBy: { createdAt: "asc" }, take: 100 }),
  ]);
  const messages = conversation
    ? await prisma.message.findMany({ where: { conversationId: conversation.id, ownerUserId }, orderBy: { createdAt: "asc" }, take: 300 })
    : [];
  const [resolvedWorking, resolvedSnapshot] = await Promise.all([
    withResolvedResources(working.document),
    snapshot ? withResolvedResources(snapshot.document) : Promise.resolve(undefined),
  ]);
  const resolvedActionMessages = new Set<string>();
  let pendingActionMessageId: string | undefined;
  for (const message of messages) {
    if (message.kind === "QUESTION" || message.kind === "CONFIRMATION") {
      if (pendingActionMessageId) resolvedActionMessages.add(pendingActionMessageId);
      pendingActionMessageId = message.id;
    }
    if (message.kind === "TASK" && pendingActionMessageId) {
      resolvedActionMessages.add(pendingActionMessageId);
      pendingActionMessageId = undefined;
    }
  }

  return {
    user: { ownerUserId },
    comic: project.chapter.comic,
    chapter: project.chapter,
    project: { id: project.id, settings: project.settings },
    conversations: project.conversations.map((item) => ({ id: item.id, title: item.title, createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString() })),
    working: {
      documentId: working.id,
      chapterId,
      projectId: project.id,
      createdAt: working.createdAt.toISOString(),
      state: "working" as const,
      revision: working.revision,
      ...resolvedWorking,
    },
    storyboardBeats: normalizeStoryboardBeats(json<unknown[]>(working.storyboardBeats)),
    snapshot: snapshot ? {
      documentId: snapshot.id,
      chapterId,
      projectId: project.id,
      createdAt: snapshot.createdAt.toISOString(),
      state: "snapshot" as const,
      sourceWorkingRevision: snapshot.sourceWorkingRevision,
      ...resolvedSnapshot,
    } : undefined,
    references: project.placements.map((placement) => ({
      id: placement.id,
      kind: placement.asset.kind.toLowerCase(),
      name: placement.asset.name,
      detail: placement.asset.description,
      imageSrc: createSignedAssetPath(placement.assetVersionId),
      assetId: placement.assetId,
      assetVersionId: placement.assetVersionId,
      libraryStatus: placement.asset.libraryStatus.toLowerCase(),
      x: placement.x,
      y: placement.y,
      zoom: placement.zoom,
      zIndex: placement.zIndex,
      collapsed: placement.collapsed,
      pinned: placement.pinned,
    })),
    assets: project.canvasAssetItems.map((item) => ({
      id: item.asset.id,
      kind: item.displayKind.toLowerCase(),
      name: item.displayName,
      description: item.asset.description,
      attributes: item.asset.attributes,
      canvasListItemId: item.id,
      libraryStatus: item.asset.libraryStatus.toLowerCase(),
      pinned: item.pinned,
      sortIndex: item.sortIndex,
      versions: item.asset.versions.map((version) => ({
        id: version.id,
        version: version.version,
        contentUrl: version.objectKey ? createSignedAssetPath(version.id) : undefined,
        width: version.width,
        height: version.height,
        createdAt: version.createdAt.toISOString(),
      })),
      currentVersion: item.asset.versions[0] ? {
        id: item.asset.versions[0].id,
        version: item.asset.versions[0].version,
        contentUrl: item.asset.versions[0].objectKey ? createSignedAssetPath(item.asset.versions[0].id) : undefined,
      } : undefined,
    })),
    conversation,
    messages: messages.map((message) => ({
      id: message.id,
      role: message.role.toLowerCase(),
      kind: message.kind.toLowerCase(),
      text: message.content,
      metadata: { ...json<Record<string, unknown>>(message.metadata), ...(resolvedActionMessages.has(message.id) ? { resolved: true } : {}) },
      createdAt: message.createdAt.toISOString(),
    })),
    candidates: candidates.map((candidate) => ({
      id: candidate.id,
      kind: candidate.kind.toLowerCase(),
      title: candidate.title,
      changeSummary: candidate.changeSummary,
      targetLabel: candidate.targetLabel,
      baseRevision: candidate.baseRevision,
      status: candidate.status.toLowerCase(),
      payload: candidate.payload,
      commands: candidate.operations,
      taskId: candidate.taskId,
      target: candidate.target,
      outputRefs: candidate.outputRefs,
      previewUrl: (() => {
        const refs = json<Array<{ objectType?: string; objectId?: string; versionId?: string }>>(candidate.outputRefs);
        const image = refs.find((ref) => ref.objectType === "asset" && ref.versionId);
        return image?.versionId ? createSignedAssetPath(image.versionId) : undefined;
      })(),
    })),
    pageVariants: pageVariants.map((variant) => ({
      id: variant.id,
      projectId: variant.projectId,
      unitId: variant.unitId,
      name: variant.name,
      kind: variant.kind.toLowerCase(),
      scope: variant.scope,
      commands: variant.commands,
      baseRevision: variant.baseRevision,
      sourceCandidateId: variant.sourceCandidateId,
      thumbnailAssetVersionId: variant.thumbnailAssetVersionId,
      lastAppliedRevision: variant.lastAppliedRevision,
      createdAt: variant.createdAt.toISOString(),
    })),
    tasks: tasks.map((task) => ({
      id: task.id,
      type: task.type.toLowerCase(),
      status: task.status.toLowerCase(),
      progress: task.progress,
      errorCode: task.errorCode,
      errorMessage: task.errorMessage,
      createdAt: task.createdAt.toISOString(),
      attempts: task.attempts.length,
      target: task.target,
    })),
  };
}

function variantDescriptor(commands: WorkspaceCommand[]) {
  const layoutOnly = commands.every((command) => command.type === "replace_chapter_layout" || command.type === "replace_presentation_layout" || command.type === "move_frame" || command.type === "resize_frame" || command.type === "reorder_frame");
  const unitId = commands.flatMap((command) => "unitId" in command && typeof command.unitId === "string" ? [command.unitId] : command.type === "replace_chapter_layout" || command.type === "replace_chapter_presentation" ? [command.document.reading.unitOrder[0]] : []).find(Boolean);
  const frameIds = commands.flatMap((command) => "frameId" in command && typeof command.frameId === "string" ? [command.frameId] : []);
  return {
    kind: layoutOnly ? "LAYOUT_ONLY" : frameIds.length ? "PARTIAL_FRAMES" : "COMPLETE_UNIT",
    unitId: unitId ?? "chapter",
    scope: frameIds.length ? { type: "frames", unitId: unitId ?? "chapter", frameIds: [...new Set(frameIds)] } : { type: unitId ? "presentation_unit" : "chapter", ...(unitId ? { unitId } : {}) },
  };
}

export async function saveCandidateAsPageVariant(ownerUserId: string, candidateId: string, name?: string) {
  const candidate = await prisma.candidate.findFirst({ where: { id: candidateId, ownerUserId } });
  if (!candidate) throw new AppError("not_found", "候选不存在。", 404);
  if (!["PAGE_LAYOUT", "FRAME_IMAGE", "FRAME_IMAGE_PATCH"].includes(candidate.kind)) throw new AppError("validation", "这个候选不能保存为页面方案。", 422);
  if (candidate.status === "DISCARDED" || candidate.status === "REVERTED") throw new AppError("conflict", "这个候选已经终结。", 409);
  const commands = json<WorkspaceCommand[]>(candidate.operations);
  if (!commands.length) throw new AppError("validation", "候选没有可保存的页面变更。", 422);
  const descriptor = variantDescriptor(commands);
  const outputRefs = json<Array<{ objectType?: string; versionId?: string }>>(candidate.outputRefs);
  return prisma.pageVariant.create({ data: {
    ownerUserId,
    projectId: candidate.projectId,
    unitId: descriptor.unitId,
    name: name?.trim() || candidate.title,
    kind: descriptor.kind,
    scope: descriptor.scope,
    commands: commands as unknown as Prisma.InputJsonValue,
    baseRevision: candidate.baseRevision,
    sourceCandidateId: candidate.id,
    thumbnailAssetVersionId: outputRefs.find((reference) => reference.objectType === "asset")?.versionId,
  } });
}

export async function applyPageVariant(ownerUserId: string, variantId: string, expectedRevision: number) {
  const variant = await prisma.pageVariant.findFirst({ where: { id: variantId, ownerUserId, archivedAt: null } });
  if (!variant) throw new AppError("not_found", "页面方案不存在。", 404);
  if (variant.kind !== "LAYOUT_ONLY" && variant.baseRevision !== expectedRevision) throw new AppError("conflict", "页面内容已经变化，请重新生成这个完整页面方案。", 409);
  const result = await commitChangeSet({ ownerUserId, projectId: variant.projectId, expectedRevision, changeSet: {
    id: `page-variant:${variant.id}:${expectedRevision}`,
    projectId: variant.projectId,
    baseRevision: expectedRevision,
    source: "candidate",
    sourceCandidateId: variant.id,
    commands: json<WorkspaceCommand[]>(variant.commands),
  } });
  await prisma.pageVariant.update({ where: { id: variant.id }, data: { lastAppliedRevision: result.working.revision } });
  return result;
}

export async function deletePageVariant(ownerUserId: string, variantId: string) {
  const result = await prisma.pageVariant.updateMany({ where: { id: variantId, ownerUserId, archivedAt: null }, data: { archivedAt: new Date() } });
  if (!result.count) throw new AppError("not_found", "页面方案不存在。", 404);
  return { id: variantId, deleted: true };
}

export async function revertCandidateApplication(ownerUserId: string, candidateId: string) {
  return prisma.$transaction(async (tx) => {
    const candidate = await tx.candidate.findFirst({ where: { id: candidateId, ownerUserId } });
    if (!candidate) throw new AppError("not_found", "候选不存在。", 404);
    if (candidate.status !== "APPLIED" || !candidate.appliedRevision) throw new AppError("conflict", "只有已应用且尚未回退的候选可以撤回。", 409);
    const current = await tx.workingRevision.findFirst({ where: { projectId: candidate.projectId }, orderBy: { revision: "desc" } });
    if (!current || current.revision !== candidate.appliedRevision) {
      throw new AppError("conflict", "应用后工作稿已有其他修改，请使用版本历史回退，避免覆盖后续内容。", 409);
    }
    const previous = await tx.workingRevision.findFirst({ where: { projectId: candidate.projectId, revision: candidate.baseRevision } });
    if (!previous) throw new AppError("not_found", "候选应用前的工作稿版本不存在。", 404);
    const previousStoryboardBeats = normalizeStoryboardBeats(json<unknown[]>(previous.storyboardBeats));
    await syncStoryboardBeatRecords(tx, ownerUserId, candidate.projectId, previousStoryboardBeats);
    const next = await tx.workingRevision.create({
      data: {
        projectId: candidate.projectId,
        revision: current.revision + 1,
        document: previous.document as Prisma.InputJsonValue,
        storyboardBeats: previousStoryboardBeats as unknown as Prisma.InputJsonValue,
        storyboardBeatVersionHeads: previous.storyboardBeatVersionHeads as Prisma.InputJsonValue,
        assetVersionHeads: previous.assetVersionHeads as Prisma.InputJsonValue,
        changeSet: { id: `revert:${candidate.id}`, projectId: candidate.projectId, baseRevision: current.revision, source: "undo", sourceCandidateId: candidate.id, operations: [] },
        sourceCandidateId: candidate.id,
      },
    });
    await tx.candidate.update({ where: { id: candidate.id }, data: { status: "REVERTED" } });
    return { revision: next.revision, candidateId: candidate.id };
  }, { isolationLevel: "Serializable" });
}

export async function commitChangeSet(args: {
  ownerUserId: string;
  projectId: string;
  expectedRevision: number;
  changeSet: WorkspaceChangeSet;
  candidateId?: string;
}) {
  await getOwnedProject(args.ownerUserId, args.projectId);
  return prisma.$transaction(async (tx) => {
    const current = await tx.workingRevision.findFirst({ where: { projectId: args.projectId }, orderBy: { revision: "desc" } });
    if (!current) throw new AppError("not_found", "工作稿不存在。", 404);
    if (current.revision !== args.expectedRevision || args.changeSet.baseRevision !== current.revision) {
      if (args.candidateId) await tx.candidate.updateMany({ where: { id: args.candidateId, ownerUserId: args.ownerUserId }, data: { status: "STALE" } });
      throw new AppError("conflict", "工作稿已变化，请重新加载或重新生成候选。", 409, { currentRevision: current.revision });
    }
    if (args.candidateId) {
      const candidate = await tx.candidate.findFirst({ where: { id: args.candidateId, ownerUserId: args.ownerUserId, projectId: args.projectId } });
      if (!candidate) throw new AppError("not_found", "候选不存在。", 404);
      if (candidate.status !== "AVAILABLE" || candidate.baseRevision !== current.revision) throw new AppError("conflict", "候选已过期或不可应用。", 409);
    }
    let result: ReturnType<typeof applyWorkspaceChangeSet>;
    try {
      result = applyWorkspaceChangeSet(
        { working: {
          documentId: current.id,
          chapterId: "chapter",
          projectId: args.projectId,
          createdAt: current.createdAt.toISOString(),
          state: "working",
          revision: current.revision,
          document: validateComicDocument(json<unknown>(current.document)),
        }, storyboardBeats: normalizeStoryboardBeats(json<unknown[]>(current.storyboardBeats)) },
        args.changeSet,
      );
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("FRAME_CHILD_GEOMETRY_FORBIDDEN")) {
        throw new AppError("validation", "格内成稿图的位置由画格决定；请调整裁切或相对画格位置。", 400);
      }
      throw error;
    }
    const sourceTaskId = args.candidateId ? (await tx.candidate.findUnique({ where: { id: args.candidateId } }))?.taskId : undefined;
    const storyboardBeatVersionHeads = await syncStoryboardBeatRecords(tx, args.ownerUserId, args.projectId, result.storyboardBeats, sourceTaskId);
    const assetVersionHeads = mergeAssetVersionHeads(
      json<Record<string, string>>(current.assetVersionHeads),
      result.working.document.resources,
    );
    const next = await tx.workingRevision.create({
      data: {
        projectId: args.projectId,
        revision: result.working.revision,
        document: result.working.document as unknown as Prisma.InputJsonValue,
        storyboardBeats: result.storyboardBeats as unknown as Prisma.InputJsonValue,
        storyboardBeatVersionHeads,
        assetVersionHeads,
        changeSet: args.changeSet as unknown as Prisma.InputJsonValue,
        sourceCandidateId: args.candidateId,
      },
    });
    if (args.candidateId) {
      await tx.candidate.update({ where: { id: args.candidateId }, data: { status: "APPLIED", appliedRevision: next.revision } });
    }
    // Every still-available candidate built from the previous revision is now
    // stale, including sibling storyboard options. Mark them together so the
    // UI never offers a card that can only fail after the user clicks it.
    await tx.candidate.updateMany({
      where: {
        projectId: args.projectId,
        ownerUserId: args.ownerUserId,
        status: "AVAILABLE",
        baseRevision: { lt: next.revision },
      },
      data: { status: "STALE" },
    });
    const resolved = await withResolvedResources(next.document);
    return {
      ...result,
      working: {
        ...result.working,
        documentId: next.id,
        createdAt: next.createdAt.toISOString(),
        ...resolved,
      },
    };
  }, { isolationLevel: "Serializable" });
}

import { randomUUID } from "node:crypto";
import { MessageKind, type Prisma } from "@prisma/client";
import { prisma } from "./db";
import { AppError } from "./errors";
import { createSignedAssetPath } from "./signed-assets";
import { applyWorkspaceChangeSet, planEditorCapability } from "@lantern/editor-core";
import { mergeAssetVersionHeads, normalizeStoryboardBeats, validateComicDocument, type StoryboardBeat, type WorkspaceChangeSet } from "@lantern/shared";
import { isWorkbenchAgentCandidateVisible, workbenchAgentCandidateKinds, workbenchAgentTaskTypes } from "./workbench-agent-visibility";
import { markArtworkAnnotationProposalApplied } from "./artwork-annotation-service";

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

export async function updateProjectWorkspaceSettings(ownerUserId: string, projectId: string, patch: { pageDisplayMode?: "single" | "spread" }) {
  const project = await getOwnedProject(ownerUserId, projectId);
  const current = project.workspaceSettings && typeof project.workspaceSettings === "object" && !Array.isArray(project.workspaceSettings)
    ? json<Record<string, unknown>>(project.workspaceSettings)
    : {};
  const workspaceSettings = { ...current, ...patch };
  await prisma.project.update({ where: { id: project.id }, data: { workspaceSettings } });
  return { pageDisplayMode: workspaceSettings.pageDisplayMode === "spread" ? "spread" as const : "single" as const };
}

export async function getLatestWorking(projectId: string) {
  const working = await prisma.workingRevision.findFirst({ where: { projectId }, orderBy: { revision: "desc" } });
  if (!working) throw new AppError("not_found", "工作稿不存在。", 404);
  return working;
}

export async function setChapterCoverPageImage(args: { ownerUserId: string; projectId: string; chapterId: string; assetId: string; assetVersionId: string; mediaType: string; width?: number; height?: number }) {
  const current = await getLatestWorking(args.projectId);
  const fixture = {
    working: {
      documentId: current.id,
      chapterId: args.chapterId,
      projectId: args.projectId,
      createdAt: current.createdAt.toISOString(),
      state: "working" as const,
      revision: current.revision,
      document: validateComicDocument(json<unknown>(current.document)),
    },
    storyboardBeats: normalizeStoryboardBeats(json<unknown[]>(current.storyboardBeats)),
  };
  const plan = planEditorCapability("set_cover_page_image", {
    assetId: args.assetId,
    assetVersionId: args.assetVersionId,
    mediaType: args.mediaType,
    width: args.width,
    height: args.height,
  }, { fixture, createId: (prefix) => `${prefix}:${current.revision + 1}:${randomUUID()}`, actor: "human" });
  return commitChangeSet({
    ownerUserId: args.ownerUserId,
    projectId: args.projectId,
    expectedRevision: current.revision,
    changeSet: { id: `set-cover:${randomUUID()}`, projectId: args.projectId, baseRevision: current.revision, source: "manual", commands: plan.commands },
  });
}

export async function restoreLatestSnapshot(args: { ownerUserId: string; projectId: string; chapterId: string; expectedRevision: number }) {
  await getOwnedProject(args.ownerUserId, args.projectId);
  const [current, snapshot] = await Promise.all([
    getLatestWorking(args.projectId),
    prisma.savedSnapshot.findFirst({ where: { projectId: args.projectId, chapterId: args.chapterId, ownerUserId: args.ownerUserId }, orderBy: { createdAt: "desc" } }),
  ]);
  if (!snapshot) throw new AppError("not_found", "还没有可回退的保存版本。", 404);
  if (current.revision !== args.expectedRevision) throw new AppError("conflict", "工作稿已变化，请重新操作。", 409, { currentRevision: current.revision });
  const source = await prisma.workingRevision.findUnique({ where: { projectId_revision: { projectId: args.projectId, revision: snapshot.sourceWorkingRevision } } });
  if (!source) throw new AppError("not_found", "保存版本对应的工作稿不存在。", 404);
  const document = validateComicDocument(json<unknown>(snapshot.document));
  const storyboardBeats = normalizeStoryboardBeats(json<unknown[]>(source.storyboardBeats));
  const plan = planEditorCapability("restore_workspace_version", { document, storyboardBeats }, {
    fixture: {
      working: {
        documentId: current.id,
        chapterId: args.chapterId,
        projectId: args.projectId,
        createdAt: current.createdAt.toISOString(),
        state: "working",
        revision: current.revision,
        document: validateComicDocument(json<unknown>(current.document)),
      },
      storyboardBeats: normalizeStoryboardBeats(json<unknown[]>(current.storyboardBeats)),
    },
    createId: (prefix) => `${prefix}:${current.revision + 1}`,
    actor: "human",
  });
  return commitChangeSet({
    ownerUserId: args.ownerUserId,
    projectId: args.projectId,
    expectedRevision: current.revision,
    changeSet: {
      id: `restore-snapshot:${snapshot.id}:${current.revision + 1}`,
      projectId: args.projectId,
      baseRevision: current.revision,
      source: "undo",
      commands: plan.commands,
    },
    revertCandidatesAppliedAfterRevision: snapshot.sourceWorkingRevision,
  });
}

export async function saveChapterSnapshot(ownerUserId: string, chapterId: string, expectedRevision: number) {
  const project = await prisma.project.findFirst({ where: { chapterId, ownerUserId } });
  if (!project) throw new AppError("not_found", "一话不存在。", 404);
  const working = await getLatestWorking(project.id);
  if (working.revision !== expectedRevision) throw new AppError("conflict", "工作稿已变化，请重新保存。", 409, { currentRevision: working.revision });
  return prisma.savedSnapshot.create({
    data: {
      ownerUserId,
      chapterId,
      projectId: project.id,
      sourceWorkingRevision: working.revision,
      document: working.document as Prisma.InputJsonValue,
      storyboardBeatVersions: working.storyboardBeatVersionHeads as Prisma.InputJsonValue,
      assetVersions: working.assetVersionHeads as Prisma.InputJsonValue,
    },
  });
}

export async function restoreLatestChapterSnapshot(ownerUserId: string, chapterId: string, expectedRevision: number) {
  const project = await prisma.project.findFirst({ where: { chapterId, ownerUserId } });
  if (!project) throw new AppError("not_found", "一话不存在。", 404);
  return restoreLatestSnapshot({ ownerUserId, projectId: project.id, chapterId, expectedRevision });
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
      placements: {
        include: {
          asset: {
            include: {
              images: { include: { assetVersion: true }, orderBy: [{ sortIndex: "asc" }, { createdAt: "asc" }, { id: "asc" }] },
            },
          },
          assetVersion: true,
        },
        orderBy: { createdAt: "asc" },
      },
      canvasAssetItems: {
        where: { hiddenAt: null },
        include: { asset: { include: { versions: { orderBy: { version: "desc" }, take: 12 }, images: { include: { assetVersion: true }, orderBy: [{ sortIndex: "asc" }, { createdAt: "asc" }, { id: "asc" }] } } } },
        orderBy: [{ pinned: "desc" }, { sortIndex: "asc" }, { createdAt: "asc" }],
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
  const [working, snapshot, candidates, tasks] = await Promise.all([
    getLatestWorking(project.id),
    prisma.savedSnapshot.findFirst({ where: { projectId: project.id, ownerUserId }, orderBy: { createdAt: "desc" } }),
    prisma.candidate.findMany({ where: { projectId: project.id, ownerUserId, conversationId: conversation?.id, kind: { in: [...workbenchAgentCandidateKinds] } }, orderBy: { createdAt: "asc" }, take: 80 }),
    prisma.generationTask.findMany({ where: { projectId: project.id, ownerUserId, conversationId: conversation?.id, type: { in: [...workbenchAgentTaskTypes] } }, orderBy: { createdAt: "desc" }, take: 20, include: { attempts: { orderBy: { attempt: "desc" }, take: 1 } } }),
  ]);
  const messages = conversation
    ? await prisma.message.findMany({ where: { conversationId: conversation.id, ownerUserId }, orderBy: { createdAt: "asc" }, take: 300 })
    : [];
  const visibleCandidates = candidates.filter((candidate) => {
    const payload = candidate.payload && typeof candidate.payload === "object" && !Array.isArray(candidate.payload)
      ? json<Record<string, unknown>>(candidate.payload)
      : {};
    return isWorkbenchAgentCandidateVisible(candidate.kind, payload);
  });
  const visibleCandidateIds = new Set(visibleCandidates.map((candidate) => candidate.id));
  const visibleTaskIds = new Set(tasks.map((task) => task.id));
  const visibleMessages = messages.filter((message) => {
    const metadata = json<Record<string, unknown>>(message.metadata);
    if (message.kind === MessageKind.CANDIDATE && typeof metadata.candidateId === "string") return visibleCandidateIds.has(metadata.candidateId);
    if ((message.kind === MessageKind.TASK || message.kind === MessageKind.FAILED || message.kind === MessageKind.CANCELED) && typeof metadata.taskId === "string") return visibleTaskIds.has(metadata.taskId);
    if (message.kind === MessageKind.CONFIRMATION) return false;
    return true;
  });
  const messageAttachments = new Map(visibleMessages.map((message) => {
    const metadata = json<Record<string, unknown>>(message.metadata);
    const attachments = Array.isArray(metadata.imageAttachments)
      ? metadata.imageAttachments.flatMap((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return [];
        const attachment = value as Record<string, unknown>;
        return typeof attachment.assetId === "string" && typeof attachment.versionId === "string" && typeof attachment.name === "string"
          ? [{ assetId: attachment.assetId, versionId: attachment.versionId, name: attachment.name }]
          : [];
      })
      : [];
    return [message.id, attachments] as const;
  }));
  const attachmentVersionIds = [...new Set([...messageAttachments.values()].flat().map((attachment) => attachment.versionId))];
  const [resolvedWorking, resolvedSnapshot, attachmentVersions] = await Promise.all([
    withResolvedResources(working.document),
    snapshot ? withResolvedResources(snapshot.document) : Promise.resolve(undefined),
    prisma.assetVersion.findMany({
      where: { id: { in: attachmentVersionIds }, asset: { ownerUserId, comicId: project.chapter.comicId } },
      select: { id: true, assetId: true, objectKey: true },
    }),
  ]);
  const attachmentVersionMap = new Map(attachmentVersions.map((version) => [version.id, version]));
  const resolvedActionMessages = new Set<string>();
  let pendingActionMessageId: string | undefined;
  for (const message of visibleMessages) {
    if (message.kind === "QUESTION") {
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
    project: {
      id: project.id,
      workspaceSettings: {
        pageDisplayMode: json<Record<string, unknown>>(project.workspaceSettings).pageDisplayMode === "spread" ? "spread" : "single",
      },
    },
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
      images: placement.asset.images.filter((image) => Boolean(image.assetVersion.objectKey)).map((image, index) => ({
        id: image.id,
        versionId: image.assetVersionId,
        label: image.label || "图片",
        imageSrc: createSignedAssetPath(image.assetVersionId),
        isPrimary: index === 0,
      })),
      libraryStatus: placement.asset.libraryStatus.toLowerCase(),
      x: placement.x,
      y: placement.y,
      zoom: placement.zoom,
      zIndex: placement.zIndex,
      collapsed: placement.collapsed,
      pinned: placement.pinned,
    })),
    assets: project.canvasAssetItems.map((item) => {
      const currentVersion = item.asset.images[0]?.assetVersion ?? item.asset.versions[0];
      return {
        id: item.asset.id,
        kind: item.asset.kind.toLowerCase(),
        name: item.displayName,
        description: item.asset.description,
        canvasListItemId: item.id,
        libraryStatus: item.asset.libraryStatus.toLowerCase(),
        pinned: item.pinned,
        sortIndex: item.sortIndex,
        versions: item.asset.versions.map((version) => ({
          id: version.id,
          version: version.version,
          contentUrl: version.objectKey ? createSignedAssetPath(version.id) : undefined,
          width: version.width ?? undefined,
          height: version.height ?? undefined,
          createdAt: version.createdAt.toISOString(),
        })),
        images: item.asset.images.filter((image) => Boolean(image.assetVersion.objectKey)).map((image, index) => ({
          id: image.id,
          versionId: image.assetVersionId,
          label: image.label || "图片",
          contentUrl: createSignedAssetPath(image.assetVersionId),
          isPrimary: index === 0,
        })),
        currentVersion: currentVersion ? {
          id: currentVersion.id,
          version: currentVersion.version,
          contentUrl: currentVersion.objectKey ? createSignedAssetPath(currentVersion.id) : undefined,
        } : undefined,
      };
    }),
    conversation,
    messages: visibleMessages.map((message) => ({
      id: message.id,
      role: message.role.toLowerCase(),
      kind: message.kind.toLowerCase(),
      text: message.content,
      metadata: { ...json<Record<string, unknown>>(message.metadata), ...(resolvedActionMessages.has(message.id) ? { resolved: true } : {}) },
      attachments: (messageAttachments.get(message.id) ?? []).flatMap((attachment) => {
        const version = attachmentVersionMap.get(attachment.versionId);
        return version?.objectKey && version.assetId === attachment.assetId
          ? [{ id: attachment.versionId, name: attachment.name, imageUrl: createSignedAssetPath(attachment.versionId) }]
          : [];
      }),
      createdAt: message.createdAt.toISOString(),
    })),
    candidates: visibleCandidates.map((candidate) => ({
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
  revertCandidatesAppliedAfterRevision?: number;
  saveSnapshotForChapterId?: string;
  appliedChangeProposalId?: string;
}) {
  const ownedProject = await getOwnedProject(args.ownerUserId, args.projectId);
  if (args.saveSnapshotForChapterId && args.saveSnapshotForChapterId !== ownedProject.chapterId) {
    throw new AppError("validation", "保存版本的一话与当前创作空间不一致。", 400);
  }
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
      },
    });
    if (args.candidateId) {
      await tx.candidate.update({ where: { id: args.candidateId }, data: { status: "APPLIED", appliedRevision: next.revision } });
    }
    if (args.revertCandidatesAppliedAfterRevision !== undefined) {
      await tx.candidate.updateMany({
        where: {
          projectId: args.projectId,
          ownerUserId: args.ownerUserId,
          status: "APPLIED",
          appliedRevision: { gt: args.revertCandidatesAppliedAfterRevision },
        },
        data: { status: "REVERTED" },
      });
    }
    // Any unhandled candidate built from an older revision is no longer safe
    // to apply after the work changes, regardless of which action advanced it.
    await tx.candidate.updateMany({
      where: {
        projectId: args.projectId,
        ownerUserId: args.ownerUserId,
        status: "AVAILABLE",
        baseRevision: { lt: next.revision },
      },
      data: { status: "STALE" },
    });
    await tx.changeProposal.updateMany({
      where: {
        projectId: args.projectId,
        ownerUserId: args.ownerUserId,
        status: { in: ["AVAILABLE", "RETAINED"] },
        baseWorkingRevision: { lt: next.revision },
      },
      data: { status: "STALE" },
    });
    const savedSnapshot = args.saveSnapshotForChapterId
      ? await tx.savedSnapshot.create({
          data: {
            ownerUserId: args.ownerUserId,
            chapterId: args.saveSnapshotForChapterId,
            projectId: args.projectId,
            sourceWorkingRevision: next.revision,
            document: next.document as Prisma.InputJsonValue,
            storyboardBeatVersions: next.storyboardBeatVersionHeads as Prisma.InputJsonValue,
            assetVersions: next.assetVersionHeads as Prisma.InputJsonValue,
          },
        })
      : undefined;
    if (args.appliedChangeProposalId) {
      if (!savedSnapshot) throw new AppError("validation", "应用 Agent 方案必须同时形成保存版本。", 400);
      const appliedProposal = await tx.changeProposal.updateMany({
        where: {
          id: args.appliedChangeProposalId,
          ownerUserId: args.ownerUserId,
          projectId: args.projectId,
          status: { in: ["AVAILABLE", "RETAINED", "STALE"] },
        },
        data: {
          status: "APPLIED",
          acceptedWorkingRevision: next.revision,
          acceptedSnapshotId: savedSnapshot.id,
        },
      });
      if (appliedProposal.count !== 1) throw new AppError("conflict", "Agent 方案已经变化，无法完成应用。", 409);
      await markArtworkAnnotationProposalApplied(tx, args.appliedChangeProposalId);
    }
    const resolved = await withResolvedResources(next.document);
    return {
      ...result,
      ...(savedSnapshot ? { savedSnapshotId: savedSnapshot.id } : {}),
      working: {
        ...result.working,
        documentId: next.id,
        createdAt: next.createdAt.toISOString(),
        ...resolved,
      },
    };
  }, { isolationLevel: "Serializable" });
}

import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { applyWorkspaceChangeSet, planEditorCapability } from "@lantern/editor-core";
import {
  mergeAssetVersionHeads,
  normalizeStoryboardBeats,
  unitElements,
  validateComicDocument,
  type ComicDocument,
  type WorkspaceChangeSet,
} from "@lantern/shared";
import { prisma } from "./db";
import { AppError } from "./errors";
import { createSignedAssetPath } from "./signed-assets";
import { commitChangeSet, getLatestWorking, getOwnedProject } from "./workbench-service";
import { deleteObject } from "./object-storage";
import { ensureExternalAgentActivityGroup } from "./agent-activity-service";

function json<T>(value: Prisma.JsonValue) {
  return structuredClone(value) as T;
}

function resolvedDocument(value: Prisma.JsonValue) {
  const document = validateComicDocument(json<unknown>(value));
  return {
    document,
    resolvedResources: Object.fromEntries(document.resources.map((resource) => [
      resource.assetVersionId,
      { url: createSignedAssetPath(resource.assetVersionId) },
    ])),
  };
}

export function agentDraftReference(id: string) {
  return `lantern://agent-drafts/${encodeURIComponent(id)}`;
}

export function changeProposalReference(id: string) {
  return `lantern://change-proposals/${encodeURIComponent(id)}`;
}

export function parseAgentDraftReference(value: string) {
  const match = /^lantern:\/\/agent-drafts\/([^/?#]+)$/.exec(value.trim());
  return match ? decodeURIComponent(match[1]!) : value.trim();
}

export async function createAgentDraft(input: {
  ownerUserId: string;
  projectId: string;
  baseWorkingRevision: number;
  title?: string;
  sourceHost?: string;
}) {
  await getOwnedProject(input.ownerUserId, input.projectId);
  const working = await prisma.workingRevision.findUnique({
    where: { projectId_revision: { projectId: input.projectId, revision: input.baseWorkingRevision } },
  });
  if (!working) throw new AppError("context_stale", "作为方案基线的工作稿已经不存在。", 409);
  const created = await prisma.$transaction(async (tx) => {
    const draft = await tx.agentDraft.create({
      data: {
        ownerUserId: input.ownerUserId,
        projectId: input.projectId,
        baseWorkingRevision: input.baseWorkingRevision,
        title: input.title?.trim() || "Agent 方案",
        sourceHost: input.sourceHost?.trim() || null,
      },
    });
    const revision = await tx.agentDraftRevision.create({
      data: {
        agentDraftId: draft.id,
        revision: 1,
        document: working.document as Prisma.InputJsonValue,
        storyboardBeats: working.storyboardBeats as Prisma.InputJsonValue,
        storyboardBeatVersionHeads: working.storyboardBeatVersionHeads as Prisma.InputJsonValue,
        assetVersionHeads: working.assetVersionHeads as Prisma.InputJsonValue,
      },
    });
    return { draft, revision };
  }, { isolationLevel: "Serializable" });
  if (input.sourceHost?.trim() === "lantern-mcp") {
    await ensureExternalAgentActivityGroup({
      ownerUserId: input.ownerUserId,
      draftId: created.draft.id,
      title: created.draft.title,
    }).catch(() => undefined);
  }
  return created;
}

export async function getAgentDraft(ownerUserId: string, draftReference: string) {
  const draftId = parseAgentDraftReference(draftReference);
  const draft = await prisma.agentDraft.findFirst({
    where: {
      id: draftId,
      ownerUserId,
      project: { chapter: { archivedAt: null, comic: { archivedAt: null } } },
    },
    include: { revisions: { orderBy: { revision: "desc" }, take: 1 } },
  });
  if (!draft || !draft.revisions[0]) throw new AppError("not_found", "Agent 工作草稿不存在。", 404);
  return { draft, revision: draft.revisions[0] };
}

export async function commitAgentDraftChange(input: {
  ownerUserId: string;
  draftId: string;
  expectedDraftRevision: number;
  changeSet: WorkspaceChangeSet;
}) {
  return prisma.$transaction(async (tx) => {
    const draft = await tx.agentDraft.findFirst({
      where: { id: input.draftId, ownerUserId: input.ownerUserId },
      include: { project: { select: { chapterId: true } } },
    });
    if (!draft) throw new AppError("not_found", "Agent 工作草稿不存在。", 404);
    if (draft.status !== "ACTIVE") throw new AppError("conflict", "该 Agent 工作草稿已经冻结，不能继续编辑。", 409);
    const current = await tx.agentDraftRevision.findFirst({
      where: { agentDraftId: draft.id },
      orderBy: { revision: "desc" },
    });
    if (!current) throw new AppError("not_found", "Agent 工作草稿没有可用修订。", 404);
    if (current.revision !== input.expectedDraftRevision || input.changeSet.baseRevision !== current.revision) {
      throw new AppError("revision_conflict", "Agent 工作草稿已经变化，请重新读取上下文。", 409, {
        expectedRevision: input.expectedDraftRevision,
        currentRevision: current.revision,
      });
    }
    const result = applyWorkspaceChangeSet({
      working: {
        documentId: current.id,
        chapterId: draft.project.chapterId,
        projectId: draft.projectId,
        createdAt: current.createdAt.toISOString(),
        state: "working",
        revision: current.revision,
        document: validateComicDocument(json<unknown>(current.document)),
      },
      storyboardBeats: normalizeStoryboardBeats(json<unknown[]>(current.storyboardBeats)),
    }, input.changeSet);
    const assetVersionHeads = mergeAssetVersionHeads(
      json<Record<string, string>>(current.assetVersionHeads),
      result.working.document.resources,
    );
    const next = await tx.agentDraftRevision.create({
      data: {
        agentDraftId: draft.id,
        revision: result.working.revision,
        document: result.working.document as unknown as Prisma.InputJsonValue,
        storyboardBeats: result.storyboardBeats as unknown as Prisma.InputJsonValue,
        storyboardBeatVersionHeads: current.storyboardBeatVersionHeads as Prisma.InputJsonValue,
        assetVersionHeads,
        changeSet: input.changeSet as unknown as Prisma.InputJsonValue,
      },
    });
    await tx.agentDraft.update({ where: { id: draft.id }, data: { updatedAt: new Date() } });
    return { draft, revision: next, result };
  }, { isolationLevel: "Serializable" });
}

export async function freezeAgentDraft(input: {
  ownerUserId: string;
  draft: string;
  title?: string;
  summary?: string;
}) {
  const { draft, revision } = await getAgentDraft(input.ownerUserId, input.draft);
  const result = (proposal: {
    id: string;
    projectId: string;
    baseWorkingRevision: number;
    status: string;
  }) => ({
    id: proposal.id,
    proposal: changeProposalReference(proposal.id),
    projectId: proposal.projectId,
    baseWorkingRevision: proposal.baseWorkingRevision,
    draftRevision: revision.revision,
    reviewPath: `/reviews/${proposal.id}`,
    status: proposal.status.toLowerCase(),
  });
  if (draft.status === "READY") {
    const existing = await prisma.changeProposal.findUnique({ where: { agentDraftId: draft.id } });
    if (existing) return result(existing);
  }
  if (draft.status !== "ACTIVE") throw new AppError("conflict", "该 Agent 工作草稿已经冻结。", 409);
  return prisma.$transaction(async (tx) => {
    const proposal = await tx.changeProposal.create({
      data: {
        ownerUserId: input.ownerUserId,
        projectId: draft.projectId,
        agentDraftId: draft.id,
        agentDraftRevisionId: revision.id,
        baseWorkingRevision: draft.baseWorkingRevision,
        title: input.title?.trim() || draft.title,
        summary: input.summary?.trim() || "",
      },
    });
    const frozen = await tx.agentDraft.updateMany({
      where: { id: draft.id, ownerUserId: input.ownerUserId, status: "ACTIVE" },
      data: { status: "READY" },
    });
    if (frozen.count !== 1) throw new AppError("conflict", "该 Agent 工作草稿已经冻结。", 409);
    return result(proposal);
  }, { isolationLevel: "Serializable" });
}

export async function getVersionTimeline(ownerUserId: string, projectId: string) {
  await getOwnedProject(ownerUserId, projectId);
  const [working, snapshots, proposals] = await Promise.all([
    getLatestWorking(projectId),
    prisma.savedSnapshot.findMany({ where: { ownerUserId, projectId }, orderBy: { createdAt: "asc" } }),
    prisma.changeProposal.findMany({
      where: { ownerUserId, projectId, status: { in: ["AVAILABLE", "RETAINED", "APPLIED", "STALE"] } },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const items = [
    ...snapshots.map((snapshot, index) => ({
      id: snapshot.id,
      kind: "saved_snapshot" as const,
      label: `版本 ${index + 1}`,
      typeLabel: "正式版本",
      sourceWorkingRevision: snapshot.sourceWorkingRevision,
      createdAt: snapshot.createdAt.toISOString(),
      disabled: false,
    })).filter((snapshot) => snapshot.sourceWorkingRevision !== working.revision),
    ...proposals.map((proposal) => ({
      id: proposal.id,
      kind: "change_proposal" as const,
      label: proposal.title,
      typeLabel: proposal.status === "RETAINED"
        ? "已保留方案"
        : proposal.status === "APPLIED"
          ? "已应用方案"
          : proposal.status === "STALE"
            ? "过期方案"
            : "Agent 方案",
      baseWorkingRevision: proposal.baseWorkingRevision,
      status: proposal.status.toLowerCase(),
      summary: proposal.summary,
      createdAt: proposal.createdAt.toISOString(),
      disabled: false,
    })),
  ].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return {
    current: {
      id: working.id,
      kind: "working" as const,
      label: "当前版本",
      typeLabel: "当前版本",
      workingRevision: working.revision,
      createdAt: working.createdAt.toISOString(),
      disabled: true,
    },
    items,
  };
}

function stableString(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableString).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableString(item)}`).join(",")}}`;
}

function unitDifferences(current: ComicDocument, target: ComicDocument) {
  const currentById = new Map(current.units.map((unit) => [unit.id, unit]));
  const targetById = new Map(target.units.map((unit) => [unit.id, unit]));
  const orderedIds = [...new Set([...current.reading.unitOrder, ...target.reading.unitOrder])];
  const fingerprint = (document: ComicDocument, unitId: string) => {
    const unit = document.units.find((candidate) => candidate.id === unitId);
    if (!unit) return undefined;
    const elements = unitElements(unit);
    const dialogueIds = new Set(elements.flatMap((element) =>
      "dialogueId" in element && typeof element.dialogueId === "string" ? [element.dialogueId] : []));
    const assetVersionIds = new Set(elements.flatMap((element) => [
      "assetVersionId" in element && typeof element.assetVersionId === "string" ? element.assetVersionId : undefined,
      "appearance" in element && element.appearance && typeof element.appearance === "object"
        && "assetVersionId" in element.appearance && typeof element.appearance.assetVersionId === "string"
        ? element.appearance.assetVersionId
        : undefined,
    ].filter((value): value is string => Boolean(value))));
    return {
      unit,
      readingPosition: document.reading.unitOrder.indexOf(unitId),
      dialogues: document.dialogues.filter((dialogue) => dialogueIds.has(dialogue.id)),
      resources: document.resources.filter((resource) => assetVersionIds.has(resource.assetVersionId)),
    };
  };
  return orderedIds.map((unitId) => {
    const currentUnit = currentById.get(unitId);
    const targetUnit = targetById.get(unitId);
    return {
      unitId,
      currentUnitId: currentUnit?.id,
      targetUnitId: targetUnit?.id,
      state: !currentUnit ? "added" as const : !targetUnit ? "removed" as const
        : stableString(fingerprint(current, unitId)) === stableString(fingerprint(target, unitId)) ? "unchanged" as const : "changed" as const,
    };
  });
}

export async function getVersionComparison(ownerUserId: string, targetKind: "saved_snapshot" | "change_proposal", targetId: string) {
  const target = targetKind === "saved_snapshot"
    ? await prisma.savedSnapshot.findFirst({
        where: { id: targetId, ownerUserId },
        include: { project: { include: { chapter: { include: { comic: true } } } } },
      })
    : await prisma.changeProposal.findFirst({
        where: { id: targetId, ownerUserId },
        include: {
          project: { include: { chapter: { include: { comic: true } } } },
          draftRevision: true,
        },
      });
  if (!target) throw new AppError("not_found", "要比较的版本或方案不存在。", 404);
  const current = await getLatestWorking(target.projectId);
  const targetDocumentValue = "draftRevision" in target ? target.draftRevision.document : target.document;
  const currentResolved = resolvedDocument(current.document);
  const targetResolved = resolvedDocument(targetDocumentValue);
  const differences = unitDifferences(currentResolved.document, targetResolved.document);
  return {
    project: {
      id: target.project.id,
      chapterId: target.project.chapterId,
      comicId: target.project.chapter.comic.id,
      comicFormat: target.project.chapter.comic.format.toLowerCase(),
      readingDirection: target.project.chapter.comic.defaultReadingDirection.toLowerCase(),
    },
    current: {
      kind: "working" as const,
      revision: current.revision,
      createdAt: current.createdAt.toISOString(),
      ...currentResolved,
    },
    target: "draftRevision" in target ? {
      kind: "change_proposal" as const,
      id: target.id,
      title: target.title,
      summary: target.summary,
      status: target.status.toLowerCase(),
      baseWorkingRevision: target.baseWorkingRevision,
      draftRevision: target.draftRevision.revision,
      createdAt: target.createdAt.toISOString(),
      ...targetResolved,
    } : {
      kind: "saved_snapshot" as const,
      id: target.id,
      sourceWorkingRevision: target.sourceWorkingRevision,
      createdAt: target.createdAt.toISOString(),
      ...targetResolved,
    },
    differences,
    firstDifferenceIndex: differences.findIndex((difference) => difference.state !== "unchanged"),
  };
}

export async function updateChangeProposalStatus(ownerUserId: string, proposalId: string, action: "retain" | "discard") {
  const proposal = await prisma.changeProposal.findFirst({ where: { id: proposalId, ownerUserId } });
  if (!proposal) throw new AppError("not_found", "方案不存在。", 404);
  if (action === "retain") {
    if (proposal.status !== "AVAILABLE") throw new AppError("conflict", "只有待处理方案可以保留。", 409);
    return prisma.changeProposal.update({ where: { id: proposal.id }, data: { status: "RETAINED" } });
  }
  if (!["AVAILABLE", "RETAINED", "STALE"].includes(proposal.status)) {
    throw new AppError("conflict", "该方案已经处理，不能再次丢弃。", 409);
  }
  return prisma.changeProposal.update({ where: { id: proposal.id }, data: { status: "DISCARDED" } });
}

export async function applyChangeProposal(ownerUserId: string, proposalId: string, expectedWorkingRevision: number) {
  const proposal = await prisma.changeProposal.findFirst({
    where: { id: proposalId, ownerUserId },
    include: { draftRevision: true, project: true },
  });
  if (!proposal) throw new AppError("not_found", "方案不存在。", 404);
  if (proposal.status === "APPLIED" && proposal.acceptedWorkingRevision && proposal.acceptedSnapshotId) {
    return { workingRevision: proposal.acceptedWorkingRevision, snapshotId: proposal.acceptedSnapshotId };
  }
  if (!["AVAILABLE", "RETAINED", "STALE"].includes(proposal.status)) throw new AppError("conflict", "该方案当前不可应用。", 409);
  const current = await getLatestWorking(proposal.projectId);
  if (current.revision !== expectedWorkingRevision) {
    throw new AppError("conflict", "当前版本已再次变化，请重新打开版本对比。", 409, {
      expectedWorkingRevision,
      currentWorkingRevision: current.revision,
    });
  }
  const targetDocument = validateComicDocument(json<unknown>(proposal.draftRevision.document));
  const targetStoryboardBeats = normalizeStoryboardBeats(json<unknown[]>(proposal.draftRevision.storyboardBeats));
  const plan = planEditorCapability("restore_workspace_version", {
    document: targetDocument,
    storyboardBeats: targetStoryboardBeats,
  }, {
    fixture: {
      working: {
        documentId: current.id,
        chapterId: proposal.project.chapterId,
        projectId: proposal.projectId,
        createdAt: current.createdAt.toISOString(),
        state: "working",
        revision: current.revision,
        document: validateComicDocument(json<unknown>(current.document)),
      },
      storyboardBeats: normalizeStoryboardBeats(json<unknown[]>(current.storyboardBeats)),
    },
    createId: (prefix) => `${prefix}:${randomUUID()}`,
    actor: "human",
  });
  const applied = await commitChangeSet({
    ownerUserId,
    projectId: proposal.projectId,
    expectedRevision: current.revision,
    changeSet: {
      id: `apply-proposal:${proposal.id}:${randomUUID()}`,
      projectId: proposal.projectId,
      baseRevision: current.revision,
      source: "manual",
      commands: plan.commands,
    },
    saveSnapshotForChapterId: proposal.project.chapterId,
    appliedChangeProposalId: proposal.id,
  });
  if (!applied.savedSnapshotId) throw new AppError("internal", "方案已应用但未形成保存版本。", 500);
  return { workingRevision: applied.working.revision, snapshotId: applied.savedSnapshotId };
}

export async function restoreSavedSnapshot(ownerUserId: string, snapshotId: string, expectedWorkingRevision: number) {
  const snapshot = await prisma.savedSnapshot.findFirst({
    where: { id: snapshotId, ownerUserId },
    include: { project: true },
  });
  if (!snapshot) throw new AppError("not_found", "保存版本不存在。", 404);
  const current = await getLatestWorking(snapshot.projectId);
  if (current.revision !== expectedWorkingRevision) {
    throw new AppError("conflict", "当前稿已经变化，请重新打开版本对比。", 409, { currentRevision: current.revision });
  }
  const source = await prisma.workingRevision.findUnique({
    where: { projectId_revision: { projectId: snapshot.projectId, revision: snapshot.sourceWorkingRevision } },
  });
  const storyboardBeats = source
    ? normalizeStoryboardBeats(json<unknown[]>(source.storyboardBeats))
    : [];
  const plan = planEditorCapability("restore_workspace_version", {
    document: validateComicDocument(json<unknown>(snapshot.document)),
    storyboardBeats,
  }, {
    fixture: {
      working: {
        documentId: current.id,
        chapterId: snapshot.project.chapterId,
        projectId: snapshot.projectId,
        createdAt: current.createdAt.toISOString(),
        state: "working",
        revision: current.revision,
        document: validateComicDocument(json<unknown>(current.document)),
      },
      storyboardBeats: normalizeStoryboardBeats(json<unknown[]>(current.storyboardBeats)),
    },
    createId: (prefix) => `${prefix}:${randomUUID()}`,
    actor: "human",
  });
  const restored = await commitChangeSet({
    ownerUserId,
    projectId: snapshot.projectId,
    expectedRevision: current.revision,
    changeSet: {
      id: `restore-snapshot:${snapshot.id}:${randomUUID()}`,
      projectId: snapshot.projectId,
      baseRevision: current.revision,
      source: "undo",
      commands: plan.commands,
    },
    revertCandidatesAppliedAfterRevision: snapshot.sourceWorkingRevision,
    saveSnapshotForChapterId: snapshot.project.chapterId,
  });
  await prisma.changeProposal.updateMany({
    where: {
      ownerUserId,
      projectId: snapshot.projectId,
      status: { in: ["AVAILABLE", "RETAINED"] },
      baseWorkingRevision: { lt: restored.working.revision },
    },
    data: { status: "STALE" },
  });
  if (!restored.savedSnapshotId) throw new AppError("internal", "回到历史版本后未形成新的正式版本。", 500);
  return { workingRevision: restored.working.revision, snapshotId: restored.savedSnapshotId };
}

function collectStrings(value: unknown, result = new Set<string>()) {
  if (typeof value === "string") result.add(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, result));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => collectStrings(item, result));
  return result;
}

function referencesAny(value: unknown, candidates: Set<string>) {
  for (const item of collectStrings(value)) if (candidates.has(item)) return true;
  return false;
}

export async function deleteSavedSnapshot(ownerUserId: string, snapshotId: string) {
  const removed = await prisma.$transaction(async (tx) => {
    const snapshot = await tx.savedSnapshot.findFirst({ where: { id: snapshotId, ownerUserId } });
    if (!snapshot) throw new AppError("not_found", "正式版本不存在。", 404);

    const candidateStrings = collectStrings(snapshot.document);
    collectStrings(snapshot.assetVersions, candidateStrings);
    const candidateVersions = await tx.assetVersion.findMany({
      where: { id: { in: [...candidateStrings] } },
      select: { id: true, assetId: true, version: true, objectKey: true },
    });
    await tx.savedSnapshot.delete({ where: { id: snapshot.id } });
    if (!candidateVersions.length) return { objectKeys: [], count: 0 };

    const candidateIds = new Set(candidateVersions.map((version) => version.id));
    const [
      workingRevisions,
      savedSnapshots,
      draftRevisions,
      messages,
      tasks,
      candidates,
      relationalVersionIds,
      canvasAssetIds,
      currentAssets,
      covers,
    ] = await Promise.all([
      tx.workingRevision.findMany({ select: { document: true, assetVersionHeads: true, changeSet: true } }),
      tx.savedSnapshot.findMany({ select: { document: true, assetVersions: true } }),
      tx.agentDraftRevision.findMany({ select: { document: true, assetVersionHeads: true, changeSet: true } }),
      tx.message.findMany({ select: { metadata: true } }),
      tx.generationTask.findMany({ select: { target: true, input: true, contextSnapshot: true, output: true } }),
      tx.candidate.findMany({ select: { target: true, sourceRefs: true, outputRefs: true, payload: true, operations: true } }),
      Promise.all([
        tx.assetImage.findMany({ where: { assetVersionId: { in: [...candidateIds] } }, select: { assetVersionId: true } }),
        tx.canvasReferencePlacement.findMany({ where: { assetVersionId: { in: [...candidateIds] } }, select: { assetVersionId: true } }),
        tx.externalAssetUpload.findMany({ where: { assetVersionId: { in: [...candidateIds] } }, select: { assetVersionId: true } }),
        tx.messageReference.findMany({ where: { versionId: { in: [...candidateIds] } }, select: { versionId: true } }),
      ]),
      tx.canvasAssetListItem.findMany({
        where: { assetId: { in: candidateVersions.map((version) => version.assetId) } },
        select: { assetId: true },
      }),
      tx.asset.findMany({
        where: { id: { in: candidateVersions.map((version) => version.assetId) } },
        select: { id: true, currentVersionNumber: true },
      }),
      Promise.all([
        tx.comic.findMany({ where: { coverObjectKey: { in: candidateVersions.flatMap((version) => version.objectKey ? [version.objectKey] : []) } }, select: { coverObjectKey: true } }),
        tx.chapter.findMany({ where: { coverObjectKey: { in: candidateVersions.flatMap((version) => version.objectKey ? [version.objectKey] : []) } }, select: { coverObjectKey: true } }),
      ]),
    ]);

    const retainedIds = new Set<string>();
    const jsonRecords = [...workingRevisions, ...savedSnapshots, ...draftRevisions, ...messages, ...tasks, ...candidates];
    for (const version of candidateVersions) {
      if (jsonRecords.some((record) => referencesAny(record, new Set([version.id])))) retainedIds.add(version.id);
    }
    for (const rows of relationalVersionIds) {
      for (const row of rows) {
        const versionId = "assetVersionId" in row ? row.assetVersionId : row.versionId;
        if (versionId) retainedIds.add(versionId);
      }
    }
    const retainedAssetIds = new Set(canvasAssetIds.map((item) => item.assetId));
    const currentVersionByAsset = new Map(currentAssets.map((asset) => [asset.id, asset.currentVersionNumber]));
    const retainedObjectKeys = new Set(covers.flat().flatMap((item) => item.coverObjectKey ? [item.coverObjectKey] : []));
    const removable = candidateVersions.filter((version) =>
      !retainedIds.has(version.id)
      && !retainedAssetIds.has(version.assetId)
      && currentVersionByAsset.get(version.assetId) !== version.version
      && (!version.objectKey || !retainedObjectKeys.has(version.objectKey)));
    if (removable.length) {
      await tx.assetVersion.deleteMany({ where: { id: { in: removable.map((version) => version.id) } } });
    }
    return {
      objectKeys: removable.flatMap((version) => version.objectKey ? [version.objectKey] : []),
      count: removable.length,
    };
  }, { isolationLevel: "Serializable" });

  const cleanup = await Promise.allSettled(removed.objectKeys.map((objectKey) => deleteObject(objectKey)));
  return {
    deletedSnapshotId: snapshotId,
    deletedAssetVersions: removed.count,
    objectCleanupFailures: cleanup.filter((result) => result.status === "rejected").length,
  };
}

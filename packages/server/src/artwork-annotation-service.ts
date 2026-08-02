import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import {
  artworkAnnotationAnchorSchema,
  artworkAnnotationCreateInputSchema,
  artworkAnnotationSchema,
  artworkAnnotationUpdateInputSchema,
  projectComicRenderScene,
  validateComicDocument,
  type ArtworkAnnotationAnchor,
  type ArtworkAnnotationAttachmentInput,
  type ArtworkAnnotationStatus,
  type ComicDocument,
  type Geometry,
} from "@lantern/shared";
import { prisma } from "./db";
import { AppError } from "./errors";

type AnnotationRecord = Prisma.ArtworkAnnotationGetPayload<{
  include: {
    references: true;
    attachments: true;
    messages: true;
    work: { include: { agentDraft: true; changeProposal: true } };
  };
}>;

const annotationInclude = {
  references: { orderBy: { sortIndex: "asc" as const } },
  attachments: { orderBy: { sortIndex: "asc" as const } },
  messages: { orderBy: { createdAt: "asc" as const } },
  work: {
    include: { agentDraft: true, changeProposal: true },
    orderBy: { createdAt: "asc" as const },
  },
} as const;

const statusToDatabase = {
  open: "OPEN",
  in_progress: "IN_PROGRESS",
  awaiting_review: "AWAITING_REVIEW",
  resolved: "RESOLVED",
  dismissed: "DISMISSED",
} as const;

function cloneJson<T>(value: Prisma.JsonValue) {
  return structuredClone(value) as T;
}

function stableJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, stableJson(item)]));
}

function fingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(stableJson(value))).digest("hex");
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

async function latestWorking(projectId: string) {
  const working = await prisma.workingRevision.findFirst({ where: { projectId }, orderBy: { revision: "desc" } });
  if (!working) throw new AppError("not_found", "工作稿不存在。", 404);
  return working;
}

function pageLabel(document: ComicDocument, unitId: string) {
  const unit = document.units.find((candidate) => candidate.id === unitId);
  const position = document.reading.unitOrder.indexOf(unitId);
  return unit?.name?.trim() || `Page ${String(Math.max(0, position) + 1).padStart(2, "0")}`;
}

function resolveObject(document: ComicDocument, anchor: ArtworkAnnotationAnchor) {
  const unit = document.units.find((candidate) => candidate.id === anchor.unitId);
  if (!unit) return undefined;
  if (anchor.surfaceId && !unit.surfaces.some((surface) => surface.id === anchor.surfaceId)) return undefined;
  if (anchor.kind === "point") {
    return {
      unit,
      geometry: undefined,
      object: undefined,
      targetLabel: "纸面位置",
      targetFingerprint: undefined,
    };
  }
  if (anchor.objectType === "presentation_unit") {
    if (anchor.objectId !== unit.id) return undefined;
    return {
      unit,
      geometry: { x: 0, y: 0, width: unit.canvas.width, height: unit.canvas.height },
      object: unit,
      targetLabel: unit.name?.trim() || "当前纸面",
      targetFingerprint: fingerprint(unit),
    };
  }
  if (anchor.objectType === "comic_frame") {
    const frame = unit.frames.find((candidate) => candidate.id === anchor.objectId);
    if (!frame) return undefined;
    const index = unit.frames.indexOf(frame) + 1;
    return {
      unit,
      geometry: frame.geometry,
      object: frame,
      targetLabel: frame.name?.trim() || `画格 ${String(index).padStart(2, "0")}`,
      targetFingerprint: fingerprint(frame),
    };
  }
  const scene = projectComicRenderScene(document, unit);
  const node = scene.elements.find((candidate) => candidate.element.id === anchor.objectId);
  const expectedKind = anchor.objectType === "speech_balloon" ? "balloon" : anchor.objectType;
  if (!node || node.element.kind !== expectedKind) return undefined;
  const sameKind = scene.elements.filter((candidate) => candidate.element.kind === node.element.kind);
  const index = sameKind.indexOf(node) + 1;
  const targetLabel = node.element.kind === "image"
    ? node.frame ? `${node.frame.name?.trim() || `画格 ${String(unit.frames.indexOf(node.frame) + 1).padStart(2, "0")}`} · 图片` : "纸面图片"
    : node.element.kind === "balloon"
      ? `对白 ${String(index).padStart(2, "0")}`
      : node.element.kind === "text"
        ? `旁白 ${String(index).padStart(2, "0")}`
        : node.element.kind === "effect"
          ? `效果 ${String(index).padStart(2, "0")}`
        : "纸面元素";
  return {
    unit,
    geometry: node.geometry,
    object: node.element,
    targetLabel,
    targetFingerprint: fingerprint(node.element),
  };
}

function normalizedPointFromGeometry(geometry: Geometry, unitWidth: number, unitHeight: number, localX: number, localY: number) {
  return {
    x: clamp01((geometry.x + geometry.width * localX) / unitWidth),
    y: clamp01((geometry.y + geometry.height * localY) / unitHeight),
  };
}

function persistedAnchor(anchor: ArtworkAnnotationAnchor, document: ComicDocument) {
  const resolved = resolveObject(document, anchor);
  if (!resolved) throw new AppError("annotation_target_missing", "批注位置不存在或已经变化。", 409);
  if (anchor.kind === "point") {
    return {
      anchorKind: "POINT" as const,
      unitId: anchor.unitId,
      surfaceId: anchor.surfaceId,
      objectType: null,
      objectId: null,
      localX: null,
      localY: null,
      unitX: anchor.unitPoint.x,
      unitY: anchor.unitPoint.y,
      targetFingerprint: null,
    };
  }
  const geometry = resolved.geometry!;
  const localX = anchor.localPoint.x;
  const localY = anchor.localPoint.y;
  const unitPoint = normalizedPointFromGeometry(
    geometry,
    resolved.unit.canvas.width,
    resolved.unit.canvas.height,
    localX,
    localY,
  );
  return {
    anchorKind: "OBJECT" as const,
    unitId: anchor.unitId,
    surfaceId: anchor.surfaceId,
    objectType: anchor.objectType,
    objectId: anchor.objectId,
    localX,
    localY,
    unitX: unitPoint.x,
    unitY: unitPoint.y,
    targetFingerprint: resolved.targetFingerprint,
  };
}

function recordAnchor(record: AnnotationRecord["references"][number]): ArtworkAnnotationAnchor {
  if (record.anchorKind === "POINT") {
    return artworkAnnotationAnchorSchema.parse({
      kind: "point",
      unitId: record.unitId,
      ...(record.surfaceId ? { surfaceId: record.surfaceId } : {}),
      unitPoint: { x: record.unitX, y: record.unitY },
    });
  }
  return artworkAnnotationAnchorSchema.parse({
    kind: "object",
    unitId: record.unitId,
    ...(record.surfaceId ? { surfaceId: record.surfaceId } : {}),
    objectType: record.objectType,
    objectId: record.objectId,
    localPoint: { x: record.localX, y: record.localY },
    fallbackUnitPoint: { x: record.unitX, y: record.unitY },
  });
}

function annotationReference(id: string) {
  return `lantern://annotations/${encodeURIComponent(id)}`;
}

export function parseArtworkAnnotationReference(value: string) {
  try {
    const url = new URL(value);
    const [id, extra] = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    if (url.protocol !== "lantern:" || url.hostname !== "annotations" || !id || extra || url.search || url.hash) throw new Error();
    return id;
  } catch {
    throw new AppError("invalid_resource_reference", "批注引用无效。", 422);
  }
}

async function serializeAnnotation(record: AnnotationRecord, document: ComicDocument, currentRevision: number) {
  const references = record.references.map((reference) => {
    const anchor = recordAnchor(reference);
    const resolved = resolveObject(document, anchor);
    const targetState = !resolved
      ? "missing" as const
      : reference.anchorKind === "POINT" || !reference.targetFingerprint || resolved.targetFingerprint === reference.targetFingerprint
        ? "unchanged" as const
        : "changed" as const;
    const resolvedUnitPoint = resolved && anchor.kind === "object" && resolved.geometry
      ? normalizedPointFromGeometry(resolved.geometry, resolved.unit.canvas.width, resolved.unit.canvas.height, anchor.localPoint.x, anchor.localPoint.y)
      : anchor.kind === "point" ? anchor.unitPoint : anchor.fallbackUnitPoint;
    return {
      id: reference.id,
      sortIndex: reference.sortIndex,
      anchor,
      resolvedUnitPoint,
      targetState,
      pageLabel: pageLabel(document, reference.unitId),
      targetLabel: resolved?.targetLabel ?? "原位置",
    };
  });
  return artworkAnnotationSchema.parse({
    id: record.id,
    reference: annotationReference(record.id),
    projectId: record.projectId,
    status: record.status.toLowerCase(),
    version: record.version,
    references,
    attachments: record.attachments.map((attachment) => ({
      id: attachment.id,
      assetId: attachment.assetId,
      versionId: attachment.assetVersionId,
      name: attachment.name,
      sortIndex: attachment.sortIndex,
    })),
    createdWorkingRevision: record.createdWorkingRevision,
    currentWorkingRevision: currentRevision,
    messages: record.messages.map((message) => ({
      id: message.id,
      authorType: message.authorType.toLowerCase(),
      content: message.content,
      createdAt: message.createdAt.toISOString(),
    })),
    work: record.work.map((item) => ({
      id: item.id,
      actorType: item.actorType.toLowerCase(),
      status: item.status.toLowerCase(),
      draft: `lantern://agent-drafts/${encodeURIComponent(item.agentDraftId)}`,
      ...(item.changeProposal ? {
        proposal: `lantern://change-proposals/${encodeURIComponent(item.changeProposal.id)}`,
        reviewPath: `/reviews/${encodeURIComponent(item.changeProposal.id)}`,
      } : {}),
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    })),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    ...(record.resolvedAt ? { resolvedAt: record.resolvedAt.toISOString() } : {}),
    ...(record.dismissedAt ? { dismissedAt: record.dismissedAt.toISOString() } : {}),
  });
}

async function ownedProjectAndWorking(ownerUserId: string, projectId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, ownerUserId, chapter: { archivedAt: null, comic: { archivedAt: null } } },
    select: { id: true, chapter: { select: { comicId: true } } },
  });
  if (!project) throw new AppError("not_found", "创作空间不存在。", 404);
  const working = await latestWorking(project.id);
  return { project, working, document: validateComicDocument(cloneJson<unknown>(working.document)) };
}

async function validatedAttachments(
  ownerUserId: string,
  comicId: string,
  attachments: ArtworkAnnotationAttachmentInput[],
) {
  if (!attachments.length) return [];
  const uniqueVersions = [...new Set(attachments.map((attachment) => attachment.versionId))];
  const versions = await prisma.assetVersion.findMany({
    where: {
      id: { in: uniqueVersions },
      contentType: { in: ["image/png", "image/jpeg", "image/webp"] },
      asset: { ownerUserId, comicId },
    },
    select: { id: true, assetId: true, objectKey: true },
  });
  const byId = new Map(versions.map((version) => [version.id, version]));
  for (const attachment of attachments) {
    const version = byId.get(attachment.versionId);
    if (!version?.objectKey || version.assetId !== attachment.assetId) {
      throw new AppError("invalid_annotation_attachment", "批注图片不存在或不属于当前漫画。", 422);
    }
  }
  return attachments;
}

export async function listArtworkAnnotations(ownerUserId: string, projectId: string, input: {
  statuses?: ArtworkAnnotationStatus[];
  unitId?: string;
  ids?: string[];
  limit?: number;
} = {}) {
  const { working, document } = await ownedProjectAndWorking(ownerUserId, projectId);
  const records = await prisma.artworkAnnotation.findMany({
    where: {
      ownerUserId,
      projectId,
      ...(input.statuses?.length ? { status: { in: input.statuses.map((status) => statusToDatabase[status]) } } : {}),
      ...(input.unitId ? { references: { some: { unitId: input.unitId } } } : {}),
      ...(input.ids?.length ? { id: { in: input.ids } } : {}),
    },
    include: annotationInclude,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: Math.min(200, Math.max(1, input.limit ?? 100)),
  });
  return {
    projectId,
    workingRevision: working.revision,
    annotations: await Promise.all(records.map((record) => serializeAnnotation(record, document, working.revision))),
  };
}

export async function getArtworkAnnotation(ownerUserId: string, annotationId: string) {
  const record = await prisma.artworkAnnotation.findFirst({
    where: { id: annotationId, ownerUserId, project: { chapter: { archivedAt: null, comic: { archivedAt: null } } } },
    include: annotationInclude,
  });
  if (!record) throw new AppError("not_found", "批注不存在。", 404);
  const working = await latestWorking(record.projectId);
  return serializeAnnotation(record, validateComicDocument(cloneJson<unknown>(working.document)), working.revision);
}

export async function createArtworkAnnotation(ownerUserId: string, projectId: string, input: unknown) {
  const parsed = artworkAnnotationCreateInputSchema.parse(input);
  const { project, working, document } = await ownedProjectAndWorking(ownerUserId, projectId);
  if (working.revision !== parsed.expectedWorkingRevision) {
    throw new AppError("revision_conflict", "工作稿已经变化，请重新放置批注。", 409, { currentRevision: working.revision });
  }
  const references = parsed.references.map((anchor, sortIndex) => ({ ...persistedAnchor(anchor, document), sortIndex }));
  const attachments = await validatedAttachments(ownerUserId, project.chapter.comicId, parsed.attachments);
  const created = await prisma.artworkAnnotation.create({
    data: {
      ownerUserId,
      projectId,
      createdWorkingRevision: working.revision,
      references: { create: references },
      attachments: {
        create: attachments.map((attachment, sortIndex) => ({
          assetId: attachment.assetId,
          assetVersionId: attachment.versionId,
          name: attachment.name,
          sortIndex,
        })),
      },
      messages: { create: { authorType: "USER", content: parsed.content } },
    },
    include: annotationInclude,
  });
  return serializeAnnotation(created, document, working.revision);
}

export async function updateArtworkAnnotation(ownerUserId: string, annotationId: string, input: unknown) {
  const parsed = artworkAnnotationUpdateInputSchema.parse(input);
  const existing = await prisma.artworkAnnotation.findFirst({ where: { id: annotationId, ownerUserId } });
  if (!existing) throw new AppError("not_found", "批注不存在。", 404);
  const { project, document } = await ownedProjectAndWorking(ownerUserId, existing.projectId);
  const references = parsed.references?.map((anchor, sortIndex) => ({ ...persistedAnchor(anchor, document), sortIndex }));
  const attachments = parsed.attachments
    ? await validatedAttachments(ownerUserId, project.chapter.comicId, parsed.attachments)
    : undefined;
  const status = parsed.action === "resolve" ? "RESOLVED" as const
    : parsed.action === "dismiss" ? "DISMISSED" as const
    : parsed.action === "reopen" || parsed.content || parsed.references || parsed.attachments ? "OPEN" as const
    : undefined;
  await prisma.$transaction(async (tx) => {
    const changed = await tx.artworkAnnotation.updateMany({
      where: { id: existing.id, ownerUserId, version: parsed.expectedVersion },
      data: {
        ...(status ? { status } : {}),
        ...(status === "RESOLVED" ? { resolvedAt: new Date(), dismissedAt: null } : {}),
        ...(status === "DISMISSED" ? { dismissedAt: new Date(), resolvedAt: null } : {}),
        ...(status === "OPEN" ? { resolvedAt: null, dismissedAt: null } : {}),
        version: { increment: 1 },
      },
    });
    if (changed.count !== 1) throw new AppError("conflict", "批注已经变化，请刷新后再操作。", 409);
    if (references) {
      await tx.artworkAnnotationReference.deleteMany({ where: { annotationId: existing.id } });
      if (references.length) {
        await tx.artworkAnnotationReference.createMany({
          data: references.map((reference) => ({ annotationId: existing.id, ...reference })),
        });
      }
    }
    if (attachments) {
      await tx.artworkAnnotationAttachment.deleteMany({ where: { annotationId: existing.id } });
      if (attachments.length) {
        await tx.artworkAnnotationAttachment.createMany({
          data: attachments.map((attachment, sortIndex) => ({
            annotationId: existing.id,
            assetId: attachment.assetId,
            assetVersionId: attachment.versionId,
            name: attachment.name,
            sortIndex,
          })),
        });
      }
    }
    if (parsed.content) {
      await tx.artworkAnnotationMessage.create({
        data: { annotationId: existing.id, authorType: "USER", content: parsed.content },
      });
    }
  }, { isolationLevel: "Serializable" });
  return getArtworkAnnotation(ownerUserId, existing.id);
}

export async function deleteArtworkAnnotation(ownerUserId: string, annotationId: string) {
  const existing = await prisma.artworkAnnotation.findFirst({
    where: { id: annotationId, ownerUserId },
    select: { id: true },
  });
  if (!existing) throw new AppError("not_found", "批注不存在。", 404);
  await prisma.$transaction([
    prisma.artworkAnnotationWork.deleteMany({ where: { annotationId: existing.id } }),
    prisma.artworkAnnotationMessage.deleteMany({ where: { annotationId: existing.id } }),
    prisma.artworkAnnotationAttachment.deleteMany({ where: { annotationId: existing.id } }),
    prisma.artworkAnnotationReference.deleteMany({ where: { annotationId: existing.id } }),
    prisma.artworkAnnotation.delete({ where: { id: existing.id } }),
  ]);
}

export async function startArtworkAnnotationWork(input: {
  ownerUserId: string;
  draftId: string;
  annotationIds: string[];
  actorType: "EXTERNAL_AGENT" | "INTERNAL_AGENT";
}) {
  const annotationIds = [...new Set(input.annotationIds)];
  const draft = await prisma.agentDraft.findFirst({
    where: { id: input.draftId, ownerUserId: input.ownerUserId, status: "ACTIVE" },
    select: { id: true, projectId: true },
  });
  if (!draft) throw new AppError("not_found", "Agent 工作草稿不存在或已经冻结。", 404);
  const annotations = await prisma.artworkAnnotation.findMany({
    where: { id: { in: annotationIds }, ownerUserId: input.ownerUserId, projectId: draft.projectId },
    select: { id: true, status: true },
  });
  if (annotations.length !== annotationIds.length) throw new AppError("not_found", "部分批注不存在或不属于该工作草稿。", 404);
  if (annotations.some((annotation) => annotation.status === "RESOLVED" || annotation.status === "DISMISSED")) {
    throw new AppError("conflict", "已解决或已忽略的批注不能开始处理。", 409);
  }
  await prisma.$transaction(async (tx) => {
    for (const annotation of annotations) {
      await tx.artworkAnnotationWork.upsert({
        where: { annotationId_agentDraftId: { annotationId: annotation.id, agentDraftId: draft.id } },
        create: { annotationId: annotation.id, agentDraftId: draft.id, actorType: input.actorType },
        update: { status: "IN_PROGRESS", actorType: input.actorType, changeProposalId: null },
      });
    }
    await tx.artworkAnnotation.updateMany({
      where: { id: { in: annotationIds } },
      data: { status: "IN_PROGRESS", version: { increment: 1 }, resolvedAt: null, dismissedAt: null },
    });
  }, { isolationLevel: "Serializable" });
  return listArtworkAnnotations(input.ownerUserId, draft.projectId, { ids: annotationIds });
}

export async function replyToArtworkAnnotations(input: {
  ownerUserId: string;
  annotationIds: string[];
  content: string;
  authorType: "EXTERNAL_AGENT" | "INTERNAL_AGENT";
}) {
  const annotationIds = [...new Set(input.annotationIds)];
  const annotations = await prisma.artworkAnnotation.findMany({
    where: { id: { in: annotationIds }, ownerUserId: input.ownerUserId },
    select: { id: true, projectId: true, status: true },
  });
  if (annotations.length !== annotationIds.length || new Set(annotations.map((item) => item.projectId)).size !== 1) {
    throw new AppError("not_found", "部分批注不存在或不属于同一创作空间。", 404);
  }
  await prisma.$transaction(async (tx) => {
    await tx.artworkAnnotationMessage.createMany({
      data: annotationIds.map((annotationId) => ({ annotationId, authorType: input.authorType, content: input.content })),
    });
    await tx.artworkAnnotation.updateMany({
      where: { id: { in: annotationIds }, status: { notIn: ["RESOLVED", "DISMISSED"] } },
      data: { status: "AWAITING_REVIEW", version: { increment: 1 } },
    });
  }, { isolationLevel: "Serializable" });
  return listArtworkAnnotations(input.ownerUserId, annotations[0]!.projectId, { ids: annotationIds });
}

export async function markAgentDraftAnnotationsAwaitingReview(
  tx: Prisma.TransactionClient,
  draftId: string,
  changeProposalId: string,
) {
  const work = await tx.artworkAnnotationWork.findMany({ where: { agentDraftId: draftId }, select: { annotationId: true } });
  if (!work.length) return;
  const annotationIds = work.map((item) => item.annotationId);
  await tx.artworkAnnotationWork.updateMany({
    where: { agentDraftId: draftId },
    data: { changeProposalId, status: "AWAITING_REVIEW" },
  });
  await tx.artworkAnnotation.updateMany({
    where: { id: { in: annotationIds }, status: { notIn: ["RESOLVED", "DISMISSED"] } },
    data: { status: "AWAITING_REVIEW", version: { increment: 1 } },
  });
}

export async function discardArtworkAnnotationProposal(tx: Prisma.TransactionClient, changeProposalId: string) {
  const work = await tx.artworkAnnotationWork.findMany({ where: { changeProposalId }, select: { annotationId: true } });
  if (!work.length) return;
  const annotationIds = work.map((item) => item.annotationId);
  await tx.artworkAnnotationWork.updateMany({ where: { changeProposalId }, data: { status: "DISCARDED" } });
  await tx.artworkAnnotation.updateMany({
    where: { id: { in: annotationIds }, status: "AWAITING_REVIEW" },
    data: { status: "OPEN", version: { increment: 1 } },
  });
}

export async function markArtworkAnnotationProposalApplied(tx: Prisma.TransactionClient, changeProposalId: string) {
  await tx.artworkAnnotationWork.updateMany({ where: { changeProposalId }, data: { status: "APPLIED" } });
}

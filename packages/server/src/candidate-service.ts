import { AssetKind, CandidateKind, CandidateStatus, type Prisma } from "@prisma/client";
import { normalizeStoryboardBeats, type WorkspaceOperation } from "@lantern/shared";
import { prisma } from "./db";
import { AppError } from "./errors";
import { isWorkbenchAgentCandidateVisible } from "./workbench-agent-visibility";
import { commitChangeSet } from "./workbench-service";

type FrameCandidateApplicationTarget = { unitId: string; frameId: string };

export type CandidateApplicationContext = {
  actor: "human" | "internal" | "external";
  client: { name: string; version?: string };
};

export type CandidateApplyPolicy = {
  externalAgent: "direct" | "product_confirmation";
};

export const defaultCandidateApplyPolicy: CandidateApplyPolicy = Object.freeze({
  externalAgent: "direct",
});

export function assertCandidateApplicationAllowed(
  context: CandidateApplicationContext,
  policy: CandidateApplyPolicy = defaultCandidateApplyPolicy,
) {
  if (!context.client.name.trim()) throw new AppError("validation", "应用候选的客户端名称不能为空。", 400);
  if (context.actor === "external" && policy.externalAgent === "product_confirmation") {
    throw new AppError("confirmation_required", "当前设置要求在 Lantern 中预览并确认后应用候选。", 403);
  }
}

export function assertFrameCandidateApplicationTarget(
  kind: CandidateKind,
  targetValue: Prisma.JsonValue,
  operationsValue: Prisma.JsonValue,
  expectedTarget?: FrameCandidateApplicationTarget,
) {
  if (kind !== CandidateKind.FRAME_IMAGE) return;
  if (!expectedTarget) throw new AppError("validation", "缺少单格图片候选的预览目标。", 422);
  const target = targetValue as { type?: unknown; pageId?: unknown; id?: unknown };
  if (target.type !== "comic_frame" || target.pageId !== expectedTarget.unitId || target.id !== expectedTarget.frameId) {
    throw new AppError("conflict", "预览目标已经变化，请重新打开这个候选。", 409);
  }
  const operations = operationsValue as Array<{ unitId?: unknown; frameId?: unknown }>;
  const targetedOperations = operations.filter((operation) => operation.unitId !== undefined || operation.frameId !== undefined);
  if (!targetedOperations.length || targetedOperations.some((operation) => operation.unitId !== expectedTarget.unitId || operation.frameId !== expectedTarget.frameId)) {
    throw new AppError("validation", "候选操作与预览画格不一致，已拒绝应用。", 422);
  }
}

async function applyAssetCandidate(userId: string, candidateId: string, expectedRevision: number) {
  const candidateState = await prisma.candidate.findFirst({ where: { id: candidateId, ownerUserId: userId, kind: CandidateKind.ASSET } });
  if (!candidateState) throw new AppError("not_found", "资产候选不存在。", 404);
  const workingState = await prisma.workingRevision.findFirst({ where: { projectId: candidateState.projectId }, orderBy: { revision: "desc" } });
  if (!workingState) throw new AppError("not_found", "工作稿不存在。", 404);
  if (workingState.revision !== expectedRevision || candidateState.baseRevision !== workingState.revision || candidateState.status !== CandidateStatus.AVAILABLE) {
    if (candidateState.status === CandidateStatus.AVAILABLE) await prisma.candidate.update({ where: { id: candidateState.id }, data: { status: CandidateStatus.STALE } });
    throw new AppError("conflict", "资产候选已过期。", 409);
  }
  return prisma.$transaction(async (tx) => {
    const candidate = await tx.candidate.findFirst({ where: { id: candidateId, ownerUserId: userId, kind: CandidateKind.ASSET } });
    if (!candidate) throw new AppError("not_found", "资产候选不存在。", 404);
    const working = await tx.workingRevision.findFirst({ where: { projectId: candidate.projectId }, orderBy: { revision: "desc" } });
    if (!working) throw new AppError("not_found", "工作稿不存在。", 404);
    if (working.revision !== expectedRevision || candidate.baseRevision !== working.revision || candidate.status !== CandidateStatus.AVAILABLE) {
      throw new AppError("conflict", "资产候选已过期。", 409);
    }
    const draft = candidate.payload as { kind: string; name: string; description: string; sourceAssetVersionIds?: string[] };
    const kind = draft.kind === "character"
      ? AssetKind.CHARACTER
      : draft.kind === "scene"
        ? AssetKind.SCENE
        : undefined;
    if (!kind) throw new AppError("validation", "资产候选只支持角色或场景。", 422);
    const sourceVersion = draft.sourceAssetVersionIds?.[0]
      ? await tx.assetVersion.findFirst({ where: { id: draft.sourceAssetVersionIds[0], asset: { ownerUserId: userId, projectId: candidate.projectId } } })
      : undefined;
    // Generated candidates already own the stored image through an archived staging
    // asset. Confirm that exact asset instead of duplicating its globally unique
    // objectKey into another AssetVersion.
    const asset = sourceVersion
      ? await tx.asset.update({
          where: { id: sourceVersion.assetId },
          data: {
            archivedAt: null,
            kind,
            name: draft.name,
            description: draft.description,
          },
          include: { versions: true },
        })
      : await tx.asset.create({
          data: {
            ownerUserId: userId,
            projectId: candidate.projectId,
            kind,
            name: draft.name,
            description: draft.description,
            versions: { create: { version: 1, source: "text_candidate", sourceTaskId: candidate.taskId } },
          },
          include: { versions: true },
        });
    if (sourceVersion?.objectKey) {
      await tx.assetImage.upsert({
        where: { assetVersionId: sourceVersion.id },
        create: { assetId: asset.id, assetVersionId: sourceVersion.id, label: "主图", sortIndex: 0 },
        update: {},
      });
    }
    const heads = { ...(working.assetVersionHeads as Record<string, string>), [asset.id]: asset.versions[0].id };
    const next = await tx.workingRevision.create({
      data: {
        projectId: candidate.projectId,
        revision: working.revision + 1,
        document: working.document as Prisma.InputJsonValue,
        storyboardBeats: normalizeStoryboardBeats(working.storyboardBeats) as unknown as Prisma.InputJsonValue,
        storyboardBeatVersionHeads: working.storyboardBeatVersionHeads as Prisma.InputJsonValue,
        assetVersionHeads: heads,
        changeSet: { source: "candidate", sourceCandidateId: candidate.id, operations: [{ type: "create_asset", assetId: asset.id }] },
        sourceCandidateId: candidate.id,
      },
    });
    await tx.candidate.update({
      where: { id: candidate.id },
      data: {
        status: CandidateStatus.APPLIED,
        appliedRevision: next.revision,
        outputRefs: [{ objectType: "asset", objectId: asset.id, versionId: asset.versions[0].id }],
      },
    });
    return { asset, revision: next.revision };
  }, { isolationLevel: "Serializable" });
}

export async function applyCandidate(
  ownerUserId: string,
  candidateId: string,
  input: { expectedWorkingRevision: number; expectedFrameTarget?: FrameCandidateApplicationTarget },
  application: CandidateApplicationContext,
) {
  assertCandidateApplicationAllowed(application);
  const candidate = await prisma.candidate.findFirst({ where: { id: candidateId, ownerUserId } });
  if (!candidate) throw new AppError("not_found", "候选不存在。", 404);
  const payload = candidate.payload && typeof candidate.payload === "object" && !Array.isArray(candidate.payload)
    ? candidate.payload as Record<string, unknown>
    : {};
  if (!isWorkbenchAgentCandidateVisible(candidate.kind, payload)) throw new AppError("validation", "这个候选不属于当前 Agent 能力范围。", 422);
  if (candidate.kind === CandidateKind.ASSET) return applyAssetCandidate(ownerUserId, candidate.id, input.expectedWorkingRevision);
  assertFrameCandidateApplicationTarget(candidate.kind, candidate.target, candidate.operations, input.expectedFrameTarget);
  const working = await prisma.workingRevision.findFirst({ where: { projectId: candidate.projectId }, orderBy: { revision: "desc" } });
  if (!working) throw new AppError("not_found", "工作稿不存在。", 404);
  if (candidate.status !== CandidateStatus.AVAILABLE || candidate.baseRevision !== working.revision || input.expectedWorkingRevision !== working.revision) {
    if (candidate.status === CandidateStatus.AVAILABLE) await prisma.candidate.update({ where: { id: candidate.id }, data: { status: CandidateStatus.STALE } });
    throw new AppError("conflict", "候选基于较早的工作稿，请按当前内容重新生成。", 409, { currentRevision: working.revision });
  }
  const operations = candidate.operations as unknown as WorkspaceOperation[];
  return commitChangeSet({
    ownerUserId,
    projectId: candidate.projectId,
    expectedRevision: input.expectedWorkingRevision,
    candidateId: candidate.id,
    changeSet: {
      id: `candidate:${candidate.id}`,
      projectId: candidate.projectId,
      baseRevision: candidate.baseRevision,
      source: "candidate",
      sourceCandidateId: candidate.id,
      commands: operations,
    },
  });
}

export async function discardCandidate(ownerUserId: string, candidateId: string) {
  const result = await prisma.candidate.updateMany({ where: { id: candidateId, ownerUserId, status: CandidateStatus.AVAILABLE }, data: { status: CandidateStatus.DISCARDED } });
  if (!result.count) throw new AppError("conflict", "候选已不可丢弃。", 409);
  return { status: "discarded" };
}

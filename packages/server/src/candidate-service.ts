import { AssetKind, CandidateKind, CandidateStatus, type Prisma } from "@prisma/client";
import { normalizeStoryboardBeats } from "../../shared/src";
import { prisma } from "./db";
import { AppError } from "./errors";

export async function applyAssetCandidate(userId: string, candidateId: string, expectedRevision: number) {
  return prisma.$transaction(async (tx) => {
    const candidate = await tx.candidate.findFirst({ where: { id: candidateId, ownerUserId: userId, kind: CandidateKind.ASSET } });
    if (!candidate) throw new AppError("not_found", "资产候选不存在。", 404);
    const working = await tx.workingRevision.findFirst({ where: { projectId: candidate.projectId }, orderBy: { revision: "desc" } });
    if (!working) throw new AppError("not_found", "工作稿不存在。", 404);
    if (working.revision !== expectedRevision || candidate.baseRevision !== working.revision || candidate.status !== CandidateStatus.AVAILABLE) {
      await tx.candidate.update({ where: { id: candidate.id }, data: { status: CandidateStatus.STALE } });
      throw new AppError("conflict", "资产候选已过期。", 409);
    }
    const draft = candidate.payload as { kind: string; name: string; description: string; attributes?: Record<string, string>; sourceAssetVersionIds?: string[] };
    const kind = ({ character: AssetKind.CHARACTER, scene: AssetKind.SCENE, style: AssetKind.STYLE, prop: AssetKind.PROP } as Record<string, AssetKind>)[draft.kind] ?? AssetKind.PROP;
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
            attributes: draft.attributes ?? {},
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
            attributes: draft.attributes ?? {},
            versions: { create: { version: 1, source: "text_candidate", sourceTaskId: candidate.taskId } },
          },
          include: { versions: true },
        });
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

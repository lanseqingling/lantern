import { AssetKind, AssetLibraryStatus } from "@prisma/client";
import { prisma } from "./db";
import { AppError } from "./errors";
import type { StoredObject } from "./object-storage";

export type UploadedImage = {
  stored: StoredObject;
  contentType: StoredObject["contentType"];
  filename: string;
};

export async function createUploadedAsset(input: {
  ownerUserId: string;
  projectId: string;
  placeOnCanvas: boolean;
  conversationAttachment?: boolean;
  kind?: string;
  name?: string;
  description?: string;
  x?: number;
  y?: number;
  uploaded: UploadedImage;
}) {
  const { ownerUserId, projectId, placeOnCanvas, conversationAttachment, uploaded } = input;
  const kindText = input.kind ?? "reference_image";
  const kind = ({ character: AssetKind.CHARACTER, scene: AssetKind.SCENE, style: AssetKind.STYLE, sketch: AssetKind.SKETCH, reference_image: AssetKind.REFERENCE_IMAGE } as Record<string, AssetKind>)[kindText] ?? AssetKind.REFERENCE_IMAGE;
  return prisma.$transaction(async (tx) => {
    const project = await tx.project.findFirst({ where: { id: projectId, ownerUserId, chapter: { archivedAt: null, comic: { archivedAt: null } } }, select: { id: true } });
    if (!project) throw new AppError("not_found", "创作空间不存在。", 404);
    const created = await tx.asset.create({
      data: {
        ownerUserId,
        projectId,
        kind,
        libraryStatus: placeOnCanvas || conversationAttachment ? AssetLibraryStatus.CANVAS_ONLY : AssetLibraryStatus.LIBRARY,
        name: input.name?.trim() || uploaded.filename.replace(/\.[^.]+$/, "") || "上传图片",
        description: input.description?.trim() || (conversationAttachment ? "对话图片附件" : "用户上传图片"),
        versions: {
          create: {
            version: 1,
            objectKey: uploaded.stored.objectKey,
            contentType: uploaded.contentType,
            byteSize: uploaded.stored.byteSize,
            width: uploaded.stored.width,
            height: uploaded.stored.height,
            checksum: uploaded.stored.checksum,
            source: "upload",
          },
        },
      },
      include: { versions: true },
    });
    await tx.assetImage.create({
      data: { assetId: created.id, assetVersionId: created.versions[0].id, label: "主图", sortIndex: 0 },
    });
    if (placeOnCanvas) {
      await tx.canvasAssetListItem.create({ data: { ownerUserId, projectId, assetId: created.id, displayName: created.name, displayKind: created.kind } });
      await tx.canvasReferencePlacement.create({
        data: {
          ownerUserId,
          projectId,
          assetId: created.id,
          assetVersionId: created.versions[0].id,
          x: input.x ?? 320,
          y: input.y ?? 220,
        },
      });
    }
    return created;
  });
}

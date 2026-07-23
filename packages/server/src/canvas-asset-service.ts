import { AssetKind, AssetLibraryStatus } from "@prisma/client";
import { prisma } from "./db";
import { AppError } from "./errors";

export async function placeAssetOnCanvas(ownerUserId: string, projectId: string, assetId: string, input: { x?: number; y?: number }) {
  return prisma.$transaction(async (tx) => {
    const targetProject = await tx.project.findFirst({ where: { id: projectId, ownerUserId }, include: { chapter: { select: { comicId: true } } } });
    if (!targetProject) throw new AppError("not_found", "创作空间不存在。", 404);
    const asset = await tx.asset.findFirst({
      where: { id: assetId, ownerUserId, archivedAt: null, comicId: targetProject.chapter.comicId },
      include: {
        images: { include: { assetVersion: true }, orderBy: [{ sortIndex: "asc" }, { createdAt: "asc" }], take: 1 },
        versions: { where: { objectKey: { not: null } }, orderBy: { version: "desc" }, take: 1 },
      },
    });
    const version = asset?.images[0]?.assetVersion ?? asset?.versions[0];
    if (!asset || !version) throw new AppError("invalid_asset", "这个资产还没有可放到画布的确认图片。", 422);
    await tx.canvasAssetListItem.upsert({
      where: { projectId_assetId: { projectId: targetProject.id, assetId: asset.id } },
      create: { ownerUserId, projectId: targetProject.id, assetId: asset.id, displayName: asset.name },
      update: { hiddenAt: null },
    });
    return tx.canvasReferencePlacement.create({
      data: { ownerUserId, projectId: targetProject.id, assetId: asset.id, assetVersionId: version.id, x: input.x ?? 320, y: input.y ?? 180 },
    });
  });
}

export async function updateCanvasAssetListItem(ownerUserId: string, itemId: string, input: { displayName?: string; pinned?: boolean; hidden?: boolean; sortIndex?: number }) {
  const item = await prisma.canvasAssetListItem.findFirst({ where: { id: itemId, ownerUserId } });
  if (!item) throw new AppError("not_found", "画布资产列表项不存在。", 404);
  if (input.sortIndex !== undefined && (!Number.isInteger(input.sortIndex) || input.sortIndex < -100000 || input.sortIndex > 100000)) throw new AppError("validation", "资产排序值无效。", 400);
  return prisma.canvasAssetListItem.update({
    where: { id: item.id },
    data: {
      ...(input.displayName !== undefined ? { displayName: input.displayName.trim().slice(0, 120) || item.displayName } : {}),
      ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
      ...(input.hidden !== undefined ? { hiddenAt: input.hidden ? new Date() : null } : {}),
      ...(input.sortIndex !== undefined ? { sortIndex: input.sortIndex } : {}),
    },
  });
}

export async function saveCanvasAssetToLibrary(ownerUserId: string, itemId: string, input: { name?: string; description?: string; kind?: "character" | "scene" | "prop" | "reference_image" }) {
  return prisma.$transaction(async (tx) => {
    const item = await tx.canvasAssetListItem.findFirst({ where: { id: itemId, ownerUserId }, include: { asset: true } });
    if (!item) throw new AppError("not_found", "画布资产列表项不存在。", 404);
    const kind = input.kind ? ({ character: AssetKind.CHARACTER, scene: AssetKind.SCENE, prop: AssetKind.PROP, reference_image: AssetKind.REFERENCE_IMAGE } as const)[input.kind] : item.asset.kind;
    const name = input.name?.trim().slice(0, 120) || item.asset.name;
    const asset = await tx.asset.update({ where: { id: item.assetId }, data: { libraryStatus: AssetLibraryStatus.LIBRARY, kind, name, ...(input.description !== undefined ? { description: input.description.trim().slice(0, 2000) } : {}) } });
    await tx.canvasAssetListItem.update({ where: { id: item.id }, data: { displayName: name } });
    return { itemId: item.id, assetId: asset.id, libraryStatus: asset.libraryStatus.toLowerCase(), kind: asset.kind.toLowerCase() };
  });
}

export async function updateCanvasPlacement(ownerUserId: string, placementId: string, input: { x?: number; y?: number; zoom?: number; zIndex?: number; collapsed?: boolean; pinned?: boolean; assetVersionId?: string }) {
  const placement = await prisma.canvasReferencePlacement.findFirst({ where: { id: placementId, ownerUserId } });
  if (!placement) throw new AppError("not_found", "图片卡不存在。", 404);
  if (input.zoom !== undefined && (!Number.isFinite(input.zoom) || input.zoom < 0.12 || input.zoom > 20)) throw new AppError("validation", "图片缩放值无效。", 400);
  if (input.x !== undefined && !Number.isFinite(input.x)) throw new AppError("validation", "图片位置无效。", 400);
  if (input.y !== undefined && !Number.isFinite(input.y)) throw new AppError("validation", "图片位置无效。", 400);
  if (input.zIndex !== undefined && (!Number.isInteger(input.zIndex) || input.zIndex < 0 || input.zIndex > 10000)) throw new AppError("validation", "图片层级无效。", 400);
  if (input.assetVersionId !== undefined) {
    const image = await prisma.assetImage.findFirst({ where: { assetId: placement.assetId, assetVersionId: input.assetVersionId }, select: { id: true } });
    if (!image) throw new AppError("validation", "这张图片不属于当前资产。", 400);
  }
  return prisma.canvasReferencePlacement.update({ where: { id: placement.id }, data: { x: input.x, y: input.y, zoom: input.zoom, zIndex: input.zIndex, collapsed: input.collapsed, pinned: input.pinned, assetVersionId: input.assetVersionId } });
}

export async function deleteCanvasPlacement(ownerUserId: string, placementId: string) {
  const placement = await prisma.canvasReferencePlacement.findFirst({ where: { id: placementId, ownerUserId } });
  if (!placement) throw new AppError("not_found", "画布对象不存在。", 404);
  await prisma.canvasReferencePlacement.delete({ where: { id: placement.id } });
  return { id: placement.id, deleted: true };
}

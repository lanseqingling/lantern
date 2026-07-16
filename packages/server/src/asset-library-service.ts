import { AssetKind, AssetLibraryStatus, type Prisma } from "@prisma/client";
import { prisma } from "./db";
import { AppError } from "./errors";
import { createSignedAssetPath } from "./signed-assets";
import type { UploadedImage } from "./asset-service";

const galleryImageInclude = {
  assetVersion: true,
} satisfies Prisma.AssetImageInclude;

const galleryOrder = [{ sortIndex: "asc" as const }, { createdAt: "asc" as const }, { id: "asc" as const }];

type AssetWithGallery = Prisma.AssetGetPayload<{
  include: {
    images: { include: typeof galleryImageInclude };
  };
}>;

function serializedImages(asset: AssetWithGallery) {
  return asset.images
    .filter((image) => Boolean(image.assetVersion.objectKey))
    .map((image, index) => ({
      id: image.id,
      label: image.label || "图片",
      sortIndex: image.sortIndex,
      isPrimary: index === 0,
      versionId: image.assetVersionId,
      contentUrl: createSignedAssetPath(image.assetVersionId),
      width: image.assetVersion.width ?? undefined,
      height: image.assetVersion.height ?? undefined,
    }));
}

async function requireOwnedLibraryAsset(ownerUserId: string, assetId: string) {
  const asset = await prisma.asset.findFirst({
    where: { id: assetId, ownerUserId, archivedAt: null, libraryStatus: AssetLibraryStatus.LIBRARY },
    select: { id: true, currentVersionNumber: true, projectId: true },
  });
  if (!asset) throw new AppError("not_found", "资产不存在。", 404);
  return asset;
}

async function normalizeImageOrder(tx: Prisma.TransactionClient, assetId: string, primaryImageId?: string) {
  const images = await tx.assetImage.findMany({
    where: { assetId },
    orderBy: galleryOrder,
    select: { id: true },
  });
  const ordered = primaryImageId
    ? [...images.filter((image) => image.id === primaryImageId), ...images.filter((image) => image.id !== primaryImageId)]
    : images;
  await Promise.all(ordered.map((image, index) => tx.assetImage.update({ where: { id: image.id }, data: { sortIndex: index * 10 } })));
}

export async function appendAssetImage(ownerUserId: string, assetId: string, uploaded: UploadedImage) {
  const asset = await requireOwnedLibraryAsset(ownerUserId, assetId);
  await prisma.$transaction(async (tx) => {
    const latest = await tx.assetVersion.findFirst({ where: { assetId }, orderBy: { version: "desc" }, select: { version: true } });
    const imageCount = await tx.assetImage.count({ where: { assetId } });
    const nextVersion = (latest?.version ?? asset.currentVersionNumber) + 1;
    const version = await tx.assetVersion.create({
      data: {
        assetId,
        version: nextVersion,
        objectKey: uploaded.stored.objectKey,
        contentType: uploaded.contentType,
        byteSize: uploaded.stored.byteSize,
        width: uploaded.stored.width,
        height: uploaded.stored.height,
        checksum: uploaded.stored.checksum,
        source: "upload",
      },
    });
    await tx.assetImage.create({
      data: {
        assetId,
        assetVersionId: version.id,
        label: uploaded.filename.replace(/\.[^.]+$/, "").trim() || `图片 ${imageCount + 1}`,
        sortIndex: imageCount * 10,
      },
    });
    await tx.asset.update({ where: { id: assetId }, data: { currentVersionNumber: nextVersion } });
  });
  return getAssetFamilyDetail(ownerUserId, assetId);
}

export async function setPrimaryAssetImage(ownerUserId: string, assetId: string, imageId: string) {
  await requireOwnedLibraryAsset(ownerUserId, assetId);
  const image = await prisma.assetImage.findFirst({ where: { id: imageId, assetId }, select: { id: true } });
  if (!image) throw new AppError("not_found", "图片不存在。", 404);
  await prisma.$transaction(async (tx) => {
    await normalizeImageOrder(tx, assetId, image.id);
    await tx.asset.update({ where: { id: assetId }, data: { updatedAt: new Date() } });
  });
  return getAssetFamilyDetail(ownerUserId, assetId);
}

export async function renameAssetImage(ownerUserId: string, assetId: string, imageId: string, label: string) {
  await requireOwnedLibraryAsset(ownerUserId, assetId);
  const image = await prisma.assetImage.findFirst({ where: { id: imageId, assetId }, select: { id: true } });
  if (!image) throw new AppError("not_found", "图片不存在。", 404);
  await prisma.$transaction([
    prisma.assetImage.update({ where: { id: image.id }, data: { label } }),
    prisma.asset.update({ where: { id: assetId }, data: { updatedAt: new Date() } }),
  ]);
  return getAssetFamilyDetail(ownerUserId, assetId);
}

export async function deleteAssetImage(ownerUserId: string, assetId: string, imageId: string) {
  await requireOwnedLibraryAsset(ownerUserId, assetId);
  const image = await prisma.assetImage.findFirst({ where: { id: imageId, assetId }, select: { id: true } });
  if (!image) throw new AppError("not_found", "图片不存在。", 404);
  await prisma.$transaction(async (tx) => {
    await tx.assetImage.delete({ where: { id: image.id } });
    await normalizeImageOrder(tx, assetId);
    await tx.asset.update({ where: { id: assetId }, data: { updatedAt: new Date() } });
  });
  return getAssetFamilyDetail(ownerUserId, assetId);
}

function detailEntry(asset: AssetWithGallery, fallbackLabel: string) {
  return {
    id: asset.id,
    label: asset.variantLabel?.trim() || fallbackLabel,
    name: asset.name,
    description: asset.description,
    images: serializedImages(asset),
    updatedAt: asset.updatedAt.toISOString(),
  };
}

export async function listComicAssetCards(ownerUserId: string, comicId: string) {
  const comic = await prisma.comic.findFirst({ where: { id: comicId, ownerUserId, archivedAt: null }, select: { id: true } });
  if (!comic) throw new AppError("not_found", "漫画不存在。", 404);

  const assets = await prisma.asset.findMany({
    where: {
      ownerUserId,
      archivedAt: null,
      variantOfAssetId: null,
      kind: { not: AssetKind.GENERATED_IMAGE },
      libraryStatus: AssetLibraryStatus.LIBRARY,
      project: { chapter: { comicId: comic.id, archivedAt: null } },
    },
    include: {
      project: { select: { chapterId: true } },
      images: { include: galleryImageInclude, orderBy: galleryOrder },
      _count: {
        select: {
          variants: {
            where: { ownerUserId, archivedAt: null, libraryStatus: AssetLibraryStatus.LIBRARY, project: { chapter: { comicId: comic.id, archivedAt: null } } },
          },
        },
      },
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
  });

  return assets.map((asset) => {
    const cover = serializedImages(asset)[0];
    return {
      id: asset.id,
      chapterId: asset.project.chapterId,
      kind: asset.kind.toLowerCase(),
      name: asset.name,
      description: asset.description,
      versionId: cover?.versionId,
      contentUrl: cover?.contentUrl,
      variantCount: asset._count.variants,
      updatedAt: asset.updatedAt.toISOString(),
    };
  });
}

export async function getAssetFamilyDetail(ownerUserId: string, assetId: string) {
  const requested = await prisma.asset.findFirst({
    where: { id: assetId, ownerUserId, archivedAt: null, libraryStatus: AssetLibraryStatus.LIBRARY },
    select: { id: true, variantOfAssetId: true, project: { select: { chapter: { select: { comicId: true, archivedAt: true } } } } },
  });
  if (!requested || requested.project.chapter.archivedAt) throw new AppError("not_found", "资产不存在。", 404);

  const rootId = requested.variantOfAssetId ?? requested.id;
  const root = await prisma.asset.findFirst({
    where: {
      id: rootId,
      ownerUserId,
      archivedAt: null,
      variantOfAssetId: null,
      kind: { not: AssetKind.GENERATED_IMAGE },
      libraryStatus: AssetLibraryStatus.LIBRARY,
      project: { chapter: { comicId: requested.project.chapter.comicId, archivedAt: null } },
    },
    include: {
      images: { include: galleryImageInclude, orderBy: galleryOrder },
      variants: {
        where: {
          ownerUserId,
          archivedAt: null,
          libraryStatus: AssetLibraryStatus.LIBRARY,
          project: { chapter: { comicId: requested.project.chapter.comicId, archivedAt: null } },
        },
        include: {
          images: { include: galleryImageInclude, orderBy: galleryOrder },
        },
        orderBy: [{ variantSortIndex: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      },
    },
  });
  if (!root) throw new AppError("not_found", "资产不存在。", 404);

  return {
    id: root.id,
    kind: root.kind.toLowerCase(),
    root: detailEntry(root, root.name),
    variants: root.variants
      .filter((variant) => variant.kind === root.kind && variant.variantOfAssetId === root.id)
      .map((variant) => detailEntry(variant, variant.name)),
  };
}

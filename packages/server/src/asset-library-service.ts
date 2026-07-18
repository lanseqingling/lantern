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

async function findComicVisualStyleAsset(ownerUserId: string, comicId: string) {
  return prisma.asset.findFirst({
    where: {
      ownerUserId,
      kind: AssetKind.STYLE,
      libraryStatus: AssetLibraryStatus.LIBRARY,
      variantOfAssetId: null,
      archivedAt: null,
      project: { chapter: { comicId, archivedAt: null } },
    },
    include: { images: { include: galleryImageInclude, orderBy: galleryOrder } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

function comicVisualStylePayload(asset: AssetWithGallery | null) {
  return { assetId: asset?.id, images: asset ? serializedImages(asset) : [] };
}

export async function getComicVisualStyle(ownerUserId: string, comicId: string) {
  const comic = await prisma.comic.findFirst({ where: { id: comicId, ownerUserId, archivedAt: null }, select: { id: true } });
  if (!comic) throw new AppError("not_found", "漫画不存在。", 404);
  return comicVisualStylePayload(await findComicVisualStyleAsset(ownerUserId, comic.id));
}

export async function appendComicVisualStyleImage(ownerUserId: string, comicId: string, uploaded: UploadedImage) {
  const comic = await prisma.comic.findFirst({
    where: { id: comicId, ownerUserId, archivedAt: null },
    select: {
      id: true,
      chapters: {
        where: { archivedAt: null, project: { isNot: null } },
        orderBy: { number: "asc" },
        take: 1,
        select: { project: { select: { id: true } } },
      },
    },
  });
  if (!comic) throw new AppError("not_found", "漫画不存在。", 404);
  const existing = await findComicVisualStyleAsset(ownerUserId, comic.id);
  if (existing) {
    await appendOwnedAssetImageData(existing, uploaded);
    return comicVisualStylePayload(await findComicVisualStyleAsset(ownerUserId, comic.id));
  }
  const projectId = comic.chapters[0]?.project?.id;
  if (!projectId) throw new AppError("invalid_state", "请先创建一个漫画章节，再上传视觉风格参考图。", 422);

  await prisma.$transaction(async (tx) => {
    const asset = await tx.asset.create({
      data: {
        ownerUserId,
        projectId,
        kind: AssetKind.STYLE,
        libraryStatus: AssetLibraryStatus.LIBRARY,
        name: "视觉风格",
        description: "",
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
      data: {
        assetId: asset.id,
        assetVersionId: asset.versions[0].id,
        label: uploaded.filename.replace(/\.[^.]+$/, "").trim() || "风格参考 1",
        sortIndex: 0,
      },
    });
  });
  return comicVisualStylePayload(await findComicVisualStyleAsset(ownerUserId, comic.id));
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

async function appendOwnedAssetImageData(asset: { id: string; currentVersionNumber: number }, uploaded: UploadedImage) {
  const assetId = asset.id;
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
}

export async function appendAssetImage(ownerUserId: string, assetId: string, uploaded: UploadedImage) {
  await appendOwnedAssetImageData(await requireOwnedLibraryAsset(ownerUserId, assetId), uploaded);
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

export async function archiveAssetFamily(ownerUserId: string, assetId: string) {
  return prisma.$transaction(async (tx) => {
    const requested = await tx.asset.findFirst({
      where: { id: assetId, ownerUserId, archivedAt: null, libraryStatus: AssetLibraryStatus.LIBRARY },
      select: { id: true, variantOfAssetId: true },
    });
    if (!requested) throw new AppError("not_found", "资产不存在。", 404);

    const rootId = requested.variantOfAssetId ?? requested.id;
    const family = await tx.asset.findMany({
      where: {
        ownerUserId,
        archivedAt: null,
        libraryStatus: AssetLibraryStatus.LIBRARY,
        OR: [{ id: rootId, variantOfAssetId: null }, { variantOfAssetId: rootId }],
      },
      select: { id: true },
    });
    if (!family.some((asset) => asset.id === rootId)) throw new AppError("not_found", "资产不存在。", 404);

    const familyIds = family.map((asset) => asset.id);
    const archivedAt = new Date();
    await tx.asset.updateMany({ where: { id: { in: familyIds }, ownerUserId, archivedAt: null }, data: { archivedAt } });
    await tx.canvasAssetListItem.updateMany({ where: { assetId: { in: familyIds }, ownerUserId }, data: { hiddenAt: archivedAt } });
    return { id: rootId, deleted: true, archivedAssetIds: familyIds };
  });
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
      kind: { notIn: [AssetKind.GENERATED_IMAGE, AssetKind.STYLE] },
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

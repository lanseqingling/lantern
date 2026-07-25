import { AssetKind, AssetLibraryStatus, AssetVersionOrigin, ExternalUploadStatus, type Prisma } from "@prisma/client";
import { prisma } from "./db";
import { AppError } from "./errors";
import { prepareExternalAssetUpload } from "./external-upload-service";
import { deleteObject, deleteTemporaryObject, getTemporaryObject, putImage } from "./object-storage";
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
      version: image.assetVersion.version,
      contentUrl: createSignedAssetPath(image.assetVersionId),
      contentType: image.assetVersion.contentType ?? undefined,
      byteSize: image.assetVersion.byteSize ?? undefined,
      width: image.assetVersion.width ?? undefined,
      height: image.assetVersion.height ?? undefined,
      checksum: image.assetVersion.checksum ?? undefined,
      createdAt: image.assetVersion.createdAt.toISOString(),
    }));
}

async function requireOwnedLibraryAsset(ownerUserId: string, assetId: string) {
  const asset = await prisma.asset.findFirst({
    where: { id: assetId, ownerUserId, archivedAt: null, libraryStatus: AssetLibraryStatus.LIBRARY },
    select: { id: true, currentVersionNumber: true, comicId: true },
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
      comicId,
      comic: { archivedAt: null },
    },
    include: { images: { include: galleryImageInclude, orderBy: galleryOrder } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

async function ensureComicVisualStyleAsset(ownerUserId: string, comicId: string) {
  const comic = await prisma.comic.findFirst({
    where: { id: comicId, ownerUserId, archivedAt: null },
    select: { id: true },
  });
  if (!comic) throw new AppError("not_found", "漫画不存在。", 404);
  const existing = await findComicVisualStyleAsset(ownerUserId, comic.id);
  if (existing) return existing;
  await prisma.asset.create({
    data: {
      ownerUserId,
      comicId: comic.id,
      kind: AssetKind.STYLE,
      libraryStatus: AssetLibraryStatus.LIBRARY,
      currentVersionNumber: 0,
      name: "视觉风格",
      description: "",
    },
  });
  return (await findComicVisualStyleAsset(ownerUserId, comic.id))!;
}

function comicVisualStylePayload(asset: AssetWithGallery | null) {
  return { assetId: asset?.id, images: asset ? serializedImages(asset) : [] };
}

export async function getComicVisualStyle(ownerUserId: string, comicId: string) {
  const comic = await prisma.comic.findFirst({ where: { id: comicId, ownerUserId, archivedAt: null }, select: { id: true } });
  if (!comic) throw new AppError("not_found", "漫画不存在。", 404);
  return comicVisualStylePayload(await findComicVisualStyleAsset(ownerUserId, comic.id));
}

export async function prepareExternalComicVisualStyleImageUpload(
  ownerUserId: string,
  comicId: string,
  input: { filename: string; label?: string },
) {
  const asset = await ensureComicVisualStyleAsset(ownerUserId, comicId);
  return prepareExternalAssetUpload(ownerUserId, asset.id, input);
}

export async function attachExternalComicVisualStyleImage(ownerUserId: string, comicId: string, uploadId: string) {
  const asset = await ensureComicVisualStyleAsset(ownerUserId, comicId);
  const detail = await attachExternalAssetImage(ownerUserId, asset.id, uploadId);
  return {
    ...comicVisualStylePayload(await findComicVisualStyleAsset(ownerUserId, comicId)),
    attached: detail.attached,
  };
}

async function requireComicVisualStyleAsset(ownerUserId: string, comicId: string) {
  const asset = await findComicVisualStyleAsset(ownerUserId, comicId);
  if (!asset) throw new AppError("not_found", "视觉风格图片不存在。", 404);
  return asset;
}

export async function setPrimaryComicVisualStyleImage(ownerUserId: string, comicId: string, imageId: string) {
  const asset = await requireComicVisualStyleAsset(ownerUserId, comicId);
  await setPrimaryAssetImage(ownerUserId, asset.id, imageId);
  return comicVisualStylePayload(await findComicVisualStyleAsset(ownerUserId, comicId));
}

export async function renameComicVisualStyleImage(ownerUserId: string, comicId: string, imageId: string, label: string) {
  const asset = await requireComicVisualStyleAsset(ownerUserId, comicId);
  await renameAssetImage(ownerUserId, asset.id, imageId, label);
  return comicVisualStylePayload(await findComicVisualStyleAsset(ownerUserId, comicId));
}

export async function archiveComicVisualStyleImage(ownerUserId: string, comicId: string, imageId: string) {
  const asset = await requireComicVisualStyleAsset(ownerUserId, comicId);
  await deleteAssetImage(ownerUserId, asset.id, imageId);
  return comicVisualStylePayload(await findComicVisualStyleAsset(ownerUserId, comicId));
}

export async function appendComicVisualStyleImage(ownerUserId: string, comicId: string, uploaded: UploadedImage) {
  const comic = await prisma.comic.findFirst({
    where: { id: comicId, ownerUserId, archivedAt: null },
    select: { id: true },
  });
  if (!comic) throw new AppError("not_found", "漫画不存在。", 404);
  const existing = await findComicVisualStyleAsset(ownerUserId, comic.id);
  if (existing) {
    await appendOwnedAssetImageData(existing, uploaded);
    return comicVisualStylePayload(await findComicVisualStyleAsset(ownerUserId, comic.id));
  }
  await prisma.$transaction(async (tx) => {
    const asset = await tx.asset.create({
      data: {
        ownerUserId,
        comicId: comic.id,
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
            origin: AssetVersionOrigin.UPLOAD,
          },
        },
      },
      include: { versions: true },
    });
    await tx.assetImage.create({
      data: {
        assetId: asset.id,
        assetVersionId: asset.versions[0].id,
        label: uploaded.filename.replace(/\.[^.]+$/, "").trim() || "风格图片 1",
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
        origin: AssetVersionOrigin.UPLOAD,
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

export async function attachExternalAssetImage(ownerUserId: string, assetId: string, uploadId: string) {
  const asset = await requireOwnedLibraryAsset(ownerUserId, assetId);
  const upload = await prisma.externalAssetUpload.findFirst({ where: { id: uploadId, ownerUserId, assetId: asset.id } });
  if (!upload) throw new AppError("not_found", "图片上传记录不存在或不属于该资产。", 404);
  if (upload.status === ExternalUploadStatus.CONSUMED && upload.assetVersionId && upload.assetImageId) {
    return { ...await getAssetFamilyDetail(ownerUserId, asset.id), attached: { versionId: upload.assetVersionId, imageId: upload.assetImageId, replayed: true } };
  }
  if (upload.status !== ExternalUploadStatus.UPLOADED
    || !upload.temporaryObjectKey
    || !upload.contentType
    || upload.byteSize === null
    || !upload.checksum) {
    throw new AppError("upload_not_ready", "请先把图片上传到 Lantern 返回的一次性位置。", 409);
  }
  const temporaryBytes = await getTemporaryObject(upload.temporaryObjectKey)
    .catch(() => { throw new AppError("upload_not_ready", "临时图片不可用，请重新创建上传位置。", 409); });
  const stored = await putImage(temporaryBytes, `external-assets/${asset.id}`);
  if (stored.checksum !== upload.checksum) {
    await deleteObject(stored.objectKey);
    throw new AppError("upload_corrupted", "临时图片校验失败，请重新上传。", 409);
  }
  let attached: { versionId: string; imageId: string; replayed: boolean };
  try {
    attached = await prisma.$transaction(async (tx) => {
      const currentUpload = await tx.externalAssetUpload.findFirst({ where: { id: upload.id, ownerUserId, assetId: asset.id } });
      if (currentUpload?.status === ExternalUploadStatus.CONSUMED && currentUpload.assetVersionId && currentUpload.assetImageId) {
        return { versionId: currentUpload.assetVersionId, imageId: currentUpload.assetImageId, replayed: true };
      }
      if (currentUpload?.status !== ExternalUploadStatus.UPLOADED || currentUpload.temporaryObjectKey !== upload.temporaryObjectKey) {
        throw new AppError("upload_conflict", "该图片上传已经被其他操作处理。", 409);
      }
      const latest = await tx.assetVersion.findFirst({ where: { assetId: asset.id }, orderBy: { version: "desc" }, select: { version: true } });
      const imageCount = await tx.assetImage.count({ where: { assetId: asset.id } });
      const nextVersion = (latest?.version ?? asset.currentVersionNumber) + 1;
      const version = await tx.assetVersion.create({
        data: {
          assetId: asset.id,
          version: nextVersion,
          objectKey: stored.objectKey,
          contentType: stored.contentType,
          byteSize: stored.byteSize,
          width: stored.width,
          height: stored.height,
          checksum: stored.checksum,
          origin: AssetVersionOrigin.EXTERNAL_UPLOAD,
        },
      });
      const image = await tx.assetImage.create({
        data: {
          assetId: asset.id,
          assetVersionId: version.id,
          label: currentUpload.label || currentUpload.filename.replace(/\.[^.]+$/, "").trim() || `图片 ${imageCount + 1}`,
          sortIndex: imageCount * 10,
        },
      });
      await tx.asset.update({ where: { id: asset.id }, data: { currentVersionNumber: nextVersion } });
      await tx.externalAssetUpload.update({
        where: { id: currentUpload.id },
        data: {
          status: ExternalUploadStatus.CONSUMED,
          temporaryObjectKey: null,
          assetVersionId: version.id,
          assetImageId: image.id,
          consumedAt: new Date(),
        },
      });
      return { versionId: version.id, imageId: image.id, replayed: false };
    });
  } catch (error) {
    await deleteObject(stored.objectKey);
    throw error;
  }
  if (attached.replayed) await deleteObject(stored.objectKey);
  else await deleteTemporaryObject(upload.temporaryObjectKey);
  return { ...await getAssetFamilyDetail(ownerUserId, asset.id), attached };
}

export async function updateAsset(ownerUserId: string, assetId: string, input: { name?: string; description?: string }) {
  const asset = await prisma.asset.findFirst({ where: { id: assetId, ownerUserId, archivedAt: null } });
  if (!asset) throw new AppError("not_found", "资产不存在。", 404);
  return prisma.asset.update({
    where: { id: asset.id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
    },
  });
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

export async function createAssetVariant(
  ownerUserId: string,
  assetId: string,
  input: { label: string; name?: string; description?: string },
) {
  const requested = await prisma.asset.findFirst({
    where: { id: assetId, ownerUserId, archivedAt: null, libraryStatus: AssetLibraryStatus.LIBRARY },
    select: { id: true, variantOfAssetId: true },
  });
  if (!requested) throw new AppError("not_found", "资产不存在。", 404);
  const rootId = requested.variantOfAssetId ?? requested.id;
  const root = await prisma.asset.findFirst({
    where: {
      id: rootId,
      ownerUserId,
      archivedAt: null,
      variantOfAssetId: null,
      libraryStatus: AssetLibraryStatus.LIBRARY,
      comic: { archivedAt: null },
    },
    select: { id: true, comicId: true, kind: true, name: true, description: true },
  });
  if (!root) throw new AppError("not_found", "资产不存在。", 404);
  const lastVariant = await prisma.asset.findFirst({
    where: { variantOfAssetId: root.id, ownerUserId },
    orderBy: [{ variantSortIndex: "desc" }, { createdAt: "desc" }],
    select: { variantSortIndex: true },
  });
  const created = await prisma.asset.create({
    data: {
      ownerUserId,
      comicId: root.comicId,
      kind: root.kind,
      libraryStatus: AssetLibraryStatus.LIBRARY,
      currentVersionNumber: 0,
      name: input.name?.trim() || `${root.name} · ${input.label}`,
      description: input.description ?? root.description,
      variantOfAssetId: root.id,
      variantLabel: input.label,
      variantSortIndex: (lastVariant?.variantSortIndex ?? 0) + 10,
    },
  });
  return { ...await getAssetFamilyDetail(ownerUserId, root.id), createdVariantId: created.id };
}

export async function archiveAssetVariant(ownerUserId: string, assetId: string) {
  const variant = await prisma.asset.findFirst({
    where: { id: assetId, ownerUserId, archivedAt: null, libraryStatus: AssetLibraryStatus.LIBRARY },
    select: { id: true, variantOfAssetId: true },
  });
  if (!variant) throw new AppError("not_found", "派生形态不存在。", 404);
  if (!variant.variantOfAssetId) throw new AppError("validation", "主资产不能作为派生形态归档；请使用资产归档能力。", 400);
  const archivedAt = new Date();
  await prisma.$transaction([
    prisma.asset.update({ where: { id: variant.id }, data: { archivedAt } }),
    prisma.canvasAssetListItem.updateMany({ where: { assetId: variant.id, ownerUserId }, data: { hiddenAt: archivedAt } }),
  ]);
  return { ...await getAssetFamilyDetail(ownerUserId, variant.variantOfAssetId), archivedVariantId: variant.id };
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

export async function restoreAssetToCanvasList(ownerUserId: string, projectId: string, assetId: string) {
  return prisma.$transaction(async (tx) => {
    const project = await tx.project.findFirst({
      where: { id: projectId, ownerUserId, chapter: { archivedAt: null, comic: { archivedAt: null } } },
      select: { id: true, chapter: { select: { comicId: true } } },
    });
    if (!project) throw new AppError("not_found", "创作空间不存在。", 404);

    const asset = await tx.asset.findFirst({
      where: { id: assetId, ownerUserId, comicId: project.chapter.comicId },
      select: { id: true, name: true, kind: true, libraryStatus: true, archivedAt: true, variantOfAssetId: true },
    });
    if (!asset || (asset.archivedAt && asset.libraryStatus !== AssetLibraryStatus.LIBRARY)) throw new AppError("not_found", "资产不存在。", 404);

    if (asset.archivedAt) {
      const rootId = asset.variantOfAssetId ?? asset.id;
      await tx.asset.updateMany({
        where: {
          ownerUserId,
          libraryStatus: AssetLibraryStatus.LIBRARY,
          OR: [{ id: rootId, variantOfAssetId: null }, { variantOfAssetId: rootId }],
        },
        data: { archivedAt: null },
      });
    }

    return tx.canvasAssetListItem.upsert({
      where: { projectId_assetId: { projectId: project.id, assetId: asset.id } },
      create: { ownerUserId, projectId: project.id, assetId: asset.id, displayName: asset.name },
      update: { hiddenAt: null },
    });
  });
}

function detailEntry(asset: AssetWithGallery, fallbackLabel: string) {
  return {
    id: asset.id,
    label: asset.variantLabel?.trim() || fallbackLabel,
    name: asset.name,
    description: asset.description,
    currentVersionNumber: asset.currentVersionNumber,
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
      kind: { notIn: [AssetKind.GENERATED_IMAGE, AssetKind.STYLE, AssetKind.COMIC_COVER] },
      libraryStatus: AssetLibraryStatus.LIBRARY,
      comicId: comic.id,
    },
    include: {
      images: { include: galleryImageInclude, orderBy: galleryOrder },
      _count: {
        select: {
          variants: {
            where: { ownerUserId, archivedAt: null, libraryStatus: AssetLibraryStatus.LIBRARY, comicId: comic.id },
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

export async function createComicLibraryAsset(
  ownerUserId: string,
  comicId: string,
  input: { kind: "character" | "scene" | "prop" | "reference_image"; name: string; description: string },
) {
  const comic = await prisma.comic.findFirst({
    where: { id: comicId, ownerUserId, archivedAt: null },
    select: { id: true },
  });
  if (!comic) throw new AppError("not_found", "漫画不存在。", 404);
  const kind = ({
    character: AssetKind.CHARACTER,
    scene: AssetKind.SCENE,
    prop: AssetKind.PROP,
    reference_image: AssetKind.REFERENCE_IMAGE,
  } as const)[input.kind];
  const created = await prisma.asset.create({
    data: {
      ownerUserId,
      comicId: comic.id,
      kind,
      libraryStatus: AssetLibraryStatus.LIBRARY,
      currentVersionNumber: 0,
      name: input.name,
      description: input.description,
    },
  });
  return getAssetFamilyDetail(ownerUserId, created.id);
}

export async function getAssetFamilyDetail(ownerUserId: string, assetId: string) {
  const requested = await prisma.asset.findFirst({
    where: { id: assetId, ownerUserId, archivedAt: null, libraryStatus: AssetLibraryStatus.LIBRARY },
    select: { id: true, comicId: true, variantOfAssetId: true, comic: { select: { archivedAt: true } } },
  });
  if (!requested || requested.comic.archivedAt) throw new AppError("not_found", "资产不存在。", 404);

  const rootId = requested.variantOfAssetId ?? requested.id;
  const root = await prisma.asset.findFirst({
    where: {
      id: rootId,
      ownerUserId,
      archivedAt: null,
      variantOfAssetId: null,
      kind: { not: AssetKind.GENERATED_IMAGE },
      libraryStatus: AssetLibraryStatus.LIBRARY,
      comicId: requested.comicId,
    },
    include: {
      images: { include: galleryImageInclude, orderBy: galleryOrder },
      variants: {
        where: {
          ownerUserId,
          archivedAt: null,
          libraryStatus: AssetLibraryStatus.LIBRARY,
          comicId: requested.comicId,
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

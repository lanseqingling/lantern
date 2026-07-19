import type { FastifyRequest } from "fastify";
import { AssetKind, AssetLibraryStatus } from "@prisma/client";
import { prisma } from "./db";
import { AppError } from "./errors";
import { assertSupportedUpload, putImage } from "./object-storage";

function errorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

function uploadLimitError(error: unknown) {
  const code = errorCode(error);
  if (code === "FST_REQ_FILE_TOO_LARGE") return new AppError("payload_too_large", "图片文件太大，请上传 50MB 以内的 PNG、JPEG 或 WebP。", 413);
  if (code === "FST_FILES_LIMIT") return new AppError("upload_limit", "一次只能上传一张图片。", 413);
  if (code === "FST_FIELDS_LIMIT" || code === "FST_PARTS_LIMIT") return new AppError("upload_limit", "上传表单字段过多，请只上传图片文件。", 413);
  return undefined;
}

export async function readUploadedImage(request: FastifyRequest, namespace: string) {
  const file = await request.file();
  if (!file) throw new AppError("validation", "请选择 PNG、JPEG 或 WebP 图片。", 400);
  let bytes: Buffer;
  try {
    bytes = await file.toBuffer();
  } catch (error) {
    const limit = uploadLimitError(error);
    if (limit) throw limit;
    throw new AppError("upload_failed", "图片上传中断，请重新选择 PNG、JPEG 或 WebP 图片。", 400, { code: errorCode(error) });
  }
  let contentType: Awaited<ReturnType<typeof assertSupportedUpload>>;
  try {
    contentType = await assertSupportedUpload(file.mimetype, bytes);
  } catch (error) {
    throw new AppError("invalid_image", "请选择 PNG、JPEG/JPG 或 WebP 图片。", 400, {
      filename: file.filename,
      mimetype: file.mimetype,
      bytePrefix: bytes.subarray(0, 12).toString("hex"),
      reason: error instanceof Error ? error.message : "unknown",
    });
  }
  let stored: Awaited<ReturnType<typeof putImage>>;
  try {
    stored = await putImage(bytes, namespace);
  } catch (error) {
    if (error instanceof Error && error.message === "IMAGE_SIZE_LIMIT") throw new AppError("payload_too_large", "图片文件太大，请上传 50MB 以内的 PNG、JPEG 或 WebP。", 413);
    throw error;
  }
  return { stored, contentType, fields: file.fields as Record<string, { value?: string }>, filename: file.filename };
}

export type UploadedImage = Awaited<ReturnType<typeof readUploadedImage>>;

export async function createUploadedAsset(input: {
  ownerUserId: string;
  projectId: string;
  placeOnCanvas: boolean;
  conversationAttachment?: boolean;
  uploaded: Awaited<ReturnType<typeof readUploadedImage>>;
}) {
  const { ownerUserId, projectId, placeOnCanvas, conversationAttachment, uploaded } = input;
  const kindText = uploaded.fields.kind?.value ?? "reference_image";
  const kind = ({ character: AssetKind.CHARACTER, scene: AssetKind.SCENE, style: AssetKind.STYLE, sketch: AssetKind.SKETCH, reference_image: AssetKind.REFERENCE_IMAGE } as Record<string, AssetKind>)[kindText] ?? AssetKind.REFERENCE_IMAGE;
  return prisma.$transaction(async (tx) => {
    const created = await tx.asset.create({
      data: {
        ownerUserId,
        projectId,
        kind,
        libraryStatus: placeOnCanvas || conversationAttachment ? AssetLibraryStatus.CANVAS_ONLY : AssetLibraryStatus.LIBRARY,
        name: uploaded.fields.name?.value?.trim() || uploaded.filename.replace(/\.[^.]+$/, "") || "上传图片",
        description: uploaded.fields.description?.value?.trim() || (conversationAttachment ? "对话图片附件" : "用户上传图片"),
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
          x: Number(uploaded.fields.x?.value ?? 320),
          y: Number(uploaded.fields.y?.value ?? 220),
        },
      });
    }
    return created;
  });
}

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { AssetLibraryStatus, ExternalUploadStatus } from "@prisma/client";
import { getConfig } from "./config";
import { prisma } from "./db";
import { AppError } from "./errors";
import { assertSupportedUpload, deleteTemporaryObject, putTemporaryImage } from "./object-storage";

const uploadLifetimeMs = 15 * 60 * 1000;
export const externalUploadMaxBytes = 50 * 1024 * 1024;
export const externalUploadContentTypes = ["image/png", "image/jpeg", "image/webp"] as const;

function uploadSignature(uploadId: string, ownerUserId: string, expires: number) {
  return createHmac("sha256", getConfig().LANTERN_MCP_TOKEN)
    .update(`lantern-external-upload:${uploadId}:${ownerUserId}:${expires}`)
    .digest("base64url");
}

function uploadAuthorization(uploadId: string, ownerUserId: string, expires: number) {
  return `Bearer ${expires}.${uploadSignature(uploadId, ownerUserId, expires)}`;
}

function uploadUrl(uploadId: string) {
  return `http://127.0.0.1:${getConfig().API_PORT}/v1/mcp/uploads/${encodeURIComponent(uploadId)}`;
}

function publicUpload(upload: {
  id: string;
  ownerUserId: string;
  status: ExternalUploadStatus;
  expiresAt: Date;
  contentType: string | null;
  byteSize: number | null;
  width: number | null;
  height: number | null;
  checksum: string | null;
}) {
  const expires = Math.floor(upload.expiresAt.getTime() / 1000);
  return {
    uploadId: upload.id,
    status: upload.status.toLowerCase(),
    uploadUrl: uploadUrl(upload.id),
    method: "PUT" as const,
    headers: { Authorization: uploadAuthorization(upload.id, upload.ownerUserId, expires) },
    expiresAt: upload.expiresAt.toISOString(),
    maxBytes: externalUploadMaxBytes,
    acceptedContentTypes: externalUploadContentTypes,
    ...(upload.contentType ? {
      uploaded: {
        contentType: upload.contentType,
        byteSize: upload.byteSize,
        width: upload.width,
        height: upload.height,
        checksum: upload.checksum,
      },
    } : {}),
  };
}

export async function prepareExternalAssetUpload(
  ownerUserId: string,
  assetId: string,
  input: { filename: string; label?: string },
  options: { now?: Date; lifetimeMs?: number } = {},
) {
  const asset = await prisma.asset.findFirst({
    where: {
      id: assetId,
      ownerUserId,
      archivedAt: null,
      libraryStatus: AssetLibraryStatus.LIBRARY,
      comic: { archivedAt: null },
    },
    select: { id: true },
  });
  if (!asset) throw new AppError("not_found", "资产不存在。", 404);
  const now = options.now ?? new Date();
  const upload = await prisma.externalAssetUpload.create({
    data: {
      ownerUserId,
      assetId: asset.id,
      filename: input.filename,
      label: input.label?.trim() || input.filename.replace(/\.[^.]+$/, "").trim() || "图片",
      expiresAt: new Date(now.getTime() + (options.lifetimeMs ?? uploadLifetimeMs)),
    },
  });
  return publicUpload(upload);
}

function suppliedToken(authorization: string | undefined) {
  return authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
}

function verifyUploadAuthorization(upload: { id: string; ownerUserId: string; expiresAt: Date }, authorization: string | undefined) {
  const token = suppliedToken(authorization);
  const separator = token.indexOf(".");
  if (separator < 1) return false;
  const expires = Number(token.slice(0, separator));
  const signature = token.slice(separator + 1);
  if (!Number.isSafeInteger(expires) || expires !== Math.floor(upload.expiresAt.getTime() / 1000) || expires < Math.floor(Date.now() / 1000)) return false;
  const expected = uploadSignature(upload.id, upload.ownerUserId, expires);
  return expected.length === signature.length && timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export async function receiveExternalAssetUpload(
  uploadId: string,
  authorization: string | undefined,
  declaredContentType: string | undefined,
  bytes: Buffer,
) {
  const upload = await prisma.externalAssetUpload.findUnique({ where: { id: uploadId } });
  if (!upload || !verifyUploadAuthorization(upload, authorization)) {
    throw new AppError("unauthorized", "无法验证 Lantern 图片上传位置。", 401);
  }
  if (upload.status === ExternalUploadStatus.CONSUMED) throw new AppError("upload_consumed", "该图片上传已经登记为固定资源版本。", 409);
  if (upload.status === ExternalUploadStatus.EXPIRED || upload.expiresAt.getTime() <= Date.now()) {
    await prisma.externalAssetUpload.updateMany({
      where: { id: upload.id, status: ExternalUploadStatus.PENDING },
      data: { status: ExternalUploadStatus.EXPIRED },
    });
    throw new AppError("upload_expired", "图片上传位置已过期，请重新创建。", 410);
  }
  if (!bytes.length || bytes.length > externalUploadMaxBytes) {
    throw new AppError("payload_too_large", "图片文件必须小于 50MB。", 413);
  }
  const contentType = await assertSupportedUpload(declaredContentType ?? "application/octet-stream", bytes)
    .catch(() => { throw new AppError("invalid_image", "只支持 PNG、JPEG 或 WebP 图片。", 400); });
  const checksum = createHash("sha256").update(bytes).digest("hex");
  if (upload.status === ExternalUploadStatus.UPLOADED) {
    if (upload.checksum !== checksum) throw new AppError("upload_conflict", "该上传位置已经接收了另一张图片。", 409);
    return publicUpload(upload);
  }

  const stored = await putTemporaryImage(bytes, upload.id);
  try {
    const updated = await prisma.externalAssetUpload.updateMany({
      where: { id: upload.id, status: ExternalUploadStatus.PENDING, expiresAt: { gt: new Date() } },
      data: {
        status: ExternalUploadStatus.UPLOADED,
        temporaryObjectKey: stored.objectKey,
        contentType,
        byteSize: stored.byteSize,
        width: stored.width,
        height: stored.height,
        checksum: stored.checksum,
        uploadedAt: new Date(),
      },
    });
    if (updated.count !== 1) throw new AppError("upload_conflict", "该上传位置已经被使用或已过期。", 409);
  } catch (error) {
    await deleteTemporaryObject(stored.objectKey);
    throw error;
  }
  return publicUpload((await prisma.externalAssetUpload.findUnique({ where: { id: upload.id } }))!);
}

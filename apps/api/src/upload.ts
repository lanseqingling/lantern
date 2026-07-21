import type { FastifyRequest } from "fastify";
import type { UploadedImage } from "@lantern/server/asset-service";
import { AppError } from "@lantern/server/errors";
import { assertSupportedUpload, putImage } from "@lantern/server/object-storage";

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

export type ParsedImageUpload = UploadedImage & { fields: Record<string, { value?: string }> };

export function uploadedImage(upload: ParsedImageUpload): UploadedImage {
  return { stored: upload.stored, contentType: upload.contentType, filename: upload.filename };
}

export async function readUploadedImage(request: FastifyRequest, namespace: string): Promise<ParsedImageUpload> {
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

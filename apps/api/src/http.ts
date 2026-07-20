import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { getConfig } from "../../../packages/server/src/config";
import { prisma } from "../../../packages/server/src/db";
import { AppError } from "../../../packages/server/src/errors";
import { createSignedExportPath } from "../../../packages/server/src/signed-assets";

const config = getConfig();

export function requestId(request: FastifyRequest) {
  return request.id || randomUUID();
}

export async function currentUser(request: FastifyRequest) {
  const trustedEmail = request.headers["oai-authenticated-user-email"];
  const localEmail = config.APP_ENV === "local" ? request.headers["x-lantern-user-email"] ?? config.LANTERN_DEV_USER_EMAIL : undefined;
  const email = String(trustedEmail ?? localEmail ?? "");
  if (!email) throw new AppError("unauthorized", "请先登录。", 401);
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new AppError("unauthorized", "当前账号尚未初始化 Lantern 工作空间。", 401);
  return user;
}

export function ok<T>(request: FastifyRequest, data: T) {
  return { data, requestId: requestId(request) };
}

function errorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

function multipartLimitError(error: unknown, request: FastifyRequest) {
  const code = errorCode(error);
  if (code === "FST_REQ_FILE_TOO_LARGE") return request.url.includes("/archive/import")
    ? new AppError("payload_too_large", "完整 LCD 归档必须小于 512MB。", 413)
    : new AppError("payload_too_large", "图片文件太大，请上传 50MB 以内的 PNG、JPEG 或 WebP。", 413);
  if (code === "FST_FILES_LIMIT") return new AppError("upload_limit", "一次只能上传一张图片。", 413);
  if (code === "FST_FIELDS_LIMIT" || code === "FST_PARTS_LIMIT") return new AppError("upload_limit", "上传表单字段过多，请只上传图片文件。", 413);
  return undefined;
}

export function publicTask<T extends {
  id: string;
  type: string;
  status: string;
  baseRevision: number;
  scope: string;
  progress: number;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}>(task: T) {
  const output = (task as T & { output?: Prisma.JsonValue | null }).output as { kind?: string; artifacts?: Array<{ objectKey: string; contentType: string; fileName: string; byteSize: number }> } | null | undefined;
  return {
    id: task.id,
    type: task.type.toLowerCase(),
    status: task.status.toLowerCase(),
    baseRevision: task.baseRevision,
    scope: task.scope,
    progress: task.progress,
    errorCode: task.errorCode,
    errorMessage: task.errorMessage,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    output: output?.artifacts ? {
      kind: output.kind,
      artifacts: output.artifacts.map((artifact, index) => ({
        fileName: artifact.fileName,
        contentType: artifact.contentType,
        byteSize: artifact.byteSize,
        downloadUrl: createSignedExportPath(task.id, index),
      })),
    } : undefined,
  };
}

export function installErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error, request, reply) => {
    const known = error instanceof AppError ? error : undefined;
    const validation = error instanceof z.ZodError ? error : undefined;
    const multipart = multipartLimitError(error, request);
    const reportedStatus = typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : undefined;
    const statusCode = validation ? 400 : known?.statusCode ?? multipart?.statusCode ?? (reportedStatus && reportedStatus >= 400 ? reportedStatus : 500);
    const code = validation ? "validation" : known?.code ?? multipart?.code ?? (statusCode === 400 ? "validation" : "internal");
    const reportedMessage = error instanceof Error ? error.message : "";
    const message = validation
      ? "请求字段不符合契约。"
      : known?.message ?? multipart?.message ?? (statusCode === 413 ? "上传请求超过当前服务限制，请确认文件格式和大小后重试。" : statusCode === 400 ? reportedMessage || "请求字段不符合契约。" : "服务暂时不可用。");
    if (statusCode >= 500) request.log.error({ err: error, requestId: requestId(request) }, "request failed");
    void reply.status(statusCode).send({
      error: { code, message, details: validation ? validation.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) : known?.details },
      requestId: requestId(request),
    });
  });
}

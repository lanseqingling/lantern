import type { FastifyInstance } from "fastify";
import { prisma } from "../../../../packages/server/src/db";
import { AppError } from "../../../../packages/server/src/errors";
import { renderPagePng } from "../../../../packages/server/src/export-renderer";
import { getObject } from "../../../../packages/server/src/object-storage";
import { verifySignedAssetPath, verifySignedExportPath } from "../../../../packages/server/src/signed-assets";
import { getWorkbench } from "../../../../packages/server/src/workbench-service";
import { currentUser } from "../http";

export function registerExportRoutes(app: FastifyInstance) {
  app.get<{ Params: { versionId: string }; Querystring: { expires: string; signature: string } }>("/v1/objects/:versionId", async (request, reply) => {
    const expires = Number(request.query.expires);
    if (!verifySignedAssetPath(request.params.versionId, expires, request.query.signature ?? "")) throw new AppError("forbidden", "资源链接已失效。", 403);
    const version = await prisma.assetVersion.findUnique({ where: { id: request.params.versionId } });
    if (!version?.objectKey || !version.contentType) throw new AppError("not_found", "资源不存在。", 404);
    const bytes = await getObject(version.objectKey);
    return reply.header("Content-Type", version.contentType).header("Cache-Control", "private, max-age=300").send(bytes);
  });

  app.get<{ Params: { chapterId: string; unitId: string } }>("/v1/chapters/:chapterId/pages/:unitId/download", async (request, reply) => {
    const user = await currentUser(request);
    const workbench = await getWorkbench(user.id, request.params.chapterId);
    const document = workbench.snapshot?.document;
    if (!document) throw new AppError("not_found", "当前一话还没有已保存版本。", 404);
    const unit = document.units.find((item) => item.id === request.params.unitId);
    if (!unit) throw new AppError("not_found", "当前版本中不存在该漫画页。", 404);
    const bytes = await renderPagePng(document, unit);
    return reply
      .header("Content-Type", "image/png")
      .header("Content-Disposition", `attachment; filename="${request.params.chapterId}-page-${unit.surfaces[0]?.pageNumber ?? 1}.png"`)
      .header("Cache-Control", "no-store")
      .send(bytes);
  });

  app.get<{ Params: { taskId: string; index: string }; Querystring: { expires: string; signature: string } }>("/v1/exports/:taskId/:index", async (request, reply) => {
    const index = Number(request.params.index);
    const expires = Number(request.query.expires);
    if (!Number.isInteger(index) || !verifySignedExportPath(request.params.taskId, index, expires, request.query.signature ?? "")) throw new AppError("forbidden", "导出链接已失效。", 403);
    const task = await prisma.generationTask.findUnique({ where: { id: request.params.taskId } });
    const output = task?.output as { artifacts?: Array<{ objectKey: string; contentType: string; fileName: string }> } | null;
    const artifact = output?.artifacts?.[index];
    if (!artifact) throw new AppError("not_found", "导出文件不存在。", 404);
    const bytes = await getObject(artifact.objectKey);
    return reply
      .header("Content-Type", artifact.contentType)
      .header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(artifact.fileName)}`)
      .header("Cache-Control", "private, max-age=300")
      .send(bytes);
  });
}

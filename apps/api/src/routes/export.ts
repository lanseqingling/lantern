import type { FastifyInstance } from "fastify";
import { prisma } from "../../../../packages/server/src/db";
import { AppError } from "../../../../packages/server/src/errors";
import { renderPagePng, renderPreviewPageGroupPng } from "../../../../packages/server/src/export-renderer";
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
    const pageNumbers = unit.surfaces
      .map((surface) => surface.pageNumber)
      .filter((pageNumber): pageNumber is number => typeof pageNumber === "number")
      .sort((a, b) => a - b);
    const pageLabel = unit.kind === "spread" && pageNumbers.length > 1
      ? `${pageNumbers[0]}-${pageNumbers.at(-1)}`
      : `${pageNumbers[0] ?? 1}`;
    return reply
      .header("Content-Type", "image/png")
      .header("Content-Disposition", `attachment; filename="${request.params.chapterId}-page-${pageLabel}.png"`)
      .header("Cache-Control", "no-store")
      .send(bytes);
  });

  app.get<{ Params: { chapterId: string; unitId: string; surfaceId: string } }>("/v1/chapters/:chapterId/pages/:unitId/surfaces/:surfaceId/download", async (request, reply) => {
    const user = await currentUser(request);
    const workbench = await getWorkbench(user.id, request.params.chapterId);
    const document = workbench.snapshot?.document;
    if (!document) throw new AppError("not_found", "当前一话还没有已保存版本。", 404);
    const unit = document.units.find((item) => item.id === request.params.unitId);
    if (!unit) throw new AppError("not_found", "当前版本中不存在该展示单元。", 404);
    const surface = unit.surfaces.find((item) => item.id === request.params.surfaceId);
    if (!surface) throw new AppError("not_found", "当前展示单元中不存在该物理纸面。", 404);
    const bytes = await renderPagePng(document, unit, surface);
    return reply
      .header("Content-Type", "image/png")
      .header("Content-Disposition", `attachment; filename="${request.params.chapterId}-page-${surface.pageNumber ?? 1}.png"`)
      .header("Cache-Control", "no-store")
      .send(bytes);
  });

  app.get<{ Params: { chapterId: string; firstUnitId: string; secondUnitId: string } }>("/v1/chapters/:chapterId/preview-spreads/:firstUnitId/:secondUnitId/download", async (request, reply) => {
    const user = await currentUser(request);
    const workbench = await getWorkbench(user.id, request.params.chapterId);
    const document = workbench.snapshot?.document;
    if (!document) throw new AppError("not_found", "当前一话还没有已保存版本。", 404);
    const firstIndex = document.reading.unitOrder.indexOf(request.params.firstUnitId);
    const secondIndex = document.reading.unitOrder.indexOf(request.params.secondUnitId);
    const units = [request.params.firstUnitId, request.params.secondUnitId].map((unitId) => document.units.find((unit) => unit.id === unitId));
    if (firstIndex < 0 || secondIndex !== firstIndex + 1 || units.some((unit) => !unit || unit.kind !== "single_page")) {
      throw new AppError("validation", "当前两页不能作为同一个双页预览下载。", 400);
    }
    const pages = units.flatMap((unit) => unit?.surfaces ?? []);
    const pageNumbers = pages.map((surface) => surface.pageNumber).filter((pageNumber): pageNumber is number => typeof pageNumber === "number").sort((a, b) => a - b);
    const bytes = await renderPreviewPageGroupPng(document, units.filter((unit): unit is NonNullable<typeof unit> => Boolean(unit)));
    return reply
      .header("Content-Type", "image/png")
      .header("Content-Disposition", `attachment; filename="${request.params.chapterId}-pages-${pageNumbers[0] ?? firstIndex + 1}-${pageNumbers.at(-1) ?? secondIndex + 1}.png"`)
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

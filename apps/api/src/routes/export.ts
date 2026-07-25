import type { FastifyInstance, FastifyReply } from "fastify";
import { AppError } from "@lantern/server/errors";
import {
  getChapterPageDownload,
  getChapterImagesDownload,
  getPreviewSpreadDownload,
  getSignedAssetDownload,
  getSignedExportDownload,
} from "@lantern/server/download-service";
import { exportChapterArchive, importChapterArchive } from "@lantern/server/chapter-archive-service";
import { currentUser, ok } from "../http";

function sendDownload(reply: FastifyReply, download: { bytes: Buffer; contentType: string; fileName: string }) {
  return reply
    .header("Content-Type", download.contentType)
    .header("Content-Disposition", `attachment; filename="${download.fileName}"`)
    .header("Cache-Control", "no-store")
    .send(download.bytes);
}

export function registerExportRoutes(app: FastifyInstance) {
  app.get<{ Params: { versionId: string }; Querystring: { expires: string; signature: string } }>("/v1/objects/:versionId", async (request, reply) => {
    const download = await getSignedAssetDownload(request.params.versionId, Number(request.query.expires), request.query.signature ?? "");
    return reply.header("Content-Type", download.contentType).header("Cache-Control", "private, max-age=300").send(download.bytes);
  });

  app.get<{ Params: { chapterId: string; unitId: string } }>("/v1/chapters/:chapterId/pages/:unitId/download", async (request, reply) => {
    const user = await currentUser(request);
    return sendDownload(reply, await getChapterPageDownload(user.id, request.params.chapterId, request.params.unitId));
  });

  app.get<{ Params: { chapterId: string; unitId: string; surfaceId: string } }>("/v1/chapters/:chapterId/pages/:unitId/surfaces/:surfaceId/download", async (request, reply) => {
    const user = await currentUser(request);
    return sendDownload(reply, await getChapterPageDownload(user.id, request.params.chapterId, request.params.unitId, request.params.surfaceId));
  });

  app.get<{ Params: { chapterId: string; firstUnitId: string; secondUnitId: string } }>("/v1/chapters/:chapterId/preview-spreads/:firstUnitId/:secondUnitId/download", async (request, reply) => {
    const user = await currentUser(request);
    return sendDownload(reply, await getPreviewSpreadDownload(user.id, request.params.chapterId, request.params.firstUnitId, request.params.secondUnitId));
  });

  app.get<{ Params: { chapterId: string } }>("/v1/chapters/:chapterId/images/download", async (request, reply) => {
    const user = await currentUser(request);
    return sendDownload(reply, await getChapterImagesDownload(user.id, request.params.chapterId));
  });

  app.get<{ Params: { chapterId: string } }>("/v1/chapters/:chapterId/archive/download", async (request, reply) => {
    const user = await currentUser(request);
    const bytes = await exportChapterArchive(user.id, request.params.chapterId);
    return reply
      .header("Content-Type", "application/zip")
      .header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(`${request.params.chapterId}-saved.lantern.zip`)}`)
      .header("Cache-Control", "no-store")
      .send(bytes);
  });

  app.post<{ Params: { chapterId: string }; Querystring: { expectedWorkingRevision?: string } }>("/v1/chapters/:chapterId/archive/import", async (request) => {
    const user = await currentUser(request);
    const expectedRevision = Number(request.query.expectedWorkingRevision);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw new AppError("validation", "缺少有效的工作稿版本。", 400);
    const upload = await request.file({ limits: { files: 1, fileSize: 512 * 1024 * 1024, fields: 0 } });
    if (!upload) throw new AppError("validation", "请选择完整 LCD ZIP 归档。", 400);
    const bytes = await upload.toBuffer();
    return ok(request, await importChapterArchive({ ownerUserId: user.id, chapterId: request.params.chapterId, expectedRevision, bytes }));
  });

  app.get<{ Params: { taskId: string; index: string }; Querystring: { expires: string; signature: string } }>("/v1/exports/:taskId/:index", async (request, reply) => {
    const download = await getSignedExportDownload(request.params.taskId, Number(request.params.index), Number(request.query.expires), request.query.signature ?? "");
    return reply
      .header("Content-Type", download.contentType)
      .header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(download.fileName)}`)
      .header("Cache-Control", "private, max-age=300")
      .send(download.bytes);
  });
}

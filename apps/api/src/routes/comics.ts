import type { FastifyInstance } from "fastify";
import { ComicFormat, TaskStatus, type Prisma } from "@prisma/client";
import { z } from "zod";
import { readUploadedImage } from "../../../../packages/server/src/asset-service";
import { createChapterWorkspace, duplicateComic } from "../../../../packages/server/src/comic-service";
import { prisma } from "../../../../packages/server/src/db";
import { AppError } from "../../../../packages/server/src/errors";
import { getObject } from "../../../../packages/server/src/object-storage";
import { appendComicVisualStyleImage, getComicVisualStyle, listComicAssetCards } from "../../../../packages/server/src/asset-library-service";
import { currentUser, ok } from "../http";

const comicCreateSchema = z.object({
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(2000),
  worldSummary: z.string().trim().max(4000).optional(),
  styleSummary: z.string().trim().max(4000).optional(),
  format: z.enum(["page", "vertical", "four_panel"]).default("page"),
  canvasPageMode: z.enum(["single", "spread"]).default("single"),
});
const comicUpdateSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  summary: z.string().trim().min(1).max(2000).optional(),
  worldSummary: z.string().trim().max(4000).optional(),
  styleSummary: z.string().trim().max(4000).optional(),
  canvasPageMode: z.enum(["single", "spread"]).optional(),
}).refine((value) => value.title !== undefined || value.summary !== undefined || value.worldSummary !== undefined || value.styleSummary !== undefined || value.canvasPageMode !== undefined);
const chapterCreateSchema = z.object({ title: z.string().trim().min(1).max(120), summary: z.string().trim().min(1).max(2000) });
const chapterUpdateSchema = z.object({ title: z.string().trim().min(1).max(120).optional(), summary: z.string().trim().min(1).max(2000).optional() })
  .refine((value) => value.title !== undefined || value.summary !== undefined);

type ComicListCursor = { updatedAt: string; id: string };
type ComicWithChapters = Prisma.ComicGetPayload<{ include: { chapters: true } }>;

function comicCoverPath(comic: { id: string; coverObjectKey: string | null; updatedAt: Date }) {
  return comic.coverObjectKey ? `/v1/comics/${encodeURIComponent(comic.id)}/cover?v=${comic.updatedAt.getTime()}` : undefined;
}

function chapterCoverPath(chapter: { id: string; coverObjectKey: string | null; updatedAt: Date }) {
  return chapter.coverObjectKey ? `/v1/chapters/${encodeURIComponent(chapter.id)}/cover?v=${chapter.updatedAt.getTime()}` : undefined;
}

function encodeComicCursor(comic: { updatedAt: Date; id: string }) {
  return Buffer.from(JSON.stringify({ updatedAt: comic.updatedAt.toISOString(), id: comic.id } satisfies ComicListCursor)).toString("base64url");
}

function decodeComicCursor(value?: string) {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as ComicListCursor;
    if (!parsed.id || Number.isNaN(Date.parse(parsed.updatedAt))) throw new Error("invalid cursor");
    return parsed;
  } catch {
    throw new AppError("validation", "漫画列表游标无效。", 400);
  }
}

function publicComic(comic: ComicWithChapters) {
  return {
    id: comic.id,
    title: comic.title,
    summary: comic.summary,
    worldSummary: comic.worldSummary,
    styleSummary: comic.styleSummary,
    format: comic.format.toLowerCase(),
    canvasPageMode: comic.canvasPageMode.toLowerCase(),
    coverUrl: comicCoverPath(comic),
    chapters: comic.chapters.map((chapter) => ({ id: chapter.id, number: chapter.number, title: chapter.title, summary: chapter.summary, coverUrl: chapterCoverPath(chapter), updatedAt: chapter.updatedAt.toISOString() })),
    updatedAt: comic.updatedAt.toISOString(),
  };
}

const activeDeletionTaskStatuses = [TaskStatus.CREATED, TaskStatus.QUEUED, TaskStatus.RUNNING];

export function registerComicRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { cursor?: string; limit?: string } }>("/v1/comics", async (request) => {
    const user = await currentUser(request);
    const cursor = decodeComicCursor(request.query.cursor);
    const limit = Math.min(50, Math.max(1, Number.parseInt(request.query.limit ?? "20", 10) || 20));
    const comics = await prisma.comic.findMany({
      where: {
        ownerUserId: user.id,
        archivedAt: null,
        ...(cursor ? { OR: [{ updatedAt: { lt: new Date(cursor.updatedAt) } }, { updatedAt: new Date(cursor.updatedAt), id: { lt: cursor.id } }] } : {}),
      },
      include: { chapters: { where: { archivedAt: null }, orderBy: { number: "asc" }, include: { project: { include: { workingRevisions: { orderBy: { revision: "desc" }, take: 1 } } } } } },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });
    const hasMore = comics.length > limit;
    const page = comics.slice(0, limit);
    return ok(request, { items: page.map(publicComic), nextCursor: hasMore ? encodeComicCursor(page.at(-1)!) : null });
  });

  app.get<{ Params: { comicId: string } }>("/v1/comics/:comicId", async (request) => {
    const user = await currentUser(request);
    const comic = await prisma.comic.findFirst({ where: { id: request.params.comicId, ownerUserId: user.id, archivedAt: null }, include: { chapters: { where: { archivedAt: null }, orderBy: { number: "asc" } } } });
    if (!comic) throw new AppError("not_found", "漫画不存在。", 404);
    return ok(request, publicComic(comic));
  });

  app.post<{ Params: { comicId: string } }>("/v1/comics/:comicId/duplicate", async (request) => {
    const user = await currentUser(request);
    return ok(request, await duplicateComic(user.id, request.params.comicId));
  });

  app.get<{ Params: { comicId: string } }>("/v1/comics/:comicId/assets", async (request) => {
    const user = await currentUser(request);
    return ok(request, await listComicAssetCards(user.id, request.params.comicId));
  });

  app.get<{ Params: { comicId: string } }>("/v1/comics/:comicId/visual-style", async (request) => {
    const user = await currentUser(request);
    return ok(request, await getComicVisualStyle(user.id, request.params.comicId));
  });

  app.post<{ Params: { comicId: string } }>("/v1/comics/:comicId/visual-style/images", async (request) => {
    const user = await currentUser(request);
    await getComicVisualStyle(user.id, request.params.comicId);
    const uploaded = await readUploadedImage(request, `visual-style/${request.params.comicId}`);
    return ok(request, await appendComicVisualStyleImage(user.id, request.params.comicId, uploaded));
  });

  app.post("/v1/comics", async (request) => {
    const user = await currentUser(request);
    const body = comicCreateSchema.parse(request.body ?? {});
    const format = ({ page: ComicFormat.PAGE, vertical: ComicFormat.VERTICAL, four_panel: ComicFormat.FOUR_PANEL } as const)[body.format];
    const comic = await prisma.comic.create({ data: { ownerUserId: user.id, title: body.title, summary: body.summary, worldSummary: body.worldSummary ?? "", styleSummary: body.styleSummary ?? "", format, canvasPageMode: body.canvasPageMode === "spread" ? "SPREAD" : "SINGLE" } });
    return ok(request, { comic: { id: comic.id, title: comic.title } });
  });

  app.patch<{ Params: { comicId: string }; Body: { title?: string; summary?: string; worldSummary?: string; styleSummary?: string; canvasPageMode?: "single" | "spread" } }>("/v1/comics/:comicId", async (request) => {
    const user = await currentUser(request);
    const body = comicUpdateSchema.parse(request.body ?? {});
    const comic = await prisma.comic.findFirst({ where: { id: request.params.comicId, ownerUserId: user.id, archivedAt: null } });
    if (!comic) throw new AppError("not_found", "漫画不存在。", 404);
    return ok(request, await prisma.comic.update({ where: { id: comic.id }, data: { ...(body.title !== undefined ? { title: body.title } : {}), ...(body.summary !== undefined ? { summary: body.summary } : {}), ...(body.worldSummary !== undefined ? { worldSummary: body.worldSummary } : {}), ...(body.styleSummary !== undefined ? { styleSummary: body.styleSummary } : {}), ...(body.canvasPageMode !== undefined ? { canvasPageMode: body.canvasPageMode === "spread" ? "SPREAD" : "SINGLE" } : {}) } }));
  });

  app.get<{ Params: { comicId: string } }>("/v1/comics/:comicId/cover", async (request, reply) => {
    const user = await currentUser(request);
    const comic = await prisma.comic.findFirst({ where: { id: request.params.comicId, ownerUserId: user.id, archivedAt: null } });
    if (!comic?.coverObjectKey || !comic.coverContentType) throw new AppError("not_found", "漫画封面不存在。", 404);
    return reply.type(comic.coverContentType).send(await getObject(comic.coverObjectKey));
  });

  app.post<{ Params: { comicId: string } }>("/v1/comics/:comicId/cover", async (request) => {
    const user = await currentUser(request);
    const comic = await prisma.comic.findFirst({ where: { id: request.params.comicId, ownerUserId: user.id, archivedAt: null } });
    if (!comic) throw new AppError("not_found", "漫画不存在。", 404);
    const { stored, contentType } = await readUploadedImage(request, `covers/comics/${comic.id}`);
    const updated = await prisma.comic.update({ where: { id: comic.id }, data: { coverObjectKey: stored.objectKey, coverContentType: contentType, coverWidth: stored.width, coverHeight: stored.height } });
    return ok(request, { coverUrl: comicCoverPath(updated) });
  });

  app.post<{ Params: { comicId: string } }>("/v1/comics/:comicId/chapters", async (request) => {
    const user = await currentUser(request);
    const body = chapterCreateSchema.parse(request.body ?? {});
    const comic = await prisma.comic.findFirst({ where: { id: request.params.comicId, ownerUserId: user.id, archivedAt: null } });
    if (!comic) throw new AppError("not_found", "漫画不存在。", 404);
    const last = await prisma.chapter.findFirst({ where: { comicId: comic.id }, orderBy: { number: "desc" } });
    return ok(request, await createChapterWorkspace(user.id, comic, (last?.number ?? 0) + 1, body.title, body.summary));
  });

  app.patch<{ Params: { comicId: string; chapterId: string }; Body: { title?: string; summary?: string } }>("/v1/comics/:comicId/chapters/:chapterId", async (request) => {
    const user = await currentUser(request);
    const body = chapterUpdateSchema.parse(request.body ?? {});
    const chapter = await prisma.chapter.findFirst({ where: { id: request.params.chapterId, comicId: request.params.comicId, ownerUserId: user.id, archivedAt: null, comic: { archivedAt: null } } });
    if (!chapter) throw new AppError("not_found", "章节不存在。", 404);
    return ok(request, await prisma.chapter.update({ where: { id: chapter.id }, data: { ...(body.title !== undefined ? { title: body.title } : {}), ...(body.summary !== undefined ? { summary: body.summary } : {}) } }));
  });

  app.get<{ Params: { chapterId: string } }>("/v1/chapters/:chapterId/cover", async (request, reply) => {
    const user = await currentUser(request);
    const chapter = await prisma.chapter.findFirst({ where: { id: request.params.chapterId, ownerUserId: user.id, archivedAt: null, comic: { archivedAt: null } } });
    if (!chapter?.coverObjectKey || !chapter.coverContentType) throw new AppError("not_found", "章节封面不存在。", 404);
    return reply.type(chapter.coverContentType).send(await getObject(chapter.coverObjectKey));
  });

  app.post<{ Params: { comicId: string; chapterId: string } }>("/v1/comics/:comicId/chapters/:chapterId/cover", async (request) => {
    const user = await currentUser(request);
    const chapter = await prisma.chapter.findFirst({ where: { id: request.params.chapterId, comicId: request.params.comicId, ownerUserId: user.id, archivedAt: null, comic: { archivedAt: null } } });
    if (!chapter) throw new AppError("not_found", "章节不存在。", 404);
    const { stored, contentType } = await readUploadedImage(request, `covers/chapters/${chapter.id}`);
    const updated = await prisma.chapter.update({ where: { id: chapter.id }, data: { coverObjectKey: stored.objectKey, coverContentType: contentType, coverWidth: stored.width, coverHeight: stored.height } });
    return ok(request, { coverUrl: chapterCoverPath(updated) });
  });

  app.delete<{ Params: { comicId: string } }>("/v1/comics/:comicId", async (request) => {
    const user = await currentUser(request);
    const comic = await prisma.comic.findFirst({ where: { id: request.params.comicId, ownerUserId: user.id, archivedAt: null }, include: { chapters: { where: { archivedAt: null }, include: { project: true } } } });
    if (!comic) throw new AppError("not_found", "漫画不存在。", 404);
    const projectIds = comic.chapters.flatMap((chapter) => chapter.project?.id ? [chapter.project.id] : []);
    const activeTask = projectIds.length ? await prisma.generationTask.findFirst({ where: { ownerUserId: user.id, projectId: { in: projectIds }, status: { in: activeDeletionTaskStatuses } }, orderBy: { createdAt: "desc" } }) : null;
    if (activeTask) throw new AppError("task_in_progress", "请先停止这部漫画中的运行任务，再删除漫画。", 409, { taskId: activeTask.id });
    const now = new Date();
    await prisma.$transaction([
      prisma.comic.update({ where: { id: comic.id }, data: { archivedAt: now } }),
      prisma.chapter.updateMany({ where: { comicId: comic.id, ownerUserId: user.id, archivedAt: null }, data: { archivedAt: now } }),
      prisma.agentConversation.updateMany({ where: { ownerUserId: user.id, projectId: { in: projectIds }, archivedAt: null }, data: { archivedAt: now } }),
    ]);
    return ok(request, { id: comic.id, deleted: true });
  });

  app.delete<{ Params: { comicId: string; chapterId: string } }>("/v1/comics/:comicId/chapters/:chapterId", async (request) => {
    const user = await currentUser(request);
    const chapter = await prisma.chapter.findFirst({ where: { id: request.params.chapterId, comicId: request.params.comicId, ownerUserId: user.id, archivedAt: null, comic: { archivedAt: null } }, include: { project: true } });
    if (!chapter) throw new AppError("not_found", "章节不存在。", 404);
    const activeTask = chapter.project ? await prisma.generationTask.findFirst({ where: { ownerUserId: user.id, projectId: chapter.project.id, status: { in: activeDeletionTaskStatuses } }, orderBy: { createdAt: "desc" } }) : null;
    if (activeTask) throw new AppError("task_in_progress", "请先停止这一话中的运行任务，再删除章节。", 409, { taskId: activeTask.id });
    const now = new Date();
    await prisma.$transaction([
      prisma.chapter.update({ where: { id: chapter.id }, data: { archivedAt: now } }),
      prisma.comic.update({ where: { id: request.params.comicId }, data: { updatedAt: now } }),
      ...(chapter.project ? [prisma.agentConversation.updateMany({ where: { ownerUserId: user.id, projectId: chapter.project.id, archivedAt: null }, data: { archivedAt: now } })] : []),
    ]);
    return ok(request, { id: chapter.id, deleted: true });
  });
}

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  archiveComic,
  archiveComicChapter,
  assertComicChapterExists,
  createComic,
  createComicChapter,
  duplicateComic,
  getChapterCover,
  getComic,
  getComicCover,
  listComics,
  updateChapterCover,
  updateComic,
  updateComicChapter,
  updateComicCover,
} from "@lantern/server/comic-service";
import { appendComicVisualStyleImage, createComicLibraryAsset, getComicVisualStyle, listComicAssetCards } from "@lantern/server/asset-library-service";
import { currentUser, ok } from "../http";
import { readUploadedImage, uploadedImage } from "../upload";

const comicCreateSchema = z.object({
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(2000),
  worldSummary: z.string().trim().max(4000).optional(),
  styleSummary: z.string().trim().max(4000).optional(),
  format: z.enum(["page", "vertical", "four_panel"]).default("page"),
  defaultReadingDirection: z.enum(["ltr", "rtl"]).default("ltr"),
});
const creationStatusSchema = z.enum(["in_progress", "completed"]);
const comicUpdateSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  summary: z.string().trim().min(1).max(2000).optional(),
  worldSummary: z.string().trim().max(4000).optional(),
  styleSummary: z.string().trim().max(4000).optional(),
  defaultReadingDirection: z.enum(["ltr", "rtl"]).optional(),
  status: creationStatusSchema.optional(),
}).refine((value) => value.title !== undefined || value.summary !== undefined || value.worldSummary !== undefined || value.styleSummary !== undefined || value.defaultReadingDirection !== undefined || value.status !== undefined);
const chapterCreateSchema = z.object({ title: z.string().trim().min(1).max(120), summary: z.string().trim().min(1).max(2000) });
const chapterUpdateSchema = z.object({ title: z.string().trim().min(1).max(120).optional(), summary: z.string().trim().min(1).max(2000).optional(), status: creationStatusSchema.optional() })
  .refine((value) => value.title !== undefined || value.summary !== undefined || value.status !== undefined);
const comicAssetCreateSchema = z.object({
  kind: z.enum(["character", "scene", "prop", "reference_image"]),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(4000),
});

export function registerComicRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { cursor?: string; limit?: string } }>("/v1/comics", async (request) => {
    const user = await currentUser(request);
    const limit = Math.min(50, Math.max(1, Number.parseInt(request.query.limit ?? "20", 10) || 20));
    return ok(request, await listComics(user.id, { cursor: request.query.cursor, limit }));
  });

  app.get<{ Params: { comicId: string } }>("/v1/comics/:comicId", async (request) => {
    const user = await currentUser(request);
    return ok(request, await getComic(user.id, request.params.comicId));
  });

  app.post<{ Params: { comicId: string } }>("/v1/comics/:comicId/duplicate", async (request) => {
    const user = await currentUser(request);
    return ok(request, await duplicateComic(user.id, request.params.comicId));
  });

  app.get<{ Params: { comicId: string } }>("/v1/comics/:comicId/assets", async (request) => {
    const user = await currentUser(request);
    return ok(request, await listComicAssetCards(user.id, request.params.comicId));
  });

  app.post<{ Params: { comicId: string } }>("/v1/comics/:comicId/assets", async (request) => {
    const user = await currentUser(request);
    return ok(request, await createComicLibraryAsset(user.id, request.params.comicId, comicAssetCreateSchema.parse(request.body ?? {})));
  });

  app.get<{ Params: { comicId: string } }>("/v1/comics/:comicId/visual-style", async (request) => {
    const user = await currentUser(request);
    return ok(request, await getComicVisualStyle(user.id, request.params.comicId));
  });

  app.post<{ Params: { comicId: string } }>("/v1/comics/:comicId/visual-style/images", async (request) => {
    const user = await currentUser(request);
    await getComicVisualStyle(user.id, request.params.comicId);
    const uploaded = await readUploadedImage(request, `visual-style/${request.params.comicId}`);
    return ok(request, await appendComicVisualStyleImage(user.id, request.params.comicId, uploadedImage(uploaded)));
  });

  app.post("/v1/comics", async (request) => {
    const user = await currentUser(request);
    return ok(request, await createComic(user.id, comicCreateSchema.parse(request.body ?? {})));
  });

  app.patch<{ Params: { comicId: string } }>("/v1/comics/:comicId", async (request) => {
    const user = await currentUser(request);
    return ok(request, await updateComic(user.id, request.params.comicId, comicUpdateSchema.parse(request.body ?? {})));
  });

  app.get<{ Params: { comicId: string } }>("/v1/comics/:comicId/cover", async (request, reply) => {
    const user = await currentUser(request);
    const cover = await getComicCover(user.id, request.params.comicId);
    return reply.type(cover.contentType).send(cover.bytes);
  });

  app.post<{ Params: { comicId: string } }>("/v1/comics/:comicId/cover", async (request) => {
    const user = await currentUser(request);
    await getComic(user.id, request.params.comicId);
    const uploaded = await readUploadedImage(request, `covers/comics/${request.params.comicId}`);
    return ok(request, await updateComicCover(user.id, request.params.comicId, uploadedImage(uploaded)));
  });

  app.post<{ Params: { comicId: string } }>("/v1/comics/:comicId/chapters", async (request) => {
    const user = await currentUser(request);
    return ok(request, await createComicChapter(user.id, request.params.comicId, chapterCreateSchema.parse(request.body ?? {})));
  });

  app.patch<{ Params: { comicId: string; chapterId: string } }>("/v1/comics/:comicId/chapters/:chapterId", async (request) => {
    const user = await currentUser(request);
    return ok(request, await updateComicChapter(user.id, request.params.comicId, request.params.chapterId, chapterUpdateSchema.parse(request.body ?? {})));
  });

  app.get<{ Params: { chapterId: string } }>("/v1/chapters/:chapterId/cover", async (request, reply) => {
    const user = await currentUser(request);
    const cover = await getChapterCover(user.id, request.params.chapterId);
    return reply.type(cover.contentType).send(cover.bytes);
  });

  app.post<{ Params: { comicId: string; chapterId: string } }>("/v1/comics/:comicId/chapters/:chapterId/cover", async (request) => {
    const user = await currentUser(request);
    await assertComicChapterExists(user.id, request.params.comicId, request.params.chapterId);
    const uploaded = await readUploadedImage(request, `covers/chapters/${request.params.chapterId}`);
    return ok(request, await updateChapterCover(user.id, request.params.comicId, request.params.chapterId, uploadedImage(uploaded)));
  });

  app.delete<{ Params: { comicId: string } }>("/v1/comics/:comicId", async (request) => {
    const user = await currentUser(request);
    return ok(request, await archiveComic(user.id, request.params.comicId));
  });

  app.delete<{ Params: { comicId: string; chapterId: string } }>("/v1/comics/:comicId/chapters/:chapterId", async (request) => {
    const user = await currentUser(request);
    return ok(request, await archiveComicChapter(user.id, request.params.comicId, request.params.chapterId));
  });
}

import type { FastifyInstance } from "fastify";
import { AssetKind, AssetLibraryStatus } from "@prisma/client";
import { z } from "zod";
import { createUploadedAsset, readUploadedImage } from "../../../../packages/server/src/asset-service";
import { appendAssetImage, deleteAssetImage, getAssetFamilyDetail, renameAssetImage, setPrimaryAssetImage } from "../../../../packages/server/src/asset-library-service";
import { prisma } from "../../../../packages/server/src/db";
import { AppError } from "../../../../packages/server/src/errors";
import { getOwnedProject } from "../../../../packages/server/src/workbench-service";
import { currentUser, ok } from "../http";

const assetUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(4000).optional(),
}).refine((value) => value.name !== undefined || value.description !== undefined);

const assetImageUpdateSchema = z.object({ label: z.string().trim().min(1).max(80) });

export function registerAssetRoutes(app: FastifyInstance) {
  app.get<{ Params: { assetId: string } }>("/v1/assets/:assetId", async (request) => {
    const user = await currentUser(request);
    return ok(request, await getAssetFamilyDetail(user.id, request.params.assetId));
  });

  app.post<{ Params: { projectId: string }; Querystring: { place?: string } }>("/v1/projects/:projectId/assets", async (request) => {
    const user = await currentUser(request);
    await getOwnedProject(user.id, request.params.projectId);
    const uploaded = await readUploadedImage(request, `uploads/${request.params.projectId}`);
    return ok(request, await createUploadedAsset({
      ownerUserId: user.id,
      projectId: request.params.projectId,
      placeOnCanvas: request.query.place === "canvas",
      uploaded,
    }));
  });

  app.post<{ Params: { assetId: string } }>("/v1/assets/:assetId/images", async (request) => {
    const user = await currentUser(request);
    const asset = await prisma.asset.findFirst({ where: { id: request.params.assetId, ownerUserId: user.id, archivedAt: null, libraryStatus: AssetLibraryStatus.LIBRARY }, select: { id: true } });
    if (!asset) throw new AppError("not_found", "资产不存在。", 404);
    const uploaded = await readUploadedImage(request, `uploads/assets/${asset.id}`);
    return ok(request, await appendAssetImage(user.id, asset.id, uploaded));
  });

  app.post<{ Params: { assetId: string; imageId: string } }>("/v1/assets/:assetId/images/:imageId/primary", async (request) => {
    const user = await currentUser(request);
    return ok(request, await setPrimaryAssetImage(user.id, request.params.assetId, request.params.imageId));
  });

  app.patch<{ Params: { assetId: string; imageId: string }; Body: { label: string } }>("/v1/assets/:assetId/images/:imageId", async (request) => {
    const user = await currentUser(request);
    const body = assetImageUpdateSchema.parse(request.body ?? {});
    return ok(request, await renameAssetImage(user.id, request.params.assetId, request.params.imageId, body.label));
  });

  app.delete<{ Params: { assetId: string; imageId: string } }>("/v1/assets/:assetId/images/:imageId", async (request) => {
    const user = await currentUser(request);
    return ok(request, await deleteAssetImage(user.id, request.params.assetId, request.params.imageId));
  });

  app.post<{ Params: { projectId: string; assetId: string }; Body: { x?: number; y?: number } }>("/v1/projects/:projectId/assets/:assetId/place", async (request) => {
    const user = await currentUser(request);
    const targetProject = await prisma.project.findFirst({ where: { id: request.params.projectId, ownerUserId: user.id }, include: { chapter: { select: { comicId: true } } } });
    if (!targetProject) throw new AppError("not_found", "创作空间不存在。", 404);
    const asset = await prisma.asset.findFirst({
      where: { id: request.params.assetId, ownerUserId: user.id, archivedAt: null, project: { chapter: { comicId: targetProject.chapter.comicId, archivedAt: null } } },
      include: {
        images: { include: { assetVersion: true }, orderBy: [{ sortIndex: "asc" }, { createdAt: "asc" }], take: 1 },
        versions: { where: { objectKey: { not: null } }, orderBy: { version: "desc" }, take: 1 },
      },
    });
    const version = asset?.images[0]?.assetVersion ?? asset?.versions[0];
    if (!asset || !version) throw new AppError("invalid_asset", "这个资产还没有可放到画布的确认图片。", 422);
    await prisma.canvasAssetListItem.upsert({
      where: { projectId_assetId: { projectId: targetProject.id, assetId: asset.id } },
      create: { ownerUserId: user.id, projectId: targetProject.id, assetId: asset.id, displayName: asset.name, displayKind: asset.kind },
      update: { hiddenAt: null },
    });
    const placement = await prisma.canvasReferencePlacement.create({
      data: { ownerUserId: user.id, projectId: targetProject.id, assetId: asset.id, assetVersionId: version.id, x: request.body?.x ?? 320, y: request.body?.y ?? 180 },
    });
    return ok(request, placement);
  });

  app.post<{ Params: { projectId: string; assetId: string } }>("/v1/projects/:projectId/canvas-assets/:assetId/import", async (request) => {
    const user = await currentUser(request);
    const targetProject = await prisma.project.findFirst({ where: { id: request.params.projectId, ownerUserId: user.id }, include: { chapter: { select: { comicId: true } } } });
    if (!targetProject) throw new AppError("not_found", "创作空间不存在。", 404);
    const asset = await prisma.asset.findFirst({
      where: { id: request.params.assetId, ownerUserId: user.id, archivedAt: null, libraryStatus: AssetLibraryStatus.LIBRARY, project: { chapter: { comicId: targetProject.chapter.comicId, archivedAt: null } } },
    });
    if (!asset) throw new AppError("not_found", "资产不存在或尚未保存到资产空间。", 404);
    const item = await prisma.canvasAssetListItem.upsert({
      where: { projectId_assetId: { projectId: targetProject.id, assetId: asset.id } },
      create: { ownerUserId: user.id, projectId: targetProject.id, assetId: asset.id, displayName: asset.name, displayKind: asset.kind },
      update: { hiddenAt: null },
    });
    return ok(request, item);
  });

  app.patch<{ Params: { assetId: string }; Body: { name?: string; description?: string } }>("/v1/assets/:assetId", async (request) => {
    const user = await currentUser(request);
    const body = assetUpdateSchema.parse(request.body ?? {});
    const asset = await prisma.asset.findFirst({ where: { id: request.params.assetId, ownerUserId: user.id, archivedAt: null } });
    if (!asset) throw new AppError("not_found", "资产不存在。", 404);
    const updated = await prisma.asset.update({
      where: { id: asset.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
      },
    });
    return ok(request, updated);
  });

  app.patch<{ Params: { itemId: string }; Body: { displayName?: string; pinned?: boolean; hidden?: boolean; sortIndex?: number } }>("/v1/canvas-asset-items/:itemId", async (request) => {
    const user = await currentUser(request);
    const item = await prisma.canvasAssetListItem.findFirst({ where: { id: request.params.itemId, ownerUserId: user.id } });
    if (!item) throw new AppError("not_found", "画布资产列表项不存在。", 404);
    const patch = request.body ?? {};
    if (patch.sortIndex !== undefined && (!Number.isInteger(patch.sortIndex) || patch.sortIndex < -100000 || patch.sortIndex > 100000)) throw new AppError("validation", "资产排序值无效。", 400);
    const updated = await prisma.canvasAssetListItem.update({
      where: { id: item.id },
      data: {
        ...(patch.displayName !== undefined ? { displayName: patch.displayName.trim().slice(0, 120) || item.displayName } : {}),
        ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
        ...(patch.hidden !== undefined ? { hiddenAt: patch.hidden ? new Date() : null } : {}),
        ...(patch.sortIndex !== undefined ? { sortIndex: patch.sortIndex } : {}),
      },
    });
    return ok(request, updated);
  });

  app.post<{ Params: { itemId: string }; Body: { name?: string; description?: string; kind?: "character" | "scene" | "prop" | "reference_image" } }>("/v1/canvas-asset-items/:itemId/save-to-library", async (request) => {
    const user = await currentUser(request);
    const item = await prisma.canvasAssetListItem.findFirst({ where: { id: request.params.itemId, ownerUserId: user.id }, include: { asset: true } });
    if (!item) throw new AppError("not_found", "画布资产列表项不存在。", 404);
    const body = request.body ?? {};
    const kind = body.kind ? ({ character: AssetKind.CHARACTER, scene: AssetKind.SCENE, prop: AssetKind.PROP, reference_image: AssetKind.REFERENCE_IMAGE } as const)[body.kind] : item.asset.kind;
    const name = body.name?.trim().slice(0, 120) || item.asset.name;
    const [asset] = await prisma.$transaction([
      prisma.asset.update({ where: { id: item.assetId }, data: { libraryStatus: AssetLibraryStatus.LIBRARY, kind, name, ...(body.description !== undefined ? { description: body.description.trim().slice(0, 2000) } : {}) } }),
      prisma.canvasAssetListItem.update({ where: { id: item.id }, data: { displayName: name, displayKind: kind } }),
    ]);
    return ok(request, { itemId: item.id, assetId: asset.id, libraryStatus: asset.libraryStatus.toLowerCase(), kind: asset.kind.toLowerCase() });
  });

  app.patch<{ Params: { placementId: string }; Body: { x?: number; y?: number; zoom?: number; zIndex?: number; collapsed?: boolean; pinned?: boolean; assetVersionId?: string } }>("/v1/placements/:placementId", async (request) => {
    const user = await currentUser(request);
    const placement = await prisma.canvasReferencePlacement.findFirst({ where: { id: request.params.placementId, ownerUserId: user.id } });
    if (!placement) throw new AppError("not_found", "参考卡不存在。", 404);
    const patch = request.body ?? {};
    if (patch.zoom !== undefined && (!Number.isFinite(patch.zoom) || patch.zoom < 0.12 || patch.zoom > 20)) throw new AppError("validation", "参考图缩放值无效。", 400);
    if (patch.x !== undefined && !Number.isFinite(patch.x)) throw new AppError("validation", "参考图位置无效。", 400);
    if (patch.y !== undefined && !Number.isFinite(patch.y)) throw new AppError("validation", "参考图位置无效。", 400);
    if (patch.zIndex !== undefined && (!Number.isInteger(patch.zIndex) || patch.zIndex < 0 || patch.zIndex > 10000)) throw new AppError("validation", "参考图层级无效。", 400);
    if (patch.assetVersionId !== undefined) {
      const image = await prisma.assetImage.findFirst({ where: { assetId: placement.assetId, assetVersionId: patch.assetVersionId }, select: { id: true } });
      if (!image) throw new AppError("validation", "这张图片不属于当前资产。", 400);
    }
    const updated = await prisma.canvasReferencePlacement.update({ where: { id: placement.id }, data: { x: patch.x, y: patch.y, zoom: patch.zoom, zIndex: patch.zIndex, collapsed: patch.collapsed, pinned: patch.pinned, assetVersionId: patch.assetVersionId } });
    return ok(request, updated);
  });

  app.delete<{ Params: { placementId: string } }>("/v1/placements/:placementId", async (request) => {
    const user = await currentUser(request);
    const placement = await prisma.canvasReferencePlacement.findFirst({ where: { id: request.params.placementId, ownerUserId: user.id } });
    if (!placement) throw new AppError("not_found", "画布对象不存在。", 404);
    await prisma.canvasReferencePlacement.delete({ where: { id: placement.id } });
    return ok(request, { id: placement.id, deleted: true });
  });
}

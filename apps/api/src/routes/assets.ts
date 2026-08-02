import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createUploadedAsset } from "@lantern/server/asset-service";
import {
  appendAssetImage,
  archiveAssetFamily,
  deleteAssetImage,
  getAssetFamilyDetail,
  renameAssetImage,
  restoreAssetToCanvasList,
  setPrimaryAssetImage,
  updateAsset,
} from "@lantern/server/asset-library-service";
import {
  deleteCanvasPlacement,
  placeAssetOnCanvas,
  saveCanvasAssetToLibrary,
  updateCanvasAssetListItem,
  updateCanvasPlacement,
} from "@lantern/server/canvas-asset-service";
import { getOwnedProject } from "@lantern/server/workbench-service";
import { currentUser, ok } from "../http";
import { readUploadedImage, uploadedImage } from "../upload";

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

  app.delete<{ Params: { assetId: string } }>("/v1/assets/:assetId", async (request) => {
    const user = await currentUser(request);
    return ok(request, await archiveAssetFamily(user.id, request.params.assetId));
  });

  app.post<{ Params: { projectId: string }; Querystring: { place?: string; usage?: string } }>("/v1/projects/:projectId/assets", async (request) => {
    const user = await currentUser(request);
    await getOwnedProject(user.id, request.params.projectId);
    const uploaded = await readUploadedImage(request, `uploads/${request.params.projectId}`);
    const { fields, ...image } = uploaded;
    return ok(request, await createUploadedAsset({
      ownerUserId: user.id,
      projectId: request.params.projectId,
      placeOnCanvas: request.query.place === "canvas",
      attachmentUsage: request.query.usage === "conversation" || request.query.usage === "annotation" ? request.query.usage : undefined,
      kind: fields.kind?.value,
      name: fields.name?.value,
      description: fields.description?.value,
      x: fields.x?.value === undefined ? undefined : Number(fields.x.value),
      y: fields.y?.value === undefined ? undefined : Number(fields.y.value),
      uploaded: image,
    }));
  });

  app.post<{ Params: { assetId: string } }>("/v1/assets/:assetId/images", async (request) => {
    const user = await currentUser(request);
    await getAssetFamilyDetail(user.id, request.params.assetId);
    const uploaded = await readUploadedImage(request, `uploads/assets/${request.params.assetId}`);
    return ok(request, await appendAssetImage(user.id, request.params.assetId, uploadedImage(uploaded)));
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
    return ok(request, await placeAssetOnCanvas(user.id, request.params.projectId, request.params.assetId, request.body ?? {}));
  });

  app.post<{ Params: { projectId: string; assetId: string } }>("/v1/projects/:projectId/canvas-assets/:assetId/import", async (request) => {
    const user = await currentUser(request);
    return ok(request, await restoreAssetToCanvasList(user.id, request.params.projectId, request.params.assetId));
  });

  app.patch<{ Params: { assetId: string } }>("/v1/assets/:assetId", async (request) => {
    const user = await currentUser(request);
    return ok(request, await updateAsset(user.id, request.params.assetId, assetUpdateSchema.parse(request.body ?? {})));
  });

  app.patch<{ Params: { itemId: string }; Body: { displayName?: string; pinned?: boolean; hidden?: boolean; sortIndex?: number } }>("/v1/canvas-asset-items/:itemId", async (request) => {
    const user = await currentUser(request);
    return ok(request, await updateCanvasAssetListItem(user.id, request.params.itemId, request.body ?? {}));
  });

  app.post<{ Params: { itemId: string }; Body: { name?: string; description?: string; kind?: "character" | "scene" | "prop" | "reference_image" } }>("/v1/canvas-asset-items/:itemId/save-to-library", async (request) => {
    const user = await currentUser(request);
    return ok(request, await saveCanvasAssetToLibrary(user.id, request.params.itemId, request.body ?? {}));
  });

  app.patch<{ Params: { placementId: string }; Body: { x?: number; y?: number; zoom?: number; zIndex?: number; collapsed?: boolean; pinned?: boolean; assetVersionId?: string } }>("/v1/placements/:placementId", async (request) => {
    const user = await currentUser(request);
    return ok(request, await updateCanvasPlacement(user.id, request.params.placementId, request.body ?? {}));
  });

  app.delete<{ Params: { placementId: string } }>("/v1/placements/:placementId", async (request) => {
    const user = await currentUser(request);
    return ok(request, await deleteCanvasPlacement(user.id, request.params.placementId));
  });
}

import { z } from "zod";
import { prisma } from "@lantern/server/db";
import { AppError } from "@lantern/server/errors";
import { getObject } from "@lantern/server/object-storage";
import { executeIdempotentExternalMutation } from "@lantern/server/external-operation-service";
import { prepareExternalAssetUpload } from "@lantern/server/external-upload-service";
import {
  archiveComic,
  archiveComicChapter,
  attachExternalComicCoverImage,
  createComic,
  createComicChapter,
  duplicateComic,
  getComic,
  getComicCoverMetadata,
  getComicChapter,
  listComics,
  prepareExternalComicCoverUpload,
  updateComic,
  updateComicChapter,
} from "@lantern/server/comic-service";
import {
  archiveAssetVariant,
  archiveComicVisualStyleImage,
  archiveAssetFamily,
  attachExternalAssetImage,
  attachExternalComicVisualStyleImage,
  createAssetVariant,
  createComicLibraryAsset,
  deleteAssetImage,
  getAssetFamilyDetail,
  getComicVisualStyle,
  listComicAssetCards,
  renameAssetImage,
  renameComicVisualStyleImage,
  prepareExternalComicVisualStyleImageUpload,
  setPrimaryAssetImage,
  setPrimaryComicVisualStyleImage,
  updateAsset,
} from "@lantern/server/asset-library-service";
import {
  resolveResourceReference,
  resourceReference,
} from "@lantern/server/resource-reference-service";
import {
  createComicPageViews,
  orderedUnitSurfaces,
  validateComicDocument,
  type ComicDocument,
  type PresentationUnit,
} from "@lantern/shared";
import { compositionObservationSchema, compositionStructureSchema, loadWorkingCompositionObservation } from "./composition-observation";
import { buildAgentContext } from "./context-builder";
import {
  assertAgentCapabilityAccess,
  getAgentCapability,
  listAgentCapabilities,
  semanticCapabilityCatalogManifest,
  type AgentCapabilityDescriptor,
  type AgentCapabilityContextProfile,
} from "./capability-registry";
import { externalResourceToolResultSchema, isResourceCapabilityId } from "./resource-capabilities";
import { isCandidateCapabilityId } from "./candidate-capabilities";
import { isPageCapabilityId } from "./page-capabilities";
import { isCompositionCapabilityId } from "./composition-capabilities";
import {
  createExternalTargetHandle,
  resolveExternalTargetHandles,
  type ExternalTargetHandlePayload,
} from "./external-target-handles";

export const externalContextProfiles = [
  "visual_observation",
  "composition_observation",
  "single_frame_generation",
  "asset_generation",
] as const satisfies readonly AgentCapabilityContextProfile[];

export const externalProjectsListInputSchema = z.strictObject({});

const externalPageLocatorSchema = z.strictObject({
  position: z.number().int().positive().optional(),
  physicalPageNumber: z.number().int().positive().optional(),
  name: z.string().trim().min(1).max(120).optional(),
}).refine((value) => [value.position, value.physicalPageNumber, value.name].filter((item) => item !== undefined).length === 1, {
  message: "页面定位只能提供 position、physicalPageNumber 或 name 其中一种。",
});

export const externalContextGetInputSchema = z.strictObject({
  scope: z.string().trim().min(1).max(2048).optional(),
  projectId: z.string().min(1).optional(),
  source: z.enum(["working", "latest_saved"]).default("working"),
  profile: z.enum(externalContextProfiles).default("visual_observation"),
  assets: z.array(z.string().trim().min(1).max(2048)).max(3).optional(),
  pages: z.array(externalPageLocatorSchema).min(1).max(2).optional(),
  pageId: z.string().min(1).optional(),
  pageIds: z.array(z.string().min(1)).min(1).max(2).optional(),
}).superRefine((value, context) => {
  if ((value.scope === undefined) === (value.projectId === undefined)) {
    context.addIssue({ code: "custom", message: "scope 与 projectId 必须且只能提供一种。" });
  }
  if ([value.pages, value.pageId, value.pageIds].filter((item) => item !== undefined).length > 1) {
    context.addIssue({ code: "custom", message: "pages、pageId 与 pageIds 只能提供一种。" });
  }
});

export const externalCapabilitiesListInputSchema = z.strictObject({});

export const externalImagesInspectInputSchema = z.strictObject({
  projectId: z.string().min(1).optional(),
  targetHandles: z.array(z.string().min(1).max(4096)).min(1).max(3),
});

export const externalCompositionInspectInputSchema = z.strictObject({
  projectId: z.string().min(1).optional(),
  pageHandles: z.array(z.string().min(1).max(4096)).min(1).max(2),
});

export const externalProjectsListOutputSchema = z.object({
  projects: z.array(z.object({
    projectId: z.string(),
    projectUri: z.string(),
    comic: z.object({ id: z.string(), uri: z.string(), title: z.string(), format: z.string(), defaultReadingDirection: z.string() }),
    chapter: z.object({ id: z.string(), uri: z.string(), number: z.number().int(), title: z.string(), summary: z.string() }),
    workingRevision: z.number().int().positive().nullable(),
    updatedAt: z.string(),
  })),
});

export const externalCapabilitiesListOutputSchema = z.object({
  catalogRevision: z.number().int().positive(),
  catalogHash: z.string(),
  capabilities: z.array(z.record(z.string(), z.unknown())),
});

const externalContextTargetSchema = z.object({
  handle: z.string(),
  type: z.string(),
  label: z.string(),
  aliases: z.array(z.string()),
  summary: z.string(),
  pageId: z.string().optional(),
  pageLabel: z.string().optional(),
  surfaceRole: z.string().optional(),
  assetId: z.string().optional(),
  assetVersionId: z.string().optional(),
  assetKind: z.string().optional(),
  isPrimary: z.boolean().optional(),
  assetVersionIds: z.array(z.string()),
});

const externalPageSequenceItemSchema = z.strictObject({
  readingPosition: z.number().int().positive(),
  label: z.string().min(1),
  name: z.string().optional(),
  pageRole: z.enum(["story", "cover", "interlude"]),
  kind: z.string().min(1),
  trueSpread: z.boolean(),
  physicalPageNumbers: z.array(z.number().int().positive()),
});

const externalPageStructureSchema = externalPageSequenceItemSchema.extend({
  handle: z.string().min(1),
  canvas: z.strictObject({
    width: z.number().positive(),
    height: z.number().positive(),
  }),
  surfaces: z.array(z.strictObject({
    handle: z.string().min(1),
    role: z.string().min(1),
    name: z.string().optional(),
    physicalPageNumber: z.number().int().positive().optional(),
    geometry: z.strictObject({
      x: z.number(),
      y: z.number(),
      width: z.number().positive(),
      height: z.number().positive(),
    }),
  })).min(1),
  surfaceReadingOrder: z.array(z.string().min(1)).min(1),
  previousReadingPosition: z.number().int().positive().optional(),
  nextReadingPosition: z.number().int().positive().optional(),
});

const externalObservationSourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("working"),
    workingRevision: z.number().int().positive(),
    createdAt: z.string(),
  }),
  z.strictObject({
    kind: z.literal("saved_snapshot"),
    snapshotId: z.string().min(1),
    sourceWorkingRevision: z.number().int().positive(),
    createdAt: z.string(),
  }),
]);

export const externalContextGetOutputSchema = z.object({
  projectId: z.string(),
  scope: z.strictObject({
    comic: z.string(),
    chapter: z.string(),
    project: z.string(),
  }),
  baseRevision: z.number().int().positive(),
  source: externalObservationSourceSchema,
  profile: z.enum(externalContextProfiles),
  expiresAt: z.string(),
  comic: z.object({
    id: z.string(),
    title: z.string(),
    summary: z.string(),
    worldSummary: z.string(),
    format: z.string(),
    defaultReadingDirection: z.string(),
    styleSummary: z.string(),
    settings: z.array(z.object({ id: z.string(), title: z.string(), content: z.string() })),
  }),
  chapter: z.object({ id: z.string(), title: z.string(), summary: z.string() }),
  readingDirection: z.enum(["ltr", "rtl", "ttb"]),
  pageSequence: z.array(externalPageSequenceItemSchema),
  pages: z.array(externalPageStructureSchema).max(2),
  currentView: z.object({ label: z.string(), physicalPageNumbers: z.array(z.number().int()) }).optional(),
  currentPage: z.object({ id: z.string(), pageIndex: z.number().int(), kind: z.string(), comicFrameCount: z.number().int() }).optional(),
  storyboardBeats: z.array(z.object({ id: z.string(), versionId: z.string(), title: z.string(), description: z.string() })),
  assets: z.array(z.object({
    id: z.string(),
    kind: z.string(),
    name: z.string(),
    description: z.string(),
    versionId: z.string().optional(),
    images: z.array(z.object({ versionId: z.string(), isPrimary: z.boolean() })),
  })),
  targets: z.array(externalContextTargetSchema),
  omittedContext: z.array(z.object({ type: z.string(), reason: z.string() })),
});

export const externalImagesInspectOutputSchema = z.object({
  projectId: z.string(),
  baseRevision: z.number().int().positive(),
  source: externalObservationSourceSchema,
  images: z.array(z.strictObject({
    handle: z.string().min(1),
    assetId: z.string().min(1),
    assetVersionId: z.string().min(1),
    mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
  })).min(1).max(3),
});

export const externalCompositionInspectOutputSchema = compositionObservationSchema;

const defaultHandleLifetimeMs = 15 * 60 * 1000;

export async function listExternalAgentProjects(ownerUserId: string) {
  const projects = await prisma.project.findMany({
    where: {
      ownerUserId,
      chapter: { archivedAt: null, comic: { archivedAt: null } },
    },
    include: {
      chapter: { include: { comic: true } },
      workingRevisions: { orderBy: { revision: "desc" }, take: 1, select: { revision: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
  return externalProjectsListOutputSchema.parse({
    projects: projects.map((project) => ({
      projectId: project.id,
      projectUri: resourceReference("project", project.id).uri,
      comic: {
        id: project.chapter.comic.id,
        uri: resourceReference("comic", project.chapter.comic.id).uri,
        title: project.chapter.comic.title,
        format: project.chapter.comic.format.toLowerCase(),
        defaultReadingDirection: project.chapter.comic.defaultReadingDirection.toLowerCase(),
      },
      chapter: {
        id: project.chapter.id,
        uri: resourceReference("chapter", project.chapter.id).uri,
        number: project.chapter.number,
        title: project.chapter.title,
        summary: project.chapter.summary,
      },
      workingRevision: project.workingRevisions[0]?.revision ?? null,
      updatedAt: project.updatedAt.toISOString(),
    })),
  });
}

export function listExternalCapabilities() {
  const catalog = semanticCapabilityCatalogManifest();
  return externalCapabilitiesListOutputSchema.parse({
    catalogRevision: catalog.revision,
    catalogHash: catalog.hash,
    capabilities: catalog.capabilities.filter((capability) =>
      capability.agentAccess.external !== "disabled"
      && (
        capability.effect === "observe"
        || isResourceCapabilityId(capability.id)
        || isCandidateCapabilityId(capability.id)
        || isPageCapabilityId(capability.id)
        || isCompositionCapabilityId(capability.id)
      )),
  });
}

export function listExternalResourceCapabilities() {
  return listAgentCapabilities().filter((capability) =>
    capability.execution === "synchronous"
    && capability.agentAccess.external !== "disabled"
    && isResourceCapabilityId(capability.id));
}

function jsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function externalResourceResult(
  capability: AgentCapabilityDescriptor,
  input: {
    data?: unknown;
    resource?: ReturnType<typeof resourceReference>;
    projectId?: string;
    baseRevision?: number;
    workingRevision?: number;
    nextActions?: string[];
  },
) {
  return externalResourceToolResultSchema.parse({
    capability: { id: capability.id, version: capability.version },
    effect: capability.effect,
    ...(input.resource ? { resource: input.resource } : {}),
    ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(input.baseRevision ? { baseRevision: input.baseRevision } : {}),
    ...(input.workingRevision ? { workingRevision: input.workingRevision } : {}),
    ...(input.data !== undefined ? { data: jsonValue(input.data) } : {}),
    nextActions: input.nextActions ?? [],
  });
}

function argument(input: Record<string, unknown>, name: string) {
  const value = input[name];
  if (typeof value !== "string") throw new AppError("validation", `缺少 ${name} 参数。`, 400);
  return value;
}

async function executeExternalResourceCapability(
  ownerUserId: string,
  capability: AgentCapabilityDescriptor,
  parsed: Record<string, unknown>,
) {
  if (capability.id === "comic.list") {
    const comics = await listComics(ownerUserId, { cursor: parsed.cursor as string | undefined, limit: parsed.limit as number });
    return externalResourceResult(capability, {
      data: { ...comics, items: comics.items.map((comic) => ({ ...comic, uri: resourceReference("comic", comic.id).uri })) },
      nextActions: comics.items.length ? ["Use a returned comic URI for a precise follow-up action."] : [],
    });
  }

  if (capability.id === "comic.create") {
    const created = await createComic(ownerUserId, parsed as unknown as Parameters<typeof createComic>[1]);
    const comic = await getComic(ownerUserId, created.comic.id);
    return externalResourceResult(capability, {
      resource: resourceReference("comic", comic.id),
      data: comic,
      nextActions: ["Create the first chapter before saving assets or editing pages."],
    });
  }

  if (capability.id.startsWith("comic.")) {
    const target = await resolveResourceReference(ownerUserId, argument(parsed, "comic"), "comic");
    if (capability.id === "comic.get") {
      return externalResourceResult(capability, { resource: resourceReference("comic", target.id), data: await getComic(ownerUserId, target.id) });
    }
    if (capability.id === "comic.cover.get") {
      return externalResourceResult(capability, {
        resource: resourceReference("comic", target.id),
        data: await getComicCoverMetadata(ownerUserId, target.id),
      });
    }
    if (capability.id === "comic.cover.image.upload_prepare") {
      return externalResourceResult(capability, {
        resource: resourceReference("comic", target.id),
        data: await prepareExternalComicCoverUpload(ownerUserId, target.id, {
          filename: argument(parsed, "filename"),
          label: parsed.label as string | undefined,
        }),
        nextActions: ["PUT the raw PNG, JPEG, or WebP bytes to uploadUrl with the returned headers, then call comic.cover.image.attach with uploadId."],
      });
    }
    if (capability.id === "comic.cover.image.attach") {
      return externalResourceResult(capability, {
        resource: resourceReference("comic", target.id),
        data: await attachExternalComicCoverImage(ownerUserId, target.id, argument(parsed, "uploadId")),
      });
    }
    if (capability.id === "comic.visual_style.get") {
      return externalResourceResult(capability, {
        resource: resourceReference("comic", target.id),
        data: await getComicVisualStyle(ownerUserId, target.id),
      });
    }
    if (capability.id === "comic.visual_style.image.upload_prepare") {
      return externalResourceResult(capability, {
        resource: resourceReference("comic", target.id),
        data: await prepareExternalComicVisualStyleImageUpload(ownerUserId, target.id, {
          filename: argument(parsed, "filename"),
          label: parsed.label as string | undefined,
        }),
        nextActions: ["PUT the raw PNG, JPEG, or WebP bytes to uploadUrl with the returned headers, then call comic.visual_style.image.attach with uploadId."],
      });
    }
    if (capability.id === "comic.visual_style.image.attach") {
      return externalResourceResult(capability, {
        resource: resourceReference("comic", target.id),
        data: await attachExternalComicVisualStyleImage(ownerUserId, target.id, argument(parsed, "uploadId")),
      });
    }
    if (capability.id === "comic.visual_style.image.set_primary") {
      return externalResourceResult(capability, {
        resource: resourceReference("comic", target.id),
        data: await setPrimaryComicVisualStyleImage(ownerUserId, target.id, argument(parsed, "imageId")),
      });
    }
    if (capability.id === "comic.visual_style.image.rename") {
      return externalResourceResult(capability, {
        resource: resourceReference("comic", target.id),
        data: await renameComicVisualStyleImage(ownerUserId, target.id, argument(parsed, "imageId"), argument(parsed, "label")),
      });
    }
    if (capability.id === "comic.visual_style.image.archive") {
      return externalResourceResult(capability, {
        resource: resourceReference("comic", target.id),
        data: await archiveComicVisualStyleImage(ownerUserId, target.id, argument(parsed, "imageId")),
      });
    }
    if (capability.id === "comic.update") {
      const updates = { ...parsed };
      delete updates.comic;
      await updateComic(ownerUserId, target.id, updates as Parameters<typeof updateComic>[2]);
      return externalResourceResult(capability, { resource: resourceReference("comic", target.id), data: await getComic(ownerUserId, target.id) });
    }
    if (capability.id === "comic.duplicate") {
      const copied = await duplicateComic(ownerUserId, target.id);
      return externalResourceResult(capability, {
        resource: resourceReference("comic", copied.comicId),
        data: { ...copied, comic: await getComic(ownerUserId, copied.comicId) },
        nextActions: ["Use the new comic URI for all follow-up changes."],
      });
    }
    if (capability.id === "comic.archive") {
      return externalResourceResult(capability, { resource: resourceReference("comic", target.id), data: await archiveComic(ownerUserId, target.id) });
    }
  }

  if (capability.id === "chapter.create") {
    const comic = await resolveResourceReference(ownerUserId, argument(parsed, "comic"), "comic");
    const created = await createComicChapter(ownerUserId, comic.id, { title: argument(parsed, "title"), summary: parsed.summary as string });
    return externalResourceResult(capability, {
      resource: resourceReference("chapter", created.chapterId),
      projectId: created.projectId,
      workingRevision: 1,
      data: { ...created, chapter: await getComicChapter(ownerUserId, created.chapterId) },
      nextActions: ["Use the returned chapter URI or projectId for follow-up work."],
    });
  }

  if (capability.id.startsWith("chapter.")) {
    const target = await resolveResourceReference(ownerUserId, argument(parsed, "chapter"), "chapter");
    if (capability.id === "chapter.get") {
      return externalResourceResult(capability, {
        resource: resourceReference("chapter", target.id),
        projectId: target.projectId,
        workingRevision: target.workingRevision,
        data: await getComicChapter(ownerUserId, target.id),
      });
    }
    if (capability.id === "chapter.update") {
      const updates = { ...parsed };
      delete updates.chapter;
      await updateComicChapter(ownerUserId, target.comicId!, target.id, updates as Parameters<typeof updateComicChapter>[3]);
      return externalResourceResult(capability, {
        resource: resourceReference("chapter", target.id),
        projectId: target.projectId,
        workingRevision: target.workingRevision,
        data: await getComicChapter(ownerUserId, target.id),
      });
    }
    if (capability.id === "chapter.archive") {
      return externalResourceResult(capability, {
        resource: resourceReference("chapter", target.id),
        projectId: target.projectId,
        workingRevision: target.workingRevision,
        data: await archiveComicChapter(ownerUserId, target.comicId!, target.id),
      });
    }
  }

  if (capability.id === "asset.list" || capability.id === "asset.create") {
    const comic = await resolveResourceReference(ownerUserId, argument(parsed, "comic"), "comic");
    if (capability.id === "asset.list") {
      const assets = await listComicAssetCards(ownerUserId, comic.id);
      return externalResourceResult(capability, {
        resource: resourceReference("comic", comic.id),
        data: assets.map((asset) => ({ ...asset, uri: resourceReference("asset", asset.id).uri })),
      });
    }
    const created = await createComicLibraryAsset(ownerUserId, comic.id, {
      kind: parsed.kind as "character" | "scene" | "prop" | "reference_image",
      name: argument(parsed, "name"),
      description: argument(parsed, "description"),
    });
    return externalResourceResult(capability, {
      resource: resourceReference("asset", created.id),
      data: created,
      nextActions: ["Use the returned asset URI to update its confirmed description or manage future image versions."],
    });
  }

  if (capability.id.startsWith("asset.")) {
    const target = await resolveResourceReference(ownerUserId, argument(parsed, "asset"), "asset");
    if (capability.id === "asset.get") {
      return externalResourceResult(capability, {
        resource: resourceReference("asset", target.id),
        projectId: target.projectId,
        workingRevision: target.workingRevision,
        data: await getAssetFamilyDetail(ownerUserId, target.id),
      });
    }
    if (capability.id === "asset.update") {
      const updates = { ...parsed };
      delete updates.asset;
      await updateAsset(ownerUserId, target.id, updates as Parameters<typeof updateAsset>[2]);
      return externalResourceResult(capability, {
        resource: resourceReference("asset", target.id),
        projectId: target.projectId,
        workingRevision: target.workingRevision,
        data: await getAssetFamilyDetail(ownerUserId, target.id),
      });
    }
    if (capability.id === "asset.variant.create") {
      const data = await createAssetVariant(ownerUserId, target.id, {
        label: argument(parsed, "label"),
        name: parsed.name as string | undefined,
        description: parsed.description as string | undefined,
      });
      return externalResourceResult(capability, {
        resource: resourceReference("asset", data.createdVariantId),
        projectId: target.projectId,
        workingRevision: target.workingRevision,
        data,
        nextActions: ["Use the returned variant asset URI when uploading images or updating this shape."],
      });
    }
    if (capability.id === "asset.variant.archive") {
      const data = await archiveAssetVariant(ownerUserId, target.id);
      return externalResourceResult(capability, {
        resource: resourceReference("asset", data.id),
        projectId: target.projectId,
        workingRevision: target.workingRevision,
        data,
      });
    }
    if (capability.id === "asset.image.upload_prepare") {
      return externalResourceResult(capability, {
        resource: resourceReference("asset", target.id),
        projectId: target.projectId,
        workingRevision: target.workingRevision,
        data: await prepareExternalAssetUpload(ownerUserId, target.id, {
          filename: argument(parsed, "filename"),
          label: parsed.label as string | undefined,
        }),
        nextActions: ["PUT the raw PNG, JPEG, or WebP bytes to uploadUrl with the returned headers, then call asset.image.attach with uploadId."],
      });
    }
    if (capability.id === "asset.image.attach") {
      return externalResourceResult(capability, {
        resource: resourceReference("asset", target.id),
        projectId: target.projectId,
        workingRevision: target.workingRevision,
        data: await attachExternalAssetImage(ownerUserId, target.id, argument(parsed, "uploadId")),
        nextActions: ["Reuse the returned immutable versionId for fixed references; set the image as primary only if the creator requests it."],
      });
    }
    if (capability.id === "asset.image.set_primary") {
      return externalResourceResult(capability, {
        resource: resourceReference("asset", target.id),
        projectId: target.projectId,
        workingRevision: target.workingRevision,
        data: await setPrimaryAssetImage(ownerUserId, target.id, argument(parsed, "imageId")),
      });
    }
    if (capability.id === "asset.image.rename") {
      return externalResourceResult(capability, {
        resource: resourceReference("asset", target.id),
        projectId: target.projectId,
        workingRevision: target.workingRevision,
        data: await renameAssetImage(ownerUserId, target.id, argument(parsed, "imageId"), argument(parsed, "label")),
      });
    }
    if (capability.id === "asset.image.archive") {
      return externalResourceResult(capability, {
        resource: resourceReference("asset", target.id),
        projectId: target.projectId,
        workingRevision: target.workingRevision,
        data: await deleteAssetImage(ownerUserId, target.id, argument(parsed, "imageId")),
      });
    }
    if (capability.id === "asset.archive") {
      return externalResourceResult(capability, {
        resource: resourceReference("asset", target.id),
        projectId: target.projectId,
        workingRevision: target.workingRevision,
        data: await archiveAssetFamily(ownerUserId, target.id),
      });
    }
  }

  throw new AppError("capability_not_available", "该 Lantern 能力当前没有同步执行器。", 404);
}

export async function invokeExternalResourceCapability(
  ownerUserId: string,
  capabilityId: string,
  input: unknown,
) {
  const capability = getAgentCapability(capabilityId);
  if (!capability || capability.execution !== "synchronous" || !isResourceCapabilityId(capability.id)) {
    throw new AppError("capability_not_available", "该 Lantern 能力当前未向外置 Agent 开放。", 404);
  }
  assertAgentCapabilityAccess(capability, "external");
  const parsed = capability.inputSchema.parse(input) as Record<string, unknown>;
  if (capability.effect === "observe") return executeExternalResourceCapability(ownerUserId, capability, parsed);
  const idempotencyKey = argument(parsed, "idempotencyKey");
  return executeIdempotentExternalMutation({
    ownerUserId,
    capabilityId: capability.id,
    capabilityVersion: capability.version,
    idempotencyKey,
    input: parsed,
    operation: () => executeExternalResourceCapability(ownerUserId, capability, parsed),
  });
}

function contextRequestForProfile(profile: AgentCapabilityContextProfile) {
  return profile === "asset_generation"
    ? { taskType: "asset_image_generate", scope: "reference_only" }
    : { taskType: "interaction", scope: "current_page" };
}

function normalizedLocatorText(value: string) {
  return value.trim().toLocaleLowerCase().replaceAll(/\s+/g, "");
}

function orderedDocumentUnits(document: ComicDocument) {
  const units = new Map(document.units.map((unit) => [unit.id, unit]));
  return document.reading.unitOrder.flatMap((unitId) => {
    const unit = units.get(unitId);
    return unit ? [unit] : [];
  });
}

function unitPhysicalPageNumbers(unit: PresentationUnit) {
  return unit.surfaces.flatMap((surface) =>
    typeof surface.pageNumber === "number" ? [surface.pageNumber] : []).sort((left, right) => left - right);
}

function unitContextLabel(unit: PresentationUnit, readingPosition: number) {
  if (unit.name?.trim()) return unit.name.trim();
  if (unit.pageRole === "cover") return "封面";
  const physicalPageNumbers = unitPhysicalPageNumbers(unit);
  if (physicalPageNumbers.length) {
    const range = physicalPageNumbers.length > 1
      ? `${physicalPageNumbers[0]}–${physicalPageNumbers.at(-1)}`
      : `${physicalPageNumbers[0]}`;
    return unit.pageRole === "interlude" ? `过场页 ${range}` : `Page ${range}`;
  }
  return unit.pageRole === "interlude" ? `过场页 ${readingPosition}` : `Page ${readingPosition}`;
}

function pageSequenceFor(document: ComicDocument) {
  return orderedDocumentUnits(document).map((unit, index) => ({
    readingPosition: index + 1,
    label: unitContextLabel(unit, index + 1),
    ...(unit.name?.trim() ? { name: unit.name.trim() } : {}),
    pageRole: unit.pageRole,
    kind: unit.kind,
    trueSpread: unit.kind === "spread",
    physicalPageNumbers: unitPhysicalPageNumbers(unit),
  }));
}

async function resolveContextRequestScope(
  ownerUserId: string,
  parsed: z.output<typeof externalContextGetInputSchema>,
) {
  if (parsed.projectId) return { projectId: parsed.projectId, focusPageId: undefined };
  const scope = await resolveResourceReference(ownerUserId, parsed.scope!);
  if (!scope.projectId) {
    throw new AppError("invalid_context_scope", "页面上下文需要明确到一话或创作空间。", 422);
  }
  return { projectId: scope.projectId, focusPageId: scope.focus?.id };
}

async function resolvePageLocators(
  document: ComicDocument,
  locators: z.infer<typeof externalPageLocatorSchema>[],
) {
  const pages = createComicPageViews(document);
  const unitById = new Map(document.units.map((unit) => [unit.id, unit]));
  return locators.map((locator) => {
    const matches = pages.filter((page) => {
      if (locator.position !== undefined) return page.pageIndex + 1 === locator.position;
      const unit = unitById.get(page.id);
      if (locator.physicalPageNumber !== undefined) {
        return unit?.surfaces.some((surface) => surface.pageNumber === locator.physicalPageNumber) ?? false;
      }
      const query = normalizedLocatorText(locator.name!);
      const physicalPageNumbers = unit ? unitPhysicalPageNumbers(unit) : [];
      const aliases = [
        page.name,
        `阅读顺序第${page.pageIndex + 1}项`,
        ...physicalPageNumbers.flatMap((pageNumber) => [
          `第${pageNumber}页`,
          `Page${String(pageNumber).padStart(2, "0")}`,
        ]),
        page.pageRole === "cover" ? "封面" : undefined,
        page.pageRole === "interlude" ? "过场页" : undefined,
      ].filter((value): value is string => Boolean(value));
      return aliases.some((alias) => normalizedLocatorText(alias) === query);
    });
    if (!matches.length) {
      throw new AppError("target_not_found", "没有在当前一话中找到指定页面。", 404, {
        locator,
        availablePages: pages.slice(0, 20).map((page) => ({
          readingPosition: page.pageIndex + 1,
          label: unitContextLabel(unitById.get(page.id)!, page.pageIndex + 1),
          physicalPageNumbers: unitPhysicalPageNumbers(unitById.get(page.id)!),
        })),
      });
    }
    if (matches.length > 1) {
      throw new AppError("ambiguous_target", "页面名称对应多个目标，请改用页面位置。", 409, {
        matches: matches.map((page) => ({
          readingPosition: page.pageIndex + 1,
          label: unitContextLabel(unitById.get(page.id)!, page.pageIndex + 1),
          physicalPageNumbers: unitPhysicalPageNumbers(unitById.get(page.id)!),
        })),
      });
    }
    return matches[0]!.id;
  });
}

async function loadExternalContextSource(
  ownerUserId: string,
  projectId: string,
  source: "working" | "latest_saved",
) {
  if (source === "latest_saved") {
    const snapshot = await prisma.savedSnapshot.findFirst({
      where: {
        projectId,
        ownerUserId,
        project: { chapter: { archivedAt: null, comic: { archivedAt: null } } },
      },
      orderBy: { createdAt: "desc" },
    });
    if (!snapshot) throw new AppError("not_found", "当前一话还没有已保存版本。", 404);
    const sourceWorking = await prisma.workingRevision.findUnique({
      where: { projectId_revision: { projectId, revision: snapshot.sourceWorkingRevision } },
      select: { id: true },
    });
    if (!sourceWorking) throw new AppError("not_found", "已保存版本的来源修订不存在。", 404);
    return {
      document: validateComicDocument(snapshot.document),
      revision: snapshot.sourceWorkingRevision,
      snapshotId: snapshot.id,
      source: {
        kind: "saved_snapshot" as const,
        snapshotId: snapshot.id,
        sourceWorkingRevision: snapshot.sourceWorkingRevision,
        createdAt: snapshot.createdAt.toISOString(),
      },
    };
  }
  const working = await prisma.workingRevision.findFirst({
    where: {
      projectId,
      project: { ownerUserId, chapter: { archivedAt: null, comic: { archivedAt: null } } },
    },
    orderBy: { revision: "desc" },
  });
  if (!working) throw new AppError("not_found", "工作稿不存在。", 404);
  return {
    document: validateComicDocument(working.document),
    revision: working.revision,
    source: {
      kind: "working" as const,
      workingRevision: working.revision,
      createdAt: working.createdAt.toISOString(),
    },
  };
}

export async function getExternalAgentContext(
  ownerUserId: string,
  input: z.input<typeof externalContextGetInputSchema>,
  options: { now?: number; lifetimeMs?: number } = {},
) {
  const parsed = externalContextGetInputSchema.parse(input);
  const resolvedScope = await resolveContextRequestScope(ownerUserId, parsed);
  const observationSource = await loadExternalContextSource(ownerUserId, resolvedScope.projectId, parsed.source);
  const explicitAssetReferences = await Promise.all((parsed.assets ?? []).map(async (reference) => {
    const resolved = await resolveResourceReference(ownerUserId, reference, "asset");
    const asset = await prisma.asset.findFirst({
      where: {
        id: resolved.id,
        ownerUserId,
        archivedAt: null,
        comic: { chapters: { some: { project: { id: resolvedScope.projectId } } } },
      },
      include: {
        images: {
          orderBy: [{ sortIndex: "asc" }, { createdAt: "asc" }, { id: "asc" }],
          take: 1,
        },
        versions: { orderBy: { version: "desc" }, take: 1 },
      },
    });
    const versionId = asset?.images[0]?.assetVersionId ?? asset?.versions[0]?.id;
    if (!asset || !versionId) {
      throw new AppError("invalid_image_context", "指定资产没有可读取的固定图片版本。", 422);
    }
    return { objectType: "asset" as const, objectId: asset.id, versionId, label: asset.name };
  }));
  const requestedPageIds = parsed.pages
    ? await resolvePageLocators(observationSource.document, parsed.pages)
    : parsed.pageIds ?? (parsed.pageId ? [parsed.pageId] : resolvedScope.focusPageId ? [resolvedScope.focusPageId] : []);
  const contextRequest = contextRequestForProfile(parsed.profile);
  const context = await buildAgentContext({
    ownerUserId,
    projectId: resolvedScope.projectId,
    workingRevision: observationSource.revision,
    taskType: contextRequest.taskType,
    instruction: "Read bounded context for an external Agent.",
    scope: contextRequest.scope,
    currentPageId: requestedPageIds[0],
    visiblePageIds: requestedPageIds.length ? requestedPageIds : undefined,
    selection: { type: "none", ...(requestedPageIds[0] ? { pageId: requestedPageIds[0] } : {}) },
    explicitReferences: explicitAssetReferences,
  });
  if (requestedPageIds.length && requestedPageIds.some((pageId) => !context.currentView?.unitIds.includes(pageId))) {
    throw new AppError("not_found", "目标页面不存在或不属于当前创作空间。", 404);
  }
  const document = observationSource.document;
  const orderedUnits = orderedDocumentUnits(document);
  const pageSequence = pageSequenceFor(document);
  const unitPosition = new Map(orderedUnits.map((unit, index) => [unit.id, index + 1]));
  const unitById = new Map(orderedUnits.map((unit) => [unit.id, unit]));
  const now = options.now ?? Date.now();
  const expiresAt = now + (options.lifetimeMs ?? defaultHandleLifetimeMs);
  const createHandle = (target: ExternalTargetHandlePayload["target"]) => createExternalTargetHandle({
    ownerUserId,
    projectId: resolvedScope.projectId,
    baseRevision: context.workingRevision,
    ...(observationSource.snapshotId ? { snapshotId: observationSource.snapshotId } : {}),
    expiresAt,
    target,
  });
  const visibleUnitIds = context.currentView?.unitIds ?? [];
  const pageHandleById = new Map<string, string>();
  const surfaceHandleById = new Map<string, string>();
  const pageTargets = context.currentPageTargets.map((target) => {
    const unit = unitById.get(target.pageId);
    const readingPosition = unitPosition.get(target.pageId);
    const physicalPageNumbers = unit ? unitPhysicalPageNumbers(unit) : [];
    const contextualPageLabel = unit && readingPosition ? unitContextLabel(unit, readingPosition) : target.pageLabel;
    const aliases = target.type === "presentation_unit"
      ? [...new Set([
          ...target.aliases.filter((alias) => !/^(?:第\d+页|Page\s*\d+)$/i.test(alias)),
          contextualPageLabel,
          ...(readingPosition ? [`阅读顺序第${readingPosition}项`] : []),
          ...physicalPageNumbers.flatMap((pageNumber) => [`第${pageNumber}页`, `Page ${String(pageNumber).padStart(2, "0")}`]),
          unit?.pageRole === "cover" ? "封面" : undefined,
          unit?.pageRole === "interlude" ? "过场页" : undefined,
        ].filter((value): value is string => Boolean(value)))].slice(0, 12)
      : target.aliases;
    const handle = createHandle({
      type: target.type,
      pageId: target.pageId,
      elementId: target.elementId,
      frameId: target.frameId,
      storyboardBeatId: target.storyboardBeatId,
      assetVersionIds: target.assetVersionIds,
      dialogueIds: target.dialogueIds,
    });
    if (target.type === "presentation_unit") pageHandleById.set(target.pageId, handle);
    return {
      handle,
      type: target.type,
      label: target.type === "presentation_unit" ? contextualPageLabel ?? target.label : target.label,
      aliases,
      summary: target.summary,
      pageId: target.pageId,
      pageLabel: contextualPageLabel,
      assetVersionIds: target.assetVersionIds,
    };
  });
  const surfaceTargets = visibleUnitIds.flatMap((unitId) => {
    const unit = unitById.get(unitId);
    const readingPosition = unitPosition.get(unitId);
    if (!unit || !readingPosition) return [];
    const pageLabel = unitContextLabel(unit, readingPosition);
    return unit.surfaces.map((surface) => {
      const roleLabel = surface.role === "left"
        ? "左页"
        : surface.role === "right"
          ? "右页"
          : surface.role === "single"
            ? "单页纸面"
            : "滚动段纸面";
      const label = surface.name?.trim() || (surface.pageNumber ? `第 ${surface.pageNumber} 页` : roleLabel);
      const aliases = [...new Set([
        label,
        roleLabel,
        `${pageLabel}${roleLabel}`,
        surface.pageNumber ? `第${surface.pageNumber}页` : undefined,
      ].filter((value): value is string => Boolean(value)))];
      const handle = createHandle({
        type: "page_surface",
        pageId: unit.id,
        surfaceId: surface.id,
        assetVersionIds: [],
        dialogueIds: [],
      });
      surfaceHandleById.set(surface.id, handle);
      return {
        handle,
        type: "page_surface",
        label,
        aliases,
        summary: `该纸面属于${pageLabel}，角色为 ${surface.role}。`,
        pageId: unit.id,
        pageLabel,
        surfaceRole: surface.role,
        assetVersionIds: [],
      };
    });
  });
  const targets = [
    ...pageTargets,
    ...surfaceTargets,
    ...context.assets.filter((asset) => asset.images.length > 0).flatMap((asset) => [
      {
        handle: createHandle({
          type: "asset",
          assetVersionIds: asset.images.map((image) => image.versionId),
          dialogueIds: [],
        }),
        type: "asset",
        label: asset.name,
        aliases: [asset.name],
        summary: asset.description,
        assetId: asset.id,
        assetKind: asset.kind,
        assetVersionIds: asset.images.map((image) => image.versionId),
      },
      ...asset.images.map((image, index) => ({
        handle: createHandle({
          type: "asset_version",
          assetVersionIds: [image.versionId],
          dialogueIds: [],
        }),
        type: "asset_version",
        label: `${asset.name} · ${image.isPrimary ? "主图" : `图片 ${index + 1}`}`,
        aliases: image.isPrimary ? [`${asset.name}主图`] : [`${asset.name}图片${index + 1}`],
        summary: `${asset.kind} 资产“${asset.name}”的固定图片版本。`,
        assetId: asset.id,
        assetVersionId: image.versionId,
        assetKind: asset.kind,
        isPrimary: image.isPrimary,
        assetVersionIds: [image.versionId],
      })),
    ]),
  ];
  const selectedPages = visibleUnitIds.flatMap((unitId) => {
    const unit = unitById.get(unitId);
    const readingPosition = unitPosition.get(unitId);
    const handle = pageHandleById.get(unitId);
    if (!unit || !readingPosition || !handle) return [];
    return [{
      ...pageSequence[readingPosition - 1]!,
      handle,
      canvas: { width: unit.canvas.width, height: unit.canvas.height },
      surfaces: unit.surfaces.map((surface) => ({
        handle: surfaceHandleById.get(surface.id)!,
        role: surface.role,
        ...(surface.name?.trim() ? { name: surface.name.trim() } : {}),
        ...(typeof surface.pageNumber === "number" ? { physicalPageNumber: surface.pageNumber } : {}),
        geometry: surface.geometry,
      })),
      surfaceReadingOrder: orderedUnitSurfaces(unit, document.reading.direction).map((surface) => surface.role),
      ...(readingPosition > 1 ? { previousReadingPosition: readingPosition - 1 } : {}),
      ...(readingPosition < orderedUnits.length ? { nextReadingPosition: readingPosition + 1 } : {}),
    }];
  });
  return externalContextGetOutputSchema.parse({
    projectId: context.projectId,
    scope: {
      comic: resourceReference("comic", context.comic.id).uri,
      chapter: resourceReference("chapter", context.chapter.id).uri,
      project: resourceReference("project", context.projectId).uri,
    },
    baseRevision: context.workingRevision,
    source: observationSource.source,
    profile: parsed.profile,
    expiresAt: new Date(expiresAt).toISOString(),
    comic: context.comic,
    chapter: context.chapter,
    readingDirection: document.reading.direction,
    pageSequence,
    pages: selectedPages,
    currentView: context.currentView ? {
      label: context.currentView.label,
      physicalPageNumbers: context.currentView.physicalPageNumbers,
    } : undefined,
    currentPage: context.currentPage,
    storyboardBeats: context.storyboardBeats,
    assets: context.assets,
    targets,
    omittedContext: context.omittedContext,
  });
}

async function resolveContextTargetHandles(
  ownerUserId: string,
  projectId: string | undefined,
  handles: string[],
  allowSavedSnapshot = false,
  now = Date.now(),
) {
  return resolveExternalTargetHandles({ ownerUserId, projectId, handles, allowSavedSnapshot, now });
}

export async function inspectExternalAgentImages(
  ownerUserId: string,
  input: z.input<typeof externalImagesInspectInputSchema>,
) {
  const parsed = externalImagesInspectInputSchema.parse(input);
  const resolved = await resolveContextTargetHandles(ownerUserId, parsed.projectId, parsed.targetHandles, true);
  const requested = resolved.decoded.flatMap(({ handle, payload }) =>
    payload.target.assetVersionIds.map((assetVersionId) => ({ handle, assetVersionId })));
  const uniqueRequested = [...new Map(requested.map((item) => [item.assetVersionId, item])).values()].slice(0, 3);
  if (!uniqueRequested.length) throw new AppError("invalid_image_context", "这些上下文目标没有可读取的图片。", 422);
  const versions = await prisma.assetVersion.findMany({
    where: {
      id: { in: uniqueRequested.map((item) => item.assetVersionId) },
      objectKey: { not: null },
      contentType: { in: ["image/png", "image/jpeg", "image/webp"] },
      asset: {
        ownerUserId,
        comic: { chapters: { some: { project: { id: resolved.projectId } } } },
      },
    },
    select: {
      id: true,
      assetId: true,
      objectKey: true,
      contentType: true,
      width: true,
      height: true,
    },
  });
  const versionById = new Map(versions.map((version) => [version.id, version]));
  const images = await Promise.all(uniqueRequested.map(async ({ handle, assetVersionId }) => {
    const version = versionById.get(assetVersionId);
    if (!version?.objectKey || !version.contentType) {
      throw new AppError("invalid_image_context", "没有找到可读取的固定图片版本。", 422, { assetVersionId });
    }
    return {
      handle,
      assetId: version.assetId,
      assetVersionId: version.id,
      mimeType: version.contentType as "image/png" | "image/jpeg" | "image/webp",
      ...(version.width ? { width: version.width } : {}),
      ...(version.height ? { height: version.height } : {}),
      bytes: await getObject(version.objectKey),
    };
  }));
  const output = externalImagesInspectOutputSchema.parse({
    projectId: resolved.projectId,
    baseRevision: resolved.workingRevision,
    source: resolved.source,
    images: images.map(({ bytes: _bytes, ...image }) => image),
  });
  return { output, images };
}

export async function inspectExternalAgentComposition(
  ownerUserId: string,
  input: z.input<typeof externalCompositionInspectInputSchema>,
) {
  const parsed = externalCompositionInspectInputSchema.parse(input);
  const resolved = await resolveContextTargetHandles(ownerUserId, parsed.projectId, parsed.pageHandles, true);
  if (resolved.decoded.some(({ payload }) => payload.target.type !== "presentation_unit" || !payload.target.pageId)) {
    throw new AppError("invalid_composition_context", "最终画面 Observation 只能使用页面或滚动段 handle。", 422);
  }
  const unitIds = resolved.decoded.map(({ payload }) => payload.target.pageId!);
  const composition = await loadWorkingCompositionObservation({
    ownerUserId,
    projectId: resolved.projectId,
    unitIds,
    expectedRevision: resolved.workingRevision,
    ...(resolved.source.kind === "saved_snapshot" ? { snapshotId: resolved.source.snapshotId } : {}),
  });
  const pageHandleById = new Map(resolved.decoded.map(({ handle, payload }) => [payload.target.pageId!, handle]));
  const expiresAt = Math.min(...resolved.decoded.map(({ payload }) => payload.expiresAt));
  const createHandle = (target: ExternalTargetHandlePayload["target"]) => createExternalTargetHandle({
    ownerUserId,
    projectId: resolved.projectId,
    baseRevision: resolved.workingRevision,
    ...(resolved.source.kind === "saved_snapshot" ? { snapshotId: resolved.source.snapshotId } : {}),
    expiresAt,
    target,
  });
  const structure = compositionStructureSchema.parse({
    ...composition.structure,
    units: composition.structure.units.map((unit) => ({
      ...unit,
      handle: pageHandleById.get(unit.id),
      frames: unit.frames.map((frame) => {
        const frameElements = unit.elements.filter((element) => element.frameId === frame.id);
        return {
          ...frame,
          handle: createHandle({
            type: "comic_frame",
            pageId: unit.id,
            elementId: frame.id,
            frameId: frame.id,
            assetVersionIds: [...new Set(frameElements.flatMap((element) => [element.assetVersionId, element.appearanceAssetVersionId].filter((id): id is string => Boolean(id))))].slice(0, 12),
            dialogueIds: [...new Set(frameElements.flatMap((element) => element.dialogueId ? [element.dialogueId] : []))].slice(0, 12),
          }),
        };
      }),
      elements: unit.elements.map((element) => ({
        ...element,
        handle: createHandle({
          type: element.kind === "balloon" ? "speech_balloon" : element.kind,
          pageId: unit.id,
          elementId: element.id,
          frameId: element.frameId,
          assetVersionIds: [element.assetVersionId, element.appearanceAssetVersionId].filter((id): id is string => Boolean(id)),
          dialogueIds: element.dialogueId ? [element.dialogueId] : [],
        }),
      })),
    })),
  });
  return {
    output: externalCompositionInspectOutputSchema.parse({
      type: "composition_evidence",
      projectId: composition.projectId,
      baseRevision: composition.baseRevision,
      source: composition.source,
      unitIds: composition.structure.units.map((unit) => unit.id),
      image: {
        mimeType: composition.image.mimeType,
        width: composition.image.width,
        height: composition.image.height,
      },
      structure,
    }),
    image: composition.image,
  };
}

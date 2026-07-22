import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { getConfig } from "@lantern/server/config";
import { prisma } from "@lantern/server/db";
import { AppError } from "@lantern/server/errors";
import {
  archiveComic,
  archiveComicChapter,
  createComic,
  createComicChapter,
  duplicateComic,
  getComic,
  getComicChapter,
  listComics,
  updateComic,
  updateComicChapter,
} from "@lantern/server/comic-service";
import {
  archiveAssetFamily,
  createComicLibraryAsset,
  getAssetFamilyDetail,
  listComicAssetCards,
  updateAsset,
} from "@lantern/server/asset-library-service";
import { resolveResourceReference, resourceReference } from "@lantern/server/resource-reference-service";
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
import { analyzeImageVersions } from "./visual-context";

export const externalContextProfiles = [
  "visual_observation",
  "single_frame_generation",
  "asset_generation",
] as const satisfies readonly AgentCapabilityContextProfile[];

export const externalProjectsListInputSchema = z.strictObject({});

export const externalContextGetInputSchema = z.strictObject({
  projectId: z.string().min(1),
  profile: z.enum(externalContextProfiles).default("visual_observation"),
  pageId: z.string().min(1).optional(),
});

export const externalCapabilitiesListInputSchema = z.strictObject({});

export const externalImagesInspectInputSchema = z.strictObject({
  projectId: z.string().min(1),
  targetHandles: z.array(z.string().min(1).max(4096)).min(1).max(3),
  instruction: z.string().trim().min(1).max(2000).optional(),
});

const externalTargetHandlePayloadSchema = z.strictObject({
  version: z.literal(1),
  ownerUserId: z.string().min(1),
  projectId: z.string().min(1),
  baseRevision: z.number().int().positive(),
  expiresAt: z.number().int().positive(),
  nonce: z.string().min(16),
  target: z.strictObject({
    type: z.string().min(1),
    pageId: z.string().min(1).optional(),
    elementId: z.string().min(1).optional(),
    frameId: z.string().min(1).optional(),
    storyboardBeatId: z.string().min(1).optional(),
    assetVersionIds: z.array(z.string().min(1)).max(12),
    dialogueIds: z.array(z.string().min(1)).max(12),
  }),
});

type ExternalTargetHandlePayload = z.infer<typeof externalTargetHandlePayloadSchema>;

export const externalProjectsListOutputSchema = z.object({
  projects: z.array(z.object({
    projectId: z.string(),
    comic: z.object({ id: z.string(), title: z.string(), format: z.string(), readingDirection: z.string() }),
    chapter: z.object({ id: z.string(), number: z.number().int(), title: z.string(), summary: z.string() }),
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
  summary: z.string(),
  pageId: z.string().optional(),
  pageLabel: z.string().optional(),
  assetVersionIds: z.array(z.string()),
});

export const externalContextGetOutputSchema = z.object({
  projectId: z.string(),
  baseRevision: z.number().int().positive(),
  profile: z.enum(externalContextProfiles),
  expiresAt: z.string(),
  comic: z.object({
    id: z.string(),
    title: z.string(),
    summary: z.string(),
    worldSummary: z.string(),
    format: z.string(),
    readingDirection: z.string(),
    styleSummary: z.string(),
    settings: z.array(z.object({ id: z.string(), title: z.string(), content: z.string() })),
  }),
  chapter: z.object({ id: z.string(), title: z.string(), summary: z.string() }),
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
  observation: z.object({ type: z.literal("visual_evidence"), content: z.string() }),
  evidence: z.array(z.object({ handle: z.string(), assetVersionIds: z.array(z.string()) })),
});

const handlePrefix = "lctx1";
const handleAdditionalData = Buffer.from("lantern-context-handle-v1", "utf8");
const defaultHandleLifetimeMs = 15 * 60 * 1000;

function handleKey(secret: string) {
  return createHash("sha256").update(`lantern-context-handle:${secret}`).digest();
}

function encodeContextTargetHandle(payload: ExternalTargetHandlePayload, secret = getConfig().LANTERN_MCP_TOKEN) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", handleKey(secret), iv);
  cipher.setAAD(handleAdditionalData);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return [handlePrefix, iv.toString("base64url"), encrypted.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
}

function decodeContextTargetHandle(handle: string, secret = getConfig().LANTERN_MCP_TOKEN) {
  try {
    const [prefix, ivValue, encryptedValue, tagValue, extra] = handle.split(".");
    if (prefix !== handlePrefix || !ivValue || !encryptedValue || !tagValue || extra) throw new Error("INVALID_HANDLE_SHAPE");
    const decipher = createDecipheriv("aes-256-gcm", handleKey(secret), Buffer.from(ivValue, "base64url"));
    decipher.setAAD(handleAdditionalData);
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    const decoded = Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64url")), decipher.final()]).toString("utf8");
    return externalTargetHandlePayloadSchema.parse(JSON.parse(decoded));
  } catch {
    throw new AppError("invalid_context_handle", "上下文目标已失效，请重新读取 Lantern 上下文。", 422);
  }
}

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
      comic: {
        id: project.chapter.comic.id,
        title: project.chapter.comic.title,
        format: project.chapter.comic.format.toLowerCase(),
        readingDirection: project.chapter.comic.readingDirection,
      },
      chapter: {
        id: project.chapter.id,
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
      && (capability.effect === "observe" || isResourceCapabilityId(capability.id))),
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
    const created = await createComicChapter(ownerUserId, comic.id, { title: argument(parsed, "title"), summary: argument(parsed, "summary") });
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

function contextRequestForProfile(profile: AgentCapabilityContextProfile) {
  return profile === "asset_generation"
    ? { taskType: "asset_parse", scope: "reference_only" }
    : { taskType: "interaction", scope: "current_page" };
}

export async function getExternalAgentContext(
  ownerUserId: string,
  input: z.input<typeof externalContextGetInputSchema>,
  options: { now?: number; lifetimeMs?: number } = {},
) {
  const parsed = externalContextGetInputSchema.parse(input);
  const contextRequest = contextRequestForProfile(parsed.profile);
  const context = await buildAgentContext({
    ownerUserId,
    projectId: parsed.projectId,
    taskType: contextRequest.taskType,
    instruction: "Read bounded context for an external Agent.",
    scope: contextRequest.scope,
    currentPageId: parsed.pageId,
    visiblePageIds: parsed.pageId ? [parsed.pageId] : undefined,
    selection: { type: "none", ...(parsed.pageId ? { pageId: parsed.pageId } : {}) },
  });
  if (parsed.pageId && context.currentPage?.id !== parsed.pageId) {
    throw new AppError("not_found", "目标页面不存在或不属于当前创作空间。", 404);
  }
  const now = options.now ?? Date.now();
  const expiresAt = now + (options.lifetimeMs ?? defaultHandleLifetimeMs);
  const createHandle = (target: ExternalTargetHandlePayload["target"]) => encodeContextTargetHandle({
    version: 1,
    ownerUserId,
    projectId: parsed.projectId,
    baseRevision: context.workingRevision,
    expiresAt,
    nonce: randomBytes(12).toString("base64url"),
    target,
  });
  const targets = [
    ...context.currentPageTargets.map((target) => ({
      handle: createHandle({
        type: target.type,
        pageId: target.pageId,
        elementId: target.elementId,
        frameId: target.frameId,
        storyboardBeatId: target.storyboardBeatId,
        assetVersionIds: target.assetVersionIds,
        dialogueIds: target.dialogueIds,
      }),
      type: target.type,
      label: target.label,
      summary: target.summary,
      pageId: target.pageId,
      pageLabel: target.pageLabel,
      assetVersionIds: target.assetVersionIds,
    })),
    ...context.assets.filter((asset) => asset.images.length > 0).map((asset) => ({
      handle: createHandle({
        type: "asset",
        assetVersionIds: asset.images.map((image) => image.versionId),
        dialogueIds: [],
      }),
      type: "asset",
      label: asset.name,
      summary: asset.description,
      assetVersionIds: asset.images.map((image) => image.versionId),
    })),
  ];
  return externalContextGetOutputSchema.parse({
    projectId: context.projectId,
    baseRevision: context.workingRevision,
    profile: parsed.profile,
    expiresAt: new Date(expiresAt).toISOString(),
    comic: context.comic,
    chapter: context.chapter,
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
  projectId: string,
  handles: string[],
  now = Date.now(),
) {
  const decoded = handles.map((handle) => ({ handle, payload: decodeContextTargetHandle(handle) }));
  if (decoded.some(({ payload }) => payload.ownerUserId !== ownerUserId || payload.projectId !== projectId)) {
    throw new AppError("invalid_context_handle", "上下文目标不属于当前创作空间。", 403);
  }
  if (decoded.some(({ payload }) => payload.expiresAt <= now)) {
    throw new AppError("context_handle_expired", "上下文目标已过期，请重新读取 Lantern 上下文。", 409);
  }
  const working = await prisma.workingRevision.findFirst({
    where: { projectId, project: { ownerUserId } },
    orderBy: { revision: "desc" },
    select: { revision: true },
  });
  if (!working) throw new AppError("not_found", "工作稿不存在。", 404);
  if (decoded.some(({ payload }) => payload.baseRevision !== working.revision)) {
    throw new AppError("context_stale", "工作稿已经变化，请重新读取 Lantern 上下文。", 409, { currentRevision: working.revision });
  }
  return { workingRevision: working.revision, decoded };
}

export async function inspectExternalAgentImages(
  ownerUserId: string,
  input: z.input<typeof externalImagesInspectInputSchema>,
  analyze: typeof analyzeImageVersions = analyzeImageVersions,
) {
  const parsed = externalImagesInspectInputSchema.parse(input);
  const resolved = await resolveContextTargetHandles(ownerUserId, parsed.projectId, parsed.targetHandles);
  const evidence = resolved.decoded.map(({ handle, payload }) => ({
    handle,
    assetVersionIds: payload.target.assetVersionIds,
  }));
  const versionIds = [...new Set(evidence.flatMap((item) => item.assetVersionIds))].slice(0, 3);
  if (!versionIds.length) throw new AppError("invalid_image_context", "这些上下文目标没有可读取的图片。", 422);
  const content = await analyze({
    ownerUserId,
    projectId: parsed.projectId,
    message: parsed.instruction ?? "准确描述这些图片中可见的内容和文字。",
    versionIds,
  });
  if (!content) throw new AppError("invalid_image_context", "没有找到可读取的图片版本。", 422);
  return externalImagesInspectOutputSchema.parse({
    projectId: parsed.projectId,
    baseRevision: resolved.workingRevision,
    observation: { type: "visual_evidence", content },
    evidence,
  });
}

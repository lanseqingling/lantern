import { getConfig } from "./config";
import { prisma } from "./db";
import { AppError } from "./errors";
import { validateComicDocument } from "@lantern/shared";

export const lanternResourceTypes = ["comic", "chapter", "project", "asset", "candidate", "annotation"] as const;
export type LanternResourceType = typeof lanternResourceTypes[number];

export type ResolvedResourceReference = {
  type: LanternResourceType;
  id: string;
  canonicalUri: string;
  displayName: string;
  comicId?: string;
  chapterId?: string;
  projectId?: string;
  workingRevision?: number;
  focus?: {
    type: "presentation_unit";
    id: string;
  };
};

type ParsedReference = {
  type: LanternResourceType;
  id: string;
  expectedComicId?: string;
  focusPageId?: string;
};

export type ResourceScopeLocator = {
  reference?: string;
  comicTitle?: string;
  chapterTitle?: string;
  chapterNumber?: number;
};

function canonicalUri(type: LanternResourceType, id: string) {
  return `lantern://${type === "comic" ? "comics" : `${type}s`}/${encodeURIComponent(id)}`;
}

function parseCanonicalReference(reference: string): ParsedReference | undefined {
  let url: URL;
  try {
    url = new URL(reference);
  } catch {
    return undefined;
  }
  if (url.protocol !== "lantern:") return undefined;
  const type = ({ comics: "comic", chapters: "chapter", projects: "project", assets: "asset", candidates: "candidate", annotations: "annotation" } as const)[url.hostname];
  const [id, extra] = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (!type || !id || extra || url.search || url.hash) return undefined;
  return { type, id };
}

function isLoopbackHostname(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function parseBrowserReference(reference: string): ParsedReference | undefined {
  let url: URL;
  try {
    url = new URL(reference);
  } catch {
    return undefined;
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || !isLoopbackHostname(url.hostname)) return undefined;
  const configuredPort = String(getConfig().WEB_PORT);
  const effectivePort = url.port || (url.protocol === "https:" ? "443" : "80");
  if (effectivePort !== configuredPort) return undefined;
  const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (segments[0] !== "comics" || !segments[1]) return undefined;
  const comicId = segments[1];
  if (segments.length === 2) return { type: "comic", id: comicId };
  if (segments[2] === "chapters" && segments[3] && segments.length === 4) {
    return {
      type: "chapter",
      id: segments[3],
      expectedComicId: comicId,
      ...(url.searchParams.get("pageId") ? { focusPageId: url.searchParams.get("pageId")! } : {}),
    };
  }
  if (segments[2] === "assets" && segments.length === 3) {
    const assetId = url.searchParams.get("asset");
    if (assetId) return { type: "asset", id: assetId, expectedComicId: comicId };
  }
  return undefined;
}

function invalidReference() {
  return new AppError(
    "invalid_resource_reference",
    "资源引用无效。请使用 Lantern 返回的 lantern:// URI 或当前本地 Lantern 页面链接。",
    422,
  );
}

function notFound(type: LanternResourceType) {
  const label = ({ comic: "漫画", chapter: "章节", project: "创作空间", asset: "资产", candidate: "候选", annotation: "批注" } as const)[type];
  return new AppError("not_found", `${label}不存在或不属于当前用户。`, 404);
}

async function latestWorking(projectId: string) {
  return prisma.workingRevision.findFirst({
    where: { projectId },
    orderBy: { revision: "desc" },
    select: { revision: true, document: true },
  });
}

function focusFromWorking(
  focusPageId: string | undefined,
  working: Awaited<ReturnType<typeof latestWorking>> | undefined,
) {
  if (!focusPageId) return undefined;
  if (!working || !validateComicDocument(working.document).units.some((unit) => unit.id === focusPageId)) {
    throw new AppError("target_not_found", "链接指向的页面不存在或已经变化。", 404);
  }
  return { type: "presentation_unit" as const, id: focusPageId };
}

export async function resolveResourceReference(
  ownerUserId: string,
  reference: string,
  expectedType?: LanternResourceType,
): Promise<ResolvedResourceReference> {
  const normalized = reference.trim();
  const parsed = parseCanonicalReference(normalized) ?? parseBrowserReference(normalized);
  if (!parsed || (expectedType && parsed.type !== expectedType)) throw invalidReference();

  if (parsed.type === "comic") {
    const comic = await prisma.comic.findFirst({
      where: { id: parsed.id, ownerUserId, archivedAt: null },
      select: { id: true, title: true },
    });
    if (!comic) throw notFound(parsed.type);
    return { type: "comic", id: comic.id, canonicalUri: canonicalUri("comic", comic.id), displayName: comic.title, comicId: comic.id };
  }

  if (parsed.type === "chapter") {
    const chapter = await prisma.chapter.findFirst({
      where: { id: parsed.id, ownerUserId, archivedAt: null, comic: { archivedAt: null } },
      select: { id: true, title: true, number: true, comicId: true, project: { select: { id: true } } },
    });
    if (!chapter || (parsed.expectedComicId && parsed.expectedComicId !== chapter.comicId)) throw notFound(parsed.type);
    const projectId = chapter.project?.id;
    const working = projectId ? await latestWorking(projectId) : undefined;
    return {
      type: "chapter",
      id: chapter.id,
      canonicalUri: canonicalUri("chapter", chapter.id),
      displayName: `第 ${chapter.number} 话 ${chapter.title}`.trim(),
      comicId: chapter.comicId,
      chapterId: chapter.id,
      projectId,
      workingRevision: working?.revision,
      focus: focusFromWorking(parsed.focusPageId, working),
    };
  }

  if (parsed.type === "project") {
    const project = await prisma.project.findFirst({
      where: { id: parsed.id, ownerUserId, chapter: { archivedAt: null, comic: { archivedAt: null } } },
      select: { id: true, chapter: { select: { id: true, title: true, number: true, comicId: true } } },
    });
    if (!project) throw notFound(parsed.type);
    const working = await latestWorking(project.id);
    return {
      type: "project",
      id: project.id,
      canonicalUri: canonicalUri("project", project.id),
      displayName: `第 ${project.chapter.number} 话 ${project.chapter.title}`.trim(),
      comicId: project.chapter.comicId,
      chapterId: project.chapter.id,
      projectId: project.id,
      workingRevision: working?.revision,
    };
  }

  if (parsed.type === "asset") {
    const asset = await prisma.asset.findFirst({
      where: { id: parsed.id, ownerUserId, archivedAt: null, comic: { archivedAt: null } },
      select: { id: true, name: true, comicId: true },
    });
    if (!asset || (parsed.expectedComicId && parsed.expectedComicId !== asset.comicId)) throw notFound(parsed.type);
    return {
      type: "asset",
      id: asset.id,
      canonicalUri: canonicalUri("asset", asset.id),
      displayName: asset.name,
      comicId: asset.comicId,
    };
  }

  if (parsed.type === "annotation") {
    const annotation = await prisma.artworkAnnotation.findFirst({
      where: {
        id: parsed.id,
        ownerUserId,
        project: { chapter: { archivedAt: null, comic: { archivedAt: null } } },
      },
      select: {
        id: true,
        projectId: true,
        project: { select: { chapter: { select: { id: true, comicId: true } } } },
      },
    });
    if (!annotation) throw notFound(parsed.type);
    const working = await latestWorking(annotation.projectId);
    return {
      type: "annotation",
      id: annotation.id,
      canonicalUri: canonicalUri("annotation", annotation.id),
      displayName: "作品批注",
      comicId: annotation.project.chapter.comicId,
      chapterId: annotation.project.chapter.id,
      projectId: annotation.projectId,
      workingRevision: working?.revision,
    };
  }

  const candidate = await prisma.candidate.findFirst({
    where: {
      id: parsed.id,
      ownerUserId,
      project: { chapter: { archivedAt: null, comic: { archivedAt: null } } },
    },
    select: {
      id: true,
      title: true,
      projectId: true,
      project: { select: { chapter: { select: { id: true, comicId: true } } } },
    },
  });
  if (!candidate) throw notFound(parsed.type);
  const working = await latestWorking(candidate.projectId);
  return {
    type: "candidate",
    id: candidate.id,
    canonicalUri: canonicalUri("candidate", candidate.id),
    displayName: candidate.title,
    comicId: candidate.project.chapter.comicId,
    chapterId: candidate.project.chapter.id,
    projectId: candidate.projectId,
    workingRevision: working?.revision,
  };
}

export function resourceReference(type: LanternResourceType, id: string) {
  return { type, id, uri: canonicalUri(type, id) };
}

function ambiguousLocator(
  message: string,
  candidates: Array<{ type: LanternResourceType; id: string; label: string }>,
) {
  return new AppError("ambiguous_resource_locator", message, 409, {
    candidates: candidates.map((candidate) => ({
      type: candidate.type,
      label: candidate.label,
      uri: canonicalUri(candidate.type, candidate.id),
    })),
  });
}

export async function resolveResourceScope(
  ownerUserId: string,
  locator: ResourceScopeLocator,
): Promise<ResolvedResourceReference> {
  const reference = locator.reference?.trim();
  const comicTitle = locator.comicTitle?.trim();
  const chapterTitle = locator.chapterTitle?.trim();
  const chapterNumber = locator.chapterNumber;
  let comicId: string | undefined;

  if (reference) {
    if (comicTitle) {
      throw new AppError("invalid_resource_locator", "已有 Lantern 引用时不要同时提供漫画名称。", 422);
    }
    const resolved = await resolveResourceReference(ownerUserId, reference);
    if (resolved.type === "asset" || resolved.type === "candidate" || resolved.type === "annotation") throw invalidReference();
    if (resolved.type !== "comic") {
      if (chapterTitle !== undefined || chapterNumber !== undefined) {
        throw new AppError("invalid_resource_locator", "一话或创作空间引用不能再附加另一话定位条件。", 422);
      }
      return resolved;
    }
    if (chapterTitle === undefined && chapterNumber === undefined) return resolved;
    comicId = resolved.id;
  } else {
    if (!comicTitle) {
      throw new AppError(
        "invalid_resource_locator",
        "请提供 Lantern 资源引用，或提供准确的漫画名称。",
        422,
      );
    }
    const comics = await prisma.comic.findMany({
      where: { ownerUserId, archivedAt: null, title: comicTitle },
      select: { id: true, title: true },
      orderBy: { updatedAt: "desc" },
      take: 6,
    });
    if (!comics.length) throw notFound("comic");
    if (comics.length > 1) {
      throw ambiguousLocator(
        "找到多部同名漫画，请使用返回的 Lantern 引用明确目标。",
        comics.map((comic) => ({ type: "comic", id: comic.id, label: comic.title })),
      );
    }
    comicId = comics[0]!.id;
  }

  if (chapterTitle === undefined && chapterNumber === undefined) {
    return resolveResourceReference(ownerUserId, canonicalUri("comic", comicId), "comic");
  }

  const chapters = await prisma.chapter.findMany({
    where: {
      ownerUserId,
      comicId,
      archivedAt: null,
      comic: { archivedAt: null },
      ...(chapterTitle !== undefined ? { title: chapterTitle } : {}),
      ...(chapterNumber !== undefined ? { number: chapterNumber } : {}),
    },
    select: { id: true, title: true, number: true },
    orderBy: [{ number: "asc" }, { createdAt: "asc" }],
    take: 6,
  });
  if (!chapters.length) throw notFound("chapter");
  if (chapters.length > 1) {
    throw ambiguousLocator(
      "找到多个符合条件的一话，请使用返回的 Lantern 引用明确目标。",
      chapters.map((chapter) => ({
        type: "chapter",
        id: chapter.id,
        label: `第 ${chapter.number} 话 ${chapter.title}`.trim(),
      })),
    );
  }
  return resolveResourceReference(ownerUserId, canonicalUri("chapter", chapters[0]!.id), "chapter");
}

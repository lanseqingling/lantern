import { getConfig } from "./config";
import { prisma } from "./db";
import { AppError } from "./errors";

export const lanternResourceTypes = ["comic", "chapter", "project", "asset"] as const;
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
};

type ParsedReference = {
  type: LanternResourceType;
  id: string;
  expectedComicId?: string;
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
  const type = ({ comics: "comic", chapters: "chapter", projects: "project", assets: "asset" } as const)[url.hostname];
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
    return { type: "chapter", id: segments[3], expectedComicId: comicId };
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
  const label = ({ comic: "漫画", chapter: "章节", project: "创作空间", asset: "资产" } as const)[type];
  return new AppError("not_found", `${label}不存在或不属于当前用户。`, 404);
}

async function latestWorkingRevision(projectId: string) {
  return (await prisma.workingRevision.findFirst({
    where: { projectId },
    orderBy: { revision: "desc" },
    select: { revision: true },
  }))?.revision;
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
    return {
      type: "chapter",
      id: chapter.id,
      canonicalUri: canonicalUri("chapter", chapter.id),
      displayName: `第 ${chapter.number} 话 ${chapter.title}`.trim(),
      comicId: chapter.comicId,
      chapterId: chapter.id,
      projectId,
      workingRevision: projectId ? await latestWorkingRevision(projectId) : undefined,
    };
  }

  if (parsed.type === "project") {
    const project = await prisma.project.findFirst({
      where: { id: parsed.id, ownerUserId, chapter: { archivedAt: null, comic: { archivedAt: null } } },
      select: { id: true, chapter: { select: { id: true, title: true, number: true, comicId: true } } },
    });
    if (!project) throw notFound(parsed.type);
    return {
      type: "project",
      id: project.id,
      canonicalUri: canonicalUri("project", project.id),
      displayName: `第 ${project.chapter.number} 话 ${project.chapter.title}`.trim(),
      comicId: project.chapter.comicId,
      chapterId: project.chapter.id,
      projectId: project.id,
      workingRevision: await latestWorkingRevision(project.id),
    };
  }

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

export function resourceReference(type: LanternResourceType, id: string) {
  return { type, id, uri: canonicalUri(type, id) };
}

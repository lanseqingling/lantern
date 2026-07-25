import { randomUUID } from "node:crypto";
import { AssetKind, AssetLibraryStatus, ComicFormat, CreationStatus, ReadingDirection, TaskStatus, type Comic, type Prisma } from "@prisma/client";
import { validateComicDocument, type ComicDocument } from "@lantern/shared";
import { attachExternalAssetImage } from "./asset-library-service";
import { createUploadedAsset, type UploadedImage } from "./asset-service";
import { prisma } from "./db";
import { AppError } from "./errors";
import { renderPagePng } from "./export-renderer";
import { prepareExternalAssetUpload } from "./external-upload-service";
import { getObject, putImage } from "./object-storage";
import { setChapterCoverPageImage } from "./workbench-service";

type ComicListCursor = { updatedAt: string; id: string };
type ChapterWithWorking = Prisma.ChapterGetPayload<{
  include: {
    project: {
      select: {
        workingRevisions: {
          select: { revision: true; document: true };
        };
      };
    };
  };
}>;
type ComicWithChapters = Comic & { chapters: ChapterWithWorking[] };

const activeDeletionTaskStatuses = [TaskStatus.CREATED, TaskStatus.QUEUED, TaskStatus.RUNNING];

function comicCoverPath(comic: { id: string; coverObjectKey: string | null; updatedAt: Date }) {
  return comic.coverObjectKey ? `/v1/comics/${encodeURIComponent(comic.id)}/cover?v=${comic.updatedAt.getTime()}` : undefined;
}

function workingRevisionHasCover(working?: { document: Prisma.JsonValue }) {
  if (!working) return false;
  try {
    return validateComicDocument(structuredClone(working.document)).units.some((unit) => unit.pageRole === "cover");
  } catch {
    return false;
  }
}

function chapterCoverPath(chapter: {
  id: string;
  coverObjectKey: string | null;
  updatedAt: Date;
  project?: { workingRevisions: Array<{ revision: number; document: Prisma.JsonValue }> } | null;
}) {
  const working = chapter.project?.workingRevisions[0];
  if (working && workingRevisionHasCover(working)) {
    return `/v1/chapters/${encodeURIComponent(chapter.id)}/cover?v=${working.revision}`;
  }
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
    defaultReadingDirection: comic.defaultReadingDirection.toLowerCase(),
    status: comic.status.toLowerCase(),
    isExample: comic.isExample,
    coverUrl: comicCoverPath(comic),
    chapters: comic.chapters.map((chapter) => ({ id: chapter.id, number: chapter.number, title: chapter.title, summary: chapter.summary, status: chapter.status.toLowerCase(), coverUrl: chapterCoverPath(chapter), updatedAt: chapter.updatedAt.toISOString() })),
    updatedAt: comic.updatedAt.toISOString(),
  };
}

export async function listComics(ownerUserId: string, input: { cursor?: string; limit?: number } = {}) {
  const cursor = decodeComicCursor(input.cursor);
  const limit = Math.min(50, Math.max(1, input.limit ?? 20));
  const comics = await prisma.comic.findMany({
    where: {
      ownerUserId,
      archivedAt: null,
      ...(cursor ? { OR: [{ updatedAt: { lt: new Date(cursor.updatedAt) } }, { updatedAt: new Date(cursor.updatedAt), id: { lt: cursor.id } }] } : {}),
    },
    include: {
      chapters: {
        where: { archivedAt: null },
        orderBy: { number: "asc" },
        include: {
          project: {
            select: {
              workingRevisions: {
                orderBy: { revision: "desc" },
                take: 1,
                select: { revision: true, document: true },
              },
            },
          },
        },
      },
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  });
  const hasMore = comics.length > limit;
  const page = comics.slice(0, limit);
  return { items: page.map(publicComic), nextCursor: hasMore ? encodeComicCursor(page.at(-1)!) : null };
}

export async function getComic(ownerUserId: string, comicId: string) {
  const comic = await prisma.comic.findFirst({
    where: { id: comicId, ownerUserId, archivedAt: null },
    include: {
      chapters: {
        where: { archivedAt: null },
        orderBy: { number: "asc" },
        include: {
          project: {
            select: {
              workingRevisions: {
                orderBy: { revision: "desc" },
                take: 1,
                select: { revision: true, document: true },
              },
            },
          },
        },
      },
    },
  });
  if (!comic) throw new AppError("not_found", "漫画不存在。", 404);
  return publicComic(comic);
}

export async function getComicChapter(ownerUserId: string, chapterId: string) {
  const chapter = await prisma.chapter.findFirst({
    where: { id: chapterId, ownerUserId, archivedAt: null, comic: { archivedAt: null } },
    include: { project: { select: { id: true, workingRevisions: { orderBy: { revision: "desc" }, take: 1, select: { revision: true, document: true } } } } },
  });
  if (!chapter) throw new AppError("not_found", "章节不存在。", 404);
  return {
    id: chapter.id,
    comicId: chapter.comicId,
    number: chapter.number,
    title: chapter.title,
    summary: chapter.summary,
    status: chapter.status.toLowerCase(),
    coverUrl: chapterCoverPath(chapter),
    projectId: chapter.project?.id,
    workingRevision: chapter.project?.workingRevisions[0]?.revision,
    updatedAt: chapter.updatedAt.toISOString(),
  };
}

export async function createComic(ownerUserId: string, input: { title: string; summary?: string; worldSummary?: string; styleSummary?: string; format: "page" | "vertical" | "four_panel"; defaultReadingDirection?: "ltr" | "rtl" }) {
  const format = ({ page: ComicFormat.PAGE, vertical: ComicFormat.VERTICAL, four_panel: ComicFormat.FOUR_PANEL } as const)[input.format];
  const comic = await prisma.comic.create({ data: { ownerUserId, title: input.title, summary: input.summary ?? "", worldSummary: input.worldSummary ?? "", styleSummary: input.styleSummary ?? "", format, defaultReadingDirection: input.defaultReadingDirection === "rtl" ? ReadingDirection.RTL : ReadingDirection.LTR } });
  return { comic: { id: comic.id, title: comic.title } };
}

export async function updateComic(ownerUserId: string, comicId: string, input: { title?: string; summary?: string; worldSummary?: string; styleSummary?: string; defaultReadingDirection?: "ltr" | "rtl"; status?: "in_progress" | "completed" }) {
  const comic = await prisma.comic.findFirst({ where: { id: comicId, ownerUserId, archivedAt: null } });
  if (!comic) throw new AppError("not_found", "漫画不存在。", 404);
  if (comic.isExample && input.status !== undefined && input.status !== comic.status.toLowerCase()) throw new AppError("validation", "示例漫画的创作阶段不可修改。", 400);
  return prisma.comic.update({ where: { id: comic.id }, data: { ...(input.title !== undefined ? { title: input.title } : {}), ...(input.summary !== undefined ? { summary: input.summary } : {}), ...(input.worldSummary !== undefined ? { worldSummary: input.worldSummary } : {}), ...(input.styleSummary !== undefined ? { styleSummary: input.styleSummary } : {}), ...(input.defaultReadingDirection !== undefined ? { defaultReadingDirection: input.defaultReadingDirection === "rtl" ? ReadingDirection.RTL : ReadingDirection.LTR } : {}), ...(input.status !== undefined ? { status: input.status === "completed" ? CreationStatus.COMPLETED : CreationStatus.IN_PROGRESS } : {}) } });
}

export async function getComicCover(ownerUserId: string, comicId: string) {
  const comic = await prisma.comic.findFirst({ where: { id: comicId, ownerUserId, archivedAt: null } });
  if (!comic?.coverObjectKey || !comic.coverContentType) throw new AppError("not_found", "漫画封面不存在。", 404);
  return { bytes: await getObject(comic.coverObjectKey), contentType: comic.coverContentType };
}

export async function getComicCoverMetadata(ownerUserId: string, comicId: string) {
  const comic = await prisma.comic.findFirst({
    where: { id: comicId, ownerUserId, archivedAt: null },
    select: {
      id: true,
      coverObjectKey: true,
      coverContentType: true,
      coverWidth: true,
      coverHeight: true,
      updatedAt: true,
    },
  });
  if (!comic) throw new AppError("not_found", "漫画不存在。", 404);
  return {
    coverUrl: comicCoverPath(comic),
    contentType: comic.coverContentType ?? undefined,
    width: comic.coverWidth ?? undefined,
    height: comic.coverHeight ?? undefined,
  };
}

async function ensureComicCoverAsset(ownerUserId: string, comicId: string) {
  const comic = await prisma.comic.findFirst({
    where: { id: comicId, ownerUserId, archivedAt: null },
    select: { id: true },
  });
  if (!comic) throw new AppError("not_found", "漫画不存在。", 404);
  const existing = await prisma.asset.findFirst({
    where: {
      ownerUserId,
      comicId: comic.id,
      kind: AssetKind.COMIC_COVER,
      libraryStatus: AssetLibraryStatus.LIBRARY,
      archivedAt: null,
      variantOfAssetId: null,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (existing) return existing;
  return prisma.asset.create({
    data: {
      ownerUserId,
      comicId: comic.id,
      kind: AssetKind.COMIC_COVER,
      libraryStatus: AssetLibraryStatus.LIBRARY,
      currentVersionNumber: 0,
      name: "漫画封面",
      description: "",
    },
  });
}

export async function prepareExternalComicCoverUpload(
  ownerUserId: string,
  comicId: string,
  input: { filename: string; label?: string },
) {
  const asset = await ensureComicCoverAsset(ownerUserId, comicId);
  return prepareExternalAssetUpload(ownerUserId, asset.id, input);
}

export async function attachExternalComicCoverImage(ownerUserId: string, comicId: string, uploadId: string) {
  const asset = await ensureComicCoverAsset(ownerUserId, comicId);
  const detail = await attachExternalAssetImage(ownerUserId, asset.id, uploadId);
  const attached = detail.attached;
  const version = await prisma.assetVersion.findFirst({
    where: {
      id: attached.versionId,
      assetId: asset.id,
      asset: { ownerUserId, comicId, archivedAt: null },
    },
    select: {
      objectKey: true,
      contentType: true,
      width: true,
      height: true,
    },
  });
  if (!version?.objectKey || !version.contentType) {
    throw new AppError("asset_image_not_found", "漫画封面图片版本不可用。", 422);
  }
  const updated = await prisma.comic.update({
    where: { id: comicId },
    data: {
      coverObjectKey: version.objectKey,
      coverContentType: version.contentType,
      coverWidth: version.width,
      coverHeight: version.height,
    },
  });
  return {
    ...await getComicCoverMetadata(ownerUserId, comicId),
    coverUrl: comicCoverPath(updated),
    attached,
  };
}

export async function updateComicCover(ownerUserId: string, comicId: string, uploaded: UploadedImage) {
  const comic = await prisma.comic.findFirst({ where: { id: comicId, ownerUserId, archivedAt: null } });
  if (!comic) throw new AppError("not_found", "漫画不存在。", 404);
  const updated = await prisma.comic.update({ where: { id: comic.id }, data: { coverObjectKey: uploaded.stored.objectKey, coverContentType: uploaded.contentType, coverWidth: uploaded.stored.width, coverHeight: uploaded.stored.height } });
  return { coverUrl: comicCoverPath(updated) };
}

export async function createComicChapter(ownerUserId: string, comicId: string, input: { title: string; summary?: string }) {
  const comic = await prisma.comic.findFirst({ where: { id: comicId, ownerUserId, archivedAt: null } });
  if (!comic) throw new AppError("not_found", "漫画不存在。", 404);
  const last = await prisma.chapter.findFirst({ where: { comicId: comic.id }, orderBy: { number: "desc" } });
  return createChapterWorkspace(ownerUserId, comic, (last?.number ?? 0) + 1, input.title, input.summary ?? "");
}

export async function updateComicChapter(ownerUserId: string, comicId: string, chapterId: string, input: { title?: string; summary?: string; status?: "in_progress" | "completed" }) {
  const chapter = await prisma.chapter.findFirst({ where: { id: chapterId, comicId, ownerUserId, archivedAt: null, comic: { archivedAt: null } } });
  if (!chapter) throw new AppError("not_found", "章节不存在。", 404);
  return prisma.chapter.update({ where: { id: chapter.id }, data: { ...(input.title !== undefined ? { title: input.title } : {}), ...(input.summary !== undefined ? { summary: input.summary } : {}), ...(input.status !== undefined ? { status: input.status === "completed" ? CreationStatus.COMPLETED : CreationStatus.IN_PROGRESS } : {}) } });
}

export async function getChapterCover(ownerUserId: string, chapterId: string) {
  const chapter = await prisma.chapter.findFirst({ where: { id: chapterId, ownerUserId, archivedAt: null, comic: { archivedAt: null } }, include: { project: { include: { workingRevisions: { orderBy: { revision: "desc" }, take: 1 } } } } });
  const working = chapter?.project?.workingRevisions[0];
  if (working) {
    const document = validateComicDocument(structuredClone(working.document));
    const cover = document.units.find((unit) => unit.pageRole === "cover");
    if (cover) return { bytes: await renderPagePng(document, cover), contentType: "image/png" };
  }
  if (!chapter?.coverObjectKey || !chapter.coverContentType) throw new AppError("not_found", "章节封面不存在。", 404);
  return { bytes: await getObject(chapter.coverObjectKey), contentType: chapter.coverContentType };
}

export async function updateChapterCover(ownerUserId: string, comicId: string, chapterId: string, uploaded: UploadedImage) {
  const chapter = await prisma.chapter.findFirst({ where: { id: chapterId, comicId, ownerUserId, archivedAt: null, comic: { archivedAt: null } }, include: { project: { select: { id: true } } } });
  if (!chapter) throw new AppError("not_found", "章节不存在。", 404);
  if (!chapter.project) throw new AppError("not_found", "章节创作空间不存在。", 404);
  const asset = await createUploadedAsset({ ownerUserId, projectId: chapter.project.id, placeOnCanvas: false, kind: "reference_image", name: "章节封面", description: "章节封面背景图", uploaded });
  const version = asset.versions[0];
  if (!version) throw new AppError("validation", "封面图片版本创建失败。", 422);
  await setChapterCoverPageImage({ ownerUserId, projectId: chapter.project.id, chapterId: chapter.id, assetId: asset.id, assetVersionId: version.id, mediaType: uploaded.contentType, width: uploaded.stored.width, height: uploaded.stored.height });
  const updated = await prisma.chapter.update({ where: { id: chapter.id }, data: { coverObjectKey: uploaded.stored.objectKey, coverContentType: uploaded.contentType, coverWidth: uploaded.stored.width, coverHeight: uploaded.stored.height } });
  return { coverUrl: chapterCoverPath(updated) };
}

export async function assertComicChapterExists(ownerUserId: string, comicId: string, chapterId: string) {
  const chapter = await prisma.chapter.findFirst({ where: { id: chapterId, comicId, ownerUserId, archivedAt: null, comic: { archivedAt: null } }, select: { id: true } });
  if (!chapter) throw new AppError("not_found", "章节不存在。", 404);
  return chapter;
}

export async function archiveComic(ownerUserId: string, comicId: string) {
  const comic = await prisma.comic.findFirst({ where: { id: comicId, ownerUserId, archivedAt: null }, include: { chapters: { where: { archivedAt: null }, include: { project: true } } } });
  if (!comic) throw new AppError("not_found", "漫画不存在。", 404);
  const projectIds = comic.chapters.flatMap((chapter) => chapter.project?.id ? [chapter.project.id] : []);
  const activeTask = projectIds.length ? await prisma.generationTask.findFirst({ where: { ownerUserId, projectId: { in: projectIds }, status: { in: activeDeletionTaskStatuses } }, orderBy: { createdAt: "desc" } }) : null;
  if (activeTask) throw new AppError("task_in_progress", "请先停止这部漫画中的运行任务，再删除漫画。", 409, { taskId: activeTask.id });
  const now = new Date();
  await prisma.$transaction([
    prisma.comic.update({ where: { id: comic.id }, data: { archivedAt: now } }),
    prisma.chapter.updateMany({ where: { comicId: comic.id, ownerUserId, archivedAt: null }, data: { archivedAt: now } }),
    prisma.agentConversation.updateMany({ where: { ownerUserId, projectId: { in: projectIds }, archivedAt: null }, data: { archivedAt: now } }),
  ]);
  return { id: comic.id, deleted: true };
}

export async function archiveComicChapter(ownerUserId: string, comicId: string, chapterId: string) {
  const chapter = await prisma.chapter.findFirst({ where: { id: chapterId, comicId, ownerUserId, archivedAt: null, comic: { archivedAt: null } }, include: { project: true } });
  if (!chapter) throw new AppError("not_found", "章节不存在。", 404);
  const activeTask = chapter.project ? await prisma.generationTask.findFirst({ where: { ownerUserId, projectId: chapter.project.id, status: { in: activeDeletionTaskStatuses } }, orderBy: { createdAt: "desc" } }) : null;
  if (activeTask) throw new AppError("task_in_progress", "请先停止这一话中的运行任务，再删除章节。", 409, { taskId: activeTask.id });
  const now = new Date();
  await prisma.$transaction([
    prisma.chapter.update({ where: { id: chapter.id }, data: { archivedAt: now } }),
    prisma.comic.update({ where: { id: comicId }, data: { updatedAt: now } }),
    ...(chapter.project ? [prisma.agentConversation.updateMany({ where: { ownerUserId, projectId: chapter.project.id, archivedAt: null }, data: { archivedAt: now } })] : []),
  ]);
  return { id: chapter.id, deleted: true };
}

function blankComicDocument(comicId: string, chapterId: string, format: "page" | "vertical" | "four_panel", defaultReadingDirection: ReadingDirection): ComicDocument {
  return {
    protocolVersion: "lcd-0.4",
    comicId,
    chapterId,
    format,
    reading: {
      viewer: format === "vertical" ? "scroll" : format === "four_panel" ? "unit" : "paged",
      direction: format === "vertical" ? "ttb" : defaultReadingDirection.toLowerCase() as "ltr" | "rtl",
      unitOrder: [`${chapterId}-page-1`],
      showPageNumber: format === "page",
      gap: 24,
    },
    units: [{
      id: `${chapterId}-page-1`,
      kind: format === "vertical" ? "vertical_segment" : format === "four_panel" ? "four_panel_unit" : "single_page",
      pageRole: "story",
      canvas: { width: format === "vertical" ? 640 : 720, height: format === "vertical" ? 1280 : 1080, background: { color: "#ffffff" } },
      surfaces: [{ id: `${chapterId}-page-1-surface`, role: format === "vertical" ? "segment" : "single", geometry: { x: 0, y: 0, width: format === "vertical" ? 640 : 720, height: format === "vertical" ? 1280 : 1080 }, pageNumber: 1 }],
      frames: [],
      overlayLayers: [],
      readingSequence: [],
      layoutPolicy: { frameOverlap: "forbid", defaultOverflow: "clip" },
    }],
    resources: [],
    dialogues: [],
  };
}

export async function createChapterWorkspace(ownerUserId: string, comic: { id: string; format: ComicFormat; defaultReadingDirection: ReadingDirection }, number: number, title: string, summary: string) {
  return prisma.$transaction(async (tx) => {
    const chapter = await tx.chapter.create({ data: { ownerUserId, comicId: comic.id, number, title, summary } });
    const project = await tx.project.create({ data: { ownerUserId, chapterId: chapter.id } });
    const format = comic.format.toLowerCase() as "page" | "vertical" | "four_panel";
    await tx.workingRevision.create({
      data: {
        projectId: project.id,
        revision: 1,
        document: blankComicDocument(comic.id, chapter.id, format, comic.defaultReadingDirection) as unknown as Prisma.InputJsonValue,
        storyboardBeats: [],
        storyboardBeatVersionHeads: {},
        assetVersionHeads: {},
        changeSet: { id: `create:${chapter.id}`, source: "manual", operations: [] },
      },
    });
    const conversation = await tx.agentConversation.create({ data: { ownerUserId, projectId: project.id, title } });
    return { comicId: comic.id, chapterId: chapter.id, projectId: project.id, conversationId: conversation.id, number, title };
  }, { isolationLevel: "Serializable" });
}

function remapCopiedJson(value: Prisma.JsonValue, idMap: ReadonlyMap<string, string>): Prisma.InputJsonValue {
  const remapText = (text: string) => {
    let next = idMap.get(text) ?? text;
    for (const [sourceId, copiedId] of idMap) if (next.includes(sourceId)) next = next.replaceAll(sourceId, copiedId);
    return next;
  };
  const copy = (entry: Prisma.JsonValue): unknown => {
    if (typeof entry === "string") return remapText(entry);
    if (Array.isArray(entry)) return entry.map(copy);
    if (entry && typeof entry === "object") return Object.fromEntries(Object.entries(entry).map(([key, nested]) => [remapText(key), copy(nested ?? null)]));
    return entry;
  };
  return copy(value) as Prisma.InputJsonValue;
}

function copiedChangeSet(value: Prisma.JsonValue | null, idMap: ReadonlyMap<string, string>) {
  if (!value) return undefined;
  const copy = remapCopiedJson(value, idMap) as Record<string, unknown>;
  delete copy.sourceCandidateId;
  return copy as Prisma.InputJsonValue;
}

async function copyImageObject(sourceObjectKey: string, namespace: string) {
  return putImage(await getObject(sourceObjectKey), namespace);
}

export async function duplicateComic(ownerUserId: string, sourceComicId: string) {
  const source = await prisma.comic.findFirst({
    where: { id: sourceComicId, ownerUserId, archivedAt: null },
    include: {
      settings: { where: { archivedAt: null }, orderBy: [{ sortIndex: "asc" }, { createdAt: "asc" }] },
      assets: {
        where: { archivedAt: null },
        include: { versions: { orderBy: { version: "asc" } }, images: { orderBy: [{ sortIndex: "asc" }, { createdAt: "asc" }] } },
        orderBy: { createdAt: "asc" },
      },
      chapters: {
        where: { archivedAt: null },
        orderBy: { number: "asc" },
        include: {
          project: {
            include: {
              workingRevisions: { orderBy: { revision: "asc" } },
              snapshots: { orderBy: { createdAt: "asc" } },
              storyboardBeats: { where: { archivedAt: null }, include: { versions: { orderBy: { version: "asc" } } }, orderBy: { createdAt: "asc" } },
              canvasAssetItems: { orderBy: { createdAt: "asc" } },
              placements: { orderBy: { createdAt: "asc" } },
            },
          },
        },
      },
    },
  });
  if (!source) throw new AppError("not_found", "漫画不存在。", 404);

  const copiedComicId = randomUUID();
  const idMap = new Map<string, string>([[source.id, copiedComicId]]);
  for (const asset of source.assets) {
    idMap.set(asset.id, randomUUID());
    for (const version of asset.versions) idMap.set(version.id, randomUUID());
    for (const image of asset.images) idMap.set(image.id, randomUUID());
  }
  for (const chapter of source.chapters) {
    idMap.set(chapter.id, randomUUID());
    if (!chapter.project) continue;
    idMap.set(chapter.project.id, randomUUID());
    for (const beat of chapter.project.storyboardBeats) {
      idMap.set(beat.id, randomUUID());
      for (const version of beat.versions) idMap.set(version.id, randomUUID());
    }
    for (const item of chapter.project.canvasAssetItems) idMap.set(item.id, randomUUID());
  }

  const objectNamespace = `comic-copies/${copiedComicId}`;
  const sourceAssets = source.assets;
  const sourceAssetVersions = sourceAssets.flatMap((asset) => asset.versions);
  const [comicCover, chapterCoverEntries, assetObjectEntries] = await Promise.all([
    source.coverObjectKey ? copyImageObject(source.coverObjectKey, `${objectNamespace}/covers`) : undefined,
    Promise.all(source.chapters.map(async (chapter) => [chapter.id, chapter.coverObjectKey ? await copyImageObject(chapter.coverObjectKey, `${objectNamespace}/covers`) : undefined] as const)),
    Promise.all(sourceAssetVersions.map(async (version) => [version.id, version.objectKey ? await copyImageObject(version.objectKey, `${objectNamespace}/assets`) : undefined] as const)),
  ]);
  const chapterCovers = new Map(chapterCoverEntries);
  const copiedAssetObjects = new Map(assetObjectEntries);

  await prisma.$transaction(async (tx) => {
    await tx.comic.create({
      data: {
        id: copiedComicId,
        ownerUserId,
        title: `${source.title.slice(0, 112)} · 副本`,
        summary: source.summary,
        worldSummary: source.worldSummary,
        format: source.format,
        defaultReadingDirection: source.defaultReadingDirection,
        styleSummary: source.styleSummary,
        status: source.status,
        coverObjectKey: comicCover?.objectKey,
        coverContentType: comicCover?.contentType,
        coverWidth: comicCover?.width,
        coverHeight: comicCover?.height,
      },
    });

    if (source.settings.length) {
      await tx.comicSetting.createMany({
        data: source.settings.map((setting) => ({
          id: randomUUID(),
          ownerUserId,
          comicId: copiedComicId,
          title: setting.title,
          content: setting.content,
          contextEnabled: setting.contextEnabled,
          sortIndex: setting.sortIndex,
        })),
      });
    }

    for (const sourceAsset of sourceAssets) {
      await tx.asset.create({
        data: {
          id: idMap.get(sourceAsset.id)!,
          ownerUserId,
          comicId: copiedComicId,
          kind: sourceAsset.kind,
          name: sourceAsset.name,
          description: sourceAsset.description,
          libraryStatus: sourceAsset.libraryStatus,
          currentVersionNumber: sourceAsset.currentVersionNumber,
          variantLabel: sourceAsset.variantLabel,
          variantSortIndex: sourceAsset.variantSortIndex,
          versions: {
            create: sourceAsset.versions.map((version) => {
              const copiedObject = copiedAssetObjects.get(version.id);
              return {
                id: idMap.get(version.id)!,
                version: version.version,
                objectKey: copiedObject?.objectKey,
                contentType: copiedObject?.contentType ?? version.contentType,
                byteSize: copiedObject?.byteSize ?? version.byteSize,
                width: copiedObject?.width ?? version.width,
                height: copiedObject?.height ?? version.height,
                checksum: copiedObject?.checksum ?? version.checksum,
                origin: version.origin,
                sourceTaskId: null,
              };
            }),
          },
        },
      });
    }

    for (const sourceChapter of source.chapters) {
      const copiedChapterId = idMap.get(sourceChapter.id)!;
      const chapterCover = chapterCovers.get(sourceChapter.id);
      await tx.chapter.create({
        data: {
          id: copiedChapterId,
          ownerUserId,
          comicId: copiedComicId,
          number: sourceChapter.number,
          title: sourceChapter.title,
          summary: sourceChapter.summary,
          status: sourceChapter.status,
          coverObjectKey: chapterCover?.objectKey,
          coverContentType: chapterCover?.contentType,
          coverWidth: chapterCover?.width,
          coverHeight: chapterCover?.height,
        },
      });
      const sourceProject = sourceChapter.project;
      if (!sourceProject) continue;
      const copiedProjectId = idMap.get(sourceProject.id)!;
      await tx.project.create({ data: { id: copiedProjectId, ownerUserId, chapterId: copiedChapterId } });

      for (const sourceBeat of sourceProject.storyboardBeats) {
        await tx.storyboardBeat.create({
          data: {
            id: idMap.get(sourceBeat.id)!, ownerUserId, projectId: copiedProjectId, currentVersionNumber: sourceBeat.currentVersionNumber,
            versions: { create: sourceBeat.versions.map((version) => ({ id: idMap.get(version.id)!, version: version.version, title: version.title, description: version.description, sourceTaskId: null })) },
          },
        });
      }

      for (const sourceItem of sourceProject.canvasAssetItems) {
        await tx.canvasAssetListItem.create({
          data: { id: idMap.get(sourceItem.id)!, ownerUserId, projectId: copiedProjectId, assetId: idMap.get(sourceItem.assetId)!, displayName: sourceItem.displayName, sortIndex: sourceItem.sortIndex, pinned: sourceItem.pinned, hiddenAt: sourceItem.hiddenAt },
        });
      }
      for (const placement of sourceProject.placements) {
        await tx.canvasReferencePlacement.create({
          data: { id: randomUUID(), ownerUserId, projectId: copiedProjectId, assetId: idMap.get(placement.assetId)!, assetVersionId: idMap.get(placement.assetVersionId)!, x: placement.x, y: placement.y, zoom: placement.zoom, zIndex: placement.zIndex, collapsed: placement.collapsed, pinned: placement.pinned },
        });
      }
      for (const working of sourceProject.workingRevisions) {
        await tx.workingRevision.create({
          data: { id: randomUUID(), projectId: copiedProjectId, revision: working.revision, document: remapCopiedJson(working.document, idMap), storyboardBeats: remapCopiedJson(working.storyboardBeats, idMap), storyboardBeatVersionHeads: remapCopiedJson(working.storyboardBeatVersionHeads, idMap), assetVersionHeads: remapCopiedJson(working.assetVersionHeads, idMap), changeSet: copiedChangeSet(working.changeSet, idMap) },
        });
      }
      for (const snapshot of sourceProject.snapshots) {
        await tx.savedSnapshot.create({
          data: { id: randomUUID(), ownerUserId, chapterId: copiedChapterId, projectId: copiedProjectId, sourceWorkingRevision: snapshot.sourceWorkingRevision, document: remapCopiedJson(snapshot.document, idMap), storyboardBeatVersions: remapCopiedJson(snapshot.storyboardBeatVersions, idMap), assetVersions: remapCopiedJson(snapshot.assetVersions, idMap) },
        });
      }
      await tx.agentConversation.create({ data: { id: randomUUID(), ownerUserId, projectId: copiedProjectId, title: "复制后的创作对话" } });
    }

    for (const sourceAsset of sourceAssets) {
      for (const image of sourceAsset.images) {
        await tx.assetImage.create({
          data: {
            id: idMap.get(image.id)!,
            assetId: idMap.get(sourceAsset.id)!,
            assetVersionId: idMap.get(image.assetVersionId)!,
            label: image.label,
            sortIndex: image.sortIndex,
          },
        });
      }
      if (sourceAsset.variantOfAssetId) {
        const copiedRootId = idMap.get(sourceAsset.variantOfAssetId);
        if (!copiedRootId) throw new AppError("invalid_asset_variant", "资产派生关系不完整，无法复制漫画。", 422);
        await tx.asset.update({ where: { id: idMap.get(sourceAsset.id)! }, data: { variantOfAssetId: copiedRootId } });
      }
    }
  }, { isolationLevel: "Serializable" });

  return { comicId: copiedComicId, firstChapterId: source.chapters[0] ? idMap.get(source.chapters[0].id) : undefined };
}

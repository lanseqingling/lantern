import { createHash, randomUUID } from "node:crypto";
import { AssetKind, type Prisma } from "@prisma/client";
import { strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import {
  chapterArchiveFileNames,
  chapterArchiveLcdSchema,
  chapterArchiveManifestSchema,
  chapterArchiveStoryboardBeatsSchema,
  validateComicDocument,
  type ChapterArchiveAsset,
  type ChapterArchiveManifest,
  type ChapterArchiveResource,
  type ComicDocument,
  type StoryboardBeat,
} from "../../shared/src";
import { prisma } from "./db";
import { AppError } from "./errors";
import { deleteObject, getObject, putImage, type StoredObject } from "./object-storage";

const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 1_000;
const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024;

type ParsedArchive = {
  manifest: ChapterArchiveManifest;
  document: ComicDocument;
  storyboardBeats: StoryboardBeat[];
  resourceFiles: Map<string, Buffer>;
};

type StoredImportResource = ChapterArchiveResource & {
  newAssetId: string;
  newAssetVersionId: string;
  stored: StoredObject;
};

function json<T>(value: Prisma.JsonValue) {
  return structuredClone(value) as T;
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function jsonBytes(value: unknown) {
  return strToU8(`${JSON.stringify(value, null, 2)}\n`);
}

function parseJsonEntry(files: Record<string, Uint8Array>, path: string, label: string): unknown {
  const bytes = files[path];
  if (!bytes) throw new AppError("invalid_archive", `归档缺少 ${label}。`, 422);
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new AppError("invalid_archive", `${label} 不是有效的 UTF-8 JSON。`, 422);
  }
}

function collectIdsByKey(value: unknown, key: "assetId" | "speakerAssetId" | "storyboardBeatId" | "storyboardBeatVersionId") {
  const ids = new Set<string>();
  const visit = (entry: unknown) => {
    if (Array.isArray(entry)) return entry.forEach(visit);
    if (!entry || typeof entry !== "object") return;
    for (const [entryKey, nested] of Object.entries(entry)) {
      if (entryKey === key && typeof nested === "string") ids.add(nested);
      visit(nested);
    }
  };
  visit(value);
  return ids;
}

function remapIds<T>(value: T, idMap: ReadonlyMap<string, string>): T {
  const remap = (entry: unknown): unknown => {
    if (typeof entry === "string") return idMap.get(entry) ?? entry;
    if (Array.isArray(entry)) return entry.map(remap);
    if (entry && typeof entry === "object") return Object.fromEntries(Object.entries(entry).map(([key, nested]) => [key, remap(nested)]));
    return entry;
  };
  return remap(value) as T;
}

function assetKind(kind: ChapterArchiveAsset["kind"]): AssetKind {
  return kind.toUpperCase() as AssetKind;
}

function fileExtension(mediaType: ChapterArchiveResource["mediaType"]) {
  if (mediaType === "image/jpeg") return "jpg";
  if (mediaType === "image/webp") return "webp";
  return "png";
}

export function buildChapterArchive(input: {
  document: ComicDocument;
  storyboardBeats: StoryboardBeat[];
  assets: ChapterArchiveAsset[];
  resources: Array<Omit<ChapterArchiveResource, "path" | "byteSize" | "checksum"> & { bytes: Buffer }>;
  createdAt?: string;
}) {
  const resources: ChapterArchiveResource[] = input.resources.map((resource, index) => ({
    assetId: resource.assetId,
    assetVersionId: resource.assetVersionId,
    path: `resources/${String(index + 1).padStart(4, "0")}.${fileExtension(resource.mediaType)}`,
    mediaType: resource.mediaType,
    byteSize: resource.bytes.length,
    checksum: sha256(resource.bytes),
    width: resource.width,
    height: resource.height,
  }));
  const manifest: ChapterArchiveManifest = {
    protocol: "lantern-chapter-archive-1",
    createdAt: input.createdAt ?? new Date().toISOString(),
    source: { comicId: input.document.comicId, chapterId: input.document.chapterId },
    files: { lcd: chapterArchiveFileNames.lcd, storyboardBeats: chapterArchiveFileNames.storyboardBeats },
    assets: input.assets,
    resources,
  };
  const files: Zippable = {
    [chapterArchiveFileNames.manifest]: jsonBytes(manifest),
    [chapterArchiveFileNames.lcd]: jsonBytes(input.document),
    [chapterArchiveFileNames.storyboardBeats]: jsonBytes(input.storyboardBeats),
  };
  resources.forEach((resource, index) => { files[resource.path] = input.resources[index]!.bytes; });
  return Buffer.from(zipSync(files, { level: 6 }));
}

export function parseChapterArchive(bytes: Buffer): ParsedArchive {
  if (!bytes.length || bytes.length > MAX_ARCHIVE_BYTES) throw new AppError("archive_size_limit", "完整 LCD 归档必须小于 512MB。", 413);
  let entryCount = 0;
  let totalSize = 0;
  const entryNames = new Set<string>();
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (file) => {
        entryCount += 1;
        totalSize += file.originalSize;
        if (entryNames.has(file.name)) throw new AppError("invalid_archive", "归档包含重复的文件路径。", 422);
        entryNames.add(file.name);
        if (entryCount > MAX_ARCHIVE_ENTRIES || totalSize > MAX_ARCHIVE_UNCOMPRESSED_BYTES) {
          throw new AppError("archive_size_limit", "归档中的文件数量或解压后大小超过限制。", 413);
        }
        return true;
      },
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("invalid_archive", "无法解析 ZIP 归档。", 422);
  }
  let manifest: ChapterArchiveManifest;
  let document: ComicDocument;
  let storyboardBeats: StoryboardBeat[];
  try {
    manifest = chapterArchiveManifestSchema.parse(parseJsonEntry(files, chapterArchiveFileNames.manifest, "manifest.json"));
    document = validateComicDocument(chapterArchiveLcdSchema.parse(parseJsonEntry(files, manifest.files.lcd, "lcd.json")));
    storyboardBeats = chapterArchiveStoryboardBeatsSchema.parse(parseJsonEntry(files, manifest.files.storyboardBeats, "storyboard-beats.json"));
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("invalid_archive", "完整 LCD 归档的协议或内容校验失败。", 422);
  }
  if (document.comicId !== manifest.source.comicId || document.chapterId !== manifest.source.chapterId) {
    throw new AppError("invalid_archive", "归档来源与 LCD 标识不一致。", 422);
  }
  const assetIds = new Set(manifest.assets.map((asset) => asset.assetId));
  if (assetIds.size !== manifest.assets.length) throw new AppError("invalid_archive", "归档包含重复的资产标识。", 422);
  const resourceVersionIds = new Set(manifest.resources.map((resource) => resource.assetVersionId));
  const resourcePaths = new Set(manifest.resources.map((resource) => resource.path));
  if (resourceVersionIds.size !== manifest.resources.length || resourcePaths.size !== manifest.resources.length) {
    throw new AppError("invalid_archive", "归档包含重复的资源版本或文件路径。", 422);
  }
  const documentImages = document.resources.filter((resource) => resource.kind === "image");
  if (document.resources.length !== documentImages.length) throw new AppError("unsupported_archive_resource", "当前完整归档只支持 LCD 中的图片资源。", 422);
  const documentResourceIds = new Set(documentImages.map((resource) => resource.assetVersionId));
  if (documentResourceIds.size !== manifest.resources.length || manifest.resources.some((resource) => !documentResourceIds.has(resource.assetVersionId))) {
    throw new AppError("invalid_archive", "manifest 与 LCD 的图片资源清单不一致。", 422);
  }
  const referencedAssetIds = collectIdsByKey(document, "assetId");
  collectIdsByKey(document, "speakerAssetId").forEach((assetId) => referencedAssetIds.add(assetId));
  if ([...referencedAssetIds].some((assetId) => !assetIds.has(assetId))) {
    throw new AppError("invalid_archive", "LCD 引用的资产元数据不完整。", 422);
  }
  const beatIds = new Set(storyboardBeats.map((beat) => beat.id));
  const beatVersionIds = new Set(storyboardBeats.map((beat) => beat.versionId));
  if (beatIds.size !== storyboardBeats.length || beatVersionIds.size !== storyboardBeats.length) throw new AppError("invalid_archive", "归档包含重复的分镜条目。", 422);
  if ([...collectIdsByKey(document, "storyboardBeatId")].some((id) => !beatIds.has(id)) || [...collectIdsByKey(document, "storyboardBeatVersionId")].some((id) => !beatVersionIds.has(id))) {
    throw new AppError("invalid_archive", "LCD 引用的分镜条目不完整。", 422);
  }
  const allowedFiles = new Set([chapterArchiveFileNames.manifest, manifest.files.lcd, manifest.files.storyboardBeats, ...resourcePaths]);
  if (Object.keys(files).some((path) => !allowedFiles.has(path))) throw new AppError("invalid_archive", "归档包含协议未声明的文件。", 422);
  const resourceFiles = new Map<string, Buffer>();
  for (const resource of manifest.resources) {
    const file = files[resource.path];
    if (!file || file.length !== resource.byteSize || sha256(file) !== resource.checksum) {
      throw new AppError("invalid_archive", `图片资源 ${resource.path} 缺失或校验失败。`, 422);
    }
    resourceFiles.set(resource.assetVersionId, Buffer.from(file));
  }
  return { manifest, document, storyboardBeats, resourceFiles };
}

export async function exportChapterArchive(ownerUserId: string, chapterId: string) {
  const project = await prisma.project.findFirst({
    where: { chapterId, ownerUserId, chapter: { archivedAt: null, comic: { archivedAt: null } } },
    include: { chapter: { include: { comic: true } } },
  });
  if (!project) throw new AppError("not_found", "一话不存在。", 404);
  const snapshot = await prisma.savedSnapshot.findFirst({ where: { projectId: project.id, chapterId, ownerUserId }, orderBy: { createdAt: "desc" } });
  if (!snapshot) throw new AppError("not_found", "当前一话还没有已保存版本。", 404);
  const document = validateComicDocument(json<unknown>(snapshot.document));
  if (document.resources.some((resource) => resource.kind !== "image")) throw new AppError("unsupported_archive_resource", "当前完整归档只支持 LCD 中的图片资源。", 422);
  const assetIds = collectIdsByKey(document, "assetId");
  collectIdsByKey(document, "speakerAssetId").forEach((assetId) => assetIds.add(assetId));
  const assets = assetIds.size ? await prisma.asset.findMany({ where: { id: { in: [...assetIds] }, projectId: project.id, ownerUserId } }) : [];
  if (assets.length !== assetIds.size) throw new AppError("archive_incomplete", "已保存版本引用的资产不完整，无法创建完整归档。", 422);
  const versionIds = document.resources.map((resource) => resource.assetVersionId);
  const versions = versionIds.length ? await prisma.assetVersion.findMany({ where: { id: { in: versionIds }, asset: { projectId: project.id, ownerUserId } } }) : [];
  if (versions.length !== new Set(versionIds).size) throw new AppError("archive_incomplete", "已保存版本引用的图片资源不完整，无法创建完整归档。", 422);
  const versionById = new Map(versions.map((version) => [version.id, version]));
  const beatHeads = json<Record<string, string>>(snapshot.storyboardBeatVersions);
  const beatVersions = Object.values(beatHeads).length ? await prisma.storyboardBeatVersion.findMany({
    where: { id: { in: Object.values(beatHeads) }, storyboardBeat: { projectId: project.id, ownerUserId } },
  }) : [];
  if (beatVersions.length !== new Set(Object.values(beatHeads)).size) throw new AppError("archive_incomplete", "已保存版本引用的分镜条目不完整，无法创建完整归档。", 422);
  const storyboardBeats = beatVersions.map((version) => ({ id: version.storyboardBeatId, versionId: version.id, title: version.title, description: version.description }));
  const resources = await Promise.all(document.resources.map(async (resource) => {
    const version = versionById.get(resource.assetVersionId);
    if (!version?.objectKey || !version.contentType || !["image/png", "image/jpeg", "image/webp"].includes(version.contentType) || version.assetId !== resource.assetId) {
      throw new AppError("archive_incomplete", "已保存版本引用的图片资源不可读取。", 422);
    }
    return {
      assetId: version.assetId,
      assetVersionId: version.id,
      mediaType: version.contentType as ChapterArchiveResource["mediaType"],
      width: version.width ?? undefined,
      height: version.height ?? undefined,
      bytes: await getObject(version.objectKey),
    };
  }));
  return buildChapterArchive({
    document,
    storyboardBeats,
    assets: assets.map((asset) => ({ assetId: asset.id, kind: asset.kind.toLowerCase() as ChapterArchiveAsset["kind"], name: asset.name, description: asset.description })),
    resources,
    createdAt: snapshot.createdAt.toISOString(),
  });
}

export async function importChapterArchive(args: { ownerUserId: string; chapterId: string; expectedRevision: number; bytes: Buffer }) {
  const parsed = parseChapterArchive(args.bytes);
  const project = await prisma.project.findFirst({
    where: { chapterId: args.chapterId, ownerUserId: args.ownerUserId, chapter: { archivedAt: null, comic: { archivedAt: null } } },
    include: { chapter: { include: { comic: true } } },
  });
  if (!project) throw new AppError("not_found", "请先创建目标一话，再导入完整 LCD 归档。", 404);
  if (project.chapter.comic.format.toLowerCase() !== parsed.document.format) {
    throw new AppError("format_mismatch", "归档格式与目标漫画格式不同，请在相同格式的漫画中创建一话后再导入。", 422);
  }
  const current = await prisma.workingRevision.findFirst({ where: { projectId: project.id }, orderBy: { revision: "desc" } });
  if (!current) throw new AppError("not_found", "目标一话没有工作稿。", 404);
  if (current.revision !== args.expectedRevision) throw new AppError("conflict", "工作稿已变化，请重新加载后再导入。", 409, { currentRevision: current.revision });
  const activeTask = await prisma.generationTask.findFirst({
    where: { projectId: project.id, ownerUserId: args.ownerUserId, status: { in: ["CREATED", "QUEUED", "RUNNING", "CANCEL_REQUESTED"] } },
    select: { id: true },
  });
  if (activeTask) throw new AppError("task_in_progress", "请先等待或停止当前 Agent 任务，再导入完整 LCD 资源。", 409);

  const idMap = new Map<string, string>([
    [parsed.manifest.source.comicId, project.chapter.comicId],
    [parsed.manifest.source.chapterId, args.chapterId],
  ]);
  parsed.manifest.assets.forEach((asset) => idMap.set(asset.assetId, randomUUID()));
  parsed.storyboardBeats.forEach((beat) => { idMap.set(beat.id, randomUUID()); idMap.set(beat.versionId, randomUUID()); });
  parsed.manifest.resources.forEach((resource) => idMap.set(resource.assetVersionId, randomUUID()));

  const storedResources: StoredImportResource[] = [];
  try {
    for (const resource of parsed.manifest.resources) {
      const file = parsed.resourceFiles.get(resource.assetVersionId);
      if (!file) throw new AppError("invalid_archive", `图片资源 ${resource.path} 缺失。`, 422);
      const stored = await putImage(file, `chapter-imports/${project.id}`);
      storedResources.push({ ...resource, newAssetId: idMap.get(resource.assetId)!, newAssetVersionId: idMap.get(resource.assetVersionId)!, stored });
      if (stored.contentType !== resource.mediaType || stored.byteSize !== resource.byteSize || stored.checksum !== resource.checksum) {
        throw new AppError("invalid_archive", `图片资源 ${resource.path} 的实际格式与清单不一致。`, 422);
      }
    }

    const storedBySourceVersionId = new Map(storedResources.map((resource) => [resource.assetVersionId, resource]));
    const document = remapIds(parsed.document, idMap);
    document.comicId = project.chapter.comicId;
    document.chapterId = args.chapterId;
    document.resources = parsed.document.resources.map((resource) => {
      const imported = storedBySourceVersionId.get(resource.assetVersionId);
      if (!imported) throw new AppError("invalid_archive", "LCD 图片资源未完整导入。", 422);
      return {
        ...resource,
        assetId: imported.newAssetId,
        assetVersionId: imported.newAssetVersionId,
        mediaType: imported.stored.contentType,
        checksum: imported.stored.checksum,
        width: imported.stored.width ?? resource.width,
        height: imported.stored.height ?? resource.height,
      };
    });
    const validatedDocument = validateComicDocument(document);
    const storyboardBeats = remapIds(parsed.storyboardBeats, idMap);
    const storyboardBeatVersionHeads = Object.fromEntries(storyboardBeats.map((beat) => [beat.id, beat.versionId]));
    const assetVersionHeads = Object.fromEntries(storedResources.map((resource) => [resource.newAssetId, resource.newAssetVersionId]));

    const next = await prisma.$transaction(async (tx) => {
      const latest = await tx.workingRevision.findFirst({ where: { projectId: project.id }, orderBy: { revision: "desc" } });
      if (!latest || latest.revision !== args.expectedRevision) throw new AppError("conflict", "工作稿已变化，请重新加载后再导入。", 409, { currentRevision: latest?.revision });
      const runningTask = await tx.generationTask.findFirst({
        where: { projectId: project.id, ownerUserId: args.ownerUserId, status: { in: ["CREATED", "QUEUED", "RUNNING", "CANCEL_REQUESTED"] } },
        select: { id: true },
      });
      if (runningTask) throw new AppError("task_in_progress", "请先等待或停止当前 Agent 任务，再导入完整 LCD 资源。", 409);
      await tx.storyboardBeat.updateMany({ where: { projectId: project.id, archivedAt: null }, data: { archivedAt: new Date() } });
      for (const sourceAsset of parsed.manifest.assets) {
        const versions = storedResources.filter((resource) => resource.assetId === sourceAsset.assetId);
        await tx.asset.create({
          data: {
            id: idMap.get(sourceAsset.assetId)!,
            ownerUserId: args.ownerUserId,
            projectId: project.id,
            kind: assetKind(sourceAsset.kind),
            name: sourceAsset.name,
            description: sourceAsset.description,
            libraryStatus: "CANVAS_ONLY",
            currentVersionNumber: Math.max(1, versions.length),
            versions: versions.length ? { create: versions.map((resource, index) => ({
              id: resource.newAssetVersionId,
              version: index + 1,
              objectKey: resource.stored.objectKey,
              contentType: resource.stored.contentType,
              byteSize: resource.stored.byteSize,
              width: resource.stored.width,
              height: resource.stored.height,
              checksum: resource.stored.checksum,
              source: "chapter_archive_import",
            })) } : undefined,
          },
        });
      }
      for (const beat of storyboardBeats) {
        await tx.storyboardBeat.create({
          data: {
            id: beat.id,
            ownerUserId: args.ownerUserId,
            projectId: project.id,
            currentVersionNumber: 1,
            versions: { create: { id: beat.versionId, version: 1, title: beat.title, description: beat.description } },
          },
        });
      }
      const revision = latest.revision + 1;
      const changeSet = {
        id: `chapter-archive-import:${randomUUID()}`,
        projectId: project.id,
        baseRevision: latest.revision,
        source: "migration",
        commands: [
          { type: "replace_chapter_presentation", document: validatedDocument },
          { type: "replace_storyboard_beats", storyboardBeats },
        ],
      };
      const working = await tx.workingRevision.create({
        data: {
          projectId: project.id,
          revision,
          document: validatedDocument as unknown as Prisma.InputJsonValue,
          storyboardBeats: storyboardBeats as unknown as Prisma.InputJsonValue,
          storyboardBeatVersionHeads,
          assetVersionHeads,
          changeSet: changeSet as unknown as Prisma.InputJsonValue,
        },
      });
      await tx.savedSnapshot.create({
        data: {
          ownerUserId: args.ownerUserId,
          chapterId: args.chapterId,
          projectId: project.id,
          sourceWorkingRevision: revision,
          document: validatedDocument as unknown as Prisma.InputJsonValue,
          storyboardBeatVersions: storyboardBeatVersionHeads,
          assetVersions: assetVersionHeads,
        },
      });
      await tx.candidate.updateMany({ where: { projectId: project.id, ownerUserId: args.ownerUserId, status: "AVAILABLE" }, data: { status: "STALE" } });
      return working;
    }, { isolationLevel: "Serializable" });
    return { revision: next.revision, importedResources: storedResources.length, importedStoryboardBeats: storyboardBeats.length };
  } catch (error) {
    await Promise.allSettled(storedResources.map((resource) => deleteObject(resource.stored.objectKey)));
    throw error;
  }
}

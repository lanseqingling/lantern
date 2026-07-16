import { randomUUID } from "node:crypto";
import { type ComicFormat, type Prisma } from "@prisma/client";
import type { ComicDocument } from "../../shared/src";
import { prisma } from "./db";
import { AppError } from "./errors";
import { getObject, putImage } from "./object-storage";

function blankComicDocument(comicId: string, chapterId: string, format: "page" | "vertical" | "four_panel"): ComicDocument {
  return {
    protocolVersion: "lcd-0.4",
    comicId,
    chapterId,
    format,
    reading: {
      viewer: format === "vertical" ? "scroll" : format === "four_panel" ? "unit" : "paged",
      direction: format === "vertical" ? "ttb" : "ltr",
      unitOrder: [`${chapterId}-page-1`],
      showPageNumber: format === "page",
      gap: 24,
    },
    units: [{
      id: `${chapterId}-page-1`,
      kind: format === "vertical" ? "vertical_segment" : format === "four_panel" ? "four_panel_unit" : "single_page",
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

export async function createChapterWorkspace(ownerUserId: string, comic: { id: string; format: ComicFormat }, number: number, title: string, summary: string) {
  return prisma.$transaction(async (tx) => {
    const chapter = await tx.chapter.create({ data: { ownerUserId, comicId: comic.id, number, title, summary } });
    const project = await tx.project.create({ data: { ownerUserId, chapterId: chapter.id, settings: { generationStyle: "", defaultImageSize: "1024*1024" } } });
    const format = comic.format.toLowerCase() as "page" | "vertical" | "four_panel";
    await tx.workingRevision.create({
      data: {
        projectId: project.id,
        revision: 1,
        document: blankComicDocument(comic.id, chapter.id, format) as unknown as Prisma.InputJsonValue,
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
      chapters: {
        where: { archivedAt: null },
        orderBy: { number: "asc" },
        include: {
          project: {
            include: {
              workingRevisions: { orderBy: { revision: "asc" } },
              snapshots: { orderBy: { createdAt: "asc" } },
              storyboardBeats: { where: { archivedAt: null }, include: { versions: { orderBy: { version: "asc" } } }, orderBy: { createdAt: "asc" } },
              assets: { where: { archivedAt: null }, include: { versions: { orderBy: { version: "asc" } }, images: { orderBy: [{ sortIndex: "asc" }, { createdAt: "asc" }] } }, orderBy: { createdAt: "asc" } },
              canvasAssetItems: { include: { asset: { include: { versions: { orderBy: { version: "asc" } }, images: { orderBy: [{ sortIndex: "asc" }, { createdAt: "asc" }] } } } }, orderBy: { createdAt: "asc" } },
              placements: { orderBy: { createdAt: "asc" } },
              pageVariants: { where: { archivedAt: null }, orderBy: { createdAt: "asc" } },
            },
          },
        },
      },
    },
  });
  if (!source) throw new AppError("not_found", "漫画不存在。", 404);

  const copiedComicId = randomUUID();
  const idMap = new Map<string, string>([[source.id, copiedComicId]]);
  for (const chapter of source.chapters) {
    idMap.set(chapter.id, randomUUID());
    if (!chapter.project) continue;
    idMap.set(chapter.project.id, randomUUID());
    for (const beat of chapter.project.storyboardBeats) {
      idMap.set(beat.id, randomUUID());
      for (const version of beat.versions) idMap.set(version.id, randomUUID());
    }
    for (const asset of chapter.project.assets) {
      idMap.set(asset.id, randomUUID());
      for (const version of asset.versions) idMap.set(version.id, randomUUID());
      for (const image of asset.images) idMap.set(image.id, randomUUID());
    }
    for (const item of chapter.project.canvasAssetItems) {
      idMap.set(item.id, randomUUID());
      if (!idMap.has(item.asset.id)) {
        idMap.set(item.asset.id, randomUUID());
        for (const version of item.asset.versions) idMap.set(version.id, randomUUID());
        for (const image of item.asset.images) idMap.set(image.id, randomUUID());
      }
    }
  }

  const objectNamespace = `comic-copies/${copiedComicId}`;
  const sourceAssets = source.chapters.flatMap((chapter) => {
    if (!chapter.project) return [];
    return [...chapter.project.assets, ...chapter.project.canvasAssetItems.map((item) => item.asset)];
  }).filter((asset, index, assets) => assets.findIndex((item) => item.id === asset.id) === index);
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
        canvasPageMode: source.canvasPageMode,
        readingDirection: source.readingDirection,
        styleSummary: source.styleSummary,
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
          coverObjectKey: chapterCover?.objectKey,
          coverContentType: chapterCover?.contentType,
          coverWidth: chapterCover?.width,
          coverHeight: chapterCover?.height,
        },
      });
      const sourceProject = sourceChapter.project;
      if (!sourceProject) continue;
      const copiedProjectId = idMap.get(sourceProject.id)!;
      await tx.project.create({ data: { id: copiedProjectId, ownerUserId, chapterId: copiedChapterId, settings: remapCopiedJson(sourceProject.settings, idMap) } });

      for (const sourceBeat of sourceProject.storyboardBeats) {
        await tx.storyboardBeat.create({
          data: {
            id: idMap.get(sourceBeat.id)!, ownerUserId, projectId: copiedProjectId, currentVersionNumber: sourceBeat.currentVersionNumber,
            versions: { create: sourceBeat.versions.map((version) => ({ id: idMap.get(version.id)!, version: version.version, title: version.title, description: version.description, sourceTaskId: null })) },
          },
        });
      }

      for (const sourceAsset of sourceProject.assets) {
        await tx.asset.create({
          data: {
            id: idMap.get(sourceAsset.id)!, ownerUserId, projectId: copiedProjectId, kind: sourceAsset.kind, name: sourceAsset.name,
            description: sourceAsset.description, libraryStatus: sourceAsset.libraryStatus,
            currentVersionNumber: sourceAsset.currentVersionNumber, variantLabel: sourceAsset.variantLabel, variantSortIndex: sourceAsset.variantSortIndex,
            versions: { create: sourceAsset.versions.map((version) => {
              const copiedObject = copiedAssetObjects.get(version.id);
              return { id: idMap.get(version.id)!, version: version.version, objectKey: copiedObject?.objectKey, contentType: copiedObject?.contentType ?? version.contentType, byteSize: copiedObject?.byteSize ?? version.byteSize, width: copiedObject?.width ?? version.width, height: copiedObject?.height ?? version.height, checksum: copiedObject?.checksum ?? version.checksum, source: version.source, sourceTaskId: null };
            }) },
          },
        });
      }

      for (const sourceItem of sourceProject.canvasAssetItems) {
        if (sourceProject.assets.some((asset) => asset.id === sourceItem.assetId)) continue;
        await tx.asset.create({
          data: {
            id: idMap.get(sourceItem.assetId)!, ownerUserId, projectId: copiedProjectId, kind: sourceItem.asset.kind, name: sourceItem.asset.name,
            description: sourceItem.asset.description, libraryStatus: sourceItem.asset.libraryStatus,
            currentVersionNumber: sourceItem.asset.currentVersionNumber, variantLabel: sourceItem.asset.variantLabel, variantSortIndex: sourceItem.asset.variantSortIndex,
            versions: { create: sourceItem.asset.versions.map((version) => {
              const copiedObject = copiedAssetObjects.get(version.id);
              return { id: idMap.get(version.id)!, version: version.version, objectKey: copiedObject?.objectKey, contentType: copiedObject?.contentType ?? version.contentType, byteSize: copiedObject?.byteSize ?? version.byteSize, width: copiedObject?.width ?? version.width, height: copiedObject?.height ?? version.height, checksum: copiedObject?.checksum ?? version.checksum, source: version.source, sourceTaskId: null };
            }) },
          },
        });
      }

      for (const sourceItem of sourceProject.canvasAssetItems) {
        await tx.canvasAssetListItem.create({
          data: { id: idMap.get(sourceItem.id)!, ownerUserId, projectId: copiedProjectId, assetId: idMap.get(sourceItem.assetId)!, displayName: sourceItem.displayName, displayKind: sourceItem.displayKind, sortIndex: sourceItem.sortIndex, pinned: sourceItem.pinned, hiddenAt: sourceItem.hiddenAt },
        });
      }
      for (const placement of sourceProject.placements) {
        await tx.canvasReferencePlacement.create({
          data: { id: randomUUID(), ownerUserId, projectId: copiedProjectId, assetId: idMap.get(placement.assetId)!, assetVersionId: idMap.get(placement.assetVersionId)!, x: placement.x, y: placement.y, zoom: placement.zoom, zIndex: placement.zIndex, collapsed: placement.collapsed, pinned: placement.pinned },
        });
      }
      for (const working of sourceProject.workingRevisions) {
        await tx.workingRevision.create({
          data: { id: randomUUID(), projectId: copiedProjectId, revision: working.revision, document: remapCopiedJson(working.document, idMap), storyboardBeats: remapCopiedJson(working.storyboardBeats, idMap), storyboardBeatVersionHeads: remapCopiedJson(working.storyboardBeatVersionHeads, idMap), assetVersionHeads: remapCopiedJson(working.assetVersionHeads, idMap), changeSet: copiedChangeSet(working.changeSet, idMap), sourceCandidateId: null },
        });
      }
      for (const snapshot of sourceProject.snapshots) {
        await tx.savedSnapshot.create({
          data: { id: randomUUID(), ownerUserId, chapterId: copiedChapterId, projectId: copiedProjectId, sourceWorkingRevision: snapshot.sourceWorkingRevision, document: remapCopiedJson(snapshot.document, idMap), storyboardBeatVersions: remapCopiedJson(snapshot.storyboardBeatVersions, idMap), assetVersions: remapCopiedJson(snapshot.assetVersions, idMap) },
        });
      }
      for (const variant of sourceProject.pageVariants) {
        await tx.pageVariant.create({
          data: { id: randomUUID(), ownerUserId, projectId: copiedProjectId, unitId: String(remapCopiedJson(variant.unitId, idMap)), name: variant.name, kind: variant.kind, scope: remapCopiedJson(variant.scope, idMap), commands: remapCopiedJson(variant.commands, idMap), baseRevision: variant.baseRevision, sourceCandidateId: null, thumbnailAssetVersionId: variant.thumbnailAssetVersionId ? idMap.get(variant.thumbnailAssetVersionId) ?? null : null, lastAppliedRevision: variant.lastAppliedRevision },
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

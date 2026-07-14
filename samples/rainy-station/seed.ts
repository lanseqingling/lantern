import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  AssetKind,
  CandidateKind,
  CandidateStatus,
  ComicFormat,
  MessageKind,
  MessageRole,
  TaskStatus,
  TaskType,
  type Prisma,
} from "@prisma/client";
import type { ComicDocument, Dialogue, Frame, PresentationUnit, StoryboardBeat } from "../../packages/shared/src";
import { prisma } from "../../packages/server/src/db";
import { putImage, type StoredObject } from "../../packages/server/src/object-storage";

const ids = {
  user: "user-local-creator",
  comic: "comic-rainy-station",
  chapter: "chapter-rainy-station-01",
  project: "project-rainy-station-01",
  conversation: "conversation-rainy-station-main",
  storyboardTask: "task-rainy-station-storyboard",
  layoutTask: "task-rainy-station-layout",
  imageTask: "task-rainy-station-images",
};

const imageFiles = [
  "character-lincheng.png",
  "scene-rain-bus-stop.png",
  "frame-01.png",
  "frame-02.png",
  "frame-03.png",
  "frame-04.png",
  "frame-05.png",
  "frame-06.png",
  "frame-07.png",
  "frame-08.png",
] as const;
type MockImageFile = typeof imageFiles[number] | "prop-ticket.png";

const storyboardBeats: StoryboardBeat[] = [
  { id: "rain-beat-01", versionId: "rain-beat-01-v1", title: "雨夜候车", description: "超远景建立深夜末班车站。林澄独自站在左侧候车亭，湿亮道路占据主要负空间，疲惫中隐约不安。" },
  { id: "rain-beat-02", versionId: "rain-beat-02-v1", title: "积水中的旧票", description: "物件近景。鞋尖、手与车票形成斜向动线，林澄疑惑地弯腰拾起积水边的旧车票。" },
  { id: "rain-beat-03", versionId: "rain-beat-03-v1", title: "父亲的字迹", description: "人物中近景，面部与手中车票形成对角关系，雨痕压在背景玻璃上。她认出失踪父亲的字迹，错愕而警觉。" },
  { id: "rain-beat-04", versionId: "rain-beat-04-v1", title: "雨幕后的车灯", description: "眼部特写，眼睛与远处双灯在雨幕中对照。她抬眼望向弯道上的车灯，用克制的恐惧制造翻页钩子。" },
  { id: "rain-beat-05", versionId: "rain-beat-05-v1", title: "无牌末班车", description: "低机位大景，公交车从右上压入画面，林澄在左下形成尺度对比。没有线路牌的车刹停在她面前，气氛压迫而迟疑。" },
  { id: "rain-beat-06", versionId: "rain-beat-06-v1", title: "晕开的警告", description: "微距特写，湿车票斜切画面，雨滴正在晕开字迹。林澄攥紧车票，墨迹在指尖化开，确认危险。" },
  { id: "rain-beat-07", versionId: "rain-beat-07-v1", title: "熟悉的小名", description: "司机近景被挡风玻璃和后视镜切割，林澄后脑处于前景。陌生司机叫出只有父亲使用的小名，温和却诡异。" },
  { id: "rain-beat-08", versionId: "rain-beat-08-v1", title: "车门前的拒绝", description: "横向全景，车门与林澄分居两侧，湿地反光构成明亮边界。林澄清醒地后退一步，不让自己跨过光带。" },
];

const storyboardDialogueById: Readonly<Record<string, string>> = {
  "rain-beat-01": "23:47。末班车迟到了七分钟。",
  "rain-beat-03": "这字……",
  "rain-beat-04": "别上最后一班车。",
  "rain-beat-05": "车却准时出现在雨里。",
  "rain-beat-07": "小澄，上车。",
  "rain-beat-08": "……你不是我爸。",
};

const frameLayout = [
  { page: 0, x: 40, y: 40, width: 640, height: 260 },
  { page: 0, x: 40, y: 320, width: 190, height: 330 },
  { page: 0, x: 250, y: 320, width: 430, height: 330 },
  { page: 0, x: 40, y: 670, width: 640, height: 370 },
  { page: 1, x: 40, y: 40, width: 390, height: 590 },
  { page: 1, x: 450, y: 40, width: 230, height: 270 },
  { page: 1, x: 450, y: 330, width: 230, height: 300 },
  { page: 1, x: 40, y: 650, width: 640, height: 390 },
] as const;

async function clearPreviousSample() {
  const projects = await prisma.project.findMany({ where: { chapter: { comicId: ids.comic } }, select: { id: true } });
  const projectIds = projects.map((item) => item.id);
  if (projectIds.length) {
    const taskIds = (await prisma.generationTask.findMany({ where: { projectId: { in: projectIds } }, select: { id: true } })).map((item) => item.id);
    const messageIds = (await prisma.message.findMany({ where: { projectId: { in: projectIds } }, select: { id: true } })).map((item) => item.id);
    await prisma.$transaction([
      prisma.candidate.deleteMany({ where: { projectId: { in: projectIds } } }),
      prisma.pageVariant.deleteMany({ where: { projectId: { in: projectIds } } }),
      prisma.generationAttempt.deleteMany({ where: { taskId: { in: taskIds } } }),
      prisma.generationTask.deleteMany({ where: { projectId: { in: projectIds } } }),
      prisma.messageReference.deleteMany({ where: { messageId: { in: messageIds } } }),
      prisma.message.deleteMany({ where: { projectId: { in: projectIds } } }),
      prisma.agentConversation.deleteMany({ where: { projectId: { in: projectIds } } }),
      prisma.canvasReferencePlacement.deleteMany({ where: { projectId: { in: projectIds } } }),
      prisma.assetVersion.deleteMany({ where: { asset: { projectId: { in: projectIds } } } }),
      prisma.asset.deleteMany({ where: { projectId: { in: projectIds } } }),
      prisma.storyboardBeatVersion.deleteMany({ where: { storyboardBeat: { projectId: { in: projectIds } } } }),
      prisma.storyboardBeat.deleteMany({ where: { projectId: { in: projectIds } } }),
      prisma.savedSnapshot.deleteMany({ where: { projectId: { in: projectIds } } }),
      prisma.workingRevision.deleteMany({ where: { projectId: { in: projectIds } } }),
      prisma.project.deleteMany({ where: { id: { in: projectIds } } }),
    ]);
  }
  await prisma.chapter.deleteMany({ where: { comicId: ids.comic } });
  await prisma.comic.deleteMany({ where: { id: ids.comic } });
}

function buildFrame(storyboardBeat: StoryboardBeat, index: number, dialogues: Dialogue[]): Frame {
  const sourceRect = frameLayout[index];
  const frameId = `rain-frame-${String(index + 1).padStart(2, "0")}`;
  const assetId = `rain-asset-frame-${String(index + 1).padStart(2, "0")}`;
  const layers: Frame["layers"] = [{
    id: `${frameId}-art`,
    kind: "art",
    name: "画面",
    zIndex: 10,
    visible: true,
    overflow: "clip",
    elements: [{
      id: `rain-image-${String(index + 1).padStart(2, "0")}`,
      kind: "image",
      assetId,
      assetVersionId: `${assetId}-v1`,
      transform: { x: 0, y: 0, width: 1, height: 1 },
      crop: { x: 0, y: 0, width: 1, height: 1 },
      name: `${storyboardBeat.title} · 画面`,
    }],
  }];
  const dialogueText = storyboardDialogueById[storyboardBeat.id];
  if (dialogueText) {
    const isNarration = index === 0 || index === 3 || index === 4;
    const width = Math.min(isNarration ? 280 : index === 6 ? 150 : 180, sourceRect.width - 24);
    const height = isNarration ? 58 : index === 6 ? 78 : 66;
    const dialogueId = `rain-dialogue-${index + 1}`;
    dialogues.push({ id: dialogueId, storyboardBeatId: storyboardBeat.id, storyboardBeatVersionId: storyboardBeat.versionId, content: dialogueText });
    layers.push({
      id: `${frameId}-text`,
      kind: "text",
      name: "对白与文字",
      zIndex: 20,
      visible: true,
      overflow: "visible",
      elements: [{
        id: `rain-balloon-${index + 1}`,
        kind: "balloon",
        dialogueId,
        transform: {
          x: isNarration ? 14 / sourceRect.width : (sourceRect.width - width - 12) / sourceRect.width,
          y: 14 / sourceRect.height,
          width: width / sourceRect.width,
          height: height / sourceRect.height,
        },
        ...(isNarration ? {} : { tailTarget: { x: .55, y: .48 } }),
        shape: isNarration ? "caption_box" : "normal",
        style: { fontFamily: "sans-serif", fontSize: isNarration ? 16 : 17, textColor: "#111", fill: "#fff", stroke: "#111", strokeWidth: 2, writingMode: "horizontal" },
        name: isNarration ? "旁白框" : "对白",
      }],
    });
  }
  return {
    id: frameId,
    geometry: { x: sourceRect.x, y: sourceRect.y, width: sourceRect.width, height: sourceRect.height },
    zIndex: index + 1,
    storyRefs: [{ storyboardBeatId: storyboardBeat.id, storyboardBeatVersionId: storyboardBeat.versionId, role: "primary" }],
    border: { color: "#151515", width: 3, style: "solid" },
    shape: { kind: "rect" },
    mask: { mode: "clip" },
    layers,
    name: `画格 ${String(index + 1).padStart(2, "0")}`,
  };
}

function buildDocument(stored: Map<string, StoredObject>): ComicDocument {
  const dialogues: Dialogue[] = [];
  const units: PresentationUnit[] = [0, 1].map((pageIndex) => {
    const frames = storyboardBeats.flatMap((storyboardBeat, index) => frameLayout[index].page === pageIndex ? [buildFrame(storyboardBeat, index, dialogues)] : []);
    const id = `rain-page-${String(pageIndex + 1).padStart(2, "0")}`;
    return {
      id,
      kind: "single_page",
      canvas: { width: 720, height: 1080, background: { color: "#ffffff" } },
      surfaces: [{ id: `${id}-surface`, role: "single", geometry: { x: 0, y: 0, width: 720, height: 1080 }, pageNumber: pageIndex + 1 }],
      frames,
      overlayLayers: [],
      readingSequence: frames.map((frame) => ({ frameId: frame.id })),
      layoutPolicy: { frameOverlap: "forbid", gutter: 20, defaultOverflow: "clip" },
    };
  });
  return {
    protocolVersion: "lcd-0.4",
    comicId: ids.comic,
    chapterId: ids.chapter,
    format: "page",
    reading: { direction: "ltr", viewer: "paged", unitOrder: units.map((unit) => unit.id), gap: 24, showPageNumber: true },
    units,
    resources: storyboardBeats.map((_, index) => {
      const assetId = `rain-asset-frame-${String(index + 1).padStart(2, "0")}`;
      const image = stored.get(`frame-${String(index + 1).padStart(2, "0")}.png`)!;
      return { assetId, assetVersionId: `${assetId}-v1`, kind: "image", width: image.width ?? 1024, height: image.height ?? 1024, mediaType: "image/png" } as const;
    }),
    dialogues,
  };
}

export async function seedRainyStation() {
  if (process.env.APP_ENV === "production") throw new Error("Refusing to create sample data in production");
  await prisma.user.upsert({
    where: { email: process.env.LANTERN_DEV_USER_EMAIL ?? "creator@lantern.local" },
    update: {},
    create: { id: ids.user, email: process.env.LANTERN_DEV_USER_EMAIL ?? "creator@lantern.local", displayName: "Lantern Creator" },
  });
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: process.env.LANTERN_DEV_USER_EMAIL ?? "creator@lantern.local" } });
  await clearPreviousSample();

  const stored = new Map<string, StoredObject>();
  for (const fileName of imageFiles) {
    const bytes = await readFile(path.join(process.cwd(), "public", "samples", "rainy-station", fileName));
    stored.set(fileName, await putImage(bytes, "mock/rainy-station"));
  }
  const ticketBytes = await readFile(path.join(process.cwd(), "public", "samples", "rainy-station", "frame-02.png"));
  stored.set("prop-ticket.png", await putImage(ticketBytes, "mock/rainy-station/props"));
  const now = new Date();
  const document = buildDocument(stored);
  const storyboardBeatHeads = Object.fromEntries(storyboardBeats.map((storyboardBeat) => [storyboardBeat.id, storyboardBeat.versionId]));
  const frameImageAssetHeads = Object.fromEntries(storyboardBeats.map((_, index) => {
    const assetId = `rain-asset-frame-${String(index + 1).padStart(2, "0")}`;
    return [assetId, `${assetId}-v1`];
  }));
  const assetHeads = {
    ...frameImageAssetHeads,
    "rain-asset-lincheng": "rain-asset-lincheng-v1",
    "rain-asset-bus-stop": "rain-asset-bus-stop-v1",
    "rain-asset-ticket": "rain-asset-ticket-v1",
  };

  await prisma.comic.create({ data: { id: ids.comic, ownerUserId: owner.id, title: "雨夜车站", summary: "深夜雨站，一张来自失踪父亲的旧车票，阻止林澄登上一辆没有线路牌的末班车。", worldSummary: "近未来都市里，失踪者会通过雨夜末班车留下无法解释的线索；车票与站牌记录着被抹去的路线。", format: ComicFormat.PAGE, readingDirection: "ltr", styleSummary: "日式轻线条黑白漫画，克制网点与雨夜留白，都市轻悬疑。", coverObjectKey: stored.get("scene-rain-bus-stop.png")!.objectKey, coverContentType: "image/png", coverWidth: stored.get("scene-rain-bus-stop.png")!.width, coverHeight: stored.get("scene-rain-bus-stop.png")!.height } });
  await prisma.chapter.create({ data: { id: ids.chapter, ownerUserId: owner.id, comicId: ids.comic, number: 1, title: "第 1 话 · 最后一班车", summary: "林澄在雨夜车站拾到父亲留下的警告，并拒绝登上叫出她小名的末班车。", coverObjectKey: stored.get("frame-01.png")!.objectKey, coverContentType: "image/png", coverWidth: stored.get("frame-01.png")!.width, coverHeight: stored.get("frame-01.png")!.height } });
  await prisma.project.create({ data: { id: ids.project, ownerUserId: owner.id, chapterId: ids.chapter, settings: { generationStyle: "日式轻线条黑白漫画", defaultImageSize: "1024*1536", storyBrief: "雨夜末班车与失踪父亲留下的警告" } } });
  await prisma.agentConversation.create({ data: { id: ids.conversation, ownerUserId: owner.id, projectId: ids.project, title: "雨夜车站 · 第一话创作" } });

  const contextSnapshot = { comic: { id: ids.comic, title: "雨夜车站" }, chapter: { id: ids.chapter, title: "第 1 话 · 最后一班车" }, workingRevision: 1, storyboardBeats: [], assets: [], recentConversation: [] };
  const taskRows = [
    { id: ids.storyboardTask, type: TaskType.STORYBOARD, key: "sample:rainy-station:storyboard", scope: "current_chapter", input: { instruction: "把《雨夜车站》拆成两页分镜条目，结尾保留悬念。" }, output: { kind: "storyboard", storyboardBeatCount: 8, story: "旧车票警告林澄不要登上末班车；陌生司机却叫出她的小名。" }, provider: "sample-seed", model: "lantern-authored-storyboard" },
    { id: ids.layoutTask, type: TaskType.PAGE_LAYOUT, key: "sample:rainy-station:layout", scope: "whole_chapter", input: { instruction: "编排成两页非均分页漫，第一页建立悬念，第二页突出车辆压迫感。" }, output: { kind: "page_layout", pages: 2, frameCount: 8, preset: "asymmetric-rain-night" }, provider: "internal", model: "lantern-layout-0.1" },
    { id: ids.imageTask, type: TaskType.FRAME_IMAGE_GENERATE, key: "sample:rainy-station:images", scope: "whole_chapter", input: { instruction: "为八个画格生成统一的日式轻线条黑白漫画格内成稿图。", source: "Codex built-in imagegen" }, output: { kind: "frame_images", assetCount: 8 }, provider: "codex-imagegen", model: "gpt-image-2" },
  ];
  for (const task of taskRows) {
    await prisma.generationTask.create({ data: { id: task.id, ownerUserId: owner.id, projectId: ids.project, conversationId: ids.conversation, type: task.type, status: TaskStatus.SUCCEEDED, idempotencyKey: task.key, baseRevision: task.type === TaskType.STORYBOARD ? 1 : task.type === TaskType.PAGE_LAYOUT ? 2 : 3, scope: task.scope, target: { type: task.type === TaskType.FRAME_IMAGE_GENERATE ? "chapter" : "chapter", id: ids.chapter }, input: task.input, contextSnapshot, output: task.output, provider: task.provider, model: task.model, progress: 100, completedAt: now, attempts: { create: { attempt: 1, status: TaskStatus.SUCCEEDED, responseMeta: { seeded: true }, completedAt: now } } } });
  }

  for (const storyboardBeat of storyboardBeats) {
    await prisma.storyboardBeat.create({ data: { id: storyboardBeat.id, ownerUserId: owner.id, projectId: ids.project, versions: { create: { id: storyboardBeat.versionId, version: 1, title: storyboardBeat.title, description: storyboardBeat.description, sourceTaskId: ids.storyboardTask } } } });
  }

  const createAsset = async (asset: { id: string; versionId: string; kind: AssetKind; name: string; description: string; attributes: Prisma.InputJsonValue; fileName: MockImageFile; sourceTaskId?: string }) => {
    const image = stored.get(asset.fileName)!;
    await prisma.asset.create({ data: { id: asset.id, ownerUserId: owner.id, projectId: ids.project, kind: asset.kind, name: asset.name, description: asset.description, attributes: asset.attributes, versions: { create: { id: asset.versionId, version: 1, objectKey: image.objectKey, contentType: image.contentType, byteSize: image.byteSize, width: image.width, height: image.height, checksum: image.checksum, source: "codex-imagegen", sourceTaskId: asset.sourceTaskId } } } });
  };
  await createAsset({ id: "rain-asset-lincheng", versionId: "rain-asset-lincheng-v1", kind: AssetKind.CHARACTER, name: "林澄", description: "22 岁，肩长湿黑发，浅色风衣与帆布肩包；疲惫但观察敏锐。", attributes: { identity: "肩长直黑发、浅色长风衣、深色针织上衣、帆布肩包", age: "22", temperament: "冷静、敏锐、克制", currentState: "深夜下班后，衣发被雨打湿" }, fileName: "character-lincheng.png", sourceTaskId: ids.imageTask });
  await createAsset({ id: "rain-asset-bus-stop", versionId: "rain-asset-bus-stop-v1", kind: AssetKind.SCENE, name: "梧桐路末班车站", description: "窄雨棚、玻璃侧板、长椅与弯入远处的湿亮道路。", attributes: { spatialLayout: "候车亭在道路左侧，站牌靠近路缘，弯道从右侧远处进入", time: "23:47", weather: "持续大雨", mood: "空旷、轻微异常" }, fileName: "scene-rain-bus-stop.png", sourceTaskId: ids.imageTask });
  await createAsset({ id: "rain-asset-ticket", versionId: "rain-asset-ticket-v1", kind: AssetKind.PROP, name: "父亲的旧车票", description: "被雨浸湿的旧式纸车票，背面留有父亲的警告。", attributes: { state: "湿润、边角磨损、墨迹正在晕开", narrativeRole: "警告林澄不要登车" }, fileName: "prop-ticket.png", sourceTaskId: ids.imageTask });
  for (const [index] of storyboardBeats.entries()) {
    const suffix = String(index + 1).padStart(2, "0");
    await createAsset({ id: `rain-asset-frame-${suffix}`, versionId: `rain-asset-frame-${suffix}-v1`, kind: AssetKind.GENERATED_IMAGE, name: `雨夜车站 · 格内成稿图 ${suffix}`, description: storyboardBeats[index].title, attributes: { page: index < 4 ? 1 : 2, readingOrder: index + 1, style: "日式轻线条黑白漫画" }, fileName: `frame-${suffix}.png` as MockImageFile, sourceTaskId: ids.imageTask });
  }
  await prisma.canvasReferencePlacement.createMany({ data: [
    { id: "rain-reference-lincheng", ownerUserId: owner.id, projectId: ids.project, assetId: "rain-asset-lincheng", assetVersionId: "rain-asset-lincheng-v1", x: 250, y: 80, zoom: .86, zIndex: 12, pinned: true },
    { id: "rain-reference-bus-stop", ownerUserId: owner.id, projectId: ids.project, assetId: "rain-asset-bus-stop", assetVersionId: "rain-asset-bus-stop-v1", x: 248, y: 310, zoom: .78, zIndex: 11, pinned: false },
    { id: "rain-reference-ticket", ownerUserId: owner.id, projectId: ids.project, assetId: "rain-asset-ticket", assetVersionId: "rain-asset-ticket-v1", x: 380, y: 570, zoom: .62, zIndex: 13, pinned: false },
  ] });

  const firstUnit = document.units[0];
  const blankDocument: ComicDocument = { ...document, reading: { ...document.reading, unitOrder: firstUnit ? [firstUnit.id] : [] }, units: firstUnit ? [{ ...firstUnit, frames: [], overlayLayers: [], readingSequence: [] }] : [], resources: [], dialogues: [] };
  await prisma.workingRevision.createMany({ data: [
    { projectId: ids.project, revision: 1, document: blankDocument as unknown as Prisma.InputJsonValue, storyboardBeats: [], storyboardBeatVersionHeads: {}, assetVersionHeads: {}, changeSet: { id: "rain-create", source: "manual", operations: [] } },
    { projectId: ids.project, revision: 2, document: blankDocument as unknown as Prisma.InputJsonValue, storyboardBeats: storyboardBeats as unknown as Prisma.InputJsonValue, storyboardBeatVersionHeads: storyboardBeatHeads, assetVersionHeads: {}, changeSet: { id: "rain-storyboard-apply", source: "candidate", sourceCandidateId: "candidate-rain-storyboard", operations: [{ type: "replace_storyboard_beats" }] }, sourceCandidateId: "candidate-rain-storyboard" },
    { projectId: ids.project, revision: 3, document: document as unknown as Prisma.InputJsonValue, storyboardBeats: storyboardBeats as unknown as Prisma.InputJsonValue, storyboardBeatVersionHeads: storyboardBeatHeads, assetVersionHeads: assetHeads, changeSet: { id: "rain-layout-apply", source: "candidate", sourceCandidateId: "candidate-rain-layout", commands: [{ type: "replace_chapter_presentation" }] }, sourceCandidateId: "candidate-rain-layout" },
  ] });
  await prisma.savedSnapshot.create({ data: { ownerUserId: owner.id, chapterId: ids.chapter, projectId: ids.project, sourceWorkingRevision: 3, document: document as unknown as Prisma.InputJsonValue, storyboardBeatVersions: storyboardBeatHeads, assetVersions: assetHeads } });

  await prisma.candidate.createMany({ data: [
    { id: "candidate-rain-storyboard", ownerUserId: owner.id, projectId: ids.project, conversationId: ids.conversation, taskId: ids.storyboardTask, kind: CandidateKind.STORYBOARD, status: CandidateStatus.APPLIED, title: "雨夜警告 · 八个分镜条目", changeSummary: "把拾票、识字、来车、拒绝登车拆为两页八个分镜条目。", targetLabel: "第 1 话", target: { type: "chapter", id: ids.chapter }, baseRevision: 1, sourceRefs: [], outputRefs: storyboardBeats.map((storyboardBeat) => ({ objectType: "storyboard_beat", objectId: storyboardBeat.id, versionId: storyboardBeat.versionId })), payload: { storyboardBeats }, operations: [{ type: "replace_storyboard_beats", count: 8 }], appliedRevision: 2 },
    { id: "candidate-rain-layout", ownerUserId: owner.id, projectId: ids.project, conversationId: ids.conversation, taskId: ids.layoutTask, kind: CandidateKind.PAGE_LAYOUT, status: CandidateStatus.APPLIED, title: "两页不对称雨夜编排", changeSummary: "第一页逐步收紧线索，第二页用一格竖向大画面压住车辆到站。", targetLabel: "Page 01–02", target: { type: "chapter", id: ids.chapter }, baseRevision: 2, sourceRefs: storyboardBeats.map((storyboardBeat) => ({ objectType: "storyboard_beat", objectId: storyboardBeat.id, versionId: storyboardBeat.versionId })), outputRefs: document.units.map((unit) => ({ objectType: "presentation_unit", objectId: unit.id })), payload: { pageCount: 2, frameCount: 8 }, operations: [{ type: "replace_chapter_presentation", document }], appliedRevision: 3 },
  ] });

  const messages = [
    { role: MessageRole.USER, kind: MessageKind.PLAIN, content: "我想做一个雨夜末班车的轻悬疑短篇：女主捡到失踪父亲留下的车票。先完成两页。", metadata: { intent: "分镜", scope: "当前一话" } },
    { role: MessageRole.AGENT, kind: MessageKind.TASK, content: "已完成故事分镜条目：两页八个画格的叙事节奏，第一页在警告与车灯处翻页，第二页让女主主动拒绝登车。", metadata: { taskId: ids.storyboardTask, taskType: "storyboard", resolved: true } },
    { role: MessageRole.USER, kind: MessageKind.PLAIN, content: "不要做成横切四格，页面节奏要有大格和窄格，车到站时要有压迫感。", metadata: { intent: "编排", scope: "整话" } },
    { role: MessageRole.AGENT, kind: MessageKind.TASK, content: "编排与画面均已应用：Page 01 由宽景、窄物件格、人物格和翻页钩子组成；Page 02 使用左侧竖向大格、右侧两格细节与底部收束格。", metadata: { taskId: ids.layoutTask, taskType: "page_layout", resolved: true, imageTaskId: ids.imageTask } },
    { role: MessageRole.AGENT, kind: MessageKind.PLAIN, content: "《雨夜车站》第 1 话已经保存为两页工作稿。角色林澄、梧桐路末班车站与父亲的旧车票也已进入资产。", metadata: { workingRevision: 3, snapshot: true } },
  ];
  for (const [index, message] of messages.entries()) {
    await prisma.message.create({ data: { ownerUserId: owner.id, projectId: ids.project, conversationId: ids.conversation, role: message.role, kind: message.kind, content: message.content, metadata: message.metadata, createdAt: new Date(now.getTime() - (messages.length - index) * 60_000) } });
  }
  await prisma.agentConversation.update({ where: { id: ids.conversation }, data: { updatedAt: now } });
  await prisma.comic.update({ where: { id: ids.comic }, data: { updatedAt: now } });
  console.log(`Created comic ${ids.comic}, chapter ${ids.chapter}, project ${ids.project}`);
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  seedRainyStation()
    .then(async () => prisma.$disconnect())
    .catch(async (error) => {
      console.error(error instanceof Error ? error.stack ?? error.message : error);
      await prisma.$disconnect();
      process.exit(1);
    });
}

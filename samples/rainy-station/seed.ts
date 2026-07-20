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
import { validateComicDocument, type ComicDocument, type Dialogue, type Frame, type PresentationUnit, type StoryboardBeat } from "../../packages/shared/src";
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

export const storyboardBeats: StoryboardBeat[] = [
  { id: "rain-beat-01", versionId: "rain-beat-01-v1", title: "建立深夜末班车站与孤立感", description: "镜头：超远景；构图：林澄置于左侧候车亭，湿亮道路占据主要负空间；画面：林澄在雨棚下等待迟到的末班车；氛围：疲惫、隐约不安" },
  { id: "rain-beat-02", versionId: "rain-beat-02-v1", title: "让旧车票进入故事", description: "镜头：物件近景；构图：鞋尖、手与车票形成斜向动线；画面：林澄弯腰拾起积水边的旧车票；氛围：疑惑" },
  { id: "rain-beat-03", versionId: "rain-beat-03-v1", title: "把普通发现转为私人线索", description: "镜头：人物中近景；构图：面部与手中车票形成对角关系，雨痕压在背景玻璃上；画面：她翻过车票，认出失踪父亲的字迹；氛围：错愕、警觉" },
  { id: "rain-beat-04", versionId: "rain-beat-04-v1", title: "以警告和远处车灯制造翻页钩子", description: "镜头：眼部特写；构图：眼睛占据左侧，远处双灯在右侧雨幕中出现；画面：她抬眼望向弯道上出现的车灯；氛围：克制的恐惧" },
  { id: "rain-beat-05", versionId: "rain-beat-05-v1", title: "让警告对象具体到站", description: "镜头：低机位大景；构图：公交车从右上压入画面，林澄在左下形成尺度对比；画面：没有线路牌的末班车刹停在她面前；氛围：压迫、迟疑" },
  { id: "rain-beat-06", versionId: "rain-beat-06-v1", title: "再次确认票面警告", description: "镜头：微距特写；构图：湿车票斜切画面，雨滴正在晕开字迹；画面：林澄攥紧车票，墨迹在指尖化开；氛围：确认危险" },
  { id: "rain-beat-07", versionId: "rain-beat-07-v1", title: "用熟悉称呼制造错误身份", description: "镜头：司机近景；构图：司机被挡风玻璃和后视镜切割，林澄后脑处于前景；画面：陌生司机转头，叫出只有父亲使用的小名；氛围：温和却诡异" },
  { id: "rain-beat-08", versionId: "rain-beat-08-v1", title: "让主角主动拒绝并留下续写钩子", description: "镜头：横向全景；构图：车门与林澄分居两侧，湿地反光构成明亮边界；画面：林澄后退一步，不让自己跨过车门前的光带；氛围：清醒、坚定" },
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
  { page: 0, x: 39.17395104895105, y: 37.88243006993007, width: 640, height: 260 },
  { page: 0, x: 40, y: 320, width: 190, height: 330 },
  { page: 0, x: 250, y: 320, width: 430, height: 330 },
  { page: 0, x: 40, y: 670, width: 640, height: 370 },
  { page: 1, x: 40, y: 40, width: 390, height: 590 },
  { page: 1, x: 450, y: 40, width: 230, height: 270 },
  { page: 1, x: 450.3802447552447, y: 330.7604895104895, width: 230, height: 300 },
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
      prisma.generationAttempt.deleteMany({ where: { taskId: { in: taskIds } } }),
      prisma.generationTask.deleteMany({ where: { projectId: { in: projectIds } } }),
      prisma.messageReference.deleteMany({ where: { messageId: { in: messageIds } } }),
      prisma.message.deleteMany({ where: { projectId: { in: projectIds } } }),
      prisma.agentConversation.deleteMany({ where: { projectId: { in: projectIds } } }),
      prisma.canvasReferencePlacement.deleteMany({ where: { projectId: { in: projectIds } } }),
      prisma.canvasAssetListItem.deleteMany({ where: { projectId: { in: projectIds } } }),
      prisma.assetImage.deleteMany({ where: { asset: { projectId: { in: projectIds } } } }),
      prisma.asset.updateMany({ where: { projectId: { in: projectIds } }, data: { variantOfAssetId: null } }),
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
  await prisma.comicSetting.deleteMany({ where: { comicId: ids.comic } });
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
      crop: index === 0
        ? { x: 0.05153518356643357, y: 0.01500907746100054, width: 0.92, height: 0.92 }
        : index === 2
          ? { x: 0.02393946170108961, y: 0.02275508582326764, width: 0.92, height: 0.92 }
          : { x: 0, y: 0, width: 1, height: 1 },
      name: `${storyboardBeat.title} · 画面`,
    }],
  }];
  const dialogueText = storyboardDialogueById[storyboardBeat.id];
  if (dialogueText) {
    const isNarration = index === 0 || index === 3 || index === 4;
    const presentations: Record<number, { transform: { x: number; y: number; width: number; height: number }; shape: "caption_box" | "normal" | "thought"; tailTarget?: { x: number; y: number } }> = {
      0: { transform: { x: 0.04651100852272727, y: 0.07558162990855294, width: 0.4375, height: 0.2230769230769231 }, shape: "caption_box" as const },
      2: { transform: { x: 0.4777291022930558, y: 0.6465048209366391, width: 0.4002480078061474, height: 0.2025826446280991 }, shape: "thought" as const, tailTarget: { x: 0.558801437996828, y: 0.6004418229674419 } },
      3: { transform: { x: 0.0738001256555944, y: 0.04333065583065583, width: 0.4375, height: 0.1567567567567568 }, shape: "caption_box" as const },
      4: { transform: { x: 0.03589743589743589, y: 0.02372881355932203, width: 0.717948717948718, height: 0.09830508474576272 }, shape: "caption_box" as const },
      6: { transform: { x: 0.05118387047734863, y: 0.4941520979020978, width: 0.6521739130434783, height: 0.26 }, shape: "normal" as const, tailTarget: { x: 0.4212073696084478, y: 0.4502666044829606 } },
      7: { transform: { x: 0.3009069055944055, y: 0.05418683880222341, width: 0.28125, height: 0.1692307692307692 }, shape: "normal" as const, tailTarget: { x: 0.3253081192302826, y: 0.246340666409451 } },
    };
    const presentation = presentations[index]!;
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
        transform: presentation.transform,
        ...(presentation.tailTarget ? { tailTarget: presentation.tailTarget } : {}),
        shape: presentation.shape,
        style: { fontFamily: "sans-serif", fontSize: isNarration ? 16 : 17, textColor: "#111", fill: "#fff", stroke: "#111", strokeWidth: 2, writingMode: "horizontal" },
        name: isNarration ? "旁白框" : "对白",
      }],
    });
  }
  return {
    id: frameId,
    geometry: { x: sourceRect.x, y: sourceRect.y, width: sourceRect.width, height: sourceRect.height },
    zIndex: 1,
    storyRefs: [{ storyboardBeatId: storyboardBeat.id, storyboardBeatVersionId: storyboardBeat.versionId, role: "primary" }],
    border: { color: "#151515", width: 3, style: "solid" },
    shape: { kind: "rect" },
    mask: { mode: "clip" },
    layers,
    name: `画格 ${String(index + 1).padStart(2, "0")}`,
  };
}

export function buildRainyStationDocument(stored: ReadonlyMap<string, StoredObject>): ComicDocument {
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
      layoutPolicy: { frameOverlap: "forbid", defaultOverflow: "clip" },
    };
  });
  return validateComicDocument({
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
  });
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
  const document = buildRainyStationDocument(stored);
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

  const createAsset = async (asset: { id: string; versionId: string; kind: AssetKind; name: string; description: string; fileName: MockImageFile; sourceTaskId?: string }) => {
    const image = stored.get(asset.fileName)!;
    await prisma.asset.create({ data: { id: asset.id, ownerUserId: owner.id, projectId: ids.project, kind: asset.kind, name: asset.name, description: asset.description, versions: { create: { id: asset.versionId, version: 1, objectKey: image.objectKey, contentType: image.contentType, byteSize: image.byteSize, width: image.width, height: image.height, checksum: image.checksum, source: "codex-imagegen", sourceTaskId: asset.sourceTaskId } } } });
    await prisma.assetImage.create({ data: { assetId: asset.id, assetVersionId: asset.versionId, label: "主图", sortIndex: 0 } });
  };
  await createAsset({ id: "rain-asset-lincheng", versionId: "rain-asset-lincheng-v1", kind: AssetKind.CHARACTER, name: "林澄", description: "22 岁，肩长直黑发，穿浅色长风衣与深色针织上衣，随身背帆布肩包。她冷静、敏锐而克制，深夜下班后衣发被雨打湿，疲惫但仍保持观察。", fileName: "character-lincheng.png", sourceTaskId: ids.imageTask });
  await createAsset({ id: "rain-asset-bus-stop", versionId: "rain-asset-bus-stop-v1", kind: AssetKind.SCENE, name: "梧桐路末班车站", description: "23:47 的持续大雨中，候车亭位于道路左侧，窄雨棚、玻璃侧板、长椅与靠近路缘的站牌组成主体；湿亮道路从右侧远处弯入，空间空旷并带有轻微异常感。", fileName: "scene-rain-bus-stop.png", sourceTaskId: ids.imageTask });
  await createAsset({ id: "rain-asset-ticket", versionId: "rain-asset-ticket-v1", kind: AssetKind.PROP, name: "父亲的旧车票", description: "被雨浸湿的旧式纸车票，边角磨损，墨迹正在晕开；背面留有父亲写给林澄的登车警告。", fileName: "prop-ticket.png", sourceTaskId: ids.imageTask });
  for (const [index] of storyboardBeats.entries()) {
    const suffix = String(index + 1).padStart(2, "0");
    await createAsset({ id: `rain-asset-frame-${suffix}`, versionId: `rain-asset-frame-${suffix}-v1`, kind: AssetKind.GENERATED_IMAGE, name: `雨夜车站 · 格内成稿图 ${suffix}`, description: storyboardBeats[index].title, fileName: `frame-${suffix}.png` as MockImageFile, sourceTaskId: ids.imageTask });
  }
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

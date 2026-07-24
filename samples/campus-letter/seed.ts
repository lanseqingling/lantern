import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  AssetKind,
  AssetVersionOrigin,
  CandidateKind,
  CandidateStatus,
  ComicFormat,
  MessageKind,
  MessageRole,
  ReadingDirection,
  TaskStatus,
  TaskType,
  type Prisma,
} from "@prisma/client";
import {
  validateComicDocument,
  type ComicDocument,
  type Dialogue,
  type Frame,
  type PresentationUnit,
  type StoryboardBeat,
} from "@lantern/shared";
import { prisma } from "@lantern/server/db";
import { LOCAL_USER_DISPLAY_NAME, LOCAL_USER_EMAIL, LOCAL_USER_ID } from "@lantern/server/local-runtime";
import { clearImageNamespace, putImage, type StoredObject } from "@lantern/server/object-storage";

const ids = {
  user: "user-local-creator",
  comic: "comic-campus-letter",
  chapter: "chapter-campus-letter-01",
  project: "project-campus-letter-01",
  conversation: "conversation-campus-letter-main",
  storyboardTask: "task-campus-letter-storyboard",
  layoutTask: "task-campus-letter-layout",
  imageTask: "task-campus-letter-images",
};

const imageFiles = [
  "character-xiakui.png",
  "classroom-lesson-v2.png",
  "classroom-turn-v2.png",
  "bag-letter-v2.png",
  "classroom-after-bell-v2.png",
  "letter-from-black-bag-closeup-v10.png",
  "window-tree-shadow-v4.png",
  "breakout-rendezvous-v2.png",
  "breakout-rendezvous-crown-v2.png",
  "spread-rendezvous-girls-v3.png",
  "rendezvous-running-step.png",
  "rendezvous-friend-closeup-v3.png",
  "spread-birds-v3.png",
] as const;
type CampusImageFile = typeof imageFiles[number];

const assetByFile: Readonly<Record<CampusImageFile, { id: string; kind: AssetKind; name: string; description: string }>> = {
  "character-xiakui.png": { id: "campus-asset-xiakui", kind: AssetKind.CHARACTER, name: "夏葵", description: "16 岁，黑色长直发与轻薄刘海，穿夏季水手领校服，背深色书包。安静克制，不轻易表露期待。" },
  "classroom-lesson-v2.png": { id: "campus-asset-classroom-lesson", kind: AssetKind.SCENE, name: "午后课堂", description: "老师在黑板前写字，夏葵坐在靠窗后排；左侧窗光、课桌方向与后续镜头保持连续。" },
  "classroom-turn-v2.png": { id: "campus-asset-classroom-turn", kind: AssetKind.GENERATED_IMAGE, name: "座位上的回头", description: "夏葵仍坐在靠窗座位，回头看向椅背书包；构图和人设延续首页宣传图的轻校园日漫语言。" },
  "bag-letter-v2.png": { id: "campus-asset-flower-envelope", kind: AssetKind.PROP, name: "花印信封", description: "深色书包拉链间露出一角白色信封，只带一个小花封印，没有署名或可读文字。" },
  "classroom-after-bell-v2.png": { id: "campus-asset-after-bell", kind: AssetKind.GENERATED_IMAGE, name: "铃声之后", description: "同一间教室逐渐安静，夏葵在原座位拿起尚未拆开的信封。" },
  "letter-from-black-bag-closeup-v10.png": { id: "campus-asset-letter-in-hand", kind: AssetKind.GENERATED_IMAGE, name: "手中的信", description: "夏葵仍坐在自己的座位，俯视腿上半开的黑色尼龙书包，拇指与食指轻捏刚取出的花印信封。" },
  "window-tree-shadow-v4.png": { id: "campus-asset-window-shadow", kind: AssetKind.SCENE, name: "窗外树影", description: "教室窗帘被风轻轻带起，树影落在玻璃与窗台上；以无人静景承接赴约前的停顿。" },
  "breakout-rendezvous-v2.png": { id: "campus-asset-breakout-panel", kind: AssetKind.GENERATED_IMAGE, name: "风里的决定", description: "腰部以上的夏葵抬手理发，背着书包；人物画风和构图接近首页宣传图。" },
  "breakout-rendezvous-crown-v2.png": { id: "campus-asset-breakout-crown", kind: AssetKind.GENERATED_IMAGE, name: "风里的决定 · 发冠层", description: "从主画面同源提取的发冠遮线层，只让完整头顶越过画格上沿，不处理整个人物或细碎发梢。" },
  "spread-rendezvous-girls-v3.png": { id: "campus-asset-playground-rendezvous", kind: AssetKind.SCENE, name: "旧看台的约定", description: "Page 03–04 真双页操场；夏葵从左页跑向右页旧看台旁等待的女同学，中缝只经过天空与跑道。" },
  "rendezvous-running-step.png": { id: "campus-asset-rendezvous-running-step", kind: AssetKind.GENERATED_IMAGE, name: "赴约的脚步", description: "低机位跑道特写。夏葵穿黑色长袜与黑色校鞋踏上跑道线，书包随步伐摆动，以轻网点和疏朗速度线承接跨页赴约。" },
  "rendezvous-friend-closeup-v3.png": { id: "campus-asset-rendezvous-friend", kind: AssetKind.CHARACTER, name: "旧看台旁的同学", description: "扎短马尾的女同学在旧看台旁回头，神情只保留轻微的确认。" },
  "spread-birds-v3.png": { id: "campus-asset-spread-birds", kind: AssetKind.GENERATED_IMAGE, name: "越过中缝的飞鸟", description: "五只疏朗飞鸟组成跨页弧线，以正片叠底方式落在双页天空。" },
};

export const storyboardBeats: StoryboardBeat[] = [
  { id: "campus-beat-01", versionId: "campus-beat-01-v1", title: "午后课堂", description: "课堂仍在继续。夏葵坐在靠窗后排，老师背对学生在黑板上写字。" },
  { id: "campus-beat-02", versionId: "campus-beat-02-v1", title: "回头", description: "夏葵没有离开座位，只回头看向椅背上的书包。" },
  { id: "campus-beat-03", versionId: "campus-beat-03-v1", title: "花印信封", description: "书包拉链间露出没有署名的白色信封，小花封印成为唯一线索。" },
  { id: "campus-beat-04", versionId: "campus-beat-04-v1", title: "铃声之后", description: "学生离开后，夏葵仍在原座位，拿起信封。里面只写着地点与时间。" },
  { id: "campus-beat-05", versionId: "campus-beat-05-v1", title: "手中的信", description: "夏葵半托着没有署名的花印信封；窗外树影被风轻轻推过玻璃。" },
  { id: "campus-beat-06", versionId: "campus-beat-06-v1", title: "风还没停", description: "夏葵背起书包，抬手理过被风吹起的头发；发冠越过画格上沿。" },
  { id: "campus-beat-07", versionId: "campus-beat-07-v1", title: "旧看台", description: "真双页操场大景。夏葵从左页跑向右页旧看台旁等待的女同学，越过中缝的只有天空、跑道与飞鸟。" },
  { id: "campus-beat-08", versionId: "campus-beat-08-v1", title: "赴约", description: "女同学在旧看台旁回头，两人只用最短的问候确认这场约定。" },
];

const fullCrop = { x: 0, y: 0, width: 1, height: 1 } as const;
const balloonStyle = (fontSize: number) => ({ fontFamily: "Lantern Sans", fontSize, textColor: "#111111", fill: "#ffffff", stroke: "#111111", strokeWidth: 2, writingMode: "horizontal" as const });

type FrameSpec = {
  number: number;
  beatIndex: number;
  assetId: string;
  geometry: { x: number; y: number; width: number; height: number };
  zIndex: number;
  crop?: { x: number; y: number; width: number; height: number };
  dialogue?: {
    content: string;
    transform: { x: number; y: number; width: number; height: number };
    shape: "normal" | "thought" | "caption_box";
    tailTarget?: { x: number; y: number };
    fontSize?: number;
    name?: string;
  };
  surfaceScope?: "unit";
  border?: "solid" | "none";
};

function buildFrame(spec: FrameSpec, dialogues: Dialogue[]): Frame {
  const suffix = String(spec.number).padStart(2, "0");
  const frameId = `campus-frame-${suffix}`;
  const beat = storyboardBeats[spec.beatIndex];
  const layers: Frame["layers"] = [{
    id: `${frameId}-art`, kind: "art", name: "画面", zIndex: 10, visible: true, overflow: "clip",
    elements: [{ id: `campus-image-${suffix}`, kind: "image", assetId: spec.assetId, assetVersionId: `${spec.assetId}-v1`, transform: fullCrop, crop: spec.crop ?? fullCrop, name: `${beat.title} · 主图` }],
  }];
  if (spec.dialogue) {
    const dialogueId = `campus-dialogue-${suffix}`;
    dialogues.push({ id: dialogueId, storyboardBeatId: beat.id, storyboardBeatVersionId: beat.versionId, content: spec.dialogue.content });
    layers.push({
      id: `${frameId}-text`, kind: "text", name: "对白与文字", zIndex: 20, visible: true, overflow: "visible",
      elements: [{ id: `campus-balloon-${suffix}`, kind: "balloon", dialogueId, transform: spec.dialogue.transform, shape: spec.dialogue.shape, ...(spec.dialogue.tailTarget ? { tailTarget: spec.dialogue.tailTarget } : {}), style: balloonStyle(spec.dialogue.fontSize ?? 16), name: spec.dialogue.name ?? (spec.dialogue.shape === "caption_box" ? "旁白框" : "对白") }],
    });
  }
  return {
    id: frameId,
    geometry: spec.geometry,
    zIndex: spec.zIndex,
    ...(spec.surfaceScope ? { surfaceScope: spec.surfaceScope } : {}),
    storyRefs: [{ storyboardBeatId: beat.id, storyboardBeatVersionId: beat.versionId, role: "primary" }],
    border: { color: "#151515", width: spec.border === "none" ? 0 : 3, style: spec.border ?? "solid" },
    shape: { kind: "rect" },
    mask: { mode: "clip" },
    layers,
    name: `画格 ${suffix}`,
  };
}

export function buildCampusLetterDocument(stored: ReadonlyMap<CampusImageFile, StoredObject>): ComicDocument {
  const dialogues: Dialogue[] = [];
  const page1Frames = [
    buildFrame({ number: 1, beatIndex: 0, assetId: "campus-asset-classroom-lesson", geometry: { x: 35, y: 35, width: 650, height: 300 }, zIndex: 1 }, dialogues),
    buildFrame({ number: 2, beatIndex: 1, assetId: "campus-asset-classroom-turn", geometry: { x: 35, y: 355, width: 465, height: 465 }, zIndex: 2 }, dialogues),
    buildFrame({ number: 3, beatIndex: 2, assetId: "campus-asset-flower-envelope", geometry: { x: 520, y: 355, width: 165, height: 465 }, zIndex: 3 }, dialogues),
    buildFrame({ number: 4, beatIndex: 2, assetId: "campus-asset-flower-envelope", geometry: { x: 35, y: 840, width: 650, height: 205 }, zIndex: 4 }, dialogues),
  ];
  const page1: PresentationUnit = {
    id: "campus-page-01", name: "Page 01", kind: "single_page", pageRole: "story",
    canvas: { width: 720, height: 1080, background: { color: "#ffffff" } },
    surfaces: [{ id: "campus-page-01-surface", name: "Page 01", role: "single", geometry: { x: 0, y: 0, width: 720, height: 1080 }, pageNumber: 1 }],
    frames: page1Frames, overlayLayers: [], readingSequence: page1Frames.map((frame) => ({ frameId: frame.id })),
    layoutPolicy: { frameOverlap: "forbid", gutter: 20, defaultOverflow: "clip" },
  };

  const page2Frames = [
    buildFrame({ number: 5, beatIndex: 3, assetId: "campus-asset-after-bell", geometry: { x: 40, y: 40, width: 640, height: 330 }, zIndex: 1 }, dialogues),
    buildFrame({ number: 6, beatIndex: 4, assetId: "campus-asset-letter-in-hand", geometry: { x: 40, y: 390, width: 300, height: 210 }, zIndex: 2, crop: { x: 0.0563387056958035, y: 0, width: 0.8038186387529933, height: 0.8038186387529933 } }, dialogues),
    buildFrame({ number: 7, beatIndex: 4, assetId: "campus-asset-window-shadow", geometry: { x: 360, y: 390, width: 320, height: 210 }, zIndex: 3, crop: { x: 0.1772824494643256, y: 0.2211066844855711, width: 0.6669768108584753, height: 0.6669768108584753 } }, dialogues),
    buildFrame({ number: 8, beatIndex: 5, assetId: "campus-asset-breakout-panel", geometry: { x: 40, y: 625, width: 640, height: 420 }, zIndex: 4 }, dialogues),
  ];
  page2Frames[3].layers[0].elements[0].transform = { x: 0, y: -.2, width: 1, height: 1.2 };
  const page2CaptionId = "campus-dialogue-06";
  dialogues.push({ id: page2CaptionId, storyboardBeatId: storyboardBeats[3].id, storyboardBeatVersionId: storyboardBeats[3].versionId, content: "旧看台。\n放学后。" });
  const page2: PresentationUnit = {
    id: "campus-page-02", name: "Page 02", kind: "single_page", pageRole: "story",
    canvas: { width: 720, height: 1080, background: { color: "#ffffff" } },
    surfaces: [{ id: "campus-page-02-surface", name: "Page 02", role: "single", geometry: { x: 0, y: 0, width: 720, height: 1080 }, pageNumber: 2 }],
    frames: page2Frames,
    overlayLayers: [
      {
        id: "campus-page-02-breakout", name: "发冠破格", zIndex: 5, visible: true, anchor: { type: "frame", frameId: "campus-frame-08" }, purpose: "breakout",
        elements: [{ id: "campus-breakout-crown", kind: "image", assetId: "campus-asset-breakout-crown", assetVersionId: "campus-asset-breakout-crown-v1", transform: { x: 0, y: -.2, width: 1, height: 1.2 }, crop: fullCrop, overflow: "visible", name: "破格图 01" }],
      },
      {
        id: "campus-page-02-caption", name: "纸面内容", zIndex: 7, visible: true, anchor: { type: "unit" }, purpose: "page_content", surfaceId: "campus-page-02-surface",
        elements: [{ id: "campus-balloon-06", kind: "balloon", dialogueId: page2CaptionId, transform: { x: 380.986451048951, y: 413.5786713286714, width: 155.0887237762238, height: 51.51800699300699 }, shape: "caption_box", style: balloonStyle(14), name: "旁白框" }],
      },
    ],
    readingSequence: page2Frames.map((frame) => ({ frameId: frame.id })),
    layoutPolicy: { frameOverlap: "allow", gutter: 20, defaultOverflow: "clip" },
  };

  const crossRightId = "campus-dialogue-spread-right";
  dialogues.push({ id: crossRightId, storyboardBeatId: storyboardBeats[7].id, storyboardBeatVersionId: storyboardBeats[7].versionId, speakerAssetId: "campus-asset-rendezvous-friend", content: "你来了。" });
  const spreadFrames = [
    buildFrame({ number: 9, beatIndex: 6, assetId: "campus-asset-playground-rendezvous", geometry: { x: 35, y: 35.43822674418605, width: 1370, height: 1010 }, zIndex: 1, surfaceScope: "unit" }, dialogues),
    buildFrame({ number: 10, beatIndex: 6, assetId: "campus-asset-rendezvous-running-step", geometry: { x: 63.00581395348826, y: 68.8466569767441, width: 178.1184593023256, height: 260.5566860465116 }, zIndex: 3, surfaceScope: "unit", crop: { x: 0, y: 0.06861415908469679, width: 0.92, height: 0.92 } }, dialogues),
    buildFrame({ number: 11, beatIndex: 7, assetId: "campus-asset-rendezvous-friend", geometry: { x: 1020.241279069768, y: 756.3059593023257, width: 334.7056686046512, height: 233.9658430232558 }, zIndex: 4, crop: { x: 0.2529087469464316, y: 0.1401133238255756, width: 0.6191661602623987, height: 0.6191661602623987 } }, dialogues),
  ];
  const spread: PresentationUnit = {
    id: "campus-spread-03-04", name: "Page 03–04", kind: "spread", pageRole: "story",
    canvas: { width: 1440, height: 1080, background: { color: "#ffffff" } },
    surfaces: [
      { id: "campus-page-03-surface", name: "Page 03", role: "left", geometry: { x: 0, y: 0, width: 720, height: 1080 }, pageNumber: 3 },
      { id: "campus-page-04-surface", name: "Page 04", role: "right", geometry: { x: 720, y: 0, width: 720, height: 1080 }, pageNumber: 4 },
    ],
    frames: spreadFrames,
    overlayLayers: [{
      id: "campus-spread-birds", name: "跨页飞鸟", zIndex: 2, visible: true, anchor: { type: "unit" }, purpose: "cross_page",
      elements: [
        { id: "campus-cross-page-birds", kind: "image", assetId: "campus-asset-spread-birds", assetVersionId: "campus-asset-spread-birds-v1", transform: { x: 420, y: 80, width: 600, height: 180 }, crop: fullCrop, blendMode: "multiply", opacity: .72, overflow: "visible", name: "跨页图 01" },
      ],
    }, {
      id: "campus-spread-cross-page", name: "跨页对白", zIndex: 5, visible: true, anchor: { type: "unit" }, purpose: "cross_page",
      elements: [
        { id: "campus-cross-page-balloon-right", kind: "balloon", dialogueId: crossRightId, transform: { x: 939.6722383720924, y: 372.2943313953489, width: 143.421511627907, height: 70.18968023255815 }, tailTarget: { x: 1088.599088015313, y: 438.7111911815826 }, shape: "normal", style: balloonStyle(15), name: "对白" },
      ],
    }],
    readingSequence: spreadFrames.map((frame) => ({ frameId: frame.id })),
    layoutPolicy: { frameOverlap: "allow", gutter: 0, defaultOverflow: "clip" },
  };

  const usedFiles = imageFiles.filter((fileName) => fileName !== "character-xiakui.png");
  return validateComicDocument({
    protocolVersion: "lcd-0.4",
    comicId: ids.comic,
    chapterId: ids.chapter,
    format: "page",
    reading: { direction: "ltr", viewer: "paged", unitOrder: [page1.id, page2.id, spread.id], gap: 24, showPageNumber: true },
    units: [page1, page2, spread],
    resources: usedFiles.map((fileName) => {
      const asset = assetByFile[fileName];
      const image = stored.get(fileName)!;
      return { assetId: asset.id, assetVersionId: `${asset.id}-v1`, kind: "image", width: image.width ?? 1024, height: image.height ?? 1024, mediaType: "image/png" } as const;
    }),
    dialogues,
  });
}

async function clearPreviousComic() {
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
      prisma.assetImage.deleteMany({ where: { asset: { comicId: ids.comic } } }),
      prisma.asset.updateMany({ where: { comicId: ids.comic }, data: { variantOfAssetId: null } }),
      prisma.assetVersion.deleteMany({ where: { asset: { comicId: ids.comic } } }),
      prisma.asset.deleteMany({ where: { comicId: ids.comic } }),
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

export async function seedCampusLetter() {
  await prisma.user.upsert({ where: { email: LOCAL_USER_EMAIL }, update: { displayName: LOCAL_USER_DISPLAY_NAME }, create: { id: LOCAL_USER_ID, email: LOCAL_USER_EMAIL, displayName: LOCAL_USER_DISPLAY_NAME } });
  const owner = await prisma.user.findUniqueOrThrow({ where: { id: LOCAL_USER_ID } });
  await clearPreviousComic();
  await clearImageNamespace("samples/campus-letter");

  const stored = new Map<CampusImageFile, StoredObject>();
  for (const fileName of imageFiles) {
    const bytes = await readFile(path.join(process.cwd(), "apps", "web", "public", "samples", "campus-letter", fileName));
    stored.set(fileName, await putImage(bytes, "samples/campus-letter"));
  }
  const now = new Date();
  const document = buildCampusLetterDocument(stored);
  const storyboardBeatHeads = Object.fromEntries(storyboardBeats.map((beat) => [beat.id, beat.versionId]));
  const assetHeads = Object.fromEntries(imageFiles.map((fileName) => {
    const assetId = assetByFile[fileName].id;
    return [assetId, `${assetId}-v1`];
  }));

  const cover = stored.get("breakout-rendezvous-v2.png")!;
  const chapterCover = stored.get("classroom-lesson-v2.png")!;
  await prisma.comic.create({ data: { id: ids.comic, ownerUserId: owner.id, title: "风停之前", summary: "课堂里出现一封没有署名的信，夏葵循着仅有的两行字走向旧看台。", worldSummary: "当代校园。一个小花封印连接起没有说完的话；寄信人的身份和过去被刻意留白，只让一次克制的赴约浮出水面。", format: ComicFormat.PAGE, defaultReadingDirection: ReadingDirection.LTR, styleSummary: "清新黑白日漫，人物和分镜接近首页宣传图；精细二次元线条、克制网点、明亮留白与安静校园氛围。", coverObjectKey: cover.objectKey, coverContentType: cover.contentType, coverWidth: cover.width, coverHeight: cover.height, isExample: true } });
  await prisma.chapter.create({ data: { id: ids.chapter, ownerUserId: owner.id, comicId: ids.comic, number: 1, title: "第 1 话 · 旧看台", summary: "夏葵在放学前发现花印信封，铃声之后走向操场边等待她的人。", coverObjectKey: chapterCover.objectKey, coverContentType: chapterCover.contentType, coverWidth: chapterCover.width, coverHeight: chapterCover.height } });
  await prisma.project.create({ data: { id: ids.project, ownerUserId: owner.id, chapterId: ids.chapter } });
  await prisma.agentConversation.create({ data: { id: ids.conversation, ownerUserId: owner.id, projectId: ids.project, title: "风停之前 · 第一话创作" } });

  const contextSnapshot = { comic: { id: ids.comic, title: "风停之前" }, chapter: { id: ids.chapter, title: "第 1 话 · 旧看台" }, workingRevision: 1, storyboardBeats: [], assets: [], recentConversation: [] };
  const tasks = [
    { id: ids.storyboardTask, type: TaskType.STORYBOARD, capabilityId: "storyboard.compose", key: "sample:campus-letter:storyboard", baseRevision: 1, input: { instruction: "把课堂里的无署名信封与一次克制的操场赴约拆成四页短篇。" }, output: { kind: "storyboard", storyboardBeatCount: storyboardBeats.length }, provider: "sample-seed", model: "lantern-authored-storyboard" },
    { id: ids.layoutTask, type: TaskType.PAGE_LAYOUT, capabilityId: "page_layout.generate", key: "sample:campus-letter:layout", baseRevision: 2, input: { instruction: "前两页保持同一教室连续性，以连续特写衔接发冠破格；后两页用安全区内外格、左上跑步叠格、右下女同学回头特写和飞鸟跨页完成赴约。" }, output: { kind: "page_layout", physicalPages: 4, presentationUnits: 3, frameCount: 11, features: ["breakout", "spread", "cross_page", "nested_frames", "frame_overlap"] }, provider: "sample-seed", model: "lantern-layout-authored" },
    { id: ids.imageTask, type: TaskType.FRAME_IMAGE_GENERATE, capabilityId: "frame_image.generate_batch", key: "sample:campus-letter:images", baseRevision: 3, input: { instruction: "参照首页宣传图生成统一人设和清新黑白校园日漫素材。", source: "Codex built-in imagegen" }, output: { kind: "frame_images", assetCount: imageFiles.length }, provider: "codex-imagegen", model: "gpt-image-2" },
  ];
  for (const task of tasks) {
    await prisma.generationTask.create({ data: { id: task.id, ownerUserId: owner.id, projectId: ids.project, conversationId: ids.conversation, type: task.type, capabilityId: task.capabilityId, capabilityVersion: 1, status: TaskStatus.SUCCEEDED, idempotencyKey: task.key, baseRevision: task.baseRevision, scope: "whole_chapter", target: { type: "chapter", id: ids.chapter }, input: task.input, contextSnapshot, output: task.output, provider: task.provider, model: task.model, progress: 100, completedAt: now, attempts: { create: { attempt: 1, status: TaskStatus.SUCCEEDED, responseMeta: { seeded: true }, completedAt: now } } } });
  }

  for (const beat of storyboardBeats) {
    await prisma.storyboardBeat.create({ data: { id: beat.id, ownerUserId: owner.id, projectId: ids.project, versions: { create: { id: beat.versionId, version: 1, title: beat.title, description: beat.description, sourceTaskId: ids.storyboardTask } } } });
  }
  for (const fileName of imageFiles) {
    const definition = assetByFile[fileName];
    const image = stored.get(fileName)!;
    const versionId = `${definition.id}-v1`;
    await prisma.asset.create({ data: { id: definition.id, ownerUserId: owner.id, comicId: ids.comic, kind: definition.kind, name: definition.name, description: definition.description, versions: { create: { id: versionId, version: 1, objectKey: image.objectKey, contentType: image.contentType, byteSize: image.byteSize, width: image.width, height: image.height, checksum: image.checksum, origin: AssetVersionOrigin.GENERATED, sourceTaskId: ids.imageTask } } } });
    await prisma.assetImage.create({ data: { assetId: definition.id, assetVersionId: versionId, label: "主图", sortIndex: 0 } });
  }
  const firstUnit = document.units[0];
  const blankDocument: ComicDocument = { ...document, reading: { ...document.reading, unitOrder: [firstUnit.id] }, units: [{ ...firstUnit, frames: [], overlayLayers: [], readingSequence: [] }], resources: [], dialogues: [] };
  await prisma.workingRevision.createMany({ data: [
    { projectId: ids.project, revision: 1, document: blankDocument as unknown as Prisma.InputJsonValue, storyboardBeats: [], storyboardBeatVersionHeads: {}, assetVersionHeads: {}, changeSet: { id: "campus-create", source: "manual", operations: [] } },
    { projectId: ids.project, revision: 2, document: blankDocument as unknown as Prisma.InputJsonValue, storyboardBeats: storyboardBeats as unknown as Prisma.InputJsonValue, storyboardBeatVersionHeads: storyboardBeatHeads, assetVersionHeads: {}, changeSet: { id: "campus-storyboard-apply", source: "candidate", sourceCandidateId: "candidate-campus-storyboard", operations: [{ type: "replace_storyboard_beats" }] } },
    { projectId: ids.project, revision: 3, document: document as unknown as Prisma.InputJsonValue, storyboardBeats: storyboardBeats as unknown as Prisma.InputJsonValue, storyboardBeatVersionHeads: storyboardBeatHeads, assetVersionHeads: assetHeads, changeSet: { id: "campus-layout-apply", source: "candidate", sourceCandidateId: "candidate-campus-layout", commands: [{ type: "replace_chapter_presentation" }] } },
  ] });
  await prisma.savedSnapshot.create({ data: { ownerUserId: owner.id, chapterId: ids.chapter, projectId: ids.project, sourceWorkingRevision: 3, document: document as unknown as Prisma.InputJsonValue, storyboardBeatVersions: storyboardBeatHeads, assetVersions: assetHeads } });

  await prisma.candidate.createMany({ data: [
    { id: "candidate-campus-storyboard", ownerUserId: owner.id, projectId: ids.project, conversationId: ids.conversation, taskId: ids.storyboardTask, kind: CandidateKind.STORYBOARD, status: CandidateStatus.APPLIED, title: "风停之前 · 八个分镜条目", changeSummary: "从同一间课堂里的花印信封推进到旧看台赴约，保留寄信人的神秘感。", targetLabel: "第 1 话", target: { type: "chapter", id: ids.chapter }, baseRevision: 1, sourceRefs: [], outputRefs: storyboardBeats.map((beat) => ({ objectType: "storyboard_beat", objectId: beat.id, versionId: beat.versionId })), payload: { storyboardBeats }, operations: [{ type: "replace_storyboard_beats", count: storyboardBeats.length }], appliedRevision: 2 },
    { id: "candidate-campus-layout", ownerUserId: owner.id, projectId: ids.project, conversationId: ids.conversation, taskId: ids.layoutTask, kind: CandidateKind.PAGE_LAYOUT, status: CandidateStatus.APPLIED, title: "四页课堂赴约与真正双页", changeSummary: "Page 01–02 用连续特写和对齐后的发冠破格收束课堂；Page 03–04 用安全区内外格、左上跑步叠格、右下女同学回头特写与飞鸟跨页呈现两位女同学相见。", targetLabel: "Page 01–04", target: { type: "chapter", id: ids.chapter }, baseRevision: 2, sourceRefs: storyboardBeats.map((beat) => ({ objectType: "storyboard_beat", objectId: beat.id, versionId: beat.versionId })), outputRefs: document.units.map((unit) => ({ objectType: "presentation_unit", objectId: unit.id })), payload: { physicalPages: 4, presentationUnits: 3, frameCount: 11 }, operations: [{ type: "replace_chapter_presentation", document }], appliedRevision: 3 },
  ] });

  const messages = [
    { role: MessageRole.USER, kind: MessageKind.PLAIN, content: "参考首页宣传图做一个清新的校园短篇：课堂里发现信封，最后去操场赴约。", metadata: { intent: "分镜", scope: "当前一话" } },
    { role: MessageRole.AGENT, kind: MessageKind.TASK, content: "已整理为八个分镜条目：前两页保持同一教室连续，信封只保留花印与两行信息。", metadata: { taskId: ids.storyboardTask, resolved: true } },
    { role: MessageRole.USER, kind: MessageKind.PLAIN, content: "最后一格像宣传图，只让上半头出格；后两页是真双页，赴约要克制。", metadata: { intent: "编排", scope: "整话" } },
    { role: MessageRole.AGENT, kind: MessageKind.TASK, content: "四张物理页已完成：Page 02 用无对白特写衔接同源发冠破格；Page 03–04 是安全区内的操场真双页，女主跑向女同学，中缝不切人物。", metadata: { taskId: ids.layoutTask, imageTaskId: ids.imageTask, resolved: true } },
    { role: MessageRole.AGENT, kind: MessageKind.PLAIN, content: "《风停之前》第 1 话已保存。全部画面由 Codex 内置图像模型生成，未调用 Lantern 系统 AI。", metadata: { workingRevision: 3, snapshot: true } },
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
  seedCampusLetter()
    .then(async () => prisma.$disconnect())
    .catch(async (error) => {
      console.error(error instanceof Error ? error.stack ?? error.message : error);
      await prisma.$disconnect();
      process.exit(1);
    });
}

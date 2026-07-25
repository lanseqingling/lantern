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
import { deleteObject, putImage, type StoredObject } from "@lantern/server/object-storage";
import { clearComicData } from "../../scripts/database-cleanup";

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
  "character-lincheng.png",
  "cover-before-wind-composite.png",
  "title-before-wind.png",
  "classroom-lesson-v2.png",
  "classroom-turn-v2.png",
  "bag-letter-v2.png",
  "classroom-after-bell-v2.png",
  "letter-from-black-bag-closeup-v10.png",
  "window-tree-shadow-v4.png",
  "breakout-rendezvous-v2.png",
  "breakout-rendezvous-crown-v2.png",
  "campus-route.png",
  "spread-rendezvous-girls-v6.png",
  "rendezvous-running-letter-closeup.png",
  "campus-sky-clouds.png",
  "rendezvous-friend-closeup-v8.png",
] as const;
type CampusImageFile = typeof imageFiles[number];

const canvasAssetFiles: readonly CampusImageFile[] = [
  "character-xiakui.png",
  "character-lincheng.png",
  "cover-before-wind-composite.png",
  "title-before-wind.png",
  "classroom-lesson-v2.png",
  "breakout-rendezvous-v2.png",
];

const assetByFile: Readonly<Record<CampusImageFile, { id: string; kind: AssetKind; name: string; description: string }>> = {
  "character-xiakui.png": { id: "campus-asset-xiakui", kind: AssetKind.CHARACTER, name: "夏葵", description: "16 岁，高二学生，约 164 厘米。柔和的鹅蛋脸、偏大的椭圆眼，黑色长发自然蓬松地垂至肩胛下方，轻薄碎刘海与两侧发丝保持稳定。穿短袖水手领校服、深色百褶裙、黑色及膝袜和黑色校鞋，使用无挂饰的深色尼龙书包。安静敏感，受伤时习惯先退开；她介意的不是林澄将要离开，而是自己险些被省略在告别之外。" },
  "character-lincheng.png": { id: "campus-asset-lincheng", kind: AssetKind.CHARACTER, name: "林澄", description: "16 岁，夏葵的同班同学，约 158 厘米。柔和的鹅蛋脸，眼型比夏葵略圆；黑色中长发扎低短马尾，额前和脸侧保留自然碎发。穿同款短袖水手领校服与深色百褶裙，袖口轻微卷起，配黑色短袜和校鞋。平时主动温和，遇到真正重要的事却会拖延开口；习惯用五瓣花形贴纸封住写给夏葵的便签。" },
  "cover-before-wind-composite.png": { id: "campus-asset-cover", kind: AssetKind.GENERATED_IMAGE, name: "第一话封面", description: "完整封面插画。夏葵在旧操场前景握着五瓣花印信封，林澄在左侧旧看台旁等待；纵向墨色“风停之前”艺术字已经绘入画面，风、树影、飞叶与人物距离共同保留赴约前的悬念。" },
  "title-before-wind.png": { id: "campus-asset-title-art", kind: AssetKind.GENERATED_IMAGE, name: "风停之前 · 标题艺术字", description: "独立抠出的纵向墨色标题艺术字，透明背景，用于叠放在封面底图上；不是普通字体直接输入的标题文字。" },
  "classroom-lesson-v2.png": { id: "campus-asset-classroom-lesson", kind: AssetKind.SCENE, name: "午后课堂", description: "夏末最后一节课，老师在黑板前写字，夏葵坐在靠窗后排。窗光从左侧进入，课桌、黑板和窗户方向与放学后的镜头保持连续。" },
  "classroom-turn-v2.png": { id: "campus-asset-classroom-turn", kind: AssetKind.GENERATED_IMAGE, name: "座位上的回头", description: "夏葵留在靠窗座位，察觉椅背上的书包有些异样后回头；表情克制，只让视线变化推动她发现来信。" },
  "bag-letter-v2.png": { id: "campus-asset-flower-envelope", kind: AssetKind.PROP, name: "五瓣花印信封", description: "白色信封从夏葵的深色尼龙书包拉链间露出一角，封口只有林澄惯用的五瓣花形贴纸，没有署名或其他可读文字。" },
  "classroom-after-bell-v2.png": { id: "campus-asset-after-bell", kind: AssetKind.GENERATED_IMAGE, name: "铃声之后", description: "放学铃响后，同一间教室逐渐空下来。夏葵仍坐在靠窗后排，从书包里拿起尚未拆开的花印信封。" },
  "letter-from-black-bag-closeup-v10.png": { id: "campus-asset-letter-in-hand", kind: AssetKind.GENERATED_IMAGE, name: "手中的信", description: "夏葵俯视腿上半开的深色尼龙书包，拇指与食指轻捏刚取出的花印信封；五瓣花印成为识别写信人的唯一线索。" },
  "window-tree-shadow-v4.png": { id: "campus-asset-window-shadow", kind: AssetKind.SCENE, name: "风里的窗", description: "教室窗帘被夏末的风轻轻带起，树影落在玻璃与窗台上；无人静景承接信件内容和夏葵起身赴约之间的停顿。" },
  "breakout-rendezvous-v2.png": { id: "campus-asset-breakout-panel", kind: AssetKind.GENERATED_IMAGE, name: "风里的决定", description: "夏葵背起深色书包，抬手理过被风吹起的长发。人物完全沿用正文既有造型，只让头顶越过画格上沿，表现她终于决定赴约。" },
  "breakout-rendezvous-crown-v2.png": { id: "campus-asset-breakout-crown", kind: AssetKind.GENERATED_IMAGE, name: "风里的决定 · 发冠层", description: "从主画面同源提取的发冠遮线层，只让完整头顶越过画格上沿，不处理整个人物或细碎发梢。" },
  "campus-route.png": { id: "campus-asset-route", kind: AssetKind.SCENE, name: "通往旧操场", description: "教学楼出口连接旧操场的明暗过渡空间。夏葵从室内阴影快步进入夏末亮光，手里握着花印信封；围网、树影和跑道方向连续指向旧看台。" },
  "spread-rendezvous-girls-v6.png": { id: "campus-asset-playground-rendezvous", kind: AssetKind.SCENE, name: "旧看台的相见", description: "Page 04–05 真双页操场大景。严格参考最初版本的远近关系、人物尺度与自然跑姿重新绘制：夏葵从左侧前景奔向旧看台，明亮天空、弧形跑道与看台展开安静纵深，林澄在右侧明确看向她。" },
  "rendezvous-running-letter-closeup.png": { id: "campus-asset-rendezvous-letter-run", kind: AssetKind.GENERATED_IMAGE, name: "奔跑中的花印信", description: "Page 03 的低机位斜向近景。夏葵奔跑时攥紧五瓣花印信封，深色书包、裙摆与发梢被风带动；镜头重新强调她赴约的原因，不重复上一格的全身侧向动作。" },
  "campus-sky-clouds.png": { id: "campus-asset-sky-wind", kind: AssetKind.SCENE, name: "旧操场上空的云", description: "Page 03 的独立超宽天空静景。层叠积云成为画面主体，左上保留深色树荫与穿叶阳光，右下只露出少量围网；素材为扁长、右移的画格单独绘制，不复用最终跨页的飞鸟。" },
  "rendezvous-friend-closeup-v8.png": { id: "campus-asset-rendezvous-friend", kind: AssetKind.GENERATED_IMAGE, name: "旧看台旁的林澄", description: "严格参考上一次提交中未修改的原始分镜重绘。林澄保持肩背侧向、回头看向镜头的近景姿态，低短马尾完整可见，露出克制微笑；背景水泥台阶与金属扶手沿旧看台方向使用一致透视。" },
};

export const storyboardBeats: StoryboardBeat[] = [
  { id: "campus-beat-01", versionId: "campus-beat-01-v1", title: "夏末课堂", description: "夏末最后一节课仍在继续。夏葵坐在靠窗后排，老师背对学生在黑板上写字；窗外的风掠过安静的教室。" },
  { id: "campus-beat-02", versionId: "campus-beat-02-v1", title: "回头", description: "夏葵察觉椅背上的书包有些异样，沉默地回头查看。" },
  { id: "campus-beat-03", versionId: "campus-beat-03-v1", title: "五瓣花印", description: "书包拉链间露出没有署名的白色信封。夏葵认出林澄惯用的五瓣花印，但没有立刻拆开。" },
  { id: "campus-beat-04", versionId: "campus-beat-04-v1", title: "铃声之后", description: "学生离开后，夏葵仍在原座位，终于拿起信封；她和林澄已经整整七天没有说话。" },
  { id: "campus-beat-05", versionId: "campus-beat-05-v1", title: "信里的约定", description: "信里没有解释，只写着“放学后，旧看台。”窗外树影被风轻轻推过玻璃。" },
  { id: "campus-beat-06", versionId: "campus-beat-06-v1", title: "风里的决定", description: "夏葵背起书包，抬手理过被风吹起的头发；她决定赴约，发冠越过画格上沿。" },
  { id: "campus-beat-07", versionId: "campus-beat-07-v1", title: "通往旧操场", description: "夏葵握着花印信封，从教学楼阴影快步走进操场方向的亮光。风始终没有停。" },
  { id: "campus-beat-08", versionId: "campus-beat-08-v1", title: "奔向旧看台", description: "先以全身画面确认夏葵奔向旧看台，再切到进一步加高的低机位斜向近景：她攥紧花印信封，书包、裙摆与发梢被风带动。最后用一格靠右的超宽云层静景放慢节奏；左上树荫与穿叶阳光仍可见，页面左侧留白明显多于右侧，再直接进入真正双页。" },
  { id: "campus-beat-09", versionId: "campus-beat-09-v1", title: "旧看台", description: "Page 04–05 真双页操场大景。分镜严格参考最初版本的镜头、人物尺度和自然跑姿重新绘制；夏葵从左侧前景奔向旧看台，林澄在右侧明确看向她，中缝只经过明亮天空与弧形跑道。" },
  { id: "campus-beat-10", versionId: "campus-beat-10-v1", title: "喊出名字", description: "夏葵隔着跑道喊出“林澄！”，对白尾巴保持较短并继续指向她。右下叠格参考原始分镜的肩背侧向与回头姿态重绘，以进一步放大并略向左移动的裁切让林澄更贴近画面；她看向镜头并露出克制微笑，背景看台阶梯和扶手保持正确透视。" },
];

const fullCrop = { x: 0, y: 0, width: 1, height: 1 } as const;
const balloonStyle = (fontSize: number) => ({ fontFamily: "Lantern Sans", fontSize, textColor: "#111111", fill: "#ffffff", stroke: "#111111", strokeWidth: 2, writingMode: "horizontal" as const });
const textStyle = (fontSize: number, fontWeight = 700) => ({ fontFamily: "Lantern Sans", fontSize, fontWeight, color: "#111111", stroke: "#ffffff", strokeWidth: 2, align: "left" as const, writingMode: "horizontal" as const });

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
  const cover: PresentationUnit = {
    id: "campus-cover", name: "封面", kind: "single_page", pageRole: "cover",
    canvas: { width: 720, height: 1080, background: { color: "#ffffff" } },
    surfaces: [{ id: "campus-cover-surface", name: "封面", role: "single", geometry: { x: 0, y: 0, width: 720, height: 1080 } }],
    frames: [],
    overlayLayers: [
      {
        id: "campus-cover-art", name: "封面插画", zIndex: 1, visible: true, anchor: { type: "unit" }, purpose: "page_content", surfaceId: "campus-cover-surface",
        elements: [{ id: "campus-cover-image", kind: "image", assetId: "campus-asset-cover", assetVersionId: "campus-asset-cover-v1", transform: { x: 0, y: 0, width: 720, height: 1080 }, crop: fullCrop, name: "封面主图" }],
      },
      {
        id: "campus-cover-chapter-title", name: "第一话名称", zIndex: 4, visible: true, anchor: { type: "unit" }, purpose: "narration", surfaceId: "campus-cover-surface",
        elements: [{ id: "campus-cover-title-chapter", kind: "text", transform: { x: 679.5181686046512, y: 859.7696220930233, width: 27.03997093023258, height: 211.5588662790698 }, content: "第一话　旧看台的来信", role: "narration", style: { ...textStyle(20, 700), writingMode: "vertical" }, name: "第一话名称" }],
      },
    ],
    readingSequence: [],
    layoutPolicy: { frameOverlap: "forbid", gutter: 0, defaultOverflow: "clip" },
  };

  const page1Frames = [
    buildFrame({ number: 1, beatIndex: 0, assetId: "campus-asset-classroom-lesson", geometry: { x: 35, y: 35, width: 650, height: 290 }, zIndex: 1, dialogue: { content: "夏末，最后一节课。", transform: { x: .06, y: .08, width: .31, height: .17 }, shape: "caption_box", fontSize: 14, name: "时间旁白" } }, dialogues),
    buildFrame({ number: 2, beatIndex: 1, assetId: "campus-asset-classroom-turn", geometry: { x: 35, y: 355, width: 475, height: 455 }, zIndex: 2 }, dialogues),
    buildFrame({ number: 3, beatIndex: 2, assetId: "campus-asset-flower-envelope", geometry: { x: 520, y: 355, width: 165, height: 455 }, zIndex: 3 }, dialogues),
    buildFrame({ number: 4, beatIndex: 2, assetId: "campus-asset-flower-envelope", geometry: { x: 35, y: 840, width: 650, height: 205 }, zIndex: 4, dialogue: { content: "这个花印……", transform: { x: .69, y: .12, width: .24, height: .36 }, shape: "thought", fontSize: 14, name: "夏葵的想法" } }, dialogues),
  ];
  const page1: PresentationUnit = {
    id: "campus-page-01", name: "Page 01", kind: "single_page", pageRole: "story",
    canvas: { width: 720, height: 1080, background: { color: "#ffffff" } },
    surfaces: [{ id: "campus-page-01-surface", name: "Page 01", role: "single", geometry: { x: 0, y: 0, width: 720, height: 1080 }, pageNumber: 1 }],
    frames: page1Frames, overlayLayers: [], readingSequence: page1Frames.map((frame) => ({ frameId: frame.id })),
    layoutPolicy: { frameOverlap: "forbid", gutter: 10, defaultOverflow: "clip" },
  };

  const page2Frames = [
    buildFrame({ number: 5, beatIndex: 3, assetId: "campus-asset-after-bell", geometry: { x: 40, y: 40, width: 640, height: 310 }, zIndex: 1 }, dialogues),
    buildFrame({ number: 6, beatIndex: 4, assetId: "campus-asset-letter-in-hand", geometry: { x: 40, y: 380, width: 310, height: 215 }, zIndex: 2, crop: { x: 0.0563387056958035, y: 0, width: 0.8038186387529933, height: 0.8038186387529933 } }, dialogues),
    buildFrame({ number: 7, beatIndex: 4, assetId: "campus-asset-window-shadow", geometry: { x: 360, y: 380, width: 320, height: 215 }, zIndex: 3, crop: { x: 0.1772824494643256, y: 0.2211066844855711, width: 0.6669768108584753, height: 0.6669768108584753 } }, dialogues),
    buildFrame({ number: 8, beatIndex: 5, assetId: "campus-asset-breakout-panel", geometry: { x: 40, y: 625, width: 640, height: 420 }, zIndex: 4 }, dialogues),
  ];
  page2Frames[3].layers[0].elements[0].transform = { x: 0, y: -.2, width: 1, height: 1.2 };
  const page2CaptionId = "campus-dialogue-letter";
  dialogues.push({ id: page2CaptionId, storyboardBeatId: storyboardBeats[4].id, storyboardBeatVersionId: storyboardBeats[4].versionId, speakerAssetId: "campus-asset-lincheng", content: "放学后，旧看台。" });
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
        elements: [{ id: "campus-balloon-letter", kind: "balloon", dialogueId: page2CaptionId, transform: { x: 383.5013111888112, y: 407.6883741258741, width: 168, height: 52 }, shape: "caption_box", style: balloonStyle(14), name: "信件内容" }],
      },
    ],
    readingSequence: page2Frames.map((frame) => ({ frameId: frame.id })),
    layoutPolicy: { frameOverlap: "allow", gutter: 10, defaultOverflow: "clip" },
  };

  const page3Frames: Frame[] = [
    buildFrame({ number: 9, beatIndex: 6, assetId: "campus-asset-route", geometry: { x: 40, y: 40, width: 640, height: 500 }, zIndex: 1 }, dialogues),
    buildFrame({ number: 10, beatIndex: 7, assetId: "campus-asset-rendezvous-letter-run", geometry: { x: 55, y: 570, width: 575.0524635036496, height: 293.845802919708 }, zIndex: 2, crop: { x: 0, y: 3.33066907387547e-16, width: 0.943818281762779, height: 0.9999999999999997 } }, dialogues),
    buildFrame({ number: 11, beatIndex: 7, assetId: "campus-asset-sky-wind", geometry: { x: 137.8581204379562, y: 893.8115875912409, width: 519.9846070899904, height: 137.2513207595324 }, zIndex: 3, crop: { x: 0, y: 0.1300726645860639, width: 1, height: 0.5524923848284263 } }, dialogues),
  ];
  const page3: PresentationUnit = {
    id: "campus-page-03", name: "Page 03", kind: "single_page", pageRole: "story",
    canvas: { width: 720, height: 1080, background: { color: "#ffffff" } },
    surfaces: [{ id: "campus-page-03-surface", name: "Page 03", role: "single", geometry: { x: 0, y: 0, width: 720, height: 1080 }, pageNumber: 3 }],
    frames: page3Frames,
    overlayLayers: [],
    readingSequence: page3Frames.map((frame) => ({ frameId: frame.id })),
    layoutPolicy: { frameOverlap: "forbid", gutter: 10, defaultOverflow: "clip" },
  };

  const spreadCallId = "campus-dialogue-spread-call";
  dialogues.push(
    { id: spreadCallId, storyboardBeatId: storyboardBeats[9].id, storyboardBeatVersionId: storyboardBeats[9].versionId, speakerAssetId: "campus-asset-xiakui", content: "林澄！" },
  );
  const spreadFrames = [
    buildFrame({ number: 12, beatIndex: 8, assetId: "campus-asset-playground-rendezvous", geometry: { x: 35, y: 35.43822674418605, width: 1370, height: 1010 }, zIndex: 1, surfaceScope: "unit" }, dialogues),
    buildFrame({ number: 13, beatIndex: 9, assetId: "campus-asset-rendezvous-friend", geometry: { x: 1020.241279069768, y: 756.3059593023257, width: 334.7056686046512, height: 233.9658430232558 }, zIndex: 4, crop: { x: 0.14, y: 0.12, width: 0.76, height: 0.76 } }, dialogues),
  ];
  const spread: PresentationUnit = {
    id: "campus-spread-04-05", name: "Page 04–05", kind: "spread", pageRole: "story",
    canvas: { width: 1440, height: 1080, background: { color: "#ffffff" } },
    surfaces: [
      { id: "campus-page-04-surface", name: "Page 04", role: "left", geometry: { x: 0, y: 0, width: 720, height: 1080 }, pageNumber: 4 },
      { id: "campus-page-05-surface", name: "Page 05", role: "right", geometry: { x: 720, y: 0, width: 720, height: 1080 }, pageNumber: 5 },
    ],
    frames: spreadFrames,
    overlayLayers: [{
      id: "campus-spread-cross-page", name: "跨页对白", zIndex: 5, visible: true, anchor: { type: "unit" }, purpose: "cross_page",
      elements: [
        { id: "campus-cross-page-balloon-call", kind: "balloon", dialogueId: spreadCallId, transform: { x: 568, y: 196, width: 126.7303779069767, height: 66.14970930232558 }, tailTarget: { x: 555, y: 284 }, shape: "normal", style: balloonStyle(17), name: "夏葵的呼喊" },
      ],
    }],
    readingSequence: spreadFrames.map((frame) => ({ frameId: frame.id })),
    layoutPolicy: { frameOverlap: "allow", gutter: 0, defaultOverflow: "clip" },
  };

  const usedFiles = imageFiles.filter((fileName) => fileName !== "character-xiakui.png" && fileName !== "character-lincheng.png");
  return validateComicDocument({
    protocolVersion: "lcd-0.4",
    comicId: ids.comic,
    chapterId: ids.chapter,
    format: "page",
    reading: { direction: "ltr", viewer: "paged", unitOrder: [cover.id, page1.id, page2.id, page3.id, spread.id], gap: 24, showPageNumber: true },
    units: [cover, page1, page2, page3, spread],
    resources: usedFiles.map((fileName) => {
      const asset = assetByFile[fileName];
      const image = stored.get(fileName)!;
      return { assetId: asset.id, assetVersionId: `${asset.id}-v1`, kind: "image", width: image.width ?? 1024, height: image.height ?? 1024, mediaType: "image/png" } as const;
    }),
    dialogues,
  });
}

async function clearPreviousComic() {
  await clearComicData(prisma, ids.comic);
}

async function previousComicObjectKeys() {
  const [comic, chapters, versions] = await Promise.all([
    prisma.comic.findUnique({ where: { id: ids.comic }, select: { coverObjectKey: true } }),
    prisma.chapter.findMany({ where: { comicId: ids.comic }, select: { coverObjectKey: true } }),
    prisma.assetVersion.findMany({ where: { asset: { comicId: ids.comic } }, select: { objectKey: true } }),
  ]);
  return new Set([
    comic?.coverObjectKey,
    ...chapters.map((chapter) => chapter.coverObjectKey),
    ...versions.map((version) => version.objectKey),
  ].filter((objectKey): objectKey is string => Boolean(objectKey)));
}

async function deleteObjectsNoLongerReferenced(objectKeys: ReadonlySet<string>) {
  for (const objectKey of objectKeys) {
    const [assetVersionCount, comicCoverCount, chapterCoverCount] = await prisma.$transaction([
      prisma.assetVersion.count({ where: { objectKey } }),
      prisma.comic.count({ where: { coverObjectKey: objectKey } }),
      prisma.chapter.count({ where: { coverObjectKey: objectKey } }),
    ]);
    if (assetVersionCount + comicCoverCount + chapterCoverCount === 0) await deleteObject(objectKey);
  }
}

export async function seedCampusLetter() {
  await prisma.user.upsert({ where: { email: LOCAL_USER_EMAIL }, update: { displayName: LOCAL_USER_DISPLAY_NAME }, create: { id: LOCAL_USER_ID, email: LOCAL_USER_EMAIL, displayName: LOCAL_USER_DISPLAY_NAME } });
  const owner = await prisma.user.findUniqueOrThrow({ where: { id: LOCAL_USER_ID } });
  const previousObjectKeys = await previousComicObjectKeys();
  await clearPreviousComic();
  await deleteObjectsNoLongerReferenced(previousObjectKeys);

  const stored = new Map<CampusImageFile, StoredObject>();
  for (const fileName of imageFiles) {
    const bytes = await readFile(path.join(process.cwd(), "apps", "web", "public", "samples", "campus-letter", fileName));
    stored.set(fileName, await putImage(bytes, "samples/campus-letter"));
  }
  const coverCardBytes = await readFile(path.join(process.cwd(), "apps", "web", "public", "samples", "campus-letter", "cover-before-wind-composite.png"));
  const coverCard = await putImage(coverCardBytes, "samples/campus-letter");
  const now = new Date();
  const document = buildCampusLetterDocument(stored);
  const storyboardBeatHeads = Object.fromEntries(storyboardBeats.map((beat) => [beat.id, beat.versionId]));
  const assetHeads = Object.fromEntries(imageFiles.map((fileName) => {
    const assetId = assetByFile[fileName].id;
    return [assetId, `${assetId}-v1`];
  }));

  const cover = coverCard;
  await prisma.comic.create({ data: {
    id: ids.comic,
    ownerUserId: owner.id,
    title: "风停之前",
    summary: "夏末，夏葵在书包里发现一封没有署名的信。她认出熟悉的五瓣花印，循着信中的约定赶到即将封闭的旧看台——",
    worldSummary: "故事发生在当代临海城市的一所普通高中，时间为夏末新学期。校园常年有风，旧操场看台因为年久失修即将封闭改造；这里是夏葵与林澄第一次真正交谈的地方。五瓣花印是林澄写便签时一直使用的小标记，也是夏葵辨认来信人的依据，不具有超自然能力。创作内部事实是林澄因家庭搬迁即将转学，但读者可见正文在第一话结尾只到夏葵隔着跑道喊出林澄的名字，转学事实仍不揭示。",
    format: ComicFormat.PAGE,
    defaultReadingDirection: ReadingDirection.LTR,
    styleSummary: "清新、克制的黑白校园日漫。人物使用偏修长的自然比例、细腻灰阶铅笔与墨线、柔和网点和明亮白场；黑色集中在头发、书包、校服领口等稳定识别区域。风通过发丝、窗帘、树影、信纸与飞鸟表现，情绪依靠眼神、停顿、手部动作和人物距离推进。所有人物设定图必须服从正文既有造型，不改成幼态大圆眼、厚涂、彩色、摄影写实或不同款式校服。",
    coverObjectKey: cover.objectKey,
    coverContentType: cover.contentType,
    coverWidth: cover.width,
    coverHeight: cover.height,
    isExample: true,
  } });
  await prisma.comicSetting.createMany({ data: [
    { id: "campus-setting-relationship", ownerUserId: owner.id, comicId: ids.comic, title: "人物关系与前情", content: "夏葵和林澄曾经是最亲近的朋友。林澄因家庭搬迁即将转学，却害怕提前告别会让剩下的相处变得沉重，迟迟没有亲口告诉夏葵。夏葵从其他同学那里听见消息后误以为自己不值得被认真告别，两人因此沉默了七天。她们的核心冲突不是能否阻止转学，而是能否在错过之前说出真正介意的事。", sortIndex: 0 },
    { id: "campus-setting-continuity", ownerUserId: owner.id, comicId: ids.comic, title: "连续性规则", content: "夏葵固定为自然蓬松的黑色长发、轻薄碎刘海、短袖水手领校服、深色百褶裙、黑色及膝袜和无挂饰深色书包；林澄固定为低短马尾、略卷袖口、同款校服与黑色短袜。五瓣花印始终使用相同图形。教室窗光、书包所在椅背、教学楼出口、跑道方向与旧看台位置保持连续。真正双页的中缝只能经过天空、跑道或飞鸟，不穿过人物、信封与对白。", sortIndex: 1 },
    { id: "campus-setting-dialogue", ownerUserId: owner.id, comicId: ids.comic, title: "对白与情绪", content: "夏葵说话直接、短，受伤时更常保持沉默；林澄平时主动，面对重要消息会先确认对方是否愿意听。每个气泡尽量不超过两行，不用对白重复画面动作。第一话最后只保留夏葵隔着跑道喊出的“林澄！”，林澄只回头，不解释来信，也不揭示转学。", sortIndex: 2 },
  ] });
  await prisma.chapter.create({ data: { id: ids.chapter, ownerUserId: owner.id, comicId: ids.comic, number: 1, title: "第 1 话 · 旧看台的来信", summary: "夏葵认出书包里那枚熟悉的五瓣花印。她循着信上的约定奔向旧看台，在看见林澄的瞬间终于喊出她的名字。", coverObjectKey: cover.objectKey, coverContentType: cover.contentType, coverWidth: cover.width, coverHeight: cover.height } });
  await prisma.project.create({ data: { id: ids.project, ownerUserId: owner.id, chapterId: ids.chapter, workspaceSettings: { pageDisplayMode: "spread" } } });
  await prisma.agentConversation.create({ data: { id: ids.conversation, ownerUserId: owner.id, projectId: ids.project, title: "风停之前 · 第一话创作" } });

  const contextSnapshot = { comic: { id: ids.comic, title: "风停之前" }, chapter: { id: ids.chapter, title: "第 1 话 · 旧看台的来信" }, workingRevision: 1, storyboardBeats: [], assets: [], recentConversation: [] };
  const tasks = [
    { id: ids.storyboardTask, type: TaskType.STORYBOARD, capabilityId: "storyboard.compose", key: "sample:campus-letter:storyboard", baseRevision: 1, input: { instruction: "把花印来信、七天沉默和旧看台赴约拆成五页短篇；最后的真正双页在夏葵喊出林澄名字时结束，不解决人物矛盾。" }, output: { kind: "storyboard", storyboardBeatCount: storyboardBeats.length }, provider: "sample-seed", model: "lantern-authored-storyboard" },
    { id: ids.layoutTask, type: TaskType.PAGE_LAYOUT, capabilityId: "page_layout.generate", key: "sample:campus-letter:layout", baseRevision: 2, input: { instruction: "增加独立封面；Page 01 独立，Page 02–03 组成普通双页，Page 04–05 为真正双页。保留 Page 02 既有夏葵出格画面；Page 03 保留第一格奔跑画面，后接进一步增高并扩大取景的低机位花印信近景，再以扁长、靠右且左侧留白更多的独立云层格收束，不增加空白画格；最终双页只放夏葵喊名字的一句对白且避开中缝。" }, output: { kind: "page_layout", physicalPages: 5, presentationUnits: 5, frameCount: 13, features: ["cover", "breakout", "spread", "cross_page", "frame_overlap"] }, provider: "sample-seed", model: "lantern-layout-authored" },
    { id: ids.imageTask, type: TaskType.FRAME_IMAGE_GENERATE, capabilityId: "frame_image.generate_batch", key: "sample:campus-letter:images", baseRevision: 3, input: { instruction: "以 Page 02 正文既有夏葵形象为人物事实源，只重绘角色设定图并新增封面与 Page 03 素材，不改写既有正文人物画面。", source: "Codex built-in imagegen" }, output: { kind: "frame_images", assetCount: imageFiles.length }, provider: "codex-imagegen", model: "gpt-image-2" },
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
  await prisma.canvasAssetListItem.createMany({
    data: canvasAssetFiles.map((fileName, sortIndex) => {
      const definition = assetByFile[fileName];
      return { ownerUserId: owner.id, projectId: ids.project, assetId: definition.id, displayName: definition.name, sortIndex };
    }),
  });
  const firstUnit = document.units[0];
  const blankDocument: ComicDocument = { ...document, reading: { ...document.reading, unitOrder: [firstUnit.id] }, units: [{ ...firstUnit, frames: [], overlayLayers: [], readingSequence: [] }], resources: [], dialogues: [] };
  await prisma.workingRevision.createMany({ data: [
    { projectId: ids.project, revision: 1, document: blankDocument as unknown as Prisma.InputJsonValue, storyboardBeats: [], storyboardBeatVersionHeads: {}, assetVersionHeads: {}, changeSet: { id: "campus-create", source: "manual", operations: [] } },
    { projectId: ids.project, revision: 2, document: blankDocument as unknown as Prisma.InputJsonValue, storyboardBeats: storyboardBeats as unknown as Prisma.InputJsonValue, storyboardBeatVersionHeads: storyboardBeatHeads, assetVersionHeads: {}, changeSet: { id: "campus-storyboard-apply", source: "candidate", sourceCandidateId: "candidate-campus-storyboard", operations: [{ type: "replace_storyboard_beats" }] } },
    { projectId: ids.project, revision: 3, document: document as unknown as Prisma.InputJsonValue, storyboardBeats: storyboardBeats as unknown as Prisma.InputJsonValue, storyboardBeatVersionHeads: storyboardBeatHeads, assetVersionHeads: assetHeads, changeSet: { id: "campus-layout-apply", source: "candidate", sourceCandidateId: "candidate-campus-layout", commands: [{ type: "replace_chapter_presentation" }] } },
  ] });
  await prisma.savedSnapshot.create({ data: { ownerUserId: owner.id, chapterId: ids.chapter, projectId: ids.project, sourceWorkingRevision: 3, document: document as unknown as Prisma.InputJsonValue, storyboardBeatVersions: storyboardBeatHeads, assetVersions: assetHeads } });

  await prisma.candidate.createMany({ data: [
    { id: "candidate-campus-storyboard", ownerUserId: owner.id, projectId: ids.project, conversationId: ids.conversation, taskId: ids.storyboardTask, kind: CandidateKind.STORYBOARD, status: CandidateStatus.APPLIED, title: "风停之前 · 十个分镜条目", changeSummary: "从花印来信和七天沉默推进到旧看台赴约，在夏葵喊出林澄名字时结束。", targetLabel: "第 1 话", target: { type: "chapter", id: ids.chapter }, baseRevision: 1, sourceRefs: [], outputRefs: storyboardBeats.map((beat) => ({ objectType: "storyboard_beat", objectId: beat.id, versionId: beat.versionId })), payload: { storyboardBeats }, operations: [{ type: "replace_storyboard_beats", count: storyboardBeats.length }], appliedRevision: 2 },
    { id: "candidate-campus-layout", ownerUserId: owner.id, projectId: ids.project, conversationId: ids.conversation, taskId: ids.layoutTask, kind: CandidateKind.PAGE_LAYOUT, status: CandidateStatus.APPLIED, title: "封面、五页正文与悬念双页", changeSummary: "独立封面不占正文页码；Page 01 独立，Page 02–03 形成连续普通双页；Page 03 以进一步增高的花印信近景和靠右的超宽云层格收束，天空格左侧留白明显多于右侧，Page 04–05 只用夏葵的一声呼喊和安全中缝留下悬念。", targetLabel: "封面、Page 01–05", target: { type: "chapter", id: ids.chapter }, baseRevision: 2, sourceRefs: storyboardBeats.map((beat) => ({ objectType: "storyboard_beat", objectId: beat.id, versionId: beat.versionId })), outputRefs: document.units.map((unit) => ({ objectType: "presentation_unit", objectId: unit.id })), payload: { physicalPages: 5, presentationUnits: 5, frameCount: 13 }, operations: [{ type: "replace_chapter_presentation", document }], appliedRevision: 3 },
  ] });

  const messages = [
    { role: MessageRole.USER, kind: MessageKind.PLAIN, content: "夏葵后脚的透视有点大，气泡也贴头太近；先把跑姿改回最开始原图差不多的动作。", metadata: { intent: "优化跨页", scope: "Page 04–05" } },
    { role: MessageRole.AGENT, kind: MessageKind.PLAIN, content: "我会恢复最初版本自然的屈膝跑姿，并把气泡移到不贴近头部的亮天空区域。", metadata: { scope: "Page 04–05" } },
    { role: MessageRole.USER, kind: MessageKind.PLAIN, content: "右下回头特写也要参考上一次提交里没改过的原分镜重画，背景楼梯的透视要正确，图片中心再放大一些并往左移动一点；跨页对白的尾巴再向右上收短一些。", metadata: { intent: "参考已提交原图重绘", scope: "Page 04–05" } },
    { role: MessageRole.AGENT, kind: MessageKind.PLAIN, content: "好。保留原分镜肩背侧向、回头看向镜头的构图，把背景改成与大跨页一致的水泥看台阶梯和金属扶手，进一步收紧裁切并让画面内容略向左移动；对白位置不变，只把尾巴向右上收短。", metadata: { scope: "Page 04–05" } },
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

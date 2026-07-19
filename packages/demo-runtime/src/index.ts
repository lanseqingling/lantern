import { rainyStationContinuationBeats, rainyStationStoryboardBeats } from "../../shared/fixtures/storyboardBeats";
import type { Candidate, WorkbenchFixture, WorkingEnvelope } from "../../shared/src";
import { compileChapterLayoutPlan, resolvedResourcesForDocument, type ChapterLayoutPlan } from "../../layout-engine/src";

const fixtureCreatedAt = "2026-07-10T08:00:00.000Z";

export const pageBasicPlan: ChapterLayoutPlan = {
  format: "page",
  preset: "page_basic",
  readingOrder: rainyStationStoryboardBeats.map((storyboardBeat) => storyboardBeat.id),
  explanation: "先用两次安静停顿建立教室，再用信封和近景完成页尾推进。",
};

export const verticalBasicPlan: ChapterLayoutPlan = {
  format: "vertical",
  preset: "vertical_basic",
  readingOrder: [...rainyStationStoryboardBeats, ...rainyStationContinuationBeats].map((storyboardBeat) => storyboardBeat.id),
  explanation: "在角色回头前后增加纵向留白，延迟揭示走廊尽头的人影。",
};

export const fourPanelPlan: ChapterLayoutPlan = {
  format: "four_panel",
  preset: "four_panel_grid",
  readingOrder: rainyStationStoryboardBeats.map((storyboardBeat) => storyboardBeat.id),
  explanation: "2×2 固定四格，第三格承接线索，第四格用表情收束。",
};

function createWorking(document = compileChapterLayoutPlan(pageBasicPlan, rainyStationStoryboardBeats)): WorkingEnvelope {
  return {
    documentId: "document-rainy-station-01",
    chapterId: "chapter-rainy-station-01",
    projectId: "project-rainy-station-01",
    createdAt: fixtureCreatedAt,
    state: "working",
    revision: 1,
    document,
    resolvedResources: resolvedResourcesForDocument(document),
  };
}

export function createInitialFixture(): WorkbenchFixture {
  return {
    working: createWorking(),
    storyboardBeats: structuredClone(rainyStationStoryboardBeats),
    references: [
      {
        id: "reference-lincheng",
        kind: "character",
        name: "林澄",
        detail: "雨夜风衣 · 冷静 · 敏锐",
        imageSrc: "/samples/rainy-station/character-lincheng.png",
        x: 270,
        y: 76,
        zoom: 1,
        collapsed: false,
        pinned: true,
      },
      {
        id: "reference-rainy-station",
        kind: "scene",
        name: "梧桐路末班车站",
        detail: "深夜 · 大雨 · 湿亮道路",
        imageSrc: "/samples/rainy-station/scene-rain-bus-stop.png",
        x: 256,
        y: 282,
        zoom: 1,
        collapsed: false,
        pinned: false,
      },
    ],
  };
}

export function createFrameStoryboardCandidate(baseRevision: number, target: {
  unitId: string;
  frameId: string;
  label: string;
  storyboardBeatId?: string;
}): Candidate {
  const title = "雨中的迟疑";
  const description = "雨光从车窗斜切进画格，人物在将要回头的瞬间停住动作；近景保留车票与远处车灯两条线索，让紧迫感集中在这一格内。";
  return {
    id: `candidate-storyboard-${target.frameId}-${baseRevision}`,
    kind: "storyboard",
    title: `编辑分镜条目 · ${target.label}`,
    changeSummary: target.storyboardBeatId ? "已改写选中画格的画面描述，其他画格保持不变。" : "已为选中画格生成画面描述，其他画格保持不变。",
    targetLabel: target.label,
    baseRevision,
    status: "available",
    commands: target.storyboardBeatId
      ? [{ type: "update_storyboard_beat", storyboardBeatId: target.storyboardBeatId, patch: { title, description } }]
      : [{ type: "create_frame_storyboard_beat", unitId: target.unitId, frameId: target.frameId, storyboardBeat: { id: `storyboard-beat-${target.frameId}`, versionId: `storyboard-beat-${target.frameId}-v1`, title, description } }],
    metadata: { storyboardMode: target.storyboardBeatId ? "replace" : "create", storyboardTitle: title, storyboardDescription: description },
  };
}

export type DemoInteractionDecision =
  | { kind: "direct_answer"; message: string }
  | { kind: "needs_input"; message: string; options: string[] }
  | { kind: "needs_confirmation"; message: string; summary: string; scope: string; task: string }
  | { kind: "ready_to_run"; message: string; task: string; scope: string };

export function decideDemoInteraction(message: string, selectionType: string): DemoInteractionDecision {
  const text = message.trim();
  if (!text) return { kind: "direct_answer", message: "可以直接讨论漫画内容，也可以描述要生成的角色、场景图片或要编辑的单格分镜条目。" };
  if (text.includes("状态") || text.includes("为什么") || text.includes("建议")) {
    return { kind: "direct_answer", message: "当前工作稿可继续编辑；最近保存快照保持不变。未应用候选不会进入漫画。" };
  }
  if (/(?:创建|新建|生成|制作).{0,48}(?:角色|人物|场景)|(?:角色|人物|场景).{0,16}(?:设定图|形象图|立绘|图片|卡片|资产)/.test(text)) {
    return { kind: "ready_to_run", message: "我会生成一个资产候选；确认后才保存到资产空间。", task: "asset_parse", scope: "仅图片" };
  }
  if (text.includes("角色") || text.includes("人物") || text.includes("场景")) {
    return { kind: "direct_answer", message: "我会结合故事核心、世界设定和视觉风格与你一起完善这项设定。" };
  }
  if (text.includes("整页") || text.includes("重排") || text.includes("全部") || text.includes("生成分镜") || text.includes("多方案")) {
    return { kind: "direct_answer", message: "当前不能创建整页、整话或多方案分镜；可以先选中一个漫画格，编辑这一格的分镜条目。" };
  }
  if (/(?:重新生成|重画|重绘|生成).{0,12}(?:单格|当前格|这一格|画面|图片)|(?:单格|当前格|这一格).{0,12}(?:图片|成稿)/.test(text)) {
    return { kind: "direct_answer", message: "当前还不能直接重新生成格内图片；这项请求不会改写成分镜条目编辑。" };
  }
  if (selectionType !== "comic_frame") {
    return { kind: "needs_input", message: "请先在画布上选择一个漫画格，我会只处理这一格。", options: [] };
  }
  return { kind: "ready_to_run", message: "我会编辑目标画格的分镜条目，只更新标题和画面描述；应用前不会改变工作稿。", task: "storyboard", scope: "当前格" };
}

export const previewFixtures = {
  page: compileChapterLayoutPlan(pageBasicPlan, rainyStationStoryboardBeats),
  vertical: compileChapterLayoutPlan(verticalBasicPlan, [...rainyStationStoryboardBeats, ...rainyStationContinuationBeats]),
  four_panel: compileChapterLayoutPlan(fourPanelPlan, rainyStationStoryboardBeats),
};

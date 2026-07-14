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

export function createStoryboardLayoutCandidate(baseRevision: number, option: "quiet" | "cinematic" = "quiet"): Candidate {
  const plan: ChapterLayoutPlan = {
    ...pageBasicPlan,
    explanation: option === "quiet"
      ? "四格停顿：把回头和信封线索留出呼吸，适合轻校园短篇。"
      : "电影转场：放大人物回头，压缩信封特写，让情绪更直接。",
  };
  const document = compileChapterLayoutPlan(plan, rainyStationStoryboardBeats);
  return {
    id: `candidate-layout-${option}-${baseRevision}`,
    kind: "page_layout",
    title: option === "quiet" ? "四格停顿" : "电影转场",
    changeSummary: plan.explanation ?? "生成页漫编排",
    targetLabel: "Page 01",
    baseRevision,
    status: "available",
    document,
    commands: [{ type: "replace_chapter_layout", document }],
    metadata: { option },
  };
}

export function createContinuationCandidate(baseRevision: number): Candidate {
  const document = compileChapterLayoutPlan(
    {
      format: "page",
      preset: "page_continuation",
      readingOrder: [...rainyStationStoryboardBeats, ...rainyStationContinuationBeats].map((storyboardBeat) => storyboardBeat.id),
    },
    [...rainyStationStoryboardBeats, ...rainyStationContinuationBeats],
  );
  return {
    id: `candidate-continuation-${baseRevision}`,
    kind: "page_layout",
    title: "走廊转场",
    changeSummary: "从当前页后追加 Page 02，不修改已确认的 Page 01。",
    targetLabel: "当前页之后",
    baseRevision,
    status: "available",
    document,
    commands: [{ type: "replace_chapter_layout", document }],
  };
}

export type DemoInteractionDecision =
  | { kind: "direct_answer"; message: string }
  | { kind: "needs_input"; message: string; options: string[] }
  | { kind: "needs_confirmation"; message: string; summary: string; scope: string; task: string }
  | { kind: "ready_to_run"; message: string; task: string; scope: string };

export function decideDemoInteraction(message: string, selectionType: string): DemoInteractionDecision {
  const text = message.trim();
  if (!text) return { kind: "direct_answer", message: "先写下你想推进的剧情，或选择画布上的一格。" };
  if (text.includes("状态") || text.includes("为什么") || text.includes("建议")) {
    return { kind: "direct_answer", message: "当前工作稿可继续编辑；最近保存快照保持不变。未应用候选不会进入漫画。" };
  }
  if (text.includes("故事") && !text.includes("页漫") && !text.includes("条漫")) {
    return { kind: "needs_input", message: "这个故事可以先比较两种阅读节奏，想先看哪种？", options: ["页漫 · 紧凑停顿", "条漫 · 慢节奏"] };
  }
  if (text.includes("整页") || text.includes("重排") || text.includes("全部")) {
    return { kind: "needs_confirmation", message: "这会改变当前页已确认画格的位置，但不会改写分镜文本或旧保存快照。", summary: "重排当前页的全部画格", scope: "当前页", task: "page_layout" };
  }
  if (text.includes("只改") || text.includes("当前格") || text.includes("撩发")) {
    return { kind: "needs_confirmation", message: `我会只处理${selectionType === "none" ? "当前格" : "当前选中对象"}，不改前后格。`, summary: "保留构图与阅读顺序，只调整动作自然度", scope: "当前格", task: "frame_image_refine" };
  }
  if (text.includes("继续") || text.includes("往下")) {
    return { kind: "ready_to_run", message: "我会读取前文作为上下文，从当前页之后继续追加，不覆盖已确认内容。", task: "continuation", scope: "从这里往下" };
  }
  return { kind: "ready_to_run", message: "我会先生成可比较的候选；应用前不会改变当前工作稿。", task: "storyboard", scope: "当前创作位置" };
}

export const previewFixtures = {
  page: compileChapterLayoutPlan(pageBasicPlan, rainyStationStoryboardBeats),
  vertical: compileChapterLayoutPlan(verticalBasicPlan, [...rainyStationStoryboardBeats, ...rainyStationContinuationBeats]),
  four_panel: compileChapterLayoutPlan(fourPanelPlan, rainyStationStoryboardBeats),
};

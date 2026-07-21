import { rainyStationContinuationBeats, rainyStationStoryboardBeats } from "@lantern/shared/fixtures/storyboard-beats";
import type { WorkbenchFixture, WorkingEnvelope } from "@lantern/shared";
import { compileChapterLayoutPlan, resolvedResourcesForDocument, type ChapterLayoutPlan } from "@lantern/layout-engine";

const fixtureCreatedAt = "2026-07-10T08:00:00.000Z";

const rainyStationLayoutContext = {
  comicId: "comic-rainy-station",
  chapterId: "chapter-rainy-station-01",
  resourcesByStoryboardBeatId: Object.fromEntries(Array.from({ length: 8 }, (_, index) => {
    const number = String(index + 1).padStart(2, "0");
    return [`fixture-rain-beat-${index + 1}`, {
      assetId: `fixture-rain-frame-${number}`,
      assetVersionId: `fixture-rain-frame-${number}-v1`,
      kind: "image" as const,
      width: 1536,
      height: 1024,
      mediaType: "image/png",
      url: `/samples/rainy-station/frame-${number}.png`,
    }];
  })),
  dialogueByStoryboardBeatId: {
    "fixture-rain-beat-1": "23:47。末班车迟到了七分钟。",
    "fixture-rain-beat-3": "这字……",
    "fixture-rain-beat-4": "别上最后一班车。",
    "fixture-rain-beat-5": "车却准时出现在雨里。",
    "fixture-rain-beat-7": "小澄，上车。",
  },
};

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

function createWorking(document = compileChapterLayoutPlan(pageBasicPlan, rainyStationStoryboardBeats, rainyStationLayoutContext)): WorkingEnvelope {
  return {
    documentId: "document-rainy-station-01",
    chapterId: "chapter-rainy-station-01",
    projectId: "project-rainy-station-01",
    createdAt: fixtureCreatedAt,
    state: "working",
    revision: 1,
    document,
    resolvedResources: resolvedResourcesForDocument(document, rainyStationLayoutContext),
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

export const previewFixtures = {
  page: compileChapterLayoutPlan(pageBasicPlan, rainyStationStoryboardBeats, rainyStationLayoutContext),
  vertical: compileChapterLayoutPlan(verticalBasicPlan, [...rainyStationStoryboardBeats, ...rainyStationContinuationBeats], rainyStationLayoutContext),
  four_panel: compileChapterLayoutPlan(fourPanelPlan, rainyStationStoryboardBeats, rainyStationLayoutContext),
};

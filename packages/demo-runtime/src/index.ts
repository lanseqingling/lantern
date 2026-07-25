import { demoContinuationBeats, demoStoryboardBeats } from "@lantern/shared/fixtures/storyboard-beats";
import type { WorkbenchFixture, WorkingEnvelope } from "@lantern/shared";
import { compileChapterLayoutPlan, resolvedResourcesForDocument, type ChapterLayoutPlan } from "@lantern/layout-engine";

const fixtureCreatedAt = "2026-07-10T08:00:00.000Z";

const demoImageFiles = [
  "classroom-lesson-v2.png",
  "classroom-turn-v2.png",
  "bag-letter-v2.png",
  "classroom-after-bell-v2.png",
  "letter-from-black-bag-closeup-v10.png",
  "breakout-rendezvous-v2.png",
  "spread-rendezvous-girls-v6.png",
] as const;

const demoLayoutContext = {
  comicId: "fixture-demo-comic",
  chapterId: "fixture-demo-chapter",
  resourcesByStoryboardBeatId: Object.fromEntries(demoImageFiles.map((fileName, index) => {
    const number = String(index + 1).padStart(2, "0");
    return [`fixture-demo-beat-${index + 1}`, {
      assetId: `fixture-demo-frame-${number}`,
      assetVersionId: `fixture-demo-frame-${number}-v1`,
      kind: "image" as const,
      width: 1536,
      height: 1024,
      mediaType: "image/png",
      url: `/samples/campus-letter/${fileName}`,
    }];
  })),
  dialogueByStoryboardBeatId: {
    "fixture-demo-beat-1": "下课铃还没有响。",
    "fixture-demo-beat-3": "这是谁放的？",
    "fixture-demo-beat-4": "放学后，旧看台。",
    "fixture-demo-beat-7": "你来了。",
  },
};

export const pageBasicPlan: ChapterLayoutPlan = {
  format: "page",
  preset: "page_basic",
  readingOrder: demoStoryboardBeats.map((storyboardBeat) => storyboardBeat.id),
  explanation: "先用两次安静停顿建立教室，再用信封和近景完成页尾推进。",
};

export const verticalBasicPlan: ChapterLayoutPlan = {
  format: "vertical",
  preset: "vertical_basic",
  readingOrder: [...demoStoryboardBeats, ...demoContinuationBeats].map((storyboardBeat) => storyboardBeat.id),
  explanation: "在角色回头前后增加纵向留白，延迟揭示走廊尽头的人影。",
};

export const fourPanelPlan: ChapterLayoutPlan = {
  format: "four_panel",
  preset: "four_panel_grid",
  readingOrder: demoStoryboardBeats.map((storyboardBeat) => storyboardBeat.id),
  explanation: "2×2 固定四格，第三格承接线索，第四格用表情收束。",
};

function createWorking(document = compileChapterLayoutPlan(pageBasicPlan, demoStoryboardBeats, demoLayoutContext)): WorkingEnvelope {
  return {
    documentId: "fixture-demo-document",
    chapterId: "fixture-demo-chapter",
    projectId: "fixture-demo-project",
    createdAt: fixtureCreatedAt,
    state: "working",
    revision: 1,
    document,
    resolvedResources: resolvedResourcesForDocument(document, demoLayoutContext),
  };
}

export function createInitialFixture(): WorkbenchFixture {
  return {
    working: createWorking(),
    storyboardBeats: structuredClone(demoStoryboardBeats),
    references: [
      {
        id: "reference-demo-character",
        kind: "character",
        name: "夏葵",
        detail: "校园制服 · 安静 · 克制",
        imageSrc: "/samples/campus-letter/character-xiakui.png",
        x: 270,
        y: 76,
        zoom: 1,
        collapsed: false,
        pinned: true,
      },
      {
        id: "reference-demo-scene",
        kind: "scene",
        name: "午后课堂",
        detail: "靠窗后排 · 午后 · 安静",
        imageSrc: "/samples/campus-letter/classroom-lesson-v2.png",
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
  page: compileChapterLayoutPlan(pageBasicPlan, demoStoryboardBeats, demoLayoutContext),
  vertical: compileChapterLayoutPlan(verticalBasicPlan, [...demoStoryboardBeats, ...demoContinuationBeats], demoLayoutContext),
  four_panel: compileChapterLayoutPlan(fourPanelPlan, demoStoryboardBeats, demoLayoutContext),
};

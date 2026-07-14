import type {
  ArtElement,
  ComicDocument,
  ComicFormat,
  Dialogue,
  Frame,
  PresentationUnit,
  ResolvedResourceMap,
  ResourceBinding,
  StoryboardBeat,
  TextLayer,
} from "../../shared/src/lcd/types";
import { validateComicDocument } from "../../shared/src/lcd/schema";

export type ChapterLayoutPlan = {
  format: ComicFormat;
  preset: "page_basic" | "page_continuation" | "vertical_basic" | "four_panel_grid";
  readingOrder: string[];
  explanation?: string;
};

type CatalogEntry = ResourceBinding & { url: string };
const frameCatalog: Readonly<Record<string, CatalogEntry>> = Object.fromEntries(
  Array.from({ length: 8 }, (_, index) => {
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
  }),
);

/** Fixture-only dialogue. Production StoryboardBeats never own dialogue text. */
const fixtureDialogueCatalog: Readonly<Record<string, string>> = {
  "fixture-rain-beat-1": "23:47。末班车迟到了七分钟。",
  "fixture-rain-beat-3": "这字……",
  "fixture-rain-beat-4": "别上最后一班车。",
  "fixture-rain-beat-5": "车却准时出现在雨里。",
  "fixture-rain-beat-7": "小澄，上车。",
};

const pageRects = [
  { x: 32, y: 32, width: 656, height: 250 },
  { x: 32, y: 296, width: 656, height: 280 },
  { x: 32, y: 590, width: 656, height: 190 },
  { x: 32, y: 794, width: 656, height: 254 },
];
const continuationRects = [
  { x: 32, y: 32, width: 410, height: 390 },
  { x: 456, y: 32, width: 232, height: 390 },
  { x: 32, y: 436, width: 656, height: 612 },
];
const fourRects = [
  { x: 32, y: 32, width: 320, height: 494 },
  { x: 368, y: 32, width: 320, height: 494 },
  { x: 32, y: 542, width: 320, height: 506 },
  { x: 368, y: 542, width: 320, height: 506 },
];

function frameForBeat(beat: StoryboardBeat, index: number, rect: typeof pageRects[number]): { frame: Frame; dialogue?: Dialogue } {
  const resource = frameCatalog[beat.id];
  const art: ArtElement[] = resource ? [{
    id: `image-${beat.id}`, kind: "image", assetId: resource.assetId, assetVersionId: resource.assetVersionId,
    transform: { x: 0, y: 0, width: 1, height: 1 }, crop: { x: 0, y: 0, width: 1, height: 1 }, name: `第 ${index + 1} 格主图`,
  }] : [];
  const dialogueText = fixtureDialogueCatalog[beat.id];
  const dialogue: Dialogue | undefined = dialogueText ? { id: `dialogue-${beat.id}`, storyboardBeatId: beat.id, storyboardBeatVersionId: beat.versionId, content: dialogueText } : undefined;
  const balloonWidth = Math.min(0.36, 170 / rect.width);
  const textLayer: TextLayer | undefined = dialogue ? {
    id: `frame-${beat.id}-text`, kind: "text", name: "对白", zIndex: 20, visible: true, overflow: "visible",
    elements: [{
      id: `balloon-${beat.id}`, kind: "balloon", dialogueId: dialogue.id,
      transform: { x: 18 / rect.width, y: 18 / rect.height, width: balloonWidth, height: Math.min(0.36, 92 / rect.height) },
      tailTarget: { x: 0.6, y: 0.68 }, shape: index === 2 ? "caption_box" : "normal", name: `第 ${index + 1} 格气泡`,
      style: { fontFamily: "ui-sans-serif", fontSize: 18, textColor: "#172026", fill: "#ffffff", stroke: "#111111", strokeWidth: 3 },
    }],
  } : undefined;
  const frame: Frame = {
    id: `frame-${beat.id}`, geometry: rect, zIndex: index + 1, name: `画格 ${index + 1}`,
    storyRefs: [{ storyboardBeatId: beat.id, storyboardBeatVersionId: beat.versionId, role: "primary" }],
    border: { color: "#111111", width: 4, style: "solid" }, shape: { kind: "rect" }, mask: { mode: "clip" },
    layers: [
      ...(art.length ? [{ id: `frame-${beat.id}-art`, kind: "art" as const, name: "画面", zIndex: 10, visible: true, overflow: "clip" as const, elements: art }] : []),
      ...(textLayer ? [textLayer] : []),
    ],
  };
  return { frame, dialogue };
}

function buildUnit(id: string, index: number, beats: StoryboardBeat[], rects: typeof pageRects, kind: PresentationUnit["kind"] = "single_page"): { unit: PresentationUnit; dialogues: Dialogue[] } {
  const built = beats.map((beat, beatIndex) => frameForBeat(beat, beatIndex, rects[beatIndex]));
  const canvas = { width: 720, height: 1080, background: { color: "#ffffff" } };
  return {
    unit: {
      id, kind, canvas,
      surfaces: [{ id: `${id}-surface`, role: kind === "vertical_segment" ? "segment" : "single", geometry: { x: 0, y: 0, width: canvas.width, height: canvas.height }, pageNumber: index + 1 }],
      frames: built.map((entry) => entry.frame), overlayLayers: [],
      readingSequence: built.map((entry) => ({ frameId: entry.frame.id })),
      layoutPolicy: { frameOverlap: "forbid", defaultOverflow: "clip" },
    },
    dialogues: built.flatMap((entry) => entry.dialogue ? [entry.dialogue] : []),
  };
}

function buildVerticalUnit(id: string, index: number, beats: StoryboardBeat[]): { unit: PresentationUnit; dialogues: Dialogue[] } {
  const rects = beats.map((_, beatIndex) => ({ x: 28, y: 28 + beatIndex * 520, width: 584, height: beatIndex === 1 ? 390 : 430 }));
  const built = beats.map((beat, beatIndex) => frameForBeat(beat, beatIndex, rects[beatIndex]));
  const canvas = { width: 640, height: Math.max(980, 60 + beats.length * 520), background: { color: "#ffffff" } };
  return {
    unit: {
      id, kind: "vertical_segment", canvas,
      surfaces: [{ id: `${id}-surface`, role: "segment", geometry: { x: 0, y: 0, width: canvas.width, height: canvas.height }, pageNumber: index + 1 }],
      frames: built.map((entry) => entry.frame), overlayLayers: [], readingSequence: built.map((entry) => ({ frameId: entry.frame.id })),
      layoutPolicy: { frameOverlap: "forbid", defaultOverflow: "clip" },
    }, dialogues: built.flatMap((entry) => entry.dialogue ? [entry.dialogue] : []),
  };
}

export function resolvedResourcesForDocument(document: ComicDocument): ResolvedResourceMap {
  const byVersion = new Map(Object.values(frameCatalog).map((entry) => [entry.assetVersionId, entry.url]));
  return Object.fromEntries(document.resources.flatMap((resource) => {
    const url = byVersion.get(resource.assetVersionId);
    return url ? [[resource.assetVersionId, { url }]] : [];
  }));
}

export function compileChapterLayoutPlan(plan: ChapterLayoutPlan, storyboardBeats: StoryboardBeat[]): ComicDocument {
  const ordered = plan.readingOrder.map((id) => storyboardBeats.find((beat) => beat.id === id)).filter((beat): beat is StoryboardBeat => Boolean(beat));
  if (ordered.length !== plan.readingOrder.length) throw new Error("ChapterLayoutPlan contains an unknown StoryboardBeat");
  let built: Array<{ unit: PresentationUnit; dialogues: Dialogue[] }>;
  if (plan.format === "vertical") {
    built = [buildVerticalUnit("segment-1", 0, ordered.slice(0, 2)), buildVerticalUnit("segment-2", 1, ordered.slice(2))].filter((entry) => entry.unit.frames.length > 0);
  } else if (plan.format === "four_panel") {
    if (ordered.length !== 4) throw new Error("four_panel requires exactly four StoryboardBeats");
    built = [buildUnit("four-panel-unit-1", 0, ordered, fourRects, "four_panel_unit")];
  } else {
    const chunks: StoryboardBeat[][] = [];
    for (let index = 0; index < ordered.length; index += 4) chunks.push(ordered.slice(index, index + 4));
    built = chunks.map((chunk, index) => buildUnit(`page-${index + 1}`, index, chunk, chunk.length === 3 ? continuationRects : pageRects));
  }
  const resources = Array.from(new Map(ordered.flatMap((beat) => {
    const resource = frameCatalog[beat.id];
    if (!resource) return [];
    const binding: ResourceBinding = { assetId: resource.assetId, assetVersionId: resource.assetVersionId, kind: resource.kind, width: resource.width, height: resource.height, mediaType: resource.mediaType };
    return [[resource.assetVersionId, binding] as const];
  })).values());
  return validateComicDocument({
    protocolVersion: "lcd-0.4", comicId: "comic-rainy-station", chapterId: "chapter-rainy-station-01", format: plan.format,
    reading: { direction: plan.format === "vertical" || plan.format === "four_panel" ? "ttb" : "ltr", viewer: plan.format === "vertical" ? "scroll" : plan.format === "four_panel" ? "unit" : "paged", unitOrder: built.map((entry) => entry.unit.id), showPageNumber: true, gap: plan.format === "vertical" ? 24 : undefined },
    units: built.map((entry) => entry.unit), resources, dialogues: built.flatMap((entry) => entry.dialogues),
  });
}

/** Lantern Comic Document v0.4.
 *
 * Narrative planning (StoryboardBeat), presentation structure (Unit/Surface/
 * Frame), visual composition (Layer/Element) and workflow state are separate
 * domains. Persisted LCD data never contains signed or proxy URLs.
 */
export type ComicFormat = "page" | "vertical" | "four_panel";
export type ReadingDirection = "ltr" | "rtl" | "ttb";

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };
export type Geometry = Rect & { rotate?: number };
/** Normalized to the owning frame: 0,0,1,1 fills the frame. */
export type LocalTransform = Rect & { rotate?: number };
export type NormalizedRect = Rect;
export type Insets = { top: number; right: number; bottom: number; left: number };

export type StoryboardBeat = {
  id: string;
  versionId: string;
  /** A concise, user-facing label for the frame's narrative content. */
  title: string;
  /** A general visual/narrative description. Mood, action and scene details belong here. */
  description: string;
};

/**
 * Reads pre-title/description StoryboardBeat JSON without keeping the legacy
 * role-performance fields in the canonical model. This is intentionally a
 * read-boundary adapter for old WorkingRevisions and Candidates.
 */
export function normalizeStoryboardBeat(value: unknown): StoryboardBeat {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const text = (key: string) => typeof input[key] === "string" ? input[key].trim() : "";
  const title = text("title") || text("storyPurpose") || "未命名单格";
  const legacyDescription = [
    ["shotType", "镜头"],
    ["composition", "构图"],
    ["action", "画面"],
    ["emotion", "氛围"],
  ].map(([key, label]) => text(key) ? `${label}：${text(key)}` : "").filter(Boolean).join("；");
  return {
    id: text("id"),
    versionId: text("versionId"),
    title,
    description: text("description") || legacyDescription,
  };
}

export function normalizeStoryboardBeats(values: unknown): StoryboardBeat[] {
  return Array.isArray(values) ? values.map(normalizeStoryboardBeat) : [];
}

export type StoryboardBeatRef = {
  storyboardBeatId: string;
  storyboardBeatVersionId: string;
  role: "primary" | "continuity";
};

export type ResourceBinding = {
  assetId: string;
  assetVersionId: string;
  kind: "image" | "font" | "texture";
  mediaType: string;
  width?: number;
  height?: number;
  checksum?: string;
};

export type ResolvedResourceMap = Record<string, { url: string; expiresAt?: string }>;

export type Dialogue = {
  id: string;
  storyboardBeatId?: string;
  storyboardBeatVersionId?: string;
  speakerAssetId?: string;
  content: string;
};

export type BorderStyle = {
  color: string;
  width: number;
  style: "solid" | "none" | "rough";
};

export type FrameShape =
  | { kind: "rect"; radius?: number }
  | { kind: "polygon"; points: Point[] }
  | { kind: "ellipse" };

export type LayerOverflow = "inherit" | "clip" | "visible";

export type ArtElement = {
  id: string;
  kind: "image";
  assetId: string;
  assetVersionId: string;
  transform: LocalTransform;
  crop: NormalizedRect;
  opacity?: number;
  blendMode?: "normal" | "multiply" | "screen";
  overflow?: LayerOverflow;
  visible?: boolean;
  name?: string;
};

export type TextElement = {
  id: string;
  kind: "text";
  transform: LocalTransform;
  content: string;
  role: "caption" | "narration" | "sfx";
  style: {
    fontFamily: string;
    fontSize: number;
    fontWeight?: number;
    color: string;
    align?: "left" | "center" | "right";
    writingMode?: "horizontal" | "vertical";
  };
  visible?: boolean;
  name?: string;
};

export type BalloonElement = {
  id: string;
  kind: "balloon";
  dialogueId: string;
  transform: LocalTransform;
  tailTarget?: Point;
  shape: "normal" | "thought" | "caption_box";
  style: {
    fontFamily: string;
    fontSize: number;
    textColor: string;
    fill: string;
    stroke: string;
    strokeWidth: number;
    writingMode?: "horizontal" | "vertical";
  };
  overflow?: LayerOverflow;
  visible?: boolean;
  name?: string;
};

export type EffectElement = {
  id: string;
  kind: "effect";
  effectType: "speed_lines" | "tone" | "focus" | "sfx_art" | "custom";
  transform: LocalTransform;
  assetId?: string;
  assetVersionId?: string;
  opacity?: number;
  visible?: boolean;
  name?: string;
};

export type FrameLayerBase = {
  id: string;
  name: string;
  zIndex: number;
  visible: boolean;
  locked?: boolean;
  overflow: LayerOverflow;
};

export type ArtLayer = FrameLayerBase & { kind: "art"; elements: ArtElement[] };
export type TextLayer = FrameLayerBase & { kind: "text"; elements: Array<TextElement | BalloonElement> };
export type EffectLayer = FrameLayerBase & { kind: "effect"; elements: EffectElement[] };
export type FrameLayer = ArtLayer | TextLayer | EffectLayer;
export type FrameElement = ArtElement | TextElement | BalloonElement | EffectElement;

export type Frame = {
  id: string;
  geometry: Geometry;
  zIndex: number;
  storyRefs: StoryboardBeatRef[];
  border: BorderStyle;
  shape: FrameShape;
  mask: { mode: "clip" | "visible" | "bleed" };
  layers: FrameLayer[];
  constraints?: Array<"stay_on_surface" | "preserve_aspect" | "locked">;
  visible?: boolean;
  name?: string;
};

/**
 * Unit overlay layers separate coordinate ownership from composition scope.
 * A frame-anchored layer uses normalized transforms and follows the frame, but
 * is composited at unit level so it can break a border or overlap neighbours.
 * A unit-anchored layer uses unit-space geometry.
 */
export type OverlayAnchor = { type: "unit" } | { type: "frame"; frameId: string };
export type OverlayElement =
  | (Omit<ArtElement, "transform"> & { transform: Geometry })
  | (Omit<TextElement, "transform"> & { transform: Geometry })
  | (Omit<BalloonElement, "transform"> & { transform: Geometry })
  | (Omit<EffectElement, "transform"> & { transform: Geometry });

export type UnitOverlayLayer = {
  id: string;
  name: string;
  zIndex: number;
  visible: boolean;
  locked?: boolean;
  anchor: OverlayAnchor;
  purpose: "breakout" | "cross_frame" | "cross_page" | "page_effect" | "decoration";
  elements: OverlayElement[];
};

export type FrameReadingEntry = { frameId: string; textOrder?: string[] };

export type PageSurface = {
  id: string;
  role: "single" | "left" | "right" | "segment";
  geometry: Rect;
  trim?: Insets;
  bleed?: Insets;
  pageNumber?: number;
};

export type PresentationUnit = {
  id: string;
  kind: "single_page" | "spread" | "vertical_segment" | "four_panel_unit";
  canvas: { width: number; height: number; background: { color: string } };
  surfaces: PageSurface[];
  frames: Frame[];
  overlayLayers: UnitOverlayLayer[];
  readingSequence: FrameReadingEntry[];
  layoutPolicy: {
    frameOverlap: "forbid" | "allow";
    gutter?: number;
    defaultOverflow: "clip" | "visible";
  };
};

export type ComicDocument = {
  protocolVersion: "lcd-0.4";
  comicId: string;
  chapterId: string;
  format: ComicFormat;
  reading: {
    direction: ReadingDirection;
    viewer: "paged" | "spread" | "scroll" | "unit";
    unitOrder: string[];
    gap?: number;
    showPageNumber?: boolean;
  };
  units: PresentationUnit[];
  resources: ResourceBinding[];
  dialogues: Dialogue[];
};

export type WorkingEnvelope = {
  documentId: string;
  chapterId: string;
  projectId: string;
  createdAt: string;
  state: "working";
  revision: number;
  document: ComicDocument;
  resolvedResources?: ResolvedResourceMap;
};
export type SnapshotEnvelope = Omit<WorkingEnvelope, "state" | "revision"> & { state: "snapshot"; sourceWorkingRevision: number };
export type CandidateEnvelope = Omit<WorkingEnvelope, "state" | "revision"> & { state: "candidate"; baseRevision: number; sourceCandidateId: string };
export type ComicDocumentEnvelope = WorkingEnvelope | SnapshotEnvelope | CandidateEnvelope;

export const frameElements = (frame: Frame): FrameElement[] => {
  const elements: FrameElement[] = [];
  frame.layers.forEach((layer) => elements.push(...layer.elements));
  return elements;
};
export const unitElements = (unit: PresentationUnit): Array<Frame | FrameElement | OverlayElement> => [
  ...unit.frames,
  ...unit.frames.flatMap(frameElements),
  ...unit.overlayLayers.flatMap((layer) => layer.elements),
];
export const findFrame = (document: ComicDocument, frameId: string) =>
  document.units.flatMap((unit) => unit.frames).find((frame) => frame.id === frameId);
export const findUnitForFrame = (document: ComicDocument, frameId: string) =>
  document.units.find((unit) => unit.frames.some((frame) => frame.id === frameId));

export function deriveLocalTransform(frame: Geometry, child: Geometry): LocalTransform {
  return {
    x: (child.x - frame.x) / frame.width,
    y: (child.y - frame.y) / frame.height,
    width: child.width / frame.width,
    height: child.height / frame.height,
    rotate: child.rotate,
  };
}

export function resolveLocalTransform(frame: Geometry, local: LocalTransform): Geometry {
  return {
    x: frame.x + local.x * frame.width,
    y: frame.y + local.y * frame.height,
    width: local.width * frame.width,
    height: local.height * frame.height,
    ...(typeof local.rotate === "number" ? { rotate: local.rotate } : {}),
  };
}

type CanvasViewBase = {
  id: string;
  geometry: Geometry;
  zIndex: number;
  linkedStoryboardBeatId?: string;
  linkedStoryboardBeatVersionId?: string;
  visible?: boolean;
  name?: string;
};

export type ComicFrameElement = CanvasViewBase & {
  type: "comic_frame";
  linkedStoryboardBeatId: string;
  linkedStoryboardBeatVersionId: string;
  readingOrder: number;
  border: BorderStyle;
  mask: { mode: "clip" | "none" | "bleed"; shape: "rect" };
  layerId?: undefined;
};

export type ImageElement = CanvasViewBase & {
  type: "image";
  assetId: string;
  assetVersionId: string;
  comicFrameId?: string;
  clipToFrame: boolean;
  frameRelativeGeometry?: Rect;
  crop?: Rect;
  style?: { opacity?: number };
  layerId: string;
};

export type TextCanvasElement = CanvasViewBase & {
  type: "text";
  comicFrameId?: string;
  readingOrder?: number;
  content: { text: string; role: "caption" | "narration" };
  style: TextElement["style"];
  layerId: string;
};

export type SpeechBalloonElement = CanvasViewBase & {
  type: "speech_balloon";
  comicFrameId: string;
  linkedStoryboardBeatId: string;
  linkedStoryboardBeatVersionId: string;
  dialogueId: string;
  readingOrder: number;
  content: { text: string; shape: BalloonElement["shape"]; tailTarget?: Point };
  style: BalloonElement["style"];
  layerId: string;
};

export type CanvasElement = ComicFrameElement | ImageElement | TextCanvasElement | SpeechBalloonElement;
export type ComicPage = {
  id: string;
  pageIndex: number;
  kind: "page" | "vertical_segment" | "four_panel_unit";
  canvas: { width: number; height: number; background: { color: string } };
  elements: CanvasElement[];
};

export function createComicPageView(document: ComicDocument, unit: PresentationUnit): ComicPage {
  const dialogueById = new Map(document.dialogues.map((dialogue) => [dialogue.id, dialogue.content]));
  const readingOrder = new Map(unit.readingSequence.map((entry, index) => [entry.frameId, index + 1]));
  const elements: CanvasElement[] = [];
  unit.frames.forEach((frame) => {
    const primary = frame.storyRefs.find((reference) => reference.role === "primary") ?? frame.storyRefs[0];
    elements.push({
      id: frame.id, type: "comic_frame", geometry: frame.geometry, zIndex: frame.zIndex,
      linkedStoryboardBeatId: primary?.storyboardBeatId ?? "unassigned",
      linkedStoryboardBeatVersionId: primary?.storyboardBeatVersionId ?? "unassigned-v1",
      readingOrder: readingOrder.get(frame.id) ?? 0, border: frame.border,
      mask: { mode: frame.mask.mode === "visible" ? "none" : frame.mask.mode, shape: "rect" }, visible: frame.visible, name: frame.name,
    });
    frame.layers.forEach((layer) => layer.elements.forEach((element) => {
      const geometry = resolveLocalTransform(frame.geometry, element.transform);
      if (element.kind === "image") elements.push({
        id: element.id, type: "image", geometry, zIndex: frame.zIndex * 100 + layer.zIndex, layerId: layer.id,
        linkedStoryboardBeatId: primary?.storyboardBeatId, linkedStoryboardBeatVersionId: primary?.storyboardBeatVersionId,
        assetId: element.assetId, assetVersionId: element.assetVersionId, comicFrameId: frame.id, clipToFrame: layer.overflow !== "visible" && element.overflow !== "visible",
        frameRelativeGeometry: element.transform, crop: element.crop, style: { opacity: element.opacity }, visible: element.visible, name: element.name,
      });
      else if (element.kind === "balloon") elements.push({
        id: element.id, type: "speech_balloon", geometry, zIndex: frame.zIndex * 100 + layer.zIndex, layerId: layer.id, comicFrameId: frame.id,
        linkedStoryboardBeatId: primary?.storyboardBeatId ?? "unassigned", linkedStoryboardBeatVersionId: primary?.storyboardBeatVersionId ?? "unassigned-v1",
        dialogueId: element.dialogueId, readingOrder: 1, content: { text: dialogueById.get(element.dialogueId) ?? "", shape: element.shape, tailTarget: element.tailTarget ? { x: frame.geometry.x + element.tailTarget.x * frame.geometry.width, y: frame.geometry.y + element.tailTarget.y * frame.geometry.height } : undefined },
        style: element.style, visible: element.visible, name: element.name,
      });
      else if (element.kind === "text") elements.push({
        id: element.id, type: "text", geometry, zIndex: frame.zIndex * 100 + layer.zIndex, layerId: layer.id, comicFrameId: frame.id,
        linkedStoryboardBeatId: primary?.storyboardBeatId, linkedStoryboardBeatVersionId: primary?.storyboardBeatVersionId,
        content: { text: element.content, role: element.role === "sfx" ? "caption" : element.role }, style: element.style, visible: element.visible, name: element.name,
      });
    }));
  });
  return {
    id: unit.id,
    pageIndex: document.reading.unitOrder.indexOf(unit.id),
    kind: unit.kind === "single_page" || unit.kind === "spread" ? "page" : unit.kind,
    canvas: unit.canvas,
    elements,
  };
}

export function createComicPageViews(document: ComicDocument): ComicPage[] {
  const units = new Map(document.units.map((unit) => [unit.id, unit]));
  return document.reading.unitOrder.flatMap((unitId) => {
    const unit = units.get(unitId);
    return unit ? [createComicPageView(document, unit)] : [];
  });
}

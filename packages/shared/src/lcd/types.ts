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

/** A fixed visual resource used by a semantic text or balloon element. */
export type VisualAssetReference = Pick<ResourceBinding, "assetId" | "assetVersionId">;

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

export type FrameCornerIndex = 0 | 1 | 2 | 3;
export type FrameCornerAxis = "x" | "y";

const rectangularFramePoints: [Point, Point, Point, Point] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

/** Returns the editable corners in clockwise top-left → top-right → bottom-right → bottom-left order. */
export function frameQuadrilateralPoints(shape: FrameShape): [Point, Point, Point, Point] | undefined {
  if (shape.kind === "rect") return structuredClone(rectangularFramePoints);
  if (shape.kind !== "polygon" || shape.points.length !== 4) return undefined;
  return shape.points.map((point) => ({ ...point })) as [Point, Point, Point, Point];
}

/** Locks a corner gesture to the first axis whose movement clears the pointer threshold. */
export function frameCornerDragAxis(deltaX: number, deltaY: number, threshold = 4): FrameCornerAxis | undefined {
  if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < threshold) return undefined;
  return Math.abs(deltaX) >= Math.abs(deltaY) ? "x" : "y";
}

const roundedCoordinate = (value: number) => Math.round(value * 1_000_000) / 1_000_000;

/**
 * Moves one quadrilateral corner along a single axis and rebases the frame geometry
 * to the resulting polygon bounds. Other corners remain fixed in canvas space.
 */
export function reshapeFrameCorner(
  geometry: Geometry,
  shape: FrameShape,
  cornerIndex: FrameCornerIndex,
  axis: FrameCornerAxis,
  delta: number,
  bounds: Geometry,
): { geometry: Geometry; shape: Extract<FrameShape, { kind: "polygon" }> } | undefined {
  const points = frameQuadrilateralPoints(shape);
  if (!points || !Number.isFinite(delta)) return undefined;
  const absolute = points.map((point) => ({
    x: geometry.x + point.x * geometry.width,
    y: geometry.y + point.y * geometry.height,
  })) as [Point, Point, Point, Point];
  const leftCorner = cornerIndex === 0 || cornerIndex === 3;
  const topCorner = cornerIndex === 0 || cornerIndex === 1;
  const minimumWidth = Math.min(geometry.width * .45, Math.max(24, geometry.width * .15));
  const minimumHeight = Math.min(geometry.height * .45, Math.max(20, geometry.height * .15));
  const moving = absolute[cornerIndex];
  if (axis === "x") {
    const opposite = leftCorner ? [absolute[1].x, absolute[2].x] : [absolute[0].x, absolute[3].x];
    const minimum = leftCorner ? bounds.x : Math.max(...opposite) + minimumWidth;
    const maximum = leftCorner ? Math.min(...opposite) - minimumWidth : bounds.x + bounds.width;
    moving.x = Math.min(maximum, Math.max(minimum, moving.x + delta));
  } else {
    const opposite = topCorner ? [absolute[2].y, absolute[3].y] : [absolute[0].y, absolute[1].y];
    const minimum = topCorner ? bounds.y : Math.max(...opposite) + minimumHeight;
    const maximum = topCorner ? Math.min(...opposite) - minimumHeight : bounds.y + bounds.height;
    moving.y = Math.min(maximum, Math.max(minimum, moving.y + delta));
  }
  const minX = Math.min(...absolute.map((point) => point.x));
  const minY = Math.min(...absolute.map((point) => point.y));
  const maxX = Math.max(...absolute.map((point) => point.x));
  const maxY = Math.max(...absolute.map((point) => point.y));
  const nextGeometry = { x: roundedCoordinate(minX), y: roundedCoordinate(minY), width: roundedCoordinate(maxX - minX), height: roundedCoordinate(maxY - minY) };
  const nextPoints = absolute.map((point) => ({
    x: roundedCoordinate((point.x - minX) / nextGeometry.width),
    y: roundedCoordinate((point.y - minY) / nextGeometry.height),
  })) as [Point, Point, Point, Point];
  return { geometry: nextGeometry, shape: { kind: "polygon", points: nextPoints } };
}

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
    stroke?: string;
    strokeWidth?: number;
    align?: "left" | "center" | "right";
    writingMode?: "horizontal" | "vertical";
  };
  appearance?: VisualAssetReference;
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
  appearance?: VisualAssetReference;
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
  /** Defaults to one physical surface; `unit` explicitly enables a cross-page frame. */
  surfaceScope?: "surface" | "unit";
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
  /** Optional physical-page constraint inside a true spread. */
  surfaceId?: string;
  purpose: "breakout" | "cross_frame" | "cross_page" | "cross_segment" | "page_content" | "narration" | "page_effect" | "decoration";
  elements: OverlayElement[];
};

export type ElementLocation =
  | { space: "frame"; frameId: string; layerId: string }
  | { space: "overlay"; layerId: string; anchor: OverlayAnchor; surfaceId?: string; purpose: UnitOverlayLayer["purpose"] };

export type FrameReadingEntry = { frameId: string; textOrder?: string[] };

export type PageSurface = {
  id: string;
  name?: string;
  role: "single" | "left" | "right" | "segment";
  geometry: Rect;
  trim?: Insets;
  bleed?: Insets;
  pageNumber?: number;
};

export type PresentationUnit = {
  id: string;
  name?: string;
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

/** Projects a normalized source crop into the image box used by every renderer. */
export function projectImageCrop(crop: NormalizedRect): Rect {
  return {
    x: -crop.x / crop.width,
    y: -crop.y / crop.height,
    width: 1 / crop.width,
    height: 1 / crop.height,
  };
}

/**
 * Scales a normalized source crop around a point in the visible frame.
 * A crop cannot grow past the source bounds, so the projected image always
 * remains at least as wide and tall as its owning frame.
 */
export function scaleImageCrop(crop: NormalizedRect, factor: number, anchor: Point = { x: .5, y: .5 }, minimumSize = .08): NormalizedRect {
  const clampNormalized = (value: number) => Math.min(1, Math.max(0, value));
  const width = Math.min(1, Math.max(Number.EPSILON, crop.width));
  const height = Math.min(1, Math.max(Number.EPSILON, crop.height));
  const safeMinimum = Math.min(1, Math.max(Number.EPSILON, minimumSize));
  const minimumFactor = Math.min(1, Math.max(safeMinimum / width, safeMinimum / height));
  const maximumFactor = Math.max(1, Math.min(1 / width, 1 / height));
  const appliedFactor = Math.min(maximumFactor, Math.max(minimumFactor, Number.isFinite(factor) && factor > 0 ? factor : 1));
  const nextWidth = Math.min(1, width * appliedFactor);
  const nextHeight = Math.min(1, height * appliedFactor);
  const anchorX = clampNormalized(anchor.x);
  const anchorY = clampNormalized(anchor.y);
  const sourceX = crop.x + width * anchorX;
  const sourceY = crop.y + height * anchorY;
  return {
    x: Math.min(1 - nextWidth, Math.max(0, sourceX - nextWidth * anchorX)),
    y: Math.min(1 - nextHeight, Math.max(0, sourceY - nextHeight * anchorY)),
    width: nextWidth,
    height: nextHeight,
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
  surfaceScope?: Frame["surfaceScope"];
  linkedStoryboardBeatId: string;
  linkedStoryboardBeatVersionId: string;
  readingOrder: number;
  border: BorderStyle;
  shape: FrameShape;
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
  location: ElementLocation;
};

export type TextCanvasElement = CanvasViewBase & {
  type: "text";
  comicFrameId?: string;
  readingOrder?: number;
  content: { text: string; role: TextElement["role"] };
  style: TextElement["style"];
  appearance?: VisualAssetReference;
  layerId: string;
  location: ElementLocation;
};

export type SpeechBalloonElement = CanvasViewBase & {
  type: "speech_balloon";
  comicFrameId?: string;
  linkedStoryboardBeatId?: string;
  linkedStoryboardBeatVersionId?: string;
  dialogueId: string;
  readingOrder: number;
  content: { text: string; shape: BalloonElement["shape"]; tailTarget?: Point };
  style: BalloonElement["style"];
  appearance?: VisualAssetReference;
  layerId: string;
  location: ElementLocation;
};

export type CanvasElement = ComicFrameElement | ImageElement | TextCanvasElement | SpeechBalloonElement;
export type ComicPage = {
  id: string;
  name?: string;
  pageIndex: number;
  kind: "page" | "spread" | "vertical_segment" | "four_panel_unit";
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
      surfaceScope: frame.surfaceScope,
      linkedStoryboardBeatId: primary?.storyboardBeatId ?? "unassigned",
      linkedStoryboardBeatVersionId: primary?.storyboardBeatVersionId ?? "unassigned-v1",
      readingOrder: readingOrder.get(frame.id) ?? 0, border: frame.border, shape: frame.shape,
      mask: { mode: frame.mask.mode === "visible" ? "none" : frame.mask.mode, shape: "rect" }, visible: frame.visible, name: frame.name,
    });
    frame.layers.forEach((layer) => layer.elements.forEach((element) => {
      const geometry = resolveLocalTransform(frame.geometry, element.transform);
      if (element.kind === "image") elements.push({
        id: element.id, type: "image", geometry, zIndex: frame.zIndex * 100 + layer.zIndex, layerId: layer.id,
        linkedStoryboardBeatId: primary?.storyboardBeatId, linkedStoryboardBeatVersionId: primary?.storyboardBeatVersionId,
        assetId: element.assetId, assetVersionId: element.assetVersionId, comicFrameId: frame.id, clipToFrame: layer.overflow !== "visible" && element.overflow !== "visible",
        frameRelativeGeometry: element.transform, crop: element.crop, style: { opacity: element.opacity }, visible: element.visible, name: element.name,
        location: { space: "frame", frameId: frame.id, layerId: layer.id },
      });
      else if (element.kind === "balloon") elements.push({
        id: element.id, type: "speech_balloon", geometry, zIndex: frame.zIndex * 100 + layer.zIndex, layerId: layer.id, comicFrameId: frame.id,
        linkedStoryboardBeatId: primary?.storyboardBeatId ?? "unassigned", linkedStoryboardBeatVersionId: primary?.storyboardBeatVersionId ?? "unassigned-v1",
        dialogueId: element.dialogueId, readingOrder: 1, content: { text: dialogueById.get(element.dialogueId) ?? "", shape: element.shape, tailTarget: element.tailTarget ? { x: frame.geometry.x + element.tailTarget.x * frame.geometry.width, y: frame.geometry.y + element.tailTarget.y * frame.geometry.height } : undefined },
        style: element.style, appearance: element.appearance, visible: element.visible, name: element.name,
        location: { space: "frame", frameId: frame.id, layerId: layer.id },
      });
      else if (element.kind === "text") elements.push({
        id: element.id, type: "text", geometry, zIndex: frame.zIndex * 100 + layer.zIndex, layerId: layer.id, comicFrameId: frame.id,
        linkedStoryboardBeatId: primary?.storyboardBeatId, linkedStoryboardBeatVersionId: primary?.storyboardBeatVersionId,
        content: { text: element.content, role: element.role }, style: element.style, appearance: element.appearance, visible: element.visible, name: element.name,
        location: { space: "frame", frameId: frame.id, layerId: layer.id },
      });
    }));
  });
  unit.overlayLayers.forEach((layer) => {
    const anchor = layer.anchor;
    const anchorFrame = anchor.type === "frame" ? unit.frames.find((frame) => frame.id === anchor.frameId) : undefined;
    const primary = anchorFrame?.storyRefs.find((reference) => reference.role === "primary") ?? anchorFrame?.storyRefs[0];
    layer.elements.forEach((element, index) => {
      const geometry = anchorFrame ? resolveLocalTransform(anchorFrame.geometry, element.transform) : element.transform;
      const location: ElementLocation = { space: "overlay", layerId: layer.id, anchor: layer.anchor, ...(layer.surfaceId ? { surfaceId: layer.surfaceId } : {}), purpose: layer.purpose };
      const zIndex = layer.purpose === "narration" ? 2_000_000_000 + index : 1_000_000 + layer.zIndex * 10 + index;
      if (element.kind === "image") elements.push({
        id: element.id, type: "image", geometry, zIndex, layerId: layer.id,
        linkedStoryboardBeatId: primary?.storyboardBeatId, linkedStoryboardBeatVersionId: primary?.storyboardBeatVersionId,
        assetId: element.assetId, assetVersionId: element.assetVersionId, comicFrameId: anchorFrame?.id, clipToFrame: false,
        frameRelativeGeometry: anchorFrame ? element.transform : undefined, crop: element.crop, style: { opacity: element.opacity }, visible: element.visible, name: element.name, location,
      });
      else if (element.kind === "balloon") elements.push({
        id: element.id, type: "speech_balloon", geometry, zIndex, layerId: layer.id, comicFrameId: anchorFrame?.id,
        linkedStoryboardBeatId: primary?.storyboardBeatId, linkedStoryboardBeatVersionId: primary?.storyboardBeatVersionId,
        dialogueId: element.dialogueId, readingOrder: 1,
        content: { text: dialogueById.get(element.dialogueId) ?? "", shape: element.shape, tailTarget: element.tailTarget ? anchorFrame ? { x: anchorFrame.geometry.x + element.tailTarget.x * anchorFrame.geometry.width, y: anchorFrame.geometry.y + element.tailTarget.y * anchorFrame.geometry.height } : element.tailTarget : undefined },
        style: element.style, appearance: element.appearance, visible: element.visible, name: element.name, location,
      });
      else if (element.kind === "text") elements.push({
        id: element.id, type: "text", geometry, zIndex, layerId: layer.id, comicFrameId: anchorFrame?.id,
        readingOrder: layer.purpose === "narration" ? index + 1 : undefined,
        linkedStoryboardBeatId: primary?.storyboardBeatId, linkedStoryboardBeatVersionId: primary?.storyboardBeatVersionId,
        content: { text: element.content, role: element.role }, style: element.style, appearance: element.appearance, visible: element.visible, name: element.name, location,
      });
    });
  });
  return {
    id: unit.id,
    name: unit.name,
    pageIndex: document.reading.unitOrder.indexOf(unit.id),
    kind: unit.kind === "single_page" ? "page" : unit.kind,
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

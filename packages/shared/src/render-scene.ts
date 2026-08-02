import type {
  BalloonElement,
  ComicDocument,
  Frame,
  FrameElement,
  Geometry,
  LayerOverflow,
  OverlayElement,
  Point,
  PresentationUnit,
  TextElement,
  UnitOverlayLayer,
} from "./lcd/types";
import { balloonCutCornerPoints, resolveLocalTransform } from "./lcd/types";

export type SceneFrameNode = {
  frame: Frame;
  geometry: Geometry;
  fillZIndex: number;
  borderZIndex: number;
};

export type SceneElementNode = {
  element: FrameElement | OverlayElement;
  geometry: Geometry;
  zIndex: number;
  source: "frame" | "overlay";
  frame?: Frame;
  layerId: string;
  clipFrame?: Frame;
  dialogueText?: string;
  overlayPurpose?: UnitOverlayLayer["purpose"];
  surfaceId?: string;
};

export type ComicRenderScene = {
  unit: PresentationUnit;
  frames: SceneFrameNode[];
  elements: SceneElementNode[];
};

export function projectTextStrokeWidth(text: Pick<TextElement, "role" | "style">) {
  const stored = text.style.stroke && text.style.strokeWidth ? text.style.strokeWidth : 0;
  return text.role === "narration" && text.style.stroke ? Math.max(2, stored) : stored;
}

export type BalloonTailProjection = {
  tip: Point;
  start: Point;
  end: Point;
  startControl: Point;
  endControl: Point;
};

export type BalloonStrokeWidths = {
  outline: number;
  tail: number;
};

export type BalloonOverlapMask =
  | { shape: "ellipse"; cx: number; cy: number; rx: number; ry: number; expansion: number }
  | { shape: "rect"; x: number; y: number; width: number; height: number; rx: number; ry: number; expansion: number }
  | { shape: "polygon"; points: Point[]; expansion: number };

const FRAME_STRIDE = 10_000;
const FRAME_CONTENT_OFFSET = 100;
const FRAME_BORDER_OFFSET = 9_000;

function effectiveOverflow(defaultOverflow: "clip" | "visible", layerOverflow: LayerOverflow, element: FrameElement | OverlayElement) {
  const elementOverflow = "overflow" in element ? element.overflow : undefined;
  if (elementOverflow && elementOverflow !== "inherit") return elementOverflow;
  if (layerOverflow !== "inherit") return layerOverflow;
  return defaultOverflow;
}

export function projectComicRenderScene(document: ComicDocument, unit: PresentationUnit): ComicRenderScene {
  const dialogues = new Map(document.dialogues.map((dialogue) => [dialogue.id, dialogue.content]));
  const frames: SceneFrameNode[] = [];
  const elements: SceneElementNode[] = [];

  for (const frame of unit.frames) {
    if (frame.visible === false) continue;
    const frameBase = frame.zIndex * FRAME_STRIDE;
    frames.push({
      frame,
      geometry: frame.geometry,
      fillZIndex: frameBase,
      borderZIndex: frameBase + FRAME_BORDER_OFFSET,
    });
    for (const layer of frame.layers) {
      if (!layer.visible) continue;
      layer.elements.forEach((element, index) => {
        if (element.visible === false) return;
        elements.push({
          element,
          geometry: resolveLocalTransform(frame.geometry, element.transform),
          zIndex: frameBase + FRAME_CONTENT_OFFSET + layer.zIndex * 10 + index,
          source: "frame",
          frame,
          layerId: layer.id,
          // Frame balloons can be positioned across an edge, but remain frame
          // content: their overflow is always hidden by the frame shape.
          clipFrame: element.kind === "balloon" || frame.mask.mode !== "visible" && effectiveOverflow(unit.layoutPolicy.defaultOverflow, layer.overflow, element) !== "visible" ? frame : undefined,
          dialogueText: element.kind === "balloon" ? dialogues.get(element.dialogueId) ?? "" : undefined,
        });
      });
    }
  }

  for (const layer of unit.overlayLayers) {
    if (!layer.visible) continue;
    const anchor = layer.anchor;
    const anchorFrame = anchor.type === "frame" ? unit.frames.find((frame) => frame.id === anchor.frameId && frame.visible !== false) : undefined;
    if (anchor.type === "frame" && !anchorFrame) continue;
    layer.elements.forEach((element, index) => {
      if (element.visible === false) return;
      const projectionSource = element.kind === "image" && element.projection && anchorFrame
        ? anchorFrame.layers.flatMap((candidate) => [...candidate.elements] as FrameElement[]).find((candidate) => candidate.id === element.projection!.sourceElementId && candidate.kind === "image")
        : undefined;
      const projectedElement = projectionSource?.kind === "image"
        ? { ...element, transform: projectionSource.transform, crop: projectionSource.crop }
        : element;
      elements.push({
        element: projectedElement,
        geometry: anchorFrame ? resolveLocalTransform(anchorFrame.geometry, projectedElement.transform) : projectedElement.transform,
        // Frame and overlay composition levels share the same numeric space.
        // An overlay at a given level sits above that frame's border; moving a
        // frame or an overlay layer changes their relative visual order.
        zIndex: layer.purpose === "narration"
          ? 2_000_000_000 + index
          : layer.zIndex * FRAME_STRIDE + FRAME_BORDER_OFFSET + 1 + index,
        source: "overlay",
        frame: anchorFrame,
        layerId: layer.id,
        overlayPurpose: layer.purpose,
        surfaceId: layer.surfaceId,
        dialogueText: projectedElement.kind === "balloon" ? dialogues.get(projectedElement.dialogueId) ?? "" : undefined,
      });
    });
  }

  return {
    unit,
    frames: frames.sort((a, b) => a.fillZIndex - b.fillZIndex),
    elements: elements.sort((a, b) => a.zIndex - b.zIndex),
  };
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function projectBalloonStrokeWidths(balloon: Pick<BalloonElement, "shape" | "style">): BalloonStrokeWidths {
  const base = balloon.style.strokeWidth;
  return { outline: base, tail: base };
}

const balloonBodyBounds = (balloon: BalloonElement, geometry: Geometry) => {
  const insetX = balloon.shape === "caption_box" ? .015 : balloon.shape === "cut_corner" ? 0 : .02;
  const insetY = balloon.shape === "caption_box" ? .015 : balloon.shape === "cut_corner" ? 0 : .04;
  return {
    x: geometry.x + geometry.width * insetX,
    y: geometry.y + geometry.height * insetY,
    width: geometry.width * (1 - insetX * 2),
    height: geometry.height * (1 - insetY * 2),
  };
};

const boundsOverlap = (left: BalloonElement, leftGeometry: Geometry, right: BalloonElement, rightGeometry: Geometry) => {
  const a = balloonBodyBounds(left, leftGeometry);
  const b = balloonBodyBounds(right, rightGeometry);
  return Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x)
    && Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y);
};

const mergeStyleKey = (balloon: BalloonElement) => [
  balloon.style.fill,
  balloon.style.stroke,
  balloon.style.strokeWidth,
].join("\u0000");

const projectOverlapMask = (partner: SceneElementNode & { element: BalloonElement }, target: SceneElementNode): BalloonOverlapMask => {
  const x = (value: number) => (partner.geometry.x + value * partner.geometry.width - target.geometry.x) / target.geometry.width * 100;
  const y = (value: number) => (partner.geometry.y + value * partner.geometry.height - target.geometry.y) / target.geometry.height * 100;
  // One rendered pixel is enough to absorb the mask's antialiased edge. The
  // mask must not scale with the balloon or grow into its exterior outline.
  const expansion = 1;
  if (partner.element.shape === "caption_box") {
    return {
      shape: "rect",
      x: x(.015),
      y: y(.015),
      width: partner.geometry.width / target.geometry.width * 97,
      height: partner.geometry.height / target.geometry.height * 97,
      rx: partner.geometry.width / target.geometry.width * 3,
      ry: partner.geometry.height / target.geometry.height * 3,
      expansion,
    };
  }
  if (partner.element.shape === "cut_corner") {
    return {
      shape: "polygon",
      points: balloonCutCornerPoints(partner.element).map((point) => ({ x: x(point.x), y: y(point.y) })),
      expansion,
    };
  }
  return {
    shape: "ellipse",
    cx: x(.5),
    cy: y(.5),
    rx: partner.geometry.width / target.geometry.width * 48,
    ry: partner.geometry.height / target.geometry.height * 46,
    expansion,
  };
};

/**
 * Projects compatible overlapping balloon bodies into each balloon's local
 * 0..100 SVG plane. Renderers use the projections only as outline masks: the
 * BalloonElements remain independent content and editing objects.
 */
export function projectBalloonOverlapMasks(nodes: SceneElementNode[]) {
  const balloons = nodes.filter((node): node is SceneElementNode & { element: BalloonElement } => (
    (node.source === "frame" || node.overlayPurpose === "page_content")
    && node.element.kind === "balloon"
    && !node.element.appearance
    && !node.geometry.rotate
  ));
  const masks = new Map<string, BalloonOverlapMask[]>();
  const renderOrder = new Map(nodes.map((node, index) => [node.element.id, index]));
  balloons.forEach((node) => {
    const partners = balloons.filter((candidate) => (
      candidate.element.id !== node.element.id
      && (renderOrder.get(candidate.element.id) ?? -1) < (renderOrder.get(node.element.id) ?? -1)
      && candidate.source === node.source
      && candidate.frame?.id === node.frame?.id
      && candidate.layerId === node.layerId
      && candidate.overlayPurpose === node.overlayPurpose
      && candidate.surfaceId === node.surfaceId
      && mergeStyleKey(candidate.element) === mergeStyleKey(node.element)
      && boundsOverlap(candidate.element, candidate.geometry, node.element, node.geometry)
    ));
    if (!partners.length) return;
    masks.set(node.element.id, partners.map((partner) => projectOverlapMask(partner, node)));
  });
  return masks;
}

export function projectBalloonTail(balloon: Pick<BalloonElement, "shape" | "transform" | "tailTarget" | "appearance">): BalloonTailProjection | undefined {
  if (balloon.shape !== "normal" || balloon.appearance) return undefined;
  const transform = balloon.transform;
  const rawTail = balloon.tailTarget ?? {
    x: transform.x + transform.width * 1.14,
    y: transform.y + transform.height * 1.14,
  };
  const centerX = transform.x + transform.width / 2;
  const centerY = transform.y + transform.height / 2;
  const vectorX = rawTail.x - centerX || 0.001;
  const vectorY = rawTail.y - centerY || 0.001;
  const magnitude = Math.hypot(vectorX, vectorY);
  const unitX = vectorX / magnitude;
  const unitY = vectorY / magnitude;
  const radiusX = transform.width / 2;
  const radiusY = transform.height / 2;
  const edgeDistance = 1 / Math.sqrt((unitX / radiusX) ** 2 + (unitY / radiusY) ** 2);
  const minDimension = Math.min(transform.width, transform.height);
  const defaultLength = minDimension * 0.34;
  const length = balloon.tailTarget ? clamp(magnitude - edgeDistance, minDimension * 0.16, minDimension * 0.72) : defaultLength;
  const tip = {
    x: (centerX + unitX * (edgeDistance + length) - transform.x) / transform.width * 100,
    y: (centerY + unitY * (edgeDistance + length) - transform.y) / transform.height * 100,
  };
  const direction = Math.atan2((tip.y - 50) / 46, (tip.x - 50) / 48);
  const root = (offset: number) => ({ x: 50 + 48 * Math.cos(direction + offset), y: 50 + 46 * Math.sin(direction + offset) });
  const start = root(-0.22);
  const end = root(0.22);
  return {
    tip,
    start,
    end,
    startControl: { x: start.x + (tip.x - start.x) * 0.42, y: start.y + (tip.y - start.y) * 0.42 },
    endControl: { x: tip.x + (end.x - tip.x) * 0.18, y: tip.y + (end.y - tip.y) * 0.18 },
  };
}

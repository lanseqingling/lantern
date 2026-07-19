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
import { resolveLocalTransform } from "./lcd/types";

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
          clipFrame: frame.mask.mode !== "visible" && effectiveOverflow(unit.layoutPolicy.defaultOverflow, layer.overflow, element) !== "visible" ? frame : undefined,
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
        elements.push({
          element,
          geometry: anchorFrame ? resolveLocalTransform(anchorFrame.geometry, element.transform) : element.transform,
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
        dialogueText: element.kind === "balloon" ? dialogues.get(element.dialogueId) ?? "" : undefined,
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
  return balloon.shape === "normal"
    ? { outline: base * 1.25, tail: base * 0.7 }
    : { outline: base * 0.9, tail: base * 0.9 };
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

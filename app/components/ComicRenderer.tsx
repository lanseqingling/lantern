"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import type { ArtElement, BalloonElement, ComicDocument, EffectElement, Frame, FrameCornerAxis, FrameCornerIndex, FrameShape, Geometry, LocalTransform, Point, ResolvedResourceMap, SceneElementNode, TextElement } from "@/packages/shared/src";
import { frameCornerDragAxis, frameQuadrilateralPoints, projectBalloonStrokeWidths, projectBalloonTail, projectComicRenderScene, projectImageCrop, projectTextStrokeWidth, reshapeFrameCorner, scaleImageCrop } from "@/packages/shared/src";
import type { Selection } from "@/app/lib/workbench-state";
import { snapFrameCornerToNeighborParallel, snapGeometrySizeToFrameEdgeExtensions, snapGeometryToFrameEdgeExtensions, type EdgeExtensionGuide, type ParallelCornerGuide } from "@/app/lib/editor-snapping";

type ElementPatch = Record<string, unknown>;
type ElementPatchBatch = Array<{ elementId: string; patch: ElementPatch }>;
export type ComicContextPoint = { clientX: number; clientY: number; canvasX: number; canvasY: number };
type DragState = {
  mode: "frame_move" | "frame_resize" | "frame_corner" | "image_crop" | "image_move" | "image_resize" | "balloon_move" | "balloon_resize" | "balloon_tail" | "text_move" | "text_resize";
  elementId: string;
  frameId?: string;
  anchorGeometry?: Geometry;
  coordinateBounds?: { minX: number; minY: number; maxX: number; maxY: number };
  startX: number;
  startY: number;
  startGeometry?: Geometry;
  startSceneGeometry?: Geometry;
  startShape?: FrameShape;
  frameBounds?: Geometry;
  cornerIndex?: FrameCornerIndex;
  axis?: FrameCornerAxis;
  startTransform?: LocalTransform;
  startTailTarget?: Point;
  startCrop?: { x: number; y: number; width: number; height: number };
  moved?: boolean;
};
type CropWheelState = { elementId: string; crop: ArtElement["crop"]; timer: number };
type SnapGuideState = { edgeGuides: EdgeExtensionGuide[] } | { parallelGuide: ParallelCornerGuide } | null;

type ComicRendererProps = {
  document: ComicDocument;
  resolvedResources?: ResolvedResourceMap;
  pageIndex: number;
  selection?: Selection;
  editable?: boolean;
  interactionMode?: "select" | "move" | "crop";
  creationMode?: "dialogue" | "narration";
  multiSelectedIds?: ReadonlySet<string>;
  multiMoving?: boolean;
  multiMoveDelta?: { x: number; y: number };
  onSelect?: (selection: Selection) => void;
  onContextAction?: (selection: Selection, point: ComicContextPoint) => void;
  onObjectDoubleClick?: (selection: Selection) => void;
  onPlaceDialogue?: (unitId: string, frameId: string, position: { x: number; y: number }) => void;
  onPlacePageDialogue?: (unitId: string, position: { x: number; y: number }) => void;
  onPlaceNarration?: (unitId: string, position: { x: number; y: number }) => void;
  onCommitElement?: (unitId: string, elementId: string, patch: ElementPatch, label: string) => void;
  onCommitElements?: (unitId: string, patches: ElementPatchBatch, label: string) => void;
  onPageClick?: (pageIndex: number) => void;
  className?: string;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const rectsOverlap = (a: Geometry, b: Geometry) => Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 0.5 && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 0.5;
const containsGeometry = (bounds: Geometry, geometry: Geometry) => geometry.x >= bounds.x && geometry.y >= bounds.y && geometry.x + geometry.width <= bounds.x + bounds.width && geometry.y + geometry.height <= bounds.y + bounds.height;
const pointInPolygon = (point: Point, points: Point[]) => points.reduce((inside, current, index) => {
  const previous = points[(index + points.length - 1) % points.length];
  const crosses = (current.y > point.y) !== (previous.y > point.y)
    && point.x < (previous.x - current.x) * (point.y - current.y) / ((previous.y - current.y) || Number.EPSILON) + current.x;
  return crosses ? !inside : inside;
}, false);
const frameContainsPoint = (frame: Frame, point: Point) => {
  const local = { x: (point.x - frame.geometry.x) / frame.geometry.width, y: (point.y - frame.geometry.y) / frame.geometry.height };
  if (local.x < 0 || local.x > 1 || local.y < 0 || local.y > 1) return false;
  if (frame.shape.kind === "ellipse") return ((local.x - .5) / .5) ** 2 + ((local.y - .5) / .5) ** 2 <= 1;
  return frame.shape.kind !== "polygon" || pointInPolygon(local, frame.shape.points);
};
const geometryStyle = (geometry: Geometry, width: number, height: number): CSSProperties => ({
  left: `${geometry.x / width * 100}%`, top: `${geometry.y / height * 100}%`, width: `${geometry.width / width * 100}%`, height: `${geometry.height / height * 100}%`,
  transform: geometry.rotate ? `rotate(${geometry.rotate}deg)` : undefined,
});
const cropStyle = (image: ArtElement): CSSProperties => {
  const crop = projectImageCrop(image.crop);
  return {
    left: `${crop.x * 100}%`,
    top: `${crop.y * 100}%`,
    width: `${crop.width * 100}%`,
    height: `${crop.height * 100}%`,
    objectPosition: "center",
    transform: "none",
  };
};
const frameClipPath = (frame: Frame, geometry: Geometry) => {
  const point = (x: number, y: number) => `${(x - geometry.x) / geometry.width * 100}% ${(y - geometry.y) / geometry.height * 100}%`;
  if (frame.shape.kind === "ellipse") {
    return `ellipse(${frame.geometry.width / geometry.width * 50}% ${frame.geometry.height / geometry.height * 50}% at ${(frame.geometry.x + frame.geometry.width / 2 - geometry.x) / geometry.width * 100}% ${(frame.geometry.y + frame.geometry.height / 2 - geometry.y) / geometry.height * 100}%)`;
  }
  const points = frame.shape.kind === "polygon"
    ? frame.shape.points.map((item) => point(frame.geometry.x + item.x * frame.geometry.width, frame.geometry.y + item.y * frame.geometry.height))
    : [point(frame.geometry.x, frame.geometry.y), point(frame.geometry.x + frame.geometry.width, frame.geometry.y), point(frame.geometry.x + frame.geometry.width, frame.geometry.y + frame.geometry.height), point(frame.geometry.x, frame.geometry.y + frame.geometry.height)];
  return `polygon(${points.join(", ")})`;
};
const elementSceneStyle = (node: SceneElementNode, width: number, height: number): CSSProperties => ({
  ...geometryStyle(node.geometry, width, height),
  zIndex: node.zIndex,
  clipPath: node.clipFrame ? frameClipPath(node.clipFrame, node.geometry) : undefined,
});
const tailPaths = (tail: NonNullable<ReturnType<typeof projectBalloonTail>>) => ({
  fill: `M ${tail.start.x} ${tail.start.y} C ${tail.startControl.x} ${tail.startControl.y}, ${tail.tip.x} ${tail.tip.y}, ${tail.tip.x} ${tail.tip.y} C ${tail.tip.x} ${tail.tip.y}, ${tail.endControl.x} ${tail.endControl.y}, ${tail.end.x} ${tail.end.y} Z`,
  outline: `M ${tail.start.x} ${tail.start.y} C ${tail.startControl.x} ${tail.startControl.y}, ${tail.tip.x} ${tail.tip.y}, ${tail.tip.x} ${tail.tip.y} C ${tail.tip.x} ${tail.tip.y}, ${tail.endControl.x} ${tail.endControl.y}, ${tail.end.x} ${tail.end.y}`,
});

type ImageSceneNode = SceneElementNode & { element: ArtElement };
type TextSceneNode = SceneElementNode & { element: TextElement };
type BalloonSceneNode = SceneElementNode & { element: BalloonElement };
type EffectSceneNode = SceneElementNode & { element: EffectElement };

function FrameShapeVisual({ frame, fill, stroke }: { frame: Frame; fill: string; stroke?: boolean }) {
  const strokeColor = stroke && frame.border.style !== "none" ? frame.border.color : "none";
  const strokeWidth = stroke ? frame.border.width : 0;
  const common = { fill, stroke: strokeColor, strokeWidth, strokeDasharray: frame.border.style === "rough" ? "7 3 2 3" : undefined };
  const width = frame.geometry.width;
  const height = frame.geometry.height;
  return <svg className="lcd-frame-shape" aria-hidden="true" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
    {frame.shape.kind === "ellipse" ? <ellipse cx={width / 2} cy={height / 2} rx={width / 2} ry={height / 2} {...common} />
      : frame.shape.kind === "polygon" ? <polygon points={frame.shape.points.map((point) => `${point.x * width},${point.y * height}`).join(" ")} {...common} />
        : <rect x="0" y="0" width={width} height={height} rx={frame.shape.radius ?? 0} {...common} />}
  </svg>;
}

export function ComicRenderer({ document, resolvedResources, pageIndex, selection, editable = false, interactionMode = "select", creationMode, multiSelectedIds, multiMoving = false, multiMoveDelta, onSelect, onContextAction, onObjectDoubleClick, onPlaceDialogue, onPlacePageDialogue, onPlaceNarration, onCommitElement, onCommitElements, onPageClick, className }: ComicRendererProps) {
  const requestedUnitId = document.reading.unitOrder[pageIndex];
  const unit = document.units.find((item) => item.id === requestedUnitId) ?? document.units[0];
  const paperRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const cropWheelRef = useRef<CropWheelState | null>(null);
  const suppressClick = useRef(false);
  const [drafts, setDrafts] = useState<Record<string, ElementPatch>>({});
  const draftsRef = useRef<Record<string, ElementPatch>>({});
  const [snapGuides, setSnapGuides] = useState<SnapGuideState>(null);
  useEffect(() => () => {
    if (cropWheelRef.current) window.clearTimeout(cropWheelRef.current.timer);
  }, []);
  if (!unit) return <div className="empty-comic">暂无可预览的漫画页面</div>;

  const frameDraft = (frame: Frame): Frame => ({
    ...frame,
    ...(drafts[frame.id] as Partial<Frame> | undefined),
    layers: frame.layers.map((layer) => ({ ...layer, elements: layer.elements.map((element) => ({ ...element, ...(drafts[element.id] ?? {}) })) })) as Frame["layers"],
  });
  const draftUnit = {
    ...unit,
    frames: unit.frames.map(frameDraft),
    overlayLayers: unit.overlayLayers.map((layer) => ({ ...layer, elements: layer.elements.map((element) => ({ ...element, ...(drafts[element.id] ?? {}) })) })),
  };
  const scene = projectComicRenderScene(document, draftUnit);
  const frames = scene.frames.map((node) => node.frame);
  const framesById = new Map(frames.map((frame) => [frame.id, frame]));
  const readingOrder = new Map(unit.readingSequence.map((entry, index) => [entry.frameId, index + 1]));
  const images = scene.elements.filter((node): node is ImageSceneNode => node.element.kind === "image");
  const cropFrameId = interactionMode === "crop" && selection?.type === "image"
    ? images.find((node) => node.element.id === selection.id && node.source === "frame")?.frame?.id
    : interactionMode === "crop" && selection?.type === "comic_frame" ? selection.id : undefined;
  const texts = scene.elements.filter((node): node is TextSceneNode => node.element.kind === "text");
  const narrations = texts.filter((node) => node.source === "overlay" && node.overlayPurpose === "narration");
  const balloons = scene.elements.filter((node): node is BalloonSceneNode => node.element.kind === "balloon");
  const effects = scene.elements.filter((node): node is EffectSceneNode => node.element.kind === "effect");
  const overlayImages = images.filter((node) => node.source === "overlay");
  const overlayImageLabel = (node: ImageSceneNode) => {
    const crossPurpose = node.overlayPurpose === "cross_page" || node.overlayPurpose === "cross_segment" ? node.overlayPurpose : undefined;
    const orderGroup = crossPurpose ? overlayImages.filter((candidate) => candidate.overlayPurpose === crossPurpose) : overlayImages.filter((candidate) => candidate.overlayPurpose !== "cross_page" && candidate.overlayPurpose !== "cross_segment");
    const order = orderGroup.findIndex((candidate) => candidate.element.id === node.element.id) + 1;
    return `${crossPurpose === "cross_page" ? "跨页图" : crossPurpose === "cross_segment" ? "跨段图" : "图"} ${String(order).padStart(2, "0")}`;
  };
  const balloonOrder = (node: BalloonSceneNode) => {
    const crossPage = node.overlayPurpose === "cross_page";
    const orderGroup = balloons.filter((candidate) => crossPage ? candidate.overlayPurpose === "cross_page" : candidate.overlayPurpose !== "cross_page");
    return orderGroup.findIndex((candidate) => candidate.element.id === node.element.id) + 1;
  };
  const balloonOrderLabel = (node: BalloonSceneNode) => `${node.overlayPurpose === "cross_page" ? "跨页泡" : "对白"} ${String(balloonOrder(node)).padStart(2, "0")}`;
  const narrationOrderLabel = (node: TextSceneNode) => `旁白 ${String(narrations.findIndex((candidate) => candidate.element.id === node.element.id) + 1).padStart(2, "0")}`;

  const frameLabel = (frame: Frame) => `${unit.kind === "spread" && frame.surfaceScope === "unit" ? "跨页格" : "画格"} ${String(readingOrder.get(frame.id) ?? "").padStart(2, "0")}`.trim();
  const selectFrame = (frame: Frame) => onSelect?.({ type: "comic_frame", id: frame.id, pageId: unit.id, label: frameLabel(frame) });
  const doubleClick = (event: ReactMouseEvent, next: Selection) => {
    if (!editable || !onObjectDoubleClick) return;
    event.preventDefault();
    event.stopPropagation();
    onObjectDoubleClick(next);
  };
  const eventPoint = (event: Pick<ReactMouseEvent, "clientX" | "clientY">): ComicContextPoint | undefined => {
    const bounds = paperRef.current?.getBoundingClientRect();
    if (!bounds?.width || !bounds.height) return undefined;
    return { clientX: event.clientX, clientY: event.clientY, canvasX: (event.clientX - bounds.left) / bounds.width * unit.canvas.width, canvasY: (event.clientY - bounds.top) / bounds.height * unit.canvas.height };
  };
  const frameAtPoint = (point: ComicContextPoint) => [...frames].sort((left, right) => right.zIndex - left.zIndex).find((frame) => frameContainsPoint(frame, { x: point.canvasX, y: point.canvasY }));
  const contextFor = (event: ReactMouseEvent, next: Selection) => {
    if (!editable || !onContextAction) return;
    const point = eventPoint(event);
    if (!point) return;
    event.preventDefault(); event.stopPropagation();
    onSelect?.(next);
    onContextAction(next, point);
  };
  const zoomCropWithWheel = (event: ReactWheelEvent<HTMLDivElement>, image: ArtElement, frame: Frame) => {
    if (!editable || interactionMode !== "crop" || selection?.type !== "image" || selection.id !== image.id || !onCommitElement) return;
    const point = eventPoint(event);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = paperRef.current?.getBoundingClientRect();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bounds?.height ?? 1 : 1);
    if (!delta) return;
    const draftCrop = draftsRef.current[image.id]?.crop as ArtElement["crop"] | undefined;
    const currentCrop = draftCrop ?? image.crop;
    const factor = clamp(Math.exp(delta * .0015), .78, 1.28);
    const crop = scaleImageCrop(currentCrop, factor, {
      x: clamp((point.canvasX - frame.geometry.x) / frame.geometry.width, 0, 1),
      y: clamp((point.canvasY - frame.geometry.y) / frame.geometry.height, 0, 1),
    });
    if (["x", "y", "width", "height"].every((key) => Math.abs(crop[key as keyof ArtElement["crop"]] - currentCrop[key as keyof ArtElement["crop"]]) < 1e-8)) return;
    const nextDrafts = { ...draftsRef.current, [image.id]: { crop } };
    draftsRef.current = nextDrafts;
    setDrafts(nextDrafts);
    if (cropWheelRef.current) window.clearTimeout(cropWheelRef.current.timer);
    const timer = window.setTimeout(() => {
      const pending = cropWheelRef.current;
      if (!pending || pending.elementId !== image.id) return;
      onCommitElement(unit.id, image.id, { crop: pending.crop }, "缩放图片取景");
      const remainingDrafts = { ...draftsRef.current };
      delete remainingDrafts[image.id];
      draftsRef.current = remainingDrafts;
      setDrafts(remainingDrafts);
      cropWheelRef.current = null;
    }, 240);
    cropWheelRef.current = { elementId: image.id, crop, timer };
  };
  const startDrag = (event: ReactPointerEvent, state: Omit<DragState, "startX" | "startY">, next: Selection) => {
    if (!editable) return;
    event.preventDefault(); event.stopPropagation(); onSelect?.(next);
    dragRef.current = { ...state, startX: event.clientX, startY: event.clientY };
    draftsRef.current = {}; setDrafts({}); setSnapGuides(null); event.currentTarget.setPointerCapture(event.pointerId);
  };
  const surfaceForGeometry = (geometry: Geometry) => unit.surfaces.find((surface) => containsGeometry(surface.geometry, geometry));
  const editableBoundsForFrame = (frame: Frame) => frame.surfaceScope === "unit"
    ? { x: 0, y: 0, width: unit.canvas.width, height: unit.canvas.height }
    : surfaceForGeometry(frame.geometry)?.geometry ?? { x: 0, y: 0, width: unit.canvas.width, height: unit.canvas.height };
  const frameGeometryAllowed = (frameId: string, geometry: Geometry) => {
    const current = unit.frames.find((frame) => frame.id === frameId);
    const surface = current?.surfaceScope === "unit" ? undefined : current ? surfaceForGeometry(current.geometry) : undefined;
    const bounds = surface?.geometry ?? { x: 0, y: 0, width: unit.canvas.width, height: unit.canvas.height };
    return containsGeometry(bounds, geometry) && (unit.layoutPolicy.frameOverlap === "allow" || !unit.frames.some((frame) => frame.id !== frameId && rectsOverlap(geometry, frame.geometry)));
  };
  const nudgeFrameCorner = (event: ReactKeyboardEvent<HTMLButtonElement>, frame: Frame, cornerIndex: FrameCornerIndex) => {
    const direction = ({ ArrowLeft: ["x", -1], ArrowRight: ["x", 1], ArrowUp: ["y", -1], ArrowDown: ["y", 1] } as const)[event.key as "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown"];
    if (!direction || !onCommitElements) return;
    event.preventDefault(); event.stopPropagation();
    const [axis, sign] = direction;
    const step = (axis === "x" ? frame.geometry.width : frame.geometry.height) * (event.shiftKey ? .04 : .015) * sign;
    const reshaped = reshapeFrameCorner(frame.geometry, frame.shape, cornerIndex, axis, step, editableBoundsForFrame(frame));
    if (!reshaped || !frameGeometryAllowed(frame.id, reshaped.geometry)) return;
    onCommitElements(unit.id, [{ elementId: frame.id, patch: reshaped }], "调整画格角度");
  };
  const nodeCoordinateBounds = (node: SceneElementNode, frame?: Frame) => {
    if (node.source === "overlay" && frame) return { minX: -frame.geometry.x / frame.geometry.width, minY: -frame.geometry.y / frame.geometry.height, maxX: (unit.canvas.width - frame.geometry.x) / frame.geometry.width, maxY: (unit.canvas.height - frame.geometry.y) / frame.geometry.height };
    const surface = node.surfaceId ? unit.surfaces.find((item) => item.id === node.surfaceId) : undefined;
    return surface ? { minX: surface.geometry.x, minY: surface.geometry.y, maxX: surface.geometry.x + surface.geometry.width, maxY: surface.geometry.y + surface.geometry.height } : undefined;
  };

  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current; const bounds = paperRef.current?.getBoundingClientRect();
    if (!drag || !bounds) return;
    setSnapGuides(null);
    const dx = (event.clientX - drag.startX) / bounds.width * unit.canvas.width;
    const dy = (event.clientY - drag.startY) / bounds.height * unit.canvas.height;
    const snapThreshold = { x: 5 / bounds.width * unit.canvas.width, y: 5 / bounds.height * unit.canvas.height };
    const moveSnapThreshold = {
      x: Math.abs(event.clientX - drag.startX) >= 1 ? snapThreshold.x : -1,
      y: Math.abs(event.clientY - drag.startY) >= 1 ? snapThreshold.y : -1,
    };
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) drag.moved = true;
    let patch: ElementPatch | undefined;
    if (drag.mode === "frame_corner" && drag.startGeometry && drag.startShape && drag.frameBounds && drag.cornerIndex !== undefined) {
      const axis = drag.axis ?? frameCornerDragAxis(event.clientX - drag.startX, event.clientY - drag.startY);
      if (!axis) return;
      drag.axis = axis;
      const rawDelta = axis === "x" ? dx : dy;
      const parallelSnap = drag.frameId ? snapFrameCornerToNeighborParallel(
        { id: drag.frameId, geometry: drag.startGeometry, shape: drag.startShape },
        drag.cornerIndex,
        axis,
        rawDelta,
        unit.frames,
        snapThreshold[axis],
      ) : { delta: rawDelta };
      let usedParallelSnap = Boolean(parallelSnap.guide);
      let reshaped = reshapeFrameCorner(drag.startGeometry, drag.startShape, drag.cornerIndex, axis, parallelSnap.delta, drag.frameBounds);
      if (reshaped && drag.frameId && !frameGeometryAllowed(drag.frameId, reshaped.geometry) && parallelSnap.guide) {
        reshaped = reshapeFrameCorner(drag.startGeometry, drag.startShape, drag.cornerIndex, axis, rawDelta, drag.frameBounds);
        usedParallelSnap = false;
      }
      if (!reshaped || !drag.frameId || !frameGeometryAllowed(drag.frameId, reshaped.geometry)) return;
      if (parallelSnap.guide && usedParallelSnap) {
        const reshapedPoints = frameQuadrilateralPoints(reshaped.shape);
        const actualMoving = reshapedPoints?.[drag.cornerIndex];
        const actualMovingPoint = actualMoving ? {
          x: reshaped.geometry.x + actualMoving.x * reshaped.geometry.width,
          y: reshaped.geometry.y + actualMoving.y * reshaped.geometry.height,
        } : undefined;
        const activeEdge = parallelSnap.guide.activeEdge;
        usedParallelSnap = Boolean(actualMovingPoint && [activeEdge.start, activeEdge.end].some((point) => Math.hypot(point.x - actualMovingPoint.x, point.y - actualMovingPoint.y) < 1e-3));
      }
      if (parallelSnap.guide && usedParallelSnap) setSnapGuides({ parallelGuide: parallelSnap.guide });
      patch = reshaped;
    } else if (drag.mode === "image_crop" && drag.startCrop) {
      const frame = drag.frameId ? framesById.get(drag.frameId) : undefined; if (!frame) return;
      patch = { crop: { ...drag.startCrop, x: clamp(drag.startCrop.x - dx / frame.geometry.width * drag.startCrop.width, 0, 1 - drag.startCrop.width), y: clamp(drag.startCrop.y - dy / frame.geometry.height * drag.startCrop.height, 0, 1 - drag.startCrop.height) } };
    } else if (drag.mode === "image_move" && drag.startTransform && drag.startSceneGeometry) {
      const anchor = drag.anchorGeometry; if (!anchor) return;
      const coordinateWidth = drag.frameId ? 1 : anchor.width;
      const coordinateHeight = drag.frameId ? 1 : anchor.height;
      const coordinateBounds = drag.coordinateBounds ?? { minX: 0, minY: 0, maxX: coordinateWidth, maxY: coordinateHeight };
      const rawTransform = {
        ...drag.startTransform,
        x: clamp(drag.startTransform.x + (drag.frameId ? dx / anchor.width : dx), coordinateBounds.minX, coordinateBounds.maxX - drag.startTransform.width),
        y: clamp(drag.startTransform.y + (drag.frameId ? dy / anchor.height : dy), coordinateBounds.minY, coordinateBounds.maxY - drag.startTransform.height),
      };
      const actualDx = (rawTransform.x - drag.startTransform.x) * (drag.frameId ? anchor.width : 1);
      const actualDy = (rawTransform.y - drag.startTransform.y) * (drag.frameId ? anchor.height : 1);
      const snapped = snapGeometryToFrameEdgeExtensions(
        { ...drag.startSceneGeometry, x: drag.startSceneGeometry.x + actualDx, y: drag.startSceneGeometry.y + actualDy },
        unit.frames.filter((frame) => frame.id !== drag.frameId),
        moveSnapThreshold,
      );
      const snappedDx = snapped.geometry.x - drag.startSceneGeometry.x;
      const snappedDy = snapped.geometry.y - drag.startSceneGeometry.y;
      const transform = {
        ...drag.startTransform,
        x: clamp(drag.startTransform.x + (drag.frameId ? snappedDx / anchor.width : snappedDx), coordinateBounds.minX, coordinateBounds.maxX - drag.startTransform.width),
        y: clamp(drag.startTransform.y + (drag.frameId ? snappedDy / anchor.height : snappedDy), coordinateBounds.minY, coordinateBounds.maxY - drag.startTransform.height),
      };
      if (snapped.guides.length) setSnapGuides({ edgeGuides: snapped.guides });
      patch = { transform };
    } else if ((drag.mode === "balloon_move" || drag.mode === "text_move") && drag.startTransform) {
      const anchor = drag.anchorGeometry; if (!anchor) return;
      const offsetX = drag.frameId ? dx / anchor.width : dx;
      const offsetY = drag.frameId ? dy / anchor.height : dy;
      const coordinateWidth = drag.frameId ? 1 : anchor.width;
      const coordinateHeight = drag.frameId ? 1 : anchor.height;
      const coordinateBounds = drag.coordinateBounds ?? { minX: 0, minY: 0, maxX: coordinateWidth, maxY: coordinateHeight };
      const transform = { ...drag.startTransform, x: clamp(drag.startTransform.x + offsetX, coordinateBounds.minX, coordinateBounds.maxX - drag.startTransform.width), y: clamp(drag.startTransform.y + offsetY, coordinateBounds.minY, coordinateBounds.maxY - drag.startTransform.height) };
      patch = drag.startTailTarget
        ? { transform, tailTarget: { x: clamp(drag.startTailTarget.x + offsetX, coordinateBounds.minX, coordinateBounds.maxX), y: clamp(drag.startTailTarget.y + offsetY, coordinateBounds.minY, coordinateBounds.maxY) } }
        : { transform };
    } else if (drag.mode === "image_resize" && drag.startTransform && drag.startSceneGeometry) {
      const anchor = drag.anchorGeometry; if (!anchor) return;
      const minWidth = drag.frameId ? .12 : unit.canvas.width * .08;
      const minHeight = drag.frameId ? .08 : unit.canvas.height * .05;
      const coordinateWidth = drag.frameId ? 1 : anchor.width;
      const coordinateHeight = drag.frameId ? 1 : anchor.height;
      const coordinateBounds = drag.coordinateBounds ?? { minX: 0, minY: 0, maxX: coordinateWidth, maxY: coordinateHeight };
      const rawTransform = {
        ...drag.startTransform,
        width: clamp(drag.startTransform.width + (drag.frameId ? dx / anchor.width : dx), minWidth, coordinateBounds.maxX - drag.startTransform.x),
        height: clamp(drag.startTransform.height + (drag.frameId ? dy / anchor.height : dy), minHeight, coordinateBounds.maxY - drag.startTransform.y),
      };
      const rawGeometry = {
        ...drag.startSceneGeometry,
        width: rawTransform.width * (drag.frameId ? anchor.width : 1),
        height: rawTransform.height * (drag.frameId ? anchor.height : 1),
      };
      const snapped = snapGeometrySizeToFrameEdgeExtensions(rawGeometry, unit.frames.filter((frame) => frame.id !== drag.frameId), moveSnapThreshold);
      const transform = {
        ...rawTransform,
        width: clamp(snapped.geometry.width / (drag.frameId ? anchor.width : 1), minWidth, coordinateBounds.maxX - drag.startTransform.x),
        height: clamp(snapped.geometry.height / (drag.frameId ? anchor.height : 1), minHeight, coordinateBounds.maxY - drag.startTransform.y),
      };
      const actualRight = drag.startSceneGeometry.x + transform.width * (drag.frameId ? anchor.width : 1);
      const actualBottom = drag.startSceneGeometry.y + transform.height * (drag.frameId ? anchor.height : 1);
      const guides = snapped.guides.filter((guide) => Math.abs((guide.axis === "x" ? actualRight : actualBottom) - guide.position) < 1e-6);
      if (guides.length) setSnapGuides({ edgeGuides: guides });
      patch = { transform };
    } else if ((drag.mode === "balloon_resize" || drag.mode === "text_resize") && drag.startTransform) {
      const anchor = drag.anchorGeometry; if (!anchor) return;
      const minWidth = drag.frameId ? .12 : unit.canvas.width * .08;
      const minHeight = drag.frameId ? .08 : unit.canvas.height * .05;
      const coordinateWidth = drag.frameId ? 1 : anchor.width;
      const coordinateHeight = drag.frameId ? 1 : anchor.height;
      const coordinateBounds = drag.coordinateBounds ?? { minX: 0, minY: 0, maxX: coordinateWidth, maxY: coordinateHeight };
      patch = { transform: { ...drag.startTransform, width: clamp(drag.startTransform.width + (drag.frameId ? dx / anchor.width : dx), minWidth, coordinateBounds.maxX - drag.startTransform.x), height: clamp(drag.startTransform.height + (drag.frameId ? dy / anchor.height : dy), minHeight, coordinateBounds.maxY - drag.startTransform.y) } };
    } else if (drag.mode === "balloon_tail" && drag.startTailTarget) {
      const anchor = drag.anchorGeometry; if (!anchor) return;
      const transform = drag.startTransform;
      if (!transform) return;
      const rawX = drag.startTailTarget.x + (drag.frameId ? dx / anchor.width : dx);
      const rawY = drag.startTailTarget.y + (drag.frameId ? dy / anchor.height : dy);
      const centerX = transform.x + transform.width / 2;
      const centerY = transform.y + transform.height / 2;
      const vectorX = rawX - centerX || .001;
      const vectorY = rawY - centerY || .001;
      const magnitude = Math.hypot(vectorX, vectorY);
      const unitX = vectorX / magnitude;
      const unitY = vectorY / magnitude;
      const radiusX = transform.width / 2;
      const radiusY = transform.height / 2;
      const edgeDistance = 1 / Math.sqrt((unitX / radiusX) ** 2 + (unitY / radiusY) ** 2);
      const minDimension = Math.min(transform.width, transform.height);
      const tailLength = clamp(magnitude - edgeDistance, minDimension * .16, minDimension * .72);
      const coordinateWidth = drag.frameId ? 1 : anchor.width;
      const coordinateHeight = drag.frameId ? 1 : anchor.height;
      const coordinateBounds = drag.coordinateBounds ?? { minX: 0, minY: 0, maxX: coordinateWidth, maxY: coordinateHeight };
      patch = { tailTarget: { x: clamp(centerX + unitX * (edgeDistance + tailLength), coordinateBounds.minX, coordinateBounds.maxX), y: clamp(centerY + unitY * (edgeDistance + tailLength), coordinateBounds.minY, coordinateBounds.maxY) } };
    } else if (drag.mode === "frame_move" && drag.startGeometry && drag.frameId) {
      const start = drag.startGeometry;
      const rawGeometry = { ...start, x: clamp(start.x + dx, 0, unit.canvas.width - start.width), y: clamp(start.y + dy, 0, unit.canvas.height - start.height) };
      const snapped = snapGeometryToFrameEdgeExtensions(rawGeometry, unit.frames.filter((frame) => frame.id !== drag.frameId), moveSnapThreshold);
      const snappedAllowed = frameGeometryAllowed(drag.frameId, snapped.geometry);
      const geometry = snappedAllowed ? snapped.geometry : rawGeometry;
      if (!frameGeometryAllowed(drag.frameId, geometry)) return;
      if (snappedAllowed && snapped.guides.length) setSnapGuides({ edgeGuides: snapped.guides });
      patch = { geometry };
    } else if (drag.mode === "frame_resize" && drag.startGeometry && drag.frameId) {
      const start = drag.startGeometry;
      const rawGeometry = { ...start, width: clamp(start.width + dx, 120, unit.canvas.width - start.x), height: clamp(start.height + dy, 100, unit.canvas.height - start.y) };
      const snapped = snapGeometrySizeToFrameEdgeExtensions(rawGeometry, unit.frames.filter((frame) => frame.id !== drag.frameId), moveSnapThreshold);
      const snappedAllowed = snapped.geometry.width >= 120 && snapped.geometry.height >= 100 && frameGeometryAllowed(drag.frameId, snapped.geometry);
      const geometry = snappedAllowed ? snapped.geometry : rawGeometry;
      if (!frameGeometryAllowed(drag.frameId, geometry)) return;
      if (snappedAllowed && snapped.guides.length) setSnapGuides({ edgeGuides: snapped.guides });
      patch = { geometry };
    }
    if (!patch) return;
    const next = { ...draftsRef.current, [drag.elementId]: patch }; draftsRef.current = next; setDrafts(next);
  };
  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current; if (!drag) return;
    if (drag.moved) { suppressClick.current = true; window.setTimeout(() => { suppressClick.current = false; }, 0); }
    const patch = draftsRef.current[drag.elementId];
    const label = drag.mode === "image_crop" ? "调整图片取景" : drag.mode === "image_resize" ? "调整纸面图片大小" : drag.mode === "image_move" ? "移动纸面图片" : drag.mode === "frame_corner" ? "调整画格角度" : drag.mode === "frame_resize" ? "调整画格大小" : drag.mode === "balloon_resize" ? "调整对话气泡大小" : drag.mode === "balloon_tail" ? "调整气泡尾巴指向" : drag.mode === "balloon_move" ? "移动对话气泡" : drag.mode === "text_resize" ? "调整旁白换行宽度" : drag.mode === "text_move" ? "移动旁白" : "移动画格";
    if (patch) {
      if (drag.mode === "frame_move" || drag.mode === "frame_resize" || drag.mode === "frame_corner") onCommitElements?.(unit.id, [{ elementId: drag.elementId, patch }], label);
      else onCommitElement?.(unit.id, drag.elementId, patch, label);
    }
    draftsRef.current = {}; setDrafts({}); setSnapGuides(null); dragRef.current = null;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* already released */ }
  };
  const badgeEntries = [
    ...balloons.map((node) => ({ key: `balloon:${node.element.id}`, x: node.geometry.x + node.geometry.width, y: node.geometry.y + node.geometry.height })),
    ...overlayImages.map((node) => ({ key: `image:${node.element.id}`, x: node.geometry.x + node.geometry.width, y: node.geometry.y })),
    ...scene.frames.map(({ frame }) => ({ key: `frame:${frame.id}`, x: frame.geometry.x, y: frame.geometry.y })),
  ];
  const badgeOffsets = new Map<string, number>();
  badgeEntries.forEach((entry, index) => {
    const collisionIndex = badgeEntries.slice(0, index).filter((other) => Math.abs(other.x - entry.x) < unit.canvas.width * .075 && Math.abs(other.y - entry.y) < unit.canvas.height * .05).length;
    const direction = entry.x > unit.canvas.width / 2 ? -1 : 1;
    badgeOffsets.set(entry.key, collisionIndex * 28 * direction);
  });

  return <div className={`comic-page ${editable ? "is-editable" : "is-preview"} interaction-${interactionMode} ${creationMode ? `creation-${creationMode}` : ""} ${multiMoving ? "multi-moving" : ""} ${className ?? ""}`} data-testid="comic-page" data-page-id={unit.id} ref={paperRef}
    style={{ aspectRatio: `${unit.canvas.width} / ${unit.canvas.height}`, background: unit.canvas.background.color, "--multi-move-x": `${multiMoveDelta?.x ?? 0}px`, "--multi-move-y": `${multiMoveDelta?.y ?? 0}px` } as CSSProperties} onPointerMoveCapture={pointerMove} onPointerUpCapture={finishDrag} onPointerCancelCapture={finishDrag}
    onClick={(event) => { const point = eventPoint(event); if (creationMode === "narration" && point) { onPlaceNarration?.(unit.id, { x: point.canvasX, y: point.canvasY }); return; } if (creationMode === "dialogue" && point) { const frame = frameAtPoint(point); if (!frame) onPlacePageDialogue?.(unit.id, { x: point.canvasX, y: point.canvasY }); return; } if (interactionMode !== "select") return; const frame = point ? frameAtPoint(point) : undefined; if (frame) selectFrame(frame); else onSelect?.({ type: "presentation_unit", id: unit.id, pageId: unit.id, label: `Page ${String(pageIndex + 1).padStart(2, "0")}` }); onPageClick?.(pageIndex); }}
    onContextMenu={(event) => { const point = eventPoint(event); if (!point) return; const frame = frameAtPoint(point); contextFor(event, frame ? { type: "comic_frame", id: frame.id, pageId: unit.id, label: frameLabel(frame) } : { type: "presentation_unit", id: unit.id, pageId: unit.id, label: `Page ${String(pageIndex + 1).padStart(2, "0")}` }); }}>
    <div className="paper-grain" aria-hidden="true" />
    {snapGuides ? <svg className="snap-guide-layer" viewBox={`0 0 ${unit.canvas.width} ${unit.canvas.height}`} preserveAspectRatio="none" aria-hidden="true">
      {"edgeGuides" in snapGuides ? snapGuides.edgeGuides.map((guide) => guide.axis === "x"
        ? <line className="edge-extension" key={`x-${guide.position}`} x1={guide.position} x2={guide.position} y1={0} y2={unit.canvas.height} />
        : <line className="edge-extension" key={`y-${guide.position}`} x1={0} x2={unit.canvas.width} y1={guide.position} y2={guide.position} />) : null}
      {"parallelGuide" in snapGuides ? <>
        <line className="parallel-reference-edge" x1={snapGuides.parallelGuide.referenceEdge.start.x} y1={snapGuides.parallelGuide.referenceEdge.start.y} x2={snapGuides.parallelGuide.referenceEdge.end.x} y2={snapGuides.parallelGuide.referenceEdge.end.y} />
        <line className="parallel-active-edge" x1={snapGuides.parallelGuide.activeEdge.start.x} y1={snapGuides.parallelGuide.activeEdge.start.y} x2={snapGuides.parallelGuide.activeEdge.end.x} y2={snapGuides.parallelGuide.activeEdge.end.y} />
      </> : null}
    </svg> : null}
    {editable && unit.surfaces.length > 1 ? unit.surfaces.slice(1).map((surface) => <span key={`${surface.id}-seam`} className={`lcd-surface-seam ${unit.kind === "spread" ? "vertical" : "horizontal"}`} aria-hidden="true" style={unit.kind === "spread" ? { left: `${surface.geometry.x / unit.canvas.width * 100}%` } : { top: `${surface.geometry.y / unit.canvas.height * 100}%` }} />) : null}
    {scene.frames.map(({ frame, fillZIndex }) => <div className="lcd-frame-fill" key={`${frame.id}-fill`} style={{ ...geometryStyle(frame.geometry, unit.canvas.width, unit.canvas.height), zIndex: fillZIndex }}><FrameShapeVisual frame={frame} fill="#fff" /></div>)}
    {images.map((node) => {
      const image = node.element;
      const frame = node.frame;
      const frameContent = node.source === "frame";
      const selected = selection?.type === "image" && selection.id === image.id;
      const src = resolvedResources?.[image.assetVersionId]?.url;
      const label = node.source === "overlay"
        ? overlayImageLabel(node)
        : frame
          ? `${frameLabel(frame)}主图`
          : "页面图像";
      const imageSelection: Selection = { type: "image", id: image.id, pageId: unit.id, label };
      const anchorGeometry = frame?.geometry ?? { x: 0, y: 0, width: unit.canvas.width, height: unit.canvas.height };
      const coordinateBounds = nodeCoordinateBounds(node, frame);
      return <div className={`lcd-image ${node.source === "overlay" ? "scene-overlay" : ""} ${selected ? "selected" : ""} ${multiSelectedIds?.has(image.id) ? "multi-selected" : ""}`} data-element-id={image.id} data-page-id={unit.id} key={image.id}
        style={{ ...elementSceneStyle(node, unit.canvas.width, unit.canvas.height), opacity: image.opacity, mixBlendMode: image.blendMode }}
        onWheel={(event) => { if (frameContent && frame) zoomCropWithWheel(event, image, frame); }}
        onClick={(event) => { event.stopPropagation(); if (!frameContent || selected || !frame) onSelect?.(imageSelection); else selectFrame(frame); }}
        onDoubleClick={(event) => doubleClick(event, imageSelection)}
        onContextMenu={(event) => contextFor(event, imageSelection)}
        onPointerDown={(event) => {
          if (event.button === 0 && event.detail > 1) return;
          if (node.source === "overlay" && selected && interactionMode === "move" && event.button === 0) {
            startDrag(event, { mode: "image_move", elementId: image.id, frameId: frame?.id, anchorGeometry, coordinateBounds, startTransform: image.transform, startSceneGeometry: node.geometry }, imageSelection);
            return;
          }
          if (!frameContent || !frame || !selected || interactionMode !== "crop") return;
          // A full-frame crop has no room to pan. Start a small viewport on the
          // first drag so the gesture immediately changes the visible framing.
          const startCrop = image.crop.width >= .999 && image.crop.height >= .999
            ? { x: .04, y: .04, width: .92, height: .92 }
            : image.crop;
          startDrag(event, { mode: "image_crop", elementId: image.id, frameId: frame.id, startCrop }, imageSelection);
        }}>
        <div className="lcd-image-crop">
          {src ? <img src={src} alt="漫画画格中的格内成稿图" draggable={false} style={cropStyle(image)} /> : <div className="missing-frame-image" aria-label="等待格内成稿图"><span>等待格内成稿图</span></div>}
        </div>
        {selected && editable ? <><div className="selection-corners image-corners" aria-hidden="true"><span className="selection-label">{label}</span></div>{node.source === "overlay" && interactionMode === "move" ? <button type="button" aria-label="调整纸面图片大小" className="resize-handle overlay-image-resize" onPointerDown={(event) => startDrag(event, { mode: "image_resize", elementId: image.id, frameId: frame?.id, anchorGeometry, coordinateBounds, startTransform: image.transform, startSceneGeometry: node.geometry }, imageSelection)}/> : null}</> : null}
      </div>;
    })}
    {scene.frames.map(({ frame, borderZIndex }) => {
      const selected = selection?.type === "comic_frame" && selection.id === frame.id;
      const cropEditing = cropFrameId === frame.id;
      const cornerPoints = cropEditing ? frameQuadrilateralPoints(frame.shape) : undefined;
      const frameSelection: Selection = { type: "comic_frame", id: frame.id, pageId: unit.id, label: frameLabel(frame) };
      const retainedSelection = selection?.type === "image" && cropEditing ? selection : frameSelection;
      return <div className={`lcd-frame ${selected ? "selected" : ""} ${cropEditing ? "crop-editing" : ""} ${multiSelectedIds?.has(frame.id) ? "multi-selected" : ""}`} data-element-id={frame.id} data-page-id={unit.id} key={frame.id}
        // Corner controls live inside the frame stacking context. Lift that
        // context above the global object-number layer only while editing so
        // moved handles remain clickable even when they cross another badge.
        style={{ ...geometryStyle(frame.geometry, unit.canvas.width, unit.canvas.height), zIndex: cropEditing ? 2_147_483_646 : borderZIndex }}
        onClick={(event) => { event.stopPropagation(); const point = eventPoint(event); if (creationMode === "narration" && point) { onPlaceNarration?.(unit.id, { x: point.canvasX, y: point.canvasY }); return; } if (creationMode === "dialogue") { if (point) onPlaceDialogue?.(unit.id, frame.id, { x: clamp((point.canvasX - frame.geometry.x) / frame.geometry.width, 0, 1), y: clamp((point.canvasY - frame.geometry.y) / frame.geometry.height, 0, 1) }); return; } if (!suppressClick.current) selectFrame(frame); }}
        onDoubleClick={(event) => doubleClick(event, frameSelection)}
        onPointerDown={(event) => { if (event.button === 0 && event.detail > 1) return; if (selected && interactionMode === "move" && event.button === 0) startDrag(event, { mode: "frame_move", elementId: frame.id, frameId: frame.id, startGeometry: frame.geometry }, frameSelection); }}
        onContextMenu={(event) => contextFor(event, frameSelection)}>
        <FrameShapeVisual frame={frame} fill="none" stroke />
        {cropEditing && editable && cornerPoints ? <div className="frame-corner-controls" aria-label="调整画格角度">{cornerPoints.map((point, index) => <button type="button" key={index} className={`frame-corner-handle corner-${index}`} style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }} aria-label={`调整画格${["左上", "右上", "右下", "左下"][index]}角；使用方向键单轴微调`} onKeyDown={(event) => nudgeFrameCorner(event, frame, index as FrameCornerIndex)} onPointerDown={(event) => startDrag(event, { mode: "frame_corner", elementId: frame.id, frameId: frame.id, startGeometry: frame.geometry, startShape: frame.shape, frameBounds: editableBoundsForFrame(frame), cornerIndex: index as FrameCornerIndex }, retainedSelection)} />)}</div> : null}
        {selected && editable ? <><div className="selection-corners frame-corners" aria-hidden="true"><span className="selection-label">{frameLabel(frame)}</span></div>{interactionMode === "move" ? <button type="button" aria-label="调整画格大小" className="resize-handle" onPointerDown={(event) => startDrag(event, { mode: "frame_resize", elementId: frame.id, frameId: frame.id, startGeometry: frame.geometry }, frameSelection)}/> : null}</> : null}
      </div>;
    })}
    {texts.map((node) => {
      const text = node.element;
      const editableNarration = node.source === "overlay" && node.overlayPurpose === "narration";
      const selected = editableNarration && selection?.type === "text" && selection.id === text.id;
      const textSelection: Selection = { type: "text", id: text.id, pageId: unit.id, label: narrationOrderLabel(node) };
      const appearanceSrc = text.appearance ? resolvedResources?.[text.appearance.assetVersionId]?.url : undefined;
      const anchorGeometry = { x: 0, y: 0, width: unit.canvas.width, height: unit.canvas.height };
      return <div className={`lcd-text role-${text.role} ${editableNarration ? "editable-narration" : ""} ${selected ? "selected" : ""}`} data-element-id={text.id} data-page-id={unit.id} key={text.id}
        style={{ ...elementSceneStyle(node, unit.canvas.width, unit.canvas.height), color: text.style.color, WebkitTextStroke: text.style.stroke ? `${projectTextStrokeWidth(text) / unit.canvas.width * 100}cqw ${text.style.stroke}` : undefined, paintOrder: "stroke fill", fontFamily: text.style.fontFamily, fontSize: `${text.style.fontSize / unit.canvas.width * 100}cqw`, fontWeight: text.style.fontWeight, textAlign: text.style.align, writingMode: text.style.writingMode === "vertical" ? "vertical-lr" : "horizontal-tb" }}
        onClick={editableNarration ? (event) => { event.stopPropagation(); if (!suppressClick.current) onSelect?.(textSelection); } : undefined}
        onDoubleClick={editableNarration ? (event) => doubleClick(event, textSelection) : undefined}
        onContextMenu={editableNarration ? (event) => contextFor(event, textSelection) : undefined}
        onPointerDown={(event) => { if (event.button !== 0 || event.detail > 1) return; if (selected && interactionMode === "move") startDrag(event, { mode: "text_move", elementId: text.id, anchorGeometry, startTransform: text.transform }, textSelection); }}>
        {appearanceSrc ? <img src={appearanceSrc} alt="" draggable={false} /> : <span>{text.content}</span>}
        {selected && editable ? <><span className="text-selection-outline" aria-hidden="true" />{interactionMode === "move" ? <span className="text-resize-handle" aria-label="调整旁白宽度" onPointerDown={(event) => startDrag(event, { mode: "text_resize", elementId: text.id, anchorGeometry, startTransform: text.transform }, textSelection)} /> : null}</> : null}
      </div>;
    })}
    {effects.map((node) => {
      const effect = node.element;
      const src = effect.assetVersionId ? resolvedResources?.[effect.assetVersionId]?.url : undefined;
      return src ? <div className="lcd-effect" data-element-id={effect.id} data-page-id={unit.id} key={effect.id} style={{ ...elementSceneStyle(node, unit.canvas.width, unit.canvas.height), opacity: effect.opacity, pointerEvents: "none" }}><img src={src} alt="" draggable={false} /></div> : null;
    })}
    {balloons.map((node) => {
      const balloon = node.element;
      const frame = node.frame;
      const selected = selection?.type === "speech_balloon" && selection.id === balloon.id; const label = node.overlayPurpose === "cross_page" ? balloonOrderLabel(node) : balloon.name ?? (node.source === "overlay" ? frame ? `${frameLabel(frame)}破格气泡` : "纸面气泡" : frame ? `${frameLabel(frame)}气泡` : "页面气泡");
      const balloonSelection: Selection = { type: "speech_balloon", id: balloon.id, pageId: unit.id, label };
      const appearanceSrc = balloon.appearance ? resolvedResources?.[balloon.appearance.assetVersionId]?.url : undefined;
      const tail = projectBalloonTail(balloon);
      const strokeWidths = projectBalloonStrokeWidths(balloon);
      const paths = tail ? tailPaths(tail) : undefined;
      const localTailTip = tail ? { x: balloon.transform.x + tail.tip.x / 100 * balloon.transform.width, y: balloon.transform.y + tail.tip.y / 100 * balloon.transform.height } : undefined;
      const anchorGeometry = frame?.geometry ?? { x: 0, y: 0, width: unit.canvas.width, height: unit.canvas.height };
      const coordinateBounds = nodeCoordinateBounds(node, frame);
      return <button type="button" className={`lcd-balloon shape-${balloon.shape} ${node.source === "overlay" ? "scene-overlay" : ""} ${selected ? "selected" : ""} ${multiSelectedIds?.has(balloon.id) ? "multi-selected" : ""}`} data-element-id={balloon.id} data-page-id={unit.id} key={balloon.id}
        style={{ ...elementSceneStyle(node, unit.canvas.width, unit.canvas.height), color: balloon.style.textColor, fontFamily: balloon.style.fontFamily, fontSize: `${balloon.style.fontSize / unit.canvas.width * 100}cqw`, writingMode: balloon.style.writingMode === "vertical" ? "vertical-rl" : "horizontal-tb" }}
        onClick={(event) => { event.stopPropagation(); if (!suppressClick.current) onSelect?.(balloonSelection); }}
        onDoubleClick={(event) => doubleClick(event, balloonSelection)}
        onContextMenu={(event) => contextFor(event, balloonSelection)}
        onPointerDown={(event) => { if (event.button === 0 && event.detail > 1) return; if (selected && interactionMode === "move" && event.button === 0) startDrag(event, { mode: "balloon_move", elementId: balloon.id, frameId: frame?.id, anchorGeometry, coordinateBounds, startTransform: balloon.transform, startTailTarget: balloon.tailTarget }, balloonSelection); }}>
        {appearanceSrc ? <img className="balloon-appearance" src={appearanceSrc} alt="" draggable={false} /> : <svg className="balloon-shape" aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none">
          {balloon.shape === "caption_box" ? <rect className="balloon-outline" x="1.5" y="1.5" width="97" height="97" rx="3" vectorEffect="non-scaling-stroke" style={{ fill: balloon.style.fill, stroke: balloon.style.stroke, strokeWidth: strokeWidths.outline }} /> : <ellipse className="balloon-outline" cx="50" cy="50" rx="48" ry="46" vectorEffect="non-scaling-stroke" style={{ fill: balloon.style.fill, stroke: balloon.style.stroke, strokeWidth: strokeWidths.outline }} />}
          {tail && paths ? <><path className="balloon-tail-fill" d={paths.fill} style={{ fill: balloon.style.fill }} /><path className="balloon-tail-outline" d={paths.outline} vectorEffect="non-scaling-stroke" style={{ stroke: balloon.style.stroke, strokeWidth: strokeWidths.tail }} /><ellipse className="balloon-mask" cx="50" cy="50" rx="48" ry="46" style={{ fill: balloon.style.fill }} /></> : null}
        </svg>}
        <span className="balloon-content">{node.dialogueText ?? ""}</span>
        {selected && interactionMode === "move" ? <><span className="balloon-resize-handle" aria-label="调整气泡大小" onPointerDown={(event) => startDrag(event, { mode: "balloon_resize", elementId: balloon.id, frameId: frame?.id, anchorGeometry, coordinateBounds, startTransform: balloon.transform }, balloonSelection)}/>{tail && localTailTip ? <span className="balloon-tail-handle" aria-label="调整气泡尾巴长度与指向" style={{ left: `${tail.tip.x}%`, top: `${tail.tip.y}%` }} onPointerDown={(event) => startDrag(event, { mode: "balloon_tail", elementId: balloon.id, frameId: frame?.id, anchorGeometry, coordinateBounds, startTransform: balloon.transform, startTailTarget: localTailTip }, balloonSelection)}/> : null}</> : null}
      </button>;
    })}
    {editable ? <div className="object-order-layer">
      {balloons.map((node, index) => {
        const balloon = node.element;
        const frame = node.frame;
        const crossPage = node.overlayPurpose === "cross_page";
        const label = balloonOrderLabel(node);
        const order = balloonOrder(node);
        const nextSelection: Selection = { type: "speech_balloon", id: balloon.id, pageId: unit.id, label };
        const anchorGeometry = frame?.geometry ?? { x: 0, y: 0, width: unit.canvas.width, height: unit.canvas.height };
        const coordinateBounds = nodeCoordinateBounds(node, frame);
        return <span className="balloon-order-anchor" key={`${balloon.id}-order`} style={{ ...geometryStyle(node.geometry, unit.canvas.width, unit.canvas.height), translate: `${badgeOffsets.get(`balloon:${balloon.id}`) ?? 0}px 0` }}><button type="button" className={`balloon-order ${crossPage ? "cross-page" : ""} ${selection?.type === "speech_balloon" && selection.id === balloon.id ? "selected" : ""}`} aria-label={`选择${label}`} onClick={(event) => { event.stopPropagation(); if (event.detail === 0) onSelect?.(nextSelection); }} onDoubleClick={(event) => doubleClick(event, nextSelection)} onContextMenu={(event) => contextFor(event, nextSelection)} onPointerDown={(event) => { if (event.button !== 0 || event.detail > 1) return; event.stopPropagation(); onSelect?.(nextSelection); if (interactionMode === "move") startDrag(event, { mode: "balloon_move", elementId: balloon.id, frameId: frame?.id, anchorGeometry, coordinateBounds, startTransform: balloon.transform, startTailTarget: balloon.tailTarget }, nextSelection); }}>{crossPage ? label : String(order).padStart(2, "0")}</button></span>;
      })}
      {overlayImages.map((node) => {
        const image = node.element;
        const frame = node.frame;
        const label = overlayImageLabel(node);
        const anchorGeometry = frame?.geometry ?? { x: 0, y: 0, width: unit.canvas.width, height: unit.canvas.height };
        const coordinateBounds = nodeCoordinateBounds(node, frame);
        const nextSelection: Selection = { type: "image", id: image.id, pageId: unit.id, label };
        return <span className="image-order-anchor" key={`${image.id}-order`} style={{ ...geometryStyle(node.geometry, unit.canvas.width, unit.canvas.height), translate: `${badgeOffsets.get(`image:${image.id}`) ?? 0}px 0` }}><button type="button" className={`image-object-order ${selection?.type === "image" && selection.id === image.id ? "selected" : ""}`} aria-label={`选择${label}`} onClick={(event) => { event.stopPropagation(); if (event.detail === 0) onSelect?.(nextSelection); }} onDoubleClick={(event) => doubleClick(event, nextSelection)} onContextMenu={(event) => contextFor(event, nextSelection)} onPointerDown={(event) => { if (event.button !== 0 || event.detail > 1) return; event.stopPropagation(); onSelect?.(nextSelection); if (interactionMode === "move") startDrag(event, { mode: "image_move", elementId: image.id, frameId: frame?.id, anchorGeometry, coordinateBounds, startTransform: image.transform, startSceneGeometry: node.geometry }, nextSelection); }}>{label}</button></span>;
      })}
      {scene.frames.map(({ frame }, index) => {
        const order = readingOrder.get(frame.id) ?? index + 1;
        const crossPage = unit.kind === "spread" && frame.surfaceScope === "unit";
        const cornerEditing = cropFrameId === frame.id;
        const nextSelection: Selection = { type: "comic_frame", id: frame.id, pageId: unit.id, label: frameLabel(frame) };
        return <button type="button" className={`reading-order frame-order-button ${cornerEditing ? "corner-editing" : ""} ${crossPage ? "cross-page" : ""} ${selection?.type === "comic_frame" && selection.id === frame.id ? "selected" : ""}`} data-frame-id={frame.id} key={`${frame.id}-order`} style={{ left: `calc(${frame.geometry.x / unit.canvas.width * 100}% - 12px + ${badgeOffsets.get(`frame:${frame.id}`) ?? 0}px)`, top: `calc(${frame.geometry.y / unit.canvas.height * 100}% - ${cornerEditing ? 34 : 12}px)` }} aria-label={`选择${frameLabel(frame)}`} onClick={(event) => { event.stopPropagation(); if (event.detail === 0) selectFrame(frame); }} onDoubleClick={(event) => doubleClick(event, nextSelection)} onContextMenu={(event) => contextFor(event, nextSelection)} onPointerDown={(event) => { if (event.button !== 0 || event.detail > 1) return; event.stopPropagation(); selectFrame(frame); if (interactionMode === "move") startDrag(event, { mode: "frame_move", elementId: frame.id, frameId: frame.id, startGeometry: frame.geometry }, nextSelection); }}>{crossPage ? frameLabel(frame) : order}</button>;
      })}
    </div> : null}
    <span className="page-watermark">{unit.kind === "vertical_segment" ? `SCROLL ${String(pageIndex + 1).padStart(2, "0")}` : unit.kind === "four_panel_unit" ? "4-KOMA" : `PAGE ${String(pageIndex + 1).padStart(2, "0")}`}</span>
  </div>;
}

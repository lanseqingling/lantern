"use client";

import { useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import type { ArtElement, BalloonElement, ComicDocument, EffectElement, Frame, Geometry, LocalTransform, Point, ResolvedResourceMap, SceneElementNode, TextElement } from "@/packages/shared/src";
import { projectBalloonStrokeWidths, projectBalloonTail, projectComicRenderScene } from "@/packages/shared/src";
import type { Selection } from "@/app/lib/workbench-state";

type ElementPatch = Record<string, unknown>;
type ElementPatchBatch = Array<{ elementId: string; patch: ElementPatch }>;
export type ComicContextPoint = { clientX: number; clientY: number; canvasX: number; canvasY: number };
type DragState = {
  mode: "frame_move" | "frame_resize" | "image_crop" | "balloon_move" | "balloon_resize" | "balloon_tail";
  elementId: string;
  frameId: string;
  startX: number;
  startY: number;
  startGeometry?: Geometry;
  startTransform?: LocalTransform;
  startTailTarget?: Point;
  startCrop?: { x: number; y: number; width: number; height: number };
  moved?: boolean;
};

type ComicRendererProps = {
  document: ComicDocument;
  resolvedResources?: ResolvedResourceMap;
  pageIndex: number;
  selection?: Selection;
  editable?: boolean;
  interactionMode?: "select" | "move" | "crop";
  creationMode?: "dialogue";
  multiSelectedIds?: ReadonlySet<string>;
  multiMoving?: boolean;
  multiMoveDelta?: { x: number; y: number };
  onSelect?: (selection: Selection) => void;
  onContextAction?: (selection: Selection, point: ComicContextPoint) => void;
  onPlaceDialogue?: (unitId: string, frameId: string, position: { x: number; y: number }) => void;
  onCommitElement?: (unitId: string, elementId: string, patch: ElementPatch, label: string) => void;
  onCommitElements?: (unitId: string, patches: ElementPatchBatch, label: string) => void;
  onPageClick?: (pageIndex: number) => void;
  className?: string;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const rectsOverlap = (a: Geometry, b: Geometry) => Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 0.5 && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 0.5;
const geometryStyle = (geometry: Geometry, width: number, height: number): CSSProperties => ({
  left: `${geometry.x / width * 100}%`, top: `${geometry.y / height * 100}%`, width: `${geometry.width / width * 100}%`, height: `${geometry.height / height * 100}%`,
  transform: geometry.rotate ? `rotate(${geometry.rotate}deg)` : undefined,
});
const cropStyle = (image: ArtElement): CSSProperties => {
  const crop = image.crop;
  const x = crop.width >= 1 ? 50 : crop.x / (1 - crop.width) * 100;
  const y = crop.height >= 1 ? 50 : crop.y / (1 - crop.height) * 100;
  return { objectPosition: `${x}% ${y}%`, transform: `scale(${clamp(1 / Math.max(crop.width, crop.height), 1, 2.8)})` };
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
  const strokeWidth = stroke ? frame.border.width / frame.geometry.width * 100 : 0;
  const common = { fill, stroke: strokeColor, strokeWidth, strokeDasharray: frame.border.style === "rough" ? "7 3 2 3" : undefined };
  return <svg className="lcd-frame-shape" aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none">
    {frame.shape.kind === "ellipse" ? <ellipse cx="50" cy="50" rx="50" ry="50" {...common} />
      : frame.shape.kind === "polygon" ? <polygon points={frame.shape.points.map((point) => `${point.x * 100},${point.y * 100}`).join(" ")} {...common} />
        : <rect x="0" y="0" width="100" height="100" rx={frame.shape.radius ? frame.shape.radius / frame.geometry.width * 100 : 0} {...common} />}
  </svg>;
}

export function ComicRenderer({ document, resolvedResources, pageIndex, selection, editable = false, interactionMode = "select", creationMode, multiSelectedIds, multiMoving = false, multiMoveDelta, onSelect, onContextAction, onPlaceDialogue, onCommitElement, onCommitElements, onPageClick, className }: ComicRendererProps) {
  const unit = document.units[pageIndex] ?? document.units[0];
  const paperRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressClick = useRef(false);
  const [drafts, setDrafts] = useState<Record<string, ElementPatch>>({});
  const draftsRef = useRef<Record<string, ElementPatch>>({});
  if (!unit) return <div className="empty-comic">暂无可预览的漫画页面</div>;

  const frameDraft = (frame: Frame): Frame => ({
    ...frame,
    ...(drafts[frame.id] as Partial<Frame> | undefined),
    layers: frame.layers.map((layer) => ({ ...layer, elements: layer.elements.map((element) => ({ ...element, ...(drafts[element.id] ?? {}) })) })) as Frame["layers"],
  });
  const draftUnit = { ...unit, frames: unit.frames.map(frameDraft) };
  const scene = projectComicRenderScene(document, draftUnit);
  const frames = scene.frames.map((node) => node.frame);
  const framesById = new Map(frames.map((frame) => [frame.id, frame]));
  const readingOrder = new Map(unit.readingSequence.map((entry, index) => [entry.frameId, index + 1]));
  const images = scene.elements.filter((node): node is ImageSceneNode => node.element.kind === "image");
  const texts = scene.elements.filter((node): node is TextSceneNode => node.element.kind === "text");
  const balloons = scene.elements.filter((node): node is BalloonSceneNode => node.element.kind === "balloon");
  const effects = scene.elements.filter((node): node is EffectSceneNode => node.element.kind === "effect");

  const frameLabel = (frame: Frame) => `画格 ${readingOrder.get(frame.id) ?? ""}`.trim();
  const selectFrame = (frame: Frame) => onSelect?.({ type: "comic_frame", id: frame.id, pageId: unit.id, label: frameLabel(frame) });
  const eventPoint = (event: Pick<ReactMouseEvent, "clientX" | "clientY">): ComicContextPoint | undefined => {
    const bounds = paperRef.current?.getBoundingClientRect();
    if (!bounds?.width || !bounds.height) return undefined;
    return { clientX: event.clientX, clientY: event.clientY, canvasX: (event.clientX - bounds.left) / bounds.width * unit.canvas.width, canvasY: (event.clientY - bounds.top) / bounds.height * unit.canvas.height };
  };
  const frameAtPoint = (point: ComicContextPoint) => [...frames].sort((left, right) => right.zIndex - left.zIndex).find((frame) => point.canvasX >= frame.geometry.x && point.canvasX <= frame.geometry.x + frame.geometry.width && point.canvasY >= frame.geometry.y && point.canvasY <= frame.geometry.y + frame.geometry.height);
  const contextFor = (event: ReactMouseEvent, next: Selection) => {
    if (!editable || !onContextAction) return;
    const point = eventPoint(event);
    if (!point) return;
    event.preventDefault(); event.stopPropagation();
    onSelect?.(next);
    onContextAction(next, point);
  };
  const startDrag = (event: ReactPointerEvent, state: Omit<DragState, "startX" | "startY">, next: Selection) => {
    if (!editable) return;
    event.preventDefault(); event.stopPropagation(); onSelect?.(next);
    dragRef.current = { ...state, startX: event.clientX, startY: event.clientY };
    draftsRef.current = {}; setDrafts({}); event.currentTarget.setPointerCapture(event.pointerId);
  };
  const frameGeometryAllowed = (frameId: string, geometry: Geometry) => geometry.x >= 0 && geometry.y >= 0 && geometry.x + geometry.width <= unit.canvas.width && geometry.y + geometry.height <= unit.canvas.height && (unit.layoutPolicy.frameOverlap === "allow" || !unit.frames.some((frame) => frame.id !== frameId && rectsOverlap(geometry, frame.geometry)));

  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current; const bounds = paperRef.current?.getBoundingClientRect();
    if (!drag || !bounds) return;
    const dx = (event.clientX - drag.startX) / bounds.width * unit.canvas.width;
    const dy = (event.clientY - drag.startY) / bounds.height * unit.canvas.height;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) drag.moved = true;
    let patch: ElementPatch | undefined;
    if (drag.mode === "image_crop" && drag.startCrop) {
      const frame = framesById.get(drag.frameId); if (!frame) return;
      patch = { crop: { ...drag.startCrop, x: clamp(drag.startCrop.x - dx / frame.geometry.width * drag.startCrop.width, 0, 1 - drag.startCrop.width), y: clamp(drag.startCrop.y - dy / frame.geometry.height * drag.startCrop.height, 0, 1 - drag.startCrop.height) } };
    } else if (drag.mode === "balloon_move" && drag.startTransform) {
      const frame = framesById.get(drag.frameId); if (!frame) return;
      const offsetX = dx / frame.geometry.width;
      const offsetY = dy / frame.geometry.height;
      const transform = { ...drag.startTransform, x: clamp(drag.startTransform.x + offsetX, 0, 1 - drag.startTransform.width), y: clamp(drag.startTransform.y + offsetY, 0, 1 - drag.startTransform.height) };
      patch = drag.startTailTarget
        ? { transform, tailTarget: { x: clamp(drag.startTailTarget.x + offsetX, 0, 1), y: clamp(drag.startTailTarget.y + offsetY, 0, 1) } }
        : { transform };
    } else if (drag.mode === "balloon_resize" && drag.startTransform) {
      const frame = framesById.get(drag.frameId); if (!frame) return;
      patch = { transform: { ...drag.startTransform, width: clamp(drag.startTransform.width + dx / frame.geometry.width, .12, 1 - drag.startTransform.x), height: clamp(drag.startTransform.height + dy / frame.geometry.height, .08, 1 - drag.startTransform.y) } };
    } else if (drag.mode === "balloon_tail" && drag.startTailTarget) {
      const frame = framesById.get(drag.frameId); if (!frame) return;
      const transform = drag.startTransform;
      if (!transform) return;
      const rawX = drag.startTailTarget.x + dx / frame.geometry.width;
      const rawY = drag.startTailTarget.y + dy / frame.geometry.height;
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
      const tailLength = clamp(magnitude - edgeDistance, .035, .16);
      patch = { tailTarget: { x: clamp(centerX + unitX * (edgeDistance + tailLength), 0, 1), y: clamp(centerY + unitY * (edgeDistance + tailLength), 0, 1) } };
    } else if (drag.startGeometry) {
      const start = drag.startGeometry;
      const geometry = drag.mode === "frame_resize"
        ? { ...start, width: clamp(start.width + dx, 120, unit.canvas.width - start.x), height: clamp(start.height + dy, 100, unit.canvas.height - start.y) }
        : { ...start, x: clamp(start.x + dx, 0, unit.canvas.width - start.width), y: clamp(start.y + dy, 0, unit.canvas.height - start.height) };
      if (!frameGeometryAllowed(drag.frameId, geometry)) return;
      patch = { geometry };
    }
    if (!patch) return;
    const next = { ...draftsRef.current, [drag.elementId]: patch }; draftsRef.current = next; setDrafts(next);
  };
  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current; if (!drag) return;
    if (drag.moved) { suppressClick.current = true; window.setTimeout(() => { suppressClick.current = false; }, 0); }
    const patch = draftsRef.current[drag.elementId];
    const label = drag.mode === "image_crop" ? "调整图片取景" : drag.mode === "frame_resize" ? "调整画格大小" : drag.mode === "balloon_resize" ? "调整对话气泡大小" : drag.mode === "balloon_tail" ? "调整气泡尾巴指向" : drag.mode === "balloon_move" ? "移动对话气泡" : "移动画格";
    if (patch) {
      if (drag.mode === "frame_move" || drag.mode === "frame_resize") onCommitElements?.(unit.id, [{ elementId: drag.elementId, patch }], label);
      else onCommitElement?.(unit.id, drag.elementId, patch, label);
    }
    draftsRef.current = {}; setDrafts({}); dragRef.current = null;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* already released */ }
  };

  return <div className={`comic-page ${editable ? "is-editable" : "is-preview"} interaction-${interactionMode} ${creationMode ? `creation-${creationMode}` : ""} ${multiMoving ? "multi-moving" : ""} ${className ?? ""}`} data-testid="comic-page" data-page-id={unit.id} ref={paperRef}
    style={{ aspectRatio: `${unit.canvas.width} / ${unit.canvas.height}`, background: unit.canvas.background.color, "--multi-move-x": `${multiMoveDelta?.x ?? 0}px`, "--multi-move-y": `${multiMoveDelta?.y ?? 0}px` } as CSSProperties} onPointerMoveCapture={pointerMove} onPointerUpCapture={finishDrag} onPointerCancelCapture={finishDrag}
    onClick={(event) => { if (interactionMode !== "select" || creationMode) return; const point = eventPoint(event); const frame = point ? frameAtPoint(point) : undefined; if (frame) selectFrame(frame); else onSelect?.({ type: "presentation_unit", id: unit.id, pageId: unit.id, label: `Page ${String(pageIndex + 1).padStart(2, "0")}` }); onPageClick?.(pageIndex); }}
    onContextMenu={(event) => { const point = eventPoint(event); if (!point) return; const frame = frameAtPoint(point); contextFor(event, frame ? { type: "comic_frame", id: frame.id, pageId: unit.id, label: frameLabel(frame) } : { type: "presentation_unit", id: unit.id, pageId: unit.id, label: `Page ${String(pageIndex + 1).padStart(2, "0")}` }); }}>
    <div className="paper-grain" aria-hidden="true" />
    {scene.frames.map(({ frame, fillZIndex }) => <div className="lcd-frame-fill" key={`${frame.id}-fill`} style={{ ...geometryStyle(frame.geometry, unit.canvas.width, unit.canvas.height), zIndex: fillZIndex }}><FrameShapeVisual frame={frame} fill="#fff" /></div>)}
    {images.map((node) => {
      const image = node.element;
      const frame = node.source === "frame" ? node.frame : undefined;
      const selected = selection?.type === "image" && selection.id === image.id;
      const src = resolvedResources?.[image.assetVersionId]?.url;
      const label = frame ? `${frameLabel(frame)}主图` : image.name ?? "页面图像";
      return <div className={`lcd-image ${node.source === "overlay" ? "scene-overlay" : ""} ${selected ? "selected" : ""} ${multiSelectedIds?.has(image.id) ? "multi-selected" : ""}`} data-element-id={image.id} data-page-id={unit.id} key={image.id}
        style={{ ...elementSceneStyle(node, unit.canvas.width, unit.canvas.height), opacity: image.opacity, mixBlendMode: image.blendMode, pointerEvents: frame ? undefined : "none" }}
        onClick={(event) => { if (!frame) return; event.stopPropagation(); if (selected) onSelect?.({ type: "image", id: image.id, pageId: unit.id, label }); else selectFrame(frame); }}
        onContextMenu={(event) => { if (!frame) return; contextFor(event, { type: "image", id: image.id, pageId: unit.id, label }); }}
        onPointerDownCapture={(event) => {
          if (!frame || !selected || interactionMode !== "crop") return;
          // A full-frame crop has no room to pan. Start a small viewport on the
          // first drag so the gesture immediately changes the visible framing.
          const startCrop = image.crop.width >= .999 && image.crop.height >= .999
            ? { x: .04, y: .04, width: .92, height: .92 }
            : image.crop;
          startDrag(event, { mode: "image_crop", elementId: image.id, frameId: frame.id, startCrop }, { type: "image", id: image.id, pageId: unit.id, label });
        }}>
        <div className="lcd-image-crop">
          {src ? <img src={src} alt="漫画画格中的格内成稿图" draggable={false} style={cropStyle(image)} /> : <div className="missing-frame-image" aria-label="等待格内成稿图"><span>等待格内成稿图</span></div>}
        </div>
        {selected && editable ? <div className="selection-corners image-corners" aria-hidden="true"><span className="selection-label">{label}</span></div> : null}
      </div>;
    })}
    {scene.frames.map(({ frame, borderZIndex }) => {
      const selected = selection?.type === "comic_frame" && selection.id === frame.id; const order = readingOrder.get(frame.id) ?? 0;
      return <div className={`lcd-frame ${selected ? "selected" : ""} ${multiSelectedIds?.has(frame.id) ? "multi-selected" : ""}`} data-element-id={frame.id} data-page-id={unit.id} key={frame.id}
        style={{ ...geometryStyle(frame.geometry, unit.canvas.width, unit.canvas.height), zIndex: borderZIndex }}
        onClick={(event) => { event.stopPropagation(); if (creationMode === "dialogue") { const point = eventPoint(event); if (point) onPlaceDialogue?.(unit.id, frame.id, { x: clamp((point.canvasX - frame.geometry.x) / frame.geometry.width, 0, 1), y: clamp((point.canvasY - frame.geometry.y) / frame.geometry.height, 0, 1) }); return; } if (!suppressClick.current) selectFrame(frame); }}
        onPointerDown={(event) => { if (selected && interactionMode === "move" && event.button === 0) startDrag(event, { mode: "frame_move", elementId: frame.id, frameId: frame.id, startGeometry: frame.geometry }, { type: "comic_frame", id: frame.id, pageId: unit.id, label: frameLabel(frame) }); }}
        onContextMenu={(event) => contextFor(event, { type: "comic_frame", id: frame.id, pageId: unit.id, label: frameLabel(frame) })}>
        <FrameShapeVisual frame={frame} fill="none" stroke />
        {editable ? <button type="button" className="reading-order" aria-label={`选择画格 ${order}`} onClick={(event) => { event.stopPropagation(); selectFrame(frame); }} onPointerDown={(event) => { if (interactionMode === "move") startDrag(event, { mode: "frame_move", elementId: frame.id, frameId: frame.id, startGeometry: frame.geometry }, { type: "comic_frame", id: frame.id, pageId: unit.id, label: frameLabel(frame) }); }}>{order}</button> : null}
        {selected && editable ? <><div className="selection-corners frame-corners" aria-hidden="true"><span className="selection-label">{frameLabel(frame)}</span></div>{interactionMode === "move" ? <button type="button" aria-label="调整画格大小" className="resize-handle" onPointerDown={(event) => startDrag(event, { mode: "frame_resize", elementId: frame.id, frameId: frame.id, startGeometry: frame.geometry }, { type: "comic_frame", id: frame.id, pageId: unit.id, label: frameLabel(frame) })}/> : null}</> : null}
      </div>;
    })}
    {texts.map((node) => {
      const text = node.element;
      const appearanceSrc = text.appearance ? resolvedResources?.[text.appearance.assetVersionId]?.url : undefined;
      return <div className={`lcd-text role-${text.role}`} data-element-id={text.id} data-page-id={unit.id} key={text.id}
        style={{ ...elementSceneStyle(node, unit.canvas.width, unit.canvas.height), color: text.style.color, fontFamily: text.style.fontFamily, fontSize: `${text.style.fontSize / unit.canvas.width * 100}cqw`, fontWeight: text.style.fontWeight, textAlign: text.style.align, writingMode: text.style.writingMode === "vertical" ? "vertical-rl" : "horizontal-tb" }}>
        {appearanceSrc ? <img src={appearanceSrc} alt="" draggable={false} /> : <span>{text.content}</span>}
      </div>;
    })}
    {effects.map((node) => {
      const effect = node.element;
      const src = effect.assetVersionId ? resolvedResources?.[effect.assetVersionId]?.url : undefined;
      return src ? <div className="lcd-effect" data-element-id={effect.id} data-page-id={unit.id} key={effect.id} style={{ ...elementSceneStyle(node, unit.canvas.width, unit.canvas.height), opacity: effect.opacity, pointerEvents: "none" }}><img src={src} alt="" draggable={false} /></div> : null;
    })}
    {balloons.map((node) => {
      const balloon = node.element;
      const frame = node.source === "frame" ? node.frame : undefined;
      const selected = Boolean(frame && selection?.type === "speech_balloon" && selection.id === balloon.id); const label = balloon.name ?? (frame ? `${frameLabel(frame)}气泡` : "页面气泡");
      const appearanceSrc = balloon.appearance ? resolvedResources?.[balloon.appearance.assetVersionId]?.url : undefined;
      const tail = projectBalloonTail(balloon);
      const strokeWidths = projectBalloonStrokeWidths(balloon);
      const paths = tail ? tailPaths(tail) : undefined;
      const localTailTip = tail ? { x: balloon.transform.x + tail.tip.x / 100 * balloon.transform.width, y: balloon.transform.y + tail.tip.y / 100 * balloon.transform.height } : undefined;
      return <button type="button" tabIndex={frame ? undefined : -1} aria-hidden={frame ? undefined : true} className={`lcd-balloon shape-${balloon.shape} ${node.source === "overlay" ? "scene-overlay" : ""} ${selected ? "selected" : ""} ${multiSelectedIds?.has(balloon.id) ? "multi-selected" : ""}`} data-element-id={balloon.id} data-page-id={unit.id} key={balloon.id}
        style={{ ...elementSceneStyle(node, unit.canvas.width, unit.canvas.height), color: balloon.style.textColor, fontFamily: balloon.style.fontFamily, fontSize: `${balloon.style.fontSize / unit.canvas.width * 100}cqw`, writingMode: balloon.style.writingMode === "vertical" ? "vertical-rl" : "horizontal-tb", pointerEvents: frame ? undefined : "none" }}
        onClick={(event) => { if (!frame) return; event.stopPropagation(); if (!suppressClick.current) onSelect?.({ type: "speech_balloon", id: balloon.id, pageId: unit.id, label }); }}
        onContextMenu={(event) => { if (!frame) return; contextFor(event, { type: "speech_balloon", id: balloon.id, pageId: unit.id, label }); }}
        onPointerDown={(event) => { if (frame && selected && interactionMode === "move" && event.button === 0) startDrag(event, { mode: "balloon_move", elementId: balloon.id, frameId: frame.id, startTransform: balloon.transform, startTailTarget: balloon.tailTarget }, { type: "speech_balloon", id: balloon.id, pageId: unit.id, label }); }}>
        {appearanceSrc ? <img className="balloon-appearance" src={appearanceSrc} alt="" draggable={false} /> : <svg className="balloon-shape" aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none">
          {balloon.shape === "caption_box" ? <rect className="balloon-outline" x="1.5" y="1.5" width="97" height="97" rx="3" vectorEffect="non-scaling-stroke" style={{ fill: balloon.style.fill, stroke: balloon.style.stroke, strokeWidth: strokeWidths.outline }} /> : <ellipse className="balloon-outline" cx="50" cy="50" rx="48" ry="46" vectorEffect="non-scaling-stroke" style={{ fill: balloon.style.fill, stroke: balloon.style.stroke, strokeWidth: strokeWidths.outline }} />}
          {tail && paths ? <><path className="balloon-tail-fill" d={paths.fill} style={{ fill: balloon.style.fill }} /><path className="balloon-tail-outline" d={paths.outline} vectorEffect="non-scaling-stroke" style={{ stroke: balloon.style.stroke, strokeWidth: strokeWidths.tail }} /><ellipse className="balloon-mask" cx="50" cy="50" rx="48" ry="46" style={{ fill: balloon.style.fill }} /></> : null}
        </svg>}
        <span className="balloon-content">{node.dialogueText ?? ""}</span>
        {frame && selected && interactionMode === "move" ? <><span className="balloon-resize-handle" aria-label="调整气泡大小" onPointerDown={(event) => startDrag(event, { mode: "balloon_resize", elementId: balloon.id, frameId: frame.id, startTransform: balloon.transform }, { type: "speech_balloon", id: balloon.id, pageId: unit.id, label })}/>{tail && localTailTip ? <span className="balloon-tail-handle" aria-label="调整气泡尾巴长度与指向" style={{ left: `${tail.tip.x}%`, top: `${tail.tip.y}%` }} onPointerDown={(event) => startDrag(event, { mode: "balloon_tail", elementId: balloon.id, frameId: frame.id, startTransform: balloon.transform, startTailTarget: localTailTip }, { type: "speech_balloon", id: balloon.id, pageId: unit.id, label })}/> : null}</> : null}
      </button>;
    })}
    {editable ? balloons.map((node, index) => node.source === "frame" ? <span className="balloon-order-anchor" aria-hidden="true" key={`${node.element.id}-order`} style={{ ...geometryStyle(node.geometry, unit.canvas.width, unit.canvas.height), zIndex: 2_000_000 }}><span className="balloon-order">{index + 1}</span></span> : null) : null}
    <span className="page-watermark">{unit.kind === "vertical_segment" ? `SCROLL ${String(pageIndex + 1).padStart(2, "0")}` : unit.kind === "four_panel_unit" ? "4-KOMA" : `PAGE ${String(pageIndex + 1).padStart(2, "0")}`}</span>
  </div>;
}

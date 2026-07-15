"use client";

import { useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type { ArtElement, BalloonElement, ComicDocument, Frame, Geometry, LocalTransform, Point, ResolvedResourceMap } from "@/packages/shared/src";
import { resolveLocalTransform } from "@/packages/shared/src";
import type { Selection } from "@/app/lib/workbench-state";

type ElementPatch = Record<string, unknown>;
type ElementPatchBatch = Array<{ elementId: string; patch: ElementPatch }>;
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
  multiSelectedIds?: ReadonlySet<string>;
  multiMoving?: boolean;
  multiMoveDelta?: { x: number; y: number };
  onSelect?: (selection: Selection) => void;
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

export function ComicRenderer({ document, resolvedResources, pageIndex, selection, editable = false, interactionMode = "select", multiSelectedIds, multiMoving = false, multiMoveDelta, onSelect, onCommitElement, onCommitElements, onPageClick, className }: ComicRendererProps) {
  const unit = document.units[pageIndex] ?? document.units[0];
  const paperRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressClick = useRef(false);
  const [drafts, setDrafts] = useState<Record<string, ElementPatch>>({});
  const draftsRef = useRef<Record<string, ElementPatch>>({});
  const dialogueById = useMemo(() => new Map(document.dialogues.map((dialogue) => [dialogue.id, dialogue.content])), [document.dialogues]);
  if (!unit) return <div className="empty-comic">暂无可预览的漫画页面</div>;

  const frameDraft = (frame: Frame): Frame => ({ ...frame, ...(drafts[frame.id] as Partial<Frame> | undefined) });
  const frames = unit.frames.map(frameDraft);
  const framesById = new Map(frames.map((frame) => [frame.id, frame]));
  const readingOrder = new Map(unit.readingSequence.map((entry, index) => [entry.frameId, index + 1]));
  const images = frames.flatMap((frame) => frame.layers.flatMap((layer) => layer.kind === "art" ? layer.elements.map((image) => ({ frame, layer, image: { ...image, ...(drafts[image.id] as Partial<ArtElement> | undefined) } })) : []));
  const balloons = frames.flatMap((frame) => frame.layers.flatMap((layer) => layer.kind === "text" ? layer.elements.filter((element): element is BalloonElement => element.kind === "balloon").map((balloon) => ({ frame, layer, balloon: { ...balloon, ...(drafts[balloon.id] as Partial<BalloonElement> | undefined) } })) : []));

  const frameLabel = (frame: Frame) => `画格 ${readingOrder.get(frame.id) ?? ""}`.trim();
  const selectFrame = (frame: Frame) => onSelect?.({ type: "comic_frame", id: frame.id, pageId: unit.id, label: frameLabel(frame) });
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

  return <div className={`comic-page ${editable ? "is-editable" : "is-preview"} interaction-${interactionMode} ${multiMoving ? "multi-moving" : ""} ${className ?? ""}`} data-testid="comic-page" data-page-id={unit.id} ref={paperRef}
    style={{ aspectRatio: `${unit.canvas.width} / ${unit.canvas.height}`, "--multi-move-x": `${multiMoveDelta?.x ?? 0}px`, "--multi-move-y": `${multiMoveDelta?.y ?? 0}px` } as CSSProperties} onPointerMoveCapture={pointerMove} onPointerUpCapture={finishDrag} onPointerCancelCapture={finishDrag}
    onClick={() => { if (interactionMode !== "select") return; onSelect?.({ type: "presentation_unit", id: unit.id, pageId: unit.id, label: `Page ${String(pageIndex + 1).padStart(2, "0")}` }); onPageClick?.(pageIndex); }}>
    <div className="paper-grain" aria-hidden="true" />
    {images.map(({ frame, layer, image }) => {
      const selected = selection?.type === "image" && selection.id === image.id;
      const src = resolvedResources?.[image.assetVersionId]?.url;
      const label = `${frameLabel(frame)}主图`;
      return <div className={`lcd-image ${selected ? "selected" : ""} ${multiSelectedIds?.has(image.id) ? "multi-selected" : ""}`} data-element-id={image.id} data-page-id={unit.id} key={image.id}
        style={{ ...geometryStyle(resolveLocalTransform(frame.geometry, image.transform), unit.canvas.width, unit.canvas.height), zIndex: frame.zIndex * 100 + layer.zIndex }}
        onClick={(event) => { event.stopPropagation(); if (selected) onSelect?.({ type: "image", id: image.id, pageId: unit.id, label }); else selectFrame(frame); }}
        onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); if (selected) onSelect?.({ type: "image", id: image.id, pageId: unit.id, label }); else selectFrame(frame); }}
        onPointerDownCapture={(event) => {
          if (!selected || interactionMode !== "crop") return;
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
    {frames.map((frame) => {
      const selected = selection?.type === "comic_frame" && selection.id === frame.id; const order = readingOrder.get(frame.id) ?? 0;
      return <div className={`lcd-frame ${selected ? "selected" : ""} ${multiSelectedIds?.has(frame.id) ? "multi-selected" : ""}`} data-element-id={frame.id} data-page-id={unit.id} key={frame.id}
        style={{ ...geometryStyle(frame.geometry, unit.canvas.width, unit.canvas.height), zIndex: frame.zIndex * 100 + 90, borderWidth: `${Math.max(1, frame.border.width / 2)}px`, borderColor: frame.border.color }}
        onClick={(event) => { event.stopPropagation(); if (!suppressClick.current) selectFrame(frame); }}
        onPointerDown={(event) => { if (selected && interactionMode === "move" && event.button === 0) startDrag(event, { mode: "frame_move", elementId: frame.id, frameId: frame.id, startGeometry: frame.geometry }, { type: "comic_frame", id: frame.id, pageId: unit.id, label: frameLabel(frame) }); }}
        onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); if (!suppressClick.current) selectFrame(frame); }}>
        {editable ? <button type="button" className="reading-order" aria-label={`选择画格 ${order}`} onClick={(event) => { event.stopPropagation(); selectFrame(frame); }} onPointerDown={(event) => { if (interactionMode === "move") startDrag(event, { mode: "frame_move", elementId: frame.id, frameId: frame.id, startGeometry: frame.geometry }, { type: "comic_frame", id: frame.id, pageId: unit.id, label: frameLabel(frame) }); }}>{order}</button> : null}
        {selected && editable ? <><div className="selection-corners frame-corners" aria-hidden="true"><span className="selection-label">{frameLabel(frame)}</span></div>{interactionMode === "move" ? <button type="button" aria-label="调整画格大小" className="resize-handle" onPointerDown={(event) => startDrag(event, { mode: "frame_resize", elementId: frame.id, frameId: frame.id, startGeometry: frame.geometry }, { type: "comic_frame", id: frame.id, pageId: unit.id, label: frameLabel(frame) })}/> : null}</> : null}
      </div>;
    })}
    {balloons.map(({ frame, layer, balloon }, index) => {
      const selected = selection?.type === "speech_balloon" && selection.id === balloon.id; const label = balloon.name ?? `${frameLabel(frame)}气泡`;
      const rawTail = balloon.tailTarget ?? { x: balloon.transform.x + balloon.transform.width * 1.14, y: balloon.transform.y + balloon.transform.height * 1.14 };
      const centerX = balloon.transform.x + balloon.transform.width / 2;
      const centerY = balloon.transform.y + balloon.transform.height / 2;
      const vectorX = rawTail.x - centerX || .001;
      const vectorY = rawTail.y - centerY || .001;
      const magnitude = Math.hypot(vectorX, vectorY);
      const unitX = vectorX / magnitude;
      const unitY = vectorY / magnitude;
      const radiusX = balloon.transform.width / 2;
      const radiusY = balloon.transform.height / 2;
      const edgeDistance = 1 / Math.sqrt((unitX / radiusX) ** 2 + (unitY / radiusY) ** 2);
      const defaultTailLength = Math.min(.09, Math.max(.038, Math.min(balloon.transform.width, balloon.transform.height) * .34));
      const requestedTailLength = magnitude - edgeDistance;
      const tailLength = balloon.tailTarget ? clamp(requestedTailLength, .035, .16) : defaultTailLength;
      const tailTip = { x: centerX + unitX * (edgeDistance + tailLength), y: centerY + unitY * (edgeDistance + tailLength) };
      const tailTipX = (tailTip.x - balloon.transform.x) / balloon.transform.width * 100;
      const tailTipY = (tailTip.y - balloon.transform.y) / balloon.transform.height * 100;
      const supportsTail = balloon.shape === "normal";
      const tailDirection = Math.atan2((tailTipY - 50) / 46, (tailTipX - 50) / 48);
      const tailRoot = (offset: number) => ({ x: 50 + 48 * Math.cos(tailDirection + offset), y: 50 + 46 * Math.sin(tailDirection + offset) });
      const tailStart = tailRoot(-.22);
      const tailEnd = tailRoot(.22);
      const curveToTip = (point: { x: number; y: number }) => ({ x: point.x + (tailTipX - point.x) * .42, y: point.y + (tailTipY - point.y) * .42 });
      const curveFromTip = (point: { x: number; y: number }) => ({ x: tailTipX + (point.x - tailTipX) * .18, y: tailTipY + (point.y - tailTipY) * .18 });
      const startCurve = curveToTip(tailStart);
      const tipToEndCurve = curveFromTip(tailEnd);
      const tailFillPath = `M ${tailStart.x} ${tailStart.y} C ${startCurve.x} ${startCurve.y}, ${tailTipX} ${tailTipY}, ${tailTipX} ${tailTipY} C ${tailTipX} ${tailTipY}, ${tipToEndCurve.x} ${tipToEndCurve.y}, ${tailEnd.x} ${tailEnd.y} Z`;
      const tailOutlinePath = `M ${tailStart.x} ${tailStart.y} C ${startCurve.x} ${startCurve.y}, ${tailTipX} ${tailTipY}, ${tailTipX} ${tailTipY} C ${tailTipX} ${tailTipY}, ${tipToEndCurve.x} ${tipToEndCurve.y}, ${tailEnd.x} ${tailEnd.y}`;
      return <button type="button" className={`lcd-balloon shape-${balloon.shape} ${selected ? "selected" : ""} ${multiSelectedIds?.has(balloon.id) ? "multi-selected" : ""}`} data-element-id={balloon.id} data-page-id={unit.id} key={balloon.id}
        style={{ ...geometryStyle(resolveLocalTransform(frame.geometry, balloon.transform), unit.canvas.width, unit.canvas.height), zIndex: frame.zIndex * 100 + layer.zIndex + 95, fontSize: `${Math.max(8, balloon.style.fontSize / 2.4)}px` }}
        onClick={(event) => { event.stopPropagation(); if (!suppressClick.current) onSelect?.({ type: "speech_balloon", id: balloon.id, pageId: unit.id, label }); }}
        onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); if (!suppressClick.current) onSelect?.({ type: "speech_balloon", id: balloon.id, pageId: unit.id, label }); }}
        onPointerDown={(event) => { if (selected && interactionMode === "move" && event.button === 0) startDrag(event, { mode: "balloon_move", elementId: balloon.id, frameId: frame.id, startTransform: balloon.transform, startTailTarget: balloon.tailTarget }, { type: "speech_balloon", id: balloon.id, pageId: unit.id, label }); }}>
        <svg className="balloon-shape" aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none">
          {balloon.shape === "caption_box" ? <rect className="balloon-outline" x="1.5" y="1.5" width="97" height="97" rx="3" vectorEffect="non-scaling-stroke" /> : <ellipse className="balloon-outline" cx="50" cy="50" rx="48" ry="46" vectorEffect="non-scaling-stroke" />}
          {supportsTail ? <><path className="balloon-tail-fill" d={tailFillPath} /><path className="balloon-tail-outline" d={tailOutlinePath} vectorEffect="non-scaling-stroke" /><ellipse className="balloon-mask" cx="50" cy="50" rx="48" ry="46" /></> : null}
        </svg>
        {editable ? <span className="balloon-order" aria-hidden="true">{index + 1}</span> : null}
        <span className="balloon-content">{dialogueById.get(balloon.dialogueId) ?? ""}</span>
        {selected && interactionMode === "move" ? <><span className="balloon-resize-handle" aria-label="调整气泡大小" onPointerDown={(event) => startDrag(event, { mode: "balloon_resize", elementId: balloon.id, frameId: frame.id, startTransform: balloon.transform }, { type: "speech_balloon", id: balloon.id, pageId: unit.id, label })}/>{supportsTail ? <span className="balloon-tail-handle" aria-label="调整气泡尾巴长度与指向" style={{ left: `${tailTipX}%`, top: `${tailTipY}%` }} onPointerDown={(event) => startDrag(event, { mode: "balloon_tail", elementId: balloon.id, frameId: frame.id, startTransform: balloon.transform, startTailTarget: tailTip }, { type: "speech_balloon", id: balloon.id, pageId: unit.id, label })}/> : null}</> : null}
      </button>;
    })}
    <span className="page-watermark">{unit.kind === "vertical_segment" ? `SCROLL ${String(pageIndex + 1).padStart(2, "0")}` : unit.kind === "four_panel_unit" ? "4-KOMA" : `PAGE ${String(pageIndex + 1).padStart(2, "0")}`}</span>
  </div>;
}

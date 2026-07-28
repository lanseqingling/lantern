"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import { Icon } from "@lantern/ui";
import {
  clampImageViewerZoom,
  imageViewerFitScale,
  imageViewerIndex,
  imageViewerWheelZoomDelta,
  imageViewerZoomMax,
  imageViewerZoomMin,
  imageViewerZoomStep,
  type ImageViewerMode,
} from "@/app/lib/image-viewer";
import { uiCopy } from "@/app/lib/ui-copy";

export type ImageViewerItem = {
  id: string;
  src: string;
  alt: string;
};

export type ImageViewerRequest = {
  images: ImageViewerItem[];
  initialIndex?: number;
  allowNavigation?: boolean;
};

export function ImageViewer({
  images,
  initialIndex = 0,
  allowNavigation = false,
  onClose,
  onIndexChange,
}: ImageViewerRequest & {
  onClose: () => void;
  onIndexChange?: (index: number) => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const [activeIndex, setActiveIndex] = useState(() => imageViewerIndex(initialIndex, 0, images.length));
  const [mode, setMode] = useState<ImageViewerMode>("fit");
  const [zoom, setZoom] = useState(1);
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [imageOffset, setImageOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const safeIndex = imageViewerIndex(activeIndex, 0, images.length);
  const activeImage = images[safeIndex];
  const galleryEnabled = allowNavigation && images.length > 1;

  const setIndex = useCallback((nextIndex: number) => {
    const next = imageViewerIndex(nextIndex, 0, images.length);
    setActiveIndex(next);
    setMode("fit");
    setZoom(1);
    setImageOffset({ x: 0, y: 0 });
    setNaturalSize({ width: 0, height: 0 });
    setLoadFailed(false);
    onIndexChange?.(next);
  }, [images.length, onIndexChange]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const updateSize = () => setStageSize({ width: stage.clientWidth, height: stage.clientHeight });
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
        return;
      }
      if (galleryEnabled && event.key === "ArrowLeft") {
        event.preventDefault();
        setIndex(safeIndex - 1);
        return;
      }
      if (galleryEnabled && event.key === "ArrowRight") {
        event.preventDefault();
        setIndex(safeIndex + 1);
        return;
      }
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        setZoom((current) => clampImageViewerZoom(current + imageViewerZoomStep));
      } else if (event.key === "-") {
        event.preventDefault();
        setZoom((current) => clampImageViewerZoom(current - imageViewerZoomStep));
      }
    };
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [galleryEnabled, onClose, safeIndex, setIndex]);

  const renderedSize = useMemo(() => {
    if (!naturalSize.width || !naturalSize.height) return undefined;
    const baseScale = mode === "fit" ? imageViewerFitScale(naturalSize, stageSize) : 1;
    return {
      width: Math.max(1, Math.round(naturalSize.width * baseScale * zoom)),
      height: Math.max(1, Math.round(naturalSize.height * baseScale * zoom)),
    };
  }, [mode, naturalSize, stageSize, zoom]);

  const beginImageDrag = (event: ReactPointerEvent<HTMLImageElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: imageOffset.x,
      originY: imageOffset.y,
    };
    setDragging(true);
  };

  const moveImage = (event: ReactPointerEvent<HTMLImageElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    setImageOffset({
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY,
    });
  };

  const endImageDrag = (event: ReactPointerEvent<HTMLImageElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const zoomWithWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (event.deltaY === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const delta = imageViewerWheelZoomDelta(event.deltaY);
    setZoom((current) => clampImageViewerZoom(current + delta));
  };

  if (!activeImage) return null;

  return <div className="image-viewer-overlay" role="presentation" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <button ref={closeRef} type="button" className="image-viewer-close" aria-label={uiCopy.imageViewer.closeAria} onClick={onClose}><Icon name="close" /></button>
    <div ref={stageRef} className="image-viewer-stage" role="dialog" aria-modal="true" aria-label={activeImage.alt} onClick={onClose} onWheel={zoomWithWheel}>
      <div className="image-viewer-image-space">
        {loadFailed ? <div className="image-viewer-error"><Icon name="asset" /><strong>{uiCopy.imageViewer.unavailable}</strong></div> : <>
          {/* Signed and local object URLs must retain their intrinsic pixel dimensions for 1:1 mode. */}
          <img key={activeImage.id} className={dragging ? "dragging" : ""} src={activeImage.src} alt={activeImage.alt} draggable={false} style={{ ...renderedSize, transform: `translate(-50%, -50%) translate(${imageOffset.x}px, ${imageOffset.y}px)` }} onClick={(event) => event.stopPropagation()} onPointerDown={beginImageDrag} onPointerMove={moveImage} onPointerUp={endImageDrag} onPointerCancel={endImageDrag} onLoad={(event) => setNaturalSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} onError={() => setLoadFailed(true)} />
        </>}
      </div>
    </div>
    <div className="image-viewer-toolbar" role="toolbar" aria-label={uiCopy.imageViewer.toolbarAria} onClick={(event) => event.stopPropagation()}>
      {galleryEnabled ? <><div className="image-viewer-gallery-controls">
        <button type="button" aria-label={uiCopy.asset.image.previous} disabled={safeIndex <= 0} onClick={() => setIndex(safeIndex - 1)}><Icon name="collapse" /></button>
        <span aria-live="polite">{safeIndex + 1}/{images.length}</span>
        <button type="button" aria-label={uiCopy.asset.image.next} disabled={safeIndex >= images.length - 1} onClick={() => setIndex(safeIndex + 1)}><Icon name="expand" /></button>
      </div><i /></> : null}
      <div className="image-viewer-zoom-controls">
        <button type="button" aria-label={uiCopy.imageViewer.zoomOutAria} disabled={zoom <= imageViewerZoomMin} onClick={() => setZoom((current) => clampImageViewerZoom(current - imageViewerZoomStep))}><Icon name="zoomOut" /></button>
        <span aria-live="polite">{Math.round(zoom * 100)}%</span>
        <button type="button" aria-label={uiCopy.imageViewer.zoomInAria} disabled={zoom >= imageViewerZoomMax} onClick={() => setZoom((current) => clampImageViewerZoom(current + imageViewerZoomStep))}><Icon name="zoomIn" /></button>
      </div>
      <i />
      <button type="button" className="image-viewer-mode" aria-label={mode === "fit" ? uiCopy.imageViewer.originalSizeAria : uiCopy.viewer.action.fitWindow} title={mode === "fit" ? uiCopy.imageViewer.originalSizeTitle : uiCopy.viewer.action.fitWindow} onClick={() => { setMode((current) => current === "fit" ? "actual" : "fit"); setZoom(1); setImageOffset({ x: 0, y: 0 }); }}>
        {mode === "fit" ? <span className="image-viewer-one-to-one" aria-hidden="true">1:1</span> : <Icon name="scan" />}
      </button>
    </div>
  </div>;
}

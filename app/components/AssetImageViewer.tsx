"use client";

import type { MouseEvent, ReactNode } from "react";
import { Icon } from "@/packages/ui/src";
import type { ComicAssetImage } from "@/app/lib/api-client";

type AssetImageViewerProps = {
  name: string;
  images: ComicAssetImage[];
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  showPrimary?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  onEmptyAction?: () => void;
  emptyActionDisabled?: boolean;
  hideControlsWhenEmpty?: boolean;
  onStagePointerDown?: () => void;
  onImageContextMenu?: (event: MouseEvent<HTMLImageElement>, image: ComicAssetImage) => void;
  onImageClick?: (event: MouseEvent<HTMLImageElement>, image: ComicAssetImage) => void;
  stageOverlay?: ReactNode;
};

export function AssetImageViewer({
  name,
  images,
  activeIndex,
  onActiveIndexChange,
  showPrimary = true,
  emptyTitle = "还没有资产图片",
  emptyDescription = "文字资料仍然可以用于创作。",
  onEmptyAction,
  emptyActionDisabled = false,
  hideControlsWhenEmpty = false,
  onStagePointerDown,
  onImageContextMenu,
  onImageClick,
  stageOverlay,
}: AssetImageViewerProps) {
  const safeIndex = images.length ? Math.min(activeIndex, images.length - 1) : 0;
  const activeImage = images[safeIndex];
  const emptyContent = <><Icon name={onEmptyAction ? "add" : "asset"} /><strong>{emptyTitle}</strong><p>{emptyDescription}</p></>;

  return <section className="asset-image-viewer" aria-label={`${name}图片查看器`}>
    <div className="asset-image-stage" onPointerDown={onStagePointerDown}>
      {activeImage ? <><img src={activeImage.contentUrl} alt={`${name}·${activeImage.label}`} onClick={onImageClick ? (event) => onImageClick(event, activeImage) : undefined} onContextMenu={onImageContextMenu ? (event) => onImageContextMenu(event, activeImage) : undefined} />{showPrimary && activeImage.isPrimary ? <span className="asset-image-primary-badge">主图</span> : null}</> : onEmptyAction ? <button type="button" className="asset-image-empty asset-image-empty-action" disabled={emptyActionDisabled} onClick={onEmptyAction}>{emptyContent}</button> : <div className="asset-image-empty">{emptyContent}</div>}
      {stageOverlay}
    </div>
    {!images.length && hideControlsWhenEmpty ? null : <footer className="asset-image-controls">
      <div className="asset-image-navigator">
        <button type="button" aria-label="上一张图片" disabled={safeIndex <= 0} onClick={() => onActiveIndexChange(Math.max(0, safeIndex - 1))}><Icon name="collapse" /></button>
        <div className="asset-image-thumbnails" aria-label="图片列表">
          {images.map((image, index) => <button type="button" key={image.id} className={index === safeIndex ? "active" : ""} aria-label={`查看${image.label}`} aria-pressed={index === safeIndex} onClick={() => onActiveIndexChange(index)}><img src={image.contentUrl} alt="" />{showPrimary && image.isPrimary ? <em>主图</em> : null}<span>{image.label}</span></button>)}
          {!images.length ? <span className="asset-image-empty-thumb"><Icon name={onEmptyAction ? "add" : "asset"} /></span> : null}
        </div>
        <button type="button" aria-label="下一张图片" disabled={safeIndex >= images.length - 1} onClick={() => onActiveIndexChange(Math.min(images.length - 1, safeIndex + 1))}><Icon name="expand" /></button>
      </div>
    </footer>}
  </section>;
}

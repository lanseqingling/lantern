export type ImageViewerMode = "fit" | "actual";

export const imageViewerZoomMin = 0.25;
export const imageViewerZoomMax = 4;
export const imageViewerZoomStep = 0.05;

export function clampImageViewerZoom(zoom: number) {
  return Math.min(imageViewerZoomMax, Math.max(imageViewerZoomMin, zoom));
}

export function imageViewerWheelZoomDelta(deltaY: number) {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 0;
  const magnitude = Math.min(0.01, Math.abs(deltaY) * 0.001);
  return deltaY < 0 ? magnitude : -magnitude;
}

export function imageViewerFitScale(
  image: { width: number; height: number },
  viewport: { width: number; height: number },
) {
  if (image.width <= 0 || image.height <= 0 || viewport.width <= 0 || viewport.height <= 0) return 1;
  return Math.min(1, viewport.width / image.width, viewport.height / image.height);
}

export function imageViewerIndex(index: number, delta: number, length: number) {
  if (length <= 0) return 0;
  return Math.min(length - 1, Math.max(0, index + delta));
}

import type { LocalTransform } from "./types";

export const DEFAULT_BALLOON_STROKE_WIDTH = 1.5;
export const DEFAULT_FRAME_BORDER_WIDTH = 3;

/** Keep enough of a frame-owned balloon inside its frame to remain selectable. */
export const FRAME_BALLOON_MIN_VISIBLE_RATIO = 0.2;

export function frameBalloonCoordinateBounds(transform: Pick<LocalTransform, "width" | "height">) {
  const overflowRatio = 1 - FRAME_BALLOON_MIN_VISIBLE_RATIO;
  return {
    minX: -transform.width * overflowRatio,
    minY: -transform.height * overflowRatio,
    maxX: 1 + transform.width * overflowRatio,
    maxY: 1 + transform.height * overflowRatio,
  };
}

export function frameBalloonTransformKeepsSafeArea(transform: LocalTransform) {
  const bounds = frameBalloonCoordinateBounds(transform);
  const epsilon = 1e-9;
  return transform.x >= bounds.minX - epsilon
    && transform.y >= bounds.minY - epsilon
    && transform.x <= bounds.maxX - transform.width + epsilon
    && transform.y <= bounds.maxY - transform.height + epsilon;
}

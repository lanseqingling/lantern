import { frameQuadrilateralPoints, type FrameCornerAxis, type FrameCornerIndex, type FrameShape, type Geometry, type Point } from "@/packages/shared/src";

export type SnapFrame = {
  id: string;
  geometry: Geometry;
  shape: FrameShape;
};

export type EdgeExtensionGuide = {
  kind: "edge_extension";
  axis: "x" | "y";
  position: number;
};

export type ParallelCornerGuide = {
  kind: "parallel_corner";
  frameId: string;
  referenceEdge: { start: Point; end: Point };
  activeEdge: { start: Point; end: Point };
};

/** Snaps the edited edge back to a horizontal or vertical axis. */
export function snapFrameCornerToOrthogonal(
  frame: SnapFrame,
  cornerIndex: FrameCornerIndex,
  axis: FrameCornerAxis,
  rawDelta: number,
  threshold: number,
): { delta: number; guide?: EdgeExtensionGuide } {
  const corners = absoluteCorners(frame);
  if (!corners) return { delta: rawDelta };
  const edgeIndices: [FrameCornerIndex, FrameCornerIndex] = axis === "x"
    ? cornerIndex === 0 || cornerIndex === 3 ? [0, 3] : [1, 2]
    : cornerIndex === 0 || cornerIndex === 1 ? [0, 1] : [3, 2];
  const fixedCornerIndex = edgeIndices[0] === cornerIndex ? edgeIndices[1] : edgeIndices[0];
  const rawCoordinate = corners[cornerIndex][axis] + rawDelta;
  const fixedCoordinate = corners[fixedCornerIndex][axis];
  const correction = fixedCoordinate - rawCoordinate;
  if (Math.abs(correction) > threshold) return { delta: rawDelta };
  return {
    delta: rawDelta + correction,
    guide: { kind: "edge_extension", axis, position: fixedCoordinate },
  };
}

const absoluteCorners = (frame: Pick<SnapFrame, "geometry" | "shape">): [Point, Point, Point, Point] | undefined => {
  const points = frameQuadrilateralPoints(frame.shape);
  if (!points) return undefined;
  return points.map((point) => ({
    x: frame.geometry.x + point.x * frame.geometry.width,
    y: frame.geometry.y + point.y * frame.geometry.height,
  })) as [Point, Point, Point, Point];
};

const overlappingLength = (leftStart: number, leftEnd: number, rightStart: number, rightEnd: number) => Math.min(leftEnd, rightEnd) - Math.max(leftStart, rightStart);

/**
 * Snaps like-for-like bounds (left to left, right to right, top to top, bottom
 * to bottom). The matching edge is intentionally allowed to be spatially
 * separated, because the editor visualizes its virtual extension across the
 * paper instead of treating the objects as magnetic boxes.
 */
export function snapGeometryToFrameEdgeExtensions(
  geometry: Geometry,
  targets: ReadonlyArray<Pick<SnapFrame, "geometry">>,
  threshold: { x: number; y: number },
): { geometry: Geometry; guides: EdgeExtensionGuide[] } {
  const xCandidates = targets.flatMap((target) => [
    { delta: target.geometry.x - geometry.x, position: target.geometry.x },
    { delta: target.geometry.x + target.geometry.width - geometry.x - geometry.width, position: target.geometry.x + target.geometry.width },
  ]).filter((candidate) => Math.abs(candidate.delta) <= threshold.x).sort((left, right) => Math.abs(left.delta) - Math.abs(right.delta));
  const yCandidates = targets.flatMap((target) => [
    { delta: target.geometry.y - geometry.y, position: target.geometry.y },
    { delta: target.geometry.y + target.geometry.height - geometry.y - geometry.height, position: target.geometry.y + target.geometry.height },
  ]).filter((candidate) => Math.abs(candidate.delta) <= threshold.y).sort((left, right) => Math.abs(left.delta) - Math.abs(right.delta));
  const xSnap = xCandidates[0];
  const ySnap = yCandidates[0];
  return {
    geometry: { ...geometry, x: geometry.x + (xSnap?.delta ?? 0), y: geometry.y + (ySnap?.delta ?? 0) },
    guides: [
      ...(xSnap ? [{ kind: "edge_extension" as const, axis: "x" as const, position: xSnap.position }] : []),
      ...(ySnap ? [{ kind: "edge_extension" as const, axis: "y" as const, position: ySnap.position }] : []),
    ],
  };
}

/** Snaps the right and bottom edges of a bottom-right resize gesture. */
export function snapGeometrySizeToFrameEdgeExtensions(
  geometry: Geometry,
  targets: ReadonlyArray<Pick<SnapFrame, "geometry">>,
  threshold: { x: number; y: number },
): { geometry: Geometry; guides: EdgeExtensionGuide[] } {
  const right = geometry.x + geometry.width;
  const bottom = geometry.y + geometry.height;
  const xSnap = targets.map((target) => {
    const position = target.geometry.x + target.geometry.width;
    return { delta: position - right, position };
  }).filter((candidate) => Math.abs(candidate.delta) <= threshold.x).sort((left, rightCandidate) => Math.abs(left.delta) - Math.abs(rightCandidate.delta))[0];
  const ySnap = targets.map((target) => {
    const position = target.geometry.y + target.geometry.height;
    return { delta: position - bottom, position };
  }).filter((candidate) => Math.abs(candidate.delta) <= threshold.y).sort((top, bottomCandidate) => Math.abs(top.delta) - Math.abs(bottomCandidate.delta))[0];
  return {
    geometry: { ...geometry, width: geometry.width + (xSnap?.delta ?? 0), height: geometry.height + (ySnap?.delta ?? 0) },
    guides: [
      ...(xSnap ? [{ kind: "edge_extension" as const, axis: "x" as const, position: xSnap.position }] : []),
      ...(ySnap ? [{ kind: "edge_extension" as const, axis: "y" as const, position: ySnap.position }] : []),
    ],
  };
}

const solveParallelCoordinate = (fixedPoint: Point, referenceStart: Point, referenceEnd: Point, rawMoving: Point, axis: FrameCornerAxis) => {
  const referenceX = referenceEnd.x - referenceStart.x;
  const referenceY = referenceEnd.y - referenceStart.y;
  if (axis === "y") {
    if (Math.abs(referenceX) < 1e-6) return undefined;
    return fixedPoint.y + (rawMoving.x - fixedPoint.x) * referenceY / referenceX;
  }
  if (Math.abs(referenceY) < 1e-6) return undefined;
  return fixedPoint.x + (rawMoving.y - fixedPoint.y) * referenceX / referenceY;
};

/**
 * While one frame corner is edited, snaps the edited frame's facing edge
 * parallel to the opposite edge of its nearest neighboring frame.
 */
export function snapFrameCornerToNeighborParallel(
  frame: SnapFrame,
  cornerIndex: FrameCornerIndex,
  axis: FrameCornerAxis,
  rawDelta: number,
  targets: ReadonlyArray<SnapFrame>,
  threshold: number,
): { delta: number; guide?: ParallelCornerGuide } {
  const currentCorners = absoluteCorners(frame);
  if (!currentCorners) return { delta: rawDelta };
  const rawMoving = { ...currentCorners[cornerIndex], [axis]: currentCorners[cornerIndex][axis] + rawDelta };
  const currentCenter = { x: frame.geometry.x + frame.geometry.width / 2, y: frame.geometry.y + frame.geometry.height / 2 };
  const currentEdgeIndices: [FrameCornerIndex, FrameCornerIndex] = axis === "x"
    ? cornerIndex === 0 || cornerIndex === 3 ? [0, 3] : [1, 2]
    : cornerIndex === 0 || cornerIndex === 1 ? [0, 1] : [3, 2];
  const targetOnNegativeSide = currentEdgeIndices[0] === 0;
  const neighbors = targets.flatMap((target) => {
    if (target.id === frame.id) return [];
    const corners = absoluteCorners(target);
    if (!corners) return [];
    const targetCenter = { x: target.geometry.x + target.geometry.width / 2, y: target.geometry.y + target.geometry.height / 2 };
    if (axis === "x") {
      if ((targetCenter.x < currentCenter.x) !== targetOnNegativeSide) return [];
      if (overlappingLength(frame.geometry.y, frame.geometry.y + frame.geometry.height, target.geometry.y, target.geometry.y + target.geometry.height) <= 0) return [];
      const gap = targetOnNegativeSide
        ? frame.geometry.x - target.geometry.x - target.geometry.width
        : target.geometry.x - frame.geometry.x - frame.geometry.width;
      const targetEdgeIndices: [FrameCornerIndex, FrameCornerIndex] = targetOnNegativeSide ? [1, 2] : [0, 3];
      return [{ target, corners, gap: Math.max(0, gap), targetEdgeIndices }];
    }
    if ((targetCenter.y < currentCenter.y) !== targetOnNegativeSide) return [];
    if (overlappingLength(frame.geometry.x, frame.geometry.x + frame.geometry.width, target.geometry.x, target.geometry.x + target.geometry.width) <= 0) return [];
    const gap = targetOnNegativeSide
      ? frame.geometry.y - target.geometry.y - target.geometry.height
      : target.geometry.y - frame.geometry.y - frame.geometry.height;
    const targetEdgeIndices: [FrameCornerIndex, FrameCornerIndex] = targetOnNegativeSide ? [3, 2] : [0, 1];
    return [{ target, corners, gap: Math.max(0, gap), targetEdgeIndices }];
  }).sort((left, right) => left.gap - right.gap);
  const neighbor = neighbors[0];
  if (!neighbor) return { delta: rawDelta };

  const fixedCornerIndex = currentEdgeIndices[0] === cornerIndex ? currentEdgeIndices[1] : currentEdgeIndices[0];
  const fixedPoint = currentCorners[fixedCornerIndex];
  const referenceStart = neighbor.corners[neighbor.targetEdgeIndices[0]];
  const referenceEnd = neighbor.corners[neighbor.targetEdgeIndices[1]];
  const snappedCoordinate = solveParallelCoordinate(fixedPoint, referenceStart, referenceEnd, rawMoving, axis);
  if (snappedCoordinate === undefined || Math.abs(snappedCoordinate - rawMoving[axis]) > threshold) return { delta: rawDelta };
  const snappedMoving = { ...rawMoving, [axis]: snappedCoordinate };
  const activeCorners = currentCorners.map((point, index) => index === cornerIndex ? snappedMoving : point) as [Point, Point, Point, Point];
  return {
    delta: rawDelta + snappedCoordinate - rawMoving[axis],
    guide: {
      kind: "parallel_corner",
      frameId: neighbor.target.id,
      referenceEdge: { start: referenceStart, end: referenceEnd },
      activeEdge: { start: activeCorners[currentEdgeIndices[0]], end: activeCorners[currentEdgeIndices[1]] },
    },
  };
}

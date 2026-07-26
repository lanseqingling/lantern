import { frameQuadrilateralPoints, type FrameCornerAxis, type FrameCornerIndex, type FrameShape, type Geometry, type Point } from "@lantern/shared";

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

export type EqualGapGuide = {
  kind: "equal_gap";
  axis: "x" | "y";
  reference: { start: number; end: number; position: number };
  active: { start: number; end: number; position: number };
};

export type MoveSnapGuide = EdgeExtensionGuide | EqualGapGuide;

export type ParallelCornerGuide = {
  kind: "parallel_corner";
  frameId: string;
  referenceEdge: { start: Point; end: Point };
  activeEdge: { start: Point; end: Point };
};

export const contentSafeArea = (surface: Geometry): Geometry => {
  const inset = Math.min(surface.width, surface.height) * .05;
  return {
    x: surface.x + inset,
    y: surface.y + inset,
    width: Math.max(0, surface.width - inset * 2),
    height: Math.max(0, surface.height - inset * 2),
  };
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
  movementAxis?: "x" | "y",
  extraEdgeTargets: ReadonlyArray<Pick<SnapFrame, "geometry">> = [],
): { geometry: Geometry; guides: MoveSnapGuide[] } {
  const edgeTargets = [...targets, ...extraEdgeTargets];
  const xCandidates: MoveSnapCandidate[] = edgeTargets.flatMap((target) => [
    { axis: "x" as const, delta: target.geometry.x - geometry.x, guide: { kind: "edge_extension" as const, axis: "x" as const, position: target.geometry.x } },
    { axis: "x" as const, delta: target.geometry.x + target.geometry.width - geometry.x - geometry.width, guide: { kind: "edge_extension" as const, axis: "x" as const, position: target.geometry.x + target.geometry.width } },
  ]).filter((candidate) => Math.abs(candidate.delta) <= threshold.x);
  const yCandidates: MoveSnapCandidate[] = edgeTargets.flatMap((target) => [
    { axis: "y" as const, delta: target.geometry.y - geometry.y, guide: { kind: "edge_extension" as const, axis: "y" as const, position: target.geometry.y } },
    { axis: "y" as const, delta: target.geometry.y + target.geometry.height - geometry.y - geometry.height, guide: { kind: "edge_extension" as const, axis: "y" as const, position: target.geometry.y + target.geometry.height } },
  ]).filter((candidate) => Math.abs(candidate.delta) <= threshold.y);
  const gapCandidates = movementAxis === "x"
    ? horizontalEqualGapCandidates(geometry, targets, threshold.x)
    : movementAxis === "y"
      ? verticalEqualGapCandidates(geometry, targets, threshold.y)
      : [];
  const xSnap = [...xCandidates, ...gapCandidates.filter((candidate) => candidate.axis === "x")].sort((left, right) => Math.abs(left.delta) - Math.abs(right.delta))[0];
  const ySnap = [...yCandidates, ...gapCandidates.filter((candidate) => candidate.axis === "y")].sort((top, bottom) => Math.abs(top.delta) - Math.abs(bottom.delta))[0];
  return {
    geometry: { ...geometry, x: geometry.x + (xSnap?.delta ?? 0), y: geometry.y + (ySnap?.delta ?? 0) },
    guides: [
      ...(xSnap ? [xSnap.guide] : []),
      ...(ySnap ? [ySnap.guide] : []),
    ],
  };
}

type MoveSnapCandidate = { axis: "x" | "y"; delta: number; guide: MoveSnapGuide };
const overlaps = (firstStart: number, firstEnd: number, secondStart: number, secondEnd: number) => Math.min(firstEnd, secondEnd) - Math.max(firstStart, secondStart) > .5;

const verticalEqualGapCandidates = (geometry: Geometry, targets: ReadonlyArray<Pick<SnapFrame, "geometry">>, threshold: number): MoveSnapCandidate[] => {
  const candidates: MoveSnapCandidate[] = [];
  for (const upper of targets) for (const lower of targets) {
    if (upper === lower || upper.geometry.y + upper.geometry.height > lower.geometry.y || !overlaps(upper.geometry.x, upper.geometry.x + upper.geometry.width, lower.geometry.x, lower.geometry.x + lower.geometry.width)) continue;
    const gap = lower.geometry.y - (upper.geometry.y + upper.geometry.height);
    for (const anchor of targets) {
      if (!overlaps(anchor.geometry.x, anchor.geometry.x + anchor.geometry.width, geometry.x, geometry.x + geometry.width)) continue;
      const placeBelow = anchor.geometry.y + anchor.geometry.height + gap;
      const placeAbove = anchor.geometry.y - geometry.height - gap;
      const position = Math.max(upper.geometry.x + upper.geometry.width, lower.geometry.x + lower.geometry.width, anchor.geometry.x + anchor.geometry.width, geometry.x + geometry.width) + 10;
      for (const [nextY, activeStart, activeEnd] of [[placeBelow, anchor.geometry.y + anchor.geometry.height, placeBelow], [placeAbove, placeAbove + geometry.height, anchor.geometry.y]] as const) {
        const delta = nextY - geometry.y;
        if (Math.abs(delta) > threshold) continue;
        candidates.push({ axis: "y", delta, guide: { kind: "equal_gap", axis: "y", reference: { start: upper.geometry.y + upper.geometry.height, end: lower.geometry.y, position }, active: { start: activeStart, end: activeEnd, position } } });
      }
    }
  }
  return candidates;
};

const horizontalEqualGapCandidates = (geometry: Geometry, targets: ReadonlyArray<Pick<SnapFrame, "geometry">>, threshold: number): MoveSnapCandidate[] => {
  const candidates: MoveSnapCandidate[] = [];
  for (const left of targets) for (const right of targets) {
    if (left === right || left.geometry.x + left.geometry.width > right.geometry.x || !overlaps(left.geometry.y, left.geometry.y + left.geometry.height, right.geometry.y, right.geometry.y + right.geometry.height)) continue;
    const gap = right.geometry.x - (left.geometry.x + left.geometry.width);
    for (const anchor of targets) {
      if (!overlaps(anchor.geometry.y, anchor.geometry.y + anchor.geometry.height, geometry.y, geometry.y + geometry.height)) continue;
      const placeRight = anchor.geometry.x + anchor.geometry.width + gap;
      const placeLeft = anchor.geometry.x - geometry.width - gap;
      const position = Math.max(left.geometry.y + left.geometry.height, right.geometry.y + right.geometry.height, anchor.geometry.y + anchor.geometry.height, geometry.y + geometry.height) + 10;
      for (const [nextX, activeStart, activeEnd] of [[placeRight, anchor.geometry.x + anchor.geometry.width, placeRight], [placeLeft, placeLeft + geometry.width, anchor.geometry.x]] as const) {
        const delta = nextX - geometry.x;
        if (Math.abs(delta) > threshold) continue;
        candidates.push({ axis: "x", delta, guide: { kind: "equal_gap", axis: "x", reference: { start: left.geometry.x + left.geometry.width, end: right.geometry.x, position }, active: { start: activeStart, end: activeEnd, position } } });
      }
    }
  }
  return candidates;
};

/** Snaps the two moving edges of a corner resize gesture to matching edges. */
export function snapGeometrySizeToFrameEdgeExtensions(
  geometry: Geometry,
  targets: ReadonlyArray<Pick<SnapFrame, "geometry">>,
  threshold: { x: number; y: number },
  corner: "top_left" | "top_right" | "bottom_right" | "bottom_left" = "bottom_right",
): { geometry: Geometry; guides: EdgeExtensionGuide[] } {
  const movesLeft = corner === "top_left" || corner === "bottom_left";
  const movesTop = corner === "top_left" || corner === "top_right";
  const activeX = movesLeft ? geometry.x : geometry.x + geometry.width;
  const activeY = movesTop ? geometry.y : geometry.y + geometry.height;
  const xSnap = targets.map((target) => {
    const position = movesLeft ? target.geometry.x : target.geometry.x + target.geometry.width;
    return { delta: position - activeX, position };
  }).filter((candidate) => Math.abs(candidate.delta) <= threshold.x).sort((left, rightCandidate) => Math.abs(left.delta) - Math.abs(rightCandidate.delta))[0];
  const ySnap = targets.map((target) => {
    const position = movesTop ? target.geometry.y : target.geometry.y + target.geometry.height;
    return { delta: position - activeY, position };
  }).filter((candidate) => Math.abs(candidate.delta) <= threshold.y).sort((top, bottomCandidate) => Math.abs(top.delta) - Math.abs(bottomCandidate.delta))[0];
  const xDelta = xSnap?.delta ?? 0;
  const yDelta = ySnap?.delta ?? 0;
  return {
    geometry: {
      ...geometry,
      x: geometry.x + (movesLeft ? xDelta : 0),
      y: geometry.y + (movesTop ? yDelta : 0),
      width: geometry.width + (movesLeft ? -xDelta : xDelta),
      height: geometry.height + (movesTop ? -yDelta : yDelta),
    },
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

export function resolveWorkbenchPageIndex(
  units: ReadonlyArray<{ id: string }>,
  requestedPageId?: string | null,
  fallbackIndex = 0,
) {
  if (!units.length) return 0;
  if (requestedPageId) {
    const requestedIndex = units.findIndex((unit) => unit.id === requestedPageId);
    if (requestedIndex >= 0) return requestedIndex;
  }
  return Math.min(Math.max(0, fallbackIndex), units.length - 1);
}

export function resolveReadingUnitIndex(
  document: { reading: { unitOrder: string[] }; units: ReadonlyArray<{ id: string }> },
  unitId?: string,
) {
  if (!unitId || !document.units.some((unit) => unit.id === unitId)) return -1;
  return document.reading.unitOrder.indexOf(unitId);
}

export function isCandidatePreviewTargetVisible(
  groups: ReadonlyArray<{ unitIndices: number[] }>,
  currentPageIndex: number,
  targetPageIndex: number,
) {
  const currentGroup = groups.find((group) => group.unitIndices.includes(currentPageIndex));
  return Boolean(currentGroup?.unitIndices.includes(targetPageIndex));
}

export function findAvailableFrameImageCandidateForTask<T extends {
  kind: string;
  status: string;
  metadata?: Record<string, string>;
}>(candidates: readonly T[], taskId?: string) {
  if (!taskId) return undefined;
  return candidates.find((candidate) =>
    candidate.kind === "frame_image"
    && candidate.status === "available"
    && candidate.metadata?.taskId === taskId,
  );
}

import type { ComicDocument } from "@lantern/shared";

export function resolveVersionDisplayUnit(document: ComicDocument, pageIndex: number) {
  const unitId = document.reading.unitOrder[pageIndex];
  return unitId ? document.units.find((unit) => unit.id === unitId) : undefined;
}

export type VersionDifference = {
  unitId: string;
  currentUnitId?: string;
  targetUnitId?: string;
};

export type VersionSideItem =
  | { kind: "unit"; unitId: string; comparisonId: string }
  | { kind: "blank"; comparisonId: string; referenceUnitId: string };

export function splitTrailingVersionBlanks(items: VersionSideItem[]) {
  let tailStart = items.length;
  while (tailStart > 0 && items[tailStart - 1]?.kind === "blank") tailStart -= 1;
  return {
    paperItems: items.slice(0, tailStart),
    trailingBlankItems: items.slice(tailStart) as Array<Extract<VersionSideItem, { kind: "blank" }>>,
  };
}

export function versionSideItems(
  side: "current" | "target",
  unitOrder: string[],
  otherUnitOrder: string[],
  differences: VersionDifference[],
): VersionSideItem[] {
  const sideKey = side === "current" ? "currentUnitId" : "targetUnitId";
  const otherKey = side === "current" ? "targetUnitId" : "currentUnitId";
  const differenceBySideUnit = new Map(differences.flatMap((difference) => {
    const unitId = difference[sideKey];
    return unitId ? [[unitId, difference] as const] : [];
  }));
  const differenceByOtherUnit = new Map(differences.flatMap((difference) => {
    const unitId = difference[otherKey];
    return unitId ? [[unitId, difference] as const] : [];
  }));
  const sidePosition = new Map(unitOrder.map((unitId, index) => [unitId, index]));
  const blanks = new Map<number, Array<{ comparisonId: string; referenceUnitId: string }>>();

  for (const difference of differences) {
    if (difference[sideKey] || !difference[otherKey]) continue;
    const otherIndex = otherUnitOrder.indexOf(difference[otherKey]!);
    let boundary = unitOrder.length;
    let foundPrevious = false;
    for (let index = otherIndex - 1; index >= 0; index -= 1) {
      const neighbor = differenceByOtherUnit.get(otherUnitOrder[index]!);
      const neighborSideId = neighbor?.[sideKey];
      if (neighborSideId && sidePosition.has(neighborSideId)) {
        boundary = sidePosition.get(neighborSideId)! + 1;
        foundPrevious = true;
        break;
      }
    }
    if (!foundPrevious) {
      for (let index = Math.max(0, otherIndex + 1); index < otherUnitOrder.length; index += 1) {
        const neighbor = differenceByOtherUnit.get(otherUnitOrder[index]!);
        const neighborSideId = neighbor?.[sideKey];
        if (neighborSideId && sidePosition.has(neighborSideId)) {
          boundary = sidePosition.get(neighborSideId)!;
          break;
        }
      }
    }
    blanks.set(boundary, [
      ...(blanks.get(boundary) ?? []),
      { comparisonId: difference.unitId, referenceUnitId: difference[otherKey]! },
    ]);
  }

  const items: VersionSideItem[] = [];
  for (let index = 0; index <= unitOrder.length; index += 1) {
    for (const blank of blanks.get(index) ?? []) items.push({ kind: "blank", ...blank });
    const unitId = unitOrder[index];
    if (!unitId) continue;
    items.push({
      kind: "unit",
      unitId,
      comparisonId: differenceBySideUnit.get(unitId)?.unitId ?? unitId,
    });
  }
  return items;
}

export type VersionScrollMetric = { unitId: string; top: number; height: number };

export function resolveVersionScrollAnchor(metrics: VersionScrollMetric[], position: number) {
  if (!metrics.length) return undefined;
  const metric = metrics.find((item) => position >= item.top && position <= item.top + item.height)
    ?? metrics.reduce((closest, item) => {
      const distance = Math.abs(item.top + item.height / 2 - position);
      const closestDistance = Math.abs(closest.top + closest.height / 2 - position);
      return distance < closestDistance ? item : closest;
    });
  return {
    unitId: metric.unitId,
    progress: metric.height > 0 ? Math.max(0, Math.min(1, (position - metric.top) / metric.height)) : 0,
  };
}

export function versionScrollTopForAnchor(
  metric: VersionScrollMetric,
  progress: number,
  viewportHeight: number,
  scrollHeight: number,
) {
  const desired = metric.top + metric.height * Math.max(0, Math.min(1, progress)) - viewportHeight / 2;
  return Math.max(0, Math.min(Math.max(0, scrollHeight - viewportHeight), desired));
}

export function versionComparisonBounds(units: Array<{ canvas: { width: number; height: number } } | undefined>) {
  const present = units.filter((unit): unit is { canvas: { width: number; height: number } } => Boolean(unit));
  return {
    width: Math.max(1, ...present.map((unit) => unit.canvas.width)),
    height: Math.max(1, ...present.map((unit) => unit.canvas.height)),
  };
}

export function formatVersionTime(value: string) {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}年${part("month")}月${part("day")}日 ${part("hour")}:${part("minute")}`;
}

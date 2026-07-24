import type { ComicDocument, PageSurface, PresentationUnit, ReadingDirection } from "./lcd/types";

export type PageDisplayMode = "single" | "spread";
export type PageDisplayGroup = { unitIndices: number[]; unitIds: string[]; trueSpread: boolean; virtualTrailingPage?: boolean };

export function orderedUnitSurfaces(unit: PresentationUnit, direction: ReadingDirection): PageSurface[] {
  if (unit.kind !== "spread") return [...unit.surfaces].sort((left, right) => (left.pageNumber ?? 0) - (right.pageNumber ?? 0) || left.geometry.y - right.geometry.y || left.geometry.x - right.geometry.x);
  const order = direction === "rtl" ? ["right", "left"] : ["left", "right"];
  return [...unit.surfaces].sort((left, right) => order.indexOf(left.role) - order.indexOf(right.role));
}

export function physicalPageCount(document: ComicDocument) {
  return document.reading.unitOrder.reduce((count, unitId) => {
    const unit = document.units.find((item) => item.id === unitId);
    return count + (unit?.pageRole === "cover" ? 0 : unit?.surfaces.length ?? 0);
  }, 0);
}

export function pageDisplayGroups(document: ComicDocument, mode: PageDisplayMode): PageDisplayGroup[] {
  const unitById = new Map(document.units.map((unit) => [unit.id, unit]));
  const orderedUnits = document.reading.unitOrder.flatMap((unitId) => {
    const unit = unitById.get(unitId);
    return unit ? [unit] : [];
  });
  const groups: PageDisplayGroup[] = [];
  let openingSingles = 1;
  for (let index = 0; index < orderedUnits.length;) {
    const unit = orderedUnits[index];
    if (unit.pageRole === "cover") {
      groups.push({ unitIndices: [index], unitIds: [unit.id], trueSpread: false });
      index += 1;
      continue;
    }
    if (unit.kind === "spread") {
      groups.push({ unitIndices: [index], unitIds: [unit.id], trueSpread: true });
      openingSingles = 0;
      index += 1;
      continue;
    }
    const next = orderedUnits[index + 1];
    if (mode === "spread" && openingSingles === 0 && unit.kind === "single_page" && next?.kind === "single_page" && next.pageRole !== "cover") {
      groups.push({ unitIndices: [index, index + 1], unitIds: [unit.id, next.id], trueSpread: false });
      index += 2;
      continue;
    }
    const virtualTrailingPage = mode === "spread" && openingSingles === 0 && unit.kind === "single_page" && (next?.kind !== "single_page" || next.pageRole === "cover");
    groups.push({ unitIndices: [index], unitIds: [unit.id], trueSpread: false, ...(virtualTrailingPage ? { virtualTrailingPage: true } : {}) });
    openingSingles = Math.max(0, openingSingles - 1);
    index += 1;
  }
  return groups;
}

export function displayGroupForUnit(groups: PageDisplayGroup[], unitIndex: number) {
  return groups.find((group) => group.unitIndices.includes(unitIndex)) ?? groups[0];
}

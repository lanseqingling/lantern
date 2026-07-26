import assert from "node:assert/strict";
import test from "node:test";
import type { ComicDocument } from "@lantern/shared";
import {
  resolveVersionDisplayUnit,
  resolveVersionScrollAnchor,
  splitTrailingVersionBlanks,
  versionComparisonBounds,
  versionScrollTopForAnchor,
  versionSideItems,
} from "../apps/web/app/lib/version-display";

test("version comparison resolves canvas geometry from reading order after a page is inserted", () => {
  const portrait = { id: "page-before", canvas: { width: 1000, height: 1400 } };
  const spread = { id: "spread", canvas: { width: 2000, height: 1400 } };
  const inserted = { id: "inserted", canvas: { width: 1000, height: 1400 } };
  const document = {
    units: [portrait, spread, inserted],
    reading: { unitOrder: [inserted.id, portrait.id, spread.id] },
  } as ComicDocument;

  assert.equal(resolveVersionDisplayUnit(document, 0)?.id, inserted.id);
  assert.equal(resolveVersionDisplayUnit(document, 1)?.id, portrait.id);
  assert.equal(resolveVersionDisplayUnit(document, 2)?.id, spread.id);
  assert.equal(resolveVersionDisplayUnit(document, 2)?.canvas.width, 2000);
});

test("vertical version comparison keeps each paper in comparison order and fills missing segments with blank slots", () => {
  const differences = [
    { unitId: "segment-a", currentUnitId: "segment-a", targetUnitId: "segment-a" },
    { unitId: "segment-new", targetUnitId: "segment-new" },
    { unitId: "segment-b", currentUnitId: "segment-b", targetUnitId: "segment-b" },
  ];

  assert.deepEqual(
    versionSideItems("current", ["segment-a", "segment-b"], ["segment-a", "segment-new", "segment-b"], differences),
    [
      { kind: "unit", unitId: "segment-a", comparisonId: "segment-a" },
      { kind: "blank", comparisonId: "segment-new", referenceUnitId: "segment-new" },
      { kind: "unit", unitId: "segment-b", comparisonId: "segment-b" },
    ],
  );
  assert.deepEqual(
    versionSideItems("target", ["segment-a", "segment-new", "segment-b"], ["segment-a", "segment-b"], differences),
    [
      { kind: "unit", unitId: "segment-a", comparisonId: "segment-a" },
      { kind: "unit", unitId: "segment-new", comparisonId: "segment-new" },
      { kind: "unit", unitId: "segment-b", comparisonId: "segment-b" },
    ],
  );
});

test("vertical version comparison keeps middle blanks in paper and moves only trailing blanks outside it", () => {
  const middleBlank = { kind: "blank", comparisonId: "segment-middle", referenceUnitId: "segment-middle" } as const;
  const trailingBlank = { kind: "blank", comparisonId: "segment-tail", referenceUnitId: "segment-tail" } as const;
  const segmentA = { kind: "unit", unitId: "segment-a", comparisonId: "segment-a" } as const;
  const segmentB = { kind: "unit", unitId: "segment-b", comparisonId: "segment-b" } as const;

  assert.deepEqual(splitTrailingVersionBlanks([segmentA, middleBlank, segmentB]), {
    paperItems: [segmentA, middleBlank, segmentB],
    trailingBlankItems: [],
  });
  assert.deepEqual(splitTrailingVersionBlanks([segmentA, trailingBlank]), {
    paperItems: [segmentA],
    trailingBlankItems: [trailingBlank],
  });
});

test("vertical version scrolling follows the same local progress through real and blank segments", () => {
  const sourceMetrics = [
    { unitId: "segment-a", top: 0, height: 400 },
    { unitId: "segment-b", top: 400, height: 400 },
  ];
  const anchor = resolveVersionScrollAnchor(sourceMetrics, 600);
  assert.deepEqual(anchor, { unitId: "segment-b", progress: .5 });

  const targetMetric = { unitId: "segment-b", top: 800, height: 400 };
  assert.equal(versionScrollTopForAnchor(targetMetric, anchor!.progress, 400, 1200), 800);
  assert.equal(versionScrollTopForAnchor({ unitId: "segment-new", top: 400, height: 400 }, .5, 400, 1200), 400);
});

test("page comparison preserves relative paper dimensions with one shared fitting plane", () => {
  assert.deepEqual(versionComparisonBounds([
    { canvas: { width: 640, height: 960 } },
    { canvas: { width: 640, height: 1920 } },
  ]), { width: 640, height: 1920 });
});

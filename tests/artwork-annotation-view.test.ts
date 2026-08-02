import assert from "node:assert/strict";
import test from "node:test";
import type { ArtworkAnnotation, ArtworkAnnotationAnchor, ComicDocument } from "@lantern/shared";
import {
  artworkAnnotationPoint,
  artworkAnnotationSelection,
  createArtworkAnnotationAnchor,
  createArtworkAnnotationObjectAnchor,
  shouldShowArtworkAnnotationMarker,
} from "../apps/web/app/lib/artwork-annotation-view";

function documentFixture(): ComicDocument {
  return {
    protocolVersion: "lcd-0.4",
    comicId: "comic-1",
    chapterId: "chapter-1",
    format: "page",
    reading: { direction: "ltr", viewer: "paged", unitOrder: ["page-1"], showPageNumber: true },
    units: [{
      id: "page-1",
      kind: "single_page",
      pageRole: "story",
      canvas: { width: 720, height: 1080, background: { color: "#ffffff" } },
      surfaces: [{ id: "surface-1", role: "single", geometry: { x: 0, y: 0, width: 720, height: 1080 }, pageNumber: 1 }],
      frames: [],
      overlayLayers: [],
      readingSequence: [],
      layoutPolicy: { frameOverlap: "forbid", defaultOverflow: "clip" },
    }],
    resources: [],
    dialogues: [],
  };
}

function annotationWith(anchor: ArtworkAnnotationAnchor): ArtworkAnnotation {
  const reference = {
    id: "reference-1",
    sortIndex: 0,
    anchor,
    resolvedUnitPoint: anchor.kind === "point" ? anchor.unitPoint : anchor.fallbackUnitPoint,
    targetState: "unchanged" as const,
    pageLabel: "Page 01",
    targetLabel: anchor.kind === "object" ? "画格 01" : "Page 01",
  };
  return {
    id: "annotation-1",
    reference: "lantern://annotations/annotation-1",
    projectId: "loading-project",
    status: "open",
    version: 1,
    references: [reference],
    attachments: [],
    createdWorkingRevision: 1,
    currentWorkingRevision: 1,
    messages: [],
    work: [],
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

test("paper annotations store normalized unit coordinates without inventing an object target", () => {
  const document = documentFixture();
  const anchor = createArtworkAnnotationAnchor(document, "page-1", { x: 180, y: 810 });

  assert.deepEqual(anchor, {
    kind: "point",
    unitId: "page-1",
    surfaceId: "surface-1",
    unitPoint: { x: 0.25, y: 0.75 },
  });
  assert.equal(artworkAnnotationSelection(annotationWith(anchor).references[0]!), undefined);
});

test("object annotations preserve their local point and follow current object geometry", () => {
  const document = documentFixture();
  const unit = document.units[0]!;
  unit.frames.push({
    id: "frame-1",
    geometry: { x: 100, y: 200, width: 200, height: 300 },
  } as typeof unit.frames[number]);
  const anchor = createArtworkAnnotationObjectAnchor(document, {
    type: "comic_frame",
    id: "frame-1",
    pageId: unit.id,
    label: "画格 01",
  });
  assert.equal(anchor.kind, "object");
  if (anchor.kind !== "object") throw new Error("expected object annotation");
  assert.deepEqual(anchor.localPoint, { x: 0.5, y: 0.5 });

  unit.frames[0]!.geometry = { x: 200, y: 100, width: 400, height: 200 };
  const annotation = annotationWith(anchor);
  assert.deepEqual(artworkAnnotationPoint(document, annotation.references[0]!), {
    x: 400 / 720,
    y: 200 / 1080,
  });
  assert.deepEqual(artworkAnnotationSelection(annotation.references[0]!), {
    type: "comic_frame",
    id: "frame-1",
    pageId: "page-1",
    label: "画格 01",
  });
});

test("every rendered element kind, including page effects, can own an annotation anchor", () => {
  const document = documentFixture();
  const unit = document.units[0]!;
  unit.overlayLayers.push({
    id: "effect-layer-1",
    name: "纸面效果",
    zIndex: 3,
    visible: true,
    anchor: { type: "unit" },
    purpose: "page_effect",
    elements: [{
      id: "effect-1",
      kind: "effect",
      effectType: "focus",
      transform: { x: 120, y: 180, width: 240, height: 360 },
      opacity: 0.7,
    }],
  });

  const anchor = createArtworkAnnotationObjectAnchor(document, {
    type: "effect",
    id: "effect-1",
    pageId: unit.id,
    label: "效果 01",
  });
  assert.equal(anchor.kind, "object");
  if (anchor.kind !== "object") throw new Error("expected effect annotation");
  assert.equal(anchor.objectType, "effect");
  assert.deepEqual(anchor.localPoint, { x: 0.5, y: 0.5 });
  assert.deepEqual(artworkAnnotationSelection(annotationWith(anchor).references[0]!), {
    type: "effect",
    id: "effect-1",
    pageId: "page-1",
    label: "画格 01",
  });
});

test("point markers only appear during brief focus while object markers follow the annotation panel", () => {
  const point = annotationWith(createArtworkAnnotationAnchor(documentFixture(), "page-1", { x: 180, y: 810 }));
  const pointReference = point.references[0]!;
  assert.equal(shouldShowArtworkAnnotationMarker(point.status, pointReference, { annotationPanelActive: true, focusedReferenceId: null }), false);
  assert.equal(shouldShowArtworkAnnotationMarker(point.status, pointReference, { annotationPanelActive: false, focusedReferenceId: pointReference.id }), true);

  const object = annotationWith({
    kind: "object",
    unitId: "page-1",
    surfaceId: "surface-1",
    objectType: "comic_frame",
    objectId: "frame-1",
    localPoint: { x: 0.5, y: 0.5 },
    fallbackUnitPoint: { x: 0.25, y: 0.25 },
  });
  const objectReference = object.references[0]!;
  assert.equal(shouldShowArtworkAnnotationMarker(object.status, objectReference, { annotationPanelActive: false, focusedReferenceId: objectReference.id }), false);
  assert.equal(shouldShowArtworkAnnotationMarker(object.status, objectReference, { annotationPanelActive: true, focusedReferenceId: null }), true);
  assert.equal(shouldShowArtworkAnnotationMarker("dismissed", objectReference, { annotationPanelActive: true, focusedReferenceId: objectReference.id }), false);
});

test("annotations may remain unbound or mix several ordered references", () => {
  const document = documentFixture();
  const first = createArtworkAnnotationAnchor(document, "page-1", { x: 72, y: 108 });
  const second = createArtworkAnnotationAnchor(document, "page-1", { x: 648, y: 972 });
  const annotation = annotationWith(first);
  annotation.references.push({
    ...annotation.references[0]!,
    id: "reference-2",
    sortIndex: 1,
    anchor: second,
    resolvedUnitPoint: second.kind === "point" ? second.unitPoint : second.fallbackUnitPoint,
  });
  assert.deepEqual(annotation.references.map((reference) => reference.sortIndex), [0, 1]);
  assert.deepEqual(artworkAnnotationPoint(document, annotation.references[1]!), { x: 0.9, y: 0.9 });

  const unbound = { ...annotation, references: [] };
  assert.equal(unbound.references.length, 0);
});

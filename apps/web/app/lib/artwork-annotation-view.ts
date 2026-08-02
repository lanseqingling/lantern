import {
  projectComicRenderScene,
  type ArtworkAnnotationAnchor,
  type ArtworkAnnotationReference,
  type ArtworkAnnotationStatus,
  type ComicDocument,
  type Geometry,
} from "@lantern/shared";

export type ArtworkAnnotationSelection = {
  type: "none" | "presentation_unit" | "comic_frame" | "image" | "text" | "speech_balloon" | "effect" | "reference_card" | "storyboard_beat";
  id?: string;
  pageId?: string;
  label: string;
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

function objectGeometry(document: ComicDocument, unitId: string, target: ArtworkAnnotationSelection): Geometry | undefined {
  const unit = document.units.find((candidate) => candidate.id === unitId);
  if (!unit) return undefined;
  if (target.type === "presentation_unit") return { x: 0, y: 0, width: unit.canvas.width, height: unit.canvas.height };
  if (target.type === "comic_frame") return unit.frames.find((frame) => frame.id === target.id)?.geometry;
  if (target.type === "image" || target.type === "speech_balloon" || target.type === "text" || target.type === "effect") {
    return projectComicRenderScene(document, unit).elements.find((node) => node.element.id === target.id)?.geometry;
  }
  return undefined;
}

function anchorObjectType(target: ArtworkAnnotationSelection) {
  return target.type === "presentation_unit" || target.type === "comic_frame" || target.type === "image"
    || target.type === "speech_balloon" || target.type === "text" || target.type === "effect" ? target.type : undefined;
}

export function createArtworkAnnotationAnchor(
  document: ComicDocument,
  unitId: string,
  position: { x: number; y: number },
): ArtworkAnnotationAnchor {
  const unit = document.units.find((candidate) => candidate.id === unitId);
  if (!unit) throw new Error("ANNOTATION_UNIT_MISSING");
  const unitPoint = { x: clamp01(position.x / unit.canvas.width), y: clamp01(position.y / unit.canvas.height) };
  const surfaceId = unit.surfaces.find((surface) => position.x >= surface.geometry.x
    && position.x <= surface.geometry.x + surface.geometry.width
    && position.y >= surface.geometry.y
    && position.y <= surface.geometry.y + surface.geometry.height)?.id;
  return { kind: "point", unitId, ...(surfaceId ? { surfaceId } : {}), unitPoint };
}

export function createArtworkAnnotationObjectAnchor(
  document: ComicDocument,
  target: ArtworkAnnotationSelection,
): ArtworkAnnotationAnchor {
  if (!target.pageId) throw new Error("ANNOTATION_UNIT_MISSING");
  const unit = document.units.find((candidate) => candidate.id === target.pageId);
  if (!unit) throw new Error("ANNOTATION_UNIT_MISSING");
  const objectType = anchorObjectType(target);
  const geometry = objectGeometry(document, target.pageId, target);
  if (!target.id || !objectType || !geometry) throw new Error("ANNOTATION_TARGET_MISSING");
  const position = { x: geometry.x + geometry.width / 2, y: geometry.y + geometry.height / 2 };
  const surfaceId = unit.surfaces.find((surface) => position.x >= surface.geometry.x
    && position.x <= surface.geometry.x + surface.geometry.width
    && position.y >= surface.geometry.y
    && position.y <= surface.geometry.y + surface.geometry.height)?.id;
  return {
    kind: "object",
    unitId: target.pageId,
    ...(surfaceId ? { surfaceId } : {}),
    objectType,
    objectId: target.id,
    localPoint: { x: 0.5, y: 0.5 },
    fallbackUnitPoint: { x: clamp01(position.x / unit.canvas.width), y: clamp01(position.y / unit.canvas.height) },
  };
}

export function artworkAnnotationPoint(document: ComicDocument, reference: ArtworkAnnotationReference) {
  const unit = document.units.find((candidate) => candidate.id === reference.anchor.unitId);
  if (!unit) return reference.resolvedUnitPoint;
  if (reference.anchor.kind === "point") return reference.anchor.unitPoint;
  const geometry = objectGeometry(document, unit.id, {
    type: reference.anchor.objectType,
    id: reference.anchor.objectId,
    pageId: unit.id,
    label: reference.targetLabel,
  });
  if (!geometry) return reference.anchor.fallbackUnitPoint;
  return {
    x: clamp01((geometry.x + geometry.width * reference.anchor.localPoint.x) / unit.canvas.width),
    y: clamp01((geometry.y + geometry.height * reference.anchor.localPoint.y) / unit.canvas.height),
  };
}

export function artworkAnnotationSelection(reference: ArtworkAnnotationReference): ArtworkAnnotationSelection | undefined {
  if (reference.anchor.kind !== "object") return undefined;
  return {
    type: reference.anchor.objectType,
    id: reference.anchor.objectId,
    pageId: reference.anchor.unitId,
    label: reference.targetLabel,
  };
}

export function shouldShowArtworkAnnotationMarker(
  status: ArtworkAnnotationStatus,
  reference: ArtworkAnnotationReference,
  options: { annotationPanelActive: boolean; focusedReferenceId: string | null },
) {
  if (status === "dismissed") return false;
  if (reference.anchor.kind === "point") return options.focusedReferenceId === reference.id;
  return options.annotationPanelActive;
}

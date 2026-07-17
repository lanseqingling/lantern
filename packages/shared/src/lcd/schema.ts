import { z } from "zod";
import type { ComicDocument } from "./types";

export const rectSchema = z.object({ x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive() });
export const geometrySchema = rectSchema.extend({ rotate: z.number().optional() });
export const normalizedRectSchema = rectSchema.refine((rect) => rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= 1 && rect.y + rect.height <= 1, "normalized rectangle must stay inside 0..1");
export const localTransformSchema = geometrySchema;
const overflowSchema = z.enum(["inherit", "clip", "visible"]);
const visibilitySchema = { visible: z.boolean().optional(), name: z.string().optional() };

const artElementSchema = z.object({
  id: z.string().min(1), kind: z.literal("image"), assetId: z.string().min(1), assetVersionId: z.string().min(1),
  transform: localTransformSchema, crop: normalizedRectSchema, opacity: z.number().min(0).max(1).optional(),
  blendMode: z.enum(["normal", "multiply", "screen"]).optional(), overflow: overflowSchema.optional(), ...visibilitySchema,
});
const textStyleSchema = z.object({
  fontFamily: z.string(), fontSize: z.number().positive(), fontWeight: z.number().optional(), color: z.string(),
  align: z.enum(["left", "center", "right"]).optional(), writingMode: z.enum(["horizontal", "vertical"]).optional(),
});
export const visualAssetReferenceSchema = z.strictObject({
  assetId: z.string().min(1),
  assetVersionId: z.string().min(1),
});
const textElementSchema = z.object({
  id: z.string().min(1), kind: z.literal("text"), transform: localTransformSchema, content: z.string(),
  role: z.enum(["caption", "narration", "sfx"]), style: textStyleSchema,
  appearance: visualAssetReferenceSchema.optional(), ...visibilitySchema,
});
const balloonStyleSchema = z.object({
  fontFamily: z.string(), fontSize: z.number().positive(), textColor: z.string(), fill: z.string(), stroke: z.string(),
  strokeWidth: z.number().nonnegative(), writingMode: z.enum(["horizontal", "vertical"]).optional(),
});
export const balloonElementSchema = z.object({
  id: z.string().min(1), kind: z.literal("balloon"), dialogueId: z.string().min(1), transform: localTransformSchema,
  tailTarget: z.object({ x: z.number(), y: z.number() }).optional(),
  shape: z.enum(["normal", "thought", "caption_box"]), style: balloonStyleSchema,
  appearance: visualAssetReferenceSchema.optional(), overflow: overflowSchema.optional(), ...visibilitySchema,
});
const effectElementSchema = z.object({
  id: z.string().min(1), kind: z.literal("effect"), effectType: z.enum(["speed_lines", "tone", "focus", "sfx_art", "custom"]),
  transform: localTransformSchema, assetId: z.string().optional(), assetVersionId: z.string().optional(), opacity: z.number().min(0).max(1).optional(), ...visibilitySchema,
});
export const frameElementSchema = z.discriminatedUnion("kind", [artElementSchema, textElementSchema, balloonElementSchema, effectElementSchema]);
const layerBase = {
  id: z.string().min(1), name: z.string(), zIndex: z.number().int(), visible: z.boolean(), locked: z.boolean().optional(), overflow: overflowSchema,
};
export const frameLayerSchema = z.discriminatedUnion("kind", [
  z.object({ ...layerBase, kind: z.literal("art"), elements: z.array(artElementSchema) }),
  z.object({ ...layerBase, kind: z.literal("text"), elements: z.array(z.union([textElementSchema, balloonElementSchema])) }),
  z.object({ ...layerBase, kind: z.literal("effect"), elements: z.array(effectElementSchema) }),
]);
export const frameBorderSchema = z.object({ color: z.string(), width: z.number().nonnegative(), style: z.enum(["solid", "none", "rough"]) });
export const frameShapeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("rect"), radius: z.number().nonnegative().optional() }),
  z.object({ kind: z.literal("polygon"), points: z.array(z.object({ x: z.number(), y: z.number() })).min(3) }),
  z.object({ kind: z.literal("ellipse") }),
]);
export const frameMaskSchema = z.object({ mode: z.enum(["clip", "visible", "bleed"]) });

export const frameSchema = z.object({
  id: z.string().min(1), geometry: geometrySchema, zIndex: z.number().int(),
  surfaceScope: z.enum(["surface", "unit"]).optional(),
  storyRefs: z.array(z.object({ storyboardBeatId: z.string().min(1), storyboardBeatVersionId: z.string().min(1), role: z.enum(["primary", "continuity"]) })),
  border: frameBorderSchema,
  shape: frameShapeSchema,
  mask: frameMaskSchema, layers: z.array(frameLayerSchema),
  constraints: z.array(z.enum(["stay_on_surface", "preserve_aspect", "locked"])).optional(), ...visibilitySchema,
});
const overlayElementSchema = frameElementSchema;
export const overlayLayerSchema = z.object({
  id: z.string().min(1), name: z.string(), zIndex: z.number().int(), visible: z.boolean(), locked: z.boolean().optional(),
  anchor: z.discriminatedUnion("type", [z.object({ type: z.literal("unit") }), z.object({ type: z.literal("frame"), frameId: z.string().min(1) })]),
  surfaceId: z.string().min(1).optional(), purpose: z.enum(["breakout", "cross_frame", "cross_page", "cross_segment", "page_content", "page_effect", "decoration"]), elements: z.array(overlayElementSchema),
});
export const surfaceSchema = z.object({
  id: z.string().min(1), name: z.string().min(1).max(80).optional(), role: z.enum(["single", "left", "right", "segment"]), geometry: rectSchema,
  trim: z.object({ top: z.number(), right: z.number(), bottom: z.number(), left: z.number() }).optional(),
  bleed: z.object({ top: z.number(), right: z.number(), bottom: z.number(), left: z.number() }).optional(), pageNumber: z.number().int().positive().optional(),
});
export const presentationUnitSchema = z.object({
  id: z.string().min(1), name: z.string().min(1).max(80).optional(), kind: z.enum(["single_page", "spread", "vertical_segment", "four_panel_unit"]),
  canvas: z.object({ width: z.number().positive(), height: z.number().positive(), background: z.object({ color: z.string() }) }),
  surfaces: z.array(surfaceSchema).min(1), frames: z.array(frameSchema), overlayLayers: z.array(overlayLayerSchema),
  readingSequence: z.array(z.object({ frameId: z.string().min(1), textOrder: z.array(z.string().min(1)).optional() })),
  layoutPolicy: z.object({ frameOverlap: z.enum(["forbid", "allow"]), gutter: z.number().nonnegative().optional(), defaultOverflow: z.enum(["clip", "visible"]) }),
});

export const resourceBindingSchema = z.object({
  assetId: z.string().min(1), assetVersionId: z.string().min(1), kind: z.enum(["image", "font", "texture"]), mediaType: z.string().min(1),
  width: z.number().positive().optional(), height: z.number().positive().optional(), checksum: z.string().optional(),
});

export const comicDocumentSchema = z.object({
  protocolVersion: z.literal("lcd-0.4"), comicId: z.string().min(1), chapterId: z.string().min(1), format: z.enum(["page", "vertical", "four_panel"]),
  reading: z.object({ direction: z.enum(["ltr", "rtl", "ttb"]), viewer: z.enum(["paged", "spread", "scroll", "unit"]), unitOrder: z.array(z.string().min(1)), gap: z.number().nonnegative().optional(), showPageNumber: z.boolean().optional() }),
  units: z.array(presentationUnitSchema),
  resources: z.array(resourceBindingSchema),
  dialogues: z.array(z.object({ id: z.string().min(1), storyboardBeatId: z.string().optional(), storyboardBeatVersionId: z.string().optional(), speakerAssetId: z.string().optional(), content: z.string() })),
});

const overlaps = (a: z.infer<typeof geometrySchema>, b: z.infer<typeof geometrySchema>) =>
  Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 0.5 && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 0.5;
const insideCanvas = (geometry: z.infer<typeof rectSchema>, canvas: { width: number; height: number }) =>
  geometry.x >= 0 && geometry.y >= 0 && geometry.x + geometry.width <= canvas.width && geometry.y + geometry.height <= canvas.height;

export function validateComicDocument(input: unknown): ComicDocument {
  const document = comicDocumentSchema.parse(input) as ComicDocument;
  const globalIds = new Set<string>();
  const resourceByKey = new Map(document.resources.map((resource) => [`${resource.assetId}:${resource.assetVersionId}`, resource]));
  const resourceKeys = new Set(resourceByKey.keys());
  const dialogueIds = new Set(document.dialogues.map((dialogue) => dialogue.id));
  const unitIds = document.units.map((unit) => unit.id);
  if (new Set(document.reading.unitOrder).size !== unitIds.length || document.reading.unitOrder.some((id) => !unitIds.includes(id)) || unitIds.some((id) => !document.reading.unitOrder.includes(id))) {
    throw new Error("reading.unitOrder must contain every presentation unit exactly once");
  }
  const claimId = (id: string) => { if (globalIds.has(id)) throw new Error(`duplicate LCD object id: ${id}`); globalIds.add(id); };
  const assertAppearanceResource = (element: { id: string; appearance?: { assetId: string; assetVersionId: string } }) => {
    if (!element.appearance) return;
    const resource = resourceByKey.get(`${element.appearance.assetId}:${element.appearance.assetVersionId}`);
    if (!resource) throw new Error(`${element.id} appearance references an undeclared asset version`);
    if (resource.kind !== "image" || !resource.mediaType.startsWith("image/")) throw new Error(`${element.id} appearance must reference an image resource`);
  };
  document.resources.forEach((resource) => claimId(`resource:${resource.assetVersionId}`));
  document.dialogues.forEach((dialogue) => claimId(`dialogue:${dialogue.id}`));
  for (const unit of document.units) {
    claimId(unit.id);
    unit.surfaces.forEach((surface) => {
      claimId(surface.id);
      if (!insideCanvas(surface.geometry, unit.canvas)) throw new Error(`${surface.id} must stay inside unit canvas`);
    });
    if (unit.kind === "spread" && (unit.surfaces.length !== 2 || unit.surfaces.filter((surface) => surface.role === "left").length !== 1 || unit.surfaces.filter((surface) => surface.role === "right").length !== 1)) throw new Error(`${unit.id} spread must have exactly one left and one right surface`);
    if (unit.kind === "vertical_segment" && unit.surfaces.some((surface) => surface.role !== "segment")) throw new Error(`${unit.id} vertical segment must contain only segment surfaces`);
    if (unit.kind !== "spread" && unit.kind !== "vertical_segment" && unit.surfaces.length !== 1) throw new Error(`${unit.id} must have exactly one surface`);
    const frameIds = new Set(unit.frames.map((frame) => frame.id));
    const readingIds = unit.readingSequence.map((entry) => entry.frameId);
    if (new Set(readingIds).size !== readingIds.length || readingIds.some((id) => !frameIds.has(id)) || [...frameIds].some((id) => !readingIds.includes(id))) throw new Error(`${unit.id} readingSequence must contain every frame exactly once`);
    unit.frames.forEach((frame, frameIndex) => {
      claimId(frame.id);
      if (!insideCanvas(frame.geometry, unit.canvas)) throw new Error(`${frame.id} must stay inside unit canvas`);
      if (frame.surfaceScope === "unit" && unit.kind !== "spread") throw new Error(`${frame.id} unit-scoped frame requires a spread`);
      if (frame.surfaceScope !== "unit" && !unit.surfaces.some((surface) => insideCanvas({ x: frame.geometry.x - surface.geometry.x, y: frame.geometry.y - surface.geometry.y, width: frame.geometry.width, height: frame.geometry.height }, { width: surface.geometry.width, height: surface.geometry.height }))) throw new Error(`${frame.id} must stay inside one surface`);
      if (frame.storyRefs.filter((ref) => ref.role === "primary").length > 1) throw new Error(`${frame.id} may have at most one primary storyboard beat`);
      if (unit.layoutPolicy.frameOverlap === "forbid") unit.frames.slice(frameIndex + 1).forEach((other) => { if (overlaps(frame.geometry, other.geometry)) throw new Error(`${frame.id} overlaps ${other.id}`); });
      frame.layers.forEach((layer) => {
        claimId(layer.id);
        layer.elements.forEach((element) => {
          claimId(element.id);
          if (element.kind === "image" && !resourceKeys.has(`${element.assetId}:${element.assetVersionId}`)) throw new Error(`${element.id} references an undeclared asset version`);
          if (element.kind === "text" || element.kind === "balloon") assertAppearanceResource(element);
          if (element.kind === "balloon" && !dialogueIds.has(element.dialogueId)) throw new Error(`${element.id} references missing dialogue ${element.dialogueId}`);
        });
      });
    });
    unit.overlayLayers.forEach((layer) => {
      claimId(layer.id);
      if (layer.anchor.type === "frame" && !frameIds.has(layer.anchor.frameId)) throw new Error(`${layer.id} references missing anchor frame`);
      if (layer.surfaceId && !unit.surfaces.some((surface) => surface.id === layer.surfaceId)) throw new Error(`${layer.id} references missing surface ${layer.surfaceId}`);
      if (layer.surfaceId && layer.anchor.type !== "unit") throw new Error(`${layer.id} surface constraint requires a unit anchor`);
      if (layer.surfaceId && (layer.purpose === "cross_page" || layer.purpose === "cross_segment")) throw new Error(`${layer.id} cross-surface layer cannot be constrained to one surface`);
      if (layer.purpose === "cross_page" && unit.kind !== "spread") throw new Error(`${layer.id} cross-page layer requires a spread`);
      if (layer.purpose === "cross_segment" && (unit.kind !== "vertical_segment" || unit.surfaces.length < 2)) throw new Error(`${layer.id} cross-segment layer requires a compound vertical segment`);
      const constrainedSurface = layer.surfaceId ? unit.surfaces.find((surface) => surface.id === layer.surfaceId) : undefined;
      layer.elements.forEach((element) => {
        claimId(element.id);
        if (constrainedSurface && !insideCanvas({ x: element.transform.x - constrainedSurface.geometry.x, y: element.transform.y - constrainedSurface.geometry.y, width: element.transform.width, height: element.transform.height }, { width: constrainedSurface.geometry.width, height: constrainedSurface.geometry.height })) throw new Error(`${element.id} must stay inside constrained surface ${constrainedSurface.id}`);
        if (element.kind === "image" && !resourceKeys.has(`${element.assetId}:${element.assetVersionId}`)) throw new Error(`${element.id} references an undeclared asset version`);
        if (element.kind === "text" || element.kind === "balloon") assertAppearanceResource(element);
        if (element.kind === "balloon" && !dialogueIds.has(element.dialogueId)) throw new Error(`${element.id} references missing dialogue ${element.dialogueId}`);
      });
    });
  }
  return document;
}

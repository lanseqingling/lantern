import sharp from "sharp";
import { z } from "zod";
import { prisma } from "@lantern/server/db";
import { AppError } from "@lantern/server/errors";
import { renderPreviewPageGroupPng } from "@lantern/server/export-renderer";
import { projectComicRenderScene, validateComicDocument } from "@lantern/shared";

const geometrySchema = z.strictObject({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().positive(),
  height: z.number().positive(),
  rotate: z.number().finite().optional(),
});

export const compositionFrameSchema = z.object({
  id: z.string().min(1),
  handle: z.string().min(1).optional(),
  name: z.string().optional(),
  geometry: geometrySchema,
  zIndex: z.number().int(),
  readingOrder: z.number().int().positive().optional(),
  surfaceScope: z.enum(["surface", "unit"]),
  shape: z.unknown(),
  border: z.unknown(),
  mask: z.unknown(),
  bleedEdges: z.unknown().optional(),
  constraints: z.array(z.string()).optional(),
  storyRefs: z.array(z.unknown()),
});

export const compositionLayerSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  source: z.enum(["frame", "overlay"]),
  frameId: z.string().optional(),
  kind: z.string().optional(),
  purpose: z.string().optional(),
  anchor: z.unknown().optional(),
  surfaceId: z.string().optional(),
  zIndex: z.number().int(),
  visible: z.boolean(),
  locked: z.boolean(),
  overflow: z.string().optional(),
});

export const compositionElementSchema = z.object({
  id: z.string().min(1),
  handle: z.string().min(1).optional(),
  name: z.string().optional(),
  kind: z.enum(["image", "text", "balloon", "effect"]),
  source: z.enum(["frame", "overlay"]),
  frameId: z.string().optional(),
  layerId: z.string().min(1),
  transform: geometrySchema,
  coordinateSpace: z.enum(["frame_local", "unit"]),
  geometry: geometrySchema,
  zIndex: z.number().int(),
  clipFrameId: z.string().optional(),
  overlayPurpose: z.string().optional(),
  surfaceId: z.string().optional(),
  assetId: z.string().optional(),
  assetVersionId: z.string().optional(),
  appearanceAssetVersionId: z.string().optional(),
  dialogueId: z.string().optional(),
  dialogueText: z.string().optional(),
  text: z.string().optional(),
  role: z.string().optional(),
  shape: z.string().optional(),
  effectType: z.string().optional(),
  crop: z.unknown().optional(),
  style: z.unknown().optional(),
  tailTarget: z.unknown().optional(),
  overflow: z.string().optional(),
  opacity: z.number().optional(),
  blendMode: z.string().optional(),
});

export const compositionUnitSchema = z.object({
  id: z.string().min(1),
  handle: z.string().min(1).optional(),
  name: z.string().optional(),
  kind: z.string().min(1),
  canvas: z.object({
    width: z.number().positive(),
    height: z.number().positive(),
    background: z.unknown(),
  }),
  surfaces: z.array(z.unknown()),
  readingSequence: z.array(z.unknown()),
  frames: z.array(compositionFrameSchema),
  layers: z.array(compositionLayerSchema),
  elements: z.array(compositionElementSchema),
});

export const compositionStructureSchema = z.strictObject({
  units: z.array(compositionUnitSchema).min(1).max(2),
  arrangement: z.enum(["single", "side_by_side"]),
});

export const compositionObservationSchema = z.strictObject({
  type: z.literal("composition_evidence"),
  projectId: z.string().min(1),
  baseRevision: z.number().int().positive(),
  unitIds: z.array(z.string().min(1)).min(1).max(2),
  content: z.string().min(1).optional(),
  image: z.strictObject({
    mimeType: z.literal("image/png"),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  structure: compositionStructureSchema,
});

export type CompositionStructure = z.infer<typeof compositionStructureSchema>;
export type CompositionElement = z.infer<typeof compositionElementSchema>;

function elementProjection(node: ReturnType<typeof projectComicRenderScene>["elements"][number]) {
  const element = node.element;
  const base = {
    id: element.id,
    ...(element.name ? { name: element.name } : {}),
    kind: element.kind,
    source: node.source,
    ...(node.frame ? { frameId: node.frame.id } : {}),
    layerId: node.layerId,
    transform: element.transform,
    coordinateSpace: node.frame ? "frame_local" as const : "unit" as const,
    geometry: node.geometry,
    zIndex: node.zIndex,
    ...(node.clipFrame ? { clipFrameId: node.clipFrame.id } : {}),
    ...(node.overlayPurpose ? { overlayPurpose: node.overlayPurpose } : {}),
    ...(node.surfaceId ? { surfaceId: node.surfaceId } : {}),
  };
  if (element.kind === "image") {
    return { ...base, assetId: element.assetId, assetVersionId: element.assetVersionId, crop: element.crop, opacity: element.opacity, blendMode: element.blendMode, overflow: element.overflow };
  }
  if (element.kind === "balloon") {
    return { ...base, dialogueId: element.dialogueId, dialogueText: node.dialogueText ?? "", shape: element.shape, style: element.style, tailTarget: element.tailTarget, overflow: element.overflow, appearanceAssetVersionId: element.appearance?.assetVersionId };
  }
  if (element.kind === "text") {
    return { ...base, text: element.content, role: element.role, style: element.style, appearanceAssetVersionId: element.appearance?.assetVersionId };
  }
  return { ...base, effectType: element.effectType, assetId: element.assetId, assetVersionId: element.assetVersionId, opacity: element.opacity };
}

export async function loadWorkingCompositionObservation(input: {
  ownerUserId: string;
  projectId: string;
  unitIds: string[];
  expectedRevision?: number;
}) {
  const requestedUnitIds = [...new Set(input.unitIds)];
  if (!requestedUnitIds.length || requestedUnitIds.length > 2) {
    throw new AppError("validation", "一次只能观察一个或两个展示单元。", 400);
  }
  const working = await prisma.workingRevision.findFirst({
    where: {
      projectId: input.projectId,
      project: { ownerUserId: input.ownerUserId, chapter: { archivedAt: null, comic: { archivedAt: null } } },
    },
    orderBy: { revision: "desc" },
    select: { revision: true, document: true },
  });
  if (!working) throw new AppError("not_found", "工作稿不存在。", 404);
  if (input.expectedRevision !== undefined && working.revision !== input.expectedRevision) {
    throw new AppError("context_stale", "工作稿已经变化，请重新读取 Lantern 上下文。", 409, { currentRevision: working.revision });
  }
  const document = validateComicDocument(working.document);
  const unitById = new Map(document.units.map((unit) => [unit.id, unit]));
  const units = requestedUnitIds
    .map((unitId) => unitById.get(unitId))
    .filter((unit): unit is NonNullable<typeof unit> => Boolean(unit));
  if (units.length !== requestedUnitIds.length) throw new AppError("not_found", "目标页面不存在或不属于当前工作稿。", 404);
  const unitIndexes = units.map((unit) => document.reading.unitOrder.indexOf(unit.id));
  if (units.length === 2 && Math.abs(unitIndexes[0]! - unitIndexes[1]!) !== 1) {
    throw new AppError("validation", "最终画面一次只能组合相邻的两个展示单元。", 400);
  }
  units.sort((left, right) => document.reading.unitOrder.indexOf(left.id) - document.reading.unitOrder.indexOf(right.id));
  const structure = compositionStructureSchema.parse({
    arrangement: units.length === 1 ? "single" : "side_by_side",
    units: units.map((unit) => {
      const scene = projectComicRenderScene(document, unit);
      const readingOrder = new Map(unit.readingSequence.map((entry, index) => [entry.frameId, index + 1]));
      return {
        id: unit.id,
        name: unit.name,
        kind: unit.kind,
        canvas: unit.canvas,
        surfaces: unit.surfaces,
        readingSequence: unit.readingSequence,
        frames: scene.frames.map(({ frame }) => ({
          id: frame.id,
          name: frame.name,
          geometry: frame.geometry,
          zIndex: frame.zIndex,
          readingOrder: readingOrder.get(frame.id),
          surfaceScope: frame.surfaceScope ?? "surface",
          shape: frame.shape,
          border: frame.border,
          mask: frame.mask,
          bleedEdges: frame.bleedEdges,
          constraints: frame.constraints,
          storyRefs: frame.storyRefs,
        })),
        layers: [
          ...unit.frames.flatMap((frame) => frame.layers.map((layer) => ({
            id: layer.id,
            name: layer.name,
            source: "frame" as const,
            frameId: frame.id,
            kind: layer.kind,
            zIndex: layer.zIndex,
            visible: layer.visible,
            locked: layer.locked ?? false,
            overflow: layer.overflow,
          }))),
          ...unit.overlayLayers.map((layer) => ({
            id: layer.id,
            name: layer.name,
            source: "overlay" as const,
            purpose: layer.purpose,
            anchor: layer.anchor,
            surfaceId: layer.surfaceId,
            zIndex: layer.zIndex,
            visible: layer.visible,
            locked: layer.locked ?? false,
          })),
        ],
        elements: scene.elements.map(elementProjection),
      };
    }),
  });
  const rendered = await renderPreviewPageGroupPng(document, units);
  const imageBytes = await sharp(rendered, { limitInputPixels: false })
    .resize({ width: 2048, height: 4096, fit: "inside", withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toBuffer();
  const metadata = await sharp(imageBytes).metadata();
  return {
    projectId: input.projectId,
    baseRevision: working.revision,
    structure,
    image: {
      bytes: imageBytes,
      mimeType: "image/png" as const,
      width: metadata.width ?? units[0]!.canvas.width,
      height: metadata.height ?? units[0]!.canvas.height,
    },
  };
}

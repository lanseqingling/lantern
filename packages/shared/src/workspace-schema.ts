import { z } from "zod";
import {
  balloonElementSchema,
  comicDocumentSchema,
  frameBorderSchema,
  frameElementSchema,
  frameLayerSchema,
  frameMaskSchema,
  frameSchema,
  frameShapeSchema,
  geometrySchema,
  normalizedRectSchema,
  presentationUnitSchema,
  resourceBindingSchema,
  surfaceSchema,
  visualAssetReferenceSchema,
} from "./lcd/schema";
import { normalizeStoryboardBeat } from "./lcd/types";

export const storyboardBeatSchema = z.preprocess(normalizeStoryboardBeat, z.object({
  id: z.string().min(1),
  versionId: z.string().min(1),
  title: z.string().min(1).max(80),
  description: z.string().max(4000),
}));

export const presentationUnitLayoutSchema = z.strictObject({
  canvas: presentationUnitSchema.shape.canvas.optional(),
  surfaces: z.array(surfaceSchema).optional(),
  frames: z.array(frameSchema.pick({ id: true, geometry: true, zIndex: true }).extend({
    border: frameBorderSchema.optional(),
    shape: frameShapeSchema.optional(),
    mask: frameMaskSchema.optional(),
  })),
  readingSequence: presentationUnitSchema.shape.readingSequence,
  layoutPolicy: presentationUnitSchema.shape.layoutPolicy.optional(),
});

const balloonChangesSchema = balloonElementSchema.pick({
  transform: true,
  tailTarget: true,
  shape: true,
  style: true,
  overflow: true,
}).partial().strict().refine((changes) => Object.keys(changes).length > 0, "balloon changes cannot be empty");

export const workspaceCommandSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("replace_chapter_presentation"), document: comicDocumentSchema }),
  z.strictObject({ type: z.literal("replace_chapter_layout"), document: comicDocumentSchema }),
  z.strictObject({ type: z.literal("replace_storyboard_beats"), storyboardBeats: z.array(storyboardBeatSchema).max(120) }),
  z.strictObject({ type: z.literal("declare_resource"), resource: resourceBindingSchema }),
  z.strictObject({ type: z.literal("add_dialogue"), dialogue: comicDocumentSchema.shape.dialogues.element }),
  z.strictObject({ type: z.literal("remove_dialogue"), dialogueId: z.string().min(1) }),
  z.strictObject({ type: z.literal("create_frame_storyboard_beat"), unitId: z.string().min(1), frameId: z.string().min(1), storyboardBeat: storyboardBeatSchema }),
  z.strictObject({ type: z.literal("add_presentation_unit"), unit: presentationUnitSchema, readingIndex: z.number().int().nonnegative().optional() }),
  z.strictObject({ type: z.literal("set_presentation_unit_name"), unitId: z.string().min(1), name: z.string().min(1).max(80).nullable() }),
  z.strictObject({ type: z.literal("resize_vertical_segment"), unitId: z.string().min(1), canvasHeight: z.number().int().positive() }),
  z.strictObject({ type: z.literal("remove_presentation_unit"), unitId: z.string().min(1) }),
  z.strictObject({ type: z.literal("move_frame"), unitId: z.string().min(1), frameId: z.string().min(1), position: z.object({ x: z.number(), y: z.number() }) }),
  z.strictObject({ type: z.literal("resize_frame"), unitId: z.string().min(1), frameId: z.string().min(1), geometry: geometrySchema }),
  z.strictObject({ type: z.literal("reorder_frame"), unitId: z.string().min(1), frameId: z.string().min(1), zIndex: z.number().int() }),
  z.strictObject({ type: z.literal("set_frame_style"), unitId: z.string().min(1), frameId: z.string().min(1), border: frameBorderSchema.optional(), shape: frameShapeSchema.optional(), mask: frameMaskSchema.optional() }),
  z.strictObject({ type: z.literal("replace_presentation_layout"), unitId: z.string().min(1), expectedFrameIds: z.array(z.string().min(1)), layout: presentationUnitLayoutSchema }),
  z.strictObject({ type: z.literal("add_frame"), unitId: z.string().min(1), frame: frameSchema, readingIndex: z.number().int().nonnegative().optional() }),
  z.strictObject({ type: z.literal("remove_frame"), unitId: z.string().min(1), frameId: z.string().min(1) }),
  z.strictObject({ type: z.literal("set_art_crop"), unitId: z.string().min(1), frameId: z.string().min(1), layerId: z.string().min(1), elementId: z.string().min(1), crop: normalizedRectSchema }),
  z.strictObject({ type: z.literal("set_element_transform"), unitId: z.string().min(1), frameId: z.string().min(1).optional(), layerId: z.string().min(1), elementId: z.string().min(1), transform: geometrySchema }),
  z.strictObject({ type: z.literal("set_element_appearance"), unitId: z.string().min(1), frameId: z.string().min(1).optional(), layerId: z.string().min(1), elementId: z.string().min(1), appearance: visualAssetReferenceSchema.nullable() }),
  z.strictObject({ type: z.literal("add_frame_layer"), unitId: z.string().min(1), frameId: z.string().min(1), layer: frameLayerSchema }),
  z.strictObject({ type: z.literal("add_layer_element"), unitId: z.string().min(1), frameId: z.string().min(1), layerId: z.string().min(1), element: frameElementSchema }),
  z.strictObject({ type: z.literal("remove_layer_element"), unitId: z.string().min(1), frameId: z.string().min(1), layerId: z.string().min(1), elementId: z.string().min(1) }),
  z.strictObject({ type: z.literal("duplicate_layer_element"), unitId: z.string().min(1), frameId: z.string().min(1), layerId: z.string().min(1), elementId: z.string().min(1), newElementId: z.string().min(1) }),
  z.strictObject({ type: z.literal("reorder_layer"), unitId: z.string().min(1), frameId: z.string().min(1), layerId: z.string().min(1), zIndex: z.number().int() }),
  z.strictObject({ type: z.literal("update_balloon"), unitId: z.string().min(1), frameId: z.string().min(1), layerId: z.string().min(1), elementId: z.string().min(1), changes: balloonChangesSchema }),
  z.strictObject({ type: z.literal("update_dialogue"), dialogueId: z.string().min(1), content: z.string() }),
  z.strictObject({
    type: z.literal("update_storyboard_beat"),
    storyboardBeatId: z.string().min(1),
    patch: z.object({ title: z.string().min(1).max(80), description: z.string().max(4000) }).partial().refine((value) => Object.keys(value).length > 0),
  }),
]);

const changeSetBaseShape = {
  id: z.string().min(1),
  projectId: z.string().min(1),
  baseRevision: z.number().int().positive(),
  source: z.enum(["manual", "candidate", "undo", "redo", "migration"]),
  sourceCandidateId: z.string().min(1).optional(),
};

export const workspaceChangeSetSchema = z.strictObject({
  ...changeSetBaseShape,
  commands: z.array(workspaceCommandSchema).max(200).optional(),
  operations: z.array(workspaceCommandSchema).max(200).optional(),
}).refine((changeSet) => changeSet.commands !== undefined || changeSet.operations !== undefined, "commands are required");

export const workspaceChangeSetRequestSchema = z.strictObject({
  expectedWorkingRevision: z.number().int().positive(),
  changeSet: z.strictObject({
    ...changeSetBaseShape,
    commands: z.array(workspaceCommandSchema).min(1).max(200),
  }),
});

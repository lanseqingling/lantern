import { z } from "zod";
import {
  balloonElementSchema,
  geometrySchema,
  normalizedRectSchema,
  visualAssetReferenceSchema,
  type PresentationUnit,
  type WorkbenchFixture,
  type WorkspaceCommand,
} from "../../shared/src";

export type CapabilityScope = "element" | "frame" | "unit" | "chapter";
export type CapabilityHumanEntry = "available" | "planned" | "exception";
export type CapabilityAgentAccess = "disabled" | "observe" | "preview" | "execute";
export type CapabilityRisk = "low" | "medium" | "high";
export type CapabilityPreviewPolicy = "inline" | "candidate" | "staged";

export type EditorCapabilityDescriptor = {
  id: string;
  version: number;
  scope: CapabilityScope;
  humanEntry: CapabilityHumanEntry;
  agentAccess: CapabilityAgentAccess;
  risk: CapabilityRisk;
  preconditions: string[];
  outputCommandTypes: WorkspaceCommand["type"][];
  previewPolicy: CapabilityPreviewPolicy;
  undoPolicy: "atomic";
};

export type EditorCapabilityContext = {
  fixture: Pick<WorkbenchFixture, "working" | "storyboardBeats">;
  createId: (prefix: string) => string;
  actor: "human" | "agent";
};

export const verticalSegmentAspectRatios = ["4:3", "1:1", "3:4", "2:3", "9:16", "9:20"] as const;
export type VerticalSegmentAspectRatio = typeof verticalSegmentAspectRatios[number];

export function verticalSegmentHeight(width: number, aspectRatio: VerticalSegmentAspectRatio) {
  const [ratioWidth, ratioHeight] = aspectRatio.split(":").map(Number);
  return Math.round(width * ratioHeight / ratioWidth);
}

type RegisteredCapability = EditorCapabilityDescriptor & {
  inputSchema: z.ZodType;
  plan: (rawInput: unknown, context: EditorCapabilityContext) => { input: unknown; commands: WorkspaceCommand[] };
};

function defineCapability<TSchema extends z.ZodType>(definition: EditorCapabilityDescriptor & {
  inputSchema: TSchema;
  execute: (input: z.infer<TSchema>, context: EditorCapabilityContext) => WorkspaceCommand[];
}): RegisteredCapability {
  const { execute, ...descriptor } = definition;
  return {
    ...descriptor,
    plan(rawInput, context) {
      const input = definition.inputSchema.parse(rawInput);
      return { input, commands: execute(input, context) };
    },
  };
}

function findFrame(context: EditorCapabilityContext, unitId: string, frameId: string) {
  const unit = context.fixture.working.document.units.find((item) => item.id === unitId);
  if (!unit) throw new Error(`missing PresentationUnit: ${unitId}`);
  const frame = unit.frames.find((item) => item.id === frameId);
  if (!frame) throw new Error(`missing Frame: ${frameId}`);
  return { unit, frame };
}

function findFrameLayer(context: EditorCapabilityContext, unitId: string, frameId: string, layerId: string) {
  const { unit, frame } = findFrame(context, unitId, frameId);
  const layer = frame.layers.find((item) => item.id === layerId);
  if (!layer) throw new Error(`missing FrameLayer: ${layerId}`);
  return { unit, frame, layer };
}

function findFrameElement(context: EditorCapabilityContext, unitId: string, frameId: string, layerId: string, elementId: string) {
  const { unit, frame, layer } = findFrameLayer(context, unitId, frameId, layerId);
  const element = layer.elements.find((item) => item.id === elementId);
  if (!element) throw new Error(`missing FrameElement: ${elementId}`);
  return { unit, frame, layer, element };
}

const updateDialogueCapability = defineCapability({
  id: "update_dialogue",
  version: 1,
  inputSchema: z.strictObject({ dialogueId: z.string().min(1), content: z.string() }),
  scope: "element",
  humanEntry: "available",
  agentAccess: "disabled",
  risk: "low",
  preconditions: ["dialogue_exists"],
  outputCommandTypes: ["update_dialogue"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    if (!context.fixture.working.document.dialogues.some((dialogue) => dialogue.id === input.dialogueId)) {
      throw new Error(`missing Dialogue: ${input.dialogueId}`);
    }
    return [{ type: "update_dialogue", dialogueId: input.dialogueId, content: input.content }];
  },
});

const updateStoryboardBeatCapability = defineCapability({
  id: "update_storyboard_beat",
  version: 1,
  inputSchema: z.strictObject({
    storyboardBeatId: z.string().min(1),
    patch: z.object({ title: z.string().min(1).max(80), description: z.string().max(4000) }).partial().refine((value) => Object.keys(value).length > 0),
  }),
  scope: "frame",
  humanEntry: "available",
  agentAccess: "disabled",
  risk: "low",
  preconditions: ["storyboard_beat_exists"],
  outputCommandTypes: ["update_storyboard_beat"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    if (!context.fixture.storyboardBeats.some((beat) => beat.id === input.storyboardBeatId)) {
      throw new Error(`missing StoryboardBeat: ${input.storyboardBeatId}`);
    }
    return [{ type: "update_storyboard_beat", storyboardBeatId: input.storyboardBeatId, patch: input.patch }];
  },
});

const createFrameStoryboardBeatCapability = defineCapability({
  id: "create_frame_storyboard_beat",
  version: 1,
  inputSchema: z.strictObject({
    unitId: z.string().min(1),
    frameId: z.string().min(1),
    title: z.string().min(1).max(80),
    description: z.string().max(4000),
  }),
  scope: "frame",
  humanEntry: "available",
  agentAccess: "disabled",
  risk: "low",
  preconditions: ["frame_exists", "frame_has_no_primary_storyboard_beat"],
  outputCommandTypes: ["create_frame_storyboard_beat"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    const { frame } = findFrame(context, input.unitId, input.frameId);
    if (frame.storyRefs.some((reference) => reference.role === "primary")) {
      throw new Error(`Frame already has a primary StoryboardBeat: ${input.frameId}`);
    }
    const id = context.createId("storyboard-beat");
    return [{
      type: "create_frame_storyboard_beat",
      unitId: input.unitId,
      frameId: input.frameId,
      storyboardBeat: { id, versionId: `${id}-v1`, title: input.title, description: input.description },
    }];
  },
});

const setArtCropCapability = defineCapability({
  id: "set_art_crop",
  version: 1,
  inputSchema: z.strictObject({
    unitId: z.string().min(1),
    frameId: z.string().min(1),
    layerId: z.string().min(1),
    elementId: z.string().min(1),
    crop: normalizedRectSchema,
  }),
  scope: "element",
  humanEntry: "available",
  agentAccess: "disabled",
  risk: "low",
  preconditions: ["art_element_exists", "crop_is_normalized"],
  outputCommandTypes: ["set_art_crop"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    const { frame } = findFrame(context, input.unitId, input.frameId);
    const layer = frame.layers.find((item) => item.id === input.layerId);
    const element = layer?.elements.find((item) => item.id === input.elementId);
    if (!element || element.kind !== "image") throw new Error(`missing ArtElement: ${input.elementId}`);
    return [{ type: "set_art_crop", ...input }];
  },
});

const moveFrameCapability = defineCapability({
  id: "move_frame",
  version: 1,
  inputSchema: z.strictObject({
    unitId: z.string().min(1),
    frameId: z.string().min(1),
    position: z.strictObject({ x: z.number(), y: z.number() }),
  }),
  scope: "frame",
  humanEntry: "available",
  agentAccess: "disabled",
  risk: "low",
  preconditions: ["frame_exists", "resulting_document_is_valid"],
  outputCommandTypes: ["move_frame"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    findFrame(context, input.unitId, input.frameId);
    return [{ type: "move_frame", ...input }];
  },
});

const resizeFrameCapability = defineCapability({
  id: "resize_frame",
  version: 1,
  inputSchema: z.strictObject({
    unitId: z.string().min(1),
    frameId: z.string().min(1),
    geometry: geometrySchema,
  }),
  scope: "frame",
  humanEntry: "available",
  agentAccess: "disabled",
  risk: "low",
  preconditions: ["frame_exists", "resulting_document_is_valid"],
  outputCommandTypes: ["resize_frame"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    findFrame(context, input.unitId, input.frameId);
    return [{ type: "resize_frame", ...input }];
  },
});

const setElementTransformCapability = defineCapability({
  id: "set_element_transform",
  version: 1,
  inputSchema: z.strictObject({
    unitId: z.string().min(1),
    frameId: z.string().min(1),
    layerId: z.string().min(1),
    elementId: z.string().min(1),
    transform: geometrySchema,
  }),
  scope: "element",
  humanEntry: "available",
  agentAccess: "disabled",
  risk: "low",
  preconditions: ["frame_element_exists", "resulting_document_is_valid"],
  outputCommandTypes: ["set_element_transform"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    findFrameElement(context, input.unitId, input.frameId, input.layerId, input.elementId);
    return [{ type: "set_element_transform", ...input }];
  },
});

const balloonChangesInputSchema = balloonElementSchema.pick({
  transform: true,
  tailTarget: true,
  shape: true,
  style: true,
  overflow: true,
}).partial().strict().refine((changes) => Object.keys(changes).length > 0, "balloon changes cannot be empty");

const updateBalloonCapability = defineCapability({
  id: "update_balloon",
  version: 1,
  inputSchema: z.strictObject({
    unitId: z.string().min(1),
    frameId: z.string().min(1),
    layerId: z.string().min(1),
    elementId: z.string().min(1),
    changes: balloonChangesInputSchema,
  }),
  scope: "element",
  humanEntry: "available",
  agentAccess: "disabled",
  risk: "low",
  preconditions: ["balloon_element_exists", "resulting_document_is_valid"],
  outputCommandTypes: ["update_balloon"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    const { element } = findFrameElement(context, input.unitId, input.frameId, input.layerId, input.elementId);
    if (element.kind !== "balloon") throw new Error(`missing BalloonElement: ${input.elementId}`);
    return [{ type: "update_balloon", ...input }];
  },
});

const reorderLayerCapability = defineCapability({
  id: "reorder_layer",
  version: 1,
  inputSchema: z.strictObject({
    unitId: z.string().min(1),
    frameId: z.string().min(1),
    layerId: z.string().min(1),
    zIndex: z.number().int(),
  }),
  scope: "frame",
  humanEntry: "available",
  agentAccess: "disabled",
  risk: "medium",
  preconditions: ["frame_layer_exists"],
  outputCommandTypes: ["reorder_layer"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    findFrameLayer(context, input.unitId, input.frameId, input.layerId);
    return [{ type: "reorder_layer", ...input }];
  },
});

const setElementAppearanceCapability = defineCapability({
  id: "set_element_appearance",
  version: 1,
  inputSchema: z.strictObject({
    unitId: z.string().min(1),
    frameId: z.string().min(1).optional(),
    layerId: z.string().min(1),
    elementId: z.string().min(1),
    appearance: visualAssetReferenceSchema.nullable(),
  }),
  scope: "element",
  humanEntry: "available",
  agentAccess: "disabled",
  risk: "low",
  preconditions: ["text_or_balloon_element_exists", "appearance_resource_is_declared"],
  outputCommandTypes: ["set_element_appearance"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    const document = context.fixture.working.document;
    const unit = document.units.find((item) => item.id === input.unitId);
    if (!unit) throw new Error(`missing PresentationUnit: ${input.unitId}`);
    const frame = input.frameId ? unit.frames.find((item) => item.id === input.frameId) : undefined;
    if (input.frameId && !frame) throw new Error(`missing Frame: ${input.frameId}`);
    const layer = frame
      ? frame.layers.find((item) => item.id === input.layerId)
      : unit.overlayLayers.find((item) => item.id === input.layerId);
    const element = layer?.elements.find((item) => item.id === input.elementId);
    if (!element || (element.kind !== "text" && element.kind !== "balloon")) {
      throw new Error(`missing visual TextElement or BalloonElement: ${input.elementId}`);
    }
    if (input.appearance) {
      const resource = document.resources.find((item) => item.assetId === input.appearance?.assetId && item.assetVersionId === input.appearance?.assetVersionId);
      if (!resource) throw new Error(`appearance references an undeclared asset version: ${input.appearance.assetVersionId}`);
      if (resource.kind !== "image" || !resource.mediaType.startsWith("image/")) throw new Error("appearance must reference an image resource");
    }
    return [{ type: "set_element_appearance", ...input }];
  },
});

const createPageCapability = defineCapability({
  id: "create_page",
  version: 1,
  inputSchema: z.strictObject({}),
  scope: "chapter",
  humanEntry: "available",
  agentAccess: "disabled",
  risk: "medium",
  preconditions: ["working_document_exists"],
  outputCommandTypes: ["add_presentation_unit"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(_input, context) {
    const document = context.fixture.working.document;
    if (document.format === "vertical") throw new Error("create_page is unavailable for vertical comics");
    const readingIndex = document.units.length;
    const kind: PresentationUnit["kind"] = document.format === "four_panel" ? "four_panel_unit" : "single_page";
    const previousUnit = document.units.at(-1);
    const canvas = previousUnit?.kind === kind
      ? structuredClone(previousUnit.canvas)
      : { width: 720, height: 1080, background: { color: "#ffffff" } };
    const id = context.createId(kind === "four_panel_unit" ? "four-panel-unit" : "page");
    const unit: PresentationUnit = {
      id,
      kind,
      canvas,
      surfaces: [{ id: `${id}-surface`, role: "single", geometry: { x: 0, y: 0, width: canvas.width, height: canvas.height }, pageNumber: readingIndex + 1 }],
      frames: [],
      overlayLayers: [],
      readingSequence: [],
      layoutPolicy: { frameOverlap: "forbid", defaultOverflow: "clip" },
    };
    return [{ type: "add_presentation_unit", unit, readingIndex }];
  },
});

const createVerticalSegmentCapability = defineCapability({
  id: "create_vertical_segment",
  version: 1,
  inputSchema: z.strictObject({ aspectRatio: z.enum(verticalSegmentAspectRatios) }),
  scope: "chapter",
  humanEntry: "available",
  agentAccess: "disabled",
  risk: "medium",
  preconditions: ["vertical_working_document_exists", "aspect_ratio_is_supported"],
  outputCommandTypes: ["add_presentation_unit"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    const document = context.fixture.working.document;
    if (document.format !== "vertical") throw new Error("create_vertical_segment requires a vertical comic");
    const readingIndex = document.units.length;
    const firstSegment = document.units.find((unit) => unit.kind === "vertical_segment");
    const previousSegment = [...document.units].reverse().find((unit) => unit.kind === "vertical_segment");
    const width = firstSegment?.canvas.width ?? 640;
    const canvas = {
      width,
      height: verticalSegmentHeight(width, input.aspectRatio),
      background: structuredClone(previousSegment?.canvas.background ?? { color: "#ffffff" }),
    };
    const id = context.createId("segment");
    const unit: PresentationUnit = {
      id,
      kind: "vertical_segment",
      canvas,
      surfaces: [{ id: `${id}-surface`, role: "segment", geometry: { x: 0, y: 0, width: canvas.width, height: canvas.height }, pageNumber: readingIndex + 1 }],
      frames: [],
      overlayLayers: [],
      readingSequence: [],
      layoutPolicy: { frameOverlap: "forbid", defaultOverflow: "clip" },
    };
    return [{ type: "add_presentation_unit", unit, readingIndex }];
  },
});

const updatePresentationUnitCapability = defineCapability({
  id: "update_presentation_unit",
  version: 1,
  inputSchema: z.strictObject({
    unitId: z.string().min(1),
    name: z.string().max(80),
    aspectRatio: z.enum(verticalSegmentAspectRatios).optional(),
  }),
  scope: "unit",
  humanEntry: "available",
  agentAccess: "disabled",
  risk: "medium",
  preconditions: ["presentation_unit_exists", "vertical_resize_preserves_frames"],
  outputCommandTypes: ["set_presentation_unit_name", "resize_vertical_segment"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    const unit = context.fixture.working.document.units.find((item) => item.id === input.unitId);
    if (!unit) throw new Error(`missing PresentationUnit: ${input.unitId}`);
    const commands: WorkspaceCommand[] = [{ type: "set_presentation_unit_name", unitId: unit.id, name: input.name.trim() || null }];
    if (input.aspectRatio) {
      if (unit.kind !== "vertical_segment") throw new Error("只有滚动段可以修改页面比例");
      const canvasHeight = verticalSegmentHeight(unit.canvas.width, input.aspectRatio);
      if (unit.frames.some((frame) => frame.geometry.y + frame.geometry.height > canvasHeight)) {
        throw new Error("页面下方空间不足，现有画格会被裁切，无法应用该比例");
      }
      commands.push({ type: "resize_vertical_segment", unitId: unit.id, canvasHeight });
    }
    return commands;
  },
});

const deletePresentationUnitCapability = defineCapability({
  id: "delete_presentation_unit",
  version: 1,
  inputSchema: z.strictObject({ unitId: z.string().min(1) }),
  scope: "unit",
  humanEntry: "available",
  agentAccess: "disabled",
  risk: "high",
  preconditions: ["presentation_unit_exists", "chapter_keeps_one_presentation_unit"],
  outputCommandTypes: ["remove_presentation_unit"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    const document = context.fixture.working.document;
    if (!document.units.some((unit) => unit.id === input.unitId)) throw new Error(`missing PresentationUnit: ${input.unitId}`);
    if (document.units.length <= 1) throw new Error("漫画至少需要保留一个页面");
    return [{ type: "remove_presentation_unit", unitId: input.unitId }];
  },
});

const capabilityRegistry = {
  update_dialogue: updateDialogueCapability,
  update_storyboard_beat: updateStoryboardBeatCapability,
  create_frame_storyboard_beat: createFrameStoryboardBeatCapability,
  set_art_crop: setArtCropCapability,
  move_frame: moveFrameCapability,
  resize_frame: resizeFrameCapability,
  set_element_transform: setElementTransformCapability,
  update_balloon: updateBalloonCapability,
  reorder_layer: reorderLayerCapability,
  set_element_appearance: setElementAppearanceCapability,
  create_page: createPageCapability,
  create_vertical_segment: createVerticalSegmentCapability,
  update_presentation_unit: updatePresentationUnitCapability,
  delete_presentation_unit: deletePresentationUnitCapability,
} satisfies Record<string, RegisteredCapability>;

export type EditorCapabilityId = keyof typeof capabilityRegistry;

function descriptor(capability: RegisteredCapability): EditorCapabilityDescriptor {
  return {
    id: capability.id,
    version: capability.version,
    scope: capability.scope,
    humanEntry: capability.humanEntry,
    agentAccess: capability.agentAccess,
    risk: capability.risk,
    preconditions: capability.preconditions,
    outputCommandTypes: capability.outputCommandTypes,
    previewPolicy: capability.previewPolicy,
    undoPolicy: capability.undoPolicy,
  };
}

export function listEditorCapabilities(): EditorCapabilityDescriptor[] {
  return Object.values(capabilityRegistry).map(descriptor);
}

export function getEditorCapability(id: EditorCapabilityId) {
  const capability = capabilityRegistry[id];
  return { ...descriptor(capability), inputSchema: capability.inputSchema };
}

export function planEditorCapability(id: EditorCapabilityId, rawInput: unknown, context: EditorCapabilityContext) {
  const capability = capabilityRegistry[id];
  if (context.actor === "human" && capability.humanEntry !== "available") {
    throw new Error(`capability is not available to human entry: ${id}`);
  }
  if (context.actor === "agent" && capability.agentAccess === "disabled") {
    throw new Error(`capability is disabled for Agent: ${id}`);
  }
  const plan = capability.plan(rawInput, context);
  return { capability: descriptor(capability), ...plan };
}

export type EditorCapabilityRequest = { id: EditorCapabilityId; input: unknown };

export function planEditorCapabilities(requests: EditorCapabilityRequest[], context: EditorCapabilityContext) {
  const plans = requests.map((request) => planEditorCapability(request.id, request.input, context));
  return {
    plans,
    commands: plans.flatMap((plan) => plan.commands),
  };
}

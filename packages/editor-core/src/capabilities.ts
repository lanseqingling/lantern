import { z } from "zod";
import {
  normalizedRectSchema,
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

import { z } from "zod";
import {
  balloonElementSchema,
  geometrySchema,
  normalizedRectSchema,
  visualAssetReferenceSchema,
  type ArtElement,
  type BalloonElement,
  type Dialogue,
  type Frame,
  type FrameElement,
  type FrameLayer,
  type Geometry,
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

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const overlaps = (left: Geometry, right: Geometry, gutter = 0) =>
  left.x < right.x + right.width + gutter && left.x + left.width + gutter > right.x
  && left.y < right.y + right.height + gutter && left.y + left.height + gutter > right.y;

function availableFrameGeometry(unit: PresentationUnit, preferred: { x: number; y: number }, size?: { width: number; height: number }) {
  const surface = unit.surfaces.find((candidate) => preferred.x >= candidate.geometry.x && preferred.x <= candidate.geometry.x + candidate.geometry.width && preferred.y >= candidate.geometry.y && preferred.y <= candidate.geometry.y + candidate.geometry.height) ?? unit.surfaces[0];
  if (!surface) throw new Error("页面没有可放置画格的纸面");
  const gutter = unit.layoutPolicy.gutter ?? 12;
  const width = size ? Math.min(size.width, surface.geometry.width) : Math.min(240, Math.max(120, surface.geometry.width * .38));
  const height = size ? Math.min(size.height, surface.geometry.height) : Math.min(190, Math.max(100, width * .72), surface.geometry.height * .34);
  const minX = surface.geometry.x;
  const minY = surface.geometry.y;
  const maxX = surface.geometry.x + surface.geometry.width - width;
  const maxY = surface.geometry.y + surface.geometry.height - height;
  const preferredGeometry = {
    x: clamp(preferred.x - width / 2, minX, maxX),
    y: clamp(preferred.y - height / 2, minY, maxY),
    width,
    height,
  };
  const occupied = unit.frames;
  const allowed = (geometry: Geometry) => unit.layoutPolicy.frameOverlap === "allow" || !occupied.some((frame) => overlaps(geometry, frame.geometry, gutter));
  if (allowed(preferredGeometry)) return preferredGeometry;
  const step = Math.max(20, gutter * 2);
  const candidates: Geometry[] = [];
  for (let y = minY; y <= maxY + .5; y += step) {
    for (let x = minX; x <= maxX + .5; x += step) candidates.push({ x: Math.min(x, maxX), y: Math.min(y, maxY), width, height });
  }
  candidates.sort((left, right) => Math.hypot(left.x - preferredGeometry.x, left.y - preferredGeometry.y) - Math.hypot(right.x - preferredGeometry.x, right.y - preferredGeometry.y));
  const available = candidates.find(allowed);
  if (!available) throw new Error("当前纸张没有足够空间新增画格，请先移动或缩小现有画格");
  return available;
}

function readingIndexForGeometry(context: EditorCapabilityContext, unit: PresentationUnit, geometry: Geometry) {
  const centers = unit.frames.map((frame) => ({ id: frame.id, x: frame.geometry.x + frame.geometry.width / 2, y: frame.geometry.y + frame.geometry.height / 2 }));
  const next = { id: "__new__", x: geometry.x + geometry.width / 2, y: geometry.y + geometry.height / 2 };
  const direction = context.fixture.working.document.reading.direction;
  centers.push(next);
  centers.sort((left, right) => {
    if (Math.abs(left.y - right.y) > 24 || direction === "ttb") return left.y - right.y;
    return direction === "rtl" ? right.x - left.x : left.x - right.x;
  });
  return centers.findIndex((entry) => entry.id === next.id);
}

function createEmptyFrame(context: EditorCapabilityContext, unit: PresentationUnit, geometry: Geometry): Frame {
  const frameId = context.createId("frame");
  return {
    id: frameId,
    name: "新画格",
    geometry,
    zIndex: Math.max(0, ...unit.frames.map((frame) => frame.zIndex)) + 1,
    storyRefs: [],
    border: { color: "#111111", width: 4, style: "solid" },
    shape: { kind: "rect" },
    mask: { mode: "clip" },
    constraints: ["stay_on_surface"],
    layers: [
      { id: context.createId("art-layer"), kind: "art", name: "画面", zIndex: 10, visible: true, overflow: "clip", elements: [] },
      { id: context.createId("text-layer"), kind: "text", name: "对白", zIndex: 20, visible: true, overflow: "visible", elements: [] },
    ],
  };
}

function dialogueReferenceCount(context: EditorCapabilityContext, dialogueId: string) {
  return context.fixture.working.document.units.reduce((count, unit) => count
    + unit.frames.flatMap((frame) => frame.layers.flatMap((layer) => [...layer.elements] as FrameElement[])).filter((element) => element.kind === "balloon" && element.dialogueId === dialogueId).length
    + unit.overlayLayers.flatMap((layer) => layer.elements).filter((element) => element.kind === "balloon" && element.dialogueId === dialogueId).length, 0);
}

const createFrameCapability = defineCapability({
  id: "create_frame",
  version: 1,
  inputSchema: z.strictObject({ unitId: z.string().min(1), position: z.strictObject({ x: z.number(), y: z.number() }) }),
  scope: "unit",
  humanEntry: "available",
  agentAccess: "disabled",
  risk: "medium",
  preconditions: ["presentation_unit_exists", "frame_fits_available_surface", "resulting_document_is_valid"],
  outputCommandTypes: ["add_frame"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    const unit = context.fixture.working.document.units.find((candidate) => candidate.id === input.unitId);
    if (!unit) throw new Error(`missing PresentationUnit: ${input.unitId}`);
    const geometry = availableFrameGeometry(unit, input.position);
    const frame = createEmptyFrame(context, unit, geometry);
    return [{ type: "add_frame", unitId: unit.id, frame, readingIndex: readingIndexForGeometry(context, unit, geometry) }];
  },
});

const duplicateFrameCapability = defineCapability({
  id: "duplicate_frame",
  version: 1,
  inputSchema: z.strictObject({ unitId: z.string().min(1), frameId: z.string().min(1) }),
  scope: "frame",
  humanEntry: "available",
  agentAccess: "disabled",
  risk: "medium",
  preconditions: ["frame_exists", "duplicate_fits_available_surface", "resulting_document_is_valid"],
  outputCommandTypes: ["add_dialogue", "add_frame", "create_frame_storyboard_beat"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    const { unit, frame } = findFrame(context, input.unitId, input.frameId);
    const geometry = availableFrameGeometry(unit, { x: frame.geometry.x + frame.geometry.width * 1.5 + 24, y: frame.geometry.y + frame.geometry.height / 2 }, frame.geometry);
    const dialogueCommands: WorkspaceCommand[] = [];
    const layers = frame.layers.map((layer): FrameLayer => ({
      ...structuredClone(layer),
      id: context.createId(`${layer.kind}-layer`),
      elements: layer.elements.map((element) => {
        const next = { ...structuredClone(element), id: context.createId(element.kind) };
        if (next.kind === "balloon") {
          const source = context.fixture.working.document.dialogues.find((dialogue) => dialogue.id === next.dialogueId);
          const dialogueId = context.createId("dialogue");
          next.dialogueId = dialogueId;
          dialogueCommands.push({ type: "add_dialogue", dialogue: { ...structuredClone(source ?? { content: "" }), id: dialogueId } });
        }
        return next;
      }),
    } as FrameLayer));
    const nextFrame: Frame = { ...structuredClone(frame), id: context.createId("frame"), name: `${frame.name ?? "画格"} 副本`, geometry, zIndex: Math.max(0, ...unit.frames.map((item) => item.zIndex)) + 1, storyRefs: [], layers };
    const commands: WorkspaceCommand[] = [
      ...dialogueCommands,
      { type: "add_frame", unitId: unit.id, frame: nextFrame, readingIndex: readingIndexForGeometry(context, unit, geometry) },
    ];
    const primary = frame.storyRefs.find((reference) => reference.role === "primary");
    const beat = primary ? context.fixture.storyboardBeats.find((candidate) => candidate.id === primary.storyboardBeatId) : undefined;
    if (beat) {
      const beatId = context.createId("storyboard-beat");
      commands.push({ type: "create_frame_storyboard_beat", unitId: unit.id, frameId: nextFrame.id, storyboardBeat: { ...structuredClone(beat), id: beatId, versionId: `${beatId}-v1`, title: `${beat.title} 副本` } });
    }
    return commands;
  },
});

const deleteFrameCapability = defineCapability({
  id: "delete_frame",
  version: 1,
  inputSchema: z.strictObject({ unitId: z.string().min(1), frameId: z.string().min(1) }),
  scope: "frame",
  humanEntry: "available",
  agentAccess: "disabled",
  risk: "high",
  preconditions: ["frame_exists", "storyboard_beat_is_preserved_as_unplaced"],
  outputCommandTypes: ["remove_frame", "remove_dialogue"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    const { frame } = findFrame(context, input.unitId, input.frameId);
    const dialogueIds = new Set(frame.layers.flatMap((layer) => [...layer.elements] as FrameElement[]).flatMap((element) => element.kind === "balloon" ? [element.dialogueId] : []));
    return [
      { type: "remove_frame", unitId: input.unitId, frameId: input.frameId },
      ...Array.from(dialogueIds).filter((dialogueId) => dialogueReferenceCount(context, dialogueId) === 1).map((dialogueId): WorkspaceCommand => ({ type: "remove_dialogue", dialogueId })),
    ];
  },
});

const frameImageInputSchema = z.strictObject({
  unitId: z.string().min(1),
  frameId: z.string().min(1),
  assetId: z.string().min(1),
  assetVersionId: z.string().min(1),
  mediaType: z.string().startsWith("image/"),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
});

const placeFrameImageCapability = defineCapability({
  id: "place_frame_image",
  version: 1,
  inputSchema: frameImageInputSchema,
  scope: "frame",
  humanEntry: "available",
  agentAccess: "disabled",
  risk: "low",
  preconditions: ["frame_exists", "frame_has_no_primary_art", "asset_version_is_fixed"],
  outputCommandTypes: ["declare_resource", "add_frame_layer", "add_layer_element"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    const { frame } = findFrame(context, input.unitId, input.frameId);
    const existing = frame.layers.flatMap((layer) => layer.kind === "art" ? layer.elements : []).find((element) => element.kind === "image");
    if (existing) throw new Error("当前画格已有主图，请使用更换图片");
    let artLayer = frame.layers.find((layer) => layer.kind === "art");
    const commands: WorkspaceCommand[] = [];
    if (!context.fixture.working.document.resources.some((resource) => resource.assetId === input.assetId && resource.assetVersionId === input.assetVersionId)) {
      commands.push({ type: "declare_resource", resource: { assetId: input.assetId, assetVersionId: input.assetVersionId, kind: "image", mediaType: input.mediaType, width: input.width, height: input.height } });
    }
    if (!artLayer) {
      artLayer = { id: context.createId("art-layer"), kind: "art", name: "画面", zIndex: 10, visible: true, overflow: "clip", elements: [] };
      commands.push({ type: "add_frame_layer", unitId: input.unitId, frameId: input.frameId, layer: artLayer });
    }
    const element: ArtElement = { id: context.createId("image"), kind: "image", assetId: input.assetId, assetVersionId: input.assetVersionId, transform: { x: 0, y: 0, width: 1, height: 1 }, crop: { x: 0, y: 0, width: 1, height: 1 }, name: "格内主图" };
    commands.push({ type: "add_layer_element", unitId: input.unitId, frameId: input.frameId, layerId: artLayer.id, element });
    return commands;
  },
});

const replaceFrameImageCapability = defineCapability({
  id: "replace_frame_image",
  version: 1,
  inputSchema: frameImageInputSchema.extend({ layerId: z.string().min(1), elementId: z.string().min(1) }),
  scope: "element",
  humanEntry: "available",
  agentAccess: "disabled",
  risk: "low",
  preconditions: ["art_element_exists", "asset_version_is_fixed"],
  outputCommandTypes: ["declare_resource", "remove_layer_element", "add_layer_element"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    const { element } = findFrameElement(context, input.unitId, input.frameId, input.layerId, input.elementId);
    if (element.kind !== "image") throw new Error(`missing ArtElement: ${input.elementId}`);
    const commands: WorkspaceCommand[] = [];
    if (!context.fixture.working.document.resources.some((resource) => resource.assetId === input.assetId && resource.assetVersionId === input.assetVersionId)) {
      commands.push({ type: "declare_resource", resource: { assetId: input.assetId, assetVersionId: input.assetVersionId, kind: "image", mediaType: input.mediaType, width: input.width, height: input.height } });
    }
    const replacement: ArtElement = { ...structuredClone(element), assetId: input.assetId, assetVersionId: input.assetVersionId, crop: { x: 0, y: 0, width: 1, height: 1 } };
    commands.push(
      { type: "remove_layer_element", unitId: input.unitId, frameId: input.frameId, layerId: input.layerId, elementId: input.elementId },
      { type: "add_layer_element", unitId: input.unitId, frameId: input.frameId, layerId: input.layerId, element: replacement },
    );
    return commands;
  },
});

const removeFrameImageCapability = defineCapability({
  id: "remove_frame_image",
  version: 1,
  inputSchema: z.strictObject({ unitId: z.string().min(1), frameId: z.string().min(1), layerId: z.string().min(1), elementId: z.string().min(1) }),
  scope: "element",
  humanEntry: "available",
  agentAccess: "disabled",
  risk: "low",
  preconditions: ["art_element_exists"],
  outputCommandTypes: ["remove_layer_element"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    const { element } = findFrameElement(context, input.unitId, input.frameId, input.layerId, input.elementId);
    if (element.kind !== "image") throw new Error(`missing ArtElement: ${input.elementId}`);
    return [{ type: "remove_layer_element", ...input }];
  },
});

const createDialogueBalloonCapability = defineCapability({
  id: "create_dialogue_balloon",
  version: 1,
  inputSchema: z.strictObject({ unitId: z.string().min(1), frameId: z.string().min(1), position: z.strictObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }), content: z.string().max(2000).optional() }),
  scope: "frame",
  humanEntry: "available",
  agentAccess: "disabled",
  risk: "low",
  preconditions: ["frame_exists", "resulting_document_is_valid"],
  outputCommandTypes: ["add_dialogue", "add_frame_layer", "add_layer_element"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    const { frame } = findFrame(context, input.unitId, input.frameId);
    let textLayer = frame.layers.find((layer) => layer.kind === "text");
    const commands: WorkspaceCommand[] = [];
    if (!textLayer) {
      textLayer = { id: context.createId("text-layer"), kind: "text", name: "对白", zIndex: 20, visible: true, overflow: "visible", elements: [] };
      commands.push({ type: "add_frame_layer", unitId: input.unitId, frameId: input.frameId, layer: textLayer });
    }
    const dialogueId = context.createId("dialogue");
    const primary = frame.storyRefs.find((reference) => reference.role === "primary");
    const dialogue: Dialogue = { id: dialogueId, content: input.content ?? "新对白", ...(primary ? { storyboardBeatId: primary.storyboardBeatId, storyboardBeatVersionId: primary.storyboardBeatVersionId } : {}) };
    const width = .38;
    const height = .22;
    const transform = { x: clamp(input.position.x - width / 2, 0, 1 - width), y: clamp(input.position.y - height / 2, 0, 1 - height), width, height };
    const balloon: BalloonElement = {
      id: context.createId("balloon"), kind: "balloon", dialogueId, transform,
      tailTarget: { x: clamp(input.position.x + .08, 0, 1), y: clamp(input.position.y + .25, 0, 1) },
      shape: "normal", name: "新对白",
      style: { fontFamily: "ui-sans-serif", fontSize: 18, textColor: "#172026", fill: "#ffffff", stroke: "#111111", strokeWidth: 3 },
    };
    commands.push(
      { type: "add_dialogue", dialogue },
      { type: "add_layer_element", unitId: input.unitId, frameId: input.frameId, layerId: textLayer.id, element: balloon },
    );
    return commands;
  },
});

const duplicateDialogueBalloonCapability = defineCapability({
  id: "duplicate_dialogue_balloon",
  version: 1,
  inputSchema: z.strictObject({ unitId: z.string().min(1), frameId: z.string().min(1), layerId: z.string().min(1), elementId: z.string().min(1) }),
  scope: "element",
  humanEntry: "available",
  agentAccess: "disabled",
  risk: "low",
  preconditions: ["balloon_element_exists", "dialogue_exists"],
  outputCommandTypes: ["add_dialogue", "add_layer_element"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    const { element } = findFrameElement(context, input.unitId, input.frameId, input.layerId, input.elementId);
    if (element.kind !== "balloon") throw new Error(`missing BalloonElement: ${input.elementId}`);
    const sourceDialogue = context.fixture.working.document.dialogues.find((dialogue) => dialogue.id === element.dialogueId);
    if (!sourceDialogue) throw new Error(`missing Dialogue: ${element.dialogueId}`);
    const dialogueId = context.createId("dialogue");
    const balloon: BalloonElement = { ...structuredClone(element), id: context.createId("balloon"), dialogueId, name: `${element.name ?? "对白"} 副本`, transform: { ...element.transform, x: clamp(element.transform.x + .05, 0, 1 - element.transform.width), y: clamp(element.transform.y + .05, 0, 1 - element.transform.height) } };
    return [
      { type: "add_dialogue", dialogue: { ...structuredClone(sourceDialogue), id: dialogueId } },
      { type: "add_layer_element", unitId: input.unitId, frameId: input.frameId, layerId: input.layerId, element: balloon },
    ];
  },
});

const deleteDialogueBalloonCapability = defineCapability({
  id: "delete_dialogue_balloon",
  version: 1,
  inputSchema: z.strictObject({ unitId: z.string().min(1), frameId: z.string().min(1), layerId: z.string().min(1), elementId: z.string().min(1) }),
  scope: "element",
  humanEntry: "available",
  agentAccess: "disabled",
  risk: "low",
  preconditions: ["balloon_element_exists"],
  outputCommandTypes: ["remove_layer_element", "remove_dialogue"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    const { element } = findFrameElement(context, input.unitId, input.frameId, input.layerId, input.elementId);
    if (element.kind !== "balloon") throw new Error(`missing BalloonElement: ${input.elementId}`);
    return [
      { type: "remove_layer_element", ...input },
      ...(dialogueReferenceCount(context, element.dialogueId) === 1 ? [{ type: "remove_dialogue" as const, dialogueId: element.dialogueId }] : []),
    ];
  },
});

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
  create_frame: createFrameCapability,
  duplicate_frame: duplicateFrameCapability,
  delete_frame: deleteFrameCapability,
  place_frame_image: placeFrameImageCapability,
  replace_frame_image: replaceFrameImageCapability,
  remove_frame_image: removeFrameImageCapability,
  create_dialogue_balloon: createDialogueBalloonCapability,
  duplicate_dialogue_balloon: duplicateDialogueBalloonCapability,
  delete_dialogue_balloon: deleteDialogueBalloonCapability,
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

import { z } from "zod";
import {
  balloonElementSchema,
  comicDocumentSchema,
  geometrySchema,
  normalizedRectSchema,
  storyboardBeatSchema,
  visualAssetReferenceSchema,
  type ArtElement,
  type BalloonElement,
  type Dialogue,
  type Frame,
  type FrameElement,
  type FrameLayer,
  type Geometry,
  type OverlayElement,
  type PageSurface,
  type Point,
  type PresentationUnit,
  type TextElement,
  type UnitOverlayLayer,
  type WorkbenchFixture,
  type WorkspaceCommand,
  createBalloonCutCorners,
  deriveLocalTransform,
  orderedUnitSurfaces,
  resolveLocalTransform,
} from "@lantern/shared";

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
  externalAgentAccess?: CapabilityAgentAccess;
  risk: CapabilityRisk;
  preconditions: string[];
  outputCommandTypes: WorkspaceCommand["type"][];
  previewPolicy: CapabilityPreviewPolicy;
  undoPolicy: "atomic";
};

export type EditorCapabilityContext = {
  fixture: Pick<WorkbenchFixture, "working" | "storyboardBeats">;
  createId: (prefix: string) => string;
  actor: "human" | "agent" | "external_agent";
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

function findOverlayLayer(context: EditorCapabilityContext, unitId: string, layerId: string) {
  const unit = context.fixture.working.document.units.find((item) => item.id === unitId);
  if (!unit) throw new Error(`missing PresentationUnit: ${unitId}`);
  const layer = unit.overlayLayers.find((item) => item.id === layerId);
  if (!layer) throw new Error(`missing UnitOverlayLayer: ${layerId}`);
  return { unit, layer };
}

function findOverlayElement(context: EditorCapabilityContext, unitId: string, layerId: string, elementId: string) {
  const { unit, layer } = findOverlayLayer(context, unitId, layerId);
  const element = layer.elements.find((item) => item.id === elementId);
  if (!element) throw new Error(`missing OverlayElement: ${elementId}`);
  return { unit, layer, element };
}

function findLocatedElement(context: EditorCapabilityContext, input: { unitId: string; frameId?: string; layerId: string; elementId: string }) {
  return input.frameId
    ? findFrameElement(context, input.unitId, input.frameId, input.layerId, input.elementId)
    : findOverlayElement(context, input.unitId, input.layerId, input.elementId);
}

function overlayLayerFor(context: EditorCapabilityContext, unit: PresentationUnit, anchor: UnitOverlayLayer["anchor"], purpose: UnitOverlayLayer["purpose"], name: string, surfaceId?: string) {
  const existing = unit.overlayLayers.find((layer) => layer.purpose === purpose
    && layer.surfaceId === surfaceId
    && layer.anchor.type === anchor.type
    && (anchor.type === "unit" || layer.anchor.type === "frame" && layer.anchor.frameId === anchor.frameId));
  if (existing) return { layer: existing, command: undefined };
  const layer: UnitOverlayLayer = { id: context.createId(`${purpose}-overlay`), name, zIndex: Math.max(0, ...unit.frames.map((item) => item.zIndex), ...unit.overlayLayers.map((item) => item.zIndex)) + 1, visible: true, anchor, ...(surfaceId ? { surfaceId } : {}), purpose, elements: [] };
  return { layer, command: { type: "add_overlay_layer" as const, unitId: unit.id, layer } };
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const overlaps = (left: Geometry, right: Geometry, gutter = 0) =>
  left.x < right.x + right.width + gutter && left.x + left.width + gutter > right.x
  && left.y < right.y + right.height + gutter && left.y + left.height + gutter > right.y;
const containsGeometry = (container: Geometry, child: Geometry) => child.x >= container.x - .5 && child.y >= container.y - .5
  && child.x + child.width <= container.x + container.width + .5 && child.y + child.height <= container.y + container.height + .5;
const shiftedGeometry = <T extends Geometry>(geometry: T, x: number, y = 0): T => ({ ...geometry, x: geometry.x + x, y: geometry.y + y });
const shiftedOverlayElement = (element: OverlayElement, x: number, y = 0): OverlayElement => {
  const next = { ...structuredClone(element), transform: shiftedGeometry(element.transform, x, y) } as OverlayElement;
  if (next.kind === "balloon" && next.tailTarget) next.tailTarget = { x: next.tailTarget.x + x, y: next.tailTarget.y + y };
  return next;
};
const surfaceAt = (unit: PresentationUnit, point: { x: number; y: number }) => unit.surfaces.find((surface) => point.x >= surface.geometry.x && point.x <= surface.geometry.x + surface.geometry.width && point.y >= surface.geometry.y && point.y <= surface.geometry.y + surface.geometry.height) ?? unit.surfaces[0];

function assertFrameGeometry(
  unit: PresentationUnit,
  geometry: Geometry,
  options: { frameId?: string; surfaceScope?: Frame["surfaceScope"]; allowOverlap?: boolean } = {},
) {
  const bounds = { x: 0, y: 0, width: unit.canvas.width, height: unit.canvas.height };
  const fitsSurface = options.surfaceScope === "unit"
    ? containsGeometry(bounds, geometry)
    : unit.surfaces.some((surface) => containsGeometry(surface.geometry, geometry));
  if (!fitsSurface) throw new Error(options.surfaceScope === "unit" ? "画格必须完整位于展示单元内" : "画格必须完整位于一个纸面内");
  const gutter = unit.layoutPolicy.gutter ?? 12;
  if (!options.allowOverlap && unit.layoutPolicy.frameOverlap !== "allow"
    && unit.frames.some((frame) => frame.id !== options.frameId && overlaps(geometry, frame.geometry, gutter))) {
    throw new Error("画格与现有画格重叠，请调整几何或明确允许叠格");
  }
}

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

function createEmptyFrame(context: EditorCapabilityContext, unit: PresentationUnit, geometry: Geometry, name?: string): Frame {
  const frameId = context.createId("frame");
  return {
    id: frameId,
    name: name?.trim() || "新画格",
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

function assertPageRoleAllows(unit: PresentationUnit, capability: "frame" | "dialogue") {
  if (unit.pageRole === "story") return;
  throw new Error(capability === "frame" ? "封面页和过场页暂不支持新增画格" : "封面页和过场页暂不支持新增对白");
}

function dialogueReferenceCount(context: EditorCapabilityContext, dialogueId: string) {
  return context.fixture.working.document.units.reduce((count, unit) => count
    + unit.frames.flatMap((frame) => frame.layers.flatMap((layer) => [...layer.elements] as FrameElement[])).filter((element) => element.kind === "balloon" && element.dialogueId === dialogueId).length
    + unit.overlayLayers.flatMap((layer) => layer.elements).filter((element) => element.kind === "balloon" && element.dialogueId === dialogueId).length, 0);
}

const createFrameCapability = defineCapability({
  id: "create_frame",
  version: 2,
  inputSchema: z.strictObject({
    unitId: z.string().min(1),
    position: z.strictObject({ x: z.number(), y: z.number() }).optional(),
    geometry: geometrySchema.optional(),
    name: z.string().trim().min(1).max(80).optional(),
    readingIndex: z.number().int().nonnegative().optional(),
    allowOverlap: z.boolean().optional(),
  }).superRefine((input, context) => {
    if (!input.position && !input.geometry) {
      context.addIssue({ code: "custom", message: "position 与 geometry 至少需要提供一个。" });
    }
  }),
  scope: "unit",
  humanEntry: "available",
  agentAccess: "disabled",
  externalAgentAccess: "execute",
  risk: "medium",
  preconditions: ["presentation_unit_exists", "frame_fits_available_surface", "resulting_document_is_valid"],
  outputCommandTypes: ["set_frame_overlap_policy", "add_frame"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    const unit = context.fixture.working.document.units.find((candidate) => candidate.id === input.unitId);
    if (!unit) throw new Error(`missing PresentationUnit: ${input.unitId}`);
    assertPageRoleAllows(unit, "frame");
    const geometry = input.geometry ?? availableFrameGeometry(unit, input.position!);
    if (input.geometry) {
      assertFrameGeometry(unit, geometry, { allowOverlap: input.allowOverlap });
    }
    const frame = createEmptyFrame(context, unit, geometry, input.name);
    return [
      ...(input.allowOverlap && unit.layoutPolicy.frameOverlap !== "allow"
        ? [{ type: "set_frame_overlap_policy" as const, unitId: unit.id, frameOverlap: "allow" as const }]
        : []),
      {
        type: "add_frame",
        unitId: unit.id,
        frame,
        readingIndex: input.readingIndex ?? readingIndexForGeometry(context, unit, geometry),
      },
    ];
  },
});

const duplicateFrameCapability = defineCapability({
  id: "duplicate_frame",
  version: 1,
  inputSchema: z.strictObject({ unitId: z.string().min(1), frameId: z.string().min(1) }),
  scope: "frame",
  humanEntry: "available",
  agentAccess: "disabled",
  externalAgentAccess: "execute",
  risk: "medium",
  preconditions: ["frame_exists", "duplicate_fits_available_surface", "resulting_document_is_valid"],
  outputCommandTypes: ["add_dialogue", "add_frame", "create_frame_storyboard_beat"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    const { unit, frame } = findFrame(context, input.unitId, input.frameId);
    assertPageRoleAllows(unit, "frame");
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
  externalAgentAccess: "execute",
  risk: "high",
  preconditions: ["frame_exists", "storyboard_beat_is_preserved_as_unplaced"],
  outputCommandTypes: ["remove_frame", "remove_dialogue"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    const { unit, frame } = findFrame(context, input.unitId, input.frameId);
    const anchoredOverlayElements = unit.overlayLayers.filter((layer) => layer.anchor.type === "frame" && layer.anchor.frameId === frame.id).flatMap((layer) => layer.elements);
    const dialogueIds = new Set([...frame.layers.flatMap((layer) => [...layer.elements] as FrameElement[]), ...anchoredOverlayElements].flatMap((element) => element.kind === "balloon" ? [element.dialogueId] : []));
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
  version: 2,
  inputSchema: frameImageInputSchema.extend({
    transform: geometrySchema.optional(),
    crop: normalizedRectSchema.optional(),
  }),
  scope: "frame",
  humanEntry: "available",
  agentAccess: "preview",
  externalAgentAccess: "execute",
  risk: "low",
  preconditions: ["frame_exists", "frame_has_no_primary_art", "asset_version_is_fixed"],
  outputCommandTypes: ["declare_resource", "add_frame_layer", "add_layer_element"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    const { unit, frame } = findFrame(context, input.unitId, input.frameId);
    assertPageRoleAllows(unit, "dialogue");
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
    const element: ArtElement = {
      id: context.createId("image"),
      kind: "image",
      assetId: input.assetId,
      assetVersionId: input.assetVersionId,
      transform: input.transform ?? { x: 0, y: 0, width: 1, height: 1 },
      crop: input.crop ?? { x: 0, y: 0, width: 1, height: 1 },
      name: "格内主图",
    };
    commands.push({ type: "add_layer_element", unitId: input.unitId, frameId: input.frameId, layerId: artLayer.id, element });
    return commands;
  },
});

const replaceFrameImageCapability = defineCapability({
  id: "replace_frame_image",
  version: 1,
  inputSchema: frameImageInputSchema.extend({ frameId: z.string().min(1).optional(), layerId: z.string().min(1), elementId: z.string().min(1) }),
  scope: "element",
  humanEntry: "available",
  agentAccess: "preview",
  risk: "low",
  preconditions: ["frame_art_element_exists", "asset_version_is_fixed"],
  outputCommandTypes: ["declare_resource", "remove_layer_element", "add_layer_element"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    if (!input.frameId) throw new Error("纸面、破格、跨页和跨段图片不能直接更换，请先删除后重新放入");
    const { element } = findFrameElement(context, input.unitId, input.frameId, input.layerId, input.elementId);
    if (element.kind !== "image") throw new Error(`missing ArtElement: ${input.elementId}`);
    const commands: WorkspaceCommand[] = [];
    if (!context.fixture.working.document.resources.some((resource) => resource.assetId === input.assetId && resource.assetVersionId === input.assetVersionId)) {
      commands.push({ type: "declare_resource", resource: { assetId: input.assetId, assetVersionId: input.assetVersionId, kind: "image", mediaType: input.mediaType, width: input.width, height: input.height } });
    }
    const replacement: ArtElement = { ...structuredClone(element), assetId: input.assetId, assetVersionId: input.assetVersionId, crop: { x: 0, y: 0, width: 1, height: 1 } };
    commands.push(...[
      { type: "remove_layer_element" as const, unitId: input.unitId, frameId: input.frameId, layerId: input.layerId, elementId: input.elementId },
      { type: "add_layer_element" as const, unitId: input.unitId, frameId: input.frameId, layerId: input.layerId, element: replacement },
    ]);
    return commands;
  },
});

const replaceImageCapability = defineCapability({
  id: "replace_image",
  version: 1,
  inputSchema: frameImageInputSchema.extend({
    frameId: z.string().min(1).optional(),
    layerId: z.string().min(1),
    elementId: z.string().min(1),
  }),
  scope: "element",
  humanEntry: "available",
  agentAccess: "disabled",
  externalAgentAccess: "execute",
  risk: "low",
  preconditions: ["art_element_exists", "asset_version_is_fixed"],
  outputCommandTypes: ["declare_resource", "remove_layer_element", "add_layer_element", "remove_overlay_element", "add_overlay_element"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    const { element } = findLocatedElement(context, input);
    if (element.kind !== "image") throw new Error(`missing ArtElement: ${input.elementId}`);
    const commands: WorkspaceCommand[] = [];
    if (!context.fixture.working.document.resources.some((resource) => resource.assetId === input.assetId && resource.assetVersionId === input.assetVersionId)) {
      commands.push({ type: "declare_resource", resource: { assetId: input.assetId, assetVersionId: input.assetVersionId, kind: "image", mediaType: input.mediaType, width: input.width, height: input.height } });
    }
    const replacement: ArtElement = {
      ...structuredClone(element),
      assetId: input.assetId,
      assetVersionId: input.assetVersionId,
    };
    if (input.frameId) {
      commands.push(
        { type: "remove_layer_element", unitId: input.unitId, frameId: input.frameId, layerId: input.layerId, elementId: input.elementId },
        { type: "add_layer_element", unitId: input.unitId, frameId: input.frameId, layerId: input.layerId, element: replacement },
      );
    } else {
      commands.push(
        { type: "remove_overlay_element", unitId: input.unitId, layerId: input.layerId, elementId: input.elementId },
        { type: "add_overlay_element", unitId: input.unitId, layerId: input.layerId, element: replacement },
      );
    }
    return commands;
  },
});

const removeFrameImageCapability = defineCapability({
  id: "remove_frame_image",
  version: 1,
  inputSchema: z.strictObject({ unitId: z.string().min(1), frameId: z.string().min(1).optional(), layerId: z.string().min(1), elementId: z.string().min(1) }),
  scope: "element",
  humanEntry: "available",
  agentAccess: "disabled",
  externalAgentAccess: "execute",
  risk: "low",
  preconditions: ["art_element_exists"],
  outputCommandTypes: ["remove_layer_element", "remove_overlay_element", "remove_overlay_layer"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    const located = findLocatedElement(context, input);
    const { element } = located;
    if (element.kind !== "image") throw new Error(`missing ArtElement: ${input.elementId}`);
    if (input.frameId) return [{ type: "remove_layer_element", ...input, frameId: input.frameId }];
    return [
      { type: "remove_overlay_element", unitId: input.unitId, layerId: input.layerId, elementId: input.elementId },
      ...(located.layer.elements.length === 1 ? [{ type: "remove_overlay_layer" as const, unitId: input.unitId, layerId: input.layerId }] : []),
    ];
  },
});

const createDialogueBalloonCapability = defineCapability({
  id: "create_dialogue_balloon",
  version: 1,
  inputSchema: z.strictObject({ unitId: z.string().min(1), frameId: z.string().min(1), position: z.strictObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }), content: z.string().max(2000).optional() }),
  scope: "frame",
  humanEntry: "available",
  agentAccess: "disabled",
  externalAgentAccess: "execute",
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

const createPageImageCapability = defineCapability({
  id: "create_page_image",
  version: 3,
  inputSchema: z.strictObject({
    unitId: z.string().min(1),
    position: z.strictObject({ x: z.number(), y: z.number() }).optional(),
    geometry: geometrySchema.optional(),
    surfaceId: z.string().min(1).optional(),
    assetId: z.string().min(1),
    assetVersionId: z.string().min(1),
    mediaType: z.string().startsWith("image/"),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    crop: normalizedRectSchema.optional(),
  }).superRefine((input, context) => {
    if (!input.position && !input.geometry) {
      context.addIssue({ code: "custom", message: "position 与 geometry 至少需要提供一个。" });
    }
  }),
  scope: "unit",
  humanEntry: "available",
  agentAccess: "disabled",
  externalAgentAccess: "execute",
  risk: "low",
  preconditions: ["presentation_unit_exists", "asset_version_is_fixed", "resulting_document_is_valid"],
  outputCommandTypes: ["declare_resource", "add_overlay_layer", "add_overlay_element"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    const unit = context.fixture.working.document.units.find((item) => item.id === input.unitId);
    if (!unit) throw new Error(`missing PresentationUnit: ${input.unitId}`);
    const targetPoint = input.position ?? {
      x: input.geometry!.x + input.geometry!.width / 2,
      y: input.geometry!.y + input.geometry!.height / 2,
    };
    const surface = input.surfaceId
      ? unit.surfaces.find((candidate) => candidate.id === input.surfaceId)
      : surfaceAt(unit, targetPoint);
    if (!surface) throw new Error("页面没有可放置图片的纸面");
    if (input.geometry && !containsGeometry(surface.geometry, input.geometry)) {
      throw new Error("纸面图片必须完整位于目标纸面内");
    }
    const overlay = overlayLayerFor(context, unit, { type: "unit" }, "page_content", "纸面内容", surface.id);
    const elementWidth = Math.min(surface.geometry.width * .42, Math.max(120, surface.geometry.width * .3));
    const sourceRatio = input.width && input.height ? input.height / input.width : .75;
    const elementHeight = Math.min(surface.geometry.height * .42, elementWidth * sourceRatio);
    const coverImage = unit.pageRole === "cover";
    const element: ArtElement = {
      id: context.createId("page-image"), kind: "image", assetId: input.assetId, assetVersionId: input.assetVersionId,
      transform: coverImage
        ? { x: surface.geometry.x, y: surface.geometry.y, width: surface.geometry.width, height: surface.geometry.height }
        : input.geometry
          ? input.geometry
          : { x: clamp(targetPoint.x - elementWidth / 2, surface.geometry.x, surface.geometry.x + surface.geometry.width - elementWidth), y: clamp(targetPoint.y - elementHeight / 2, surface.geometry.y, surface.geometry.y + surface.geometry.height - elementHeight), width: elementWidth, height: elementHeight },
      crop: input.crop ?? { x: 0, y: 0, width: 1, height: 1 }, name: "纸面图片",
    };
    const commands: WorkspaceCommand[] = [];
    if (!context.fixture.working.document.resources.some((resource) => resource.assetId === input.assetId && resource.assetVersionId === input.assetVersionId)) {
      commands.push({ type: "declare_resource", resource: { assetId: input.assetId, assetVersionId: input.assetVersionId, kind: "image", mediaType: input.mediaType, width: input.width, height: input.height } });
    }
    if (overlay.command) commands.push(overlay.command);
    commands.push({ type: "add_overlay_element", unitId: unit.id, layerId: overlay.layer.id, element });
    return commands;
  },
});

const setCoverPageImageCapability = defineCapability({
  id: "set_cover_page_image",
  version: 1,
  inputSchema: z.strictObject({
    assetId: z.string().min(1),
    assetVersionId: z.string().min(1),
    mediaType: z.string().startsWith("image/"),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
  }),
  scope: "chapter",
  humanEntry: "available",
  agentAccess: "disabled",
  risk: "medium",
  preconditions: ["page_comic", "asset_version_is_fixed"],
  outputCommandTypes: ["declare_resource", "add_presentation_unit", "add_overlay_layer", "add_overlay_element", "remove_overlay_element"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    const document = context.fixture.working.document;
    if (document.format !== "page") throw new Error("封面页只支持页漫");
    const commands: WorkspaceCommand[] = [];
    let cover = document.units.find((unit) => unit.pageRole === "cover");
    if (!cover) {
      const reference = document.units.find((unit) => unit.id === document.reading.unitOrder.at(-1));
      const canvas = reference ? structuredClone(reference.kind === "spread" ? { width: reference.surfaces[0]?.geometry.width ?? 720, height: reference.canvas.height, background: reference.canvas.background } : reference.canvas) : { width: 720, height: 1080, background: { color: "#ffffff" } };
      const id = context.createId("cover-page");
      cover = { id, kind: "single_page", pageRole: "cover", canvas, surfaces: [{ id: `${id}-surface`, role: "single", geometry: { x: 0, y: 0, width: canvas.width, height: canvas.height }, pageNumber: 1 }], frames: [], overlayLayers: [], readingSequence: [], layoutPolicy: { frameOverlap: "forbid", defaultOverflow: "clip" } };
      commands.push({ type: "add_presentation_unit", unit: cover, readingIndex: 0 });
    }
    if (!document.resources.some((resource) => resource.assetId === input.assetId && resource.assetVersionId === input.assetVersionId)) commands.push({ type: "declare_resource", resource: { assetId: input.assetId, assetVersionId: input.assetVersionId, kind: "image", mediaType: input.mediaType, width: input.width, height: input.height } });
    const existing = cover.overlayLayers.flatMap((layer) => layer.elements.filter((element): element is ArtElement => element.kind === "image").map((element) => ({ layer, element }))).at(0);
    if (existing) commands.push({ type: "remove_overlay_element", unitId: cover.id, layerId: existing.layer.id, elementId: existing.element.id });
    const overlay = overlayLayerFor(context, cover, { type: "unit" }, "page_content", "纸面内容", cover.surfaces[0]?.id);
    if (overlay.command) commands.push(overlay.command);
    commands.push({ type: "add_overlay_element", unitId: cover.id, layerId: overlay.layer.id, element: { id: context.createId("cover-image"), kind: "image", assetId: input.assetId, assetVersionId: input.assetVersionId, transform: { x: 0, y: 0, width: cover.canvas.width, height: cover.canvas.height }, crop: { x: 0, y: 0, width: 1, height: 1 }, name: "封面主图" } });
    return commands;
  },
});

const createPageDialogueBalloonCapability = defineCapability({
  id: "create_page_dialogue_balloon",
  version: 2,
  inputSchema: z.strictObject({ unitId: z.string().min(1), surfaceId: z.string().min(1).optional(), position: z.strictObject({ x: z.number(), y: z.number() }), content: z.string().max(2000).optional() }),
  scope: "unit",
  humanEntry: "available",
  agentAccess: "disabled",
  externalAgentAccess: "execute",
  risk: "low",
  preconditions: ["presentation_unit_exists", "resulting_document_is_valid"],
  outputCommandTypes: ["add_dialogue", "add_overlay_layer", "add_overlay_element"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    const unit = context.fixture.working.document.units.find((item) => item.id === input.unitId);
    if (!unit) throw new Error(`missing PresentationUnit: ${input.unitId}`);
    assertPageRoleAllows(unit, "dialogue");
    const surface = input.surfaceId
      ? unit.surfaces.find((candidate) => candidate.id === input.surfaceId)
      : surfaceAt(unit, input.position);
    if (!surface) throw new Error("页面没有可放置对白的纸面");
    if (input.position.x < surface.geometry.x || input.position.x > surface.geometry.x + surface.geometry.width
      || input.position.y < surface.geometry.y || input.position.y > surface.geometry.y + surface.geometry.height) {
      throw new Error("纸面对白的位置必须位于目标纸面内");
    }
    const overlay = overlayLayerFor(context, unit, { type: "unit" }, "page_content", "纸面内容", surface.id);
    const dialogueId = context.createId("dialogue");
    const width = Math.min(280, unit.canvas.width * .34);
    const height = Math.min(180, unit.canvas.height * .16);
    const balloon: BalloonElement = {
      id: context.createId("page-balloon"), kind: "balloon", dialogueId,
      transform: { x: clamp(input.position.x - width / 2, surface.geometry.x, surface.geometry.x + surface.geometry.width - width), y: clamp(input.position.y - height / 2, surface.geometry.y, surface.geometry.y + surface.geometry.height - height), width, height },
      tailTarget: { x: clamp(input.position.x + width * .3, surface.geometry.x, surface.geometry.x + surface.geometry.width), y: clamp(input.position.y + height * .8, surface.geometry.y, surface.geometry.y + surface.geometry.height) },
      shape: "normal", name: "纸面对白",
      style: { fontFamily: "ui-sans-serif", fontSize: 18, textColor: "#172026", fill: "#ffffff", stroke: "#111111", strokeWidth: 3 },
    };
    return [
      { type: "add_dialogue", dialogue: { id: dialogueId, content: input.content ?? "新对白" } },
      ...(overlay.command ? [overlay.command] : []),
      { type: "add_overlay_element", unitId: unit.id, layerId: overlay.layer.id, element: balloon },
    ];
  },
});

export const narrationDefaults = {
  fontSize: 24,
  strokeWidth: 2,
  horizontal: { width: 144, height: 60 },
  vertical: { width: 60, height: 144 },
} as const;

const createNarrationCapability = defineCapability({
  id: "create_narration",
  version: 2,
  inputSchema: z.strictObject({
    unitId: z.string().min(1),
    surfaceId: z.string().min(1).optional(),
    position: z.strictObject({ x: z.number(), y: z.number() }),
    content: z.string().max(4000).optional(),
  }),
  scope: "unit",
  humanEntry: "available",
  agentAccess: "disabled",
  externalAgentAccess: "execute",
  risk: "low",
  preconditions: ["presentation_unit_exists", "resulting_document_is_valid"],
  outputCommandTypes: ["add_overlay_layer", "add_overlay_element"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    const unit = context.fixture.working.document.units.find((item) => item.id === input.unitId);
    if (!unit) throw new Error(`missing PresentationUnit: ${input.unitId}`);
    const surface = input.surfaceId
      ? unit.surfaces.find((candidate) => candidate.id === input.surfaceId)
      : surfaceAt(unit, input.position);
    if (!surface) throw new Error("页面没有可放置旁白的纸面");
    if (input.position.x < surface.geometry.x || input.position.x > surface.geometry.x + surface.geometry.width
      || input.position.y < surface.geometry.y || input.position.y > surface.geometry.y + surface.geometry.height) {
      throw new Error("旁白的位置必须位于目标纸面内");
    }
    const overlay = overlayLayerFor(context, unit, { type: "unit" }, "narration", "旁白", surface.id);
    const width = Math.min(narrationDefaults.horizontal.width, surface.geometry.width);
    const height = Math.min(narrationDefaults.horizontal.height, surface.geometry.height);
    const element: TextElement = {
      id: context.createId("narration"),
      kind: "text",
      transform: {
        x: clamp(input.position.x - width / 2, surface.geometry.x, surface.geometry.x + surface.geometry.width - width),
        y: clamp(input.position.y - height / 2, surface.geometry.y, surface.geometry.y + surface.geometry.height - height),
        width,
        height,
      },
      content: input.content ?? "请输入文本",
      role: "narration",
      name: "旁白",
      style: {
        fontFamily: "ui-sans-serif",
        fontSize: narrationDefaults.fontSize,
        fontWeight: 700,
        color: "#111111",
        stroke: "#ffffff",
        strokeWidth: narrationDefaults.strokeWidth,
        align: "left",
        writingMode: "horizontal",
      },
    };
    return [
      ...(overlay.command ? [overlay.command] : []),
      { type: "add_overlay_element", unitId: unit.id, layerId: overlay.layer.id, element },
    ];
  },
});

function findNarration(context: EditorCapabilityContext, input: { unitId: string; layerId: string; elementId: string }) {
  const located = findOverlayElement(context, input.unitId, input.layerId, input.elementId);
  if (located.layer.purpose !== "narration" || located.layer.anchor.type !== "unit" || located.element.kind !== "text" || located.element.role !== "narration") {
    throw new Error(`missing Narration TextElement: ${input.elementId}`);
  }
  return { ...located, element: located.element as TextElement & { transform: Geometry } };
}

const updateNarrationCapability = defineCapability({
  id: "update_narration",
  version: 1,
  inputSchema: z.strictObject({
    unitId: z.string().min(1), layerId: z.string().min(1), elementId: z.string().min(1),
    changes: z.strictObject({
      content: z.string().max(4000).optional(),
      fontFamily: z.string().trim().min(1).max(160).optional(),
      fontSize: z.number().min(6).max(240).optional(),
      fontWeight: z.number().min(100).max(900).optional(),
      color: z.string().min(1).max(64).optional(),
      stroke: z.string().min(1).max(64).optional(),
      strokeWidth: z.number().min(0).max(48).optional(),
      align: z.enum(["left", "center", "right"]).optional(),
      writingMode: z.enum(["horizontal", "vertical"]).optional(),
    }).refine((value) => Object.keys(value).length > 0),
  }),
  scope: "element",
  humanEntry: "available",
  agentAccess: "disabled",
  externalAgentAccess: "execute",
  risk: "low",
  preconditions: ["narration_exists", "resulting_document_is_valid"],
  outputCommandTypes: ["update_text_element", "set_element_transform"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    const { unit, layer, element } = findNarration(context, input);
    const commands: WorkspaceCommand[] = [{ type: "update_text_element", ...input }];
    const nextWritingMode = input.changes.writingMode;
    const currentWritingMode = element.style.writingMode ?? "horizontal";
    if (nextWritingMode && nextWritingMode !== currentWritingMode) {
      const source = narrationDefaults[currentWritingMode];
      const target = narrationDefaults[nextWritingMode];
      const surface = layer.surfaceId ? unit.surfaces.find((candidate) => candidate.id === layer.surfaceId) : undefined;
      const bounds = surface?.geometry ?? { x: 0, y: 0, width: unit.canvas.width, height: unit.canvas.height };
      const width = Math.min(bounds.width, element.transform.width > source.width + .5 ? element.transform.width : target.width);
      const height = Math.min(bounds.height, element.transform.height > source.height + .5 ? element.transform.height : target.height);
      const centerX = element.transform.x + element.transform.width / 2;
      const centerY = element.transform.y + element.transform.height / 2;
      commands.push({
        type: "set_element_transform",
        unitId: unit.id,
        layerId: input.layerId,
        elementId: input.elementId,
        transform: {
          ...element.transform,
          x: clamp(centerX - width / 2, bounds.x, bounds.x + bounds.width - width),
          y: clamp(centerY - height / 2, bounds.y, bounds.y + bounds.height - height),
          width,
          height,
        },
      });
    }
    return commands;
  },
});

const duplicateNarrationCapability = defineCapability({
  id: "duplicate_narration",
  version: 1,
  inputSchema: z.strictObject({ unitId: z.string().min(1), layerId: z.string().min(1), elementId: z.string().min(1) }),
  scope: "element",
  humanEntry: "available",
  agentAccess: "disabled",
  externalAgentAccess: "execute",
  risk: "low",
  preconditions: ["narration_exists", "resulting_document_is_valid"],
  outputCommandTypes: ["add_overlay_element"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    const { unit, layer, element } = findNarration(context, input);
    const surface = layer.surfaceId ? unit.surfaces.find((candidate) => candidate.id === layer.surfaceId) : undefined;
    const bounds = surface?.geometry ?? { x: 0, y: 0, width: unit.canvas.width, height: unit.canvas.height };
    const duplicate: TextElement = {
      ...structuredClone(element),
      id: context.createId("narration"),
      name: "旁白 副本",
      transform: {
        ...element.transform,
        x: clamp(element.transform.x + 18, bounds.x, bounds.x + bounds.width - element.transform.width),
        y: clamp(element.transform.y + 18, bounds.y, bounds.y + bounds.height - element.transform.height),
      },
    };
    return [{ type: "add_overlay_element", unitId: unit.id, layerId: input.layerId, element: duplicate }];
  },
});

const deleteNarrationCapability = defineCapability({
  id: "delete_narration",
  version: 1,
  inputSchema: z.strictObject({ unitId: z.string().min(1), layerId: z.string().min(1), elementId: z.string().min(1) }),
  scope: "element",
  humanEntry: "available",
  agentAccess: "disabled",
  externalAgentAccess: "execute",
  risk: "low",
  preconditions: ["narration_exists"],
  outputCommandTypes: ["remove_overlay_element", "remove_overlay_layer"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    const { unit, layer } = findNarration(context, input);
    return [
      { type: "remove_overlay_element", unitId: unit.id, layerId: layer.id, elementId: input.elementId },
      ...(layer.elements.length === 1 ? [{ type: "remove_overlay_layer" as const, unitId: unit.id, layerId: layer.id }] : []),
    ];
  },
});

const promoteElementToOverlayCapability = defineCapability({
  id: "promote_element_to_overlay",
  version: 1,
  inputSchema: z.strictObject({ unitId: z.string().min(1), frameId: z.string().min(1), layerId: z.string().min(1), elementId: z.string().min(1) }),
  scope: "element",
  humanEntry: "available",
  agentAccess: "disabled",
  externalAgentAccess: "execute",
  risk: "medium",
  preconditions: ["frame_element_exists", "resulting_document_is_valid"],
  outputCommandTypes: ["remove_layer_element", "add_overlay_layer", "add_overlay_element"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    const { unit, element } = findFrameElement(context, input.unitId, input.frameId, input.layerId, input.elementId);
    const overlay = overlayLayerFor(context, unit, { type: "frame", frameId: input.frameId }, "breakout", "破格内容");
    return [
      { type: "remove_layer_element", ...input },
      ...(overlay.command ? [overlay.command] : []),
      { type: "add_overlay_element", unitId: unit.id, layerId: overlay.layer.id, element: structuredClone(element) as OverlayElement },
    ];
  },
});

const convertElementToPageCapability = defineCapability({
  id: "convert_element_to_page",
  version: 1,
  inputSchema: z.strictObject({ unitId: z.string().min(1), frameId: z.string().min(1).optional(), layerId: z.string().min(1), elementId: z.string().min(1) }),
  scope: "element",
  humanEntry: "available",
  agentAccess: "disabled",
  externalAgentAccess: "execute",
  risk: "medium",
  preconditions: ["frame_breakout_or_cross_surface_element_exists", "resulting_document_is_valid"],
  outputCommandTypes: ["remove_layer_element", "remove_overlay_element", "remove_overlay_layer", "add_overlay_layer", "add_overlay_element"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    const commands: WorkspaceCommand[] = [];
    let unit: PresentationUnit;
    let element: FrameElement | OverlayElement;
    let unitGeometry: Geometry;
    let unitTail: { x: number; y: number } | undefined;
    if (input.frameId) {
      const located = findFrameElement(context, input.unitId, input.frameId, input.layerId, input.elementId);
      unit = located.unit;
      element = located.element;
      unitGeometry = resolveLocalTransform(located.frame.geometry, element.transform);
      unitTail = element.kind === "balloon" && element.tailTarget ? { x: located.frame.geometry.x + element.tailTarget.x * located.frame.geometry.width, y: located.frame.geometry.y + element.tailTarget.y * located.frame.geometry.height } : undefined;
      commands.push({ type: "remove_layer_element", unitId: unit.id, frameId: located.frame.id, layerId: located.layer.id, elementId: element.id });
    } else {
      const located = findOverlayElement(context, input.unitId, input.layerId, input.elementId);
      unit = located.unit;
      element = located.element;
      const anchor = located.layer.anchor;
      if (anchor.type === "unit") {
        if (located.layer.purpose !== "cross_page" && located.layer.purpose !== "cross_segment") throw new Error("对象已经属于纸面");
        unitGeometry = element.transform;
        unitTail = element.kind === "balloon" ? element.tailTarget : undefined;
      } else {
        const anchorFrame = unit.frames.find((frame) => frame.id === anchor.frameId);
        if (!anchorFrame) throw new Error(`missing Frame: ${anchor.frameId}`);
        unitGeometry = resolveLocalTransform(anchorFrame.geometry, element.transform);
        unitTail = element.kind === "balloon" && element.tailTarget ? { x: anchorFrame.geometry.x + element.tailTarget.x * anchorFrame.geometry.width, y: anchorFrame.geometry.y + element.tailTarget.y * anchorFrame.geometry.height } : undefined;
      }
      commands.push({ type: "remove_overlay_element", unitId: unit.id, layerId: located.layer.id, elementId: element.id });
      if (located.layer.elements.length === 1) commands.push({ type: "remove_overlay_layer", unitId: unit.id, layerId: located.layer.id });
    }
    const surface = surfaceAt(unit, { x: unitGeometry.x + unitGeometry.width / 2, y: unitGeometry.y + unitGeometry.height / 2 });
    if (!surface) throw new Error("页面没有可承载对象的纸面");
    const width = Math.min(unitGeometry.width, surface.geometry.width);
    const height = Math.min(unitGeometry.height, surface.geometry.height);
    const fittedGeometry = {
      ...unitGeometry,
      x: clamp(unitGeometry.x, surface.geometry.x, surface.geometry.x + surface.geometry.width - width),
      y: clamp(unitGeometry.y, surface.geometry.y, surface.geometry.y + surface.geometry.height - height),
      width,
      height,
    };
    const nextElement = { ...structuredClone(element), transform: fittedGeometry } as OverlayElement;
    if (nextElement.kind === "balloon" && unitTail) nextElement.tailTarget = unitTail;
    const target = overlayLayerFor(context, unit, { type: "unit" }, "page_content", "纸面内容", surface.id);
    if (target.command) commands.push(target.command);
    commands.push({ type: "add_overlay_element", unitId: unit.id, layerId: target.layer.id, element: nextElement });
    return commands;
  },
});

const returnElementToFrameCapability = defineCapability({
  id: "return_element_to_frame",
  version: 1,
  inputSchema: z.strictObject({ unitId: z.string().min(1), layerId: z.string().min(1), elementId: z.string().min(1), frameId: z.string().min(1), replaceExistingImage: z.boolean().optional() }),
  scope: "element",
  humanEntry: "available",
  agentAccess: "disabled",
  risk: "medium",
  preconditions: ["overlay_element_exists", "target_frame_exists", "image_return_requires_empty_frame_art_slot", "resulting_document_is_valid"],
  outputCommandTypes: ["remove_overlay_element", "remove_overlay_layer", "remove_layer_element", "add_frame_layer", "add_layer_element"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    const { unit, layer, element } = findOverlayElement(context, input.unitId, input.layerId, input.elementId);
    const frame = unit.frames.find((item) => item.id === input.frameId);
    if (!frame) throw new Error(`missing Frame: ${input.frameId}`);
    const existingImage = element.kind === "image" ? frame.layers.flatMap((frameLayer) => frameLayer.elements.map((frameElement) => ({ frameLayer, frameElement }))).find(({ frameElement }) => frameElement.kind === "image") : undefined;
    if (existingImage && !input.replaceExistingImage) {
      throw new Error("画格内已有图片，请先移除当前格内图片后再收回");
    }
    const anchor = layer.anchor;
    const anchorFrame = anchor.type === "frame" ? unit.frames.find((item) => item.id === anchor.frameId) : undefined;
    const unitGeometry = anchorFrame ? resolveLocalTransform(anchorFrame.geometry, element.transform) : element.transform;
    const nextElement = { ...structuredClone(element), transform: element.kind === "image" ? { x: 0, y: 0, width: 1, height: 1 } : deriveLocalTransform(frame.geometry, unitGeometry) } as FrameElement;
    if (nextElement.kind === "balloon" && nextElement.tailTarget) {
      const unitTail = anchorFrame ? { x: anchorFrame.geometry.x + nextElement.tailTarget.x * anchorFrame.geometry.width, y: anchorFrame.geometry.y + nextElement.tailTarget.y * anchorFrame.geometry.height } : nextElement.tailTarget;
      nextElement.tailTarget = { x: (unitTail.x - frame.geometry.x) / frame.geometry.width, y: (unitTail.y - frame.geometry.y) / frame.geometry.height };
    }
    const kind: FrameLayer["kind"] = nextElement.kind === "image" ? "art" : nextElement.kind === "effect" ? "effect" : "text";
    let targetLayer = frame.layers.find((item) => item.kind === kind);
    const commands: WorkspaceCommand[] = [{ type: "remove_overlay_element", unitId: unit.id, layerId: layer.id, elementId: element.id }];
    if (layer.elements.length === 1) commands.push({ type: "remove_overlay_layer", unitId: unit.id, layerId: layer.id });
    if (existingImage) commands.push({ type: "remove_layer_element", unitId: unit.id, frameId: frame.id, layerId: existingImage.frameLayer.id, elementId: existingImage.frameElement.id });
    if (!targetLayer) {
      targetLayer = { id: context.createId(`${kind}-layer`), kind, name: kind === "art" ? "画面" : kind === "text" ? "对白" : "效果", zIndex: kind === "art" ? 10 : kind === "text" ? 20 : 30, visible: true, overflow: kind === "art" ? "clip" : "visible", elements: [] } as FrameLayer;
      commands.push({ type: "add_frame_layer", unitId: unit.id, frameId: frame.id, layer: targetLayer });
    }
    commands.push({ type: "add_layer_element", unitId: unit.id, frameId: frame.id, layerId: targetLayer.id, element: nextElement });
    return commands;
  },
});

const reorderOverlayElementCapability = defineCapability({
  id: "reorder_overlay_element",
  version: 1,
  inputSchema: z.strictObject({ unitId: z.string().min(1), layerId: z.string().min(1), elementId: z.string().min(1), position: z.enum(["front", "back"]) }),
  scope: "element",
  humanEntry: "available",
  agentAccess: "disabled",
  externalAgentAccess: "execute",
  risk: "low",
  preconditions: ["overlay_element_exists"],
  outputCommandTypes: ["reorder_overlay_layer", "remove_overlay_element", "remove_overlay_layer", "add_overlay_layer", "add_overlay_element"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    const { unit, layer, element } = findOverlayElement(context, input.unitId, input.layerId, input.elementId);
    const levels = [...unit.frames.map((frame) => frame.zIndex), ...unit.overlayLayers.map((overlay) => overlay.zIndex)];
    const zIndex = input.position === "front" ? Math.max(0, ...levels) + 1 : Math.min(0, ...levels) - 1;
    if (layer.elements.length === 1) return [{ type: "reorder_overlay_layer", unitId: unit.id, layerId: layer.id, zIndex }];
    const detachedLayer: UnitOverlayLayer = { ...structuredClone(layer), id: context.createId(`${layer.purpose}-overlay`), zIndex, elements: [] };
    return [
      { type: "remove_overlay_element", unitId: unit.id, layerId: layer.id, elementId: element.id },
      { type: "add_overlay_layer", unitId: unit.id, layer: detachedLayer },
      { type: "add_overlay_element", unitId: unit.id, layerId: detachedLayer.id, element: structuredClone(element) },
    ];
  },
});

const duplicateDialogueBalloonCapability = defineCapability({
  id: "duplicate_dialogue_balloon",
  version: 1,
  inputSchema: z.strictObject({ unitId: z.string().min(1), frameId: z.string().min(1).optional(), layerId: z.string().min(1), elementId: z.string().min(1) }),
  scope: "element",
  humanEntry: "available",
  agentAccess: "disabled",
  externalAgentAccess: "execute",
  risk: "low",
  preconditions: ["balloon_element_exists", "dialogue_exists"],
  outputCommandTypes: ["add_dialogue", "add_layer_element", "add_overlay_element"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    const located = findLocatedElement(context, input);
    const { element } = located;
    if (element.kind !== "balloon") throw new Error(`missing BalloonElement: ${input.elementId}`);
    const sourceDialogue = context.fixture.working.document.dialogues.find((dialogue) => dialogue.id === element.dialogueId);
    if (!sourceDialogue) throw new Error(`missing Dialogue: ${element.dialogueId}`);
    const dialogueId = context.createId("dialogue");
    const constrainedSurfaceId = !input.frameId && "surfaceId" in located.layer ? located.layer.surfaceId : undefined;
    const constrainedSurface = constrainedSurfaceId
      ? located.unit.surfaces.find((surface) => surface.id === constrainedSurfaceId)
      : undefined;
    const limit = input.frameId
      ? { x: 0, y: 0, width: 1, height: 1, offset: .05 }
      : {
          x: constrainedSurface?.geometry.x ?? 0,
          y: constrainedSurface?.geometry.y ?? 0,
          width: constrainedSurface?.geometry.width ?? located.unit.canvas.width,
          height: constrainedSurface?.geometry.height ?? located.unit.canvas.height,
          offset: 18,
        };
    const balloon: BalloonElement = {
      ...structuredClone(element),
      id: context.createId("balloon"),
      dialogueId,
      name: `${element.name ?? "对白"} 副本`,
      transform: {
        ...element.transform,
        x: clamp(element.transform.x + limit.offset, limit.x, limit.x + limit.width - element.transform.width),
        y: clamp(element.transform.y + limit.offset, limit.y, limit.y + limit.height - element.transform.height),
      },
    };
    return [
      { type: "add_dialogue", dialogue: { ...structuredClone(sourceDialogue), id: dialogueId } },
      input.frameId
        ? { type: "add_layer_element", unitId: input.unitId, frameId: input.frameId, layerId: input.layerId, element: balloon }
        : { type: "add_overlay_element", unitId: input.unitId, layerId: input.layerId, element: balloon },
    ];
  },
});

const deleteDialogueBalloonCapability = defineCapability({
  id: "delete_dialogue_balloon",
  version: 1,
  inputSchema: z.strictObject({ unitId: z.string().min(1), frameId: z.string().min(1).optional(), layerId: z.string().min(1), elementId: z.string().min(1) }),
  scope: "element",
  humanEntry: "available",
  agentAccess: "disabled",
  externalAgentAccess: "execute",
  risk: "low",
  preconditions: ["balloon_element_exists"],
  outputCommandTypes: ["remove_layer_element", "remove_overlay_element", "remove_overlay_layer", "remove_dialogue"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    const located = findLocatedElement(context, input);
    const { element } = located;
    if (element.kind !== "balloon") throw new Error(`missing BalloonElement: ${input.elementId}`);
    return [
      input.frameId
        ? { type: "remove_layer_element", ...input, frameId: input.frameId }
        : { type: "remove_overlay_element", unitId: input.unitId, layerId: input.layerId, elementId: input.elementId },
      ...(!input.frameId && located.layer.elements.length === 1
        ? [{ type: "remove_overlay_layer" as const, unitId: input.unitId, layerId: input.layerId }]
        : []),
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
  externalAgentAccess: "execute",
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
  agentAccess: "preview",
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
  agentAccess: "preview",
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
    frameId: z.string().min(1).optional(),
    layerId: z.string().min(1),
    elementId: z.string().min(1),
    crop: normalizedRectSchema,
  }),
  scope: "element",
  humanEntry: "available",
  agentAccess: "disabled",
  externalAgentAccess: "execute",
  risk: "low",
  preconditions: ["art_element_exists", "crop_is_normalized"],
  outputCommandTypes: ["set_art_crop"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    const unit = context.fixture.working.document.units.find((item) => item.id === input.unitId);
    if (!unit) throw new Error(`missing PresentationUnit: ${input.unitId}`);
    const layer = input.frameId
      ? findFrame(context, input.unitId, input.frameId).frame.layers.find((item) => item.id === input.layerId)
      : unit.overlayLayers.find((item) => item.id === input.layerId);
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
  externalAgentAccess: "execute",
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

const setFrameOverlapPolicyCapability = defineCapability({
  id: "set_frame_overlap_policy",
  version: 1,
  inputSchema: z.strictObject({ unitId: z.string().min(1), frameOverlap: z.enum(["forbid", "allow"]) }),
  scope: "unit",
  humanEntry: "available",
  agentAccess: "disabled",
  externalAgentAccess: "execute",
  risk: "medium",
  preconditions: ["presentation_unit_exists", "forbid_requires_non_overlapping_frames"],
  outputCommandTypes: ["set_frame_overlap_policy"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    const unit = context.fixture.working.document.units.find((item) => item.id === input.unitId);
    if (!unit) throw new Error(`missing PresentationUnit: ${input.unitId}`);
    if (input.frameOverlap === "forbid" && unit.frames.some((frame, index) => unit.frames.slice(index + 1).some((other) => overlaps(frame.geometry, other.geometry)))) {
      throw new Error("当前仍有重叠画格，请先将它们移开再取消叠格");
    }
    return [{ type: "set_frame_overlap_policy", ...input }];
  },
});

const reorderFrameCapability = defineCapability({
  id: "reorder_frame",
  version: 1,
  inputSchema: z.strictObject({ unitId: z.string().min(1), frameId: z.string().min(1), zIndex: z.number().int() }),
  scope: "frame",
  humanEntry: "available",
  agentAccess: "disabled",
  externalAgentAccess: "execute",
  risk: "medium",
  preconditions: ["frame_exists"],
  outputCommandTypes: ["reorder_frame"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    findFrame(context, input.unitId, input.frameId);
    return [{ type: "reorder_frame", ...input }];
  },
});

const reorderFrameReadingCapability = defineCapability({
  id: "reorder_frame_reading",
  version: 1,
  inputSchema: z.strictObject({
    unitId: z.string().min(1),
    frameId: z.string().min(1),
    readingIndex: z.number().int().nonnegative(),
  }),
  scope: "frame",
  humanEntry: "available",
  agentAccess: "disabled",
  externalAgentAccess: "execute",
  risk: "low",
  preconditions: ["frame_exists"],
  outputCommandTypes: ["reorder_frame_reading"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    findFrame(context, input.unitId, input.frameId);
    return [{ type: "reorder_frame_reading", ...input }];
  },
});

const resizeFrameCapability = defineCapability({
  id: "resize_frame",
  version: 2,
  inputSchema: z.strictObject({
    unitId: z.string().min(1),
    frameId: z.string().min(1),
    geometry: geometrySchema,
    allowOverlap: z.boolean().optional(),
  }),
  scope: "frame",
  humanEntry: "available",
  agentAccess: "disabled",
  externalAgentAccess: "execute",
  risk: "low",
  preconditions: ["frame_exists", "resulting_document_is_valid"],
  outputCommandTypes: ["set_frame_overlap_policy", "resize_frame"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    const { unit, frame } = findFrame(context, input.unitId, input.frameId);
    assertFrameGeometry(unit, input.geometry, { frameId: frame.id, surfaceScope: frame.surfaceScope, allowOverlap: input.allowOverlap });
    return [
      ...(input.allowOverlap && unit.layoutPolicy.frameOverlap !== "allow"
        ? [{ type: "set_frame_overlap_policy" as const, unitId: unit.id, frameOverlap: "allow" as const }]
        : []),
      { type: "resize_frame", unitId: input.unitId, frameId: input.frameId, geometry: input.geometry },
    ];
  },
});

const frameCornerPointSchema = z.strictObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) });
const editableFrameShapeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("rect"), radius: z.number().nonnegative().optional() }),
  z.strictObject({ kind: z.literal("polygon"), points: z.tuple([frameCornerPointSchema, frameCornerPointSchema, frameCornerPointSchema, frameCornerPointSchema]) }),
]);

const reshapeFrameCapability = defineCapability({
  id: "reshape_frame",
  version: 2,
  inputSchema: z.strictObject({
    unitId: z.string().min(1),
    frameId: z.string().min(1),
    geometry: geometrySchema,
    shape: editableFrameShapeSchema,
    allowOverlap: z.boolean().optional(),
  }),
  scope: "frame",
  humanEntry: "available",
  agentAccess: "disabled",
  externalAgentAccess: "execute",
  risk: "low",
  preconditions: ["frame_exists", "shape_is_axis_locked_quadrilateral", "resulting_document_is_valid"],
  outputCommandTypes: ["set_frame_overlap_policy", "resize_frame", "set_frame_style"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    const { unit, frame } = findFrame(context, input.unitId, input.frameId);
    assertFrameGeometry(unit, input.geometry, { frameId: frame.id, surfaceScope: frame.surfaceScope, allowOverlap: input.allowOverlap });
    if (input.shape.kind === "polygon") {
      const crossProducts = input.shape.points.map((point, index, points) => {
        const next = points[(index + 1) % points.length];
        const after = points[(index + 2) % points.length];
        return (next.x - point.x) * (after.y - next.y) - (next.y - point.y) * (after.x - next.x);
      });
      if (crossProducts.some((value) => Math.abs(value) < 1e-5) || crossProducts.some((value) => Math.sign(value) !== Math.sign(crossProducts[0]))) {
        throw new Error("画格角点不能交叉或折叠");
      }
      const area = Math.abs(input.shape.points.reduce((sum, point, index, points) => {
        const next = points[(index + 1) % points.length];
        return sum + point.x * next.y - next.x * point.y;
      }, 0)) / 2;
      if (area < .08) throw new Error("画格角度过大，请保留足够的可见区域");
    }
    return [
      ...(input.allowOverlap && unit.layoutPolicy.frameOverlap !== "allow"
        ? [{ type: "set_frame_overlap_policy" as const, unitId: unit.id, frameOverlap: "allow" as const }]
        : []),
      { type: "resize_frame", unitId: input.unitId, frameId: input.frameId, geometry: input.geometry },
      { type: "set_frame_style", unitId: input.unitId, frameId: input.frameId, shape: input.shape },
    ];
  },
});

const updateFrameBorderCapability = defineCapability({
  id: "update_frame_border",
  version: 1,
  inputSchema: z.strictObject({
    unitId: z.string().min(1),
    frameId: z.string().min(1),
    width: z.number().min(0).max(24),
  }),
  scope: "frame",
  humanEntry: "available",
  agentAccess: "disabled",
  externalAgentAccess: "execute",
  risk: "low",
  preconditions: ["frame_exists", "resulting_document_is_valid"],
  outputCommandTypes: ["set_frame_style"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    const { frame } = findFrame(context, input.unitId, input.frameId);
    return [{ type: "set_frame_style", unitId: input.unitId, frameId: input.frameId, border: { ...frame.border, width: input.width } }];
  },
});

const updateFrameBleedCapability = defineCapability({
  id: "update_frame_bleed",
  version: 1,
  inputSchema: z.strictObject({
    unitId: z.string().min(1),
    frameId: z.string().min(1),
    edge: z.enum(["top", "right", "bottom", "left"]),
    enabled: z.boolean(),
  }),
  scope: "frame",
  humanEntry: "available",
  agentAccess: "disabled",
  externalAgentAccess: "execute",
  risk: "low",
  preconditions: ["frame_exists", "surface_exists", "resulting_document_is_valid"],
  outputCommandTypes: ["resize_frame", "set_frame_style"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    const { unit, frame } = findFrame(context, input.unitId, input.frameId);
    if (frame.shape.kind === "ellipse") throw new Error("椭圆画格暂不支持按边出血");
    const current = frame.bleedEdges ?? { top: false, right: false, bottom: false, left: false };
    const bleedEdges = { ...current, [input.edge]: input.enabled };
    const anyBleed = Object.values(bleedEdges).some(Boolean);
    const commands: WorkspaceCommand[] = [];
    if (input.enabled) {
      const center = { x: frame.geometry.x + frame.geometry.width / 2, y: frame.geometry.y + frame.geometry.height / 2 };
      const surface = frame.surfaceScope === "unit"
        ? undefined
        : unit.surfaces.find((item) => center.x >= item.geometry.x && center.x <= item.geometry.x + item.geometry.width && center.y >= item.geometry.y && center.y <= item.geometry.y + item.geometry.height)
          ?? unit.surfaces[0];
      const bounds = surface?.geometry ?? { x: 0, y: 0, width: unit.canvas.width, height: unit.canvas.height };
      const geometry = { ...frame.geometry };
      if (input.edge === "top") { geometry.height += geometry.y - bounds.y; geometry.y = bounds.y; }
      if (input.edge === "right") geometry.width = bounds.x + bounds.width - geometry.x;
      if (input.edge === "bottom") geometry.height = bounds.y + bounds.height - geometry.y;
      if (input.edge === "left") { geometry.width += geometry.x - bounds.x; geometry.x = bounds.x; }
      commands.push({ type: "resize_frame", unitId: input.unitId, frameId: input.frameId, geometry });
    }
    commands.push({
      type: "set_frame_style",
      unitId: input.unitId,
      frameId: input.frameId,
      bleedEdges,
      mask: { mode: anyBleed ? "bleed" : "clip" },
    });
    return commands;
  },
});

const setFrameCrossPageCapability = defineCapability({
  id: "set_frame_cross_page",
  version: 1,
  inputSchema: z.strictObject({ unitId: z.string().min(1), frameId: z.string().min(1), enabled: z.boolean() }),
  scope: "frame",
  humanEntry: "available",
  agentAccess: "disabled",
  risk: "medium",
  preconditions: ["spread_exists", "frame_exists", "surface_scope_is_reversible"],
  outputCommandTypes: ["set_frame_surface_scope"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    const { unit, frame } = findFrame(context, input.unitId, input.frameId);
    if (unit.kind !== "spread") throw new Error("只有真正双页中的画格可以设为跨页格");
    if (input.enabled) {
      if (frame.surfaceScope === "unit") throw new Error("画格已经是跨页格");
      return [{ type: "set_frame_surface_scope", unitId: unit.id, frameId: frame.id, surfaceScope: "unit" }];
    }
    if (frame.surfaceScope !== "unit") throw new Error("画格当前不是跨页格");
    if (!unit.surfaces.some((surface) => containsGeometry(surface.geometry, frame.geometry))) throw new Error("请先将画格完整移入左页或右页，再取消跨页");
    return [{ type: "set_frame_surface_scope", unitId: unit.id, frameId: frame.id, surfaceScope: "surface" }];
  },
});

const setElementTransformCapability = defineCapability({
  id: "set_element_transform",
  version: 1,
  inputSchema: z.strictObject({
    unitId: z.string().min(1),
    frameId: z.string().min(1).optional(),
    layerId: z.string().min(1),
    elementId: z.string().min(1),
    transform: geometrySchema,
  }),
  scope: "element",
  humanEntry: "available",
  agentAccess: "disabled",
  externalAgentAccess: "execute",
  risk: "low",
  preconditions: ["frame_element_exists", "resulting_document_is_valid"],
  outputCommandTypes: ["set_element_transform"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    findLocatedElement(context, input);
    return [{ type: "set_element_transform", ...input }];
  },
});

const balloonChangesInputSchema = balloonElementSchema.pick({
  transform: true,
  tailTarget: true,
  shape: true,
  cutCorners: true,
  style: true,
  overflow: true,
}).partial().strict().refine((changes) => Object.keys(changes).length > 0, "balloon changes cannot be empty");

const updateBalloonCapability = defineCapability({
  id: "update_balloon",
  version: 1,
  inputSchema: z.strictObject({
    unitId: z.string().min(1),
    frameId: z.string().min(1).optional(),
    layerId: z.string().min(1),
    elementId: z.string().min(1),
    changes: balloonChangesInputSchema,
  }),
  scope: "element",
  humanEntry: "available",
  agentAccess: "disabled",
  externalAgentAccess: "execute",
  risk: "low",
  preconditions: ["balloon_element_exists", "resulting_document_is_valid"],
  outputCommandTypes: ["update_balloon"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    const { element } = findLocatedElement(context, input);
    if (element.kind !== "balloon") throw new Error(`missing BalloonElement: ${input.elementId}`);
    const changes = input.changes.shape === "cut_corner" && !input.changes.cutCorners
      ? { ...input.changes, cutCorners: createBalloonCutCorners(`${element.id}:${context.createId("cut-corners")}`) }
      : input.changes;
    return [{ type: "update_balloon", ...input, changes }];
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

function compositeSource(unit: PresentationUnit, surface: PageSurface, dx: number, dy: number): Pick<PresentationUnit, "frames" | "overlayLayers"> {
  return {
    frames: unit.frames.map((frame) => ({ ...structuredClone(frame), geometry: shiftedGeometry(frame.geometry, dx, dy) })),
    overlayLayers: unit.overlayLayers.map((layer) => ({
      ...structuredClone(layer),
      ...(layer.anchor.type === "unit" && layer.purpose !== "cross_page" && layer.purpose !== "cross_segment" && layer.purpose !== "narration" ? { surfaceId: surface.id } : {}),
      elements: layer.anchor.type === "unit" ? layer.elements.map((element) => shiftedOverlayElement(element, dx, dy)) : structuredClone(layer.elements),
    })),
  };
}

function assertMergeablePair(document: EditorCapabilityContext["fixture"]["working"]["document"], unitId: string, nextUnitId: string, kind: "single_page" | "vertical_segment") {
  const index = document.reading.unitOrder.indexOf(unitId);
  if (index < 0 || document.reading.unitOrder[index + 1] !== nextUnitId) throw new Error("只能合并当前展示单元与紧邻的下一项");
  const first = document.units.find((unit) => unit.id === unitId);
  const second = document.units.find((unit) => unit.id === nextUnitId);
  if (!first || !second || first.kind !== kind || second.kind !== kind) throw new Error(kind === "single_page" ? "只能合并两个相邻普通页面" : "只能合并两个相邻滚动段");
  if (kind === "single_page" && (first.pageRole === "cover" || second.pageRole === "cover" || first.pageRole !== second.pageRole)) throw new Error("只能合并两个相邻且页面角色相同的正文页或过场页");
  if (first.surfaces.length !== 1 || second.surfaces.length !== 1) throw new Error(kind === "single_page" ? "真正双页不能再次参与合并" : "已合并的滚动段不能再次参与合并");
  if (kind === "single_page" && (first.canvas.width !== second.canvas.width || first.canvas.height !== second.canvas.height)) throw new Error("两个页面尺寸不同，无法合并为双页");
  if (kind === "vertical_segment" && first.canvas.width !== second.canvas.width) throw new Error("两个滚动段宽度不同，无法合并");
  const firstLayoutBase = { gutter: first.layoutPolicy.gutter, defaultOverflow: first.layoutPolicy.defaultOverflow };
  const secondLayoutBase = { gutter: second.layoutPolicy.gutter, defaultOverflow: second.layoutPolicy.defaultOverflow };
  if (first.canvas.background.color !== second.canvas.background.color || JSON.stringify(firstLayoutBase) !== JSON.stringify(secondLayoutBase)) throw new Error("两个展示单元的背景或基础布局策略不同，无法合并");
  if ([...first.overlayLayers, ...second.overlayLayers].some((layer) => layer.purpose === "cross_page" || layer.purpose === "cross_segment")) throw new Error("已有跨 surface 对象，无法再次合并");
  return { first, second, index };
}

const mergePagesToSpreadCapability = defineCapability({
  id: "merge_pages_to_spread",
  version: 1,
  inputSchema: z.strictObject({ unitId: z.string().min(1), nextUnitId: z.string().min(1) }),
  scope: "chapter",
  humanEntry: "available",
  agentAccess: "disabled",
  externalAgentAccess: "execute",
  risk: "high",
  preconditions: ["adjacent_single_pages_exist", "page_geometry_and_layout_match"],
  outputCommandTypes: ["add_presentation_unit", "remove_presentation_unit"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    const document = context.fixture.working.document;
    if (document.format !== "page") throw new Error("只有页漫可以合并为双页");
    const { first, second, index } = assertMergeablePair(document, input.unitId, input.nextUnitId, "single_page");
    const rtl = document.reading.direction === "rtl";
    const firstSurface = { ...structuredClone(first.surfaces[0]), name: first.name, role: rtl ? "right" as const : "left" as const, geometry: { x: rtl ? first.canvas.width : 0, y: 0, width: first.canvas.width, height: first.canvas.height } };
    const secondSurface = { ...structuredClone(second.surfaces[0]), name: second.name, role: rtl ? "left" as const : "right" as const, geometry: { x: rtl ? 0 : first.canvas.width, y: 0, width: second.canvas.width, height: second.canvas.height } };
    const firstContent = compositeSource(first, firstSurface, firstSurface.geometry.x, 0);
    const secondContent = compositeSource(second, secondSurface, secondSurface.geometry.x, 0);
    const spread: PresentationUnit = {
      id: context.createId("spread"),
      kind: "spread",
      pageRole: first.pageRole,
      canvas: { width: first.canvas.width + second.canvas.width, height: first.canvas.height, background: structuredClone(first.canvas.background) },
      surfaces: [firstSurface, secondSurface],
      frames: [...firstContent.frames, ...secondContent.frames],
      overlayLayers: [...firstContent.overlayLayers, ...secondContent.overlayLayers],
      readingSequence: [...structuredClone(first.readingSequence), ...structuredClone(second.readingSequence)],
      layoutPolicy: { ...structuredClone(first.layoutPolicy), frameOverlap: first.layoutPolicy.frameOverlap === "allow" || second.layoutPolicy.frameOverlap === "allow" ? "allow" : "forbid" },
    };
    return [
      { type: "add_presentation_unit", unit: spread, readingIndex: index },
      { type: "remove_presentation_unit", unitId: first.id },
      { type: "remove_presentation_unit", unitId: second.id },
    ];
  },
});

const mergeVerticalSegmentsCapability = defineCapability({
  id: "merge_vertical_segments",
  version: 1,
  inputSchema: z.strictObject({ unitId: z.string().min(1), nextUnitId: z.string().min(1) }),
  scope: "chapter",
  humanEntry: "available",
  agentAccess: "disabled",
  risk: "high",
  preconditions: ["adjacent_vertical_segments_exist", "segment_width_and_layout_match"],
  outputCommandTypes: ["add_presentation_unit", "remove_presentation_unit"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    const document = context.fixture.working.document;
    if (document.format !== "vertical") throw new Error("只有条漫可以合并滚动段");
    const { first, second, index } = assertMergeablePair(document, input.unitId, input.nextUnitId, "vertical_segment");
    const firstSurface = { ...structuredClone(first.surfaces[0]), name: first.name, role: "segment" as const, geometry: { x: 0, y: 0, width: first.canvas.width, height: first.canvas.height } };
    const secondSurface = { ...structuredClone(second.surfaces[0]), name: second.name, role: "segment" as const, geometry: { x: 0, y: first.canvas.height, width: second.canvas.width, height: second.canvas.height } };
    const firstContent = compositeSource(first, firstSurface, 0, 0);
    const secondContent = compositeSource(second, secondSurface, 0, first.canvas.height);
    const composite: PresentationUnit = {
      id: context.createId("segment-group"), kind: "vertical_segment",
      pageRole: "story",
      canvas: { width: first.canvas.width, height: first.canvas.height + second.canvas.height, background: structuredClone(first.canvas.background) },
      surfaces: [firstSurface, secondSurface], frames: [...firstContent.frames, ...secondContent.frames], overlayLayers: [...firstContent.overlayLayers, ...secondContent.overlayLayers],
      readingSequence: [...structuredClone(first.readingSequence), ...structuredClone(second.readingSequence)], layoutPolicy: { ...structuredClone(first.layoutPolicy), frameOverlap: first.layoutPolicy.frameOverlap === "allow" || second.layoutPolicy.frameOverlap === "allow" ? "allow" : "forbid" },
    };
    return [{ type: "add_presentation_unit", unit: composite, readingIndex: index }, { type: "remove_presentation_unit", unitId: first.id }, { type: "remove_presentation_unit", unitId: second.id }];
  },
});

function splitCompositeCommands(context: EditorCapabilityContext, unit: PresentationUnit): WorkspaceCommand[] {
  const crossPurpose = unit.kind === "spread" ? "cross_page" : "cross_segment";
  const surfaces = unit.kind === "spread" ? orderedUnitSurfaces(unit, context.fixture.working.document.reading.direction) : [...unit.surfaces].sort((a, b) => (a.pageNumber ?? 0) - (b.pageNumber ?? 0) || a.geometry.y - b.geometry.y);
  const surfaceFor = (geometry: Geometry) => surfaces.find((surface) => containsGeometry(surface.geometry, geometry));
  const frameSurface = new Map<string, PageSurface>();
  unit.frames.forEach((frame) => { const surface = surfaceFor(frame.geometry); if (!surface) throw new Error("存在跨越分隔线的画格，请先移回单一纸面"); frameSurface.set(frame.id, surface); });
  unit.overlayLayers.forEach((layer) => layer.elements.forEach((element) => {
    const anchor = layer.anchor;
    const anchorFrame = anchor.type === "frame" ? unit.frames.find((frame) => frame.id === anchor.frameId) : undefined;
    const geometry = anchorFrame ? resolveLocalTransform(anchorFrame.geometry, element.transform) : element.transform;
    if (!surfaceFor(geometry)) throw new Error("存在跨越分隔线的对象，请先移回单一纸面");
  }));
  const readingIndex = context.fixture.working.document.reading.unitOrder.indexOf(unit.id);
  const units = surfaces.map((surface, surfaceIndex): PresentationUnit => {
    const frames = unit.frames.filter((frame) => frameSurface.get(frame.id)?.id === surface.id).map((frame) => ({ ...structuredClone(frame), surfaceScope: undefined, geometry: shiftedGeometry(frame.geometry, -surface.geometry.x, -surface.geometry.y) }));
    const frameIds = new Set(frames.map((frame) => frame.id));
    const overlayLayers = unit.overlayLayers.flatMap((layer): UnitOverlayLayer[] => {
      if (layer.anchor.type === "frame") return frameIds.has(layer.anchor.frameId) ? [{ ...structuredClone(layer), surfaceId: undefined }] : [];
      const elements = layer.elements.filter((element) => surfaceFor(element.transform)?.id === surface.id).map((element) => shiftedOverlayElement(element, -surface.geometry.x, -surface.geometry.y));
      if (!elements.length) return [];
      const purpose = layer.purpose === crossPurpose ? "page_content" : layer.purpose;
      return [{ ...structuredClone(layer), id: surfaceIndex === 0 ? layer.id : context.createId(`${purpose}-overlay`), surfaceId: undefined, purpose, elements }];
    });
    const id = context.createId(unit.kind === "spread" ? "page" : "segment");
    return {
      id, ...(surface.name ? { name: surface.name } : {}), kind: unit.kind === "spread" ? "single_page" : "vertical_segment", pageRole: unit.pageRole,
      canvas: { width: surface.geometry.width, height: surface.geometry.height, background: structuredClone(unit.canvas.background) },
      surfaces: [{ ...structuredClone(surface), name: undefined, role: unit.kind === "spread" ? "single" : "segment", geometry: { x: 0, y: 0, width: surface.geometry.width, height: surface.geometry.height } }],
      frames, overlayLayers, readingSequence: unit.readingSequence.filter((entry) => frameIds.has(entry.frameId)), layoutPolicy: structuredClone(unit.layoutPolicy),
    };
  });
  return [...units.map((next, index): WorkspaceCommand => ({ type: "add_presentation_unit", unit: next, readingIndex: readingIndex + index })), { type: "remove_presentation_unit", unitId: unit.id }];
}

const splitSpreadToPagesCapability = defineCapability({
  id: "split_spread_to_pages", version: 1, inputSchema: z.strictObject({ unitId: z.string().min(1) }), scope: "chapter", humanEntry: "available", agentAccess: "disabled", externalAgentAccess: "execute", risk: "high",
  preconditions: ["spread_exists", "spread_contains_no_cross_surface_objects"], outputCommandTypes: ["add_presentation_unit", "remove_presentation_unit"], previewPolicy: "inline", undoPolicy: "atomic",
  execute(input, context) { const unit = context.fixture.working.document.units.find((item) => item.id === input.unitId); if (!unit || unit.kind !== "spread") throw new Error("目标不是真正双页"); return splitCompositeCommands(context, unit); },
});

const splitVerticalSegmentsCapability = defineCapability({
  id: "split_vertical_segments", version: 1, inputSchema: z.strictObject({ unitId: z.string().min(1) }), scope: "chapter", humanEntry: "available", agentAccess: "disabled", risk: "high",
  preconditions: ["compound_vertical_segment_exists", "segment_contains_no_cross_surface_objects"], outputCommandTypes: ["add_presentation_unit", "remove_presentation_unit"], previewPolicy: "inline", undoPolicy: "atomic",
  execute(input, context) { const unit = context.fixture.working.document.units.find((item) => item.id === input.unitId); if (!unit || unit.kind !== "vertical_segment" || unit.surfaces.length < 2) throw new Error("目标不是复合滚动段"); return splitCompositeCommands(context, unit); },
});

const crossSurfaceImageInputSchema = z.strictObject({ unitId: z.string().min(1), assetId: z.string().min(1), assetVersionId: z.string().min(1), mediaType: z.string().startsWith("image/"), width: z.number().positive().optional(), height: z.number().positive().optional() });
function createCrossSurfaceImage(input: z.infer<typeof crossSurfaceImageInputSchema>, context: EditorCapabilityContext, purpose: "cross_page" | "cross_segment") {
  const unit = context.fixture.working.document.units.find((item) => item.id === input.unitId);
  const valid = purpose === "cross_page" ? unit?.kind === "spread" : unit?.kind === "vertical_segment" && unit.surfaces.length > 1;
  if (!unit || !valid) throw new Error(purpose === "cross_page" ? "跨页图片只能放入真正双页" : "跨段图片只能放入已合并的滚动段");
  const overlay = overlayLayerFor(context, unit, { type: "unit" }, purpose, purpose === "cross_page" ? "跨页内容" : "跨段内容");
  const element: ArtElement = { id: context.createId(purpose === "cross_page" ? "cross-page-image" : "cross-segment-image"), kind: "image", assetId: input.assetId, assetVersionId: input.assetVersionId, transform: { x: 0, y: 0, width: unit.canvas.width, height: unit.canvas.height }, crop: { x: 0, y: 0, width: 1, height: 1 }, name: purpose === "cross_page" ? "跨页图片" : "跨段图片" };
  const commands: WorkspaceCommand[] = [];
  if (!context.fixture.working.document.resources.some((resource) => resource.assetId === input.assetId && resource.assetVersionId === input.assetVersionId)) commands.push({ type: "declare_resource", resource: { assetId: input.assetId, assetVersionId: input.assetVersionId, kind: "image", mediaType: input.mediaType, width: input.width, height: input.height } });
  if (overlay.command) commands.push(overlay.command);
  commands.push({ type: "add_overlay_element", unitId: unit.id, layerId: overlay.layer.id, element });
  return commands;
}

const createCrossPageImageCapability = defineCapability({ id: "create_cross_page_image", version: 1, inputSchema: crossSurfaceImageInputSchema, scope: "unit", humanEntry: "available", agentAccess: "disabled", risk: "medium", preconditions: ["spread_exists", "asset_version_is_fixed"], outputCommandTypes: ["declare_resource", "add_overlay_layer", "add_overlay_element"], previewPolicy: "inline", undoPolicy: "atomic", execute(input, context) { return createCrossSurfaceImage(input, context, "cross_page"); } });
const createCrossSegmentImageCapability = defineCapability({ id: "create_cross_segment_image", version: 1, inputSchema: crossSurfaceImageInputSchema, scope: "unit", humanEntry: "available", agentAccess: "disabled", risk: "medium", preconditions: ["compound_vertical_segment_exists", "asset_version_is_fixed"], outputCommandTypes: ["declare_resource", "add_overlay_layer", "add_overlay_element"], previewPolicy: "inline", undoPolicy: "atomic", execute(input, context) { return createCrossSurfaceImage(input, context, "cross_segment"); } });

const convertCrossSurfaceInputSchema = z.strictObject({ unitId: z.string().min(1), frameId: z.string().min(1).optional(), layerId: z.string().min(1), elementId: z.string().min(1) });
function convertImageToCrossSurface(input: z.infer<typeof convertCrossSurfaceInputSchema>, context: EditorCapabilityContext, purpose: "cross_page" | "cross_segment") {
  if (input.frameId) throw new Error(purpose === "cross_page" ? "格内图片不能直接设为跨页图片，请先转为纸面图片" : "格内图片不能直接设为跨段图片，请先转为纸面图片");
  const located = findLocatedElement(context, input);
  const unit = located.unit;
  const valid = purpose === "cross_page" ? unit.kind === "spread" : unit.kind === "vertical_segment" && unit.surfaces.length > 1;
  if (!valid || located.element.kind !== "image") throw new Error(purpose === "cross_page" ? "只有真正双页中的图片可以设为跨页" : "只有复合滚动段中的图片可以设为跨段");
  const commands: WorkspaceCommand[] = [];
  const overlayLocated = findOverlayElement(context, input.unitId, input.layerId, input.elementId);
  if (overlayLocated.layer.purpose === purpose) throw new Error("图片已经是跨 surface 对象");
  if (overlayLocated.layer.anchor.type !== "unit") throw new Error(purpose === "cross_page" ? "画格归属图片不能直接设为跨页图片，请先转为纸面图片" : "画格归属图片不能直接设为跨段图片，请先转为纸面图片");
  const geometry = overlayLocated.element.transform;
  commands.push({ type: "remove_overlay_element", unitId: unit.id, layerId: overlayLocated.layer.id, elementId: overlayLocated.element.id });
  if (overlayLocated.layer.elements.length === 1) commands.push({ type: "remove_overlay_layer", unitId: unit.id, layerId: overlayLocated.layer.id });
  const overlay = overlayLayerFor(context, unit, { type: "unit" }, purpose, purpose === "cross_page" ? "跨页内容" : "跨段内容");
  if (overlay.command) commands.push(overlay.command);
  commands.push({ type: "add_overlay_element", unitId: unit.id, layerId: overlay.layer.id, element: { ...structuredClone(located.element), transform: geometry } as OverlayElement });
  return commands;
}

const convertImageToCrossPageCapability = defineCapability({ id: "convert_image_to_cross_page", version: 1, inputSchema: convertCrossSurfaceInputSchema, scope: "element", humanEntry: "available", agentAccess: "disabled", risk: "medium", preconditions: ["unit_owned_spread_image_exists"], outputCommandTypes: ["remove_overlay_element", "remove_overlay_layer", "add_overlay_layer", "add_overlay_element"], previewPolicy: "inline", undoPolicy: "atomic", execute(input, context) { return convertImageToCrossSurface(input, context, "cross_page"); } });
const convertImageToCrossSegmentCapability = defineCapability({ id: "convert_image_to_cross_segment", version: 1, inputSchema: convertCrossSurfaceInputSchema, scope: "element", humanEntry: "available", agentAccess: "disabled", risk: "medium", preconditions: ["unit_owned_compound_segment_image_exists"], outputCommandTypes: ["remove_overlay_element", "remove_overlay_layer", "add_overlay_layer", "add_overlay_element"], previewPolicy: "inline", undoPolicy: "atomic", execute(input, context) { return convertImageToCrossSurface(input, context, "cross_segment"); } });

const convertBalloonToCrossPageCapability = defineCapability({
  id: "convert_balloon_to_cross_page",
  version: 1,
  inputSchema: convertCrossSurfaceInputSchema.extend({ transform: geometrySchema.optional(), tailTarget: z.strictObject({ x: z.number(), y: z.number() }).optional() }),
  scope: "element",
  humanEntry: "available",
  agentAccess: "disabled",
  externalAgentAccess: "execute",
  risk: "medium",
  preconditions: ["spread_exists", "balloon_exists", "resulting_document_is_valid"],
  outputCommandTypes: ["remove_layer_element", "remove_overlay_element", "remove_overlay_layer", "add_overlay_layer", "add_overlay_element"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    const located = findLocatedElement(context, input);
    if (located.unit.kind !== "spread" || located.element.kind !== "balloon") throw new Error("只有真正双页中的对白可以设为跨页");
    const commands: WorkspaceCommand[] = [];
    let geometry: Geometry;
    let tailTarget: Point | undefined;
    if (input.frameId) {
      const frameLocated = findFrameElement(context, input.unitId, input.frameId, input.layerId, input.elementId);
      geometry = resolveLocalTransform(frameLocated.frame.geometry, frameLocated.element.transform);
      tailTarget = frameLocated.element.kind === "balloon" && frameLocated.element.tailTarget
        ? { x: frameLocated.frame.geometry.x + frameLocated.element.tailTarget.x * frameLocated.frame.geometry.width, y: frameLocated.frame.geometry.y + frameLocated.element.tailTarget.y * frameLocated.frame.geometry.height }
        : undefined;
      commands.push({ type: "remove_layer_element", unitId: input.unitId, frameId: input.frameId, layerId: input.layerId, elementId: input.elementId });
    } else {
      const overlayLocated = findOverlayElement(context, input.unitId, input.layerId, input.elementId);
      if (overlayLocated.layer.purpose === "cross_page") throw new Error("对白已经是跨页对象");
      const anchor = overlayLocated.layer.anchor;
      const anchorFrame = anchor.type === "frame" ? overlayLocated.unit.frames.find((frame) => frame.id === anchor.frameId) : undefined;
      geometry = anchorFrame ? resolveLocalTransform(anchorFrame.geometry, overlayLocated.element.transform) : overlayLocated.element.transform;
      tailTarget = overlayLocated.element.kind === "balloon" && overlayLocated.element.tailTarget
        ? anchorFrame
          ? { x: anchorFrame.geometry.x + overlayLocated.element.tailTarget.x * anchorFrame.geometry.width, y: anchorFrame.geometry.y + overlayLocated.element.tailTarget.y * anchorFrame.geometry.height }
          : overlayLocated.element.tailTarget
        : undefined;
      commands.push({ type: "remove_overlay_element", unitId: input.unitId, layerId: input.layerId, elementId: input.elementId });
      if (overlayLocated.layer.elements.length === 1) commands.push({ type: "remove_overlay_layer", unitId: input.unitId, layerId: input.layerId });
    }
    geometry = input.transform ?? geometry;
    tailTarget = input.tailTarget ?? tailTarget;
    if (input.transform) {
      const [left, right] = [...located.unit.surfaces].sort((first, second) => first.geometry.x - second.geometry.x);
      if (!left || !right) throw new Error("真正双页缺少左右纸面");
      const gutterStart = left.geometry.x + left.geometry.width;
      const gutterEnd = right.geometry.x;
      const crossesGutter = geometry.x < gutterStart && geometry.x + geometry.width > gutterEnd;
      if (!crossesGutter) throw new Error("跨页气泡必须同时覆盖左右纸面");
      if (geometry.x < 0 || geometry.y < 0 || geometry.x + geometry.width > located.unit.canvas.width || geometry.y + geometry.height > located.unit.canvas.height) {
        throw new Error("跨页气泡必须完整位于真正双页画布内");
      }
      const safeInset = Math.min(32, Math.max(12, geometry.width * .08));
      const centerX = geometry.x + geometry.width / 2;
      if (centerX >= gutterStart - safeInset && centerX <= gutterEnd + safeInset) {
        throw new Error("跨页气泡的文字中心必须避开中缝安全区，请让气泡中心偏向左页或右页");
      }
      if (tailTarget && tailTarget.x >= gutterStart - safeInset && tailTarget.x <= gutterEnd + safeInset) {
        throw new Error("气泡尾巴不能落在中缝安全区");
      }
    }
    const target = overlayLayerFor(context, located.unit, { type: "unit" }, "cross_page", "跨页内容");
    if (target.command) commands.push(target.command);
    const balloon = { ...structuredClone(located.element), transform: geometry, ...(tailTarget ? { tailTarget } : {}) } as OverlayElement;
    commands.push({ type: "add_overlay_element", unitId: input.unitId, layerId: target.layer.id, element: balloon });
    return commands;
  },
});

const createPageCapability = defineCapability({
  id: "create_page",
  version: 1,
  inputSchema: z.strictObject({
    relativeToUnitId: z.string().min(1).optional(),
    side: z.enum(["before", "after"]).optional(),
    pageRole: z.enum(["story", "cover", "interlude"]).optional(),
    name: z.string().trim().max(80).optional(),
  }).refine((input) => input.pageRole === "cover" || Boolean(input.relativeToUnitId) === Boolean(input.side), "relativeToUnitId and side must be provided together"),
  scope: "chapter",
  humanEntry: "available",
  agentAccess: "disabled",
  externalAgentAccess: "execute",
  risk: "medium",
  preconditions: ["working_document_exists"],
  outputCommandTypes: ["add_presentation_unit"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    const document = context.fixture.working.document;
    if (document.format === "vertical") throw new Error("create_page is unavailable for vertical comics");
    const pageRole = input.pageRole ?? "story";
    if (pageRole !== "story" && document.format !== "page") throw new Error("特殊页只支持页漫");
    if (pageRole === "cover" && document.units.some((unit) => unit.pageRole === "cover")) throw new Error("本话已有封面页");
    const targetIndex = input.relativeToUnitId ? document.reading.unitOrder.indexOf(input.relativeToUnitId) : -1;
    if (input.relativeToUnitId && targetIndex < 0) throw new Error("找不到插入位置对应的页面");
    const readingIndex = pageRole === "cover" ? 0 : targetIndex < 0
      ? document.reading.unitOrder.length
      : targetIndex + (input.side === "after" ? 1 : 0);
    const kind: PresentationUnit["kind"] = document.format === "four_panel" ? "four_panel_unit" : "single_page";
    const referenceUnit = input.relativeToUnitId
      ? document.units.find((unit) => unit.id === input.relativeToUnitId)
      : document.units.find((unit) => unit.id === document.reading.unitOrder.at(-1));
    const referenceSurface = referenceUnit?.surfaces[0];
    const canvas = referenceUnit
      ? referenceUnit.kind === "spread" && referenceSurface
        ? { width: referenceSurface.geometry.width, height: referenceSurface.geometry.height, background: structuredClone(referenceUnit.canvas.background) }
        : structuredClone(referenceUnit.canvas)
      : { width: 720, height: 1080, background: { color: "#ffffff" } };
    const id = context.createId(kind === "four_panel_unit" ? "four-panel-unit" : "page");
    const unit: PresentationUnit = {
      id,
      ...(input.name ? { name: input.name } : {}),
      kind,
      pageRole,
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
      pageRole: "story",
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
  externalAgentAccess: "execute",
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

const setPresentationUnitBackgroundCapability = defineCapability({
  id: "set_presentation_unit_background",
  version: 1,
  inputSchema: z.strictObject({ unitId: z.string().min(1), color: z.enum(["#ffffff", "#000000"]) }),
  scope: "unit",
  humanEntry: "available",
  agentAccess: "disabled",
  risk: "low",
  preconditions: ["presentation_unit_exists"],
  outputCommandTypes: ["set_presentation_unit_background"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    if (!context.fixture.working.document.units.some((unit) => unit.id === input.unitId)) throw new Error(`missing PresentationUnit: ${input.unitId}`);
    return [{ type: "set_presentation_unit_background", unitId: input.unitId, color: input.color }];
  },
});

function duplicatePresentationUnit(context: EditorCapabilityContext, source: PresentationUnit) {
  const document = context.fixture.working.document;
  const unitId = context.createId(source.kind === "vertical_segment" ? "segment" : source.kind === "spread" ? "spread" : "page");
  const surfaceIds = new Map(source.surfaces.map((surface) => [surface.id, context.createId("surface")]));
  const frameIds = new Map(source.frames.map((frame) => [frame.id, context.createId("frame")]));
  const primaryBeats = source.frames.flatMap((frame) => {
    const reference = frame.storyRefs.find((item) => item.role === "primary");
    const beat = reference ? context.fixture.storyboardBeats.find((item) => item.id === reference.storyboardBeatId) : undefined;
    return beat ? [{ frameId: frame.id, beat }] : [];
  });
  const beatIds = new Map(primaryBeats.map(({ beat }) => [beat.id, context.createId("storyboard-beat")]));
  const dialogueIds = new Map<string, string>();
  const dialogues: Dialogue[] = [];
  const duplicateDialogueId = (dialogueId: string) => {
    const existing = dialogueIds.get(dialogueId);
    if (existing) return existing;
    const sourceDialogue = document.dialogues.find((item) => item.id === dialogueId);
    const id = context.createId("dialogue");
    dialogueIds.set(dialogueId, id);
    const copiedBeatId = sourceDialogue?.storyboardBeatId ? beatIds.get(sourceDialogue.storyboardBeatId) : undefined;
    dialogues.push({
      ...structuredClone(sourceDialogue ?? { content: "" }),
      id,
      ...(copiedBeatId ? { storyboardBeatId: copiedBeatId, storyboardBeatVersionId: `${copiedBeatId}-v1` } : {}),
    });
    return id;
  };
  const duplicateElement = <T extends FrameElement | OverlayElement>(element: T): T => {
    const copy = { ...structuredClone(element), id: context.createId(element.kind) } as T;
    if (copy.kind === "balloon") copy.dialogueId = duplicateDialogueId(copy.dialogueId);
    return copy;
  };
  const unit: PresentationUnit = {
    ...structuredClone(source),
    id: unitId,
    ...(source.name ? { name: `${source.name} 副本` } : {}),
    surfaces: source.surfaces.map((surface) => ({ ...structuredClone(surface), id: surfaceIds.get(surface.id)! })),
    frames: source.frames.map((frame) => ({
      ...structuredClone(frame),
      id: frameIds.get(frame.id)!,
      storyRefs: [],
      layers: frame.layers.map((layer) => ({ ...structuredClone(layer), id: context.createId(`${layer.kind}-layer`), elements: layer.elements.map(duplicateElement) } as FrameLayer)),
    })),
    overlayLayers: source.overlayLayers.map((layer) => ({
      ...structuredClone(layer),
      id: context.createId(`${layer.purpose}-overlay`),
      anchor: layer.anchor.type === "frame" ? { type: "frame" as const, frameId: frameIds.get(layer.anchor.frameId)! } : { type: "unit" as const },
      ...(layer.surfaceId ? { surfaceId: surfaceIds.get(layer.surfaceId)! } : {}),
      elements: layer.elements.map(duplicateElement),
    })),
    readingSequence: source.readingSequence.map((entry) => ({ ...structuredClone(entry), frameId: frameIds.get(entry.frameId)! })),
  };
  const storyboardCommands: WorkspaceCommand[] = primaryBeats.map(({ frameId, beat }) => {
    const beatId = beatIds.get(beat.id)!;
    return {
      type: "create_frame_storyboard_beat",
      unitId,
      frameId: frameIds.get(frameId)!,
      storyboardBeat: { ...structuredClone(beat), id: beatId, versionId: `${beatId}-v1`, title: `${beat.title} 副本` },
    };
  });
  return { unit, dialogues, storyboardCommands };
}

const duplicatePresentationUnitCapability = defineCapability({
  id: "duplicate_presentation_unit",
  version: 1,
  inputSchema: z.strictObject({ unitId: z.string().min(1) }),
  scope: "unit",
  humanEntry: "available",
  agentAccess: "disabled",
  externalAgentAccess: "execute",
  risk: "medium",
  preconditions: ["presentation_unit_exists", "copied_object_ids_are_remapped", "resulting_document_is_valid"],
  outputCommandTypes: ["add_dialogue", "add_presentation_unit", "create_frame_storyboard_beat"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    const source = context.fixture.working.document.units.find((unit) => unit.id === input.unitId);
    if (!source) throw new Error(`missing PresentationUnit: ${input.unitId}`);
    if (source.pageRole === "cover") throw new Error("封面页不能复制");
    const readingIndex = context.fixture.working.document.reading.unitOrder.indexOf(source.id);
    if (readingIndex < 0) throw new Error(`PresentationUnit is missing from reading order: ${source.id}`);
    const copied = duplicatePresentationUnit(context, source);
    return [
      ...copied.dialogues.map((dialogue): WorkspaceCommand => ({ type: "add_dialogue", dialogue })),
      { type: "add_presentation_unit", unit: copied.unit, readingIndex: readingIndex + 1 },
      ...copied.storyboardCommands,
    ];
  },
});

const movePresentationUnitCapability = defineCapability({
  id: "move_presentation_unit",
  version: 1,
  inputSchema: z.strictObject({ unitId: z.string().min(1), direction: z.enum(["up", "down"]) }),
  scope: "unit",
  humanEntry: "available",
  agentAccess: "disabled",
  externalAgentAccess: "execute",
  risk: "low",
  preconditions: ["presentation_unit_exists", "adjacent_presentation_unit_exists"],
  outputCommandTypes: ["move_presentation_unit"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    const index = context.fixture.working.document.reading.unitOrder.indexOf(input.unitId);
    if (index < 0) throw new Error(`missing PresentationUnit: ${input.unitId}`);
    if (input.direction === "up" && index === 0) throw new Error("当前展示单元已经在最前面");
    if (input.direction === "down" && index === context.fixture.working.document.reading.unitOrder.length - 1) throw new Error("当前展示单元已经在最后面");
    const unit = context.fixture.working.document.units.find((item) => item.id === input.unitId);
    if (!unit) throw new Error(`missing PresentationUnit: ${input.unitId}`);
    if (unit.pageRole === "cover") throw new Error("封面页固定在本话最前");
    if (input.direction === "up" && index === 1 && context.fixture.working.document.units.find((item) => item.id === context.fixture.working.document.reading.unitOrder[0])?.pageRole === "cover") throw new Error("封面页固定在本话最前");
    return [{ type: "move_presentation_unit", ...input }];
  },
});

const movePresentationUnitToCapability = defineCapability({
  id: "move_presentation_unit_to",
  version: 1,
  inputSchema: z.strictObject({
    unitId: z.string().min(1),
    relativeToUnitId: z.string().min(1),
    side: z.enum(["before", "after"]),
  }),
  scope: "chapter",
  humanEntry: "available",
  agentAccess: "disabled",
  externalAgentAccess: "execute",
  risk: "low",
  preconditions: ["presentation_units_exist", "cover_stays_first", "resulting_order_changes"],
  outputCommandTypes: ["move_presentation_unit"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input, context) {
    const document = context.fixture.working.document;
    if (input.unitId === input.relativeToUnitId) throw new Error("页面不能相对自身排序");
    const sourceIndex = document.reading.unitOrder.indexOf(input.unitId);
    const targetIndex = document.reading.unitOrder.indexOf(input.relativeToUnitId);
    if (sourceIndex < 0 || targetIndex < 0) throw new Error("找不到要排序的页面");
    const source = document.units.find((unit) => unit.id === input.unitId);
    const target = document.units.find((unit) => unit.id === input.relativeToUnitId);
    if (!source || !target) throw new Error("找不到要排序的页面");
    if (source.pageRole === "cover") throw new Error("封面页固定在本话最前");
    if (target.pageRole === "cover" && input.side === "before") throw new Error("其他页面不能排在封面之前");
    const finalIndex = sourceIndex < targetIndex
      ? targetIndex - (input.side === "before" ? 1 : 0)
      : targetIndex + (input.side === "after" ? 1 : 0);
    if (finalIndex === sourceIndex) throw new Error("页面已经位于指定位置");
    const direction = finalIndex < sourceIndex ? "up" as const : "down" as const;
    return Array.from(
      { length: Math.abs(finalIndex - sourceIndex) },
      (): WorkspaceCommand => ({ type: "move_presentation_unit", unitId: source.id, direction }),
    );
  },
});

const deletePresentationUnitCapability = defineCapability({
  id: "delete_presentation_unit",
  version: 1,
  inputSchema: z.strictObject({ unitId: z.string().min(1) }),
  scope: "unit",
  humanEntry: "available",
  agentAccess: "disabled",
  externalAgentAccess: "execute",
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

const restoreWorkspaceVersionCapability = defineCapability({
  id: "restore_workspace_version",
  version: 1,
  inputSchema: z.strictObject({
    document: comicDocumentSchema,
    storyboardBeats: z.array(storyboardBeatSchema).max(120),
  }),
  scope: "chapter",
  humanEntry: "available",
  agentAccess: "disabled",
  risk: "high",
  preconditions: ["trusted_workspace_version_exists", "resulting_document_is_valid"],
  outputCommandTypes: ["replace_chapter_presentation", "replace_storyboard_beats"],
  previewPolicy: "inline",
  undoPolicy: "atomic",
  execute(input) {
    return [
      { type: "replace_chapter_presentation", document: structuredClone(input.document) },
      { type: "replace_storyboard_beats", storyboardBeats: structuredClone(input.storyboardBeats) },
    ];
  },
});

const capabilityRegistry = {
  create_frame: createFrameCapability,
  duplicate_frame: duplicateFrameCapability,
  delete_frame: deleteFrameCapability,
  place_frame_image: placeFrameImageCapability,
  replace_frame_image: replaceFrameImageCapability,
  replace_image: replaceImageCapability,
  remove_frame_image: removeFrameImageCapability,
  create_dialogue_balloon: createDialogueBalloonCapability,
  create_page_image: createPageImageCapability,
  set_cover_page_image: setCoverPageImageCapability,
  create_page_dialogue_balloon: createPageDialogueBalloonCapability,
  create_narration: createNarrationCapability,
  update_narration: updateNarrationCapability,
  duplicate_narration: duplicateNarrationCapability,
  delete_narration: deleteNarrationCapability,
  promote_element_to_overlay: promoteElementToOverlayCapability,
  convert_element_to_page: convertElementToPageCapability,
  return_element_to_frame: returnElementToFrameCapability,
  reorder_overlay_element: reorderOverlayElementCapability,
  duplicate_dialogue_balloon: duplicateDialogueBalloonCapability,
  delete_dialogue_balloon: deleteDialogueBalloonCapability,
  update_dialogue: updateDialogueCapability,
  update_storyboard_beat: updateStoryboardBeatCapability,
  create_frame_storyboard_beat: createFrameStoryboardBeatCapability,
  set_art_crop: setArtCropCapability,
  move_frame: moveFrameCapability,
  set_frame_overlap_policy: setFrameOverlapPolicyCapability,
  reorder_frame: reorderFrameCapability,
  reorder_frame_reading: reorderFrameReadingCapability,
  resize_frame: resizeFrameCapability,
  reshape_frame: reshapeFrameCapability,
  update_frame_border: updateFrameBorderCapability,
  update_frame_bleed: updateFrameBleedCapability,
  set_frame_cross_page: setFrameCrossPageCapability,
  set_element_transform: setElementTransformCapability,
  update_balloon: updateBalloonCapability,
  reorder_layer: reorderLayerCapability,
  set_element_appearance: setElementAppearanceCapability,
  merge_pages_to_spread: mergePagesToSpreadCapability,
  split_spread_to_pages: splitSpreadToPagesCapability,
  create_cross_page_image: createCrossPageImageCapability,
  convert_image_to_cross_page: convertImageToCrossPageCapability,
  merge_vertical_segments: mergeVerticalSegmentsCapability,
  split_vertical_segments: splitVerticalSegmentsCapability,
  create_cross_segment_image: createCrossSegmentImageCapability,
  convert_image_to_cross_segment: convertImageToCrossSegmentCapability,
  convert_balloon_to_cross_page: convertBalloonToCrossPageCapability,
  create_page: createPageCapability,
  create_vertical_segment: createVerticalSegmentCapability,
  update_presentation_unit: updatePresentationUnitCapability,
  set_presentation_unit_background: setPresentationUnitBackgroundCapability,
  duplicate_presentation_unit: duplicatePresentationUnitCapability,
  move_presentation_unit: movePresentationUnitCapability,
  move_presentation_unit_to: movePresentationUnitToCapability,
  delete_presentation_unit: deletePresentationUnitCapability,
  restore_workspace_version: restoreWorkspaceVersionCapability,
} satisfies Record<string, RegisteredCapability>;

export type EditorCapabilityId = keyof typeof capabilityRegistry;

function descriptor(capability: RegisteredCapability): EditorCapabilityDescriptor {
  return {
    id: capability.id,
    version: capability.version,
    scope: capability.scope,
    humanEntry: capability.humanEntry,
    agentAccess: capability.agentAccess,
    externalAgentAccess: capability.externalAgentAccess,
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
  if (context.actor === "external_agent" && capability.externalAgentAccess !== "execute") {
    throw new Error(`capability is disabled for external Agent: ${id}`);
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

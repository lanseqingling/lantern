import { z } from "zod";

const versionedWorkspaceObjectTypes = new Set(["asset", "character", "scene", "style", "storyboard_beat"]);

export const workspaceRefSchema = z.object({
  objectType: z.enum(["project", "chapter", "asset", "character", "scene", "style", "storyboard_beat", "presentation_unit", "canvas_element"]),
  objectId: z.string().min(1),
  versionId: z.string().min(1).optional(),
}).superRefine((reference, context) => {
  if (versionedWorkspaceObjectTypes.has(reference.objectType) && !reference.versionId) {
    context.addIssue({ code: "custom", path: ["versionId"], message: `${reference.objectType} 引用必须固定 versionId` });
  }
});

export const agentStoryboardBeatContextSchema = z.object({
  id: z.string().min(1),
  versionId: z.string().min(1),
  title: z.string(),
  description: z.string(),
});

const currentComicFrameSchema = z.object({
  id: z.string().min(1),
  pageId: z.string().min(1),
  pageIndex: z.number().int().nonnegative(),
  readingOrder: z.number().int().positive(),
  linkedStoryboardBeatId: z.string().min(1),
  linkedStoryboardBeatVersionId: z.string().min(1),
  hasFrameImage: z.boolean(),
  dialogueElementCount: z.number().int().nonnegative(),
});

export const agentContextSnapshotSchema = z.object({
  task: z.object({ type: z.string().min(1), instruction: z.string(), scope: z.string().min(1) }),
  comic: z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    summary: z.string(),
    worldSummary: z.string(),
    format: z.enum(["page", "vertical", "four_panel"]),
    readingDirection: z.string().min(1),
    styleSummary: z.string(),
  }),
  chapter: z.object({ id: z.string().min(1), title: z.string().min(1), summary: z.string() }),
  projectId: z.string().min(1),
  workingRevision: z.number().int().positive(),
  selection: z.object({
    type: z.string().min(1),
    id: z.string().optional(),
    pageId: z.string().optional(),
    label: z.string().optional(),
    canvasX: z.number().finite().optional(),
    canvasY: z.number().finite().optional(),
  }),
  /** Narrative context deliberately sent to the model, centered on its current focus. */
  storyboardBeats: z.array(agentStoryboardBeatContextSchema).max(12),
  /** Resolved from the current canvas selection; never inferred from a stale sidebar item. */
  currentPage: z.object({ id: z.string().min(1), pageIndex: z.number().int().nonnegative(), kind: z.string().min(1), comicFrameCount: z.number().int().nonnegative() }).optional(),
  currentComicFrame: currentComicFrameSchema.optional(),
  currentStoryboardBeat: agentStoryboardBeatContextSchema.optional(),
  assets: z.array(z.object({
    id: z.string().min(1),
    kind: z.string().min(1),
    name: z.string().min(1),
    description: z.string(),
    attributes: z.unknown(),
    versionId: z.string().min(1).optional(),
  })).max(24),
  explicitReferences: z.array(workspaceRefSchema),
  /** Text content resolved from explicitly referenced speech balloons. */
  explicitDialogueReferences: z.array(z.object({
    elementId: z.string().min(1),
    dialogueId: z.string().min(1),
    pageId: z.string().min(1),
    pageIndex: z.number().int().nonnegative(),
    comicFrameId: z.string().min(1),
    balloonNumber: z.number().int().positive(),
    text: z.string(),
    shape: z.enum(["normal", "thought", "caption_box"]),
  })).max(24).default([]),
  recentConversation: z.array(z.object({ role: z.enum(["user", "agent", "system"]), content: z.string() })).max(16),
  omittedContext: z.array(z.object({ type: z.string().min(1), reason: z.string().min(1) })),
});

export const interactionDecisionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("direct_answer"), message: z.string().min(1) }),
  z.object({
    kind: z.literal("needs_input"),
    message: z.string().min(1),
    questions: z.array(z.object({
      id: z.string().min(1),
      field: z.string().min(1),
      prompt: z.string().min(1),
      required: z.boolean(),
      options: z.array(z.object({ id: z.string(), label: z.string(), value: z.string() })).optional(),
    })).min(1).max(3),
  }),
  z.object({
    kind: z.literal("needs_confirmation"),
    message: z.string().min(1),
    summary: z.string().min(1),
    scope: z.enum(["reference_only", "selected_storyboard_beat", "selected_comic_frame", "selected_element", "current_page", "after_current", "whole_chapter"]),
    taskType: z.enum(["storyboard", "page_layout", "frame_image_generate", "frame_image_refine", "asset_parse", "dialogue", "export"]),
  }),
  z.object({
    kind: z.literal("ready_to_run"),
    message: z.string().min(1),
    scope: z.enum(["reference_only", "selected_storyboard_beat", "selected_comic_frame", "selected_element", "current_page", "after_current", "whole_chapter"]),
    taskType: z.enum(["storyboard", "page_layout", "frame_image_generate", "frame_image_refine", "asset_parse", "dialogue", "export"]),
  }),
]);

export const storyboardBeatSchema = z.object({
  temporaryId: z.coerce.string().min(1),
  title: z.string().min(1).max(40),
  description: z.string().min(1).max(1200),
});

export const storyboardOptionSchema = z.object({
    id: z.coerce.string().min(1),
    title: z.string().min(1),
    pacingIntent: z.string().min(1),
    storyboardBeats: z.array(storyboardBeatSchema).min(1).max(12),
});

export const storyboardOutputSchema = z.object({
  options: z.array(storyboardOptionSchema).min(1).max(3),
});

const dialogueLineSchema = z.object({
  lineId: z.string().min(1).optional(),
  storyboardBeatId: z.string().min(1),
  text: z.string(),
  speaker: z.object({
    objectType: z.literal("character"),
    objectId: z.string().min(1),
    versionId: z.string().min(1),
  }).optional(),
  balloonShape: z.enum(["normal", "thought", "caption_box"]).default("normal"),
});

export const dialogueOutputSchema = z.object({
  changeSummary: z.string().min(1),
  lines: z.array(dialogueLineSchema).min(1).max(8).transform((lines) => lines.map((line, index) => ({
    ...line,
    lineId: line.lineId ?? `line-${index + 1}`,
  }))),
});

// Reference images are user-owned inputs. They enter through the upload/add
// flow, never through an Agent asset-generation task.
const assetKinds = ["character", "scene", "style", "prop"] as const;

function normalizeAssetKind(value: unknown) {
  if (typeof value !== "string") return value;
  const aliases: Record<string, (typeof assetKinds)[number]> = {
    "角色": "character",
    "人物": "character",
    "character_asset": "character",
    "场景": "scene",
    "环境": "scene",
    "scene_asset": "scene",
    "画风": "style",
    "风格": "style",
    "道具": "prop",
  };
  return aliases[value.trim().toLowerCase()] ?? value.trim().toLowerCase();
}

function stringifyAttribute(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(stringifyAttribute).filter(Boolean).join("、");
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => `${key}：${stringifyAttribute(entry)}`)
      .filter((entry) => !entry.endsWith("："))
      .join("；");
  }
  return "";
}

function normalizeAttributeKey(key: string) {
  const aliases: Record<string, string> = {
    "外貌": "identity",
    "身份特征": "identity",
    "稳定身份特征": "identity",
    "appearance": "identity",
    "traits": "identity",
    "features": "identity",
    "服装": "outfit",
    "服装与时期": "outfit",
    "clothing": "outfit",
    "性格": "personality",
    "性格与神态": "personality",
    "年龄": "ageStage",
    "年龄阶段": "ageStage",
    "age": "ageStage",
    "空间": "spatialLayout",
    "空间关系": "spatialLayout",
    "page_layout": "spatialLayout",
    "光线": "lighting",
    "时间": "time",
    "时间状态": "time",
    "氛围": "mood",
    "atmosphere": "mood",
    "linework": "linework",
    "线条": "linework",
    "tones": "tones",
    "网点": "tones",
    "状态": "state",
    "叙事作用": "narrativeRole",
    "用途": "narrativeRole",
  };
  return aliases[key.trim()] ?? key.trim();
}

function normalizeAssetDraft(value: unknown) {
  if (!value || typeof value !== "object") return value;
  const root = value as Record<string, unknown>;
  const wrapped = root.asset ?? root.draft ?? root.assetDraft;
  const draft = wrapped && typeof wrapped === "object" ? wrapped as Record<string, unknown> : root;
  const basics = draft.basicInfo && typeof draft.basicInfo === "object"
    ? draft.basicInfo as Record<string, unknown>
    : {};
  const attributes = draft.attributes ?? draft.details ?? draft.appearance ?? {};
  return {
    kind: normalizeAssetKind(draft.kind ?? draft.type ?? draft.assetType ?? root.kind ?? root.type),
    name: draft.name ?? draft.assetName ?? basics.name ?? draft["名称"],
    description: draft.description ?? draft.summary ?? basics.description ?? draft["描述"],
    attributes,
  };
}

const assetAttributeKeys = {
  character: ["identity", "outfit", "personality", "ageStage"],
  scene: ["spatialLayout", "lighting", "time", "mood"],
  style: ["identity", "linework", "tones", "mood"],
  prop: ["identity", "state", "narrativeRole"],
} as const satisfies Record<(typeof assetKinds)[number], readonly string[]>;

export const assetDraftSchema = z.preprocess(normalizeAssetDraft, z.object({
  kind: z.preprocess(normalizeAssetKind, z.enum(assetKinds)),
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
  attributes: z.record(z.string(), z.unknown()).default({}).transform((attributes) => Object.fromEntries(
    Object.entries(attributes)
      .map(([key, value]) => [normalizeAttributeKey(key), stringifyAttribute(value)] as const)
      .filter(([, value]) => value.length > 0),
  )),
})).transform((draft) => {
  const allowed = new Set<string>(assetAttributeKeys[draft.kind]);
  return {
    ...draft,
    attributes: Object.fromEntries(Object.entries(draft.attributes).filter(([key]) => allowed.has(key))),
  };
});

const frameImageCandidatePayloadSchema = z.object({
  changeSummary: z.string(),
  promptSummary: z.string(),
  outputAssetVersionIds: z.array(z.string().min(1)).min(1),
  protectedFields: z.array(z.string()),
});

const dialogueCandidatePayloadSchema = z.object({
  changeSummary: z.string().min(1),
  storyboardBeats: z.array(z.object({
    storyboardBeatId: z.string().min(1),
    baseStoryboardBeatVersionId: z.string().min(1),
    lines: z.array(z.object({
      lineId: z.string().min(1),
      speaker: z.object({ objectType: z.literal("character"), objectId: z.string().min(1), versionId: z.string().min(1) }).optional(),
      text: z.string(),
      balloonShape: z.enum(["normal", "thought", "caption_box"]),
    })).min(1),
  })).min(1),
});

export const candidatePayloadEnvelopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("storyboard"), payload: z.object({ option: storyboardOptionSchema, optionIndex: z.number().int().nonnegative(), optionCount: z.number().int().min(1).max(3) }) }),
  z.object({ kind: z.literal("page_layout"), payload: z.object({ format: z.enum(["page", "vertical", "four_panel"]), readingOrder: z.array(z.string().min(1)) }) }),
  z.object({ kind: z.literal("frame_image"), payload: frameImageCandidatePayloadSchema }),
  z.object({ kind: z.literal("frame_image_patch"), payload: frameImageCandidatePayloadSchema }),
  z.object({ kind: z.literal("asset"), payload: assetDraftSchema.and(z.object({ sourceAssetVersionIds: z.array(z.string().min(1)).min(1) })) }),
  z.object({ kind: z.literal("dialogue"), payload: dialogueCandidatePayloadSchema }),
]);

export function parseCandidatePayload(kind: string, payload: unknown) {
  return candidatePayloadEnvelopeSchema.parse({ kind: kind.toLowerCase(), payload }).payload;
}

export type InteractionDecision = z.infer<typeof interactionDecisionSchema>;
export type StoryboardOutput = z.infer<typeof storyboardOutputSchema>;
export type AgentContextSnapshot = z.infer<typeof agentContextSnapshotSchema>;

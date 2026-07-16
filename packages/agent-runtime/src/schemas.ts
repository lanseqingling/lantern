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
    settings: z.array(z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      content: z.string(),
    })).max(24).default([]),
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
    versionId: z.string().min(1).optional(),
    images: z.array(z.object({ versionId: z.string().min(1), isPrimary: z.boolean() })).max(12).default([]),
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

export const assetDraftSchema = z.strictObject({
  kind: z.enum(assetKinds),
  name: z.string().trim().min(1),
  description: z.string().trim().min(1).max(4000),
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
  z.object({ kind: z.literal("asset"), payload: assetDraftSchema.extend({ sourceAssetVersionIds: z.array(z.string().min(1)).min(1) }) }),
  z.object({ kind: z.literal("dialogue"), payload: dialogueCandidatePayloadSchema }),
]);

export function parseCandidatePayload(kind: string, payload: unknown) {
  return candidatePayloadEnvelopeSchema.parse({ kind: kind.toLowerCase(), payload }).payload;
}

export type InteractionDecision = z.infer<typeof interactionDecisionSchema>;
export type StoryboardOutput = z.infer<typeof storyboardOutputSchema>;
export type AgentContextSnapshot = z.infer<typeof agentContextSnapshotSchema>;

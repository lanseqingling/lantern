import { z } from "zod";
import { comicDocumentSchema, presentationUnitSchema } from "@lantern/shared";

const versionedWorkspaceObjectTypes = new Set(["asset", "character", "scene", "style", "storyboard_beat"]);

export const workspaceRefSchema = z.object({
  objectType: z.enum(["project", "chapter", "asset", "character", "scene", "style", "storyboard_beat", "presentation_unit", "canvas_element"]),
  objectId: z.string().min(1),
  versionId: z.string().min(1).optional(),
  label: z.string().trim().min(1).max(120).optional(),
}).superRefine((reference, context) => {
  if (versionedWorkspaceObjectTypes.has(reference.objectType) && !reference.versionId) {
    context.addIssue({ code: "custom", path: ["versionId"], message: `${reference.objectType} 引用必须固定 versionId` });
  }
});

export const explicitWorkspaceReferencesSchema = z.array(workspaceRefSchema).max(24);
export type WorkspaceReference = z.infer<typeof workspaceRefSchema>;

export const agentStoryboardBeatContextSchema = z.object({
  id: z.string().min(1),
  versionId: z.string().min(1),
  title: z.string(),
  description: z.string(),
});

export const explicitDialogueReferenceSchema = z.object({
  elementId: z.string().min(1),
  dialogueId: z.string().min(1),
  pageId: z.string().min(1),
  pageIndex: z.number().int().nonnegative(),
  comicFrameId: z.string().min(1).optional(),
  balloonNumber: z.number().int().positive(),
  text: z.string(),
  shape: z.enum(["normal", "thought", "caption_box", "cut_corner"]),
});

const currentComicFrameSchema = z.object({
  id: z.string().min(1),
  pageId: z.string().min(1),
  pageIndex: z.number().int().nonnegative(),
  readingOrder: z.number().int().positive(),
  linkedStoryboardBeatId: z.string().min(1).optional(),
  linkedStoryboardBeatVersionId: z.string().min(1).optional(),
  hasFrameImage: z.boolean(),
  dialogueElementCount: z.number().int().nonnegative(),
});

export const currentPageTargetSchema = z.object({
  handle: z.string().min(1),
  type: z.enum(["comic_frame", "storyboard_beat", "speech_balloon", "image", "text"]),
  label: z.string().min(1).max(120),
  aliases: z.array(z.string().min(1).max(120)).max(8).default([]),
  summary: z.string().max(600).default(""),
  pageId: z.string().min(1),
  pageLabel: z.string().min(1).max(120).optional(),
  elementId: z.string().min(1).optional(),
  frameId: z.string().min(1).optional(),
  frameLabel: z.string().min(1).max(120).optional(),
  storyboardBeatId: z.string().min(1).optional(),
  assetVersionIds: z.array(z.string().min(1)).max(12).default([]),
  dialogueIds: z.array(z.string().min(1)).max(12).default([]),
});
export type CurrentPageTarget = z.infer<typeof currentPageTargetSchema>;

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
  /** The bounded set of presentation units currently visible in the canvas. */
  currentView: z.object({
    unitIds: z.array(z.string().min(1)).min(1).max(2),
    label: z.string().min(1),
    physicalPageNumbers: z.array(z.number().int().positive()).max(4),
  }).optional(),
  /** Primary presentation unit in the current canvas view. */
  currentPage: z.object({ id: z.string().min(1), pageIndex: z.number().int().nonnegative(), kind: z.string().min(1), comicFrameCount: z.number().int().nonnegative() }).optional(),
  /** Read-only handles for semantic target resolution. Only objects in the current visible page view are listed. */
  currentPageTargets: z.array(currentPageTargetSchema).max(64).default([]),
  /** Exact, bounded LCD slice for the active presentation unit only. */
  currentPageLcd: z.object({
    unit: presentationUnitSchema,
    resources: comicDocumentSchema.shape.resources,
    dialogues: comicDocumentSchema.shape.dialogues,
  }).optional(),
  /** Exact LCD slices for every presentation unit visible in the canvas, bounded to two units. */
  visiblePageLcd: z.array(z.object({
    unit: presentationUnitSchema,
    resources: comicDocumentSchema.shape.resources,
    dialogues: comicDocumentSchema.shape.dialogues,
  })).max(2).default([]),
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
  explicitReferences: explicitWorkspaceReferencesSchema,
  explicitComicFrameReferences: z.array(z.object({
    frameId: z.string().min(1),
    pageId: z.string().min(1),
    pageIndex: z.number().int().nonnegative(),
    readingOrder: z.number().int().positive(),
    label: z.string().optional(),
    storyboardBeat: agentStoryboardBeatContextSchema.optional(),
  })).max(24).default([]),
  /** Text content resolved from explicitly referenced speech balloons. */
  explicitDialogueReferences: z.array(explicitDialogueReferenceSchema).max(24).default([]),
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
    kind: z.literal("ready_to_run"),
    message: z.string().min(1),
    scope: z.enum(["reference_only", "selected_storyboard_beat", "selected_comic_frame", "selected_element", "current_page", "after_current", "whole_chapter"]),
    taskType: z.enum(["storyboard", "frame_image_generate", "asset_parse"]),
  }),
]);

const interactionPlanBase = {
  goal: z.string().trim().min(1).max(500),
  evidenceHandles: z.array(z.string().trim().min(1).max(120)).max(24).default([]),
  confidence: z.number().min(0).max(1),
};

export const interactionPlanSchema = z.discriminatedUnion("outcome", [
  z.object({
    ...interactionPlanBase,
    outcome: z.literal("respond"),
    requestType: z.literal("conversation"),
    message: z.string().trim().min(1).max(8000),
  }),
  z.object({
    ...interactionPlanBase,
    outcome: z.literal("ask_user"),
    requestType: z.literal("operation"),
    message: z.string().trim().min(1).max(2000),
    missingInputs: z.array(z.object({
      field: z.string().trim().min(1).max(120),
      description: z.string().trim().min(1).max(500),
    })).min(1).max(3),
  }),
  z.object({
    ...interactionPlanBase,
    outcome: z.literal("invoke_capability"),
    requestType: z.literal("operation"),
    capabilityId: z.string().trim().min(1).max(160),
    targetHandles: z.array(z.string().trim().min(1).max(120)).max(24).default([]),
    arguments: z.record(z.string(), z.unknown()).default({}),
  }),
  z.object({
    ...interactionPlanBase,
    outcome: z.literal("unsupported"),
    requestType: z.literal("operation"),
    requestedOperation: z.string().trim().min(1).max(500),
    message: z.string().trim().min(1).max(2000),
  }),
]);

export const singleFrameStoryboardOutputSchema = z.strictObject({
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(4000),
  changeSummary: z.string().trim().min(1).max(500),
});

const assetKinds = ["character", "scene"] as const;

export const assetDraftSchema = z.strictObject({
  kind: z.enum(assetKinds),
  name: z.string().trim().min(1),
  description: z.string().trim().min(1).max(4000),
});

export const candidatePayloadEnvelopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("storyboard"), payload: singleFrameStoryboardOutputSchema.extend({
    mode: z.enum(["create", "replace"]),
    storyboardBeatId: z.string().min(1).optional(),
  }) }),
  z.object({ kind: z.literal("frame_image"), payload: z.strictObject({
    mode: z.enum(["place", "replace"]),
    assetId: z.string().min(1),
    assetVersionId: z.string().min(1),
    sourceAssetVersionIds: z.array(z.string().min(1)).default([]),
  }) }),
  z.object({ kind: z.literal("asset"), payload: assetDraftSchema.extend({ sourceAssetVersionIds: z.array(z.string().min(1)).min(1) }) }),
]);

export function parseCandidatePayload(kind: string, payload: unknown) {
  return candidatePayloadEnvelopeSchema.parse({ kind: kind.toLowerCase(), payload }).payload;
}

export type InteractionDecision = z.infer<typeof interactionDecisionSchema>;
export type InteractionPlan = z.infer<typeof interactionPlanSchema>;
export type SingleFrameStoryboardOutput = z.infer<typeof singleFrameStoryboardOutputSchema>;
export type AgentContextSnapshot = z.infer<typeof agentContextSnapshotSchema>;

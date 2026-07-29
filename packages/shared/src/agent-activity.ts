import { z } from "zod";

export const agentActivitySourceTypeSchema = z.enum(["external_mcp", "internal_agent"]);
export const agentActivityObservedStatusSchema = z.enum(["running", "completed", "timed_out"]);
export const agentActivityEventStatusSchema = z.enum(["running", "succeeded", "failed"]);
export const agentActivityProposalStatusSchema = z.enum(["available", "retained", "applied", "discarded", "stale"]);

export const agentActivityTargetSchema = z.strictObject({
  type: z.string().min(1),
  label: z.string().min(1).optional(),
  unitId: z.string().min(1).optional(),
  frameId: z.string().min(1).optional(),
  elementId: z.string().min(1).optional(),
  surfaceId: z.string().min(1).optional(),
  assetVersionIds: z.array(z.string().min(1)).max(12).default([]),
});

export const agentActivityProjectionSchema = z.strictObject({
  version: z.literal(1),
  kind: z.string().min(1),
  action: z.string().min(1),
  targets: z.array(agentActivityTargetSchema).max(32).default([]),
  data: z.unknown().optional(),
});

export const agentActivityNavigationSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("workbench_target"),
    projectId: z.string().min(1),
    unitId: z.string().min(1),
    frameId: z.string().min(1).optional(),
    elementId: z.string().min(1).optional(),
  }),
  z.strictObject({
    kind: z.literal("asset_version"),
    assetVersionId: z.string().min(1),
    contentUrl: z.string().min(1).optional(),
    label: z.string().min(1).optional(),
  }),
  z.strictObject({
    kind: z.literal("change_proposal"),
    proposalId: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal("saved_snapshot"),
    snapshotId: z.string().min(1),
  }),
]);

export const agentActivityEventSchema = z.strictObject({
  id: z.string().min(1),
  capabilityId: z.string().min(1).optional(),
  toolName: z.string().min(1),
  eventType: z.string().min(1),
  status: agentActivityEventStatusSchema,
  projection: agentActivityProjectionSchema,
  navigation: agentActivityNavigationSchema.optional(),
  startedAt: z.string(),
  completedAt: z.string().optional(),
});

export const agentActivityGroupSchema = z.strictObject({
  id: z.string().min(1),
  sourceType: agentActivitySourceTypeSchema,
  sourceReference: z.string().min(1).optional(),
  title: z.string().min(1),
  status: agentActivityObservedStatusSchema,
  baseWorkingRevision: z.number().int().positive().optional(),
  startedAt: z.string(),
  updatedAt: z.string(),
  expiresAt: z.string().optional(),
  completedAt: z.string().optional(),
  eventCount: z.number().int().nonnegative(),
  proposal: z.strictObject({
    id: z.string().min(1),
    status: agentActivityProposalStatusSchema,
    reviewPath: z.string().min(1),
    acceptedWorkingRevision: z.number().int().positive().optional(),
    acceptedSnapshotId: z.string().min(1).optional(),
  }).optional(),
  events: z.array(agentActivityEventSchema),
});

export const agentActivityFeedSchema = z.strictObject({
  groups: z.array(agentActivityGroupSchema),
  nextCursor: z.string().optional(),
  observedAt: z.string(),
});

export type AgentActivityProjection = z.infer<typeof agentActivityProjectionSchema>;
export type AgentActivityNavigation = z.infer<typeof agentActivityNavigationSchema>;
export type AgentActivityEvent = z.infer<typeof agentActivityEventSchema>;
export type AgentActivityGroup = z.infer<typeof agentActivityGroupSchema>;
export type AgentActivityFeed = z.infer<typeof agentActivityFeedSchema>;

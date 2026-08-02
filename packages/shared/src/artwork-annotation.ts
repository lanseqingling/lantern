import { z } from "zod";

export const artworkAnnotationStatusSchema = z.enum([
  "open",
  "in_progress",
  "awaiting_review",
  "resolved",
  "dismissed",
]);

export const artworkAnnotationObjectTypeSchema = z.enum([
  "presentation_unit",
  "comic_frame",
  "image",
  "speech_balloon",
  "text",
  "effect",
]);

const normalizedPointSchema = z.strictObject({
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
});

export const artworkAnnotationAnchorSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("point"),
    unitId: z.string().min(1),
    surfaceId: z.string().min(1).optional(),
    unitPoint: normalizedPointSchema,
  }),
  z.strictObject({
    kind: z.literal("object"),
    unitId: z.string().min(1),
    surfaceId: z.string().min(1).optional(),
    objectType: artworkAnnotationObjectTypeSchema,
    objectId: z.string().min(1),
    localPoint: normalizedPointSchema,
    fallbackUnitPoint: normalizedPointSchema,
  }),
]);

export const artworkAnnotationMessageSchema = z.strictObject({
  id: z.string().min(1),
  authorType: z.enum(["user", "external_agent", "internal_agent", "system"]),
  content: z.string(),
  createdAt: z.string(),
});

export const artworkAnnotationWorkSchema = z.strictObject({
  id: z.string().min(1),
  actorType: z.enum(["external_agent", "internal_agent"]),
  status: z.enum(["in_progress", "awaiting_review", "applied", "discarded"]),
  draft: z.string().optional(),
  proposal: z.string().optional(),
  reviewPath: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const artworkAnnotationReferenceSchema = z.strictObject({
  id: z.string().min(1),
  sortIndex: z.number().int().nonnegative(),
  anchor: artworkAnnotationAnchorSchema,
  resolvedUnitPoint: normalizedPointSchema,
  targetState: z.enum(["unchanged", "changed", "missing"]),
  pageLabel: z.string(),
  targetLabel: z.string(),
});

export const artworkAnnotationAttachmentInputSchema = z.strictObject({
  assetId: z.string().min(1),
  versionId: z.string().min(1),
  name: z.string().trim().min(1).max(240),
});

export const artworkAnnotationAttachmentSchema = artworkAnnotationAttachmentInputSchema.extend({
  id: z.string().min(1),
  sortIndex: z.number().int().nonnegative(),
});

export const artworkAnnotationSchema = z.strictObject({
  id: z.string().min(1),
  reference: z.string().min(1),
  projectId: z.string().min(1),
  status: artworkAnnotationStatusSchema,
  version: z.number().int().positive(),
  references: z.array(artworkAnnotationReferenceSchema).max(24),
  attachments: z.array(artworkAnnotationAttachmentSchema).max(3),
  createdWorkingRevision: z.number().int().positive(),
  currentWorkingRevision: z.number().int().positive(),
  messages: z.array(artworkAnnotationMessageSchema),
  work: z.array(artworkAnnotationWorkSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
  resolvedAt: z.string().optional(),
  dismissedAt: z.string().optional(),
});

export const artworkAnnotationCreateInputSchema = z.strictObject({
  expectedWorkingRevision: z.number().int().positive(),
  content: z.string().trim().min(1).max(4_000),
  references: z.array(artworkAnnotationAnchorSchema).max(24).default([]),
  attachments: z.array(artworkAnnotationAttachmentInputSchema).max(3).default([]),
});

export const artworkAnnotationUpdateInputSchema = z.strictObject({
  expectedVersion: z.number().int().positive(),
  content: z.string().trim().min(1).max(4_000).optional(),
  action: z.enum(["resolve", "reopen", "dismiss"]).optional(),
  references: z.array(artworkAnnotationAnchorSchema).max(24).optional(),
  attachments: z.array(artworkAnnotationAttachmentInputSchema).max(3).optional(),
}).refine((value) => value.content !== undefined || value.action !== undefined || value.references !== undefined || value.attachments !== undefined, {
  message: "批注更新至少需要一项内容。",
});

export type ArtworkAnnotation = z.infer<typeof artworkAnnotationSchema>;
export type ArtworkAnnotationAnchor = z.infer<typeof artworkAnnotationAnchorSchema>;
export type ArtworkAnnotationReference = z.infer<typeof artworkAnnotationReferenceSchema>;
export type ArtworkAnnotationAttachment = z.infer<typeof artworkAnnotationAttachmentSchema>;
export type ArtworkAnnotationAttachmentInput = z.infer<typeof artworkAnnotationAttachmentInputSchema>;
export type ArtworkAnnotationStatus = z.infer<typeof artworkAnnotationStatusSchema>;
export type ArtworkAnnotationObjectType = z.infer<typeof artworkAnnotationObjectTypeSchema>;

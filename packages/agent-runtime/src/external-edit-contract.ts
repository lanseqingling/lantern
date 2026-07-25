import { z } from "zod";
import { idempotencyKeySchema } from "./resource-capabilities";

export const externalDirectChangeEnvelopeShape = {
  scope: z.string().trim().min(1).max(2048),
  targetHandles: z.array(z.string().min(1).max(4096)).min(1).max(32),
  expectedRevision: z.number().int().positive(),
  idempotencyKey: idempotencyKeySchema,
  confirmedTargetHandles: z.array(z.string().min(1).max(4096)).min(1).max(32).optional(),
} as const;

export const externalDirectChangeEnvelopeSchema = z.strictObject(externalDirectChangeEnvelopeShape);

export type ExternalDirectChangeEnvelope = z.infer<typeof externalDirectChangeEnvelopeSchema>;

export const externalDirectChangeResultSchema = z.strictObject({
  capability: z.strictObject({
    id: z.string().min(1),
    version: z.number().int().positive(),
  }),
  effect: z.literal("direct_change"),
  project: z.string().min(1),
  baseRevision: z.number().int().positive(),
  workingRevision: z.number().int().positive(),
  data: z.unknown().optional(),
  nextActions: z.array(z.string()),
});

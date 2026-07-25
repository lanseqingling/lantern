import { z } from "zod";
import type { SemanticCapabilityManifest } from "./capability-types";
import { externalResourceReferenceSchema, idempotencyKeySchema } from "./resource-capabilities";

export const externalCandidateToolResultSchema = z.strictObject({
  capability: z.strictObject({ id: z.string().min(1), version: z.number().int().positive() }),
  effect: z.enum(["observe", "direct_change"]),
  candidate: z.strictObject({
    type: z.literal("candidate"),
    id: z.string().min(1),
    uri: z.string().min(1),
  }),
  project: z.string().min(1),
  baseRevision: z.number().int().positive(),
  workingRevision: z.number().int().positive(),
  data: z.unknown().optional(),
  nextActions: z.array(z.string()),
});

const candidateReferenceSchema = z.strictObject({
  candidate: externalResourceReferenceSchema,
});

const candidateApplySchema = candidateReferenceSchema.extend({
  expectedRevision: z.number().int().positive(),
  idempotencyKey: idempotencyKeySchema,
});

type CandidateManifestInput = Omit<
  SemanticCapabilityManifest,
  "version" | "execution" | "outputSchema" | "contextProfile" | "executionModes" | "agentAccess" | "idempotency" | "userMessage"
>;

function candidateCapability(input: CandidateManifestInput): SemanticCapabilityManifest {
  return {
    ...input,
    version: 1,
    execution: "synchronous",
    outputSchema: externalCandidateToolResultSchema,
    executionModes: ["deterministic"],
    agentAccess: { internal: "disabled", external: input.effect === "observe" ? "observe" : "execute" },
    idempotency: input.effect === "observe" ? "optional" : "required",
    userMessage: "",
  };
}

export const candidateCapabilities = [
  candidateCapability({
    id: "candidate.get",
    description: "通过稳定 Candidate 引用读取候选的目标、影响摘要、状态和基准 revision；不会应用或丢弃候选。",
    inputSchema: candidateReferenceSchema,
    target: { required: true, types: ["candidate"], min: 1, max: 1 },
    effect: "observe",
    risk: "low",
    domainCapabilities: ["candidate.get"],
    confirmation: "none",
  }),
  candidateCapability({
    id: "candidate.apply",
    description: "把一个明确且仍可用的 Candidate 应用到其固定创作空间。宿主可在同一用户请求中继续调用；应用时必须提供 Candidate 基准对应的 expected revision。",
    inputSchema: candidateApplySchema,
    target: { required: true, types: ["candidate"], min: 1, max: 1 },
    effect: "direct_change",
    risk: "medium",
    domainCapabilities: ["candidate.apply"],
    confirmation: "none",
  }),
] as const satisfies readonly SemanticCapabilityManifest[];

export function isCandidateCapabilityId(id: string) {
  return candidateCapabilities.some((capability) => capability.id === id);
}

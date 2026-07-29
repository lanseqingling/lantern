import { z } from "zod";
import type { SemanticCapabilityManifest } from "./capability-types";
import { idempotencyKeySchema } from "./resource-capabilities";

export const agentDraftFinishInputSchema = z.strictObject({
  draft: z.string().trim().min(1).max(2048),
  title: z.string().trim().min(1).max(120)
    .describe("与本次用户请求一致的简洁任务名，用作活动分组与方案标题。")
    .optional(),
  summary: z.string().trim().max(1200).optional(),
  idempotencyKey: idempotencyKeySchema,
});

export const agentDraftFinishOutputSchema = z.strictObject({
  capability: z.strictObject({ id: z.literal("agent_draft.finish"), version: z.literal(1) }),
  effect: z.literal("candidate"),
  proposal: z.string().min(1),
  projectId: z.string().min(1),
  baseWorkingRevision: z.number().int().positive(),
  draftRevision: z.number().int().positive(),
  reviewUrl: z.string().min(1),
  status: z.string().min(1),
  nextActions: z.array(z.string()),
});

export const agentDraftCapabilities = [{
  id: "agent_draft.finish",
  version: 1,
  execution: "synchronous",
  description: "在用户要求的编辑任务完成后冻结当前 AgentDraft，形成可从 Lantern 历史与草稿入口查看的 ChangeProposal，并返回同一版本对比界面的本地链接。title 应使用与本次用户请求一致的简洁任务名，作为活动分组与方案标题。该操作不会修改或保存正式工作稿；只有用户在 Lantern 中明确应用后，方案才进入正式版本历史。",
  inputSchema: agentDraftFinishInputSchema,
  outputSchema: agentDraftFinishOutputSchema,
  target: { required: true, types: ["agent_draft"], min: 1, max: 1 },
  effect: "candidate",
  executionModes: ["deterministic"],
  risk: "medium",
  agentAccess: { internal: "disabled", external: "execute" },
  idempotency: "required",
  domainCapabilities: ["change_proposal.create"],
  confirmation: "none",
  userMessage: "",
} as const] satisfies readonly SemanticCapabilityManifest[];

export function isAgentDraftCapabilityId(id: string) {
  return agentDraftCapabilities.some((capability) => capability.id === id);
}

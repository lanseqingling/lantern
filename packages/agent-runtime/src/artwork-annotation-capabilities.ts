import { z } from "zod";
import {
  artworkAnnotationReferenceSchema,
  artworkAnnotationSchema,
  artworkAnnotationStatusSchema,
} from "@lantern/shared";
import type { SemanticCapabilityManifest } from "./capability-types";
import { idempotencyKeySchema } from "./resource-capabilities";

const annotationReferenceSchema = z.string().trim().min(1).max(2048)
  .describe("Lantern 返回的 lantern://annotations/... 批注引用。");

export const artworkAnnotationListInputSchema = z.strictObject({
  project: z.string().trim().min(1).max(2048),
  statuses: z.array(artworkAnnotationStatusSchema).min(1).max(5).optional(),
  limit: z.number().int().min(1).max(50).default(30),
});

export const artworkAnnotationListOutputSchema = z.strictObject({
  capability: z.strictObject({ id: z.literal("annotation.list"), version: z.literal(1) }),
  effect: z.literal("observe"),
  project: z.string().min(1),
  workingRevision: z.number().int().positive(),
  annotations: z.array(artworkAnnotationSchema),
  nextActions: z.array(z.string()),
});

export const artworkAnnotationInspectInputSchema = z.strictObject({
  annotation: annotationReferenceSchema,
});

export const artworkAnnotationInspectOutputSchema = z.strictObject({
  capability: z.strictObject({ id: z.literal("annotation.inspect"), version: z.literal(1) }),
  effect: z.literal("observe"),
  type: z.literal("annotation_evidence"),
  annotation: artworkAnnotationSchema,
  projectId: z.string().min(1),
  workingRevision: z.number().int().positive(),
  evidence: z.array(z.strictObject({
    referenceId: z.string().min(1),
    reference: artworkAnnotationReferenceSchema,
    pageHandle: z.string().min(1),
    targetHandle: z.string().min(1).optional(),
    containingFrameHandle: z.string().min(1).optional(),
  })).max(24),
  attachmentHandles: z.array(z.strictObject({
    attachmentId: z.string().min(1),
    name: z.string().min(1),
    handle: z.string().min(1),
  })).max(3),
  nextActions: z.array(z.string()),
});

export const artworkAnnotationStartWorkInputSchema = z.strictObject({
  draft: z.string().trim().min(1).max(2048),
  annotations: z.array(annotationReferenceSchema).min(1).max(50),
  idempotencyKey: idempotencyKeySchema,
});

export const artworkAnnotationReplyInputSchema = z.strictObject({
  annotations: z.array(annotationReferenceSchema).min(1).max(50),
  content: z.string().trim().min(1).max(4_000),
  idempotencyKey: idempotencyKeySchema,
});

const collaborationOutputSchema = z.strictObject({
  capability: z.strictObject({ id: z.enum(["annotation.start_work", "annotation.reply"]), version: z.literal(1) }),
  effect: z.literal("collaboration_change"),
  projectId: z.string().min(1),
  workingRevision: z.number().int().positive(),
  annotations: z.array(artworkAnnotationSchema),
  nextActions: z.array(z.string()),
});

export const artworkAnnotationCapabilities = [
  {
    id: "annotation.list",
    version: 1,
    execution: "synchronous",
    description: "读取一个明确 Lantern 创作空间中的作品批注。默认只返回待处理、处理中和待确认批注；批注包含稳定引用、当前纸面位置、目标变化状态和处理关系，用户不需要描述页码、画格编号或内部 ID。",
    inputSchema: artworkAnnotationListInputSchema,
    outputSchema: artworkAnnotationListOutputSchema,
    target: { required: true, types: ["project"], min: 1, max: 1 },
    effect: "observe",
    executionModes: ["deterministic"],
    risk: "low",
    agentAccess: { internal: "disabled", external: "observe" },
    idempotency: "optional",
    domainCapabilities: ["artwork_annotation.list"],
    confirmation: "none",
    userMessage: "",
  },
  {
    id: "annotation.inspect",
    version: 1,
    execution: "synchronous",
    description: "读取一条作品批注的全部当前引用证据：每个纸面坐标或元素引用分别返回对象状态和绑定当前 WorkingRevision 的页面、对象及所在画格 handle；图片附件返回可继续检查固定版本的 handle。无引用文字批注也可读取，不创建任务、草稿或作品变更。",
    inputSchema: artworkAnnotationInspectInputSchema,
    outputSchema: artworkAnnotationInspectOutputSchema,
    target: { required: true, types: ["annotation"], min: 1, max: 1 },
    effect: "observe",
    executionModes: ["deterministic"],
    risk: "low",
    agentAccess: { internal: "disabled", external: "observe" },
    idempotency: "optional",
    domainCapabilities: ["artwork_annotation.inspect"],
    confirmation: "none",
    userMessage: "",
  },
  {
    id: "annotation.start_work",
    version: 1,
    execution: "synchronous",
    description: "把同一创作空间中的一组待处理批注绑定到当前外部 Agent 的活动 AgentDraft，并标记为处理中。该能力只改变协作状态，不修改 LCD 或正式工作稿；重试必须复用同一幂等键。",
    inputSchema: artworkAnnotationStartWorkInputSchema,
    outputSchema: collaborationOutputSchema,
    target: { required: true, types: ["annotation", "agent_draft"], min: 2, max: 51 },
    effect: "collaboration_change",
    executionModes: ["deterministic"],
    risk: "low",
    agentAccess: { internal: "disabled", external: "execute" },
    idempotency: "required",
    domainCapabilities: ["artwork_annotation.start_work"],
    confirmation: "none",
    userMessage: "",
  },
  {
    id: "annotation.reply",
    version: 1,
    execution: "synchronous",
    description: "向一组作品批注追加同一条简洁处理说明并交回创作者确认。不能编辑用户原文、解决、忽略或删除批注，也不修改 LCD 或正式工作稿。",
    inputSchema: artworkAnnotationReplyInputSchema,
    outputSchema: collaborationOutputSchema,
    target: { required: true, types: ["annotation"], min: 1, max: 50 },
    effect: "collaboration_change",
    executionModes: ["deterministic"],
    risk: "low",
    agentAccess: { internal: "disabled", external: "execute" },
    idempotency: "required",
    domainCapabilities: ["artwork_annotation.reply"],
    confirmation: "none",
    userMessage: "",
  },
] as const satisfies readonly SemanticCapabilityManifest[];

export const artworkAnnotationCollaborationOutputSchema = collaborationOutputSchema;

export function isArtworkAnnotationCapabilityId(id: string) {
  return artworkAnnotationCapabilities.some((capability) => capability.id === id);
}

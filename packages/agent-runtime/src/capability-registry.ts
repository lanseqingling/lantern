import { createHash } from "node:crypto";
import { z } from "zod";
import { compositionObservationSchema } from "./composition-observation";
import { candidateCapabilities } from "./candidate-capabilities";
import { agentDraftCapabilities } from "./agent-draft-capabilities";
import { compositionCapabilities } from "./composition-capabilities";
import { pageCapabilities } from "./page-capabilities";
import { resourceCapabilities } from "./resource-capabilities";
import type {
  AgentCapabilityActor,
  AgentTaskType,
  SemanticCapabilityManifest,
} from "./capability-types";

export type {
  AgentCapabilityAccess,
  AgentCapabilityActor,
  AgentCapabilityContextProfile,
  AgentCapabilityEffect,
  AgentCapabilityExecution,
  AgentCapabilityRisk,
  AgentTaskType,
  SemanticCapabilityManifest,
} from "./capability-types";

export const agentCapabilityIds = [
  "context.inspect_images",
  "context.inspect_composition",
  "storyboard.edit_single_entry",
  "frame_image.generate_or_replace",
  "asset.generate_character_or_scene",
] as const;
export type AgentCapabilityId = typeof agentCapabilityIds[number];

const instructionSchema = z.strictObject({
  instruction: z.string().trim().min(1).max(20_000),
});

const imageObservationInputSchema = z.strictObject({
  targetHandles: z.array(z.string().min(1).max(4096)).min(1).max(3),
  instruction: z.string().trim().min(1).max(20_000).optional(),
});

const imageObservationOutputSchema = z.strictObject({
  type: z.literal("visual_evidence"),
  content: z.string().min(1),
});

const compositionObservationInputSchema = z.strictObject({
  targetHandles: z.array(z.string().min(1).max(4096)).min(1).max(2),
});

const taskOutputSchema = z.strictObject({
  taskId: z.string().min(1),
  status: z.string().min(1),
  baseRevision: z.number().int().nonnegative(),
});

const assetGenerationInputSchema = instructionSchema.extend({
  kind: z.enum(["character", "scene"]).optional(),
});

export type AgentCapabilityDescriptor = SemanticCapabilityManifest;

const semanticCapabilities: readonly SemanticCapabilityManifest[] = [
  ...resourceCapabilities,
  ...candidateCapabilities,
  ...agentDraftCapabilities,
  ...pageCapabilities,
  ...compositionCapabilities,
  {
    id: "context.inspect_images",
    version: 1,
    execution: "synchronous",
    description: "读取本轮上传图片、资产固定图片版本，或用户唯一指明的当前页对象所关联图片，形成至多三张只读视觉证据。内置路径可形成视觉 Observation；外部 Agent 通过 MCP 直接获得固定 AssetVersion 原图及精确映射，由宿主 Agent 分析，不调用 Lantern 内部视觉模型。不创建任务、候选或变更。",
    inputSchema: imageObservationInputSchema,
    outputSchema: imageObservationOutputSchema,
    target: { required: true, types: ["image_attachment", "current_page_target"], min: 1, max: 3 },
    contextProfile: "visual_observation",
    effect: "observe",
    executionModes: ["lantern_managed"],
    risk: "low",
    agentAccess: { internal: "observe", external: "observe" },
    idempotency: "optional",
    domainCapabilities: [],
    confirmation: "none",
    userMessage: "",
    missingTargetMessage: "请先添加图片，或明确说出当前页中包含图片的画格或分镜。",
  },
  {
    id: "context.inspect_composition",
    version: 1,
    execution: "synchronous",
    description: "读取一个或两个明确 PresentationUnit，返回绑定同一 Working Revision 或 SavedSnapshot 的结构化场景投影和最终合成画面 Observation。仅当回答、空间判断或一个已开放 Capability 的参数判断依赖画格、图片、气泡、文字、裁切、遮挡、层级、留白或阅读关系时调用；保存版本只读，观察不授予 LCD 编辑能力，不读取整话，不创建任务、候选或变更。",
    inputSchema: compositionObservationInputSchema,
    outputSchema: compositionObservationSchema,
    target: { required: true, types: ["presentation_unit"], min: 1, max: 2 },
    contextProfile: "composition_observation",
    effect: "observe",
    executionModes: ["lantern_managed"],
    risk: "low",
    agentAccess: { internal: "observe", external: "observe" },
    idempotency: "optional",
    domainCapabilities: [],
    confirmation: "none",
    userMessage: "",
    missingTargetMessage: "请先打开要分析的漫画页或滚动段。",
  },
  {
    id: "storyboard.edit_single_entry",
    version: 1,
    execution: "asynchronous",
    taskType: "storyboard",
    description: "创建或编辑唯一明确目标漫画格所绑定的一个分镜条目（StoryboardBeat），目标可来自当前选择、显式引用，或用户在当前页上下文中唯一指明的画格、对白、气泡或分镜名称。结果只包含该条目的文字标题与画面描述。当用户明确要求改变这一个分镜条目，且期望产物是文字分镜而不是图片、对白、画格结构或整页方案时调用。不能处理多个画格、整页、整话、页面编排或格内成稿图。",
    inputSchema: instructionSchema,
    outputSchema: taskOutputSchema,
    target: { required: true, types: ["comic_frame"], min: 1, max: 1 },
    scope: "selected_comic_frame",
    contextProfile: "single_frame_generation",
    effect: "candidate",
    executionModes: ["lantern_managed"],
    risk: "medium",
    agentAccess: { internal: "execute", external: "execute" },
    idempotency: "required",
    domainCapabilities: ["update_storyboard_beat", "create_frame_storyboard_beat"],
    confirmation: "none",
    userMessage: "我会编辑目标画格的分镜条目，只更新它的标题和画面描述；应用前不会改变工作稿。",
    missingTargetMessage: "请选中一个漫画格，或明确说出当前页中的画格编号、对白、气泡或分镜名称。",
  },
  {
    id: "frame_image.generate_or_replace",
    version: 1,
    execution: "asynchronous",
    taskType: "frame_image_generate",
    description: "为唯一明确目标漫画格生成格内图片，目标可来自当前选择、显式引用，或用户在当前页上下文中唯一指明的画格、对白、气泡或分镜名称；画格已有主图时形成替换候选，没有主图时形成放入候选。当用户明确要求重新生成、重画或替换该格的视觉画面，并且期望产物是图片而不是文字分镜时调用。不能改变分镜条目、对白、画格几何、页面编排或其他画格。",
    inputSchema: instructionSchema,
    outputSchema: taskOutputSchema,
    target: { required: true, types: ["comic_frame"], min: 1, max: 1 },
    scope: "selected_comic_frame",
    contextProfile: "single_frame_generation",
    effect: "candidate",
    executionModes: ["lantern_managed"],
    risk: "high",
    agentAccess: { internal: "execute", external: "execute" },
    idempotency: "required",
    domainCapabilities: ["place_frame_image", "replace_frame_image"],
    confirmation: "none",
    userMessage: "我会为目标画格生成新的格内图片；应用前不会替换当前画面。",
    missingTargetMessage: "请选中一个漫画格，或明确说出当前页中的画格编号、对白、气泡或分镜名称。",
  },
  {
    id: "asset.generate_character_or_scene",
    version: 1,
    execution: "asynchronous",
    taskType: "asset_image_generate",
    description: "根据用户明确的生成要求创建一个角色或场景资产图片候选。讨论、设计或完善设定但未要求生成图片、卡片或资产时不调用。",
    inputSchema: assetGenerationInputSchema,
    outputSchema: taskOutputSchema,
    target: { required: false, types: [], min: 0, max: 0 },
    scope: "reference_only",
    contextProfile: "asset_generation",
    effect: "candidate",
    executionModes: ["lantern_managed"],
    risk: "high",
    agentAccess: { internal: "execute", external: "execute" },
    idempotency: "required",
    domainCapabilities: [],
    confirmation: "none",
    userMessage: "我会按当前描述生成一个可编辑的资产候选；确认后才保存到资产空间。",
  },
] as const;

export const SEMANTIC_CAPABILITY_CATALOG_REVISION = 18;

function jsonSchema(schema: z.ZodType) {
  return z.toJSONSchema(schema, { target: "draft-7" });
}

function stableJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, stableJson(item)]));
}

export function listAgentCapabilities() {
  return semanticCapabilities;
}

export function getAgentCapability(id: AgentCapabilityId): (AgentCapabilityDescriptor & { id: AgentCapabilityId }) | undefined;
export function getAgentCapability(id: string): AgentCapabilityDescriptor | undefined;
export function getAgentCapability(id: string) {
  return semanticCapabilities.find((capability) => capability.id === id);
}

export function getTaskAgentCapability(taskType: string) {
  return semanticCapabilities.find((capability) => capability.execution === "asynchronous" && capability.taskType === taskType) as
    | (AgentCapabilityDescriptor & { id: AgentCapabilityId; execution: "asynchronous"; taskType: AgentTaskType })
    | undefined;
}

export function isAgentTaskType(taskType: string): taskType is AgentTaskType {
  return Boolean(getTaskAgentCapability(taskType));
}

export function assertAgentCapabilityAccess(capability: AgentCapabilityDescriptor, actor: AgentCapabilityActor) {
  const access = capability.agentAccess[actor];
  const required = capability.effect === "observe" ? "observe" : "execute";
  if (access === required || access === "execute") return;
  throw new Error(`AGENT_CAPABILITY_ACCESS_DENIED:${actor}:${capability.id}`);
}

export function semanticCapabilityCatalog() {
  return semanticCapabilities.map(({ inputSchema, outputSchema, userMessage, missingTargetMessage, ...capability }) => {
    void userMessage;
    void missingTargetMessage;
    return {
      ...capability,
      inputSchema: jsonSchema(inputSchema),
      outputSchema: jsonSchema(outputSchema),
    };
  });
}

export function semanticCapabilityCatalogManifest() {
  const capabilities = semanticCapabilityCatalog();
  const serialized = JSON.stringify(stableJson({ revision: SEMANTIC_CAPABILITY_CATALOG_REVISION, capabilities }));
  return {
    revision: SEMANTIC_CAPABILITY_CATALOG_REVISION,
    hash: createHash("sha256").update(serialized).digest("hex"),
    capabilities,
  };
}

export function plannerCapabilityCatalog() {
  return semanticCapabilities.filter((capability) => capability.agentAccess.internal !== "disabled").map((capability) => ({
    id: capability.id,
    version: capability.version,
    execution: capability.execution,
    description: capability.description,
    target: capability.target,
    contextProfile: capability.contextProfile,
    effect: capability.effect,
    risk: capability.risk,
    confirmation: capability.confirmation,
  }));
}

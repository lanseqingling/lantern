import { z } from "zod";
import type { SemanticCapabilityManifest } from "./capability-types";

export const externalResourceReferenceSchema = z.string().trim().min(1).max(2048);

export const externalResourceToolResultSchema = z.strictObject({
  capability: z.strictObject({ id: z.string().min(1), version: z.number().int().positive() }),
  effect: z.enum(["observe", "resource_mutation"]),
  resource: z.strictObject({ type: z.string().min(1), id: z.string().min(1), uri: z.string().min(1) }).optional(),
  projectId: z.string().min(1).optional(),
  baseRevision: z.number().int().positive().optional(),
  workingRevision: z.number().int().positive().optional(),
  data: z.unknown().optional(),
  nextActions: z.array(z.string()),
});

const comicReferenceSchema = z.strictObject({ comic: externalResourceReferenceSchema });
const chapterReferenceSchema = z.strictObject({ chapter: externalResourceReferenceSchema });
const assetReferenceSchema = z.strictObject({ asset: externalResourceReferenceSchema });

const comicCreateSchema = z.strictObject({
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(2000),
  worldSummary: z.string().trim().max(4000).optional(),
  styleSummary: z.string().trim().max(4000).optional(),
  format: z.enum(["page", "vertical", "four_panel"]).default("page"),
  canvasPageMode: z.enum(["single", "spread"]).default("single"),
});

const comicUpdateSchema = z.strictObject({
  comic: externalResourceReferenceSchema,
  title: z.string().trim().min(1).max(120).optional(),
  summary: z.string().trim().min(1).max(2000).optional(),
  worldSummary: z.string().trim().max(4000).optional(),
  styleSummary: z.string().trim().max(4000).optional(),
  canvasPageMode: z.enum(["single", "spread"]).optional(),
}).refine((value) => value.title !== undefined || value.summary !== undefined || value.worldSummary !== undefined || value.styleSummary !== undefined || value.canvasPageMode !== undefined, {
  message: "至少提供一个要更新的漫画字段。",
});

const chapterCreateSchema = z.strictObject({
  comic: externalResourceReferenceSchema,
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(2000),
});

const chapterUpdateSchema = z.strictObject({
  chapter: externalResourceReferenceSchema,
  title: z.string().trim().min(1).max(120).optional(),
  summary: z.string().trim().min(1).max(2000).optional(),
}).refine((value) => value.title !== undefined || value.summary !== undefined, {
  message: "至少提供一个要更新的一话字段。",
});

const confirmedComicReferenceSchema = comicReferenceSchema.extend({ confirmed: z.literal(true) });
const confirmedChapterReferenceSchema = chapterReferenceSchema.extend({ confirmed: z.literal(true) });
const confirmedAssetReferenceSchema = assetReferenceSchema.extend({ confirmed: z.literal(true) });

const assetCreateSchema = z.strictObject({
  comic: externalResourceReferenceSchema,
  kind: z.enum(["character", "scene", "prop", "reference_image"]),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(4000).default(""),
});

const assetUpdateSchema = z.strictObject({
  asset: externalResourceReferenceSchema,
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(4000).optional(),
}).refine((value) => value.name !== undefined || value.description !== undefined, {
  message: "至少提供一个要更新的资产字段。",
});

type ResourceManifestInput = Omit<SemanticCapabilityManifest, "version" | "execution" | "outputSchema" | "contextProfile" | "executionModes" | "agentAccess" | "idempotency" | "userMessage">;

function resourceCapability(input: ResourceManifestInput): SemanticCapabilityManifest {
  return {
    ...input,
    version: 1,
    execution: "synchronous",
    outputSchema: externalResourceToolResultSchema,
    executionModes: ["deterministic"],
    agentAccess: { internal: "disabled", external: input.effect === "observe" ? "observe" : "execute" },
    idempotency: "optional",
    userMessage: "",
  };
}

export const resourceCapabilities = [
  resourceCapability({
    id: "comic.list",
    description: "列出当前用户的漫画；仅在目标作品不明确或用户明确要求查看作品列表时调用。",
    inputSchema: z.strictObject({ cursor: z.string().max(2048).optional(), limit: z.number().int().min(1).max(50).default(20) }),
    target: { required: false, types: [], min: 0, max: 0 },
    effect: "observe",
    risk: "low",
    domainCapabilities: ["comic.list"],
    confirmation: "none",
  }),
  resourceCapability({
    id: "comic.get",
    description: "通过 Lantern Resource Reference 读取一部漫画及其一话列表，不按标题猜测目标。",
    inputSchema: comicReferenceSchema,
    target: { required: true, types: ["comic"], min: 1, max: 1 },
    effect: "observe",
    risk: "low",
    domainCapabilities: ["comic.get"],
    confirmation: "none",
  }),
  resourceCapability({
    id: "comic.create",
    description: "创建一部空漫画及漫画级故事概要、世界概要和视觉风格文字；不会自动创建一话。",
    inputSchema: comicCreateSchema,
    target: { required: false, types: [], min: 0, max: 0 },
    effect: "resource_mutation",
    risk: "low",
    domainCapabilities: ["comic.create"],
    confirmation: "none",
  }),
  resourceCapability({
    id: "comic.update",
    description: "更新一部明确漫画的名称、故事概要、世界概要、视觉风格文字或页面模式。",
    inputSchema: comicUpdateSchema,
    target: { required: true, types: ["comic"], min: 1, max: 1 },
    effect: "resource_mutation",
    risk: "low",
    domainCapabilities: ["comic.update"],
    confirmation: "none",
  }),
  resourceCapability({
    id: "comic.duplicate",
    description: "深度复制一部明确漫画及其一话、工作稿、快照和资产，返回新漫画引用。",
    inputSchema: comicReferenceSchema,
    target: { required: true, types: ["comic"], min: 1, max: 1 },
    effect: "resource_mutation",
    risk: "medium",
    domainCapabilities: ["comic.duplicate"],
    confirmation: "none",
  }),
  resourceCapability({
    id: "comic.archive",
    description: "归档一部明确漫画及其活动一话。该破坏性动作要求调用参数显式确认。",
    inputSchema: confirmedComicReferenceSchema,
    target: { required: true, types: ["comic"], min: 1, max: 1 },
    effect: "resource_mutation",
    risk: "high",
    domainCapabilities: ["comic.archive"],
    confirmation: "explicit",
  }),
  resourceCapability({
    id: "chapter.get",
    description: "通过 Lantern Resource Reference 读取一话及其 Project 和当前 working revision。",
    inputSchema: chapterReferenceSchema,
    target: { required: true, types: ["chapter"], min: 1, max: 1 },
    effect: "observe",
    risk: "low",
    domainCapabilities: ["chapter.get"],
    confirmation: "none",
  }),
  resourceCapability({
    id: "chapter.create",
    description: "在一部明确漫画中创建一话，并同时建立对应 Project、初始工作稿和创作对话。",
    inputSchema: chapterCreateSchema,
    target: { required: true, types: ["comic"], min: 1, max: 1 },
    effect: "resource_mutation",
    risk: "low",
    domainCapabilities: ["chapter.create"],
    confirmation: "none",
  }),
  resourceCapability({
    id: "chapter.update",
    description: "更新一话的标题或梗概，不修改其 LCD 工作稿。",
    inputSchema: chapterUpdateSchema,
    target: { required: true, types: ["chapter"], min: 1, max: 1 },
    effect: "resource_mutation",
    risk: "low",
    domainCapabilities: ["chapter.update"],
    confirmation: "none",
  }),
  resourceCapability({
    id: "chapter.archive",
    description: "归档一部明确漫画中的一话。该破坏性动作要求调用参数显式确认。",
    inputSchema: confirmedChapterReferenceSchema,
    target: { required: true, types: ["chapter"], min: 1, max: 1 },
    effect: "resource_mutation",
    risk: "high",
    domainCapabilities: ["chapter.archive"],
    confirmation: "explicit",
  }),
  resourceCapability({
    id: "asset.list",
    description: "列出一部明确漫画中的角色、场景、道具和参考资料资产卡。",
    inputSchema: comicReferenceSchema,
    target: { required: true, types: ["comic"], min: 1, max: 1 },
    effect: "observe",
    risk: "low",
    domainCapabilities: ["asset.list"],
    confirmation: "none",
  }),
  resourceCapability({
    id: "asset.get",
    description: "读取一个明确资产家族的结构化资料、图片槽和派生形态。",
    inputSchema: assetReferenceSchema,
    target: { required: true, types: ["asset"], min: 1, max: 1 },
    effect: "observe",
    risk: "low",
    domainCapabilities: ["asset.get"],
    confirmation: "none",
  }),
  resourceCapability({
    id: "asset.create",
    description: "把用户已经确认的角色、场景、道具或参考资料保存为漫画级结构化资产卡；不生成图片。",
    inputSchema: assetCreateSchema,
    target: { required: true, types: ["comic"], min: 1, max: 1 },
    effect: "resource_mutation",
    risk: "low",
    domainCapabilities: ["asset.create"],
    confirmation: "none",
  }),
  resourceCapability({
    id: "asset.update",
    description: "更新一个明确资产的名称或结构化描述；不生成或替换图片。",
    inputSchema: assetUpdateSchema,
    target: { required: true, types: ["asset"], min: 1, max: 1 },
    effect: "resource_mutation",
    risk: "low",
    domainCapabilities: ["asset.update"],
    confirmation: "none",
  }),
  resourceCapability({
    id: "asset.archive",
    description: "归档一个明确资产及其派生形态。该破坏性动作要求调用参数显式确认。",
    inputSchema: confirmedAssetReferenceSchema,
    target: { required: true, types: ["asset"], min: 1, max: 1 },
    effect: "resource_mutation",
    risk: "high",
    domainCapabilities: ["asset.archive"],
    confirmation: "explicit",
  }),
] as const satisfies readonly SemanticCapabilityManifest[];

export function isResourceCapabilityId(id: string) {
  return resourceCapabilities.some((capability) => capability.id === id);
}

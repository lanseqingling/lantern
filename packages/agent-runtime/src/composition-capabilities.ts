import { z } from "zod";
import type { SemanticCapabilityManifest } from "./capability-types";
import {
  externalDirectChangeEnvelopeShape,
  externalDirectChangeResultSchema,
} from "./external-edit-contract";

const geometrySchema = z.strictObject({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().positive(),
  height: z.number().positive(),
  rotate: z.number().finite().optional(),
});

const normalizedRectSchema = z.strictObject({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().positive().max(1),
  height: z.number().positive().max(1),
}).refine((rect) => rect.x + rect.width <= 1 && rect.y + rect.height <= 1, {
  message: "裁切范围必须位于归一化图片区域内。",
});

const framePointSchema = z.strictObject({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

const frameShapeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("rect") }),
  z.strictObject({
    kind: z.literal("polygon"),
    points: z.tuple([framePointSchema, framePointSchema, framePointSchema, framePointSchema]),
  }),
]);

const singleTargetEnvelopeShape = {
  ...externalDirectChangeEnvelopeShape,
} as const;

const frameCreateSchema = z.strictObject({
  ...singleTargetEnvelopeShape,
  geometry: geometrySchema,
  name: z.string().trim().min(1).max(80).optional(),
  readingPosition: z.number().int().positive().optional(),
  allowOverlap: z.boolean().default(false),
}).superRefine((input, context) => {
  if (input.targetHandles.length !== 1) {
    context.addIssue({ code: "custom", path: ["targetHandles"], message: "创建画格只接受一个页面或纸面目标。" });
  }
});

const frameUpdateSchema = z.strictObject({
  ...singleTargetEnvelopeShape,
  geometry: geometrySchema.optional(),
  shape: frameShapeSchema.optional(),
  borderWidth: z.number().min(0).max(24).optional(),
  bleed: z.strictObject({
    edge: z.enum(["top", "right", "bottom", "left"]),
    enabled: z.boolean(),
  }).optional(),
  zIndex: z.number().int().optional(),
  readingPosition: z.number().int().positive().optional(),
  allowOverlap: z.boolean().optional(),
}).superRefine((input, context) => {
  if (input.targetHandles.length !== 1) {
    context.addIssue({ code: "custom", path: ["targetHandles"], message: "修改画格只接受一个画格目标。" });
  }
  if (![input.geometry, input.shape, input.borderWidth, input.bleed, input.zIndex, input.readingPosition, input.allowOverlap].some((value) => value !== undefined)) {
    context.addIssue({ code: "custom", message: "画格修改不能为空。" });
  }
  if (input.geometry && input.bleed) {
    context.addIssue({ code: "custom", message: "画格几何与出血边需要分两次修改，并在两次之间刷新上下文。" });
  }
  if (input.geometry && input.allowOverlap === false) {
    context.addIssue({ code: "custom", message: "关闭叠格前请先单独完成几何调整、刷新上下文，再关闭叠格。" });
  }
});

const singleFrameTargetSchema = z.strictObject({
  ...singleTargetEnvelopeShape,
}).superRefine((input, context) => {
  if (input.targetHandles.length !== 1) {
    context.addIssue({ code: "custom", path: ["targetHandles"], message: "该画格操作只接受一个画格目标。" });
  }
});

const imagePlaceSchema = z.strictObject({
  ...singleTargetEnvelopeShape,
  asset: z.string().trim().min(1).max(2048),
  assetVersionId: z.string().min(1).optional(),
  transform: geometrySchema.optional(),
  crop: normalizedRectSchema.optional(),
}).superRefine((input, context) => {
  if (input.targetHandles.length !== 1) {
    context.addIssue({ code: "custom", path: ["targetHandles"], message: "放置图片只接受一个画格、页面或纸面目标。" });
  }
});

const imageUpdateSchema = z.strictObject({
  ...singleTargetEnvelopeShape,
  asset: z.string().trim().min(1).max(2048).optional(),
  assetVersionId: z.string().min(1).optional(),
  transform: geometrySchema.optional(),
  crop: normalizedRectSchema.optional(),
  placement: z.enum(["breakout", "page"]).optional(),
  zOrder: z.enum(["front", "back"]).optional(),
}).superRefine((input, context) => {
  if (input.targetHandles.length !== 1) {
    context.addIssue({ code: "custom", path: ["targetHandles"], message: "修改图片只接受一个图片目标。" });
  }
  if (!input.asset && input.assetVersionId) {
    context.addIssue({ code: "custom", path: ["assetVersionId"], message: "指定图片版本时必须同时提供资产引用。" });
  }
  if (![input.asset, input.transform, input.crop, input.placement, input.zOrder].some((value) => value !== undefined)) {
    context.addIssue({ code: "custom", message: "图片修改不能为空。" });
  }
  if (input.placement && [input.asset, input.transform, input.crop, input.zOrder].some((value) => value !== undefined)) {
    context.addIssue({ code: "custom", path: ["placement"], message: "改变图片归属后 handle 会失效；请单独调用并刷新上下文。" });
  }
});

const imageRemoveSchema = z.strictObject({
  ...singleTargetEnvelopeShape,
}).superRefine((input, context) => {
  if (input.targetHandles.length !== 1) {
    context.addIssue({ code: "custom", path: ["targetHandles"], message: "移除图片只接受一个图片目标。" });
  }
});

type CompositionManifestInput = Omit<
  SemanticCapabilityManifest,
  "version" | "execution" | "outputSchema" | "executionModes" | "agentAccess" | "idempotency" | "userMessage"
> & { version?: number };

function compositionCapability(input: CompositionManifestInput): SemanticCapabilityManifest {
  return {
    ...input,
    version: input.version ?? 1,
    execution: "synchronous",
    outputSchema: externalDirectChangeResultSchema,
    executionModes: ["deterministic"],
    agentAccess: { internal: "disabled", external: "execute" },
    idempotency: "required",
    userMessage: "",
  };
}

export const compositionCapabilities = [
  compositionCapability({
    id: "frame.create",
    description: "在一个正文页或明确 PageSurface 中按纸面绝对坐标创建画格，可设置名称、1-based 阅读位置，并显式开启叠格。geometry 必须完整位于目标纸面；封面与过场页不能创建画格。",
    inputSchema: frameCreateSchema,
    target: { required: true, types: ["presentation_unit", "page_surface"], min: 1, max: 1 },
    effect: "direct_change",
    risk: "medium",
    domainCapabilities: ["create_frame"],
    confirmation: "none",
  }),
  compositionCapability({
    id: "frame.update",
    version: 2,
    description: "修改一个画格的纸面绝对几何、直角矩形/四点斜切形状、边框宽度、单边出血、视觉层级、1-based 阅读位置或叠格策略。当前不开放圆角或椭圆画格编辑。几何和出血必须分次调用；出血会把对应边扩到所在纸面边缘。",
    inputSchema: frameUpdateSchema,
    target: { required: true, types: ["comic_frame"], min: 1, max: 1 },
    effect: "direct_change",
    risk: "medium",
    domainCapabilities: ["set_frame_overlap_policy", "resize_frame", "reshape_frame", "update_frame_border", "update_frame_bleed", "reorder_frame", "reorder_frame_reading"],
    confirmation: "none",
  }),
  compositionCapability({
    id: "frame.duplicate",
    description: "复制一个明确画格及其图层内容，在同一纸面寻找可用位置，并形成可撤销的原子变更。",
    inputSchema: singleFrameTargetSchema,
    target: { required: true, types: ["comic_frame"], min: 1, max: 1 },
    effect: "direct_change",
    risk: "medium",
    domainCapabilities: ["duplicate_frame"],
    confirmation: "none",
  }),
  compositionCapability({
    id: "frame.delete",
    description: "删除一个明确画格及其 frame-anchored 覆盖内容；分镜条目保留为未放置内容。该编辑可撤销，不用于删除页面、一话或漫画。",
    inputSchema: singleFrameTargetSchema,
    target: { required: true, types: ["comic_frame"], min: 1, max: 1 },
    effect: "direct_change",
    risk: "high",
    domainCapabilities: ["delete_frame"],
    confirmation: "none",
  }),
  compositionCapability({
    id: "image.place",
    description: "把资产卡片中的一个不可变图片版本放入画格或纸面。画格图片的 transform 使用 frame_local 归一化坐标；纸面图片使用 unit 绝对坐标。省略版本时使用资产当前主图，省略 transform 时画格填满、纸面按素材比例给出默认尺寸。",
    inputSchema: imagePlaceSchema,
    target: { required: true, types: ["comic_frame", "presentation_unit", "page_surface"], min: 1, max: 1 },
    effect: "direct_change",
    risk: "low",
    domainCapabilities: ["place_frame_image", "create_page_image"],
    confirmation: "none",
  }),
  compositionCapability({
    id: "image.update",
    description: "更换一个图片元素的固定资产版本，或修改原始 transform、归一化 crop 和覆盖层前后层级。placement=breakout 把格内图变为 frame-anchored 破格覆盖；placement=page 把格内图或破格图转换为纸面图，改变归属后必须刷新上下文。",
    inputSchema: imageUpdateSchema,
    target: { required: true, types: ["image"], min: 1, max: 1 },
    effect: "direct_change",
    risk: "medium",
    domainCapabilities: ["replace_image", "set_element_transform", "set_art_crop", "promote_element_to_overlay", "convert_element_to_page", "reorder_overlay_element"],
    confirmation: "none",
  }),
  compositionCapability({
    id: "image.remove",
    description: "移除一个明确的格内、破格或纸面图片元素；不删除对应资产卡片和不可变 AssetVersion。",
    inputSchema: imageRemoveSchema,
    target: { required: true, types: ["image"], min: 1, max: 1 },
    effect: "direct_change",
    risk: "low",
    domainCapabilities: ["remove_frame_image"],
    confirmation: "none",
  }),
] as const satisfies readonly SemanticCapabilityManifest[];

export function isCompositionCapabilityId(id: string) {
  return compositionCapabilities.some((capability) => capability.id === id);
}

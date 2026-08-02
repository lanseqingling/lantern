import { z } from "zod";
import type { SemanticCapabilityManifest } from "./capability-types";
import {
  externalDirectChangeEnvelopeShape,
  externalDirectChangeResultSchema,
} from "./external-edit-contract";

const pageNameSchema = z.string().trim().max(80);
const pageRoleSchema = z.enum(["story", "cover", "interlude"]);
const relativeSideSchema = z.enum(["before", "after"]);

const pageCreateSchema = z.strictObject({
  ...externalDirectChangeEnvelopeShape,
  pageRole: pageRoleSchema.default("story"),
  name: pageNameSchema.optional(),
  side: relativeSideSchema.optional(),
}).superRefine((input, context) => {
  if (input.targetHandles.length !== 1) {
    context.addIssue({ code: "custom", path: ["targetHandles"], message: "创建页面需要一个当前页面作为 revision-bound 定位锚点。" });
  }
  if (input.pageRole !== "cover" && !input.side) {
    context.addIssue({ code: "custom", path: ["side"], message: "正文页或过场页必须说明插入在锚点之前还是之后。" });
  }
});

const spreadCreateSchema = z.strictObject({
  ...externalDirectChangeEnvelopeShape,
  name: pageNameSchema.optional(),
  side: relativeSideSchema,
}).superRefine((input, context) => {
  if (input.targetHandles.length !== 1) {
    context.addIssue({ code: "custom", path: ["targetHandles"], message: "创建跨页需要一个当前页面作为 revision-bound 定位锚点。" });
  }
});

const singlePageTargetSchema = z.strictObject({
  ...externalDirectChangeEnvelopeShape,
}).superRefine((input, context) => {
  if (input.targetHandles.length !== 1) {
    context.addIssue({ code: "custom", path: ["targetHandles"], message: "该页面操作只接受一个页面目标。" });
  }
});

const pageRenameSchema = z.strictObject({
  ...externalDirectChangeEnvelopeShape,
  name: pageNameSchema,
}).superRefine((input, context) => {
  if (input.targetHandles.length !== 1) {
    context.addIssue({ code: "custom", path: ["targetHandles"], message: "页面命名只接受一个页面目标。" });
  }
});

const pageMoveSchema = z.strictObject({
  ...externalDirectChangeEnvelopeShape,
  side: relativeSideSchema,
}).superRefine((input, context) => {
  if (input.targetHandles.length !== 2) {
    context.addIssue({ code: "custom", path: ["targetHandles"], message: "页面排序依次需要待移动页面和定位锚点两个目标。" });
  }
});

const pagePairSchema = z.strictObject({
  ...externalDirectChangeEnvelopeShape,
}).superRefine((input, context) => {
  if (input.targetHandles.length !== 2) {
    context.addIssue({ code: "custom", path: ["targetHandles"], message: "合并真正双页需要两个相邻页面目标。" });
  }
});

const pageDeleteSchema = z.strictObject({
  ...externalDirectChangeEnvelopeShape,
  confirmedTargetHandles: z.array(z.string().min(1).max(4096)).length(1),
}).superRefine((input, context) => {
  if (input.targetHandles.length !== 1) {
    context.addIssue({ code: "custom", path: ["targetHandles"], message: "删除页面只接受一个页面目标。" });
  }
});

type PageManifestInput = Omit<
  SemanticCapabilityManifest,
  "version" | "execution" | "outputSchema" | "contextProfile" | "executionModes" | "agentAccess" | "idempotency" | "userMessage"
>;

function pageCapability(input: PageManifestInput): SemanticCapabilityManifest {
  return {
    ...input,
    version: 1,
    execution: "synchronous",
    outputSchema: externalDirectChangeResultSchema,
    executionModes: ["deterministic"],
    agentAccess: { internal: "disabled", external: "execute" },
    idempotency: "required",
    userMessage: "",
  };
}

export const pageCapabilities = [
  pageCapability({
    id: "page.create",
    description: "在页漫一话中创建正文页、封面或过场页。targetHandles 提供一个当前页面锚点；正文页和过场页通过 side 插入其前后，封面忽略 side 并由领域规则固定在首位。可同时设置页面名称。不适用于条漫。",
    inputSchema: pageCreateSchema,
    target: { required: true, types: ["presentation_unit"], min: 1, max: 1 },
    effect: "direct_change",
    risk: "medium",
    domainCapabilities: ["create_page"],
    confirmation: "none",
  }),
  pageCapability({
    id: "page.create_spread",
    description: "在页漫一话中直接创建由左右两个物理纸面构成的正文双页。targetHandles 提供一个当前页面锚点，side 决定插入其前后；新双页可立即承载跨页图片、跨页格与跨页对象。不创建封面或过场跨页，也不适用于条漫。",
    inputSchema: spreadCreateSchema,
    target: { required: true, types: ["presentation_unit"], min: 1, max: 1 },
    effect: "direct_change",
    risk: "medium",
    domainCapabilities: ["create_spread"],
    confirmation: "none",
  }),
  pageCapability({
    id: "page.rename",
    description: "设置或清除一个正文页、封面、过场页或真正双页的可选名称。使用一个 presentation_unit handle；空名称表示恢复派生默认名。",
    inputSchema: pageRenameSchema,
    target: { required: true, types: ["presentation_unit"], min: 1, max: 1 },
    effect: "direct_change",
    risk: "low",
    domainCapabilities: ["update_presentation_unit"],
    confirmation: "none",
  }),
  pageCapability({
    id: "page.duplicate",
    description: "复制一个明确页面及其内容并插入原页面之后。不能复制封面；真正双页会作为一个完整 PresentationUnit 复制。",
    inputSchema: singlePageTargetSchema,
    target: { required: true, types: ["presentation_unit"], min: 1, max: 1 },
    effect: "direct_change",
    risk: "medium",
    domainCapabilities: ["duplicate_presentation_unit"],
    confirmation: "none",
  }),
  pageCapability({
    id: "page.move",
    description: "把 targetHandles 中第一个页面移动到第二个页面之前或之后，以一次原子变更完成相对排序。封面不能移动，其他页面也不能排到封面之前。",
    inputSchema: pageMoveSchema,
    target: { required: true, types: ["presentation_unit"], min: 2, max: 2 },
    effect: "direct_change",
    risk: "low",
    domainCapabilities: ["move_presentation_unit_to"],
    confirmation: "none",
  }),
  pageCapability({
    id: "page.delete",
    description: "删除一个明确的正文页、封面、过场页或真正双页及其内容。一话至少保留一个 PresentationUnit；必须把同一个准确页面 handle 同时放入 targetHandles 与 confirmedTargetHandles。",
    inputSchema: pageDeleteSchema,
    target: { required: true, types: ["presentation_unit"], min: 1, max: 1 },
    effect: "direct_change",
    risk: "high",
    domainCapabilities: ["delete_presentation_unit"],
    confirmation: "explicit",
  }),
  pageCapability({
    id: "page.merge_spread",
    description: "把两个相邻、同角色的正文单页或过场单页合并为一个真正双页。targetHandles 可按任意顺序提供，领域层按当前阅读顺序确认相邻关系并生成左右 PageSurface；封面和普通并排查看不能参与。",
    inputSchema: pagePairSchema,
    target: { required: true, types: ["presentation_unit"], min: 2, max: 2 },
    effect: "direct_change",
    risk: "high",
    domainCapabilities: ["merge_pages_to_spread"],
    confirmation: "none",
  }),
  pageCapability({
    id: "page.split_spread",
    description: "把一个真正双页拆回两个普通页面。跨越中缝的画格或对象会阻止不安全拆分；普通阅读器并排显示不是此能力的目标。",
    inputSchema: singlePageTargetSchema,
    target: { required: true, types: ["presentation_unit"], min: 1, max: 1 },
    effect: "direct_change",
    risk: "high",
    domainCapabilities: ["split_spread_to_pages"],
    confirmation: "none",
  }),
] as const satisfies readonly SemanticCapabilityManifest[];

export function isPageCapabilityId(id: string) {
  return pageCapabilities.some((capability) => capability.id === id);
}

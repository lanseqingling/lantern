export type AgentTaskType = "storyboard" | "frame_image_generate" | "asset_parse";
export type AgentCapabilityId = "context.inspect_images" | "storyboard.edit_single_entry" | "frame_image.generate_or_replace" | "asset.generate_character_or_scene";

export type AgentCapabilityDescriptor = {
  id: AgentCapabilityId;
  execution: "observation" | "task";
  taskType?: AgentTaskType;
  description: string;
  target: {
    required: boolean;
    selectionTypes: string[];
    min: number;
    max: number;
  };
  scope?: "selected_comic_frame" | "reference_only";
  result: "observation" | "candidate";
  confirmation: "none";
  userMessage: string;
  missingTargetMessage?: string;
};

const agentCapabilities: readonly AgentCapabilityDescriptor[] = [
  {
    id: "context.inspect_images",
    execution: "observation",
    description: "读取本轮上传图片，或用户唯一指明的当前页对象所关联图片的可见内容与文字，返回只读 Observation。当回答或后续规划依赖图片内容且尚无 inspect_images Observation 时调用；不创建任务或候选。",
    target: { required: true, selectionTypes: ["image_attachment", "current_page_target"], min: 1, max: 3 },
    result: "observation",
    confirmation: "none",
    userMessage: "",
    missingTargetMessage: "请先添加图片，或明确说出当前页中包含图片的画格或分镜。",
  },
  {
    id: "storyboard.edit_single_entry",
    execution: "task",
    taskType: "storyboard",
    description: "创建或编辑唯一明确目标漫画格所绑定的一个分镜条目（StoryboardBeat），目标可来自当前选择、显式引用，或用户在当前页上下文中唯一指明的画格、对白、气泡或分镜名称。结果只包含该条目的文字标题与画面描述。当用户明确要求改变这一个分镜条目，且期望产物是文字分镜而不是图片、对白、画格结构或整页方案时调用。不能处理多个画格、整页、整话、页面编排或格内成稿图。",
    target: { required: true, selectionTypes: ["comic_frame"], min: 1, max: 1 },
    scope: "selected_comic_frame",
    result: "candidate",
    confirmation: "none",
    userMessage: "我会编辑目标画格的分镜条目，只更新它的标题和画面描述；应用前不会改变工作稿。",
    missingTargetMessage: "请选中一个漫画格，或明确说出当前页中的画格编号、对白、气泡或分镜名称。",
  },
  {
    id: "frame_image.generate_or_replace",
    execution: "task",
    taskType: "frame_image_generate",
    description: "为唯一明确目标漫画格生成格内图片，目标可来自当前选择、显式引用，或用户在当前页上下文中唯一指明的画格、对白、气泡或分镜名称；画格已有主图时形成替换候选，没有主图时形成放入候选。当用户明确要求重新生成、重画或替换该格的视觉画面，并且期望产物是图片而不是文字分镜时调用。不能改变分镜条目、对白、画格几何、页面编排或其他画格。",
    target: { required: true, selectionTypes: ["comic_frame"], min: 1, max: 1 },
    scope: "selected_comic_frame",
    result: "candidate",
    confirmation: "none",
    userMessage: "我会为目标画格生成新的格内图片；应用前不会替换当前画面。",
    missingTargetMessage: "请选中一个漫画格，或明确说出当前页中的画格编号、对白、气泡或分镜名称。",
  },
  {
    id: "asset.generate_character_or_scene",
    execution: "task",
    taskType: "asset_parse",
    description: "根据用户明确的生成要求创建一个角色或场景资产图片候选。讨论、设计或完善设定但未要求生成图片、卡片或资产时不调用。",
    target: { required: false, selectionTypes: [], min: 0, max: 0 },
    scope: "reference_only",
    result: "candidate",
    confirmation: "none",
    userMessage: "我会按当前描述生成一个可编辑的资产候选；确认后才保存到资产空间。",
  },
] as const;

export function listAgentCapabilities() {
  return agentCapabilities;
}

export function getAgentCapability(id: string) {
  return agentCapabilities.find((capability) => capability.id === id);
}

export function isAgentTaskType(taskType: string): taskType is AgentTaskType {
  return agentCapabilities.some((capability) => capability.execution === "task" && capability.taskType === taskType);
}

export function plannerCapabilityCatalog() {
  return agentCapabilities.map(({ taskType: _taskType, userMessage: _userMessage, missingTargetMessage: _missingTargetMessage, ...capability }) => capability);
}

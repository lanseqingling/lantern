import { getConfig } from "../../server/src/config";
import { DeepSeekProvider } from "./providers/deepseek";
import { interactionDecisionSchema, type InteractionDecision } from "./schemas";

export type InteractionInput = {
  message: string;
  intent?: string;
  scope?: string;
  selection: { type: string; id?: string; label?: string };
  contextSummary: unknown;
};

const wholeChapterPattern = /整话|全部|所有页|全篇|切换格式/;
const currentUnitPattern = /整页|当前页|重排|重新编排/;
const localRefinePattern = /只改|当前格|当前图|精修|表情|动作|背景|构图/;
const imagePattern = /生成.*图|画一格|出图|生图|图片|草稿成图|修图/;
const storyboardPattern = /生成分镜|创建分镜|新建分镜|分镜方案|拆(?:成)?分镜/;
const dialoguePattern = /对白|台词|气泡|语气|压缩文字/;
const assetPattern = /创建(?:一个|新)?角色|新建角色|新角色|角色设定|创建(?:一个|新)?场景|新建场景|场景设定|解析.*参考/;
const advicePattern = /建议|为什么|解释|状态|检查|怎么看/;
const greetingPattern = /^(你好|您好|嗨|哈[喽啰]|hello|hi|在吗|早上好|下午好|晚上好)[！!。,.，\s？?]*$/i;
const thanksPattern = /^(谢谢|感谢|明白了|知道了|好的|好)[！!。,.，\s]*$/;
const capabilityPattern = /^(你能做什么|怎么用|可以帮我什么|你是谁)[？?。\s]*$/;

export function enforceSafetyDecision(input: InteractionInput, decision: InteractionDecision): InteractionDecision {
  const assetIntent = input.intent === "资产" || assetPattern.test(input.message);
  if ((assetPattern.test(input.message) && decision.kind !== "needs_confirmation") || (assetIntent && (decision.kind === "needs_input" || decision.kind === "ready_to_run"))) {
    return {
      kind: "ready_to_run",
      message: "我会先按当前描述生成可编辑的资产候选；细节可以在资产画布中继续完善。",
      scope: "reference_only",
      taskType: "asset_parse",
    };
  }
  if (wholeChapterPattern.test(input.message)) {
    return {
      kind: "needs_confirmation",
      message: "这会影响整话已经确认的内容；旧保存快照不会被覆盖。",
      summary: input.message,
      scope: "whole_chapter",
      taskType: input.message.includes("图") ? "frame_image_generate" : "page_layout",
    };
  }
  if (storyboardPattern.test(input.message) && !currentUnitPattern.test(input.message)) {
    return {
      kind: "ready_to_run",
      message: "我会先生成分镜候选；应用前不会改变当前工作稿。",
      scope: input.scope === "after_current" ? "after_current" : "current_page",
      taskType: "storyboard",
    };
  }
  if (currentUnitPattern.test(input.message)) {
    return {
      kind: "needs_confirmation",
      message: "这会调整当前呈现单元，但不会静默覆盖保存快照。",
      summary: input.message,
      scope: "current_page",
      taskType: "page_layout",
    };
  }
  if (localRefinePattern.test(input.message) && input.selection.type === "none") {
    return {
      kind: "needs_input",
      message: "我需要知道要修改哪一格，才能确保不影响其他内容。",
      questions: [{ id: "target", field: "selection", prompt: "请先选择画布上的漫画格或格内图片。", required: true }],
    };
  }
  return decision;
}

function deterministicDecision(input: InteractionInput): InteractionDecision {
  if (greetingPattern.test(input.message)) return { kind: "direct_answer", message: "你好，我在。你可以直接讲故事、创建角色或场景，也可以选中画布上的分镜再告诉我想改什么；我只会在需要生成作品候选时启动任务。" };
  if (thanksPattern.test(input.message)) return { kind: "direct_answer", message: "不客气。当前没有作品变更；你准备好后继续描述创作意图即可。" };
  if (capabilityPattern.test(input.message)) return { kind: "direct_answer", message: "我可以帮你整理故事、创建角色与场景、生成或调整分镜、编排页面、生成单格图片和修改对白。所有作品改动都会先成为候选，由你预览后决定是否应用。" };
  if (advicePattern.test(input.message)) return { kind: "direct_answer", message: "我会围绕当前对象和工作稿给建议，不会修改作品。" };
  const scope = localRefinePattern.test(input.message)
    ? input.selection.type === "storyboard_beat" ? "selected_storyboard_beat" : "selected_comic_frame"
    : input.scope === "after_current" ? "after_current" : "current_page";
  const taskType = assetPattern.test(input.message)
    ? "asset_parse"
    : dialoguePattern.test(input.message)
      ? "dialogue"
      : imagePattern.test(input.message)
        ? localRefinePattern.test(input.message) ? "frame_image_refine" : "frame_image_generate"
        : "storyboard";
  return { kind: "ready_to_run", message: "我会先生成候选；应用前不会改变工作稿。", scope, taskType };
}

export async function decideInteraction(input: InteractionInput) {
  if (greetingPattern.test(input.message) || thanksPattern.test(input.message) || capabilityPattern.test(input.message)) {
    return enforceSafetyDecision(input, deterministicDecision(input));
  }
  const config = getConfig();
  if (config.TEXT_MODEL_PROVIDER === "test") return enforceSafetyDecision(input, deterministicDecision(input));

  const provider = new DeepSeekProvider();
  const decision = await provider.generateJson({
    schema: interactionDecisionSchema,
    maxTokens: 900,
    system: `你是 Lantern AI 的交互编排器。Lantern 是个人漫画创作工作台。判断用户是在询问、缺少必要输入、需要高风险确认，还是可以创建候选任务。
规则：先判断输入是不是寒暄、感谢、产品能力询问或创作建议，这些必须 direct_answer，绝不能恢复旧任务或创建任务。普通局部生成可直接执行；修改已确认内容、跨格、整页、整话和格式切换必须确认；不要假装已经修改作品；少追问；所有会改变作品的结果先成为候选。
只允许以下四种 JSON 形状之一：
{"kind":"direct_answer","message":"回答"}
{"kind":"needs_input","message":"说明","questions":[{"id":"format","field":"format","prompt":"问题","required":true,"options":[{"id":"page","label":"页漫","value":"page"}]}]}
{"kind":"needs_confirmation","message":"风险说明","summary":"影响摘要","scope":"current_page","taskType":"page_layout"}
{"kind":"ready_to_run","message":"执行说明","scope":"selected_comic_frame","taskType":"frame_image_generate"}
不要增加字段，不要把 taskType 写成 task。`,
    user: JSON.stringify({
      message: input.message,
      intent: input.intent,
      requestedScope: input.scope,
      selection: input.selection,
      context: input.contextSummary,
      outputContract: {
        kinds: ["direct_answer", "needs_input", "needs_confirmation", "ready_to_run"],
        scopes: ["reference_only", "selected_storyboard_beat", "selected_comic_frame", "selected_element", "current_page", "after_current", "whole_chapter"],
        taskTypes: ["storyboard", "page_layout", "frame_image_generate", "frame_image_refine", "asset_parse", "dialogue", "export"],
      },
    }),
  });
  return enforceSafetyDecision(input, decision);
}

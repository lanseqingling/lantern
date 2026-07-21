import { getAgentCapability, type AgentCapabilityId } from "./capability-registry";
import { buildPlannerSystemPrompt } from "./prompts/planner";
import { DeepSeekProvider } from "./providers/deepseek";
import { currentPageTargetSchema, interactionPlanSchema, type CurrentPageTarget, type InteractionDecision, type InteractionPlan } from "./schemas";

export type InteractionInput = {
  message: string;
  intent?: string;
  scope?: string;
  selection: { type: string; id?: string; pageId?: string; label?: string };
  contextSummary: unknown;
  imageAttachments?: Array<{ handle: string; label: string }>;
  observations?: Array<{ tool: string; output: unknown }>;
  currentPageTargets?: CurrentPageTarget[];
};

export type InteractionPlanningTrace = {
  prompt: ReturnType<typeof buildPlannerSystemPrompt>["manifest"];
  plan: InteractionPlan;
};

export type PlannedInteraction = {
  route: InteractionRoute;
  trace: InteractionPlanningTrace;
};

export type InteractionRoute =
  | { kind: "decision"; decision: InteractionDecision; targetSelection?: InteractionInput["selection"] }
  | { kind: "tool_call"; capabilityId: AgentCapabilityId; targetHandles: string[] };

function contextRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function planningReferences(contextSummary: unknown) {
  const references = contextRecord(contextSummary).explicitReferences;
  if (!Array.isArray(references)) return [];
  return references.flatMap((value, index) => {
    const reference = contextRecord(value);
    if (typeof reference.objectType !== "string" || typeof reference.objectId !== "string") return [];
    return [{
      handle: `ref:${index}`,
      type: reference.objectType,
      label: typeof reference.label === "string" ? reference.label : reference.objectType,
      versioned: typeof reference.versionId === "string",
    }];
  });
}

function planningCurrentPageTargets(contextSummary: unknown) {
  const values = contextRecord(contextSummary).currentPageTargets;
  if (!Array.isArray(values)) return [];
  return values.flatMap((value) => {
    const parsed = currentPageTargetSchema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  });
}

function missingTargetDecision(message: string): InteractionDecision {
  return {
    kind: "needs_input",
    message,
    questions: [{ id: "target", field: "selection", prompt: message, required: true }],
  };
}

export function guardInteractionPlan(input: InteractionInput, plan: InteractionPlan): InteractionRoute {
  if (plan.outcome === "respond" || plan.outcome === "unsupported") {
    return { kind: "decision", decision: { kind: "direct_answer", message: plan.message } };
  }
  if (plan.outcome === "ask_user") {
    return {
      kind: "decision",
      decision: {
        kind: "needs_input",
        message: plan.message,
        questions: plan.missingInputs.map((missing, index) => ({
          id: `missing-${index + 1}`,
          field: missing.field,
          prompt: missing.description,
          required: true,
        })),
      },
    };
  }

  const capability = getAgentCapability(plan.capabilityId);
  if (!capability) {
    return { kind: "decision", decision: { kind: "direct_answer", message: "这项操作目前还不能直接完成。你可以继续描述期望的创作结果，我会协助整理可行方案。" } };
  }
  if (capability.execution === "observation") {
    const attachmentHandles = (input.imageAttachments ?? []).map((attachment) => attachment.handle);
    const availableHandles = new Set([
      ...attachmentHandles,
      ...(input.currentPageTargets ?? []).filter((target) => target.assetVersionIds.length > 0).map((target) => target.handle),
    ]);
    const requestedHandles = plan.targetHandles.length ? plan.targetHandles : attachmentHandles;
    const targetHandles = [...new Set(requestedHandles.filter((handle) => availableHandles.has(handle)))];
    if (!targetHandles.length) {
      return { kind: "decision", decision: missingTargetDecision(capability.missingTargetMessage ?? "请先添加图片，或指明当前页中包含图片的对象。") };
    }
    return { kind: "tool_call", capabilityId: capability.id, targetHandles };
  }
  if (capability.target.required) {
    const currentSelection = input.selection.id && capability.target.selectionTypes.includes(input.selection.type)
      ? input.selection
      : undefined;
    const requestedCurrentPageTargets = (input.currentPageTargets ?? []).filter((target) => plan.targetHandles.includes(target.handle));
    const resolvedFrames = [...new Map(requestedCurrentPageTargets.flatMap((target) => target.frameId ? [[target.frameId, {
      type: "comic_frame",
      id: target.frameId,
      pageId: target.pageId,
      label: target.pageLabel ? `${target.pageLabel} · ${target.frameLabel ?? target.label}` : target.frameLabel ?? target.label,
    }] as const] : [])).values()];
    const explicitlyUsesSelection = plan.targetHandles.includes("selection");
    const targetSelection = requestedCurrentPageTargets.length
      ? resolvedFrames.length === 1 ? resolvedFrames[0] : undefined
      : explicitlyUsesSelection || !plan.targetHandles.length ? currentSelection : undefined;
    if (!targetSelection) {
      const message = requestedCurrentPageTargets.length && !resolvedFrames.length
        ? "你指的当前页对象没有绑定漫画格，请再指定要处理的画格。"
        : requestedCurrentPageTargets.length && resolvedFrames.length > 1
          ? "这段描述对应当前页的多个画格，请再说明具体是哪一格。"
          : capability.missingTargetMessage ?? "请先选择要处理的目标。";
      return { kind: "decision", decision: missingTargetDecision(message) };
    }
    if (!capability.taskType || !capability.scope) throw new Error(`AGENT_CAPABILITY_TASK_CONTRACT_INVALID:${capability.id}`);
    return {
      kind: "decision",
      decision: {
        kind: "ready_to_run",
        message: capability.userMessage,
        scope: capability.scope,
        taskType: capability.taskType,
      },
      targetSelection,
    };
  }
  if (!capability.taskType || !capability.scope) throw new Error(`AGENT_CAPABILITY_TASK_CONTRACT_INVALID:${capability.id}`);
  return {
    kind: "decision",
    decision: {
      kind: "ready_to_run",
      message: capability.userMessage,
      scope: capability.scope,
      taskType: capability.taskType,
    },
  };
}

export async function planInteraction(input: InteractionInput): Promise<PlannedInteraction> {
  const prompt = buildPlannerSystemPrompt();
  const currentPageTargets = input.currentPageTargets ?? planningCurrentPageTargets(input.contextSummary);
  const plannerContext = { ...contextRecord(input.contextSummary) };
  delete plannerContext.currentPageTargets;
  const plan = await new DeepSeekProvider().generateJson({
    schema: interactionPlanSchema,
    maxTokens: 1400,
    system: prompt.system,
    user: JSON.stringify({
      turn: { message: input.message },
      requestedScope: input.scope,
      focus: input.selection.type === "none" ? null : {
        handle: "selection",
        type: input.selection.type,
        label: input.selection.label,
      },
      workspaceView: contextRecord(input.contextSummary).currentView ?? null,
      currentPageTargetCatalog: currentPageTargets,
      explicitReferences: planningReferences(input.contextSummary),
      attachments: input.imageAttachments ?? [],
      observations: input.observations ?? [],
      context: plannerContext,
    }),
  });
  return {
    route: guardInteractionPlan({ ...input, currentPageTargets }, plan),
    trace: { prompt: prompt.manifest, plan },
  };
}

export async function decideInteraction(input: InteractionInput) {
  const planned = await planInteraction(input);
  if (planned.route.kind !== "decision") throw new Error(`INTERACTION_REQUIRES_TOOL:${planned.route.capabilityId}`);
  return planned.route.decision;
}

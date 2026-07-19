import { randomUUID } from "node:crypto";
import { MessageKind, MessageRole, type Prisma } from "@prisma/client";
import { prisma } from "../../server/src/db";
import { AppError } from "../../server/src/errors";
import { runAgentLoop, type AgentPlanner, type AgentTool } from "./agent-loop";
import { buildAgentContext } from "./context-builder";
import { planInteraction, type InteractionPlanningTrace } from "./orchestrator";
import type { InteractionDecision, WorkspaceReference } from "./schemas";
import { createGenerationTask, getActiveConversationTask, type CreateTaskInput } from "./task-service";
import { analyzeImageVersions } from "./visual-context";

export type AgentImageAttachment = {
  assetId: string;
  versionId: string;
  name: string;
};

export type AgentInteractionInput = {
  ownerUserId: string;
  conversationId: string;
  message: string;
  intent?: string;
  scope?: string;
  currentPageId?: string;
  visiblePageIds?: string[];
  selection: NonNullable<CreateTaskInput["selection"]>;
  explicitReferences?: CreateTaskInput["explicitReferences"];
  imageAttachments?: AgentImageAttachment[];
  idempotencyKey: string;
};

type PlanningContext = {
  input: AgentInteractionInput;
  projectId: string;
  contextSummary: unknown;
};

export type AgentInteractionResult = {
  decision: InteractionDecision;
  task?: Awaited<ReturnType<typeof createGenerationTask>>;
};

type AgentInteractionOptions = {
  existingUserMessageId?: string;
};

function messageKind(decision: InteractionDecision) {
  if (decision.kind === "needs_input") return MessageKind.QUESTION;
  if (decision.kind === "needs_confirmation") return MessageKind.CONFIRMATION;
  return MessageKind.PLAIN;
}

function decisionMetadata(decision: InteractionDecision, input: AgentInteractionInput, plannerTraces: InteractionPlanningTrace[]) {
  return {
    ...decision,
    instruction: input.message,
    currentPageId: input.currentPageId,
    visiblePageIds: input.visiblePageIds ?? [],
    selection: input.selection,
    explicitReferences: input.explicitReferences ?? [],
    plannerTraces,
    idempotencyKey: input.idempotencyKey,
  } as Prisma.InputJsonValue;
}

function effectiveReferences(input: AgentInteractionInput) {
  const references: WorkspaceReference[] = [
    ...(input.explicitReferences ?? []),
    ...(input.imageAttachments ?? []).map((attachment) => ({
      objectType: "asset" as const,
      objectId: attachment.assetId,
      versionId: attachment.versionId,
      label: attachment.name,
    })),
  ];
  return [...new Map(references.map((reference) => [
    `${reference.objectType}:${reference.objectId}:${reference.versionId ?? ""}`,
    reference,
  ])).values()];
}

export async function runAgentInteraction(input: AgentInteractionInput, options: AgentInteractionOptions = {}) {
  const conversation = await prisma.agentConversation.findFirst({
    where: { id: input.conversationId, ownerUserId: input.ownerUserId, archivedAt: null },
  });
  if (!conversation) throw new AppError("not_found", "当前对话不存在。", 404);
  const activeTask = await getActiveConversationTask(input.ownerUserId, conversation.id);
  if (activeTask) throw new AppError("task_in_progress", "当前会话已有任务运行中。可以继续编辑输入草稿，或先停止任务。", 409, { taskId: activeTask.id });

  const resolvedReferences = effectiveReferences(input);

  const planningSnapshot = await buildAgentContext({
    ownerUserId: input.ownerUserId,
    projectId: conversation.projectId,
    conversationId: conversation.id,
    taskType: "interaction",
    instruction: input.message,
    scope: input.scope ?? "current_page",
    currentPageId: input.currentPageId,
    visiblePageIds: input.visiblePageIds,
    selection: input.selection,
    explicitReferences: resolvedReferences,
  });
  const normalizedInput: AgentInteractionInput = { ...input, selection: planningSnapshot.selection };
  const existingUserMessage = options.existingUserMessageId
    ? await prisma.message.findFirst({
      where: {
        id: options.existingUserMessageId,
        ownerUserId: input.ownerUserId,
        conversationId: conversation.id,
        role: MessageRole.USER,
      },
    })
    : undefined;
  if (options.existingUserMessageId && !existingUserMessage) throw new AppError("not_found", "原始用户消息不存在，无法重试。", 404);
  const userMessage = existingUserMessage ?? await prisma.message.create({
      data: {
        ownerUserId: input.ownerUserId,
        projectId: conversation.projectId,
        conversationId: conversation.id,
        role: MessageRole.USER,
        kind: MessageKind.PLAIN,
        content: input.message,
        metadata: { intent: normalizedInput.intent, scope: normalizedInput.scope, currentPageId: normalizedInput.currentPageId, visiblePageIds: normalizedInput.visiblePageIds ?? [], selection: normalizedInput.selection, explicitReferences: normalizedInput.explicitReferences ?? [], imageAttachments: normalizedInput.imageAttachments ?? [] },
        references: resolvedReferences.length ? {
          create: resolvedReferences.map((reference) => ({
            objectType: reference.objectType,
            objectId: reference.objectId,
            versionId: reference.versionId,
          })),
        } : undefined,
      },
    });
  const context: PlanningContext = {
    input: normalizedInput,
    projectId: conversation.projectId,
    contextSummary: {
      creativeBaseline: {
        comic: {
          id: planningSnapshot.comic.id,
          title: planningSnapshot.comic.title,
          format: planningSnapshot.comic.format,
          readingDirection: planningSnapshot.comic.readingDirection,
        },
        storyCore: planningSnapshot.comic.summary,
        world: {
          summary: planningSnapshot.comic.worldSummary,
          settings: planningSnapshot.comic.settings,
        },
        visualStyle: {
          summary: planningSnapshot.comic.styleSummary,
          references: planningSnapshot.assets.filter((asset) => asset.kind === "style"),
        },
      },
      chapter: planningSnapshot.chapter,
      currentView: planningSnapshot.currentView,
      currentPage: planningSnapshot.currentPage,
      currentPageTargets: planningSnapshot.currentPageTargets,
      currentViewLcd: planningSnapshot.visiblePageLcd,
      storyboardBeats: planningSnapshot.storyboardBeats,
      explicitComicFrameReferences: planningSnapshot.explicitComicFrameReferences,
      explicitDialogueReferences: planningSnapshot.explicitDialogueReferences,
      relevantAssets: planningSnapshot.assets,
      recentConversation: planningSnapshot.recentConversation,
      explicitReferences: planningSnapshot.explicitReferences,
      omittedContext: planningSnapshot.omittedContext,
    },
  };

  const plannerTraces: InteractionPlanningTrace[] = [];
  const planner: AgentPlanner<PlanningContext> = {
    async next({ context: planningContext, toolResults }) {
      const planned = await planInteraction({
        message: planningContext.input.message,
        intent: planningContext.input.intent,
        scope: planningContext.input.scope,
        selection: planningContext.input.selection,
        imageAttachments: (planningContext.input.imageAttachments ?? []).map((attachment, index) => ({ handle: `attachment:${index}`, label: attachment.name })),
        observations: toolResults.map((result) => ({ tool: result.toolName, output: result.output })),
        contextSummary: planningContext.contextSummary,
      });
      plannerTraces.push(planned.trace);
      if (planned.route.kind === "tool_call") {
        return {
          kind: "tool_call",
          call: { id: randomUUID(), name: planned.route.capabilityId, input: { targetHandles: planned.route.targetHandles } },
        };
      }
      const decision = planned.route.decision;
      return {
        kind: "tool_call",
        call: {
          id: randomUUID(),
          name: decision.kind === "ready_to_run" ? "start_generation_task" : "present_interaction",
          input: decision.kind === "ready_to_run"
            ? { decision, targetSelection: planned.route.targetSelection ?? planningContext.input.selection }
            : decision,
        },
      };
    },
  };

  const presentInteraction: AgentTool = {
    name: "present_interaction",
    async execute(rawDecision) {
      const decision = rawDecision as InteractionDecision;
      await prisma.message.create({
        data: {
          ownerUserId: input.ownerUserId,
          projectId: conversation.projectId,
          conversationId: conversation.id,
          role: MessageRole.AGENT,
          kind: messageKind(decision),
          content: decision.message,
          metadata: decisionMetadata(decision, normalizedInput, plannerTraces),
        },
      });
      return { output: { decision } };
    },
  };
  const inspectImages: AgentTool = {
    name: "context.inspect_images",
    async execute(rawInput) {
      const toolInput = rawInput && typeof rawInput === "object" && !Array.isArray(rawInput)
        ? rawInput as Record<string, unknown>
        : {};
      const requestedHandles = new Set(Array.isArray(toolInput.targetHandles)
        ? toolInput.targetHandles.filter((handle): handle is string => typeof handle === "string")
        : []);
      const selectedAttachments = (input.imageAttachments ?? []).filter((_, index) =>
        !requestedHandles.size || requestedHandles.has(`attachment:${index}`));
      const selectedCurrentPageTargets = planningSnapshot.currentPageTargets.filter((target) =>
        requestedHandles.has(target.handle));
      const observation = await analyzeImageVersions({
        ownerUserId: input.ownerUserId,
        projectId: conversation.projectId,
        message: input.message,
        versionIds: [
          ...selectedAttachments.map((attachment) => attachment.versionId),
          ...selectedCurrentPageTargets.flatMap((target) => target.assetVersionIds),
        ],
      });
      if (!observation) throw new AppError("invalid_image_context", "没有找到可读取的图片附件。", 422);
      return { output: { type: "visual_evidence", content: observation }, continueLoop: true };
    },
  };
  const startGenerationTask: AgentTool = {
    name: "start_generation_task",
    async execute(rawInput) {
      const { decision, targetSelection } = rawInput as {
        decision: Extract<InteractionDecision, { kind: "ready_to_run" }>;
        targetSelection: AgentInteractionInput["selection"];
      };
      const task = await createGenerationTask({
        ownerUserId: input.ownerUserId,
        projectId: conversation.projectId,
        conversationId: conversation.id,
        taskType: decision.taskType,
        instruction: input.message,
        scope: decision.scope,
        selection: targetSelection,
        explicitReferences: resolvedReferences,
        plannerTrace: plannerTraces,
        idempotencyKey: input.idempotencyKey,
      });
      return { output: { decision, task } };
    },
  };

  try {
    return await runAgentLoop({
      turnId: userMessage.id,
      context,
      planner,
      tools: [inspectImages, presentInteraction, startGenerationTask],
      maxSteps: 4,
      checkpointStore: {
        async save(checkpoint) {
          const serializableCheckpoint = JSON.parse(JSON.stringify(checkpoint)) as Prisma.InputJsonValue;
          await prisma.message.update({ where: { id: userMessage.id }, data: { metadata: { intent: normalizedInput.intent, scope: normalizedInput.scope, currentPageId: normalizedInput.currentPageId, visiblePageIds: normalizedInput.visiblePageIds ?? [], selection: normalizedInput.selection, explicitReferences: normalizedInput.explicitReferences ?? [], imageAttachments: normalizedInput.imageAttachments ?? [], plannerTraces, agentCheckpoint: serializableCheckpoint } as Prisma.InputJsonValue } });
        },
      },
    }) as AgentInteractionResult;
  } catch (error) {
    await prisma.message.create({
      data: {
        ownerUserId: input.ownerUserId,
        projectId: conversation.projectId,
        conversationId: conversation.id,
        role: MessageRole.AGENT,
        kind: MessageKind.FAILED,
        content: error instanceof AppError ? error.message : "Agent 暂时无法完成这次请求，工作稿没有改变。",
        metadata: { turnId: userMessage.id, retryable: true },
      },
    });
    throw error;
  }
}

export async function retryAgentInteraction(ownerUserId: string, failedMessageId: string, idempotencyKey: string) {
  const failedMessage = await prisma.message.findFirst({
    where: { id: failedMessageId, ownerUserId, role: MessageRole.AGENT, kind: MessageKind.FAILED },
  });
  if (!failedMessage) throw new AppError("not_found", "失败记录不存在。", 404);
  const failedMetadata = failedMessage.metadata as Record<string, unknown>;
  const turnId = typeof failedMetadata.turnId === "string" ? failedMetadata.turnId : undefined;
  if (!turnId || !failedMessage.conversationId) throw new AppError("conflict", "这条失败记录缺少原始请求，无法直接重试。", 409);
  const userMessage = await prisma.message.findFirst({
    where: { id: turnId, ownerUserId, conversationId: failedMessage.conversationId, role: MessageRole.USER },
  });
  if (!userMessage) throw new AppError("not_found", "原始用户消息不存在，无法重试。", 404);
  const userMetadata = userMessage.metadata as Record<string, unknown>;
  const selection = userMetadata.selection;
  if (!selection || typeof selection !== "object" || typeof (selection as { type?: unknown }).type !== "string") {
    throw new AppError("conflict", "原始请求缺少目标信息，无法直接重试。", 409);
  }
  const explicitReferences = Array.isArray(userMetadata.explicitReferences)
    ? userMetadata.explicitReferences as CreateTaskInput["explicitReferences"]
    : undefined;
  const imageAttachments = Array.isArray(userMetadata.imageAttachments)
    ? userMetadata.imageAttachments as AgentImageAttachment[]
    : undefined;
  const result = await runAgentInteraction({
    ownerUserId,
    conversationId: failedMessage.conversationId,
    message: userMessage.content,
    intent: typeof userMetadata.intent === "string" ? userMetadata.intent : undefined,
    scope: typeof userMetadata.scope === "string" ? userMetadata.scope : undefined,
    currentPageId: typeof userMetadata.currentPageId === "string" ? userMetadata.currentPageId : undefined,
    visiblePageIds: Array.isArray(userMetadata.visiblePageIds)
      ? userMetadata.visiblePageIds.filter((pageId): pageId is string => typeof pageId === "string")
      : undefined,
    selection: selection as AgentInteractionInput["selection"],
    explicitReferences,
    imageAttachments,
    idempotencyKey,
  }, { existingUserMessageId: userMessage.id });
  await prisma.message.update({
    where: { id: failedMessage.id },
    data: { metadata: { ...failedMetadata, resolved: true } as Prisma.InputJsonValue },
  });
  return result;
}

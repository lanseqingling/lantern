import { createHash } from "node:crypto";
import { MessageKind, MessageRole, TaskStatus, TaskType, type Prisma } from "@prisma/client";
import { prisma } from "@lantern/server/db";
import { AppError } from "@lantern/server/errors";
import { getConfig } from "@lantern/server/config";
import { buildAgentContext } from "./context-builder";
import type { WorkspaceReference } from "./schemas";
import {
  assertAgentCapabilityAccess,
  getAgentCapability,
  getTaskAgentCapability,
  isAgentTaskType,
  listAgentCapabilities,
  semanticCapabilityCatalogManifest,
  type AgentCapabilityActor,
  type AgentCapabilityId,
  type AgentTaskType,
} from "./capability-registry";
import { localTaskRunner } from "./local-task-runner";

const activeTaskStatuses = [TaskStatus.CREATED, TaskStatus.QUEUED, TaskStatus.RUNNING];

function persistedTaskType(taskType: AgentTaskType) {
  const value = taskType.toUpperCase() as TaskType;
  if (!Object.values(TaskType).includes(value)) throw new Error(`AGENT_TASK_TYPE_NOT_PERSISTABLE:${taskType}`);
  return value;
}

const registeredTaskTypes = listAgentCapabilities().flatMap((capability) =>
  capability.execution === "asynchronous" && capability.taskType ? [persistedTaskType(capability.taskType)] : []);

export async function getActiveConversationTask(ownerUserId: string, conversationId: string) {
  return prisma.generationTask.findFirst({
    where: { ownerUserId, conversationId, type: { in: registeredTaskTypes }, status: { in: activeTaskStatuses } },
    orderBy: { createdAt: "desc" },
  });
}

export async function getGenerationTask(ownerUserId: string, taskId: string) {
  const task = await prisma.generationTask.findFirst({ where: { id: taskId, ownerUserId }, include: { attempts: { orderBy: { attempt: "asc" } }, candidates: true } });
  if (!task) throw new AppError("not_found", "任务不存在。", 404);
  return task;
}

export type CapabilityInvocationClient = {
  name: string;
  version?: string;
};

export type CreateTaskInput = {
  ownerUserId: string;
  projectId: string;
  conversationId?: string;
  capabilityId: AgentCapabilityId;
  actor: AgentCapabilityActor;
  client: CapabilityInvocationClient;
  arguments: unknown;
  selection?: { type: string; id?: string; pageId?: string; label?: string; canvasX?: number; canvasY?: number };
  explicitReferences?: WorkspaceReference[];
  plannerTrace?: unknown;
  idempotencyKey: string;
};

export type TaskQueueAdapter = {
  enqueue(taskId: string): Promise<void>;
};

export function assertTaskCreationAllowed(taskType: string): asserts taskType is AgentTaskType {
  if (isAgentTaskType(taskType)) return;
  throw new AppError("unsupported_task", "该任务类型未在 Agent 工具注册表中开放。", 422);
}

const localTaskQueue: TaskQueueAdapter = {
  async enqueue(taskId) {
    localTaskRunner.enqueue(taskId);
  },
};

function invocationInput(value: Prisma.JsonValue) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function storedCapabilityId(value: Prisma.JsonValue) {
  const capability = invocationInput(invocationInput(value).capability as Prisma.JsonValue);
  return typeof capability.id === "string" ? capability.id : undefined;
}

function stableJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, stableJson(item)]));
}

function invocationRequestHash(input: CreateTaskInput, parsedArguments: unknown) {
  return createHash("sha256").update(JSON.stringify(stableJson({
    actor: input.actor,
    arguments: parsedArguments,
    capabilityId: input.capabilityId,
    client: input.client,
    conversationId: input.conversationId,
    explicitReferences: input.explicitReferences ?? [],
    projectId: input.projectId,
    selection: input.selection,
  }))).digest("hex");
}

export async function invokeTaskCapability(input: CreateTaskInput, taskQueue: TaskQueueAdapter = localTaskQueue) {
  const capability = getAgentCapability(input.capabilityId);
  if (!capability || capability.execution !== "asynchronous" || !capability.taskType || !capability.scope) {
    throw new AppError("unsupported_capability", "该能力当前不能创建任务。", 422);
  }
  try {
    assertAgentCapabilityAccess(capability, input.actor);
  } catch {
    throw new AppError("capability_disabled", "该能力未向当前 Agent 入口开放。", 403);
  }
  if (!input.client.name.trim()) throw new AppError("validation", "调用客户端名称不能为空。", 400);
  const parsed = capability.inputSchema.safeParse(input.arguments);
  if (!parsed.success) {
    throw new AppError("validation", "能力参数不符合当前契约。", 400, { issues: parsed.error.issues });
  }
  const parsedArguments = parsed.data as { instruction?: string };
  const instruction = parsedArguments.instruction;
  if (!instruction) throw new AppError("validation", "生成能力缺少创作要求。", 400);
  const requestHash = invocationRequestHash(input, parsedArguments);

  const existing = await prisma.generationTask.findFirst({
    where: { ownerUserId: input.ownerUserId, idempotencyKey: input.idempotencyKey },
  });
  if (existing) {
    const existingCapabilityId = storedCapabilityId(existing.input);
    const existingInvocation = invocationInput(invocationInput(existing.input).invocation as Prisma.JsonValue);
    const existingRequestHash = typeof existingInvocation.requestHash === "string" ? existingInvocation.requestHash : undefined;
    if (existing.projectId !== input.projectId
      || existing.conversationId !== (input.conversationId ?? null)
      || existing.type !== persistedTaskType(capability.taskType)
      || (existingCapabilityId && existingCapabilityId !== capability.id)
      || (existingRequestHash && existingRequestHash !== requestHash)) {
      throw new AppError("idempotency_conflict", "这个幂等键已经用于其他调用。", 409);
    }
    return existing;
  }

  if (input.conversationId) {
    const conversation = await prisma.agentConversation.findFirst({
      where: { id: input.conversationId, ownerUserId: input.ownerUserId, projectId: input.projectId, archivedAt: null },
      select: { id: true },
    });
    if (!conversation) throw new AppError("not_found", "当前对话不存在或不属于目标创作空间。", 404);
    const active = await getActiveConversationTask(input.ownerUserId, input.conversationId);
    if (active) throw new AppError("task_in_progress", "当前会话已有任务运行中。请等待完成或先取消任务。", 409, { taskId: active.id });
  }

  const context = await buildAgentContext({
    ownerUserId: input.ownerUserId,
    projectId: input.projectId,
    conversationId: input.conversationId,
    taskType: capability.taskType,
    instruction,
    scope: capability.scope,
    selection: input.selection,
    explicitReferences: input.explicitReferences,
  });
  if ((capability.taskType === "storyboard" || capability.taskType === "frame_image_generate") && !context.currentComicFrame) {
    const message = capability.taskType === "storyboard"
      ? "请先选择要创建或编辑分镜条目的漫画格。"
      : "请先选择要生成或替换格内图片的漫画格。";
    throw new AppError("invalid_target", message, 422);
  }

  const config = getConfig();
  const catalog = semanticCapabilityCatalogManifest();
  const task = await prisma.generationTask.create({
    data: {
      ownerUserId: input.ownerUserId,
      projectId: input.projectId,
      conversationId: input.conversationId,
      type: persistedTaskType(capability.taskType),
      status: TaskStatus.CREATED,
      idempotencyKey: input.idempotencyKey,
      baseRevision: context.workingRevision,
      scope: capability.scope,
      target: (input.selection ?? { type: "chapter" }) as Prisma.InputJsonValue,
      input: {
        instruction,
        arguments: parsedArguments,
        explicitReferences: input.explicitReferences ?? [],
        capability: {
          id: capability.id,
          version: capability.version,
          catalogRevision: catalog.revision,
          catalogHash: catalog.hash,
        },
        invocation: {
          actor: input.actor,
          client: input.client,
          requestHash,
        },
        ...(input.plannerTrace ? { plannerTrace: input.plannerTrace } : {}),
      },
      contextSnapshot: context as unknown as Prisma.InputJsonValue,
      provider: capability.taskType === "frame_image_generate" ? config.IMAGE_MODEL_PROVIDER : config.TEXT_MODEL_PROVIDER,
      model: capability.taskType === "frame_image_generate" ? config.IMAGE_MODEL_NAME : config.TEXT_MODEL_NAME,
    },
  });
  try {
    const queued = await prisma.generationTask.update({ where: { id: task.id }, data: { status: TaskStatus.QUEUED, progress: 5 } });
    if (input.conversationId) {
      await prisma.message.create({
        data: {
          ownerUserId: input.ownerUserId,
          projectId: input.projectId,
          conversationId: input.conversationId,
          role: MessageRole.AGENT,
          kind: MessageKind.TASK,
          content: "正在准备生成，当前工作稿不会被自动修改。",
          metadata: {
            taskId: task.id,
            capabilityId: capability.id,
            capabilityVersion: capability.version,
            taskType: capability.taskType,
            scope: capability.scope,
            targetLabel: input.selection?.label,
            instruction,
            ...(input.plannerTrace ? { plannerTrace: input.plannerTrace } : {}),
          },
        },
      });
    }
    await taskQueue.enqueue(task.id);
    return queued;
  } catch (error) {
    await prisma.generationTask.update({
      where: { id: task.id },
      data: { status: TaskStatus.FAILED, errorCode: "runtime_unavailable", errorMessage: "本地任务执行器不可用", completedAt: new Date() },
    });
    throw new AppError("runtime_unavailable", "本地任务执行器暂时不可用，工作稿未改变。", 503, error);
  }
}

export async function requestTaskCancellation(ownerUserId: string, taskId: string) {
  const task = await prisma.generationTask.findFirst({ where: { id: taskId, ownerUserId } });
  if (!task) throw new AppError("not_found", "任务不存在。", 404);
  if (task.status === TaskStatus.SUCCEEDED) throw new AppError("conflict", "结果已完成并保存为候选，不能再取消。", 409);
  if (task.status === TaskStatus.FAILED || task.status === TaskStatus.CANCELED) return task;
  return prisma.$transaction(async (tx) => {
    const canceled = await tx.generationTask.update({
      where: { id: task.id },
      data: { status: TaskStatus.CANCELED, cancelRequestedAt: new Date(), completedAt: new Date() },
    });
    if (task.conversationId) {
      const taskMessages = await tx.message.findMany({
        where: { conversationId: task.conversationId, kind: MessageKind.TASK },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
      const taskMessage = taskMessages.find((message) => (message.metadata as { taskId?: string }).taskId === task.id);
      if (taskMessage) {
        await tx.message.update({
          where: { id: taskMessage.id },
          data: { kind: MessageKind.CANCELED, content: "任务已停止，没有产生可应用结果。", metadata: { taskId: task.id, taskType: task.type.toLowerCase(), resolved: true } },
        });
      }
    }
    return canceled;
  });
}

export async function retryTask(ownerUserId: string, taskId: string, idempotencyKey: string, taskQueue: TaskQueueAdapter = localTaskQueue) {
  const task = await prisma.generationTask.findFirst({ where: { id: taskId, ownerUserId } });
  if (!task) throw new AppError("not_found", "任务不存在。", 404);
  if (task.status !== TaskStatus.FAILED && task.status !== TaskStatus.CANCELED) throw new AppError("conflict", "只有失败或已取消任务可以重试。", 409);
  const stored = invocationInput(task.input);
  const storedCapability = invocationInput(stored.capability as Prisma.JsonValue);
  const storedInvocation = invocationInput(stored.invocation as Prisma.JsonValue);
  const storedClient = invocationInput(storedInvocation.client as Prisma.JsonValue);
  const capability = getAgentCapability(typeof storedCapability.id === "string" ? storedCapability.id : "")
    ?? getTaskAgentCapability(task.type.toLowerCase());
  if (!capability || capability.execution !== "asynchronous") throw new AppError("unsupported_task", "原任务能力已经不可用，不能重试。", 422);
  if (typeof storedCapability.version === "number" && storedCapability.version !== capability.version) {
    throw new AppError("capability_version_conflict", "原任务使用的能力版本已经更新，请重新发起任务。", 409);
  }
  return invokeTaskCapability({
    ownerUserId,
    projectId: task.projectId,
    conversationId: task.conversationId ?? undefined,
    capabilityId: capability.id,
    actor: storedInvocation.actor === "external" ? "external" : "internal",
    client: {
      name: typeof storedClient.name === "string" ? storedClient.name : "lantern-legacy",
      ...(typeof storedClient.version === "string" ? { version: storedClient.version } : {}),
    },
    arguments: stored.arguments ?? { instruction: typeof stored.instruction === "string" ? stored.instruction : "重试任务" },
    selection: task.target as CreateTaskInput["selection"],
    explicitReferences: Array.isArray(stored.explicitReferences) ? stored.explicitReferences as CreateTaskInput["explicitReferences"] : undefined,
    plannerTrace: stored.plannerTrace,
    idempotencyKey,
  }, taskQueue);
}

import { MessageKind, MessageRole, TaskStatus, TaskType, type Prisma } from "@prisma/client";
import { prisma } from "../../server/src/db";
import { AppError } from "../../server/src/errors";
import { getConfig } from "../../server/src/config";
import { buildAgentContext } from "./context-builder";
import type { WorkspaceReference } from "./schemas";
import { isAgentTaskType, type AgentTaskType } from "./capability-registry";
import { localTaskRunner } from "./local-task-runner";

const taskTypeMap = {
  storyboard: TaskType.STORYBOARD,
  frame_image_generate: TaskType.FRAME_IMAGE_GENERATE,
  asset_parse: TaskType.ASSET_PARSE,
} as const;

const activeTaskStatuses = [TaskStatus.CREATED, TaskStatus.QUEUED, TaskStatus.RUNNING];

export async function getActiveConversationTask(ownerUserId: string, conversationId: string) {
  return prisma.generationTask.findFirst({
    where: { ownerUserId, conversationId, type: { in: [TaskType.STORYBOARD, TaskType.FRAME_IMAGE_GENERATE, TaskType.ASSET_PARSE] }, status: { in: activeTaskStatuses } },
    orderBy: { createdAt: "desc" },
  });
}

export type CreateTaskInput = {
  ownerUserId: string;
  projectId: string;
  conversationId?: string;
  taskType: AgentTaskType;
  instruction: string;
  scope: string;
  selection?: { type: string; id?: string; pageId?: string; label?: string; canvasX?: number; canvasY?: number };
  explicitReferences?: WorkspaceReference[];
  plannerTrace?: unknown;
  idempotencyKey: string;
};

export type TaskQueueAdapter = {
  enqueue(taskId: string): Promise<void>;
};

export function assertTaskCreationAllowed(taskType: string): asserts taskType is CreateTaskInput["taskType"] {
  if (isAgentTaskType(taskType)) return;
  throw new AppError("unsupported_task", "该任务类型未在 Agent 工具注册表中开放。", 422);
}

const localTaskQueue: TaskQueueAdapter = {
  async enqueue(taskId) {
    localTaskRunner.enqueue(taskId);
  },
};

export async function createGenerationTask(input: CreateTaskInput, taskQueue: TaskQueueAdapter = localTaskQueue) {
  assertTaskCreationAllowed(input.taskType);

  const existing = await prisma.generationTask.findFirst({
    where: { ownerUserId: input.ownerUserId, idempotencyKey: input.idempotencyKey },
  });
  if (existing) return existing;

  if (input.conversationId) {
    const active = await getActiveConversationTask(input.ownerUserId, input.conversationId);
    if (active) throw new AppError("task_in_progress", "当前会话已有任务运行中。请等待完成或先取消任务。", 409, { taskId: active.id });
  }

  const context = await buildAgentContext({
    ownerUserId: input.ownerUserId,
    projectId: input.projectId,
    conversationId: input.conversationId,
    taskType: input.taskType,
    instruction: input.instruction,
    scope: input.scope,
    selection: input.selection,
    explicitReferences: input.explicitReferences,
  });
  if (input.taskType === "storyboard" && !context.currentComicFrame) {
    throw new AppError("invalid_target", "请先选择要创建或编辑分镜条目的漫画格。", 422);
  }
  if (input.taskType === "frame_image_generate" && !context.currentComicFrame) {
    throw new AppError("invalid_target", "请先选择要生成或替换格内图片的漫画格。", 422);
  }
  const config = getConfig();
  const task = await prisma.generationTask.create({
    data: {
      ownerUserId: input.ownerUserId,
      projectId: input.projectId,
      conversationId: input.conversationId,
      type: taskTypeMap[input.taskType],
      status: TaskStatus.CREATED,
      idempotencyKey: input.idempotencyKey,
      baseRevision: context.workingRevision,
      scope: input.scope,
      target: (input.selection ?? { type: "chapter" }) as Prisma.InputJsonValue,
      input: {
        instruction: input.instruction,
        explicitReferences: input.explicitReferences ?? [],
        ...(input.plannerTrace ? { plannerTrace: input.plannerTrace } : {}),
      },
      contextSnapshot: context as unknown as Prisma.InputJsonValue,
      provider: input.taskType === "frame_image_generate" ? config.IMAGE_MODEL_PROVIDER : config.TEXT_MODEL_PROVIDER,
      model: input.taskType === "frame_image_generate" ? config.IMAGE_MODEL_NAME : config.TEXT_MODEL_NAME,
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
            taskType: input.taskType,
            scope: input.scope,
            targetLabel: input.selection?.label,
            instruction: input.instruction,
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
  const taskInput = task.input as { instruction?: string; explicitReferences?: CreateTaskInput["explicitReferences"]; plannerTrace?: unknown };
  return createGenerationTask({
    ownerUserId,
    projectId: task.projectId,
    conversationId: task.conversationId ?? undefined,
    taskType: task.type.toLowerCase() as CreateTaskInput["taskType"],
    instruction: taskInput.instruction ?? "重试任务",
    scope: task.scope,
    selection: task.target as CreateTaskInput["selection"],
    explicitReferences: taskInput.explicitReferences,
    plannerTrace: taskInput.plannerTrace,
    idempotencyKey,
  }, taskQueue);
}

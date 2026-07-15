import { MessageKind, MessageRole, TaskStatus, TaskType, type Prisma } from "@prisma/client";
import { prisma } from "../../server/src/db";
import { AppError } from "../../server/src/errors";
import { getConfig } from "../../server/src/config";
import { getGenerationQueue } from "../../server/src/queue";
import { buildAgentContext } from "./context-builder";
import { validateComicDocument } from "../../shared/src";

const taskTypeMap = {
  storyboard: TaskType.STORYBOARD,
  page_layout: TaskType.PAGE_LAYOUT,
  frame_image_generate: TaskType.FRAME_IMAGE_GENERATE,
  frame_image_refine: TaskType.FRAME_IMAGE_REFINE,
  asset_parse: TaskType.ASSET_PARSE,
  dialogue: TaskType.DIALOGUE,
  export: TaskType.EXPORT,
} as const;

const activeTaskStatuses = [TaskStatus.CREATED, TaskStatus.QUEUED, TaskStatus.RUNNING];

export async function getActiveConversationTask(ownerUserId: string, conversationId: string) {
  return prisma.generationTask.findFirst({
    where: { ownerUserId, conversationId, status: { in: activeTaskStatuses } },
    orderBy: { createdAt: "desc" },
  });
}

export type CreateTaskInput = {
  ownerUserId: string;
  projectId: string;
  conversationId?: string;
  taskType: keyof typeof taskTypeMap;
  instruction: string;
  scope: string;
  selection?: { type: string; id?: string; pageId?: string; label?: string; canvasX?: number; canvasY?: number };
  explicitReferences?: Array<{ objectType: string; objectId: string; versionId?: string }>;
  idempotencyKey: string;
};

export type TaskQueueAdapter = {
  enqueue(taskId: string): Promise<void>;
};

export function assertTaskCreationAllowed(taskType: CreateTaskInput["taskType"]) {
  if (taskType === "export") return;
  throw new AppError("agent_execution_disabled", "旧 AI 任务创建已冻结；会话历史、候选和确定性导出不受影响。", 503);
}

const bullMqTaskQueue: TaskQueueAdapter = {
  async enqueue(taskId) {
    await getGenerationQueue().add("generation", { taskId }, {
      jobId: taskId,
      attempts: 1,
      removeOnComplete: 100,
      removeOnFail: 200,
    });
  },
};

export async function createGenerationTask(input: CreateTaskInput, taskQueue: TaskQueueAdapter = bullMqTaskQueue) {
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
  const config = getConfig();
  const isImage = input.taskType === "frame_image_generate" || input.taskType === "frame_image_refine";
  if (isImage) {
    const working = await prisma.workingRevision.findFirst({ where: { projectId: input.projectId, revision: context.workingRevision } });
    const document = working ? validateComicDocument(working.document) : undefined;
    const unit = document?.units.find((item) => item.id === input.selection?.pageId);
    const frame = unit?.frames.find((item) => item.id === input.selection?.id);
    const artElement = unit?.frames.flatMap((item) => item.layers.filter((layer) => layer.kind === "art").flatMap((layer) => layer.elements)).find((item) => item.id === input.selection?.id);
    if (!frame && !artElement) {
      throw new AppError("invalid_target", "请先选择当前工作稿中的漫画格或格内图片。", 422);
    }
  }
  const isExport = input.taskType === "export";
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
      },
      contextSnapshot: context as unknown as Prisma.InputJsonValue,
      provider: isExport ? "internal" : isImage ? config.IMAGE_MODEL_PROVIDER : config.TEXT_MODEL_PROVIDER,
      model: isExport ? "lantern-export-0.1" : isImage ? config.IMAGE_MODEL_NAME : config.TEXT_MODEL_NAME,
    },
  });
  try {
    await taskQueue.enqueue(task.id);
    const queued = await prisma.generationTask.update({ where: { id: task.id }, data: { status: TaskStatus.QUEUED, progress: 5 } });
    if (input.conversationId) {
      await prisma.message.create({
        data: {
          ownerUserId: input.ownerUserId,
          projectId: input.projectId,
          conversationId: input.conversationId,
          role: MessageRole.AGENT,
          kind: MessageKind.TASK,
          content: "任务已进入队列。旧内容会一直保留到你应用候选。",
          metadata: { taskId: task.id, taskType: input.taskType, scope: input.scope },
        },
      });
    }
    return queued;
  } catch (error) {
    await prisma.generationTask.update({
      where: { id: task.id },
      data: { status: TaskStatus.FAILED, errorCode: "queue_unavailable", errorMessage: "任务队列不可用", completedAt: new Date() },
    });
    throw new AppError("queue_unavailable", "任务队列暂时不可用，旧内容未改变。", 503, error);
  }
}

export async function requestTaskCancellation(ownerUserId: string, taskId: string) {
  const task = await prisma.generationTask.findFirst({ where: { id: taskId, ownerUserId } });
  if (!task) throw new AppError("not_found", "任务不存在。", 404);
  if (task.status === TaskStatus.SUCCEEDED) throw new AppError("conflict", "结果已完成并保存为候选，不能再取消。", 409);
  if (task.status === TaskStatus.FAILED || task.status === TaskStatus.CANCELED) return task;
  return prisma.generationTask.update({
    where: { id: task.id },
    data: { status: TaskStatus.CANCELED, cancelRequestedAt: new Date(), completedAt: new Date() },
  });
}

export async function retryTask(ownerUserId: string, taskId: string, idempotencyKey: string, taskQueue: TaskQueueAdapter = bullMqTaskQueue) {
  const task = await prisma.generationTask.findFirst({ where: { id: taskId, ownerUserId } });
  if (!task) throw new AppError("not_found", "任务不存在。", 404);
  if (task.status !== TaskStatus.FAILED && task.status !== TaskStatus.CANCELED) throw new AppError("conflict", "只有失败或已取消任务可以重试。", 409);
  const taskInput = task.input as { instruction?: string; explicitReferences?: CreateTaskInput["explicitReferences"] };
  return createGenerationTask({
    ownerUserId,
    projectId: task.projectId,
    conversationId: task.conversationId ?? undefined,
    taskType: task.type.toLowerCase() as CreateTaskInput["taskType"],
    instruction: taskInput.instruction ?? "重试任务",
    scope: task.scope,
    selection: task.target as CreateTaskInput["selection"],
    explicitReferences: taskInput.explicitReferences,
    idempotencyKey,
  }, taskQueue);
}

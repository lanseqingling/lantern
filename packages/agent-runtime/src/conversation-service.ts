import { prisma } from "@lantern/server/db";
import { AppError } from "@lantern/server/errors";
import { getOwnedProject } from "@lantern/server/workbench-service";
import { getActiveConversationTask } from "./task-service";

export async function createProjectConversation(ownerUserId: string, projectId: string, input: { title?: string }) {
  await getOwnedProject(ownerUserId, projectId);
  const title = input.title?.trim().slice(0, 80) || `新对话 ${new Date().toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}`;
  return prisma.agentConversation.create({ data: { ownerUserId, projectId, title } });
}

export async function updateConversation(ownerUserId: string, conversationId: string, input: { title?: string; archived?: boolean }) {
  const conversation = await prisma.agentConversation.findFirst({ where: { id: conversationId, ownerUserId, archivedAt: null } });
  if (!conversation) throw new AppError("not_found", "对话不存在。", 404);
  if (input.archived) {
    const activeTask = await getActiveConversationTask(ownerUserId, conversation.id);
    if (activeTask) throw new AppError("task_in_progress", "请先停止当前任务，再清理这个对话。", 409);
  }
  return prisma.agentConversation.update({
    where: { id: conversation.id },
    data: {
      ...(input.title !== undefined ? { title: input.title.trim().slice(0, 80) || "创作对话" } : {}),
      ...(input.archived ? { archivedAt: new Date() } : {}),
    },
  });
}

export async function resolveAgentMessage(ownerUserId: string, messageId: string) {
  const message = await prisma.message.findFirst({ where: { id: messageId, ownerUserId } });
  if (!message) throw new AppError("not_found", "交互卡片不存在。", 404);
  const metadata = message.metadata as Record<string, unknown>;
  await prisma.message.update({ where: { id: message.id }, data: { metadata: { ...metadata, resolved: true } } });
  return { id: message.id, resolved: true };
}

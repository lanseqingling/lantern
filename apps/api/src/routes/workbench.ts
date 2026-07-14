import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  comicDocumentSchema,
  normalizeStoryboardBeat,
  type WorkspaceChangeSet,
} from "../../../../packages/shared/src";
import { prisma } from "../../../../packages/server/src/db";
import { AppError } from "../../../../packages/server/src/errors";
import {
  commitChangeSet,
  getLatestWorking,
  getOwnedProject,
  getWorkbench,
} from "../../../../packages/server/src/workbench-service";
import { buildAgentContextDebugSnapshot } from "../../../../packages/agent-runtime/src/context-builder";
import { getActiveConversationTask } from "../../../../packages/agent-runtime/src/task-service";
import { currentUser, ok } from "../http";

const selectionSchema = z.object({
  type: z.string().min(1),
  id: z.string().min(1).optional(),
  pageId: z.string().min(1).optional(),
  label: z.string().optional(),
  canvasX: z.number().finite().optional(),
  canvasY: z.number().finite().optional(),
});

const storyboardBeatSchema = z.preprocess(normalizeStoryboardBeat, z.object({
  id: z.string().min(1),
  versionId: z.string().min(1),
  title: z.string().min(1).max(80),
  description: z.string().max(4000),
}));

const workspaceOperationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("replace_chapter_presentation"), document: comicDocumentSchema }),
  z.object({ type: z.literal("replace_chapter_layout"), document: comicDocumentSchema }),
  z.object({ type: z.literal("replace_storyboard_beats"), storyboardBeats: z.array(storyboardBeatSchema).max(120) }),
  z.object({ type: z.literal("create_frame_storyboard_beat"), unitId: z.string().min(1), frameId: z.string().min(1), storyboardBeat: storyboardBeatSchema }),
  z.object({ type: z.literal("add_presentation_unit"), unit: z.unknown(), readingIndex: z.number().int().nonnegative().optional() }),
  z.object({ type: z.literal("move_frame"), unitId: z.string().min(1), frameId: z.string().min(1), position: z.object({ x: z.number(), y: z.number() }) }),
  z.object({ type: z.literal("resize_frame"), unitId: z.string().min(1), frameId: z.string().min(1), geometry: z.object({ x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive(), rotate: z.number().optional() }) }),
  z.object({ type: z.literal("reorder_frame"), unitId: z.string().min(1), frameId: z.string().min(1), zIndex: z.number().int() }),
  z.object({ type: z.literal("set_frame_style"), unitId: z.string().min(1), frameId: z.string().min(1), border: z.unknown().optional(), shape: z.unknown().optional(), mask: z.unknown().optional() }),
  z.object({ type: z.literal("replace_presentation_layout"), unitId: z.string().min(1), expectedFrameIds: z.array(z.string()), layout: z.unknown() }),
  z.object({ type: z.literal("add_frame"), unitId: z.string().min(1), frame: z.unknown(), readingIndex: z.number().int().nonnegative().optional() }),
  z.object({ type: z.literal("remove_frame"), unitId: z.string().min(1), frameId: z.string().min(1) }),
  z.object({ type: z.literal("set_art_crop"), unitId: z.string().min(1), frameId: z.string().min(1), layerId: z.string().min(1), elementId: z.string().min(1), crop: z.object({ x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive() }) }),
  z.object({ type: z.literal("set_element_transform"), unitId: z.string().min(1), frameId: z.string().optional(), layerId: z.string().min(1), elementId: z.string().min(1), transform: z.object({ x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive(), rotate: z.number().optional() }) }),
  z.object({ type: z.literal("add_layer_element"), unitId: z.string().min(1), frameId: z.string().min(1), layerId: z.string().min(1), element: z.unknown() }),
  z.object({ type: z.literal("remove_layer_element"), unitId: z.string().min(1), frameId: z.string().min(1), layerId: z.string().min(1), elementId: z.string().min(1) }),
  z.object({ type: z.literal("duplicate_layer_element"), unitId: z.string().min(1), frameId: z.string().min(1), layerId: z.string().min(1), elementId: z.string().min(1), newElementId: z.string().min(1) }),
  z.object({ type: z.literal("reorder_layer"), unitId: z.string().min(1), frameId: z.string().min(1), layerId: z.string().min(1), zIndex: z.number().int() }),
  z.object({ type: z.literal("update_balloon"), unitId: z.string().min(1), frameId: z.string().min(1), layerId: z.string().min(1), elementId: z.string().min(1), changes: z.record(z.string(), z.unknown()) }),
  z.object({ type: z.literal("update_dialogue"), dialogueId: z.string().min(1), content: z.string() }),
  z.object({
    type: z.literal("update_storyboard_beat"),
    storyboardBeatId: z.string().min(1),
    patch: z.object({ title: z.string().min(1).max(80), description: z.string().max(4000) }).partial().refine((value) => Object.keys(value).length > 0),
  }),
]);

const changeSetRequestSchema = z.object({
  expectedWorkingRevision: z.number().int().positive(),
  changeSet: z.object({
    id: z.string().min(1),
    projectId: z.string().min(1),
    baseRevision: z.number().int().positive(),
    source: z.enum(["manual", "candidate", "undo", "redo", "migration"]),
    sourceCandidateId: z.string().optional(),
    commands: z.array(workspaceOperationSchema).min(1).max(200),
  }),
});

const contextDebugRequestSchema = z.object({
  conversationId: z.string().min(1),
  message: z.string().max(20_000).default(""),
  intent: z.string().max(80).optional(),
  scope: z.string().max(80).optional(),
  selection: selectionSchema.optional(),
  explicitReferences: z.array(z.object({ objectType: z.string().min(1), objectId: z.string().min(1), versionId: z.string().min(1).optional() })).max(24).optional(),
  currentPageIndex: z.number().int().nonnegative().optional(),
  workspaceMode: z.string().max(40).optional(),
  pendingAttachments: z.array(z.object({ name: z.string().max(240) })).max(12).optional(),
});

export function registerWorkbenchRoutes(app: FastifyInstance) {
  app.get<{ Params: { chapterId: string }; Querystring: { conversationId?: string } }>("/v1/workbench/:chapterId", async (request) => {
    const user = await currentUser(request);
    return ok(request, await getWorkbench(user.id, request.params.chapterId, request.query.conversationId));
  });

  app.post<{ Params: { projectId: string }; Body: { title?: string } }>("/v1/projects/:projectId/conversations", async (request) => {
    const user = await currentUser(request);
    await getOwnedProject(user.id, request.params.projectId);
    const title = request.body?.title?.trim().slice(0, 80) || `新对话 ${new Date().toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}`;
    const conversation = await prisma.agentConversation.create({ data: { ownerUserId: user.id, projectId: request.params.projectId, title } });
    return ok(request, conversation);
  });

  app.patch<{ Params: { conversationId: string }; Body: { title?: string; archived?: boolean } }>("/v1/conversations/:conversationId", async (request) => {
    const user = await currentUser(request);
    const conversation = await prisma.agentConversation.findFirst({ where: { id: request.params.conversationId, ownerUserId: user.id, archivedAt: null } });
    if (!conversation) throw new AppError("not_found", "对话不存在。", 404);
    if (request.body?.archived) {
      const activeTask = await getActiveConversationTask(user.id, conversation.id);
      if (activeTask) throw new AppError("task_in_progress", "请先停止当前任务，再清理这个对话。", 409);
    }
    const updated = await prisma.agentConversation.update({
      where: { id: conversation.id },
      data: {
        ...(request.body?.title !== undefined ? { title: request.body.title.trim().slice(0, 80) || "创作对话" } : {}),
        ...(request.body?.archived ? { archivedAt: new Date() } : {}),
      },
    });
    return ok(request, updated);
  });

  app.post<{ Params: { projectId: string }; Body: { expectedWorkingRevision: number; changeSet: WorkspaceChangeSet } }>("/v1/projects/:projectId/changesets", async (request) => {
    const user = await currentUser(request);
    const body = changeSetRequestSchema.parse(request.body) as { expectedWorkingRevision: number; changeSet: WorkspaceChangeSet };
    return ok(request, await commitChangeSet({
      ownerUserId: user.id,
      projectId: request.params.projectId,
      expectedRevision: body.expectedWorkingRevision,
      changeSet: body.changeSet,
      candidateId: body.changeSet.sourceCandidateId,
    }));
  });

  app.post<{ Params: { projectId: string }; Body: z.infer<typeof contextDebugRequestSchema> }>("/v1/projects/:projectId/context-debug", async (request) => {
    const user = await currentUser(request);
    await getOwnedProject(user.id, request.params.projectId);
    const body = contextDebugRequestSchema.parse(request.body ?? {});
    const conversation = await prisma.agentConversation.findFirst({ where: { id: body.conversationId, projectId: request.params.projectId, ownerUserId: user.id, archivedAt: null } });
    if (!conversation) throw new AppError("not_found", "当前对话不存在。", 404);
    return ok(request, await buildAgentContextDebugSnapshot({
      ownerUserId: user.id,
      projectId: request.params.projectId,
      conversationId: conversation.id,
      taskType: body.intent ?? "storyboard",
      instruction: body.message,
      scope: body.scope ?? "current_page",
      selection: body.selection,
      explicitReferences: body.explicitReferences,
    }, {
      currentPageIndex: body.currentPageIndex,
      workspaceMode: body.workspaceMode,
      pendingAttachments: body.pendingAttachments,
    }));
  });

  app.post<{ Params: { chapterId: string }; Body: { expectedWorkingRevision: number } }>("/v1/chapters/:chapterId/save-snapshot", async (request) => {
    const user = await currentUser(request);
    const project = await prisma.project.findFirst({ where: { chapterId: request.params.chapterId, ownerUserId: user.id } });
    if (!project) throw new AppError("not_found", "一话不存在。", 404);
    const working = await getLatestWorking(project.id);
    if (working.revision !== request.body.expectedWorkingRevision) throw new AppError("conflict", "工作稿已变化，请重新保存。", 409, { currentRevision: working.revision });
    const snapshot = await prisma.savedSnapshot.create({
      data: {
        ownerUserId: user.id,
        chapterId: request.params.chapterId,
        projectId: project.id,
        sourceWorkingRevision: working.revision,
        document: working.document as Prisma.InputJsonValue,
        storyboardBeatVersions: working.storyboardBeatVersionHeads as Prisma.InputJsonValue,
        assetVersions: working.assetVersionHeads as Prisma.InputJsonValue,
      },
    });
    return ok(request, snapshot);
  });
}

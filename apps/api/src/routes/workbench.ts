import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  workspaceChangeSetRequestSchema,
  type WorkspaceChangeSet,
} from "@lantern/shared";
import {
  commitChangeSet,
  getWorkbench,
  restoreLatestChapterSnapshot,
  saveChapterSnapshot,
} from "@lantern/server/workbench-service";
import { buildAgentContextDebugSnapshot } from "@lantern/agent-runtime/context-builder";
import { createProjectConversation, updateConversation } from "@lantern/agent-runtime/conversation-service";
import { explicitWorkspaceReferencesSchema } from "@lantern/agent-runtime/schemas";
import { currentUser, ok } from "../http";

const selectionSchema = z.object({
  type: z.string().min(1),
  id: z.string().min(1).optional(),
  pageId: z.string().min(1).optional(),
  label: z.string().optional(),
  canvasX: z.number().finite().optional(),
  canvasY: z.number().finite().optional(),
});

const contextDebugRequestSchema = z.object({
  conversationId: z.string().min(1),
  message: z.string().max(20_000).default(""),
  intent: z.string().max(80).optional(),
  scope: z.string().max(80).optional(),
  currentPageId: z.string().min(1).optional(),
  visiblePageIds: z.array(z.string().min(1)).min(1).max(2).optional(),
  selection: selectionSchema.optional(),
  explicitReferences: explicitWorkspaceReferencesSchema.optional(),
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
    return ok(request, await createProjectConversation(user.id, request.params.projectId, request.body ?? {}));
  });

  app.patch<{ Params: { conversationId: string }; Body: { title?: string; archived?: boolean } }>("/v1/conversations/:conversationId", async (request) => {
    const user = await currentUser(request);
    return ok(request, await updateConversation(user.id, request.params.conversationId, request.body ?? {}));
  });

  app.post<{ Params: { projectId: string }; Body: { expectedWorkingRevision: number; changeSet: WorkspaceChangeSet } }>("/v1/projects/:projectId/changesets", async (request) => {
    const user = await currentUser(request);
    const body = workspaceChangeSetRequestSchema.parse(request.body) as { expectedWorkingRevision: number; changeSet: WorkspaceChangeSet };
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
    const body = contextDebugRequestSchema.parse(request.body ?? {});
    return ok(request, await buildAgentContextDebugSnapshot({
      ownerUserId: user.id,
      projectId: request.params.projectId,
      conversationId: body.conversationId,
      taskType: "interaction",
      instruction: body.message,
      scope: body.scope ?? "current_page",
      currentPageId: body.currentPageId,
      visiblePageIds: body.visiblePageIds,
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
    return ok(request, await saveChapterSnapshot(user.id, request.params.chapterId, request.body.expectedWorkingRevision));
  });

  app.post<{ Params: { chapterId: string }; Body: { expectedWorkingRevision: number } }>("/v1/chapters/:chapterId/restore-snapshot", async (request) => {
    const user = await currentUser(request);
    return ok(request, await restoreLatestChapterSnapshot(user.id, request.params.chapterId, request.body.expectedWorkingRevision));
  });
}

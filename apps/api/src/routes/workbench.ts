import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  artworkAnnotationCreateInputSchema,
  artworkAnnotationStatusSchema,
  artworkAnnotationUpdateInputSchema,
  workspaceChangeSetRequestSchema,
  type WorkspaceChangeSet,
} from "@lantern/shared";
import {
  commitChangeSet,
  getWorkbench,
  restoreLatestChapterSnapshot,
  saveChapterSnapshot,
  updateProjectWorkspaceSettings,
} from "@lantern/server/workbench-service";
import { buildAgentContextDebugSnapshot } from "@lantern/agent-runtime/context-builder";
import { createProjectConversation, updateConversation } from "@lantern/agent-runtime/conversation-service";
import { explicitWorkspaceReferencesSchema } from "@lantern/agent-runtime/schemas";
import { currentUser, ok } from "../http";
import {
  applyChangeProposal,
  deleteSavedSnapshot,
  getVersionComparison,
  getVersionTimeline,
  restoreSavedSnapshot,
  updateChangeProposalStatus,
} from "@lantern/server/version-service";
import { getProjectAgentActivity } from "@lantern/server/agent-activity-service";
import {
  createArtworkAnnotation,
  deleteArtworkAnnotation,
  getArtworkAnnotation,
  listArtworkAnnotations,
  updateArtworkAnnotation,
} from "@lantern/server/artwork-annotation-service";

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

const workspaceSettingsSchema = z.object({ pageDisplayMode: z.enum(["single", "spread"]).optional() }).refine((value) => value.pageDisplayMode !== undefined);

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

  app.patch<{ Params: { projectId: string }; Body: z.infer<typeof workspaceSettingsSchema> }>("/v1/projects/:projectId/workspace-settings", async (request) => {
    const user = await currentUser(request);
    return ok(request, await updateProjectWorkspaceSettings(user.id, request.params.projectId, workspaceSettingsSchema.parse(request.body ?? {})));
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

  app.get<{ Params: { projectId: string } }>("/v1/projects/:projectId/versions", async (request) => {
    const user = await currentUser(request);
    return ok(request, await getVersionTimeline(user.id, request.params.projectId));
  });

  app.get<{
    Params: { projectId: string };
    Querystring: { cursor?: string; limit?: string };
  }>("/v1/projects/:projectId/agent-activity", async (request) => {
    const user = await currentUser(request);
    const limit = request.query.limit === undefined
      ? undefined
      : z.coerce.number().int().min(1).max(50).parse(request.query.limit);
    return ok(request, await getProjectAgentActivity(user.id, request.params.projectId, {
      cursor: request.query.cursor,
      limit,
    }));
  });

  app.get<{
    Params: { projectId: string };
    Querystring: { status?: string; unitId?: string; limit?: string };
  }>("/v1/projects/:projectId/annotations", async (request) => {
    const user = await currentUser(request);
    const statuses = request.query.status
      ? request.query.status.split(",").filter(Boolean).map((status) => artworkAnnotationStatusSchema.parse(status))
      : undefined;
    const limit = request.query.limit === undefined
      ? undefined
      : z.coerce.number().int().min(1).max(200).parse(request.query.limit);
    return ok(request, await listArtworkAnnotations(user.id, request.params.projectId, {
      statuses,
      unitId: request.query.unitId,
      limit,
    }));
  });

  app.post<{ Params: { projectId: string }; Body: unknown }>("/v1/projects/:projectId/annotations", async (request) => {
    const user = await currentUser(request);
    return ok(request, await createArtworkAnnotation(
      user.id,
      request.params.projectId,
      artworkAnnotationCreateInputSchema.parse(request.body),
    ));
  });

  app.get<{ Params: { annotationId: string } }>("/v1/annotations/:annotationId", async (request) => {
    const user = await currentUser(request);
    return ok(request, await getArtworkAnnotation(user.id, request.params.annotationId));
  });

  app.patch<{ Params: { annotationId: string }; Body: unknown }>("/v1/annotations/:annotationId", async (request) => {
    const user = await currentUser(request);
    return ok(request, await updateArtworkAnnotation(
      user.id,
      request.params.annotationId,
      artworkAnnotationUpdateInputSchema.parse(request.body),
    ));
  });

  app.delete<{ Params: { annotationId: string } }>("/v1/annotations/:annotationId", async (request) => {
    const user = await currentUser(request);
    await deleteArtworkAnnotation(user.id, request.params.annotationId);
    return ok(request, { deleted: true });
  });

  app.get<{ Params: { kind: string; id: string } }>("/v1/version-comparisons/:kind/:id", async (request) => {
    const user = await currentUser(request);
    const kind = z.enum(["saved_snapshot", "change_proposal"]).parse(request.params.kind);
    return ok(request, await getVersionComparison(user.id, kind, request.params.id));
  });

  app.post<{ Params: { proposalId: string } }>("/v1/change-proposals/:proposalId/retain", async (request) => {
    const user = await currentUser(request);
    return ok(request, await updateChangeProposalStatus(user.id, request.params.proposalId, "retain"));
  });

  app.post<{ Params: { proposalId: string } }>("/v1/change-proposals/:proposalId/discard", async (request) => {
    const user = await currentUser(request);
    return ok(request, await updateChangeProposalStatus(user.id, request.params.proposalId, "discard"));
  });

  app.post<{ Params: { proposalId: string }; Body: { expectedWorkingRevision: number } }>("/v1/change-proposals/:proposalId/apply", async (request) => {
    const user = await currentUser(request);
    const body = z.object({ expectedWorkingRevision: z.number().int().positive() }).parse(request.body);
    return ok(request, await applyChangeProposal(user.id, request.params.proposalId, body.expectedWorkingRevision));
  });

  app.post<{ Params: { snapshotId: string }; Body: { expectedWorkingRevision: number } }>("/v1/saved-snapshots/:snapshotId/restore", async (request) => {
    const user = await currentUser(request);
    const body = z.object({ expectedWorkingRevision: z.number().int().positive() }).parse(request.body);
    return ok(request, await restoreSavedSnapshot(user.id, request.params.snapshotId, body.expectedWorkingRevision));
  });

  app.delete<{ Params: { snapshotId: string } }>("/v1/saved-snapshots/:snapshotId", async (request) => {
    const user = await currentUser(request);
    return ok(request, await deleteSavedSnapshot(user.id, request.params.snapshotId));
  });
}

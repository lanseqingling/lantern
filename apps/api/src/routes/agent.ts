import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { CandidateKind, CandidateStatus } from "@prisma/client";
import { z } from "zod";
import type { WorkspaceOperation } from "../../../../packages/shared/src";
import {
  assertTaskCreationAllowed,
  createGenerationTask,
  requestTaskCancellation,
  retryTask,
  type CreateTaskInput,
} from "../../../../packages/agent-runtime/src/task-service";
import { applyAssetCandidate } from "../../../../packages/server/src/candidate-service";
import { prisma } from "../../../../packages/server/src/db";
import { AppError } from "../../../../packages/server/src/errors";
import {
  applyPageVariant,
  commitChangeSet,
  deletePageVariant,
  revertCandidateApplication,
  saveCandidateAsPageVariant,
} from "../../../../packages/server/src/workbench-service";
import { currentUser, ok, publicTask } from "../http";

const selectionSchema = z.object({
  type: z.string().min(1),
  id: z.string().min(1).optional(),
  pageId: z.string().min(1).optional(),
  label: z.string().optional(),
  canvasX: z.number().finite().optional(),
  canvasY: z.number().finite().optional(),
});

const explicitReferencesSchema = z.array(z.object({
  objectType: z.string().min(1),
  objectId: z.string().min(1),
  versionId: z.string().min(1).optional(),
})).max(24).optional();

const taskRequestSchema = z.object({
  projectId: z.string().min(1),
  conversationId: z.string().min(1).optional(),
  taskType: z.enum(["storyboard", "page_layout", "frame_image_generate", "frame_image_refine", "asset_parse", "dialogue", "export"]),
  instruction: z.string().min(1).max(20_000),
  scope: z.string().min(1),
  selection: selectionSchema.optional(),
  explicitReferences: explicitReferencesSchema,
  idempotencyKey: z.string().min(1).max(200),
});

type InteractionBody = {
  message: string;
  intent?: string;
  scope?: string;
  selection?: { type: string; id?: string; pageId?: string; label?: string };
  explicitReferences?: CreateTaskInput["explicitReferences"];
  idempotencyKey?: string;
};

export function registerAgentRoutes(app: FastifyInstance) {
  app.post<{ Params: { conversationId: string }; Body: InteractionBody }>("/v1/conversations/:conversationId/interactions", async (request) => {
    void request;
    throw new AppError("agent_execution_disabled", "旧 AI 对话任务已冻结，现有会话和历史记录不受影响。", 503);
  });

  app.post<{ Body: Omit<CreateTaskInput, "ownerUserId"> }>("/v1/tasks", async (request) => {
    const user = await currentUser(request);
    const body = taskRequestSchema.parse(request.body) as Omit<CreateTaskInput, "ownerUserId">;
    assertTaskCreationAllowed(body.taskType);
    return ok(request, publicTask(await createGenerationTask({ ...body, ownerUserId: user.id })));
  });

  app.get<{ Params: { taskId: string } }>("/v1/tasks/:taskId", async (request) => {
    const user = await currentUser(request);
    const task = await prisma.generationTask.findFirst({ where: { id: request.params.taskId, ownerUserId: user.id }, include: { attempts: { orderBy: { attempt: "asc" } }, candidates: true } });
    if (!task) throw new AppError("not_found", "任务不存在。", 404);
    return ok(request, { ...publicTask(task), attempts: task.attempts, candidates: task.candidates });
  });

  app.post<{ Params: { taskId: string } }>("/v1/tasks/:taskId/cancel", async (request) => {
    const user = await currentUser(request);
    return ok(request, publicTask(await requestTaskCancellation(user.id, request.params.taskId)));
  });

  app.post<{ Params: { taskId: string }; Body: { idempotencyKey?: string } }>("/v1/tasks/:taskId/retry", async (request) => {
    const user = await currentUser(request);
    return ok(request, publicTask(await retryTask(user.id, request.params.taskId, request.body?.idempotencyKey ?? `retry:${request.params.taskId}:${randomUUID()}`)));
  });

  app.post<{ Params: { candidateId: string }; Body: { expectedWorkingRevision: number } }>("/v1/candidates/:candidateId/apply", async (request) => {
    const user = await currentUser(request);
    const candidate = await prisma.candidate.findFirst({ where: { id: request.params.candidateId, ownerUserId: user.id } });
    if (!candidate) throw new AppError("not_found", "候选不存在。", 404);
    if (candidate.kind === CandidateKind.ASSET) return ok(request, await applyAssetCandidate(user.id, candidate.id, request.body.expectedWorkingRevision));
    const operations = candidate.operations as unknown as WorkspaceOperation[];
    return ok(request, await commitChangeSet({
      ownerUserId: user.id,
      projectId: candidate.projectId,
      expectedRevision: request.body.expectedWorkingRevision,
      candidateId: candidate.id,
      changeSet: {
        id: `candidate:${candidate.id}`,
        projectId: candidate.projectId,
        baseRevision: candidate.baseRevision,
        source: "candidate",
        sourceCandidateId: candidate.id,
        commands: operations,
      },
    }));
  });

  app.post<{ Params: { candidateId: string } }>("/v1/candidates/:candidateId/discard", async (request) => {
    const user = await currentUser(request);
    const result = await prisma.candidate.updateMany({ where: { id: request.params.candidateId, ownerUserId: user.id, status: CandidateStatus.AVAILABLE }, data: { status: CandidateStatus.DISCARDED } });
    if (!result.count) throw new AppError("conflict", "候选已不可丢弃。", 409);
    return ok(request, { status: "discarded" });
  });

  app.post<{ Params: { candidateId: string }; Body: { name?: string } }>("/v1/candidates/:candidateId/save-variant", async (request) => {
    const user = await currentUser(request);
    return ok(request, await saveCandidateAsPageVariant(user.id, request.params.candidateId, request.body?.name));
  });

  app.post<{ Params: { variantId: string }; Body: { expectedWorkingRevision: number } }>("/v1/page-variants/:variantId/apply", async (request) => {
    const user = await currentUser(request);
    return ok(request, await applyPageVariant(user.id, request.params.variantId, request.body.expectedWorkingRevision));
  });

  app.delete<{ Params: { variantId: string } }>("/v1/page-variants/:variantId", async (request) => {
    const user = await currentUser(request);
    return ok(request, await deletePageVariant(user.id, request.params.variantId));
  });

  app.post<{ Params: { candidateId: string } }>("/v1/candidates/:candidateId/revert", async (request) => {
    const user = await currentUser(request);
    return ok(request, await revertCandidateApplication(user.id, request.params.candidateId));
  });
}

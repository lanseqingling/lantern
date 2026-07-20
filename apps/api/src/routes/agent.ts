import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
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
import { retryAgentInteraction, runAgentInteraction, type AgentImageAttachment } from "../../../../packages/agent-runtime/src/interaction-service";
import { explicitWorkspaceReferencesSchema } from "../../../../packages/agent-runtime/src/schemas";
import { applyAssetCandidate, assertFrameCandidateApplicationTarget } from "../../../../packages/server/src/candidate-service";
import { isWorkbenchAgentCandidateVisible } from "../../../../packages/server/src/workbench-agent-visibility";
import { prisma } from "../../../../packages/server/src/db";
import { AppError } from "../../../../packages/server/src/errors";
import {
  commitChangeSet,
  revertCandidateApplication,
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

const explicitReferencesSchema = explicitWorkspaceReferencesSchema.optional();
const imageAttachmentsSchema = z.array(z.object({
  assetId: z.string().min(1),
  versionId: z.string().min(1),
  name: z.string().trim().min(1).max(240),
})).max(3).optional();

const taskRequestSchema = z.object({
  projectId: z.string().min(1),
  conversationId: z.string().min(1).optional(),
  taskType: z.enum(["storyboard", "frame_image_generate", "asset_parse"]),
  instruction: z.string().min(1).max(20_000),
  scope: z.string().min(1),
  selection: selectionSchema.optional(),
  explicitReferences: explicitReferencesSchema,
  idempotencyKey: z.string().min(1).max(200),
});

const interactionRequestSchema = z.object({
  message: z.string().trim().min(1).max(20_000),
  intent: z.string().max(80).optional(),
  scope: z.string().max(80).optional(),
  currentPageId: z.string().min(1).optional(),
  visiblePageIds: z.array(z.string().min(1)).min(1).max(2).optional(),
  selection: selectionSchema.default({ type: "none" }),
  explicitReferences: explicitReferencesSchema,
  imageAttachments: imageAttachmentsSchema,
  idempotencyKey: z.string().min(1).max(200).optional(),
});

type InteractionBody = z.infer<typeof interactionRequestSchema>;

export function registerAgentRoutes(app: FastifyInstance) {
  app.post<{ Params: { conversationId: string }; Body: InteractionBody }>("/v1/conversations/:conversationId/interactions", async (request) => {
    const user = await currentUser(request);
    const body = interactionRequestSchema.parse(request.body ?? {});
    const result = await runAgentInteraction({
      ownerUserId: user.id,
      conversationId: request.params.conversationId,
      message: body.message,
      intent: body.intent,
      scope: body.scope,
      currentPageId: body.currentPageId,
      visiblePageIds: body.visiblePageIds,
      selection: body.selection,
      explicitReferences: body.explicitReferences as CreateTaskInput["explicitReferences"],
      imageAttachments: body.imageAttachments as AgentImageAttachment[] | undefined,
      idempotencyKey: body.idempotencyKey ?? `interaction:${randomUUID()}`,
    });
    return ok(request, result.task ? { decision: result.decision, task: publicTask(result.task) } : { decision: result.decision });
  });

  app.post<{ Params: { conversationId: string }; Body: InteractionBody }>("/v1/conversations/:conversationId/interactions/stream", async (request, reply) => {
    const user = await currentUser(request);
    const body = interactionRequestSchema.parse(request.body ?? {});
    const result = await runAgentInteraction({
      ownerUserId: user.id,
      conversationId: request.params.conversationId,
      message: body.message,
      intent: body.intent,
      scope: body.scope,
      currentPageId: body.currentPageId,
      visiblePageIds: body.visiblePageIds,
      selection: body.selection,
      explicitReferences: body.explicitReferences as CreateTaskInput["explicitReferences"],
      imageAttachments: body.imageAttachments as AgentImageAttachment[] | undefined,
      idempotencyKey: body.idempotencyKey ?? `interaction:${randomUUID()}`,
    });
    const task = result.task ? publicTask(result.task) : undefined;
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    reply.raw.flushHeaders();
    reply.raw.write(`${JSON.stringify({ type: "decision", decision: { ...result.decision, message: undefined } })}\n`);
    const characters = Array.from(result.decision.message);
    for (let index = 0; index < characters.length; index += 4) {
      reply.raw.write(`${JSON.stringify({ type: "text_delta", delta: characters.slice(index, index + 4).join("") })}\n`);
      await delay(18);
    }
    reply.raw.end(`${JSON.stringify({ type: "complete", decision: result.decision, task })}\n`);
  });

  app.post<{ Params: { messageId: string } }>("/v1/agent-messages/:messageId/resolve", async (request) => {
    const user = await currentUser(request);
    const message = await prisma.message.findFirst({ where: { id: request.params.messageId, ownerUserId: user.id } });
    if (!message) throw new AppError("not_found", "交互卡片不存在。", 404);
    const metadata = message.metadata as Record<string, unknown>;
    await prisma.message.update({ where: { id: message.id }, data: { metadata: { ...metadata, resolved: true } } });
    return ok(request, { id: message.id, resolved: true });
  });

  app.post<{ Params: { messageId: string }; Body: { idempotencyKey?: string } }>("/v1/agent-messages/:messageId/retry", async (request) => {
    const user = await currentUser(request);
    const result = await retryAgentInteraction(
      user.id,
      request.params.messageId,
      request.body?.idempotencyKey ?? `interaction-retry:${request.params.messageId}:${randomUUID()}`,
    );
    return ok(request, result.task ? { decision: result.decision, task: publicTask(result.task) } : { decision: result.decision });
  });

  app.post<{ Body: Omit<CreateTaskInput, "ownerUserId"> }>("/v1/tasks", async (request) => {
    const user = await currentUser(request);
    const body = taskRequestSchema.parse(request.body);
    assertTaskCreationAllowed(body.taskType);
    const task = await createGenerationTask({
      ownerUserId: user.id,
      projectId: body.projectId,
      conversationId: body.conversationId,
      taskType: body.taskType,
      instruction: body.instruction,
      scope: body.scope,
      selection: body.selection,
      explicitReferences: body.explicitReferences as CreateTaskInput["explicitReferences"],
      idempotencyKey: body.idempotencyKey,
    });
    return ok(request, publicTask(task));
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

  app.post<{ Params: { candidateId: string }; Body: { expectedWorkingRevision: number; expectedFrameTarget?: { unitId: string; frameId: string } } }>("/v1/candidates/:candidateId/apply", async (request) => {
    const user = await currentUser(request);
    const candidate = await prisma.candidate.findFirst({ where: { id: request.params.candidateId, ownerUserId: user.id } });
    if (!candidate) throw new AppError("not_found", "候选不存在。", 404);
    const payload = candidate.payload && typeof candidate.payload === "object" && !Array.isArray(candidate.payload)
      ? candidate.payload as Record<string, unknown>
      : {};
    if (!isWorkbenchAgentCandidateVisible(candidate.kind, payload)) throw new AppError("validation", "这个候选不属于当前 Agent 能力范围。", 422);
    if (candidate.kind === CandidateKind.ASSET) return ok(request, await applyAssetCandidate(user.id, candidate.id, request.body.expectedWorkingRevision));
    assertFrameCandidateApplicationTarget(candidate.kind, candidate.target, candidate.operations, request.body.expectedFrameTarget);
    const working = await prisma.workingRevision.findFirst({ where: { projectId: candidate.projectId }, orderBy: { revision: "desc" } });
    if (!working) throw new AppError("not_found", "工作稿不存在。", 404);
    if (candidate.status !== CandidateStatus.AVAILABLE || candidate.baseRevision !== working.revision || request.body.expectedWorkingRevision !== working.revision) {
      if (candidate.status === CandidateStatus.AVAILABLE) await prisma.candidate.update({ where: { id: candidate.id }, data: { status: CandidateStatus.STALE } });
      throw new AppError("conflict", "候选基于较早的工作稿，请按当前内容重新生成。", 409, { currentRevision: working.revision });
    }
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

  app.post<{ Params: { candidateId: string } }>("/v1/candidates/:candidateId/revert", async (request) => {
    const user = await currentUser(request);
    return ok(request, await revertCandidateApplication(user.id, request.params.candidateId));
  });
}

import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  assertTaskCreationAllowed,
  getGenerationTask,
  invokeTaskCapability,
  requestTaskCancellation,
  retryTask,
  type CreateTaskInput,
} from "@lantern/agent-runtime/task-service";
import { getTaskAgentCapability } from "@lantern/agent-runtime/capability-registry";
import { retryAgentInteraction, runAgentInteraction, type AgentImageAttachment } from "@lantern/agent-runtime/interaction-service";
import { resolveAgentMessage } from "@lantern/agent-runtime/conversation-service";
import { explicitWorkspaceReferencesSchema } from "@lantern/agent-runtime/schemas";
import { applyCandidate, discardCandidate } from "@lantern/server/candidate-service";
import { AppError } from "@lantern/server/errors";
import { revertCandidateApplication } from "@lantern/server/workbench-service";
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
  taskType: z.enum(["storyboard", "frame_image_generate", "asset_image_generate"]),
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
    return ok(request, await resolveAgentMessage(user.id, request.params.messageId));
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

  app.post("/v1/tasks", async (request) => {
    const user = await currentUser(request);
    const body = taskRequestSchema.parse(request.body);
    assertTaskCreationAllowed(body.taskType);
    const capability = getTaskAgentCapability(body.taskType);
    if (!capability || capability.execution !== "asynchronous" || !capability.scope) throw new Error(`AGENT_TASK_CAPABILITY_MISSING:${body.taskType}`);
    if (body.scope !== capability.scope) throw new AppError("invalid_scope", "任务范围与能力契约不一致。", 422);
    const task = await invokeTaskCapability({
      ownerUserId: user.id,
      projectId: body.projectId,
      conversationId: body.conversationId,
      capabilityId: capability.id,
      actor: "internal",
      client: { name: "lantern-web" },
      arguments: { instruction: body.instruction },
      selection: body.selection,
      explicitReferences: body.explicitReferences as CreateTaskInput["explicitReferences"],
      idempotencyKey: body.idempotencyKey,
    });
    return ok(request, publicTask(task));
  });

  app.get<{ Params: { taskId: string } }>("/v1/tasks/:taskId", async (request) => {
    const user = await currentUser(request);
    const task = await getGenerationTask(user.id, request.params.taskId);
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
    return ok(request, await applyCandidate(user.id, request.params.candidateId, request.body, {
      actor: "human",
      client: { name: "lantern-web" },
    }));
  });

  app.post<{ Params: { candidateId: string } }>("/v1/candidates/:candidateId/discard", async (request) => {
    const user = await currentUser(request);
    return ok(request, await discardCandidate(user.id, request.params.candidateId));
  });

  app.post<{ Params: { candidateId: string } }>("/v1/candidates/:candidateId/revert", async (request) => {
    const user = await currentUser(request);
    return ok(request, await revertCandidateApplication(user.id, request.params.candidateId));
  });
}

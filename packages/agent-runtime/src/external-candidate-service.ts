import { prisma } from "@lantern/server/db";
import { AppError } from "@lantern/server/errors";
import { executeIdempotentExternalMutation } from "@lantern/server/external-operation-service";
import { resolveResourceReference, resourceReference } from "@lantern/server/resource-reference-service";
import {
  assertAgentCapabilityAccess,
  getAgentCapability,
  listAgentCapabilities,
  type AgentCapabilityDescriptor,
} from "./capability-registry";
import {
  externalCandidateToolResultSchema,
  isCandidateCapabilityId,
} from "./candidate-capabilities";
import {
  agentDraftReference,
  commitAgentDraftChange,
  createAgentDraft,
} from "@lantern/server/version-service";
import type { WorkspaceCommand } from "@lantern/shared";

function argument(input: Record<string, unknown>, name: string) {
  const value = input[name];
  if (typeof value !== "string") throw new AppError("validation", `缺少 ${name} 参数。`, 400);
  return value;
}

export function listExternalCandidateCapabilities() {
  return listAgentCapabilities().filter((capability) =>
    capability.execution === "synchronous"
    && capability.agentAccess.external !== "disabled"
    && isCandidateCapabilityId(capability.id));
}

async function executeExternalCandidateCapability(
  ownerUserId: string,
  capability: AgentCapabilityDescriptor,
  parsed: Record<string, unknown>,
) {
  const target = await resolveResourceReference(ownerUserId, argument(parsed, "candidate"), "candidate");
  const candidate = await prisma.candidate.findFirst({
    where: { id: target.id, ownerUserId, projectId: target.projectId },
  });
  if (!candidate || !target.projectId || !target.workingRevision) {
    throw new AppError("not_found", "候选不存在或不属于当前用户。", 404);
  }
  const reference = resourceReference("candidate", candidate.id);
  const project = resourceReference("project", target.projectId).uri;
  if (capability.id === "candidate.get") {
    return externalCandidateToolResultSchema.parse({
      capability: { id: capability.id, version: capability.version },
      effect: capability.effect,
      candidate: reference,
      project,
      baseRevision: candidate.baseRevision,
      workingRevision: target.workingRevision,
      data: {
        kind: candidate.kind.toLowerCase(),
        status: candidate.status.toLowerCase(),
        title: candidate.title,
        changeSummary: candidate.changeSummary,
        targetLabel: candidate.targetLabel,
      },
      nextActions: candidate.status === "AVAILABLE"
        ? ["Apply this exact Candidate with its current working revision, or leave it unchanged."]
        : [],
    });
  }
  if (capability.id === "candidate.apply") {
    const expectedRevision = parsed.expectedRevision as number;
    if (candidate.status !== "AVAILABLE" || candidate.baseRevision !== expectedRevision || target.workingRevision !== expectedRevision) {
      throw new AppError("context_stale", "候选或当前稿已经变化，请重新读取后再操作。", 409);
    }
    const commands = candidate.operations as unknown as WorkspaceCommand[];
    if (!Array.isArray(commands) || !commands.length) throw new AppError("empty_change", "该候选没有可合入的作品变化。", 422);
    const created = await createAgentDraft({
      ownerUserId,
      projectId: target.projectId,
      baseWorkingRevision: expectedRevision,
      title: candidate.title,
      sourceHost: "lantern-mcp",
    });
    const applied = await commitAgentDraftChange({
      ownerUserId,
      draftId: created.draft.id,
      expectedDraftRevision: created.revision.revision,
      changeSet: {
        id: `external-candidate:${candidate.id}`,
        projectId: target.projectId,
        baseRevision: created.revision.revision,
        source: "candidate",
        sourceCandidateId: candidate.id,
        commands,
      },
    });
    return externalCandidateToolResultSchema.parse({
      capability: { id: capability.id, version: capability.version },
      effect: capability.effect,
      candidate: reference,
      project,
      baseRevision: candidate.baseRevision,
      baseWorkingRevision: expectedRevision,
      draft: agentDraftReference(created.draft.id),
      draftRevision: applied.revision.revision,
      data: { status: "merged_into_agent_draft" },
      nextActions: ["Read the returned AgentDraft context before another edit, then freeze it when the task is complete."],
    });
  }
  throw new AppError("capability_not_available", "该 Candidate 能力当前没有同步执行器。", 404);
}

export async function invokeExternalCandidateCapability(
  ownerUserId: string,
  capabilityId: string,
  input: unknown,
) {
  const capability = getAgentCapability(capabilityId);
  if (!capability || capability.execution !== "synchronous" || !isCandidateCapabilityId(capability.id)) {
    throw new AppError("capability_not_available", "该 Candidate 能力当前未向外部 Agent 开放。", 404);
  }
  assertAgentCapabilityAccess(capability, "external");
  const parsed = capability.inputSchema.parse(input) as Record<string, unknown>;
  if (capability.effect === "observe") {
    return executeExternalCandidateCapability(ownerUserId, capability, parsed);
  }
  return executeIdempotentExternalMutation({
    ownerUserId,
    capabilityId: capability.id,
    capabilityVersion: capability.version,
    idempotencyKey: argument(parsed, "idempotencyKey"),
    input: parsed,
    targetReference: argument(parsed, "candidate"),
    operation: () => executeExternalCandidateCapability(ownerUserId, capability, parsed),
  });
}

import { randomUUID } from "node:crypto";
import {
  normalizeStoryboardBeats,
  validateComicDocument,
  type WorkbenchFixture,
  type WorkspaceCommand,
} from "@lantern/shared";
import { prisma } from "@lantern/server/db";
import { AppError } from "@lantern/server/errors";
import { executeIdempotentExternalMutation } from "@lantern/server/external-operation-service";
import { resolveResourceReference, resourceReference } from "@lantern/server/resource-reference-service";
import {
  agentDraftReference,
  commitAgentDraftChange,
  createAgentDraft,
  getAgentDraft,
} from "@lantern/server/version-service";
import {
  assertAgentCapabilityAccess,
  type AgentCapabilityDescriptor,
} from "./capability-registry";
import {
  externalDirectChangeEnvelopeSchema,
  type ExternalDirectChangeEnvelope,
} from "./external-edit-contract";
import { resolveExternalTargetHandles, type ExternalTargetHandlePayload } from "./external-target-handles";

export { externalDirectChangeEnvelopeSchema } from "./external-edit-contract";
export type { ExternalDirectChangeEnvelope } from "./external-edit-contract";

export type ExternalDirectChangePlan = {
  commands: WorkspaceCommand[];
  data?: unknown;
};

export type ExternalDirectChangeContext = {
  ownerUserId: string;
  comicId: string;
  projectId: string;
  chapterId: string;
  baseRevision: number;
  fixture: Pick<WorkbenchFixture, "working" | "storyboardBeats">;
  targets: Array<{
    handle: string;
    target: ExternalTargetHandlePayload["target"];
  }>;
};

function sameHandles(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const expected = new Set(left);
  return expected.size === left.length
    && new Set(right).size === right.length
    && right.every((handle) => expected.has(handle));
}

function targetAuditReference(
  projectReference: string,
  targets: ExternalDirectChangeContext["targets"],
) {
  const identities = targets.map(({ target }) => {
    const id = target.elementId ?? target.frameId ?? target.pageId ?? "scope";
    return `${target.type}:${id}`;
  });
  return `${projectReference}#targets=${encodeURIComponent(identities.join(","))}`;
}

function assertCapabilityContract(
  capability: AgentCapabilityDescriptor,
  targets: ExternalDirectChangeContext["targets"],
  confirmedTargetHandles: string[] | undefined,
) {
  if (capability.execution !== "synchronous" || capability.effect !== "direct_change") {
    throw new AppError("capability_contract_error", "该能力不是可直接应用的同步编辑能力。", 500);
  }
  try {
    assertAgentCapabilityAccess(capability, "external");
  } catch {
    throw new AppError("capability_not_available", "该编辑能力没有向外部 Agent 开放。", 403);
  }
  if (targets.length < capability.target.min || targets.length > capability.target.max) {
    throw new AppError("invalid_target_scope", "目标数量不符合该编辑能力的范围。", 422, {
      minimum: capability.target.min,
      maximum: capability.target.max,
      received: targets.length,
    });
  }
  if (targets.some(({ target }) => !capability.target.types.includes(target.type))) {
    throw new AppError("invalid_target_type", "上下文目标类型不符合该编辑能力。", 422, {
      allowedTypes: capability.target.types,
      receivedTypes: [...new Set(targets.map(({ target }) => target.type))],
    });
  }
  if (capability.confirmation === "explicit") {
    const targetHandles = targets.map(({ handle }) => handle);
    if (!confirmedTargetHandles || !sameHandles(targetHandles, confirmedTargetHandles)) {
      throw new AppError("confirmation_required", "该破坏性编辑需要确认这次调用中的准确目标。", 403, {
        targetCount: targetHandles.length,
      });
    }
  }
}

async function loadExternalChangeFixture(
  ownerUserId: string,
  projectId: string,
  chapterId: string,
  expectedRevision: number,
) {
  const working = await prisma.workingRevision.findFirst({
    where: { projectId, project: { ownerUserId, chapterId } },
    orderBy: { revision: "desc" },
  });
  if (!working) throw new AppError("not_found", "工作稿不存在。", 404);
  if (working.revision !== expectedRevision) {
    throw new AppError("revision_conflict", "工作稿已经变化，请重新读取目标后再编辑。", 409, {
      expectedRevision,
      currentRevision: working.revision,
    });
  }
  return {
    working: {
      documentId: working.id,
      chapterId,
      projectId,
      createdAt: working.createdAt.toISOString(),
      state: "working" as const,
      revision: working.revision,
      document: validateComicDocument(working.document),
    },
    storyboardBeats: normalizeStoryboardBeats(working.storyboardBeats),
  };
}

async function loadExternalDraftFixture(ownerUserId: string, draftId: string) {
  const { draft, revision } = await getAgentDraft(ownerUserId, draftId);
  return {
    draft,
    revision,
    fixture: {
      working: {
        documentId: revision.id,
        chapterId: "agent-draft",
        projectId: draft.projectId,
        createdAt: revision.createdAt.toISOString(),
        state: "working" as const,
        revision: revision.revision,
        document: validateComicDocument(revision.document),
      },
      storyboardBeats: normalizeStoryboardBeats(revision.storyboardBeats),
    },
  };
}

export async function executeExternalDirectChange(input: {
  ownerUserId: string;
  capability: AgentCapabilityDescriptor;
  envelope: ExternalDirectChangeEnvelope;
  plan: (context: ExternalDirectChangeContext) => Promise<ExternalDirectChangePlan> | ExternalDirectChangePlan;
}) {
  const envelope = externalDirectChangeEnvelopeSchema.parse(input.envelope);
  const scope = await resolveResourceReference(input.ownerUserId, envelope.scope);
  if (!scope.projectId || !scope.chapterId) {
    throw new AppError("invalid_context_scope", "页面编辑需要明确到一话或创作空间。", 422);
  }
  const projectReference = resourceReference("project", scope.projectId).uri;
  let completedTargetReference = projectReference;
  return executeIdempotentExternalMutation({
    ownerUserId: input.ownerUserId,
    capabilityId: input.capability.id,
    capabilityVersion: input.capability.version,
    idempotencyKey: envelope.idempotencyKey,
    input: envelope,
    targetReference: projectReference,
    resultTargetReference: () => completedTargetReference,
    operation: async () => {
      const resolved = await resolveExternalTargetHandles({
        ownerUserId: input.ownerUserId,
        projectId: scope.projectId,
        handles: envelope.targetHandles,
        expectedRevision: envelope.expectedRevision,
      });
      const targets = resolved.decoded.map(({ handle, payload }) => ({ handle, target: payload.target }));
      completedTargetReference = targetAuditReference(projectReference, targets);
      assertCapabilityContract(input.capability, targets, envelope.confirmedTargetHandles);
      const draftState = resolved.source.kind === "agent_draft"
        ? await loadExternalDraftFixture(input.ownerUserId, resolved.source.draftId)
        : await (async () => {
            // Resolve the official fixture once before branching so a task can
            // never start from a revision other than the handles it received.
            await loadExternalChangeFixture(
              input.ownerUserId,
              scope.projectId!,
              scope.chapterId!,
              resolved.workingRevision,
            );
            const created = await createAgentDraft({
              ownerUserId: input.ownerUserId,
              projectId: scope.projectId!,
              baseWorkingRevision: resolved.workingRevision,
            });
            return loadExternalDraftFixture(input.ownerUserId, created.draft.id);
          })();
      const planned = await input.plan({
        ownerUserId: input.ownerUserId,
        comicId: scope.comicId!,
        projectId: scope.projectId!,
        chapterId: scope.chapterId!,
        baseRevision: draftState.revision.revision,
        fixture: draftState.fixture,
        targets,
      });
      if (!planned.commands.length) {
        throw new AppError("empty_change", "该编辑没有产生任何作品变化。", 422);
      }
      const result = await commitAgentDraftChange({
        ownerUserId: input.ownerUserId,
        draftId: draftState.draft.id,
        expectedDraftRevision: draftState.revision.revision,
        changeSet: {
          id: `external:${input.capability.id}:${randomUUID()}`,
          projectId: scope.projectId!,
          baseRevision: draftState.revision.revision,
          source: "manual",
          commands: planned.commands,
        },
      });
      return {
        capability: { id: input.capability.id, version: input.capability.version },
        effect: "direct_change" as const,
        project: projectReference,
        baseWorkingRevision: draftState.draft.baseWorkingRevision,
        workingRevision: draftState.draft.baseWorkingRevision,
        draft: agentDraftReference(draftState.draft.id),
        draftRevision: result.revision.revision,
        ...(planned.data !== undefined ? { data: planned.data } : {}),
        nextActions: [
          "Read fresh Lantern context with source=agent_draft and the returned draft before another edit.",
          "When the requested work is complete, freeze the draft into a reviewable proposal.",
        ],
      };
    },
  });
}

import { getConfig } from "@lantern/server/config";
import { AppError } from "@lantern/server/errors";
import { executeIdempotentExternalMutation } from "@lantern/server/external-operation-service";
import { completeExternalAgentActivityGroup } from "@lantern/server/agent-activity-service";
import { freezeAgentDraft, parseAgentDraftReference } from "@lantern/server/version-service";
import { agentDraftCapabilities, agentDraftFinishInputSchema, agentDraftFinishOutputSchema } from "./agent-draft-capabilities";
import { assertAgentCapabilityAccess } from "./capability-registry";

export function listExternalAgentDraftCapabilities() {
  return [...agentDraftCapabilities];
}

export async function invokeExternalAgentDraftCapability(ownerUserId: string, capabilityId: string, input: unknown) {
  const capability = agentDraftCapabilities.find((item) => item.id === capabilityId);
  if (!capability) throw new AppError("capability_not_available", "该 Agent 草稿能力当前没有开放。", 404);
  assertAgentCapabilityAccess(capability, "external");
  const parsed = agentDraftFinishInputSchema.parse(input);
  return executeIdempotentExternalMutation({
    ownerUserId,
    capabilityId: capability.id,
    capabilityVersion: capability.version,
    idempotencyKey: parsed.idempotencyKey,
    input: parsed,
    targetReference: parsed.draft,
    operation: async () => {
      const proposal = await freezeAgentDraft({
        ownerUserId,
        draft: parsed.draft,
        title: parsed.title,
        summary: parsed.summary,
      });
      await completeExternalAgentActivityGroup({
        ownerUserId,
        draftId: parseAgentDraftReference(parsed.draft),
        title: parsed.title,
      }).catch(() => undefined);
      const origin = getConfig().WEB_ORIGIN.replace(/\/+$/, "");
      return agentDraftFinishOutputSchema.parse({
        capability: { id: capability.id, version: capability.version },
        effect: "candidate",
        proposal: proposal.proposal,
        projectId: proposal.projectId,
        baseWorkingRevision: proposal.baseWorkingRevision,
        draftRevision: proposal.draftRevision,
        reviewUrl: `${origin}${proposal.reviewPath}`,
        status: proposal.status,
        nextActions: ["Return reviewUrl to the user. Do not apply or save the proposal without a trusted user action in Lantern."],
      });
    },
  });
}

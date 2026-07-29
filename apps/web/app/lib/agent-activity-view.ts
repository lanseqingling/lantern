import type {
  AgentActivityEvent,
  AgentActivityGroup,
  AgentActivityNavigation,
} from "@lantern/shared";
import { uiCopy } from "./ui-copy";

export type AgentActivityStatusPresentation = {
  tone: "running" | "completed" | "timed-out" | "awaiting-review" | "muted";
  label: string;
};

export type AgentActivityEventDetailRow = {
  label: string;
  value: string;
  code?: boolean;
  block?: boolean;
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function isSensitiveDetailKey(key: string) {
  const normalized = key.replace(/[^a-z]/gi, "").toLowerCase();
  return normalized.includes("password")
    || normalized.includes("secret")
    || normalized.includes("authorization")
    || normalized.includes("cookie")
    || normalized.endsWith("token")
    || normalized.endsWith("url")
    || normalized === "objectkey"
    || normalized === "idempotencykey"
    || normalized === "uploadid";
}

function safeDetailData(value: unknown, depth = 0): unknown {
  if (depth > 4) return uiCopy.workbench.agentActivity.detail.omitted;
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 12).map((item) => safeDetailData(item, depth + 1));
  }
  const source = record(value);
  if (!source) return String(value);
  return Object.fromEntries(
    Object.entries(source)
      .filter(([key]) => !isSensitiveDetailKey(key))
      .slice(0, 24)
      .map(([key, item]) => [key, safeDetailData(item, depth + 1)]),
  );
}

function detailDataText(value: unknown) {
  if (value === undefined) return undefined;
  const serialized = JSON.stringify(safeDetailData(value), null, 2);
  if (!serialized || serialized === "{}" || serialized === "[]") return undefined;
  return serialized.length > 2_000
    ? `${serialized.slice(0, 2_000)}\n${uiCopy.workbench.agentActivity.detail.truncated}`
    : serialized;
}

function detailTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

export function agentActivityEventDetails(event: AgentActivityEvent): AgentActivityEventDetailRow[] {
  const targets = event.projection.targets
    .map((target) => target.label ?? target.type)
    .filter(Boolean);
  const assetVersionIds = [...new Set(event.projection.targets.flatMap((target) => target.assetVersionIds))];
  const result = detailDataText(event.projection.data);
  return [
    {
      label: uiCopy.workbench.agentActivity.detail.capability,
      value: event.capabilityId ?? event.projection.action,
      code: true,
    },
    {
      label: uiCopy.workbench.agentActivity.detail.tool,
      value: event.toolName,
      code: true,
    },
    {
      label: uiCopy.workbench.agentActivity.detail.eventType,
      value: event.eventType,
      code: true,
    },
    {
      label: uiCopy.workbench.agentActivity.detail.status,
      value: event.status === "running"
        ? uiCopy.workbench.agentActivity.eventStatus.running
        : event.status === "failed"
          ? uiCopy.workbench.agentActivity.eventStatus.failed
          : uiCopy.workbench.agentActivity.eventStatus.succeeded,
    },
    ...(targets.length ? [{
      label: uiCopy.workbench.agentActivity.detail.targets,
      value: targets.join("、"),
    }] : []),
    ...(assetVersionIds.length ? [{
      label: uiCopy.workbench.agentActivity.detail.assetVersions,
      value: assetVersionIds.join("\n"),
      code: true,
      block: true,
    }] : []),
    ...(result ? [{
      label: uiCopy.workbench.agentActivity.detail.result,
      value: result,
      code: true,
      block: true,
    }] : []),
    {
      label: uiCopy.workbench.agentActivity.detail.startedAt,
      value: detailTime(event.startedAt),
    },
    ...(event.completedAt ? [{
      label: uiCopy.workbench.agentActivity.detail.completedAt,
      value: detailTime(event.completedAt),
    }] : []),
  ];
}

export function agentActivityStatus(group: AgentActivityGroup): AgentActivityStatusPresentation {
  if (group.status === "running") {
    return { tone: "running", label: uiCopy.workbench.agentActivity.status.running };
  }
  if (group.status === "timed_out") {
    return { tone: "timed-out", label: uiCopy.workbench.agentActivity.status.timedOut };
  }
  if (group.proposal?.status === "available") {
    return { tone: "awaiting-review", label: uiCopy.workbench.agentActivity.status.awaitingReview };
  }
  if (group.proposal?.status === "retained") {
    return { tone: "completed", label: uiCopy.workbench.agentActivity.status.retained };
  }
  if (group.proposal?.status === "applied") {
    return { tone: "completed", label: uiCopy.workbench.agentActivity.status.completed };
  }
  if (group.proposal?.status === "discarded") {
    return { tone: "muted", label: uiCopy.workbench.agentActivity.status.discarded };
  }
  if (group.proposal?.status === "stale") {
    return { tone: "muted", label: uiCopy.workbench.agentActivity.status.stale };
  }
  return { tone: "completed", label: uiCopy.workbench.agentActivity.status.completed };
}

const eventLabels: Record<string, string> = {
  "page.create": uiCopy.workbench.agentActivity.event.pageCreated,
  "page.rename": uiCopy.workbench.agentActivity.event.pageRenamed,
  "page.duplicate": uiCopy.workbench.agentActivity.event.pageDuplicated,
  "page.move": uiCopy.workbench.agentActivity.event.pageMoved,
  "page.delete": uiCopy.workbench.agentActivity.event.pageDeleted,
  "page.merge_spread": uiCopy.workbench.agentActivity.event.spreadMerged,
  "page.split_spread": uiCopy.workbench.agentActivity.event.spreadSplit,
  "frame.create": uiCopy.workbench.agentActivity.event.frameCreated,
  "frame.update": uiCopy.workbench.agentActivity.event.frameUpdated,
  "frame.duplicate": uiCopy.workbench.agentActivity.event.frameDuplicated,
  "frame.delete": uiCopy.workbench.agentActivity.event.frameDeleted,
  "image.place": uiCopy.workbench.agentActivity.event.imagePlaced,
  "image.update": uiCopy.workbench.agentActivity.event.imageUpdated,
  "image.remove": uiCopy.workbench.agentActivity.event.imageRemoved,
  "balloon.create": uiCopy.workbench.agentActivity.event.balloonCreated,
  "balloon.update": uiCopy.workbench.agentActivity.event.balloonUpdated,
  "balloon.duplicate": uiCopy.workbench.agentActivity.event.balloonDuplicated,
  "balloon.delete": uiCopy.workbench.agentActivity.event.balloonDeleted,
  "narration.create": uiCopy.workbench.agentActivity.event.narrationCreated,
  "narration.update": uiCopy.workbench.agentActivity.event.narrationUpdated,
  "narration.duplicate": uiCopy.workbench.agentActivity.event.narrationDuplicated,
  "narration.delete": uiCopy.workbench.agentActivity.event.narrationDeleted,
  "asset.create": uiCopy.workbench.agentActivity.event.assetCreated,
  "asset.update": uiCopy.workbench.agentActivity.event.assetUpdated,
  "asset.archive": uiCopy.workbench.agentActivity.event.assetArchived,
};

export function agentActivityEventDescription(event: AgentActivityEvent, group?: AgentActivityGroup) {
  const data = record(event.projection.data);
  let description: string;
  if (event.projection.kind === "context_read") {
    description = uiCopy.workbench.agentActivity.event.contextRead;
  } else if (event.projection.kind === "composition_inspected") {
    description = uiCopy.workbench.agentActivity.event.compositionInspected;
  } else if (event.projection.kind === "images_inspected") {
    const images = Array.isArray(data?.images) ? data.images : [];
    description = uiCopy.workbench.agentActivity.event.imagesInspected(images.length);
  } else if (event.projection.kind === "proposal_created") {
    description = group?.proposal?.status === "applied" && group.proposal.acceptedSnapshotId
      ? uiCopy.workbench.agentActivity.event.formalVersionCreated
      : uiCopy.workbench.agentActivity.event.proposalCreated;
  } else if (event.projection.kind === "system_notice") {
    description = uiCopy.workbench.agentActivity.event.systemTimedOut;
  } else if (event.projection.action.endsWith(".upload_prepare")) {
    description = uiCopy.workbench.agentActivity.event.uploadPrepared;
  } else if (event.projection.action.endsWith(".image.attach")) {
    description = uiCopy.workbench.agentActivity.event.imageAttached;
  } else {
    description = eventLabels[event.projection.kind]
      ?? eventLabels[event.projection.action]
      ?? uiCopy.workbench.agentActivity.event.generic;
  }
  const target = event.projection.targets.find((item) => item.label)?.label;
  const withTarget = target
    ? uiCopy.workbench.agentActivity.event.target(description, target)
    : description;
  return event.status === "failed"
    ? `${withTarget}${uiCopy.workbench.agentActivity.event.failedSuffix}`
    : withTarget;
}

export function agentActivityEventNavigation(
  event: AgentActivityEvent,
  group: AgentActivityGroup,
): AgentActivityNavigation | undefined {
  if (
    event.projection.kind === "proposal_created"
    && group.proposal?.status === "applied"
    && group.proposal.acceptedSnapshotId
  ) {
    return { kind: "saved_snapshot", snapshotId: group.proposal.acceptedSnapshotId };
  }
  if (event.navigation) return event.navigation;
  if (event.projection.kind === "proposal_created" && group.proposal) {
    return { kind: "change_proposal", proposalId: group.proposal.id };
  }
  return undefined;
}

export function formatAgentActivityTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function mergeAgentActivityGroups(
  current: AgentActivityGroup[],
  incoming: AgentActivityGroup[],
) {
  const incomingIds = new Set(incoming.map((group) => group.id));
  return [...incoming, ...current.filter((group) => !incomingIds.has(group.id))];
}

export function appendAgentActivityGroups(
  current: AgentActivityGroup[],
  incoming: AgentActivityGroup[],
) {
  const currentIds = new Set(current.map((group) => group.id));
  return [...current, ...incoming.filter((group) => !currentIds.has(group.id))];
}

export function agentActivityPollIntervalMs(groups: AgentActivityGroup[]) {
  return groups.some((group) => group.status === "running") ? 1_000 : 10_000;
}

export function agentActivityFeedNeedsAttention(groups: AgentActivityGroup[]) {
  return groups.some((group) =>
    group.status === "running" || group.proposal?.status === "available");
}

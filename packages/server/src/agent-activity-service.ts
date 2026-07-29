import {
  AgentActivityEventStatus,
  AgentActivityObservedStatus,
  AgentActivitySourceType,
  type Prisma,
} from "@prisma/client";
import {
  agentActivityFeedSchema,
  agentActivityNavigationSchema,
  agentActivityProjectionSchema,
  type AgentActivityNavigation,
  type AgentActivityProjection,
} from "@lantern/shared";
import { prisma } from "./db";
import { AppError } from "./errors";
import { createSignedAssetPath } from "./signed-assets";

export const EXTERNAL_AGENT_ACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;

type ActivityCursor = { updatedAt: string; id: string };

function encodeCursor(cursor: ActivityCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(value: string | undefined) {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as ActivityCursor;
    if (!parsed.id || Number.isNaN(Date.parse(parsed.updatedAt))) throw new Error("invalid cursor");
    return { id: parsed.id, updatedAt: new Date(parsed.updatedAt) };
  } catch {
    throw new AppError("validation", "Agent 活动游标无效。", 400);
  }
}

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function ownedExternalDraft(ownerUserId: string, draftId: string) {
  const draft = await prisma.agentDraft.findFirst({
    where: {
      id: draftId,
      ownerUserId,
      project: { chapter: { archivedAt: null, comic: { archivedAt: null } } },
    },
    select: {
      id: true,
      projectId: true,
      baseWorkingRevision: true,
      title: true,
      sourceHost: true,
      status: true,
    },
  });
  if (!draft) throw new AppError("not_found", "Agent 工作草稿不存在。", 404);
  return draft;
}

async function ownedProject(ownerUserId: string, projectId: string) {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      ownerUserId,
      chapter: { archivedAt: null, comic: { archivedAt: null } },
    },
    select: { id: true },
  });
  if (!project) throw new AppError("not_found", "创作空间不存在。", 404);
  return project;
}

async function ensureUnboundExternalAgentActivityGroup(input: {
  ownerUserId: string;
  projectId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  await ownedProject(input.ownerUserId, input.projectId);
  const activeSince = new Date(now.getTime() - EXTERNAL_AGENT_ACTIVITY_TIMEOUT_MS);
  const expiresAt = new Date(now.getTime() + EXTERNAL_AGENT_ACTIVITY_TIMEOUT_MS);
  const existing = await prisma.agentActivityGroup.findFirst({
    where: {
      ownerUserId: input.ownerUserId,
      projectId: input.projectId,
      sourceType: AgentActivitySourceType.EXTERNAL_MCP,
      agentDraftId: null,
      observedStatus: { not: AgentActivityObservedStatus.COMPLETED },
      lastObservedAt: { gte: activeSince },
    },
    orderBy: [{ lastObservedAt: "desc" }, { id: "desc" }],
  });
  if (existing) {
    return prisma.agentActivityGroup.update({
      where: { id: existing.id },
      data: {
        observedStatus: AgentActivityObservedStatus.RUNNING,
        lastObservedAt: now,
        observedExpiresAt: expiresAt,
        completedAt: null,
      },
    });
  }
  return prisma.agentActivityGroup.create({
    data: {
      ownerUserId: input.ownerUserId,
      projectId: input.projectId,
      sourceType: AgentActivitySourceType.EXTERNAL_MCP,
      title: "外部 Agent 任务",
      observedStatus: AgentActivityObservedStatus.RUNNING,
      lastObservedAt: now,
      observedExpiresAt: expiresAt,
    },
  });
}

export async function ensureExternalAgentActivityGroup(input: {
  ownerUserId: string;
  draftId: string;
  now?: Date;
  title?: string;
}) {
  const now = input.now ?? new Date();
  const draft = await ownedExternalDraft(input.ownerUserId, input.draftId);
  const title = input.title?.trim()
    || (draft.title.trim() && draft.title !== "Agent 方案" ? draft.title.trim() : "外部 Agent 编辑");
  const expiresAt = new Date(now.getTime() + EXTERNAL_AGENT_ACTIVITY_TIMEOUT_MS);
  const existing = await prisma.agentActivityGroup.findUnique({ where: { agentDraftId: draft.id } });
  if (existing) {
    if (existing.observedStatus === AgentActivityObservedStatus.COMPLETED) return existing;
    return prisma.agentActivityGroup.update({
      where: { id: existing.id },
      data: {
        title,
        observedStatus: AgentActivityObservedStatus.RUNNING,
        lastObservedAt: now,
        observedExpiresAt: expiresAt,
        completedAt: null,
      },
    });
  }
  const activeSince = new Date(now.getTime() - EXTERNAL_AGENT_ACTIVITY_TIMEOUT_MS);
  const unbound = await prisma.agentActivityGroup.findFirst({
    where: {
      ownerUserId: input.ownerUserId,
      projectId: draft.projectId,
      sourceType: AgentActivitySourceType.EXTERNAL_MCP,
      agentDraftId: null,
      observedStatus: { not: AgentActivityObservedStatus.COMPLETED },
      lastObservedAt: { gte: activeSince },
    },
    orderBy: [{ lastObservedAt: "desc" }, { id: "desc" }],
  });
  if (unbound) {
    const claimed = await prisma.agentActivityGroup.updateMany({
      where: { id: unbound.id, agentDraftId: null },
      data: {
        agentDraftId: draft.id,
        sourceReference: `lantern://agent-drafts/${encodeURIComponent(draft.id)}`,
        title,
        observedStatus: AgentActivityObservedStatus.RUNNING,
        lastObservedAt: now,
        observedExpiresAt: expiresAt,
        completedAt: null,
      },
    });
    if (claimed.count === 1) {
      return prisma.agentActivityGroup.findUniqueOrThrow({ where: { id: unbound.id } });
    }
  }
  try {
    return await prisma.agentActivityGroup.create({
      data: {
        ownerUserId: input.ownerUserId,
        projectId: draft.projectId,
        sourceType: AgentActivitySourceType.EXTERNAL_MCP,
        sourceReference: `lantern://agent-drafts/${encodeURIComponent(draft.id)}`,
        agentDraftId: draft.id,
        title,
        observedStatus: AgentActivityObservedStatus.RUNNING,
        lastObservedAt: now,
        observedExpiresAt: expiresAt,
      },
    });
  } catch {
    const raced = await prisma.agentActivityGroup.findUnique({ where: { agentDraftId: draft.id } });
    if (!raced) throw new AppError("activity_unavailable", "无法建立 Agent 活动记录。", 503);
    return raced;
  }
}

export async function beginExternalAgentActivityEvent(input: {
  ownerUserId: string;
  draftId?: string;
  projectId?: string;
  toolName: string;
  capabilityId?: string;
  eventType: string;
  projection: AgentActivityProjection;
  navigation?: AgentActivityNavigation;
  dedupeKey?: string;
  startedAt?: Date;
}) {
  if (!input.draftId && !input.projectId) {
    throw new AppError("validation", "Agent 活动必须关联草稿或创作空间。", 400);
  }
  const group = input.draftId
    ? await ensureExternalAgentActivityGroup({
        ownerUserId: input.ownerUserId,
        draftId: input.draftId,
        now: input.startedAt,
      })
    : await ensureUnboundExternalAgentActivityGroup({
        ownerUserId: input.ownerUserId,
        projectId: input.projectId!,
        now: input.startedAt,
      });
  const parsedProjection = agentActivityProjectionSchema.parse(input.projection);
  const parsedNavigation = input.navigation
    ? agentActivityNavigationSchema.parse(input.navigation)
    : undefined;
  if (input.dedupeKey) {
    const existing = await prisma.agentActivityEvent.findUnique({
      where: { groupId_dedupeKey: { groupId: group.id, dedupeKey: input.dedupeKey } },
    });
    if (existing) return { group, event: existing };
  }
  try {
    const event = await prisma.agentActivityEvent.create({
      data: {
        groupId: group.id,
        dedupeKey: input.dedupeKey,
        capabilityId: input.capabilityId,
        toolName: input.toolName,
        eventType: input.eventType,
        observedStatus: AgentActivityEventStatus.RUNNING,
        projection: jsonInput(parsedProjection),
        navigation: parsedNavigation ? jsonInput(parsedNavigation) : undefined,
        startedAt: input.startedAt,
      },
    });
    return { group, event };
  } catch (error) {
    if (input.dedupeKey) {
      const raced = await prisma.agentActivityEvent.findUnique({
        where: { groupId_dedupeKey: { groupId: group.id, dedupeKey: input.dedupeKey } },
      });
      if (raced) return { group, event: raced };
    }
    throw error;
  }
}

export async function finishExternalAgentActivityEvent(input: {
  eventId: string;
  status: "succeeded" | "failed";
  projection?: AgentActivityProjection;
  navigation?: AgentActivityNavigation;
  externalOperationId?: string;
  completedAt?: Date;
}) {
  const completedAt = input.completedAt ?? new Date();
  const projection = input.projection
    ? agentActivityProjectionSchema.parse(input.projection)
    : undefined;
  const navigation = input.navigation
    ? agentActivityNavigationSchema.parse(input.navigation)
    : undefined;
  return prisma.agentActivityEvent.update({
    where: { id: input.eventId },
    data: {
      observedStatus: input.status === "succeeded"
        ? AgentActivityEventStatus.SUCCEEDED
        : AgentActivityEventStatus.FAILED,
      completedAt,
      ...(projection ? { projection: jsonInput(projection) } : {}),
      ...(navigation ? { navigation: jsonInput(navigation) } : {}),
      ...(input.externalOperationId ? { externalOperationId: input.externalOperationId } : {}),
    },
  });
}

export async function completeExternalAgentActivityGroup(input: {
  ownerUserId: string;
  draftId: string;
  title?: string;
  completedAt?: Date;
}) {
  const completedAt = input.completedAt ?? new Date();
  const group = await ensureExternalAgentActivityGroup({
    ownerUserId: input.ownerUserId,
    draftId: input.draftId,
    now: completedAt,
    title: input.title,
  });
  return prisma.agentActivityGroup.update({
    where: { id: group.id },
    data: {
      ...(input.title?.trim() ? { title: input.title.trim() } : {}),
      observedStatus: AgentActivityObservedStatus.COMPLETED,
      lastObservedAt: completedAt,
      observedExpiresAt: null,
      completedAt,
    },
  });
}

export async function findExternalOperationId(
  ownerUserId: string,
  idempotencyKey: string | undefined,
) {
  if (!idempotencyKey) return undefined;
  const operation = await prisma.externalAgentOperation.findUnique({
    where: { ownerUserId_idempotencyKey: { ownerUserId, idempotencyKey } },
    select: { id: true },
  });
  return operation?.id;
}

export async function findActiveExternalAgentActivityProjectId(
  ownerUserId: string,
  now = new Date(),
) {
  const groups = await prisma.agentActivityGroup.findMany({
    where: {
      ownerUserId,
      sourceType: AgentActivitySourceType.EXTERNAL_MCP,
      observedStatus: AgentActivityObservedStatus.RUNNING,
      observedExpiresAt: { gt: now },
    },
    select: { projectId: true },
    distinct: ["projectId"],
    take: 2,
    orderBy: [{ lastObservedAt: "desc" }, { id: "desc" }],
  });
  return groups.length === 1 ? groups[0]!.projectId : undefined;
}

export async function getProjectAgentActivity(
  ownerUserId: string,
  projectId: string,
  input: { cursor?: string; limit?: number; now?: Date } = {},
) {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      ownerUserId,
      chapter: { archivedAt: null, comic: { archivedAt: null } },
    },
    select: { id: true, chapter: { select: { comicId: true } } },
  });
  if (!project) throw new AppError("not_found", "创作空间不存在。", 404);
  const now = input.now ?? new Date();
  await prisma.agentActivityGroup.updateMany({
    where: {
      ownerUserId,
      projectId,
      sourceType: AgentActivitySourceType.EXTERNAL_MCP,
      observedStatus: AgentActivityObservedStatus.RUNNING,
      observedExpiresAt: { lte: now },
    },
    data: { observedStatus: AgentActivityObservedStatus.TIMED_OUT },
  });
  const cursor = decodeCursor(input.cursor);
  const limit = Math.min(50, Math.max(1, input.limit ?? 20));
  const rows = await prisma.agentActivityGroup.findMany({
    where: {
      ownerUserId,
      projectId,
      ...(cursor ? {
        OR: [
          { updatedAt: { lt: cursor.updatedAt } },
          { updatedAt: cursor.updatedAt, id: { lt: cursor.id } },
        ],
      } : {}),
    },
    include: {
      agentDraft: {
        select: {
          baseWorkingRevision: true,
          proposal: {
            select: {
              id: true,
              status: true,
              acceptedWorkingRevision: true,
              acceptedSnapshotId: true,
            },
          },
        },
      },
      _count: { select: { events: true } },
      events: { orderBy: [{ startedAt: "desc" }, { id: "desc" }], take: 100 },
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  });
  const hasMore = rows.length > limit;
  const groups = rows.slice(0, limit);
  const last = groups.at(-1);
  const parsedNavigations = groups.flatMap((group) => group.events.flatMap((event) =>
    event.navigation ? [agentActivityNavigationSchema.parse(event.navigation)] : []));
  const assetVersionIds = [...new Set(parsedNavigations.flatMap((navigation) =>
    navigation.kind === "asset_version" ? [navigation.assetVersionId] : []))];
  const activityAssetVersions = assetVersionIds.length
    ? await prisma.assetVersion.findMany({
        where: {
          id: { in: assetVersionIds },
          asset: { ownerUserId, comicId: project.chapter.comicId },
        },
        select: {
          id: true,
          objectKey: true,
          asset: { select: { name: true } },
        },
      })
    : [];
  const activityAssetVersionById = new Map(activityAssetVersions.map((version) => [version.id, version]));
  return agentActivityFeedSchema.parse({
    groups: groups.map((group) => ({
      id: group.id,
      sourceType: group.sourceType.toLowerCase(),
      ...(group.sourceReference ? { sourceReference: group.sourceReference } : {}),
      title: group.title,
      status: group.observedStatus.toLowerCase(),
      ...(group.agentDraft ? { baseWorkingRevision: group.agentDraft.baseWorkingRevision } : {}),
      startedAt: group.createdAt.toISOString(),
      updatedAt: group.updatedAt.toISOString(),
      ...(group.observedExpiresAt ? { expiresAt: group.observedExpiresAt.toISOString() } : {}),
      ...(group.completedAt ? { completedAt: group.completedAt.toISOString() } : {}),
      eventCount: group._count.events,
      ...(group.agentDraft?.proposal ? {
        proposal: {
          id: group.agentDraft.proposal.id,
          status: group.agentDraft.proposal.status.toLowerCase(),
          reviewPath: `/reviews/${group.agentDraft.proposal.id}`,
          ...(group.agentDraft.proposal.acceptedWorkingRevision
            ? { acceptedWorkingRevision: group.agentDraft.proposal.acceptedWorkingRevision }
            : {}),
          ...(group.agentDraft.proposal.acceptedSnapshotId
            ? { acceptedSnapshotId: group.agentDraft.proposal.acceptedSnapshotId }
            : {}),
        },
      } : {}),
      events: [...group.events].reverse().map((event) => ({
        id: event.id,
        ...(event.capabilityId ? { capabilityId: event.capabilityId } : {}),
        toolName: event.toolName,
        eventType: event.eventType,
        status: event.observedStatus.toLowerCase(),
        projection: agentActivityProjectionSchema.parse(event.projection),
        ...(event.navigation ? (() => {
          const navigation = agentActivityNavigationSchema.parse(event.navigation);
          if (navigation.kind !== "asset_version") return { navigation };
          const version = activityAssetVersionById.get(navigation.assetVersionId);
          return {
            navigation: {
              ...navigation,
              ...(version?.objectKey ? { contentUrl: createSignedAssetPath(version.id) } : {}),
              ...(version?.asset.name ? { label: version.asset.name } : {}),
            },
          };
        })() : {}),
        startedAt: event.startedAt.toISOString(),
        ...(event.completedAt ? { completedAt: event.completedAt.toISOString() } : {}),
      })),
    })),
    ...(hasMore && last
      ? { nextCursor: encodeCursor({ updatedAt: last.updatedAt.toISOString(), id: last.id }) }
      : {}),
    observedAt: now.toISOString(),
  });
}

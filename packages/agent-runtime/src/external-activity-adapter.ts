import type { ComicDocument } from "@lantern/shared";
import {
  type AgentActivityNavigation,
  type AgentActivityProjection,
  validateComicDocument,
} from "@lantern/shared";
import {
  beginExternalAgentActivityEvent,
  completeExternalAgentActivityGroup,
  findActiveExternalAgentActivityProjectId,
  findExternalOperationId,
  finishExternalAgentActivityEvent,
} from "@lantern/server/agent-activity-service";
import { prisma } from "@lantern/server/db";
import { AppError } from "@lantern/server/errors";
import { decodeExternalTargetHandle, type ExternalTargetHandlePayload } from "./external-target-handles";

type ActivityResultSelector<T> = (result: T) => unknown;
type ActivityProjectionSelector = (output: unknown) => unknown;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function explicitDraftId(value: unknown) {
  if (typeof value !== "string") return undefined;
  const match = /^lantern:\/\/agent-drafts\/([^/?#]+)$/.exec(value.trim());
  return match ? decodeURIComponent(match[1]!) : undefined;
}

function handlesFromInput(input: unknown) {
  const root = record(input);
  if (!root) return [];
  const values = ["targetHandles", "pageHandles"].flatMap((key) =>
    Array.isArray(root[key]) ? root[key] as unknown[] : []);
  return values.flatMap((value) => {
    if (typeof value !== "string") return [];
    try {
      return [decodeExternalTargetHandle(value)];
    } catch {
      return [];
    }
  });
}

function draftIdFromInput(input: unknown, handles: ExternalTargetHandlePayload[]) {
  const root = record(input);
  const explicit = explicitDraftId(root?.draft);
  if (explicit) return explicit;
  const draftIds = [...new Set(handles.flatMap((handle) => handle.draftId ? [handle.draftId] : []))];
  return draftIds.length === 1 ? draftIds[0] : undefined;
}

function draftIdFromOutput(output: unknown) {
  const root = record(output);
  const direct = explicitDraftId(root?.draft);
  if (direct) return direct;
  const source = record(root?.source);
  if (source?.kind === "agent_draft" && typeof source.draftId === "string") return source.draftId;
  const nested = record(root?.output);
  const nestedSource = record(nested?.source);
  if (nestedSource?.kind === "agent_draft" && typeof nestedSource.draftId === "string") {
    return nestedSource.draftId;
  }
  return explicitDraftId(nested?.draft);
}

function projectIdFromOutput(output: unknown) {
  const root = record(output);
  if (typeof root?.projectId === "string") return root.projectId;
  const nested = record(root?.output);
  return typeof nested?.projectId === "string" ? nested.projectId : undefined;
}

function startsUnboundAgentActivity(toolName: string, output: unknown) {
  const root = record(output);
  return root?.effect === "resource_mutation"
    || toolName === "lantern_context_get"
    || toolName === "lantern_composition_inspect"
    || toolName === "lantern_images_inspect";
}

function unitLabel(document: ComicDocument, unitId: string) {
  const unit = document.units.find((candidate) => candidate.id === unitId);
  if (!unit) return undefined;
  if (unit.name?.trim()) return unit.name.trim();
  if (unit.pageRole === "cover") return "封面";
  const pages = unit.surfaces
    .flatMap((surface) => typeof surface.pageNumber === "number" ? [surface.pageNumber] : [])
    .sort((left, right) => left - right);
  if (pages.length) return pages.length === 1 ? `Page ${pages[0]}` : `Page ${pages[0]}–${pages.at(-1)}`;
  const position = document.reading.unitOrder.indexOf(unitId) + 1;
  return unit.pageRole === "interlude" ? `过场页 ${position}` : `Page ${position}`;
}

function targetLabel(document: ComicDocument, target: ExternalTargetHandlePayload["target"]) {
  if (!target.pageId) return undefined;
  const page = unitLabel(document, target.pageId);
  const unit = document.units.find((candidate) => candidate.id === target.pageId);
  if (!unit) return page;
  if (target.frameId) {
    const frame = unit.frames.find((candidate) => candidate.id === target.frameId);
    const frameIndex = unit.frames.findIndex((candidate) => candidate.id === target.frameId);
    const frameLabel = frame?.name?.trim() || (frameIndex >= 0 ? `画格 ${String(frameIndex + 1).padStart(2, "0")}` : undefined);
    if (target.elementId && target.elementId !== target.frameId) {
      let elementLabel: string | undefined;
      for (const candidateFrame of unit.frames) {
        for (const layer of candidateFrame.layers) {
          const element = layer.elements.find((candidate) => candidate.id === target.elementId);
          if (element) elementLabel = element.name?.trim();
        }
      }
      if (!elementLabel) {
        for (const layer of unit.overlayLayers) {
          const element = layer.elements.find((candidate) => candidate.id === target.elementId);
          if (element) elementLabel = element.name?.trim();
        }
      }
      return [page, frameLabel, elementLabel].filter(Boolean).join(" · ");
    }
    return [page, frameLabel].filter(Boolean).join(" · ");
  }
  if (target.elementId) {
    const element = unit.overlayLayers.flatMap((layer) => layer.elements)
      .find((candidate) => candidate.id === target.elementId);
    return [page, element?.name?.trim()].filter(Boolean).join(" · ");
  }
  return page;
}

async function sourceDocument(
  ownerUserId: string,
  handles: ExternalTargetHandlePayload[],
) {
  const handle = handles[0];
  if (!handle || handles.some((candidate) => candidate.ownerUserId !== ownerUserId)) return undefined;
  if (handle.draftId) {
    const revision = await prisma.agentDraftRevision.findFirst({
      where: {
        agentDraftId: handle.draftId,
        revision: handle.baseRevision,
        agentDraft: { ownerUserId, projectId: handle.projectId },
      },
      select: { document: true },
    });
    return revision ? validateComicDocument(revision.document) : undefined;
  }
  const revision = await prisma.workingRevision.findUnique({
    where: { projectId_revision: { projectId: handle.projectId, revision: handle.baseRevision } },
    include: { project: { select: { ownerUserId: true } } },
  });
  return revision?.project.ownerUserId === ownerUserId
    ? validateComicDocument(revision.document)
    : undefined;
}

function activityKind(
  toolName: string,
  capabilityId: string | undefined,
  declaredEventType?: string,
) {
  if (declaredEventType) return declaredEventType;
  if (capabilityId === "agent_draft.finish") return "proposal_created";
  if (toolName === "lantern_context_get") return "context_read";
  if (toolName === "lantern_composition_inspect") return "composition_inspected";
  if (toolName === "lantern_images_inspect") return "images_inspected";
  return capabilityId ?? toolName.replace(/^lantern_/, "");
}

function safeResultData(
  capabilityId: string | undefined,
  output: unknown,
  activityProjection?: ActivityProjectionSelector,
) {
  if (activityProjection) return activityProjection(output);
  const root = record(output);
  if (!root) return undefined;
  if (capabilityId?.endsWith(".upload_prepare")) {
    const data = record(root.data);
    return data ? { status: data.status } : undefined;
  }
  if (capabilityId?.endsWith(".image.attach")) {
    const data = record(root.data);
    const attached = record(data?.attached);
    return attached ? {
      assetVersionId: attached.versionId,
      imageId: attached.imageId,
      replayed: attached.replayed,
    } : undefined;
  }
  if (root.effect === "direct_change") return root.data;
  if (root.capability && root.data !== undefined) {
    const data = record(root.data);
    return data ? Object.fromEntries(
      ["action", "status", "assetVersionId", "coordinateSpace", "surfaceRole", "fields", "readingPosition"]
        .flatMap((key) => data[key] === undefined ? [] : [[key, data[key]]]),
    ) : undefined;
  }
  if (typeof root.proposal === "string") {
    return {
      proposal: root.proposal,
      draftRevision: root.draftRevision,
      status: root.status,
    };
  }
  return undefined;
}

async function projectionFor(input: {
  ownerUserId: string;
  toolName: string;
  capabilityId?: string;
  eventType?: string;
  activityProjection?: ActivityProjectionSelector;
  handles: ExternalTargetHandlePayload[];
  output?: unknown;
  error?: unknown;
}) {
  const document = await sourceDocument(input.ownerUserId, input.handles).catch(() => undefined);
  const outputRoot = record(input.output);
  const outputResource = record(outputRoot?.resource);
  const outputData = record(outputRoot?.data);
  const outputDataRoot = record(outputData?.root);
  const resultData = input.error
    ? {
        errorCode: input.error instanceof AppError
          ? input.error.code
          : "internal",
      }
    : safeResultData(input.capabilityId, input.output, input.activityProjection);
  const resultRecord = record(resultData);
  const assetVersionId = typeof resultRecord?.assetVersionId === "string"
    ? resultRecord.assetVersionId
    : undefined;
  const targets = input.handles.map(({ target }) => ({
    type: target.type,
    ...(document && targetLabel(document, target) ? { label: targetLabel(document, target) } : {}),
    ...(target.pageId ? { unitId: target.pageId } : {}),
    ...(target.frameId ? { frameId: target.frameId } : {}),
    ...(target.elementId ? { elementId: target.elementId } : {}),
    ...(target.surfaceId ? { surfaceId: target.surfaceId } : {}),
    assetVersionIds: target.assetVersionIds,
  }));
  if (!targets.length && typeof outputResource?.type === "string") {
    const resourceLabel = [outputDataRoot?.label, outputDataRoot?.name, outputData?.label, outputData?.name]
      .find((value) => typeof value === "string" && value.trim()) as string | undefined;
    targets.push({
      type: outputResource.type,
      ...(resourceLabel
        ? { label: resourceLabel.trim() }
        : typeof outputResource.id === "string"
          ? { label: outputResource.id }
          : {}),
      assetVersionIds: assetVersionId ? [assetVersionId] : [],
    });
  }
  const projection: AgentActivityProjection = {
    version: 1,
    kind: activityKind(input.toolName, input.capabilityId, input.eventType),
    action: input.capabilityId ?? input.toolName,
    targets,
    ...(resultData !== undefined ? { data: resultData } : {}),
  };
  const first = targets.find((target) => target.unitId);
  const navigation: AgentActivityNavigation | undefined = first
    ? {
        kind: "workbench_target",
        projectId: input.handles[0]!.projectId,
        unitId: first.unitId!,
        ...(first.frameId ? { frameId: first.frameId } : {}),
        ...(first.elementId ? { elementId: first.elementId } : {}),
      }
    : assetVersionId
      ? { kind: "asset_version", assetVersionId }
    : undefined;
  return { projection, navigation };
}

export async function trackExternalMcpActivity<T>(input: {
  ownerUserId: string;
  toolName: string;
  capabilityId?: string;
  eventType?: string;
  startsUnbound?: boolean;
  toolInput?: unknown;
  operation: () => Promise<T> | T;
  activityOutput?: ActivityResultSelector<T>;
  activityProjection?: ActivityProjectionSelector;
}) {
  const startedAt = new Date();
  const handles = handlesFromInput(input.toolInput);
  const initialDraftId = draftIdFromInput(input.toolInput, handles);
  const idempotencyKey = typeof record(input.toolInput)?.idempotencyKey === "string"
    ? String(record(input.toolInput)!.idempotencyKey)
    : undefined;
  const dedupeKey = idempotencyKey
    ? `${input.capabilityId ?? input.toolName}:${idempotencyKey}`
    : undefined;
  let eventId: string | undefined;
  if (initialDraftId) {
    const initial = await projectionFor({
      ownerUserId: input.ownerUserId,
      toolName: input.toolName,
      capabilityId: input.capabilityId,
      eventType: input.eventType,
      activityProjection: input.activityProjection,
      handles,
    }).catch(() => undefined);
    const begun = initial && await beginExternalAgentActivityEvent({
      ownerUserId: input.ownerUserId,
      draftId: initialDraftId,
      toolName: input.toolName,
      capabilityId: input.capabilityId,
      eventType: activityKind(input.toolName, input.capabilityId, input.eventType),
      projection: initial.projection,
      navigation: initial.navigation,
      dedupeKey,
      startedAt,
    }).catch(() => undefined);
    eventId = begun?.event.id;
  }
  try {
    const result = await input.operation();
    const output = input.activityOutput ? input.activityOutput(result) : result;
    const draftId = initialDraftId ?? draftIdFromOutput(output);
    const shouldStartUnbound = !draftId && (
      input.startsUnbound
      ?? startsUnboundAgentActivity(input.toolName, output)
    );
    const projectId = draftId
      ? undefined
      : projectIdFromOutput(output)
        ?? (shouldStartUnbound
          ? await findActiveExternalAgentActivityProjectId(input.ownerUserId).catch(() => undefined)
          : undefined);
    if (draftId || (projectId && shouldStartUnbound)) {
      const completed = await projectionFor({
        ownerUserId: input.ownerUserId,
        toolName: input.toolName,
        capabilityId: input.capabilityId,
        eventType: input.eventType,
        activityProjection: input.activityProjection,
        handles,
        output,
      }).catch(() => undefined);
      if (!eventId && completed) {
        const begun = await beginExternalAgentActivityEvent({
          ownerUserId: input.ownerUserId,
          draftId,
          projectId,
          toolName: input.toolName,
          capabilityId: input.capabilityId,
          eventType: activityKind(input.toolName, input.capabilityId, input.eventType),
          projection: completed.projection,
          navigation: completed.navigation,
          dedupeKey,
          startedAt,
        }).catch(() => undefined);
        eventId = begun?.event.id;
      }
      if (eventId && completed) {
        const externalOperationId = await findExternalOperationId(
          input.ownerUserId,
          idempotencyKey,
        ).catch(() => undefined);
        await finishExternalAgentActivityEvent({
          eventId,
          status: "succeeded",
          projection: completed.projection,
          navigation: completed.navigation,
          externalOperationId,
        }).catch(() => undefined);
      }
      if (input.capabilityId === "agent_draft.finish") {
        const outputRecord = record(output);
        await completeExternalAgentActivityGroup({
          ownerUserId: input.ownerUserId,
          draftId: draftId!,
          title: typeof outputRecord?.title === "string" ? outputRecord.title : undefined,
        }).catch(() => undefined);
      }
    }
    return result;
  } catch (error) {
    if (eventId) {
      const failed = await projectionFor({
        ownerUserId: input.ownerUserId,
        toolName: input.toolName,
        capabilityId: input.capabilityId,
        eventType: input.eventType,
        activityProjection: input.activityProjection,
        handles,
        error,
      }).catch(() => undefined);
      await finishExternalAgentActivityEvent({
        eventId,
        status: "failed",
        projection: failed?.projection,
        navigation: failed?.navigation,
        externalOperationId: await findExternalOperationId(
          input.ownerUserId,
          idempotencyKey,
        ).catch(() => undefined),
      }).catch(() => undefined);
    }
    throw error;
  }
}

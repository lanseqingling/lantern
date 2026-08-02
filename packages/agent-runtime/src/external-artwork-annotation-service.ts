import { AppError } from "@lantern/server/errors";
import { executeIdempotentExternalMutation } from "@lantern/server/external-operation-service";
import {
  getArtworkAnnotation,
  listArtworkAnnotations,
  replyToArtworkAnnotations,
  startArtworkAnnotationWork,
} from "@lantern/server/artwork-annotation-service";
import { resolveResourceReference, resourceReference } from "@lantern/server/resource-reference-service";
import { loadWorkingCompositionObservation } from "./composition-observation";
import { createExternalTargetHandle, type ExternalTargetHandlePayload } from "./external-target-handles";
import { parseAgentDraftReference } from "@lantern/server/version-service";
import { assertAgentCapabilityAccess } from "./capability-registry";
import {
  artworkAnnotationCapabilities,
  artworkAnnotationCollaborationOutputSchema,
  artworkAnnotationInspectInputSchema,
  artworkAnnotationInspectOutputSchema,
  artworkAnnotationListInputSchema,
  artworkAnnotationListOutputSchema,
  artworkAnnotationReplyInputSchema,
  artworkAnnotationStartWorkInputSchema,
} from "./artwork-annotation-capabilities";
import type { ArtworkAnnotationReference } from "@lantern/shared";

export {
  artworkAnnotationInspectInputSchema,
  artworkAnnotationInspectOutputSchema,
} from "./artwork-annotation-capabilities";

function capability(id: string) {
  const found = artworkAnnotationCapabilities.find((item) => item.id === id);
  if (!found) throw new AppError("capability_not_available", "该批注能力当前没有开放。", 404);
  assertAgentCapabilityAccess(found, "external");
  return found;
}

async function resolveAnnotationIds(ownerUserId: string, references: string[]) {
  const resolved = await Promise.all([...new Set(references)].map((reference) =>
    resolveResourceReference(ownerUserId, reference, "annotation")));
  if (new Set(resolved.map((item) => item.projectId)).size !== 1) {
    throw new AppError("invalid_annotation_scope", "一次只能处理同一创作空间中的批注。", 422);
  }
  return { ids: resolved.map((item) => item.id), projectId: resolved[0]!.projectId! };
}

export function listExternalArtworkAnnotationCapabilities() {
  return [...artworkAnnotationCapabilities];
}

export async function listExternalArtworkAnnotations(ownerUserId: string, input: unknown) {
  const descriptor = capability("annotation.list");
  const parsed = artworkAnnotationListInputSchema.parse(input);
  const project = await resolveResourceReference(ownerUserId, parsed.project, "project");
  const statuses = parsed.statuses ?? ["open", "in_progress", "awaiting_review"];
  const result = await listArtworkAnnotations(ownerUserId, project.id, { statuses, limit: parsed.limit });
  return artworkAnnotationListOutputSchema.parse({
    capability: { id: descriptor.id, version: descriptor.version },
    effect: "observe",
    project: resourceReference("project", project.id).uri,
    workingRevision: result.workingRevision,
    annotations: result.annotations,
    nextActions: result.annotations.length
      ? ["Inspect each relevant annotation before editing. Use one AgentDraft for annotations that belong to the same user task."]
      : ["No annotations matched this scope and status filter."],
  });
}

function handleTargetForAnnotation(
  reference: ArtworkAnnotationReference,
  structure: Awaited<ReturnType<typeof loadWorkingCompositionObservation>>["structure"]["units"][number],
) {
  if (reference.anchor.kind !== "object") return undefined;
  const anchor = reference.anchor;
  if (anchor.objectType === "presentation_unit") {
    return {
      type: "presentation_unit",
      pageId: structure.id,
      assetVersionIds: [],
      dialogueIds: [],
    } satisfies ExternalTargetHandlePayload["target"];
  }
  if (anchor.objectType === "comic_frame") {
    const frame = structure.frames.find((candidate) => candidate.id === anchor.objectId);
    if (!frame) return undefined;
    const elements = structure.elements.filter((element) => element.frameId === frame.id);
    return {
      type: "comic_frame",
      pageId: structure.id,
      elementId: frame.id,
      frameId: frame.id,
      assetVersionIds: [...new Set(elements.flatMap((element) => [element.assetVersionId, element.appearanceAssetVersionId]
        .filter((id): id is string => Boolean(id))))].slice(0, 12),
      dialogueIds: [...new Set(elements.flatMap((element) => element.dialogueId ? [element.dialogueId] : []))].slice(0, 12),
    } satisfies ExternalTargetHandlePayload["target"];
  }
  const element = structure.elements.find((candidate) => candidate.id === anchor.objectId);
  if (!element) return undefined;
  return {
    type: anchor.objectType,
    pageId: structure.id,
    elementId: element.id,
    frameId: element.frameId,
    assetVersionIds: [element.assetVersionId, element.appearanceAssetVersionId].filter((id): id is string => Boolean(id)),
    dialogueIds: element.dialogueId ? [element.dialogueId] : [],
  } satisfies ExternalTargetHandlePayload["target"];
}

function containingFrameId(
  reference: ArtworkAnnotationReference,
  structure: Awaited<ReturnType<typeof loadWorkingCompositionObservation>>["structure"]["units"][number],
) {
  if (reference.anchor.kind === "object") {
    const anchor = reference.anchor;
    if (anchor.objectType === "comic_frame") return anchor.objectId;
    const element = structure.elements.find((candidate) => candidate.id === anchor.objectId);
    if (element?.frameId) return element.frameId;
  }
  const x = reference.resolvedUnitPoint.x * structure.canvas.width;
  const y = reference.resolvedUnitPoint.y * structure.canvas.height;
  return [...structure.frames]
    .filter((frame) => x >= frame.geometry.x && x <= frame.geometry.x + frame.geometry.width
      && y >= frame.geometry.y && y <= frame.geometry.y + frame.geometry.height)
    .sort((left, right) => right.zIndex - left.zIndex)[0]?.id;
}

export async function inspectExternalArtworkAnnotation(ownerUserId: string, input: unknown) {
  const descriptor = capability("annotation.inspect");
  const parsed = artworkAnnotationInspectInputSchema.parse(input);
  const resource = await resolveResourceReference(ownerUserId, parsed.annotation, "annotation");
  const annotation = await getArtworkAnnotation(ownerUserId, resource.id);
  const expiresAt = Date.now() + 15 * 60 * 1000;
  const createHandle = (target: ExternalTargetHandlePayload["target"]) => createExternalTargetHandle({
    ownerUserId,
    projectId: annotation.projectId,
    baseRevision: annotation.currentWorkingRevision,
    expiresAt,
    target,
  });
  const evidence = await Promise.all(annotation.references.map(async (reference) => {
    const composition = await loadWorkingCompositionObservation({
      ownerUserId,
      projectId: annotation.projectId,
      unitIds: [reference.anchor.unitId],
      expectedRevision: annotation.currentWorkingRevision,
    });
    const unit = composition.structure.units[0]!;
    const pageHandle = createHandle({
      type: "presentation_unit",
      pageId: unit.id,
      assetVersionIds: [],
      dialogueIds: [],
    });
    const target = handleTargetForAnnotation(reference, unit);
    const frameId = containingFrameId(reference, unit);
    const targetHandle = target ? createHandle(target) : undefined;
    const containingFrameHandle = frameId && !(target?.type === "comic_frame" && target.frameId === frameId)
      ? createHandle({
          type: "comic_frame",
          pageId: unit.id,
          elementId: frameId,
          frameId,
          assetVersionIds: [],
          dialogueIds: [],
        })
      : target?.type === "comic_frame" ? targetHandle : undefined;
    return {
      referenceId: reference.id,
      reference,
      pageHandle,
      ...(targetHandle ? { targetHandle } : {}),
      ...(containingFrameHandle ? { containingFrameHandle } : {}),
    };
  }));
  const attachmentHandles = annotation.attachments.map((attachment) => ({
    attachmentId: attachment.id,
    name: attachment.name,
    handle: createHandle({
      type: "asset_version",
      assetVersionIds: [attachment.versionId],
      dialogueIds: [],
    }),
  }));
  const hasMissingReference = annotation.references.some((reference) => reference.targetState === "missing");
  return artworkAnnotationInspectOutputSchema.parse({
    capability: { id: descriptor.id, version: descriptor.version },
    effect: "observe",
    type: "annotation_evidence",
    annotation,
    projectId: annotation.projectId,
    workingRevision: annotation.currentWorkingRevision,
    evidence,
    attachmentHandles,
    nextActions: hasMissingReference
      ? ["At least one referenced target is missing. Do not guess a replacement; report that specific reference conflict to the creator."]
      : annotation.references.length
        ? ["Inspect each relevant page handle before editing, then use the narrowest current-revision target handle. Refresh context after every draft mutation."]
        : attachmentHandles.length
          ? ["This annotation has no paper or element references. Inspect its attachment handles and use the creator's text without guessing a page or target."]
          : ["This is an unbound text annotation. Use the creator's words without guessing a page or target; ask for clarification when location matters."],
  });
}

export async function invokeExternalArtworkAnnotationCapability(ownerUserId: string, capabilityId: string, input: unknown) {
  if (capabilityId === "annotation.list") return listExternalArtworkAnnotations(ownerUserId, input);
  const descriptor = capability(capabilityId);
  if (capabilityId === "annotation.start_work") {
    const parsed = artworkAnnotationStartWorkInputSchema.parse(input);
    const resolved = await resolveAnnotationIds(ownerUserId, parsed.annotations);
    return executeIdempotentExternalMutation({
      ownerUserId,
      capabilityId: descriptor.id,
      capabilityVersion: descriptor.version,
      idempotencyKey: parsed.idempotencyKey,
      input: parsed,
      targetReference: parsed.draft,
      operation: async () => {
        const result = await startArtworkAnnotationWork({
          ownerUserId,
          draftId: parseAgentDraftReference(parsed.draft),
          annotationIds: resolved.ids,
          actorType: "EXTERNAL_AGENT",
        });
        return artworkAnnotationCollaborationOutputSchema.parse({
          capability: { id: descriptor.id, version: descriptor.version },
          effect: "collaboration_change",
          ...result,
          nextActions: ["Continue the requested edits in this AgentDraft. Freeze it once, after all linked annotations have been handled."],
        });
      },
    });
  }
  if (capabilityId === "annotation.reply") {
    const parsed = artworkAnnotationReplyInputSchema.parse(input);
    const resolved = await resolveAnnotationIds(ownerUserId, parsed.annotations);
    return executeIdempotentExternalMutation({
      ownerUserId,
      capabilityId: descriptor.id,
      capabilityVersion: descriptor.version,
      idempotencyKey: parsed.idempotencyKey,
      input: parsed,
      targetReference: parsed.annotations[0],
      operation: async () => {
        const result = await replyToArtworkAnnotations({
          ownerUserId,
          annotationIds: resolved.ids,
          content: parsed.content,
          authorType: "EXTERNAL_AGENT",
        });
        return artworkAnnotationCollaborationOutputSchema.parse({
          capability: { id: descriptor.id, version: descriptor.version },
          effect: "collaboration_change",
          ...result,
          nextActions: ["The creator must decide whether this annotation is resolved."],
        });
      },
    });
  }
  throw new AppError("capability_not_available", "该批注能力当前没有开放。", 404);
}

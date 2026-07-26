import { randomUUID } from "node:crypto";
import { planEditorCapability, type EditorCapabilityId } from "@lantern/editor-core";
import { getAssetFamilyDetail } from "@lantern/server/asset-library-service";
import { AppError } from "@lantern/server/errors";
import { resolveResourceReference } from "@lantern/server/resource-reference-service";
import type { ArtElement, BalloonElement, Frame, FrameLayer, PresentationUnit, TextElement, UnitOverlayLayer, WorkspaceCommand } from "@lantern/shared";
import {
  assertAgentCapabilityAccess,
  getAgentCapability,
  listAgentCapabilities,
  type AgentCapabilityDescriptor,
} from "./capability-registry";
import { isCompositionCapabilityId } from "./composition-capabilities";
import type { ExternalDirectChangeEnvelope } from "./external-edit-contract";
import {
  executeExternalDirectChange,
  type ExternalDirectChangeContext,
} from "./external-edit-service";

type ParsedCompositionInput = Record<string, unknown> & ExternalDirectChangeEnvelope;

type LocatedImage = {
  unit: PresentationUnit;
  frame: Frame;
  layer: FrameLayer;
  element: ArtElement;
  source: "frame";
} | {
  unit: PresentationUnit;
  layer: UnitOverlayLayer;
  element: ArtElement;
  source: "overlay";
};

type LocatedBalloon = {
  unit: PresentationUnit;
  frame: Frame;
  layer: FrameLayer;
  element: BalloonElement;
  source: "frame";
} | {
  unit: PresentationUnit;
  layer: UnitOverlayLayer;
  element: BalloonElement;
  source: "overlay";
};

type LocatedNarration = {
  unit: PresentationUnit;
  layer: UnitOverlayLayer;
  element: TextElement;
  source: "overlay";
};

function directChangeEnvelope(input: ParsedCompositionInput): ExternalDirectChangeEnvelope {
  return {
    scope: input.scope,
    targetHandles: input.targetHandles,
    expectedRevision: input.expectedRevision,
    idempotencyKey: input.idempotencyKey,
    ...(input.confirmedTargetHandles ? { confirmedTargetHandles: input.confirmedTargetHandles } : {}),
  };
}

function planDomainCapability(
  id: EditorCapabilityId,
  input: unknown,
  context: ExternalDirectChangeContext,
) {
  try {
    return planEditorCapability(id, input, {
      fixture: context.fixture,
      createId: (prefix) => `${prefix}-${randomUUID()}`,
      actor: "external_agent",
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      "invalid_composition_edit",
      error instanceof Error ? error.message : "页面编排不允许这次修改。",
      422,
    );
  }
}

function singleTarget(context: ExternalDirectChangeContext) {
  const target = context.targets[0]?.target;
  if (!target) throw new AppError("invalid_target_scope", "缺少明确的页面编排目标。", 422);
  return target;
}

function targetUnit(context: ExternalDirectChangeContext) {
  const target = singleTarget(context);
  if (!target.pageId) throw new AppError("invalid_target_type", "目标没有绑定页面。", 422);
  const unit = context.fixture.working.document.units.find((candidate) => candidate.id === target.pageId);
  if (!unit) throw new AppError("target_not_found", "目标页面已不存在，请重新读取上下文。", 404);
  return { target, unit };
}

function targetFrame(context: ExternalDirectChangeContext) {
  const { target, unit } = targetUnit(context);
  if (target.type !== "comic_frame" || !target.frameId) {
    throw new AppError("invalid_target_type", "该能力需要 composition inspection 返回的 comic_frame handle。", 422);
  }
  const frame = unit.frames.find((candidate) => candidate.id === target.frameId);
  if (!frame) throw new AppError("target_not_found", "目标画格已不存在，请重新读取上下文。", 404);
  return { target, unit, frame };
}

function targetImage(context: ExternalDirectChangeContext): LocatedImage {
  const { target, unit } = targetUnit(context);
  if (target.type !== "image" || !target.elementId) {
    throw new AppError("invalid_target_type", "该能力需要 composition inspection 返回的 image handle。", 422);
  }
  for (const frame of unit.frames) {
    for (const layer of frame.layers) {
      const element = layer.elements.find((candidate) => candidate.id === target.elementId);
      if (element?.kind === "image") return { unit, frame, layer, element, source: "frame" };
    }
  }
  for (const layer of unit.overlayLayers) {
    const element = layer.elements.find((candidate) => candidate.id === target.elementId);
    if (element?.kind === "image") return { unit, layer, element, source: "overlay" };
  }
  throw new AppError("target_not_found", "目标图片已不存在，请重新读取上下文。", 404);
}

function targetBalloon(context: ExternalDirectChangeContext): LocatedBalloon {
  const { target, unit } = targetUnit(context);
  if (target.type !== "speech_balloon" || !target.elementId) {
    throw new AppError("invalid_target_type", "该能力需要 composition inspection 返回的 speech_balloon handle。", 422);
  }
  for (const frame of unit.frames) {
    for (const layer of frame.layers) {
      const element = layer.elements.find((candidate) => candidate.id === target.elementId);
      if (element?.kind === "balloon") return { unit, frame, layer, element, source: "frame" };
    }
  }
  for (const layer of unit.overlayLayers) {
    const element = layer.elements.find((candidate) => candidate.id === target.elementId);
    if (element?.kind === "balloon") return { unit, layer, element, source: "overlay" };
  }
  throw new AppError("target_not_found", "目标气泡已不存在，请重新读取上下文。", 404);
}

function targetNarration(context: ExternalDirectChangeContext): LocatedNarration {
  const { target, unit } = targetUnit(context);
  if (target.type !== "text" || !target.elementId) {
    throw new AppError("invalid_target_type", "该能力需要 composition inspection 返回的 narration text handle。", 422);
  }
  for (const layer of unit.overlayLayers) {
    const element = layer.elements.find((candidate) => candidate.id === target.elementId);
    if (layer.purpose === "narration" && layer.anchor.type === "unit"
      && element?.kind === "text" && element.role === "narration") {
      return { unit, layer, element, source: "overlay" };
    }
  }
  throw new AppError("invalid_text_role", "当前只开放纸面旁白；目标不是 narration TextElement。", 422);
}

function assertGutterSafeCrossPageBalloon(
  unit: PresentationUnit,
  transform: { x: number; y: number; width: number; height: number },
  tailTarget?: { x: number; y: number },
) {
  const [left, right] = [...unit.surfaces].sort((first, second) => first.geometry.x - second.geometry.x);
  if (unit.kind !== "spread" || !left || !right) {
    throw new AppError("invalid_cross_page_balloon", "跨页气泡只能存在于真正双页。", 422);
  }
  const gutterStart = left.geometry.x + left.geometry.width;
  const gutterEnd = right.geometry.x;
  if (!(transform.x < gutterStart && transform.x + transform.width > gutterEnd)) {
    throw new AppError("invalid_cross_page_balloon", "跨页气泡必须同时覆盖左右纸面。", 422);
  }
  if (transform.x < 0 || transform.y < 0
    || transform.x + transform.width > unit.canvas.width
    || transform.y + transform.height > unit.canvas.height) {
    throw new AppError("invalid_cross_page_balloon", "跨页气泡必须完整位于真正双页画布内。", 422);
  }
  const safeInset = Math.min(32, Math.max(12, transform.width * .08));
  const centerX = transform.x + transform.width / 2;
  if (centerX >= gutterStart - safeInset && centerX <= gutterEnd + safeInset) {
    throw new AppError("invalid_cross_page_balloon", "跨页气泡的文字中心必须避开中缝安全区。", 422);
  }
  if (tailTarget && tailTarget.x >= gutterStart - safeInset && tailTarget.x <= gutterEnd + safeInset) {
    throw new AppError("invalid_cross_page_balloon", "气泡尾巴不能落在中缝安全区。", 422);
  }
}

async function fixedImage(
  context: ExternalDirectChangeContext,
  assetReference: string,
  requestedVersionId?: string,
) {
  const resolved = await resolveResourceReference(context.ownerUserId, assetReference, "asset");
  if (resolved.comicId !== context.comicId) {
    throw new AppError("invalid_asset_scope", "图片资产不属于当前漫画。", 403);
  }
  const family = await getAssetFamilyDetail(context.ownerUserId, resolved.id);
  const entries = [family.root, ...family.variants];
  const image = requestedVersionId
    ? entries.flatMap((entry) => entry.images.map((candidate) => ({ ...candidate, assetId: entry.id })))
      .find((candidate) => candidate.versionId === requestedVersionId)
    : entries.find((entry) => entry.id === resolved.id)?.images[0]
      ? { ...entries.find((entry) => entry.id === resolved.id)!.images[0]!, assetId: resolved.id }
      : family.root.images[0]
        ? { ...family.root.images[0], assetId: family.root.id }
        : undefined;
  if (!image || !image.contentType?.startsWith("image/")) {
    throw new AppError("asset_image_not_found", "资产没有可用于编排的固定图片版本。", 422);
  }
  return {
    assetId: image.assetId,
    assetVersionId: image.versionId,
    mediaType: image.contentType,
    width: image.width,
    height: image.height,
  };
}

function locatedElementInput(located: LocatedImage | LocatedBalloon | LocatedNarration) {
  return {
    unitId: located.unit.id,
    ...(located.source === "frame" ? { frameId: located.frame.id } : {}),
    layerId: located.layer.id,
    elementId: located.element.id,
  };
}

function frameCreatePlan(parsed: ParsedCompositionInput, context: ExternalDirectChangeContext) {
  const { target, unit } = targetUnit(context);
  const geometry = parsed.geometry as { x: number; y: number; width: number; height: number };
  if (target.type === "page_surface") {
    const surface = unit.surfaces.find((candidate) => candidate.id === target.surfaceId);
    if (!surface) throw new AppError("target_not_found", "目标纸面已不存在，请重新读取上下文。", 404);
    if (geometry.x < surface.geometry.x || geometry.y < surface.geometry.y
      || geometry.x + geometry.width > surface.geometry.x + surface.geometry.width
      || geometry.y + geometry.height > surface.geometry.y + surface.geometry.height) {
      throw new AppError("invalid_frame_geometry", "新画格必须完整位于目标纸面内。", 422);
    }
  }
  const plan = planDomainCapability("create_frame", {
    unitId: unit.id,
    geometry,
    ...(typeof parsed.name === "string" ? { name: parsed.name } : {}),
    ...(typeof parsed.readingPosition === "number" ? { readingIndex: parsed.readingPosition - 1 } : {}),
    allowOverlap: parsed.allowOverlap,
  }, context);
  const created = plan.commands.find((command) => command.type === "add_frame");
  if (!created || created.type !== "add_frame") {
    throw new AppError("capability_contract_error", "画格创建能力没有返回新画格。", 500);
  }
  return {
    commands: plan.commands,
    data: {
      action: "created",
      frame: {
        name: created.frame.name ?? null,
        geometry: created.frame.geometry,
        zIndex: created.frame.zIndex,
        readingPosition: (created.readingIndex ?? unit.readingSequence.length) + 1,
      },
    },
  };
}

function frameUpdatePlan(parsed: ParsedCompositionInput, context: ExternalDirectChangeContext) {
  const { unit, frame } = targetFrame(context);
  const commands: WorkspaceCommand[] = [];
  if (typeof parsed.allowOverlap === "boolean" && !parsed.geometry) {
    commands.push(...planDomainCapability("set_frame_overlap_policy", {
      unitId: unit.id,
      frameOverlap: parsed.allowOverlap ? "allow" : "forbid",
    }, context).commands);
  }
  if (parsed.geometry && parsed.shape) {
    commands.push(...planDomainCapability("reshape_frame", {
      unitId: unit.id,
      frameId: frame.id,
      geometry: parsed.geometry,
      shape: parsed.shape,
      allowOverlap: parsed.allowOverlap,
    }, context).commands);
  } else if (parsed.geometry) {
    commands.push(...planDomainCapability("resize_frame", {
      unitId: unit.id,
      frameId: frame.id,
      geometry: parsed.geometry,
      allowOverlap: parsed.allowOverlap,
    }, context).commands);
  } else if (parsed.shape) {
    commands.push(...planDomainCapability("reshape_frame", {
      unitId: unit.id,
      frameId: frame.id,
      geometry: frame.geometry,
      shape: parsed.shape,
    }, context).commands);
  }
  if (typeof parsed.borderWidth === "number") {
    commands.push(...planDomainCapability("update_frame_border", {
      unitId: unit.id,
      frameId: frame.id,
      width: parsed.borderWidth,
    }, context).commands);
  }
  if (parsed.bleed) {
    commands.push(...planDomainCapability("update_frame_bleed", {
      unitId: unit.id,
      frameId: frame.id,
      ...(parsed.bleed as { edge: string; enabled: boolean }),
    }, context).commands);
  }
  if (typeof parsed.zIndex === "number") {
    commands.push(...planDomainCapability("reorder_frame", {
      unitId: unit.id,
      frameId: frame.id,
      zIndex: parsed.zIndex,
    }, context).commands);
  }
  if (typeof parsed.readingPosition === "number") {
    commands.push(...planDomainCapability("reorder_frame_reading", {
      unitId: unit.id,
      frameId: frame.id,
      readingIndex: parsed.readingPosition - 1,
    }, context).commands);
  }
  return {
    commands,
    data: { action: "updated", fields: Object.keys(parsed).filter((key) => !["scope", "targetHandles", "expectedRevision", "idempotencyKey"].includes(key)) },
  };
}

function frameSingleActionPlan(
  capabilityId: "frame.duplicate" | "frame.delete",
  context: ExternalDirectChangeContext,
) {
  const { unit, frame } = targetFrame(context);
  const editorCapability = capabilityId === "frame.duplicate" ? "duplicate_frame" : "delete_frame";
  const plan = planDomainCapability(editorCapability, { unitId: unit.id, frameId: frame.id }, context);
  const created = plan.commands.find((command) => command.type === "add_frame");
  return {
    commands: plan.commands,
    data: capabilityId === "frame.duplicate"
      ? { action: "duplicated", geometry: created?.type === "add_frame" ? created.frame.geometry : undefined }
      : { action: "deleted" },
  };
}

async function imagePlacePlan(parsed: ParsedCompositionInput, context: ExternalDirectChangeContext) {
  const { target, unit } = targetUnit(context);
  const image = await fixedImage(context, String(parsed.asset), parsed.assetVersionId as string | undefined);
  const commands: WorkspaceCommand[] = [];
  if (target.type === "comic_frame") {
    const frame = unit.frames.find((candidate) => candidate.id === target.frameId);
    if (!frame) throw new AppError("target_not_found", "目标画格已不存在，请重新读取上下文。", 404);
    const placed = planDomainCapability("place_frame_image", {
      unitId: unit.id,
      frameId: frame.id,
      ...image,
      ...(parsed.transform ? { transform: parsed.transform } : {}),
      ...(parsed.crop ? { crop: parsed.crop } : {}),
    }, context);
    commands.push(...placed.commands);
    const added = placed.commands.find((command) => command.type === "add_layer_element" && command.element.kind === "image");
    if (!added || added.type !== "add_layer_element") throw new AppError("capability_contract_error", "格内图片能力没有返回图片元素。", 500);
    return {
      commands,
      data: { action: "placed_in_frame", assetVersionId: image.assetVersionId },
    };
  }
  const surface = target.type === "page_surface"
    ? unit.surfaces.find((candidate) => candidate.id === target.surfaceId)
    : unit.surfaces[0];
  if (!surface) throw new AppError("target_not_found", "目标纸面已不存在，请重新读取上下文。", 404);
  const placed = planDomainCapability("create_page_image", {
    unitId: unit.id,
    surfaceId: surface.id,
    ...(parsed.transform ? { geometry: parsed.transform } : {
      position: {
        x: surface.geometry.x + surface.geometry.width / 2,
        y: surface.geometry.y + surface.geometry.height / 2,
      },
    }),
    ...(parsed.crop ? { crop: parsed.crop } : {}),
    ...image,
  }, context);
  commands.push(...placed.commands);
  const added = placed.commands.find((command) => command.type === "add_overlay_element" && command.element.kind === "image");
  if (!added || added.type !== "add_overlay_element") throw new AppError("capability_contract_error", "纸面图片能力没有返回图片元素。", 500);
  return {
    commands,
    data: { action: "placed_on_page", assetVersionId: image.assetVersionId, surfaceRole: surface.role },
  };
}

async function imageUpdatePlan(parsed: ParsedCompositionInput, context: ExternalDirectChangeContext) {
  const located = targetImage(context);
  const base = locatedElementInput(located);
  if (parsed.placement === "breakout") {
    if (located.source !== "frame") throw new AppError("invalid_image_placement", "只有格内图片可以转换为 frame-anchored 破格覆盖。", 422);
    const plan = planDomainCapability("promote_element_to_overlay", base, context);
    return { commands: plan.commands, data: { action: "promoted_to_breakout", coordinateSpace: "frame_local" } };
  }
  if (parsed.placement === "page") {
    if (located.source === "overlay" && located.layer.anchor.type === "unit") {
      throw new AppError("invalid_image_placement", "图片已经是纸面图片。", 422);
    }
    const plan = planDomainCapability("convert_element_to_page", base, context);
    return { commands: plan.commands, data: { action: "converted_to_page", coordinateSpace: "unit" } };
  }
  const commands: WorkspaceCommand[] = [];
  if (parsed.asset) {
    const image = await fixedImage(context, String(parsed.asset), parsed.assetVersionId as string | undefined);
    commands.push(...planDomainCapability("replace_image", { ...base, ...image }, context).commands);
  }
  if (parsed.transform) {
    commands.push(...planDomainCapability("set_element_transform", {
      ...base,
      transform: parsed.transform,
    }, context).commands);
  }
  if (parsed.crop) {
    commands.push(...planDomainCapability("set_art_crop", {
      ...base,
      crop: parsed.crop,
    }, context).commands);
  }
  if (parsed.zOrder) {
    if (located.source !== "overlay") {
      throw new AppError("invalid_image_layer", "格内图片随画格层级显示；只有纸面或破格覆盖图片可独立调整前后层级。", 422);
    }
    commands.push(...planDomainCapability("reorder_overlay_element", {
      unitId: located.unit.id,
      layerId: located.layer.id,
      elementId: located.element.id,
      position: parsed.zOrder,
    }, context).commands);
  }
  return {
    commands,
    data: {
      action: "updated",
      coordinateSpace: located.source === "frame" || located.layer.anchor.type === "frame" ? "frame_local" : "unit",
      assetVersionId: parsed.assetVersionId ?? located.element.assetVersionId,
    },
  };
}

function imageRemovePlan(context: ExternalDirectChangeContext) {
  const located = targetImage(context);
  const plan = planDomainCapability("remove_frame_image", locatedElementInput(located), context);
  return { commands: plan.commands, data: { action: "removed", assetVersionId: located.element.assetVersionId } };
}

function balloonCreatePlan(parsed: ParsedCompositionInput, context: ExternalDirectChangeContext) {
  const { target, unit } = targetUnit(context);
  const position = parsed.position as { x: number; y: number };
  if (target.type === "comic_frame" && target.frameId) {
    const plan = planDomainCapability("create_dialogue_balloon", {
      unitId: unit.id,
      frameId: target.frameId,
      position,
      content: parsed.content,
    }, context);
    return { commands: plan.commands, data: { action: "created", coordinateSpace: "frame_local" } };
  }
  const surface = target.type === "page_surface"
    ? unit.surfaces.find((candidate) => candidate.id === target.surfaceId)
    : unit.surfaces.find((candidate) =>
        position.x >= candidate.geometry.x && position.x <= candidate.geometry.x + candidate.geometry.width
        && position.y >= candidate.geometry.y && position.y <= candidate.geometry.y + candidate.geometry.height);
  if (!surface) throw new AppError("invalid_balloon_position", "纸面气泡位置必须位于一个明确 PageSurface 内。", 422);
  const plan = planDomainCapability("create_page_dialogue_balloon", {
    unitId: unit.id,
    surfaceId: surface.id,
    position,
    content: parsed.content,
  }, context);
  return { commands: plan.commands, data: { action: "created", coordinateSpace: "unit", surfaceRole: surface.role } };
}

function balloonUpdatePlan(parsed: ParsedCompositionInput, context: ExternalDirectChangeContext) {
  const located = targetBalloon(context);
  const base = locatedElementInput(located);
  if (parsed.placement === "breakout") {
    if (located.source !== "frame") throw new AppError("invalid_balloon_placement", "只有格内气泡可以转换为 frame-anchored 破格气泡。", 422);
    const plan = planDomainCapability("promote_element_to_overlay", base, context);
    return { commands: plan.commands, data: { action: "promoted_to_breakout", coordinateSpace: "frame_local" } };
  }
  if (parsed.placement === "page") {
    if (located.source === "overlay" && located.layer.anchor.type === "unit" && located.layer.purpose !== "cross_page") {
      throw new AppError("invalid_balloon_placement", "气泡已经是纸面对象。", 422);
    }
    const plan = planDomainCapability("convert_element_to_page", base, context);
    return { commands: plan.commands, data: { action: "converted_to_page", coordinateSpace: "unit" } };
  }
  if (parsed.placement === "cross_page") {
    assertGutterSafeCrossPageBalloon(
      located.unit,
      parsed.transform as { x: number; y: number; width: number; height: number },
      parsed.tailTarget as { x: number; y: number } | undefined,
    );
    const plan = planDomainCapability("convert_balloon_to_cross_page", {
      ...base,
      transform: parsed.transform,
      ...(parsed.tailTarget ? { tailTarget: parsed.tailTarget } : {}),
    }, context);
    return { commands: plan.commands, data: { action: "converted_to_cross_page", coordinateSpace: "unit", gutterSafe: true } };
  }
  const commands: WorkspaceCommand[] = [];
  if (located.source === "overlay" && located.layer.purpose === "cross_page" && (parsed.transform || parsed.tailTarget)) {
    assertGutterSafeCrossPageBalloon(
      located.unit,
      (parsed.transform ?? located.element.transform) as { x: number; y: number; width: number; height: number },
      (parsed.tailTarget ?? located.element.tailTarget) as { x: number; y: number } | undefined,
    );
  }
  if (typeof parsed.content === "string") {
    commands.push(...planDomainCapability("update_dialogue", {
      dialogueId: located.element.dialogueId,
      content: parsed.content,
    }, context).commands);
  }
  const balloonChanges: Record<string, unknown> = {};
  if (parsed.transform) balloonChanges.transform = parsed.transform;
  if (parsed.tailTarget) balloonChanges.tailTarget = parsed.tailTarget;
  if (parsed.shape) balloonChanges.shape = parsed.shape;
  if (parsed.style) balloonChanges.style = { ...located.element.style, ...(parsed.style as object) };
  if (Object.keys(balloonChanges).length) {
    commands.push(...planDomainCapability("update_balloon", {
      ...base,
      changes: balloonChanges,
    }, context).commands);
  }
  if (parsed.zOrder) {
    if (located.source !== "overlay") {
      throw new AppError("invalid_balloon_layer", "格内气泡随画格显示；只有纸面、破格或跨页气泡可独立调整前后层级。", 422);
    }
    commands.push(...planDomainCapability("reorder_overlay_element", {
      unitId: located.unit.id,
      layerId: located.layer.id,
      elementId: located.element.id,
      position: parsed.zOrder,
    }, context).commands);
  }
  return {
    commands,
    data: {
      action: "updated",
      dialogueId: located.element.dialogueId,
      coordinateSpace: located.source === "frame" || located.layer.anchor.type === "frame" ? "frame_local" : "unit",
    },
  };
}

function balloonSingleActionPlan(capabilityId: "balloon.duplicate" | "balloon.delete", context: ExternalDirectChangeContext) {
  const located = targetBalloon(context);
  const plan = planDomainCapability(
    capabilityId === "balloon.duplicate" ? "duplicate_dialogue_balloon" : "delete_dialogue_balloon",
    locatedElementInput(located),
    context,
  );
  return {
    commands: plan.commands,
    data: capabilityId === "balloon.duplicate"
      ? { action: "duplicated", dialogueCopied: true }
      : { action: "deleted" },
  };
}

function narrationCreatePlan(parsed: ParsedCompositionInput, context: ExternalDirectChangeContext) {
  const { target, unit } = targetUnit(context);
  const position = parsed.position as { x: number; y: number };
  const surface = target.type === "page_surface"
    ? unit.surfaces.find((candidate) => candidate.id === target.surfaceId)
    : unit.surfaces.find((candidate) =>
        position.x >= candidate.geometry.x && position.x <= candidate.geometry.x + candidate.geometry.width
        && position.y >= candidate.geometry.y && position.y <= candidate.geometry.y + candidate.geometry.height);
  if (!surface) throw new AppError("invalid_narration_position", "旁白位置必须位于一个明确 PageSurface 内。", 422);
  const plan = planDomainCapability("create_narration", {
    unitId: unit.id,
    surfaceId: surface.id,
    position,
    content: parsed.content,
  }, context);
  return { commands: plan.commands, data: { action: "created", coordinateSpace: "unit", surfaceRole: surface.role } };
}

function narrationUpdatePlan(parsed: ParsedCompositionInput, context: ExternalDirectChangeContext) {
  const located = targetNarration(context);
  const base = locatedElementInput(located);
  const commands: WorkspaceCommand[] = [];
  const changes = Object.fromEntries([
    "content", "fontFamily", "fontSize", "fontWeight", "color", "stroke", "strokeWidth", "align", "writingMode",
  ].flatMap((key) => parsed[key] === undefined ? [] : [[key, parsed[key]]]));
  if (Object.keys(changes).length) {
    commands.push(...planDomainCapability("update_narration", { ...base, changes }, context).commands);
  }
  if (parsed.transform) {
    commands.push(...planDomainCapability("set_element_transform", {
      ...base,
      transform: parsed.transform,
    }, context).commands);
  }
  if (parsed.zOrder) {
    commands.push(...planDomainCapability("reorder_overlay_element", {
      unitId: located.unit.id,
      layerId: located.layer.id,
      elementId: located.element.id,
      position: parsed.zOrder,
    }, context).commands);
  }
  return { commands, data: { action: "updated", coordinateSpace: "unit" } };
}

function narrationSingleActionPlan(capabilityId: "narration.duplicate" | "narration.delete", context: ExternalDirectChangeContext) {
  const located = targetNarration(context);
  const plan = planDomainCapability(
    capabilityId === "narration.duplicate" ? "duplicate_narration" : "delete_narration",
    locatedElementInput(located),
    context,
  );
  return { commands: plan.commands, data: { action: capabilityId === "narration.duplicate" ? "duplicated" : "deleted" } };
}

async function compositionPlan(
  capability: AgentCapabilityDescriptor,
  parsed: ParsedCompositionInput,
  context: ExternalDirectChangeContext,
) {
  if (capability.id === "frame.create") return frameCreatePlan(parsed, context);
  if (capability.id === "frame.update") return frameUpdatePlan(parsed, context);
  if (capability.id === "frame.duplicate" || capability.id === "frame.delete") {
    return frameSingleActionPlan(capability.id, context);
  }
  if (capability.id === "image.place") return imagePlacePlan(parsed, context);
  if (capability.id === "image.update") return imageUpdatePlan(parsed, context);
  if (capability.id === "image.remove") return imageRemovePlan(context);
  if (capability.id === "balloon.create") return balloonCreatePlan(parsed, context);
  if (capability.id === "balloon.update") return balloonUpdatePlan(parsed, context);
  if (capability.id === "balloon.duplicate" || capability.id === "balloon.delete") return balloonSingleActionPlan(capability.id, context);
  if (capability.id === "narration.create") return narrationCreatePlan(parsed, context);
  if (capability.id === "narration.update") return narrationUpdatePlan(parsed, context);
  if (capability.id === "narration.duplicate" || capability.id === "narration.delete") return narrationSingleActionPlan(capability.id, context);
  throw new AppError("capability_not_available", "该页面编排能力当前没有同步执行器。", 404);
}

export function listExternalCompositionCapabilities() {
  return listAgentCapabilities().filter((capability) =>
    capability.execution === "synchronous"
    && capability.agentAccess.external !== "disabled"
    && isCompositionCapabilityId(capability.id));
}

export async function invokeExternalCompositionCapability(
  ownerUserId: string,
  capabilityId: string,
  input: unknown,
) {
  const capability = getAgentCapability(capabilityId);
  if (!capability || capability.execution !== "synchronous" || !isCompositionCapabilityId(capability.id)) {
    throw new AppError("capability_not_available", "该 Lantern 页面编排能力当前未向外置 Agent 开放。", 404);
  }
  assertAgentCapabilityAccess(capability, "external");
  const parsed = capability.inputSchema.parse(input) as ParsedCompositionInput;
  return executeExternalDirectChange({
    ownerUserId,
    capability,
    envelope: directChangeEnvelope(parsed),
    plan: (context) => compositionPlan(capability, parsed, context),
  });
}

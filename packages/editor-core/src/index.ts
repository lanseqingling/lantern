import type {
  FrameElement,
  FrameLayer,
  SnapshotEnvelope,
  WorkbenchFixture,
  WorkingEnvelope,
  WorkspaceChangeSet,
  WorkspaceCommand,
} from "../../shared/src";
import { changeSetCommands, normalizeStoryboardBeats, validateComicDocument, workspaceChangeSetSchema } from "../../shared/src";
import { planEditorCapability, type EditorCapabilityContext, type EditorCapabilityId } from "./capabilities";

export * from "./capabilities";

export type ApplyChangeResult = Pick<WorkbenchFixture, "working" | "storyboardBeats">;

export function applyWorkspaceChangeSet(
  fixture: Pick<WorkbenchFixture, "working" | "storyboardBeats">,
  changeSet: WorkspaceChangeSet,
): ApplyChangeResult {
  if (changeSet.baseRevision !== fixture.working.revision) {
    throw new Error(`REVISION_CONFLICT:${changeSet.baseRevision}:${fixture.working.revision}`);
  }
  const parsedChangeSet = workspaceChangeSetSchema.parse(changeSet) as WorkspaceChangeSet;
  if (parsedChangeSet.source === "candidate" && !parsedChangeSet.sourceCandidateId) {
    throw new Error("candidate ChangeSet requires sourceCandidateId");
  }

  const document = structuredClone(fixture.working.document);
  const storyboardBeats = normalizeStoryboardBeats(fixture.storyboardBeats);

  const findUnit = (unitId: string) => {
    const unit = document.units.find((item) => item.id === unitId);
    if (!unit) throw new Error(`missing PresentationUnit: ${unitId}`);
    return unit;
  };
  const findFrame = (unitId: string, frameId: string) => {
    const unit = findUnit(unitId);
    const frame = unit.frames.find((item) => item.id === frameId);
    if (!frame) throw new Error(`missing Frame: ${frameId}`);
    return { unit, frame };
  };
  const findLayer = (unitId: string, frameId: string, layerId: string) => {
    const { unit, frame } = findFrame(unitId, frameId);
    const layer = frame.layers.find((item) => item.id === layerId);
    if (!layer) throw new Error(`missing FrameLayer: ${layerId}`);
    return { unit, frame, layer };
  };

  for (const operation of changeSetCommands(parsedChangeSet)) {
    if (operation.type === "replace_storyboard_beats") {
      storyboardBeats.splice(0, storyboardBeats.length, ...structuredClone(operation.storyboardBeats));
      continue;
    }
    if (operation.type === "declare_resource") {
      const existing = document.resources.find((resource) => resource.assetVersionId === operation.resource.assetVersionId);
      if (existing && existing.assetId !== operation.resource.assetId) throw new Error(`resource version belongs to another asset: ${operation.resource.assetVersionId}`);
      if (!existing) document.resources.push(structuredClone(operation.resource));
      continue;
    }
    if (operation.type === "add_dialogue") {
      if (document.dialogues.some((dialogue) => dialogue.id === operation.dialogue.id)) throw new Error(`duplicate Dialogue id: ${operation.dialogue.id}`);
      document.dialogues.push(structuredClone(operation.dialogue));
      continue;
    }
    if (operation.type === "remove_dialogue") {
      const referenced = document.units.some((unit) => [
        ...unit.frames.flatMap((frame) => frame.layers.flatMap((layer) => [...layer.elements] as FrameElement[])),
        ...unit.overlayLayers.flatMap((layer) => layer.elements),
      ].some((element) => element.kind === "balloon" && element.dialogueId === operation.dialogueId));
      if (referenced) throw new Error(`Dialogue is still referenced: ${operation.dialogueId}`);
      document.dialogues = document.dialogues.filter((dialogue) => dialogue.id !== operation.dialogueId);
      continue;
    }
    if (operation.type === "create_frame_storyboard_beat") {
      if (storyboardBeats.some((item) => item.id === operation.storyboardBeat.id)) {
        throw new Error(`duplicate StoryboardBeat id: ${operation.storyboardBeat.id}`);
      }
      const { frame } = findFrame(operation.unitId, operation.frameId);
      if (frame.storyRefs.some((reference) => reference.role === "primary")) {
        throw new Error(`Frame already has a primary StoryboardBeat: ${operation.frameId}`);
      }
      const storyboardBeat = structuredClone(operation.storyboardBeat);
      storyboardBeats.push(storyboardBeat);
      frame.storyRefs = [
        ...frame.storyRefs.filter((reference) => reference.role !== "primary"),
        { storyboardBeatId: storyboardBeat.id, storyboardBeatVersionId: storyboardBeat.versionId, role: "primary" },
      ];
      continue;
    }
    if (operation.type === "replace_chapter_presentation") {
      Object.assign(document, structuredClone(operation.document));
      continue;
    }
    if (operation.type === "replace_chapter_layout") {
      const proposed = structuredClone(operation.document);
      const existingFrames = new Map(document.units.flatMap((unit) => unit.frames).map((frame) => [frame.id, frame]));
      proposed.units.forEach((unit) => unit.frames.forEach((frame) => {
        const existing = existingFrames.get(frame.id);
        if (existing) {
          frame.layers = structuredClone(existing.layers);
          frame.storyRefs = structuredClone(existing.storyRefs);
        }
      }));
      proposed.resources = Array.from(new Map([...document.resources, ...proposed.resources].map((resource) => [resource.assetVersionId, resource])).values());
      proposed.dialogues = Array.from(new Map([...proposed.dialogues, ...document.dialogues].map((dialogue) => [dialogue.id, dialogue])).values());
      Object.assign(document, proposed);
      continue;
    }
    if (operation.type === "add_presentation_unit") {
      if (document.units.some((unit) => unit.id === operation.unit.id)) throw new Error(`duplicate PresentationUnit id: ${operation.unit.id}`);
      document.units.push(structuredClone(operation.unit));
      const index = Math.max(0, Math.min(operation.readingIndex ?? document.reading.unitOrder.length, document.reading.unitOrder.length));
      document.reading.unitOrder.splice(index, 0, operation.unit.id);
      continue;
    }
    if (operation.type === "set_presentation_unit_name") {
      const unit = findUnit(operation.unitId);
      if (operation.name === null) delete unit.name;
      else unit.name = operation.name;
      continue;
    }
    if (operation.type === "resize_vertical_segment") {
      const unit = findUnit(operation.unitId);
      if (unit.kind !== "vertical_segment") throw new Error("resize_vertical_segment requires a vertical segment");
      if (unit.frames.some((frame) => frame.geometry.y + frame.geometry.height > operation.canvasHeight)) {
        throw new Error("页面下方空间不足，现有画格会被裁切，无法应用该比例");
      }
      unit.canvas.height = operation.canvasHeight;
      unit.surfaces = unit.surfaces.map((surface) => ({
        ...surface,
        geometry: { x: 0, y: 0, width: unit.canvas.width, height: operation.canvasHeight },
      }));
      continue;
    }
    if (operation.type === "remove_presentation_unit") {
      if (document.units.length <= 1) throw new Error("漫画至少需要保留一个页面");
      findUnit(operation.unitId);
      document.units = document.units.filter((unit) => unit.id !== operation.unitId);
      document.reading.unitOrder = document.reading.unitOrder.filter((unitId) => unitId !== operation.unitId);
      document.reading.unitOrder.forEach((unitId, index) => {
        const unit = document.units.find((item) => item.id === unitId);
        if (unit?.surfaces.length === 1) unit.surfaces[0].pageNumber = index + 1;
      });
      continue;
    }
    if (operation.type === "update_storyboard_beat") {
      const storyboardBeat = storyboardBeats.find((item) => item.id === operation.storyboardBeatId);
      if (!storyboardBeat) throw new Error(`missing StoryboardBeat: ${operation.storyboardBeatId}`);
      Object.assign(storyboardBeat, operation.patch, { versionId: `${storyboardBeat.id}-v${fixture.working.revision + 1}` });
      document.units.forEach((unit) => unit.frames.forEach((frame) => {
        frame.storyRefs = frame.storyRefs.map((reference) => reference.storyboardBeatId === storyboardBeat.id
          ? { ...reference, storyboardBeatVersionId: storyboardBeat.versionId }
          : reference);
      }));
      continue;
    }
    if (operation.type === "update_dialogue") {
      const dialogue = document.dialogues.find((item) => item.id === operation.dialogueId);
      if (!dialogue) throw new Error(`missing Dialogue: ${operation.dialogueId}`);
      dialogue.content = operation.content;
      continue;
    }
    if (operation.type === "move_frame") {
      const { frame } = findFrame(operation.unitId, operation.frameId);
      frame.geometry = { ...frame.geometry, ...operation.position };
      continue;
    }
    if (operation.type === "resize_frame") {
      findFrame(operation.unitId, operation.frameId).frame.geometry = structuredClone(operation.geometry);
      continue;
    }
    if (operation.type === "reorder_frame") {
      findFrame(operation.unitId, operation.frameId).frame.zIndex = operation.zIndex;
      continue;
    }
    if (operation.type === "set_frame_style") {
      const { frame } = findFrame(operation.unitId, operation.frameId);
      if (operation.border) frame.border = structuredClone(operation.border);
      if (operation.shape) frame.shape = structuredClone(operation.shape);
      if (operation.mask) frame.mask = structuredClone(operation.mask);
      continue;
    }
    if (operation.type === "replace_presentation_layout") {
      const unit = findUnit(operation.unitId);
      const currentIds = unit.frames.map((frame) => frame.id).sort();
      const expectedIds = [...operation.expectedFrameIds].sort();
      if (currentIds.join("\0") !== expectedIds.join("\0")) throw new Error("LAYOUT_FRAME_SET_CONFLICT");
      const byId = new Map(unit.frames.map((frame) => [frame.id, frame]));
      unit.frames = operation.layout.frames.map((layoutFrame) => {
        const current = byId.get(layoutFrame.id);
        if (!current) throw new Error(`missing Frame: ${layoutFrame.id}`);
        return { ...current, ...structuredClone(layoutFrame), layers: current.layers, storyRefs: current.storyRefs };
      });
      if (operation.layout.canvas) unit.canvas = structuredClone(operation.layout.canvas);
      if (operation.layout.surfaces) unit.surfaces = structuredClone(operation.layout.surfaces);
      if (operation.layout.layoutPolicy) unit.layoutPolicy = structuredClone(operation.layout.layoutPolicy);
      unit.readingSequence = structuredClone(operation.layout.readingSequence);
      continue;
    }
    if (operation.type === "add_frame") {
      const unit = findUnit(operation.unitId);
      if (unit.frames.some((frame) => frame.id === operation.frame.id)) throw new Error(`duplicate Frame id: ${operation.frame.id}`);
      unit.frames.push(structuredClone(operation.frame));
      const index = Math.max(0, Math.min(operation.readingIndex ?? unit.readingSequence.length, unit.readingSequence.length));
      unit.readingSequence.splice(index, 0, { frameId: operation.frame.id });
      continue;
    }
    if (operation.type === "remove_frame") {
      const unit = findUnit(operation.unitId);
      unit.frames = unit.frames.filter((frame) => frame.id !== operation.frameId);
      unit.readingSequence = unit.readingSequence.filter((entry) => entry.frameId !== operation.frameId);
      unit.overlayLayers = unit.overlayLayers.filter((layer) => !(layer.anchor.type === "frame" && layer.anchor.frameId === operation.frameId));
      continue;
    }
    if (operation.type === "set_art_crop") {
      const { layer } = findLayer(operation.unitId, operation.frameId, operation.layerId);
      const element = layer.elements.find((item) => item.id === operation.elementId);
      if (!element || element.kind !== "image") throw new Error(`missing ArtElement: ${operation.elementId}`);
      element.crop = structuredClone(operation.crop);
      continue;
    }
    if (operation.type === "set_element_transform") {
      if (operation.frameId) {
        const { layer } = findLayer(operation.unitId, operation.frameId, operation.layerId);
        const element = layer.elements.find((item) => item.id === operation.elementId);
        if (!element) throw new Error(`missing FrameElement: ${operation.elementId}`);
        element.transform = structuredClone(operation.transform);
      } else {
        const unit = findUnit(operation.unitId);
        const layer = unit.overlayLayers.find((item) => item.id === operation.layerId);
        const element = layer?.elements.find((item) => item.id === operation.elementId);
        if (!element) throw new Error(`missing OverlayElement: ${operation.elementId}`);
        element.transform = structuredClone(operation.transform);
      }
      continue;
    }
    if (operation.type === "set_element_appearance") {
      if (operation.frameId) {
        const { layer } = findLayer(operation.unitId, operation.frameId, operation.layerId);
        const element = layer.elements.find((item) => item.id === operation.elementId);
        if (!element || (element.kind !== "text" && element.kind !== "balloon")) throw new Error(`missing visual TextElement or BalloonElement: ${operation.elementId}`);
        if (operation.appearance) element.appearance = structuredClone(operation.appearance);
        else delete element.appearance;
      } else {
        const unit = findUnit(operation.unitId);
        const layer = unit.overlayLayers.find((item) => item.id === operation.layerId);
        const element = layer?.elements.find((item) => item.id === operation.elementId);
        if (!element || (element.kind !== "text" && element.kind !== "balloon")) throw new Error(`missing visual OverlayElement: ${operation.elementId}`);
        if (operation.appearance) element.appearance = structuredClone(operation.appearance);
        else delete element.appearance;
      }
      continue;
    }
    if (operation.type === "add_frame_layer") {
      const { frame } = findFrame(operation.unitId, operation.frameId);
      if (frame.layers.some((layer) => layer.id === operation.layer.id)) throw new Error(`duplicate FrameLayer id: ${operation.layer.id}`);
      frame.layers.push(structuredClone(operation.layer));
      continue;
    }
    if (operation.type === "add_layer_element") {
      const { layer } = findLayer(operation.unitId, operation.frameId, operation.layerId);
      if (layer.elements.some((element) => element.id === operation.element.id)) throw new Error(`duplicate FrameElement id: ${operation.element.id}`);
      (layer.elements as FrameLayer["elements"][number][]).push(structuredClone(operation.element));
      continue;
    }
    if (operation.type === "remove_layer_element") {
      const { layer } = findLayer(operation.unitId, operation.frameId, operation.layerId);
      layer.elements = layer.elements.filter((element) => element.id !== operation.elementId) as typeof layer.elements;
      continue;
    }
    if (operation.type === "duplicate_layer_element") {
      const { layer } = findLayer(operation.unitId, operation.frameId, operation.layerId);
      const element = layer.elements.find((item) => item.id === operation.elementId);
      if (!element) throw new Error(`missing FrameElement: ${operation.elementId}`);
      if (layer.elements.some((item) => item.id === operation.newElementId)) throw new Error(`duplicate FrameElement id: ${operation.newElementId}`);
      (layer.elements as FrameLayer["elements"][number][]).push({ ...structuredClone(element), id: operation.newElementId, name: `${element.name ?? element.kind} 副本` });
      continue;
    }
    if (operation.type === "reorder_layer") {
      findLayer(operation.unitId, operation.frameId, operation.layerId).layer.zIndex = operation.zIndex;
      continue;
    }
    if (operation.type === "update_balloon") {
      const { layer } = findLayer(operation.unitId, operation.frameId, operation.layerId);
      const element = layer.elements.find((item) => item.id === operation.elementId);
      if (!element || element.kind !== "balloon") throw new Error(`missing BalloonElement: ${operation.elementId}`);
      Object.assign(element, structuredClone(operation.changes));
      continue;
    }
    const exhaustive: never = operation;
    throw new Error(`unsupported WorkspaceCommand: ${(exhaustive as WorkspaceCommand).type}`);
  }

  const validDocument = validateComicDocument(document);
  return {
    working: {
      ...fixture.working,
      revision: fixture.working.revision + 1,
      createdAt: new Date().toISOString(),
      document: validDocument,
      resolvedResources: fixture.working.resolvedResources,
    } as WorkingEnvelope,
    storyboardBeats,
  };
}

export function createSnapshot(working: WorkingEnvelope, expectedRevision: number): SnapshotEnvelope {
  if (working.revision !== expectedRevision) throw new Error("SNAPSHOT_REVISION_CONFLICT");
  return {
    documentId: `snapshot-${working.chapterId}-${working.revision}`,
    chapterId: working.chapterId,
    projectId: working.projectId,
    createdAt: new Date().toISOString(),
    state: "snapshot",
    sourceWorkingRevision: working.revision,
    document: structuredClone(working.document),
    resolvedResources: structuredClone(working.resolvedResources),
  };
}

export function dryRunEditorCapability(id: EditorCapabilityId, rawInput: unknown, context: EditorCapabilityContext) {
  const plan = planEditorCapability(id, rawInput, context);
  const result = applyWorkspaceChangeSet(context.fixture, {
    id: `dry-run:${id}`,
    projectId: context.fixture.working.projectId,
    baseRevision: context.fixture.working.revision,
    source: "manual",
    commands: plan.commands,
  });
  return {
    ...plan,
    result,
    diffSummary: {
      baseRevision: context.fixture.working.revision,
      nextRevision: result.working.revision,
      commandCount: plan.commands.length,
      commandTypes: plan.commands.map((command) => command.type),
    },
  };
}

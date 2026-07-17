import assert from "node:assert/strict";
import test from "node:test";
import { rainyStationStoryboardBeats } from "../packages/shared/fixtures/storyboardBeats";
import { createComicPageView, frameElements, normalizeStoryboardBeat, resolveLocalTransform, validateComicDocument, workspaceCommandSchema, workspaceChangeSetRequestSchema, type BalloonElement, type PresentationUnit } from "../packages/shared/src";
import { applyWorkspaceChangeSet, createSnapshot, dryRunEditorCapability, listEditorCapabilities, planEditorCapabilities, planEditorCapability, verticalSegmentHeight, type VerticalSegmentAspectRatio } from "../packages/editor-core/src";
import { createInitialFixture, fourPanelPlan, previewFixtures } from "../packages/demo-runtime/src";
import { compileChapterLayoutPlan } from "../packages/layout-engine/src";

test("all demo runtime fixtures satisfy executable LCD v0.4", () => {
  Object.values(previewFixtures).forEach((fixture) => assert.equal(validateComicDocument(fixture).protocolVersion, "lcd-0.4"));
});

test("legacy storyboard details fold into the general description without dialogue", () => {
  assert.deepEqual(normalizeStoryboardBeat({
    id: "legacy-beat",
    versionId: "legacy-beat-v1",
    storyPurpose: "雨夜空站",
    shotType: "远景",
    composition: "站台居中",
    action: "只有灯光闪烁",
    emotion: "寂静",
    dialogue: "不应进入分镜描述",
  }), {
    id: "legacy-beat",
    versionId: "legacy-beat-v1",
    title: "雨夜空站",
    description: "镜头：远景；构图：站台居中；画面：只有灯光闪烁；氛围：寂静",
  });
});

test("four-panel unit contains four explicitly ordered frames", () => {
  const document = compileChapterLayoutPlan(fourPanelPlan, rainyStationStoryboardBeats);
  assert.equal(document.units[0].frames.length, 4);
  assert.deepEqual(document.units[0].readingSequence.map((entry) => entry.frameId), document.units[0].frames.map((frame) => frame.id));
});

test("resources are stable bindings and URLs remain in the read model", () => {
  const fixture = createInitialFixture();
  assert.equal(fixture.working.document.resources.length, 4);
  assert.ok(fixture.working.document.resources.every((resource) => !("src" in resource) && resource.assetVersionId));
  assert.ok(Object.values(fixture.working.resolvedResources ?? {}).every((resolved) => resolved.url.startsWith("/samples/rainy-station/")));
});

test("new beats never inherit sample art", () => {
  const beats = rainyStationStoryboardBeats.map((beat, index) => ({ ...beat, id: `new-beat-${index}`, versionId: `new-beat-${index}-v1` }));
  const document = compileChapterLayoutPlan({ ...fourPanelPlan, readingOrder: beats.map((beat) => beat.id) }, beats);
  assert.equal(document.resources.length, 0);
  assert.equal(document.units[0].frames.flatMap(frameElements).filter((element) => element.kind === "image").length, 0);
});

test("validator rejects missing resources, overlap and bounds violations", () => {
  const missing = structuredClone(previewFixtures.page);
  const image = missing.units[0].frames.flatMap(frameElements).find((element) => element.kind === "image");
  assert.ok(image?.kind === "image"); image.assetVersionId = "missing";
  assert.throws(() => validateComicDocument(missing), /undeclared asset version/);

  const overlap = structuredClone(previewFixtures.page);
  overlap.units[0].frames[1].geometry = { ...overlap.units[0].frames[0].geometry };
  assert.throws(() => validateComicDocument(overlap), /overlaps/);

  const outside = structuredClone(previewFixtures.page);
  outside.units[0].frames[0].geometry.x = -1;
  assert.throws(() => validateComicDocument(outside), /unit canvas/);
});

test("semantic text and balloons may reference one declared visual appearance", () => {
  const document = structuredClone(previewFixtures.page);
  const balloon = document.units.flatMap((unit) => unit.frames).flatMap(frameElements).find((element): element is BalloonElement => element.kind === "balloon");
  const resource = document.resources[0];
  assert.ok(balloon && resource);
  balloon.appearance = { assetId: resource.assetId, assetVersionId: resource.assetVersionId };

  const validated = validateComicDocument(document);
  const canvasBalloon = createComicPageView(validated, validated.units[0]).elements.find((element) => element.id === balloon.id);
  assert.deepEqual(canvasBalloon && "appearance" in canvasBalloon ? canvasBalloon.appearance : undefined, balloon.appearance);

  const missing = structuredClone(document);
  const missingBalloon = missing.units.flatMap((unit) => unit.frames).flatMap(frameElements).find((element): element is BalloonElement => element.kind === "balloon");
  assert.ok(missingBalloon);
  missingBalloon.appearance = { assetId: "missing-asset", assetVersionId: "missing-version" };
  assert.throws(() => validateComicDocument(missing), /appearance references an undeclared asset version/);

  const nonImage = structuredClone(document);
  const nonImageBalloon = nonImage.units.flatMap((unit) => unit.frames).flatMap(frameElements).find((element): element is BalloonElement => element.kind === "balloon");
  assert.ok(nonImageBalloon);
  nonImage.resources.push({ assetId: "font-asset", assetVersionId: "font-version", kind: "font", mediaType: "font/woff2" });
  nonImageBalloon.appearance = { assetId: "font-asset", assetVersionId: "font-version" };
  assert.throws(() => validateComicDocument(nonImage), /appearance must reference an image resource/);
});

test("moving a frame changes only the frame while local art follows at render time", () => {
  const fixture = createInitialFixture();
  const unit = fixture.working.document.units[0]; const frame = unit.frames[0];
  const image = frame.layers.flatMap((layer) => layer.kind === "art" ? layer.elements : []).find(() => true);
  assert.ok(image);
  const originalTransform = structuredClone(image.transform);
  const result = applyWorkspaceChangeSet({ working: fixture.working, storyboardBeats: fixture.storyboardBeats }, {
    id: "move", projectId: fixture.working.projectId, baseRevision: 1, source: "manual",
    commands: [{ type: "move_frame", unitId: unit.id, frameId: frame.id, position: { x: frame.geometry.x + 18, y: frame.geometry.y + 14 } }],
  });
  const movedFrame = result.working.document.units[0].frames[0];
  const movedImage = movedFrame.layers.flatMap((layer) => layer.kind === "art" ? layer.elements : [])[0];
  assert.deepEqual(movedImage.transform, originalTransform);
  assert.deepEqual(resolveLocalTransform(movedFrame.geometry, movedImage.transform), movedFrame.geometry);
});

test("adding a presentation unit appends a valid blank page without changing existing frames", () => {
  const fixture = createInitialFixture();
  const previous = fixture.working.document.units.at(-1)!;
  const blank: PresentationUnit = {
    id: "page-blank",
    kind: "single_page",
    canvas: structuredClone(previous.canvas),
    surfaces: [{ id: "page-blank-surface", role: "single", geometry: { x: 0, y: 0, width: previous.canvas.width, height: previous.canvas.height }, pageNumber: fixture.working.document.units.length + 1 }],
    frames: [], overlayLayers: [], readingSequence: [], layoutPolicy: { frameOverlap: "forbid", defaultOverflow: "clip" },
  };
  const result = applyWorkspaceChangeSet({ working: fixture.working, storyboardBeats: fixture.storyboardBeats }, {
    id: "add-page", projectId: fixture.working.projectId, baseRevision: fixture.working.revision, source: "manual",
    commands: [{ type: "add_presentation_unit", unit: blank }],
  });
  assert.equal(result.working.document.units.length, fixture.working.document.units.length + 1);
  assert.equal(result.working.document.reading.unitOrder.at(-1), blank.id);
  assert.deepEqual(result.working.document.units.at(-1), blank);
  assert.deepEqual(result.working.document.units[0].frames, fixture.working.document.units[0].frames);
});

test("editor capabilities are registered but remain unavailable to Agent execution", () => {
  const capabilities = listEditorCapabilities();
  assert.deepEqual(capabilities.map((capability) => capability.id), [
    "create_frame",
    "duplicate_frame",
    "delete_frame",
    "place_frame_image",
    "replace_frame_image",
    "remove_frame_image",
    "create_dialogue_balloon",
    "duplicate_dialogue_balloon",
    "delete_dialogue_balloon",
    "update_dialogue",
    "update_storyboard_beat",
    "create_frame_storyboard_beat",
    "set_art_crop",
    "move_frame",
    "resize_frame",
    "set_element_transform",
    "update_balloon",
    "reorder_layer",
    "set_element_appearance",
    "create_page",
    "create_vertical_segment",
    "update_presentation_unit",
    "delete_presentation_unit",
  ]);
  assert.ok(capabilities.every((capability) => capability.agentAccess === "disabled"));
  assert.ok(capabilities.every((capability) => capability.undoPolicy === "atomic"));
});

test("human frame, image and dialogue management capabilities form valid atomic revisions", () => {
  const fixture = createInitialFixture();
  const unit = fixture.working.document.units[0];
  unit.frames = [];
  unit.readingSequence = [];
  let sequence = 0;
  const context = () => ({ fixture, createId: (prefix: string) => `${prefix}-ui-${++sequence}`, actor: "human" as const });

  const created = dryRunEditorCapability("create_frame", { unitId: unit.id, position: { x: 180, y: 220 } }, context());
  const frame = created.result.working.document.units[0].frames[0];
  assert.ok(frame);
  assert.equal(frame.layers.some((layer) => layer.kind === "art"), true);
  assert.equal(frame.layers.some((layer) => layer.kind === "text"), true);

  fixture.working = created.result.working;
  const duplicated = dryRunEditorCapability("duplicate_frame", { unitId: unit.id, frameId: frame.id }, context());
  assert.equal(duplicated.result.working.document.units[0].frames.length, 2);
  assert.notDeepEqual(duplicated.result.working.document.units[0].frames[0].geometry, duplicated.result.working.document.units[0].frames[1].geometry);

  fixture.working = duplicated.result.working;
  const resource = fixture.working.document.resources[0];
  const image = dryRunEditorCapability("place_frame_image", {
    unitId: unit.id,
    frameId: frame.id,
    assetId: resource.assetId,
    assetVersionId: resource.assetVersionId,
    mediaType: resource.mediaType,
  }, context());
  assert.equal(frameElements(image.result.working.document.units[0].frames[0]).filter((element) => element.kind === "image").length, 1);

  fixture.working = image.result.working;
  const dialogue = dryRunEditorCapability("create_dialogue_balloon", { unitId: unit.id, frameId: frame.id, position: { x: .3, y: .25 }, content: "测试对白" }, context());
  const balloon = frameElements(dialogue.result.working.document.units[0].frames[0]).find((element): element is BalloonElement => element.kind === "balloon");
  assert.ok(balloon);
  assert.equal(dialogue.result.working.document.dialogues.find((item) => item.id === balloon.dialogueId)?.content, "测试对白");

  fixture.working = dialogue.result.working;
  const removed = dryRunEditorCapability("delete_dialogue_balloon", { unitId: unit.id, frameId: frame.id, layerId: fixture.working.document.units[0].frames[0].layers.find((layer) => layer.kind === "text")!.id, elementId: balloon.id }, context());
  assert.equal(frameElements(removed.result.working.document.units[0].frames[0]).some((element) => element.kind === "balloon"), false);
  assert.equal(removed.result.working.document.dialogues.some((item) => item.id === balloon.dialogueId), false);
  fixture.working = removed.result.working;
  const deletedFrame = dryRunEditorCapability("delete_frame", { unitId: unit.id, frameId: frame.id }, context());
  assert.equal(deletedFrame.result.working.document.units[0].frames.some((item) => item.id === frame.id), false);
  assert.throws(() => planEditorCapability("create_frame", { unitId: unit.id, position: { x: 80, y: 80 } }, { ...context(), actor: "agent" }), /disabled for Agent/);
});

test("multiple human capabilities plan one atomic ChangeSet without mutating their source", () => {
  const fixture = createInitialFixture();
  const unit = fixture.working.document.units[0];
  const frame = unit.frames[0];
  const layer = frame.layers.find((item) => item.kind === "text");
  const balloon = layer?.elements.find((element): element is BalloonElement => element.kind === "balloon");
  assert.ok(layer && balloon);
  const before = structuredClone(fixture);
  const content = `${fixture.working.document.dialogues.find((dialogue) => dialogue.id === balloon.dialogueId)?.content ?? "对白"}！`;
  const plan = planEditorCapabilities([
    {
      id: "update_balloon",
      input: { unitId: unit.id, frameId: frame.id, layerId: layer.id, elementId: balloon.id, changes: { shape: "thought" } },
    },
    { id: "update_dialogue", input: { dialogueId: balloon.dialogueId, content } },
  ], {
    fixture,
    createId: (prefix) => `${prefix}-test`,
    actor: "human",
  });

  assert.deepEqual(plan.commands.map((command) => command.type), ["update_balloon", "update_dialogue"]);
  const result = applyWorkspaceChangeSet({ working: fixture.working, storyboardBeats: fixture.storyboardBeats }, {
    id: "combined-capability-change",
    projectId: fixture.working.projectId,
    baseRevision: fixture.working.revision,
    source: "manual",
    commands: plan.commands,
  });
  const changed = frameElements(result.working.document.units[0].frames[0]).find((element) => element.id === balloon.id);
  assert.equal(result.working.revision, fixture.working.revision + 1);
  assert.ok(changed?.kind === "balloon");
  assert.equal(changed.shape, "thought");
  assert.equal(result.working.document.dialogues.find((dialogue) => dialogue.id === balloon.dialogueId)?.content, content);
  assert.deepEqual(fixture, before);
});

test("element appearance is an atomic human capability and remains disabled for Agent", () => {
  const fixture = createInitialFixture();
  const unit = fixture.working.document.units[0];
  const frame = unit.frames[0];
  const layer = frame.layers.find((item) => item.kind === "text");
  const balloon = layer?.elements.find((element): element is BalloonElement => element.kind === "balloon");
  const resource = fixture.working.document.resources[0];
  assert.ok(layer && balloon && resource);
  const input = {
    unitId: unit.id,
    frameId: frame.id,
    layerId: layer.id,
    elementId: balloon.id,
    appearance: { assetId: resource.assetId, assetVersionId: resource.assetVersionId },
  };
  const before = structuredClone(fixture);
  const dryRun = dryRunEditorCapability("set_element_appearance", input, {
    fixture,
    createId: (prefix) => `${prefix}-test`,
    actor: "human",
  });
  const changed = frameElements(dryRun.result.working.document.units[0].frames[0]).find((element) => element.id === balloon.id);
  assert.ok(changed?.kind === "balloon");
  assert.deepEqual(changed.appearance, input.appearance);
  assert.deepEqual(fixture, before);
  assert.throws(() => planEditorCapability("set_element_appearance", input, {
    fixture,
    createId: (prefix) => `${prefix}-agent`,
    actor: "agent",
  }), /disabled for Agent/);
});

test("create_page plans defaults in the domain executor and dry-runs without mutating the source", () => {
  const fixture = createInitialFixture();
  const before = structuredClone(fixture);
  const dryRun = dryRunEditorCapability("create_page", {}, {
    fixture,
    createId: () => "page-from-capability",
    actor: "human",
  });

  assert.equal(dryRun.commands.length, 1);
  assert.equal(dryRun.commands[0].type, "add_presentation_unit");
  assert.deepEqual(dryRun.diffSummary.commandTypes, ["add_presentation_unit"]);
  assert.equal(dryRun.result.working.document.units.length, fixture.working.document.units.length + 1);
  assert.equal(dryRun.result.working.document.units.at(-1)?.id, "page-from-capability");
  assert.deepEqual(fixture, before);
});

test("create_vertical_segment keeps chapter width and applies every supported aspect ratio", () => {
  const fixture = createInitialFixture();
  fixture.working.document = structuredClone(previewFixtures.vertical);
  const before = structuredClone(fixture);
  const expectedHeights: Record<VerticalSegmentAspectRatio, number> = {
    "4:3": 480,
    "1:1": 640,
    "3:4": 853,
    "2:3": 960,
    "9:16": 1138,
    "9:20": 1422,
  };

  for (const [aspectRatio, expectedHeight] of Object.entries(expectedHeights) as Array<[VerticalSegmentAspectRatio, number]>) {
    const dryRun = dryRunEditorCapability("create_vertical_segment", { aspectRatio }, {
      fixture,
      createId: () => `segment-${aspectRatio.replace(":", "-")}`,
      actor: "human",
    });
    const segment = dryRun.result.working.document.units.at(-1)!;
    assert.equal(verticalSegmentHeight(640, aspectRatio), expectedHeight);
    assert.equal(segment.kind, "vertical_segment");
    assert.deepEqual(segment.canvas, { width: 640, height: expectedHeight, background: fixture.working.document.units.at(-1)?.canvas.background });
    assert.deepEqual(segment.surfaces[0]?.geometry, { x: 0, y: 0, width: 640, height: expectedHeight });
    assert.equal(dryRun.result.working.document.reading.unitOrder.at(-1), segment.id);
  }
  assert.deepEqual(fixture, before);
});

test("page and vertical segment creation reject the opposite comic format", () => {
  const pageFixture = createInitialFixture();
  assert.throws(() => planEditorCapability("create_vertical_segment", { aspectRatio: "9:20" }, {
    fixture: pageFixture,
    createId: (prefix) => `${prefix}-test`,
    actor: "human",
  }), /requires a vertical comic/);

  const verticalFixture = createInitialFixture();
  verticalFixture.working.document = structuredClone(previewFixtures.vertical);
  assert.throws(() => planEditorCapability("create_page", {}, {
    fixture: verticalFixture,
    createId: (prefix) => `${prefix}-test`,
    actor: "human",
  }), /unavailable for vertical comics/);
  assert.throws(() => planEditorCapability("create_vertical_segment", { aspectRatio: "1:2" }, {
    fixture: verticalFixture,
    createId: (prefix) => `${prefix}-test`,
    actor: "human",
  }));
});

test("presentation unit editing stores an optional name and resizes only vertical segment height", () => {
  const fixture = createInitialFixture();
  fixture.working.document = structuredClone(previewFixtures.vertical);
  const unit = fixture.working.document.units[0];
  unit.frames = [];
  unit.readingSequence = [];
  unit.overlayLayers = [];
  const before = structuredClone(fixture);
  const edited = dryRunEditorCapability("update_presentation_unit", {
    unitId: unit.id,
    name: "雨幕开场",
    aspectRatio: "9:20",
  }, {
    fixture,
    createId: (prefix) => `${prefix}-test`,
    actor: "human",
  });
  const resultUnit = edited.result.working.document.units[0];
  assert.equal(resultUnit.name, "雨幕开场");
  assert.equal(resultUnit.canvas.width, unit.canvas.width);
  assert.equal(resultUnit.canvas.height, verticalSegmentHeight(unit.canvas.width, "9:20"));
  assert.deepEqual(resultUnit.surfaces[0].geometry, { x: 0, y: 0, width: resultUnit.canvas.width, height: resultUnit.canvas.height });
  assert.deepEqual(fixture, before);

  const cleared = dryRunEditorCapability("update_presentation_unit", { unitId: resultUnit.id, name: "" }, {
    fixture: { ...fixture, working: edited.result.working, storyboardBeats: edited.result.storyboardBeats },
    createId: (prefix) => `${prefix}-test`,
    actor: "human",
  });
  assert.equal(cleared.result.working.document.units[0].name, undefined);
});

test("vertical segment editing refuses a ratio that would crop an existing frame", () => {
  const fixture = createInitialFixture();
  fixture.working.document = structuredClone(previewFixtures.vertical);
  const unit = fixture.working.document.units[0];
  const targetHeight = verticalSegmentHeight(unit.canvas.width, "4:3");
  unit.frames[0].geometry = { x: 0, y: targetHeight - 10, width: 100, height: 20 };
  assert.throws(() => planEditorCapability("update_presentation_unit", {
    unitId: unit.id,
    name: "",
    aspectRatio: "4:3",
  }, {
    fixture,
    createId: (prefix) => `${prefix}-test`,
    actor: "human",
  }), /现有画格会被裁切/);
});

test("presentation unit deletion updates reading order and keeps one page minimum", () => {
  const fixture = createInitialFixture();
  const added = dryRunEditorCapability("create_page", {}, {
    fixture,
    createId: () => "page-to-delete",
    actor: "human",
  });
  const expandedFixture = { ...fixture, working: added.result.working, storyboardBeats: added.result.storyboardBeats };
  const before = structuredClone(expandedFixture);
  const removed = dryRunEditorCapability("delete_presentation_unit", { unitId: "page-to-delete" }, {
    fixture: expandedFixture,
    createId: (prefix) => `${prefix}-test`,
    actor: "human",
  });
  assert.equal(removed.result.working.document.units.length, 1);
  assert.ok(!removed.result.working.document.reading.unitOrder.includes("page-to-delete"));
  assert.deepEqual(expandedFixture, before);
  assert.throws(() => planEditorCapability("delete_presentation_unit", { unitId: fixture.working.document.units[0].id }, {
    fixture,
    createId: (prefix) => `${prefix}-test`,
    actor: "human",
  }), /至少需要保留一个页面/);
});

test("capability preconditions reject invalid targets before commands are committed", () => {
  const fixture = createInitialFixture();
  assert.throws(() => planEditorCapability("update_dialogue", {
    dialogueId: "missing-dialogue",
    content: "不会写入",
  }, {
    fixture,
    createId: (prefix) => `${prefix}-test`,
    actor: "human",
  }), /missing Dialogue/);
});

test("Agent planning cannot bypass the capability allowlist", () => {
  const fixture = createInitialFixture();
  assert.throws(() => planEditorCapability("create_page", {}, {
    fixture,
    createId: (prefix) => `${prefix}-agent`,
    actor: "agent",
  }), /disabled for Agent/);
});

test("shared workspace schemas reject malformed commands at every runtime boundary", () => {
  assert.throws(() => workspaceCommandSchema.parse({
    type: "add_frame",
    unitId: "page-1",
    frame: { id: "incomplete-frame" },
  }));
  assert.throws(() => workspaceCommandSchema.parse({
    type: "set_element_appearance",
    unitId: "page-1",
    frameId: "frame-1",
    layerId: "text-1",
    elementId: "balloon-1",
    appearance: { assetId: "asset-1", assetVersionId: "asset-1-v1", svgPath: "M0 0" },
  }));
  assert.throws(() => workspaceCommandSchema.parse({
    type: "update_balloon",
    unitId: "page-1",
    frameId: "frame-1",
    layerId: "text-1",
    elementId: "balloon-1",
    changes: { arbitraryProtocolField: true },
  }));
  assert.doesNotThrow(() => workspaceChangeSetRequestSchema.parse({
    expectedWorkingRevision: 1,
    changeSet: {
      id: "validated-change",
      projectId: "project-1",
      baseRevision: 1,
      source: "manual",
      commands: [{ type: "update_dialogue", dialogueId: "dialogue-1", content: "新的对白" }],
    },
  }));
});

test("crop and dialogue commands cannot mutate unrelated layers", () => {
  const fixture = createInitialFixture(); const unit = fixture.working.document.units[0]; const frame = unit.frames[0];
  const artLayer = frame.layers.find((layer) => layer.kind === "art")!; const image = artLayer.elements[0];
  const result = applyWorkspaceChangeSet({ working: fixture.working, storyboardBeats: fixture.storyboardBeats }, {
    id: "crop", projectId: fixture.working.projectId, baseRevision: 1, source: "manual",
    commands: [{ type: "set_art_crop", unitId: unit.id, frameId: frame.id, layerId: artLayer.id, elementId: image.id, crop: { x: .1, y: .1, width: .8, height: .8 } }],
  });
  assert.deepEqual(result.working.document.units[0].frames[0].geometry, frame.geometry);
  assert.deepEqual(result.working.document.units[0].frames[0].layers.find((layer) => layer.kind === "art")!.elements[0].crop, { x: .1, y: .1, width: .8, height: .8 });
});

test("candidate ChangeSet is atomic and updates dialogue semantics", () => {
  const fixture = createInitialFixture();
  const dialogue = fixture.working.document.dialogues.find((item) => item.storyboardBeatId === "fixture-rain-beat-4")!;
  const result = applyWorkspaceChangeSet({ working: fixture.working, storyboardBeats: fixture.storyboardBeats }, {
    id: "candidate", projectId: fixture.working.projectId, baseRevision: 1, source: "candidate", sourceCandidateId: "candidate-1",
    commands: [{ type: "update_dialogue", dialogueId: dialogue.id, content: "明天再问吧。" }],
  });
  assert.equal(result.working.revision, 2);
  assert.equal(result.working.document.dialogues.find((dialogue) => dialogue.storyboardBeatId === "fixture-rain-beat-4")?.content, "明天再问吧。");
});

test("creating a single-frame storyboard beat atomically binds the unassigned frame", () => {
  const fixture = createInitialFixture();
  const unit = fixture.working.document.units[0];
  const frame = unit.frames[0];
  frame.storyRefs = frame.storyRefs.filter((reference) => reference.role !== "primary");
  const storyboardBeat = {
    id: "frame-one-new-beat",
    versionId: "frame-one-new-beat-v1",
    title: "雨声中回头",
    description: "女孩回头看向站台入口，神情警觉。",
  };
  const result = applyWorkspaceChangeSet({ working: fixture.working, storyboardBeats: fixture.storyboardBeats }, {
    id: "create-frame-beat", projectId: fixture.working.projectId, baseRevision: 1, source: "manual",
    commands: [{ type: "create_frame_storyboard_beat", unitId: unit.id, frameId: frame.id, storyboardBeat }],
  });
  assert.deepEqual(result.storyboardBeats.at(-1), storyboardBeat);
  assert.deepEqual(result.working.document.units[0].frames[0].storyRefs.find((reference) => reference.role === "primary"), {
    storyboardBeatId: storyboardBeat.id,
    storyboardBeatVersionId: storyboardBeat.versionId,
    role: "primary",
  });
});

test("stale writes are rejected and snapshots are independent", () => {
  const fixture = createInitialFixture(); const before = JSON.stringify(fixture);
  assert.throws(() => applyWorkspaceChangeSet({ working: fixture.working, storyboardBeats: fixture.storyboardBeats }, { id: "stale", projectId: fixture.working.projectId, baseRevision: 0, source: "manual", commands: [] }), /REVISION_CONFLICT/);
  assert.equal(JSON.stringify(fixture), before);
  const snapshot = createSnapshot(fixture.working, 1);
  fixture.working.document.units[0].canvas.background.color = "#000";
  assert.equal(snapshot.document.units[0].canvas.background.color, "#ffffff");
});

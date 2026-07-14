import assert from "node:assert/strict";
import test from "node:test";
import { rainyStationStoryboardBeats } from "../packages/shared/fixtures/storyboardBeats";
import { frameElements, normalizeStoryboardBeat, resolveLocalTransform, validateComicDocument, type PresentationUnit } from "../packages/shared/src";
import { applyWorkspaceChangeSet, createSnapshot } from "../packages/editor-core/src";
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

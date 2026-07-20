import assert from "node:assert/strict";
import test from "node:test";
import { rainyStationStoryboardBeats } from "../packages/shared/fixtures/storyboardBeats";
import { balloonCutCornerPoints, createComicPageView, frameCornerDragAxis, frameElements, frameQuadrilateralPoints, normalizeStoryboardBeat, pageDisplayGroups, projectTextStrokeWidth, reshapeFrameCorner, resolveLocalTransform, validateComicDocument, workspaceCommandSchema, workspaceChangeSetRequestSchema, type BalloonElement, type PresentationUnit } from "../packages/shared/src";
import { applyWorkspaceChangeSet, createSnapshot, dryRunEditorCapability, listEditorCapabilities, planEditorCapabilities, planEditorCapability, verticalSegmentHeight, type VerticalSegmentAspectRatio } from "../packages/editor-core/src";
import { createInitialFixture, fourPanelPlan, previewFixtures } from "../packages/demo-runtime/src";
import { compileChapterLayoutPlan } from "../packages/layout-engine/src";
import { isAssetVisibleInAssetSpace } from "../app/lib/asset-kind";
import { snapFrameCornerToNeighborParallel, snapFrameCornerToOrthogonal, snapGeometrySizeToFrameEdgeExtensions, snapGeometryToFrameEdgeExtensions } from "../app/lib/editor-snapping";

test("generated frame images stay saveable until converted into an asset-space type", () => {
  assert.equal(isAssetVisibleInAssetSpace({ kind: "generated_image", libraryStatus: "library" }), false);
  assert.equal(isAssetVisibleInAssetSpace({ kind: "reference_image", libraryStatus: "library" }), true);
  assert.equal(isAssetVisibleInAssetSpace({ kind: "reference_image", libraryStatus: "canvas_only" }), false);
});

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
  const document = compileChapterLayoutPlan(fourPanelPlan, rainyStationStoryboardBeats, { comicId: "test-comic", chapterId: "test-chapter" });
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
  const document = compileChapterLayoutPlan({ ...fourPanelPlan, readingOrder: beats.map((beat) => beat.id) }, beats, { comicId: "test-comic", chapterId: "test-chapter" });
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

test("frame corner gestures lock to one axis and rebase an outward trapezoid", () => {
  assert.equal(frameCornerDragAxis(8, 3), "x");
  assert.equal(frameCornerDragAxis(3, -8), "y");
  assert.equal(frameCornerDragAxis(2, 3), undefined);
  assert.deepEqual(frameQuadrilateralPoints({ kind: "rect" }), [
    { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 },
  ]);

  const reshaped = reshapeFrameCorner(
    { x: 10, y: 20, width: 200, height: 100 },
    { kind: "rect" },
    2,
    "x",
    50,
    { x: 0, y: 0, width: 400, height: 300 },
  );
  assert.deepEqual(reshaped, {
    geometry: { x: 10, y: 20, width: 250, height: 100 },
    shape: { kind: "polygon", points: [{ x: 0, y: 0 }, { x: .8, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] },
  });
});

test("moving objects snap only to close like-for-like frame edge extensions", () => {
  const target = { geometry: { x: 10, y: 20, width: 80, height: 90 } };
  const snapped = snapGeometryToFrameEdgeExtensions(
    { x: 14, y: 150, width: 50, height: 40 },
    [target],
    { x: 5, y: 5 },
  );
  assert.deepEqual(snapped.geometry, { x: 10, y: 150, width: 50, height: 40 });
  assert.deepEqual(snapped.guides, [{ kind: "edge_extension", axis: "x", position: 10 }]);

  const outsideThreshold = snapGeometryToFrameEdgeExtensions(
    { x: 16, y: 150, width: 50, height: 40 },
    [target],
    { x: 5, y: 5 },
  );
  assert.equal(outsideThreshold.geometry.x, 16);
  assert.deepEqual(outsideThreshold.guides, []);

  const crossEdgeOnly = snapGeometryToFrameEdgeExtensions(
    { x: 56, y: 150, width: 40, height: 40 },
    [{ geometry: { x: 100, y: 20, width: 40, height: 90 } }],
    { x: 5, y: 5 },
  );
  assert.equal(crossEdgeOnly.geometry.x, 56);
  assert.deepEqual(crossEdgeOnly.guides, []);
});

test("resizing objects snaps their right and bottom edges to matching frame extensions", () => {
  const target = { geometry: { x: 10, y: 20, width: 80, height: 90 } };
  const snapped = snapGeometrySizeToFrameEdgeExtensions(
    { x: 30, y: 40, width: 56, height: 66 },
    [target],
    { x: 5, y: 5 },
  );
  assert.deepEqual(snapped.geometry, { x: 30, y: 40, width: 60, height: 70 });
  assert.deepEqual(snapped.guides, [
    { kind: "edge_extension", axis: "x", position: 90 },
    { kind: "edge_extension", axis: "y", position: 110 },
  ]);

  const outsideThreshold = snapGeometrySizeToFrameEdgeExtensions(
    { x: 30, y: 40, width: 54, height: 64 },
    [target],
    { x: 5, y: 5 },
  );
  assert.deepEqual(outsideThreshold.geometry, { x: 30, y: 40, width: 54, height: 64 });
  assert.deepEqual(outsideThreshold.guides, []);
});

test("corner editing snaps the active facing edge parallel to the nearest neighboring frame edge", () => {
  const leftFrame = { id: "left", geometry: { x: 0, y: 10, width: 100, height: 100 }, shape: { kind: "polygon" as const, points: [{ x: 0, y: 0 }, { x: .9, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] } };
  const rightFrame = { id: "right", geometry: { x: 120, y: 20, width: 80, height: 100 }, shape: { kind: "rect" as const } };
  const snapped = snapFrameCornerToNeighborParallel(rightFrame, 3, "x", 7, [leftFrame], 5);
  assert.equal(snapped.delta, 10);
  assert.equal(snapped.guide?.frameId, "left");
  assert.deepEqual(snapped.guide?.referenceEdge, { start: { x: 90, y: 10 }, end: { x: 100, y: 110 } });
  assert.deepEqual(snapped.guide?.activeEdge, { start: { x: 120, y: 20 }, end: { x: 130, y: 120 } });

  const outsideThreshold = snapFrameCornerToNeighborParallel(rightFrame, 3, "x", 4, [leftFrame], 5);
  assert.equal(outsideThreshold.delta, 4);
  assert.equal(outsideThreshold.guide, undefined);
});

test("corner editing snaps an almost-straight edge to a paper-wide orthogonal guide", () => {
  const frame = { id: "orthogonal", geometry: { x: 20, y: 30, width: 120, height: 100 }, shape: { kind: "polygon" as const, points: [{ x: .08, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] } };
  const vertical = snapFrameCornerToOrthogonal(frame, 0, "x", -8, 3);
  assert.ok(Math.abs(vertical.delta + 9.6) < 1e-9);
  assert.deepEqual(vertical.guide, { kind: "edge_extension", axis: "x", position: 20 });
  const outsideThreshold = snapFrameCornerToOrthogonal(frame, 0, "x", -4, 3);
  assert.equal(outsideThreshold.delta, -4);
  assert.equal(outsideThreshold.guide, undefined);
  const horizontalFrame = { ...frame, shape: { kind: "polygon" as const, points: [{ x: 0, y: .06 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] } };
  const horizontal = snapFrameCornerToOrthogonal(horizontalFrame, 0, "y", -5, 2);
  assert.equal(horizontal.delta, -6);
  assert.deepEqual(horizontal.guide, { kind: "edge_extension", axis: "y", position: 30 });
});

test("reshape frame capability applies geometry and four-corner shape atomically", () => {
  const fixture = createInitialFixture();
  const unit = fixture.working.document.units[0];
  const frame = unit.frames[0];
  const shape = { kind: "polygon" as const, points: [{ x: 0, y: 0 }, { x: .92, y: 0 }, { x: 1, y: 1 }, { x: .08, y: 1 }] };
  const result = dryRunEditorCapability("reshape_frame", { unitId: unit.id, frameId: frame.id, geometry: frame.geometry, shape }, {
    fixture,
    createId: (prefix) => `${prefix}-reshape`,
    actor: "human",
  });
  const next = result.result.working.document.units[0].frames.find((candidate) => candidate.id === frame.id);
  assert.deepEqual(result.commands.map((command) => command.type), ["resize_frame", "set_frame_style"]);
  assert.deepEqual(next?.geometry, frame.geometry);
  assert.deepEqual(next?.shape, shape);
  const pageFrame = createComicPageView(result.result.working.document, result.result.working.document.units[0]).elements.find((element) => element.id === frame.id);
  assert.deepEqual(pageFrame?.type === "comic_frame" ? pageFrame.shape : undefined, shape);
});

test("frame border width accepts half-step values independently from its storyboard binding", () => {
  const fixture = createInitialFixture();
  const unit = fixture.working.document.units[0];
  const frame = unit.frames[0];
  const result = dryRunEditorCapability("update_frame_border", { unitId: unit.id, frameId: frame.id, width: 1.5 }, {
    fixture,
    createId: (prefix) => `${prefix}-border`,
    actor: "human",
  });
  const next = result.result.working.document.units[0].frames.find((candidate) => candidate.id === frame.id);
  assert.deepEqual(result.commands.map((command) => command.type), ["set_frame_style"]);
  assert.deepEqual(next?.border, { ...frame.border, width: 1.5 });
  assert.deepEqual(next?.storyRefs, frame.storyRefs);
});

test("frame bleed extends one selected edge to its surface and keeps the other borders", () => {
  const fixture = createInitialFixture();
  const unit = fixture.working.document.units[0];
  const frame = unit.frames[0];
  const result = dryRunEditorCapability("update_frame_bleed", { unitId: unit.id, frameId: frame.id, edge: "top", enabled: true }, {
    fixture,
    createId: (prefix) => `${prefix}-bleed`,
    actor: "human",
  });
  const next = result.result.working.document.units[0].frames.find((candidate) => candidate.id === frame.id)!;
  assert.deepEqual(result.commands.map((command) => command.type), ["resize_frame", "set_frame_style"]);
  assert.equal(next.geometry.y, unit.surfaces[0].geometry.y);
  assert.equal(next.geometry.y + next.geometry.height, frame.geometry.y + frame.geometry.height);
  assert.deepEqual(next.bleedEdges, { top: true, right: false, bottom: false, left: false });
  assert.deepEqual(next.mask, { mode: "bleed" });
  const disabled = dryRunEditorCapability("update_frame_bleed", { unitId: unit.id, frameId: frame.id, edge: "top", enabled: false }, {
    fixture: result.result,
    createId: (prefix) => `${prefix}-bleed-off`,
    actor: "human",
  });
  assert.deepEqual(disabled.result.working.document.units[0].frames[0].mask, { mode: "clip" });
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

test("only single-frame candidate capabilities are open to Agent preview", () => {
  const capabilities = listEditorCapabilities();
  assert.deepEqual(capabilities.map((capability) => capability.id), [
    "create_frame",
    "duplicate_frame",
    "delete_frame",
    "place_frame_image",
    "replace_frame_image",
    "remove_frame_image",
    "create_dialogue_balloon",
    "create_page_image",
    "create_page_dialogue_balloon",
    "create_narration",
    "update_narration",
    "duplicate_narration",
    "delete_narration",
    "promote_element_to_overlay",
    "convert_element_to_page",
    "return_element_to_frame",
    "reorder_overlay_element",
    "duplicate_dialogue_balloon",
    "delete_dialogue_balloon",
    "update_dialogue",
    "update_storyboard_beat",
    "create_frame_storyboard_beat",
    "set_art_crop",
    "move_frame",
    "set_frame_overlap_policy",
    "reorder_frame",
    "resize_frame",
    "reshape_frame",
    "update_frame_border",
    "update_frame_bleed",
    "set_frame_cross_page",
    "set_element_transform",
    "update_balloon",
    "reorder_layer",
    "set_element_appearance",
    "merge_pages_to_spread",
    "split_spread_to_pages",
    "create_cross_page_image",
    "convert_image_to_cross_page",
    "merge_vertical_segments",
    "split_vertical_segments",
    "create_cross_segment_image",
    "convert_image_to_cross_segment",
    "convert_balloon_to_cross_page",
    "create_page",
    "create_vertical_segment",
    "update_presentation_unit",
    "duplicate_presentation_unit",
    "move_presentation_unit",
    "delete_presentation_unit",
    "restore_workspace_version",
  ]);
  assert.deepEqual(
    capabilities.filter((capability) => capability.agentAccess !== "disabled").map((capability) => [capability.id, capability.agentAccess]),
    [["place_frame_image", "preview"], ["replace_frame_image", "preview"], ["update_storyboard_beat", "preview"], ["create_frame_storyboard_beat", "preview"]],
  );
  assert.ok(capabilities.every((capability) => capability.undoPolicy === "atomic"));
});

test("paper narration stays frame-free, topmost, editable and independently removable", () => {
  const fixture = createInitialFixture();
  const unit = fixture.working.document.units[0];
  let sequence = 0;
  const context = () => ({ fixture, createId: (prefix: string) => `${prefix}-narration-${++sequence}`, actor: "human" as const });
  const created = dryRunEditorCapability("create_narration", { unitId: unit.id, position: { x: 360, y: 120 } }, context());
  fixture.working = created.result.working;
  const narrationLayer = fixture.working.document.units[0].overlayLayers.find((layer) => layer.purpose === "narration")!;
  const narration = narrationLayer.elements.find((element) => element.kind === "text")!;
  assert.equal(narration.kind === "text" ? narration.content : "", "请输入文本");
  assert.deepEqual(narrationLayer.anchor, { type: "unit" });
  assert.equal(narrationLayer.surfaceId, undefined);
  assert.equal(narration.kind === "text" ? narration.style.fontSize : 0, 24);
  assert.equal(narration.kind === "text" ? narration.style.strokeWidth : 0, 2);
  assert.equal(narration.kind === "text" ? projectTextStrokeWidth({ ...narration, style: { ...narration.style, strokeWidth: 1.25 } }) : 0, 2);
  assert.deepEqual(narration.transform, { x: 288, y: 90, width: 144, height: 60 });
  const view = createComicPageView(fixture.working.document, fixture.working.document.units[0]).elements.find((element) => element.id === narration.id);
  assert.equal(view?.type, "text");
  assert.equal(view?.type === "text" ? view.location.space : "", "overlay");
  assert.ok((view?.zIndex ?? 0) > Math.max(...fixture.working.document.units[0].frames.map((frame) => frame.zIndex)));

  const updated = dryRunEditorCapability("update_narration", { unitId: unit.id, layerId: narrationLayer.id, elementId: narration.id, changes: { content: "残响。", fontSize: 22, writingMode: "vertical" } }, context());
  fixture.working = updated.result.working;
  const updatedText = fixture.working.document.units[0].overlayLayers.flatMap((layer) => layer.elements).find((element) => element.id === narration.id);
  assert.equal(updatedText?.kind === "text" ? updatedText.content : "", "残响。");
  assert.equal(updatedText?.kind === "text" ? updatedText.style.fontSize : 0, 22);
  assert.equal(updatedText?.kind === "text" ? updatedText.style.writingMode : "", "vertical");
  assert.deepEqual(updatedText?.transform, { x: 330, y: 48, width: 60, height: 144 });

  assert.ok(updatedText?.kind === "text");
  const rotated = dryRunEditorCapability("set_element_transform", { unitId: unit.id, layerId: narrationLayer.id, elementId: narration.id, transform: { ...updatedText.transform, rotate: 17.5 } }, context());
  fixture.working = rotated.result.working;
  const rotatedText = fixture.working.document.units[0].overlayLayers.flatMap((layer) => layer.elements).find((element) => element.id === narration.id);
  assert.equal(rotatedText?.kind === "text" ? rotatedText.transform.rotate : undefined, 17.5);

  const duplicated = dryRunEditorCapability("duplicate_narration", { unitId: unit.id, layerId: narrationLayer.id, elementId: narration.id }, context());
  fixture.working = duplicated.result.working;
  assert.equal(fixture.working.document.units[0].overlayLayers.find((layer) => layer.id === narrationLayer.id)?.elements.length, 2);
  const removed = dryRunEditorCapability("delete_narration", { unitId: unit.id, layerId: narrationLayer.id, elementId: narration.id }, context());
  assert.equal(removed.result.working.document.units[0].overlayLayers.flatMap((layer) => layer.elements).some((element) => element.id === narration.id), false);
  assert.throws(() => planEditorCapability("create_narration", { unitId: unit.id, position: { x: 20, y: 20 } }, { ...context(), actor: "agent" }), /disabled for Agent/);
});

test("true spreads stay indivisible, preserve physical surfaces and block unsafe splitting", () => {
  const fixture = createInitialFixture();
  let sequence = 0;
  const context = () => ({ fixture, createId: (prefix: string) => `${prefix}-spread-${++sequence}`, actor: "human" as const });
  const originalFrameId = fixture.working.document.units[0].frames[0].id;
  const added = dryRunEditorCapability("create_page", {}, context());
  fixture.working = added.result.working;
  const [firstId, secondId] = fixture.working.document.reading.unitOrder;
  const merged = dryRunEditorCapability("merge_pages_to_spread", { unitId: firstId, nextUnitId: secondId }, context());
  fixture.working = merged.result.working;
  const spread = fixture.working.document.units.find((unit) => unit.kind === "spread")!;
  assert.equal(fixture.working.document.reading.unitOrder.length, 1);
  assert.deepEqual(spread.surfaces.map((surface) => surface.pageNumber).sort(), [1, 2]);
  assert.equal(spread.frames.some((frame) => frame.id === originalFrameId), true);
  assert.deepEqual(pageDisplayGroups(fixture.working.document, "single"), [{ unitIndices: [0], unitIds: [spread.id], trueSpread: true }]);
  assert.deepEqual(pageDisplayGroups(fixture.working.document, "spread"), [{ unitIndices: [0], unitIds: [spread.id], trueSpread: true }]);

  const resource = fixture.working.document.resources[0];
  const crossPage = dryRunEditorCapability("create_cross_page_image", { unitId: spread.id, assetId: resource.assetId, assetVersionId: resource.assetVersionId, mediaType: resource.mediaType }, context());
  fixture.working = crossPage.result.working;
  const crossLayer = fixture.working.document.units.find((unit) => unit.id === spread.id)?.overlayLayers.find((layer) => layer.purpose === "cross_page");
  assert.equal(crossLayer?.surfaceId, undefined);
  assert.equal(crossLayer?.elements.length, 1);
  assert.deepEqual(crossLayer?.elements[0]?.transform, { x: 0, y: 0, width: spread.canvas.width, height: spread.canvas.height });
  assert.throws(() => dryRunEditorCapability("replace_frame_image", { unitId: spread.id, layerId: crossLayer!.id, elementId: crossLayer!.elements[0].id, assetId: resource.assetId, assetVersionId: resource.assetVersionId, mediaType: resource.mediaType }, context()), /不能直接更换/);
  assert.throws(() => dryRunEditorCapability("split_spread_to_pages", { unitId: spread.id }, context()), /跨越分隔线的对象/);
  const crossImageId = crossLayer!.elements[0].id;
  fixture.working = dryRunEditorCapability("convert_element_to_page", { unitId: spread.id, layerId: crossLayer!.id, elementId: crossImageId }, context()).result.working;
  const restoredUnit = fixture.working.document.units.find((unit) => unit.id === spread.id)!;
  const restoredLayer = restoredUnit.overlayLayers.find((layer) => layer.purpose === "page_content" && layer.elements.some((element) => element.id === crossImageId));
  assert.equal(restoredUnit.overlayLayers.some((layer) => layer.purpose === "cross_page"), false);
  assert.ok(restoredLayer?.surfaceId);
  assert.deepEqual(restoredLayer?.elements[0].transform, { x: 0, y: 0, width: spread.canvas.width / 2, height: spread.canvas.height });
  assert.equal(dryRunEditorCapability("split_spread_to_pages", { unitId: spread.id }, context()).result.working.document.reading.unitOrder.length, 2);
});

test("safe spread splitting restores two units without changing object ids", () => {
  const fixture = createInitialFixture();
  let sequence = 0;
  const context = () => ({ fixture, createId: (prefix: string) => `${prefix}-safe-${++sequence}`, actor: "human" as const });
  const originalFrameIds = fixture.working.document.units[0].frames.map((frame) => frame.id);
  fixture.working = dryRunEditorCapability("create_page", {}, context()).result.working;
  const [firstId, secondId] = fixture.working.document.reading.unitOrder;
  fixture.working = dryRunEditorCapability("merge_pages_to_spread", { unitId: firstId, nextUnitId: secondId }, context()).result.working;
  const spreadId = fixture.working.document.reading.unitOrder[0];
  const split = dryRunEditorCapability("split_spread_to_pages", { unitId: spreadId }, context());
  assert.equal(split.result.working.document.reading.unitOrder.length, 2);
  assert.deepEqual(split.result.working.document.units.flatMap((unit) => unit.frames.map((frame) => frame.id)).sort(), originalFrameIds.sort());
  assert.deepEqual(split.result.working.document.reading.unitOrder.flatMap((unitId) => split.result.working.document.units.find((unit) => unit.id === unitId)?.surfaces.map((surface) => surface.pageNumber) ?? []), [1, 2]);
});

test("spread merge accepts different overlap policies and preserves the permissive policy", () => {
  const fixture = createInitialFixture();
  let sequence = 0;
  const context = () => ({ fixture, createId: (prefix: string) => `${prefix}-mixed-overlap-${++sequence}`, actor: "human" as const });
  fixture.working = dryRunEditorCapability("create_page", {}, context()).result.working;
  const [firstId, secondId] = fixture.working.document.reading.unitOrder;
  const first = fixture.working.document.units.find((unit) => unit.id === firstId)!;
  const second = fixture.working.document.units.find((unit) => unit.id === secondId)!;
  first.layoutPolicy.frameOverlap = "allow";
  second.layoutPolicy.frameOverlap = "forbid";
  const result = dryRunEditorCapability("merge_pages_to_spread", { unitId: firstId, nextUnitId: secondId }, context());
  assert.equal(result.result.working.document.units.find((unit) => unit.kind === "spread")?.layoutPolicy.frameOverlap, "allow");
});

test("spread splitting follows actual frame and balloon geometry", () => {
  const fixture = createInitialFixture();
  let sequence = 0;
  const context = () => ({ fixture, createId: (prefix: string) => `${prefix}-cross-object-${++sequence}`, actor: "human" as const });
  fixture.working = dryRunEditorCapability("create_page", {}, context()).result.working;
  const [firstId, secondId] = fixture.working.document.reading.unitOrder;
  fixture.working = dryRunEditorCapability("merge_pages_to_spread", { unitId: firstId, nextUnitId: secondId }, context()).result.working;
  const spread = fixture.working.document.units.find((unit) => unit.kind === "spread")!;
  const frame = spread.frames[0];

  fixture.working = dryRunEditorCapability("set_frame_cross_page", { unitId: spread.id, frameId: frame.id, enabled: true }, context()).result.working;
  const crossFrame = fixture.working.document.units.find((unit) => unit.id === spread.id)!.frames.find((candidate) => candidate.id === frame.id)!;
  assert.equal(crossFrame.surfaceScope, "unit");
  const containedFrameSplit = dryRunEditorCapability("split_spread_to_pages", { unitId: spread.id }, context());
  assert.equal(containedFrameSplit.result.working.document.units.flatMap((unit) => unit.frames).find((candidate) => candidate.id === frame.id)?.surfaceScope, undefined);
  const originalFrameGeometry = structuredClone(crossFrame.geometry);
  crossFrame.geometry = { ...crossFrame.geometry, x: spread.canvas.width / 2 - 20, width: 40 };
  assert.throws(() => dryRunEditorCapability("split_spread_to_pages", { unitId: spread.id }, context()), /跨越分隔线的画格/);
  crossFrame.geometry = originalFrameGeometry;
  fixture.working = dryRunEditorCapability("set_frame_cross_page", { unitId: spread.id, frameId: frame.id, enabled: false }, context()).result.working;

  const created = dryRunEditorCapability("create_dialogue_balloon", { unitId: spread.id, frameId: frame.id, position: { x: .3, y: .2 } }, context());
  const balloonCommand = created.commands.find((command) => command.type === "add_layer_element");
  if (!balloonCommand || balloonCommand.type !== "add_layer_element" || balloonCommand.element.kind !== "balloon") throw new Error("missing created balloon");
  const balloonId = balloonCommand.element.id;
  fixture.working = created.result.working;
  const currentFrame = fixture.working.document.units.find((unit) => unit.id === spread.id)!.frames.find((candidate) => candidate.id === frame.id)!;
  const balloonLayer = currentFrame.layers.find((layer) => layer.elements.some((element) => element.id === balloonId))!;
  fixture.working = dryRunEditorCapability("convert_balloon_to_cross_page", { unitId: spread.id, frameId: frame.id, layerId: balloonLayer.id, elementId: balloonId }, context()).result.working;
  const crossLayer = fixture.working.document.units.find((unit) => unit.id === spread.id)!.overlayLayers.find((layer) => layer.purpose === "cross_page")!;
  assert.equal(crossLayer.anchor.type, "unit");
  assert.equal(crossLayer.elements.some((element) => element.id === balloonId && element.kind === "balloon"), true);
  const containedBalloonSplit = dryRunEditorCapability("split_spread_to_pages", { unitId: spread.id }, context());
  const splitBalloonLayer = containedBalloonSplit.result.working.document.units.flatMap((unit) => unit.overlayLayers).find((layer) => layer.elements.some((element) => element.id === balloonId));
  assert.equal(splitBalloonLayer?.purpose, "page_content");
  const crossBalloon = crossLayer.elements.find((element) => element.id === balloonId)!;
  const originalBalloonTransform = structuredClone(crossBalloon.transform);
  crossBalloon.transform = { ...crossBalloon.transform, x: spread.canvas.width / 2 - 10, width: 20 };
  assert.throws(() => dryRunEditorCapability("split_spread_to_pages", { unitId: spread.id }, context()), /跨越分隔线的对象/);
  crossBalloon.transform = originalBalloonTransform;
  assert.equal(dryRunEditorCapability("split_spread_to_pages", { unitId: spread.id }, context()).result.working.document.reading.unitOrder.length, 2);
});

test("a frame image must become paper-owned before it can become cross-page", () => {
  const fixture = createInitialFixture();
  let sequence = 0;
  const context = () => ({ fixture, createId: (prefix: string) => `${prefix}-frame-cross-${++sequence}`, actor: "human" as const });
  fixture.working = dryRunEditorCapability("create_page", {}, context()).result.working;
  const [firstId, secondId] = fixture.working.document.reading.unitOrder;
  fixture.working = dryRunEditorCapability("merge_pages_to_spread", { unitId: firstId, nextUnitId: secondId }, context()).result.working;
  const spread = fixture.working.document.units.find((unit) => unit.kind === "spread")!;
  const frame = spread.frames.find((candidate) => candidate.layers.some((layer) => layer.elements.some((element) => element.kind === "image")))!;
  const layer = frame.layers.find((candidate) => candidate.elements.some((element) => element.kind === "image"))!;
  const image = layer.elements.find((element) => element.kind === "image")!;
  assert.throws(() => dryRunEditorCapability("convert_image_to_cross_page", { unitId: spread.id, frameId: frame.id, layerId: layer.id, elementId: image.id }, context()), /先转为纸面图片/);
  fixture.working = dryRunEditorCapability("convert_element_to_page", { unitId: spread.id, frameId: frame.id, layerId: layer.id, elementId: image.id }, context()).result.working;
  const paperLayer = fixture.working.document.units.find((unit) => unit.id === spread.id)!.overlayLayers.find((candidate) => candidate.purpose === "page_content" && candidate.elements.some((element) => element.id === image.id))!;
  const converted = dryRunEditorCapability("convert_image_to_cross_page", { unitId: spread.id, layerId: paperLayer.id, elementId: image.id }, context());
  const convertedSpread = converted.result.working.document.units.find((unit) => unit.id === spread.id)!;
  assert.equal(frameElements(convertedSpread.frames.find((candidate) => candidate.id === frame.id)!).some((element) => element.id === image.id), false);
  assert.equal(convertedSpread.overlayLayers.find((candidate) => candidate.purpose === "cross_page")?.elements.some((element) => element.id === image.id), true);
});

test("page grouping never pairs an ordinary page across a true spread", () => {
  const fixture = createInitialFixture();
  let sequence = 0;
  const context = () => ({ fixture, createId: (prefix: string) => `${prefix}-group-${++sequence}`, actor: "human" as const });
  for (let index = 0; index < 3; index += 1) fixture.working = dryRunEditorCapability("create_page", {}, context()).result.working;
  const [, secondId, thirdId] = fixture.working.document.reading.unitOrder;
  fixture.working = dryRunEditorCapability("merge_pages_to_spread", { unitId: secondId, nextUnitId: thirdId }, context()).result.working;
  const spreadId = fixture.working.document.reading.unitOrder[1];
  assert.deepEqual(pageDisplayGroups(fixture.working.document, "single"), [
    { unitIndices: [0], unitIds: [fixture.working.document.reading.unitOrder[0]], trueSpread: false },
    { unitIndices: [1], unitIds: [spreadId], trueSpread: true },
    { unitIndices: [2], unitIds: [fixture.working.document.reading.unitOrder[2]], trueSpread: false },
  ]);
  assert.deepEqual(pageDisplayGroups(fixture.working.document, "spread"), pageDisplayGroups(fixture.working.document, "single"));
});

test("RTL spread merge keeps the first reading unit on the physical right", () => {
  const fixture = createInitialFixture();
  fixture.working.document.reading.direction = "rtl";
  let sequence = 0;
  const context = () => ({ fixture, createId: (prefix: string) => `${prefix}-rtl-${++sequence}`, actor: "human" as const });
  const firstOriginalId = fixture.working.document.units[0].id;
  fixture.working = dryRunEditorCapability("create_page", {}, context()).result.working;
  const [firstId, secondId] = fixture.working.document.reading.unitOrder;
  const result = dryRunEditorCapability("merge_pages_to_spread", { unitId: firstId, nextUnitId: secondId }, context());
  const spread = result.result.working.document.units.find((unit) => unit.kind === "spread")!;
  const firstSurfaceId = fixture.working.document.units.find((unit) => unit.id === firstOriginalId)!.surfaces[0].id;
  const firstSurface = spread.surfaces.find((surface) => surface.id === firstSurfaceId)!;
  assert.equal(firstSurface.role, "right");
  assert.equal(firstSurface.geometry.x, spread.canvas.width / 2);
  assert.equal(spread.frames.some((frame) => frame.geometry.x >= spread.canvas.width / 2), true);
});

test("compound vertical segments support one cross-segment image and remain physically numbered", () => {
  const fixture = createInitialFixture();
  fixture.working.document = structuredClone(previewFixtures.vertical);
  let sequence = 0;
  const context = () => ({ fixture, createId: (prefix: string) => `${prefix}-vertical-${++sequence}`, actor: "human" as const });
  fixture.working = dryRunEditorCapability("create_vertical_segment", { aspectRatio: "9:16" }, context()).result.working;
  const [firstId, secondId] = fixture.working.document.reading.unitOrder;
  fixture.working = dryRunEditorCapability("merge_vertical_segments", { unitId: firstId, nextUnitId: secondId }, context()).result.working;
  const compound = fixture.working.document.units.find((unit) => unit.kind === "vertical_segment" && unit.surfaces.length === 2)!;
  assert.deepEqual(compound.surfaces.map((surface) => surface.pageNumber), [1, 2]);
  assert.equal(compound.surfaces[1].geometry.y, compound.surfaces[0].geometry.height);
  const resource = fixture.working.document.resources[0];
  const crossed = dryRunEditorCapability("create_cross_segment_image", { unitId: compound.id, assetId: resource.assetId, assetVersionId: resource.assetVersionId, mediaType: resource.mediaType }, context());
  const crossLayer = crossed.result.working.document.units.find((unit) => unit.id === compound.id)?.overlayLayers.find((layer) => layer.purpose === "cross_segment");
  assert.equal(crossLayer?.elements.length, 1);
  assert.equal(crossLayer?.surfaceId, undefined);
  fixture.working = crossed.result.working;
  assert.throws(() => dryRunEditorCapability("split_vertical_segments", { unitId: compound.id }, context()), /跨越分隔线的对象/);
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

test("page objects, breakout and frame overlap preserve explicit ownership and visual geometry", () => {
  const fixture = createInitialFixture();
  const unit = fixture.working.document.units[0];
  const frame = unit.frames[0];
  const imageLayer = frame.layers.find((layer) => layer.kind === "art")!;
  const image = imageLayer.elements.find((element) => element.kind === "image")!;
  let sequence = 0;
  const context = () => ({ fixture, createId: (prefix: string) => `${prefix}-overlay-${++sequence}`, actor: "human" as const });
  const beforeGeometry = resolveLocalTransform(frame.geometry, image.transform);

  const promoted = dryRunEditorCapability("promote_element_to_overlay", {
    unitId: unit.id, frameId: frame.id, layerId: imageLayer.id, elementId: image.id,
  }, context());
  fixture.working = promoted.result.working;
  const promotedUnit = fixture.working.document.units[0];
  const promotedLayer = promotedUnit.overlayLayers.find((layer) => layer.purpose === "breakout");
  assert.deepEqual(promotedLayer?.anchor, { type: "frame", frameId: frame.id });
  assert.equal(promotedLayer?.elements[0]?.id, image.id);
  const promotedView = createComicPageView(fixture.working.document, promotedUnit).elements.find((element) => element.id === image.id);
  assert.deepEqual(promotedView?.geometry, beforeGeometry);
  assert.deepEqual(promotedView?.type === "image" ? promotedView.location : undefined, { space: "overlay", layerId: promotedLayer?.id, anchor: { type: "frame", frameId: frame.id }, purpose: "breakout" });

  const converted = dryRunEditorCapability("convert_element_to_page", { unitId: unit.id, layerId: promotedLayer!.id, elementId: image.id }, context());
  fixture.working = converted.result.working;
  const convertedUnit = fixture.working.document.units[0];
  const convertedLayer = convertedUnit.overlayLayers.find((layer) => layer.purpose === "page_content");
  assert.deepEqual(convertedLayer?.anchor, { type: "unit" });
  assert.equal(convertedUnit.overlayLayers.some((layer) => layer.id === promotedLayer!.id), false);
  const convertedView = createComicPageView(fixture.working.document, convertedUnit).elements.find((element) => element.id === image.id);
  assert.deepEqual(convertedView?.geometry, beforeGeometry);
  assert.deepEqual(convertedView?.type === "image" && convertedView.location.space === "overlay" ? convertedView.location.anchor : undefined, { type: "unit" });

  const returned = dryRunEditorCapability("return_element_to_frame", {
    unitId: unit.id, frameId: frame.id, layerId: convertedLayer!.id, elementId: image.id,
  }, context());
  fixture.working = returned.result.working;
  const returnedUnit = fixture.working.document.units[0];
  assert.equal(returnedUnit.overlayLayers.some((layer) => layer.id === convertedLayer!.id), false);
  const returnedImage = frameElements(returnedUnit.frames[0]).find((element) => element.id === image.id);
  assert.ok(returnedImage?.kind === "image");
  assert.deepEqual(resolveLocalTransform(returnedUnit.frames[0].geometry, returnedImage.transform), beforeGeometry);

  const returnedArtLayer = returnedUnit.frames[0].layers.find((layer) => layer.elements.some((element) => element.id === image.id))!;
  const promotedAgain = dryRunEditorCapability("promote_element_to_overlay", { unitId: unit.id, frameId: frame.id, layerId: returnedArtLayer.id, elementId: image.id }, context());
  fixture.working = promotedAgain.result.working;
  const movedBreakoutLayer = fixture.working.document.units[0].overlayLayers.find((layer) => layer.purpose === "breakout")!;
  const occupiedFrame = dryRunEditorCapability("place_frame_image", {
    unitId: unit.id, frameId: frame.id, assetId: fixture.working.document.resources[0].assetId, assetVersionId: fixture.working.document.resources[0].assetVersionId, mediaType: fixture.working.document.resources[0].mediaType,
  }, context());
  fixture.working = occupiedFrame.result.working;
  assert.throws(() => dryRunEditorCapability("return_element_to_frame", { unitId: unit.id, frameId: frame.id, layerId: movedBreakoutLayer.id, elementId: image.id }, context()), /画格内已有图片/);
  const occupiedUnit = fixture.working.document.units[0];
  const occupiedArtLayer = occupiedUnit.frames[0].layers.find((layer) => layer.elements.some((element) => element.kind === "image"))!;
  const occupiedImage = occupiedArtLayer.elements.find((element) => element.kind === "image")!;
  const replacedFrame = dryRunEditorCapability("return_element_to_frame", { unitId: unit.id, frameId: frame.id, layerId: movedBreakoutLayer.id, elementId: image.id, replaceExistingImage: true }, context());
  fixture.working = replacedFrame.result.working;
  assert.equal(frameElements(fixture.working.document.units[0].frames[0]).some((element) => element.id === occupiedImage.id), false);
  assert.equal(frameElements(fixture.working.document.units[0].frames[0]).some((element) => element.id === image.id), true);
  assert.equal(fixture.working.document.units[0].overlayLayers.some((layer) => layer.elements.some((element) => element.id === image.id)), false);
  const replacementLayer = fixture.working.document.units[0].frames[0].layers.find((layer) => layer.elements.some((element) => element.id === image.id))!;
  fixture.working = dryRunEditorCapability("promote_element_to_overlay", { unitId: unit.id, frameId: frame.id, layerId: replacementLayer.id, elementId: image.id }, context()).result.working;
  const movedBreakoutLayerAgain = fixture.working.document.units[0].overlayLayers.find((layer) => layer.purpose === "breakout" && layer.elements.some((element) => element.id === image.id))!;
  const movedBreakout = dryRunEditorCapability("set_element_transform", { unitId: unit.id, layerId: movedBreakoutLayerAgain.id, elementId: image.id, transform: { x: -.2, y: .1, width: .8, height: .8 } }, context());
  fixture.working = movedBreakout.result.working;
  const returnedMovedBreakout = dryRunEditorCapability("return_element_to_frame", { unitId: unit.id, frameId: frame.id, layerId: movedBreakoutLayerAgain.id, elementId: image.id }, context());
  fixture.working = returnedMovedBreakout.result.working;
  const normalizedImage = frameElements(fixture.working.document.units[0].frames[0]).find((element) => element.id === image.id);
  assert.ok(normalizedImage?.kind === "image");
  assert.deepEqual(normalizedImage.transform, { x: 0, y: 0, width: 1, height: 1 });

  const pageDialogue = dryRunEditorCapability("create_page_dialogue_balloon", { unitId: unit.id, position: { x: 320, y: 180 } }, context());
  fixture.working = pageDialogue.result.working;
  const pageLayer = fixture.working.document.units[0].overlayLayers.find((layer) => layer.purpose === "page_content");
  const pageBalloon = pageLayer?.elements.find((element) => element.kind === "balloon");
  assert.ok(pageBalloon?.kind === "balloon");
  const pageView = createComicPageView(fixture.working.document, fixture.working.document.units[0]).elements.find((element) => element.id === pageBalloon.id);
  assert.equal(pageView?.type === "speech_balloon" ? pageView.comicFrameId : "unexpected", undefined);
  assert.equal(pageView?.type === "speech_balloon" ? pageView.location.space : "unexpected", "overlay");

  const resource = fixture.working.document.resources[0];
  const pageImageResult = dryRunEditorCapability("create_page_image", { unitId: unit.id, position: { x: 420, y: 260 }, assetId: resource.assetId, assetVersionId: resource.assetVersionId, mediaType: resource.mediaType }, context());
  fixture.working = pageImageResult.result.working;
  const pageContent = fixture.working.document.units[0].overlayLayers.find((layer) => layer.purpose === "page_content")!;
  const reorderedOverlay = dryRunEditorCapability("reorder_overlay_element", { unitId: unit.id, layerId: pageContent.id, elementId: pageBalloon.id, position: "front" }, context());
  const reorderedUnit = reorderedOverlay.result.working.document.units[0];
  const balloonLayer = reorderedUnit.overlayLayers.find((layer) => layer.elements.some((element) => element.id === pageBalloon.id));
  assert.ok(balloonLayer);
  assert.ok((balloonLayer?.zIndex ?? 0) > Math.max(...reorderedUnit.frames.map((frame) => frame.zIndex), ...reorderedUnit.overlayLayers.filter((layer) => layer.id !== balloonLayer?.id).map((layer) => layer.zIndex)));

  const overlap = dryRunEditorCapability("set_frame_overlap_policy", { unitId: unit.id, frameOverlap: "allow" }, context());
  fixture.working = overlap.result.working;
  assert.equal(fixture.working.document.units[0].layoutPolicy.frameOverlap, "allow");
  const reordered = dryRunEditorCapability("reorder_frame", { unitId: unit.id, frameId: frame.id, zIndex: 99 }, context());
  assert.equal(reordered.result.working.document.units[0].frames.find((item) => item.id === frame.id)?.zIndex, 99);
});

test("restoring a workspace version is one validated revision", () => {
  const fixture = createInitialFixture();
  const originalDocument = structuredClone(fixture.working.document);
  const originalBeats = structuredClone(fixture.storyboardBeats);
  const frame = fixture.working.document.units[0].frames[0];
  let sequence = 0;
  const context = () => ({ fixture, createId: (prefix: string) => `${prefix}-restore-${++sequence}`, actor: "human" as const });
  fixture.working = dryRunEditorCapability("move_frame", { unitId: fixture.working.document.units[0].id, frameId: frame.id, position: { x: frame.geometry.x + 12, y: frame.geometry.y + 12 } }, context()).result.working;
  const restored = dryRunEditorCapability("restore_workspace_version", { document: originalDocument, storyboardBeats: originalBeats }, context());
  assert.deepEqual(restored.result.working.document, originalDocument);
  assert.deepEqual(restored.result.storyboardBeats, originalBeats);
  assert.equal(restored.result.working.revision, fixture.working.revision + 1);
  assert.deepEqual(restored.commands.map((command) => command.type), ["replace_chapter_presentation", "replace_storyboard_beats"]);
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
      input: { unitId: unit.id, frameId: frame.id, layerId: layer.id, elementId: balloon.id, changes: { transform: { ...balloon.transform, rotate: 28 }, shape: "thought", style: { ...balloon.style, fontSize: 22, strokeWidth: 4, writingMode: "vertical" } } },
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
  assert.equal(changed.style.fontSize, 22);
  assert.equal(changed.style.strokeWidth, 4);
  assert.equal(changed.style.writingMode, "vertical");
  assert.equal(changed.transform.rotate, 28);
  assert.equal(result.working.document.dialogues.find((dialogue) => dialogue.id === balloon.dialogueId)?.content, content);
  assert.deepEqual(fixture, before);
});

test("cut-corner dialogue gets a stable irregular octagon without a tail", () => {
  const fixture = createInitialFixture();
  const unit = fixture.working.document.units[0];
  const frame = unit.frames[0];
  const layer = frame.layers.find((item) => item.kind === "text");
  const balloon = layer?.elements.find((element): element is BalloonElement => element.kind === "balloon");
  assert.ok(layer && balloon);
  let sequence = 0;
  const context = () => ({ fixture, createId: (prefix: string) => `${prefix}-cut-${++sequence}`, actor: "human" as const });
  const result = dryRunEditorCapability("update_balloon", {
    unitId: unit.id,
    frameId: frame.id,
    layerId: layer.id,
    elementId: balloon.id,
    changes: { shape: "cut_corner" },
  }, context());
  const changed = frameElements(result.result.working.document.units[0].frames[0]).find((element) => element.id === balloon.id);
  assert.ok(changed?.kind === "balloon");
  assert.equal(changed.shape, "cut_corner");
  assert.ok(changed.cutCorners);
  const points = balloonCutCornerPoints(changed);
  assert.equal(points.length, 8);
  assert.equal(points[0].x, changed.cutCorners.topLeft.x * 2);
  assert.equal(points[2].y, changed.cutCorners.topRight.y * 2);
  assert.equal(new Set(Object.values(changed.cutCorners).flatMap((corner) => [corner.x, corner.y])).size > 4, true);
  assert.deepEqual(balloonCutCornerPoints(changed), points);
  const rerolled = dryRunEditorCapability("update_balloon", {
    unitId: unit.id,
    frameId: frame.id,
    layerId: layer.id,
    elementId: balloon.id,
    changes: { shape: "cut_corner" },
  }, context()).result.working.document.units[0].frames[0];
  const rerolledBalloon = frameElements(rerolled).find((element) => element.id === balloon.id);
  assert.ok(rerolledBalloon?.kind === "balloon");
  assert.notDeepEqual(rerolledBalloon.cutCorners, changed.cutCorners);
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

test("create_page inserts before or after a page unit and renumbers physical surfaces", () => {
  const fixture = createInitialFixture();
  const originalId = fixture.working.document.reading.unitOrder[0];
  const before = dryRunEditorCapability("create_page", { relativeToUnitId: originalId, side: "before" }, {
    fixture,
    createId: () => "page-before",
    actor: "human",
  });
  assert.deepEqual(before.result.working.document.reading.unitOrder.slice(0, 2), ["page-before", originalId]);
  assert.deepEqual(before.result.working.document.reading.unitOrder.flatMap((id) => before.result.working.document.units.find((unit) => unit.id === id)?.surfaces.map((surface) => surface.pageNumber) ?? []), [1, 2]);

  const afterFixture = { ...fixture, working: before.result.working, storyboardBeats: before.result.storyboardBeats };
  const after = dryRunEditorCapability("create_page", { relativeToUnitId: originalId, side: "after" }, {
    fixture: afterFixture,
    createId: () => "page-after",
    actor: "human",
  });
  assert.deepEqual(after.result.working.document.reading.unitOrder, ["page-before", originalId, "page-after"]);
  assert.deepEqual(after.result.working.document.reading.unitOrder.flatMap((id) => after.result.working.document.units.find((unit) => unit.id === id)?.surfaces.map((surface) => surface.pageNumber) ?? []), [1, 2, 3]);
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

test("presentation units duplicate after their source and move as complete units", () => {
  const fixture = createInitialFixture();
  let sequence = 0;
  const context = () => ({ fixture, createId: (prefix: string) => `${prefix}-unit-copy-${++sequence}`, actor: "human" as const });
  const source = fixture.working.document.units[0];
  const frame = source.frames[0];
  fixture.working = dryRunEditorCapability("create_dialogue_balloon", { unitId: source.id, frameId: frame.id, position: { x: .2, y: .2 } }, context()).result.working;
  if (!fixture.working.document.units[0].frames[0].storyRefs.some((reference) => reference.role === "primary")) {
    fixture.working = dryRunEditorCapability("create_frame_storyboard_beat", { unitId: source.id, frameId: frame.id, title: "原分镜", description: "原页面的画面描述。" }, context()).result.working;
  }

  const duplicated = dryRunEditorCapability("duplicate_presentation_unit", { unitId: source.id }, context());
  const [sourceId, copyId] = duplicated.result.working.document.reading.unitOrder;
  const copied = duplicated.result.working.document.units.find((unit) => unit.id === copyId)!;
  const sourceAfterPreparation = duplicated.result.working.document.units.find((unit) => unit.id === sourceId)!;
  assert.equal(duplicated.commands.some((command) => command.type === "add_presentation_unit"), true);
  assert.notEqual(copied.id, sourceAfterPreparation.id);
  assert.notEqual(copied.surfaces[0].id, sourceAfterPreparation.surfaces[0].id);
  assert.notEqual(copied.frames[0].id, sourceAfterPreparation.frames[0].id);
  const sourceBalloon = frameElements(sourceAfterPreparation.frames[0]).find((element) => element.kind === "balloon");
  const copiedBalloon = frameElements(copied.frames[0]).find((element) => element.kind === "balloon");
  assert.ok(sourceBalloon?.kind === "balloon" && copiedBalloon?.kind === "balloon");
  if (sourceBalloon?.kind !== "balloon" || copiedBalloon?.kind !== "balloon") throw new Error("missing copied balloon");
  assert.notEqual(copiedBalloon.dialogueId, sourceBalloon.dialogueId);
  assert.equal(duplicated.result.working.document.dialogues.find((dialogue) => dialogue.id === copiedBalloon.dialogueId)?.content, duplicated.result.working.document.dialogues.find((dialogue) => dialogue.id === sourceBalloon.dialogueId)?.content);
  assert.notEqual(copied.frames[0].storyRefs[0]?.storyboardBeatId, sourceAfterPreparation.frames[0].storyRefs[0]?.storyboardBeatId);

  const movedFixture = { ...fixture, working: duplicated.result.working, storyboardBeats: duplicated.result.storyboardBeats };
  const moved = dryRunEditorCapability("move_presentation_unit", { unitId: copyId, direction: "up" }, { fixture: movedFixture, createId: (prefix) => `${prefix}-move`, actor: "human" });
  assert.deepEqual(moved.result.working.document.reading.unitOrder, [copyId, sourceId]);
  assert.deepEqual(moved.result.working.document.reading.unitOrder.flatMap((id) => moved.result.working.document.units.find((unit) => unit.id === id)?.surfaces.map((surface) => surface.pageNumber) ?? []), [1, 2]);
  assert.throws(() => dryRunEditorCapability("move_presentation_unit", { unitId: copyId, direction: "up" }, { fixture: moved.result, createId: (prefix) => `${prefix}-move`, actor: "human" }), /最前面/);
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

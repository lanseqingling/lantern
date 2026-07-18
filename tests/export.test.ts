import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import sharp from "sharp";
import { compileChapterLayoutPlan } from "../packages/layout-engine/src";
import {
  createStructuredExportPayload,
  presentationUnitSurface,
  renderChapterLongPng,
  renderChapterPngPages,
  renderPagePng,
  renderSurfaceSvg,
} from "../packages/server/src/export-renderer";
import { projectBalloonStrokeWidths, projectComicRenderScene, projectImageCrop, scaleImageCrop, type ComicDocument, type StoryboardBeat } from "../packages/shared/src";

const storyboardBeats: StoryboardBeat[] = Array.from({ length: 8 }, (_, index) => ({
  id: `golden-storyboardBeat-${index + 1}`,
  versionId: `golden-storyboardBeat-${index + 1}-v1`,
  title: `节拍 ${index + 1}`,
  description: `${index % 2 ? "近景" : "远景"}中角色继续行动，主体与留白形成清楚阅读动线。`,
}));

function renderFixture(): ComicDocument {
  return {
    protocolVersion: "lcd-0.4",
    comicId: "render-comic",
    chapterId: "render-chapter",
    format: "page",
    reading: { direction: "ltr", viewer: "paged", unitOrder: ["unit-1"] },
    resources: [{ assetId: "asset-1", assetVersionId: "asset-1-v1", kind: "image", mediaType: "image/png" }],
    dialogues: [{ id: "dialogue-1", content: "保持三端一致，不应在导出时静默丢失任何内容，尤其需要完整保留最后一句对白。" }],
    units: [{
      id: "unit-1",
      kind: "single_page",
      canvas: { width: 200, height: 300, background: { color: "#f6f1e8" } },
      surfaces: [{ id: "surface-1", role: "single", geometry: { x: 0, y: 0, width: 200, height: 300 } }],
      frames: [{
        id: "frame-1",
        geometry: { x: 20, y: 30, width: 160, height: 180 },
        zIndex: 1,
        storyRefs: [],
        border: { color: "#123456", width: 3, style: "solid" },
        shape: { kind: "polygon", points: [{ x: 0, y: 0 }, { x: 1, y: 0.08 }, { x: 0.92, y: 1 }, { x: 0.05, y: 0.9 }] },
        mask: { mode: "clip" },
        layers: [
          { id: "art", name: "画面", kind: "art", zIndex: 10, visible: true, overflow: "inherit", elements: [{ id: "image-1", kind: "image", assetId: "asset-1", assetVersionId: "asset-1-v1", transform: { x: -0.1, y: 0, width: 1.2, height: 1 }, crop: { x: 0, y: 0, width: 1, height: 1 }, opacity: 0.8, blendMode: "multiply" }] },
          { id: "text", name: "文字", kind: "text", zIndex: 20, visible: true, overflow: "visible", elements: [
            { id: "text-1", kind: "text", transform: { x: 0.08, y: 0.66, width: 0.5, height: 0.2 }, content: "旁白", role: "narration", style: { fontFamily: "Lantern Sans", fontSize: 14, fontWeight: 700, color: "#334455", align: "left", writingMode: "horizontal" } },
            { id: "balloon-1", kind: "balloon", dialogueId: "dialogue-1", transform: { x: 0.42, y: 0.08, width: 0.42, height: 0.28 }, tailTarget: { x: 0.8, y: 0.58 }, shape: "normal", style: { fontFamily: "Lantern Sans", fontSize: 12, textColor: "#172026", fill: "#fffdf8", stroke: "#234567", strokeWidth: 2 } },
          ] },
          { id: "hidden", name: "隐藏", kind: "effect", zIndex: 30, visible: false, overflow: "visible", elements: [{ id: "hidden-effect", kind: "effect", effectType: "custom", transform: { x: 0, y: 0, width: 1, height: 1 }, assetId: "asset-1", assetVersionId: "asset-1-v1" }] },
        ],
      }],
      overlayLayers: [{ id: "overlay", name: "破框", zIndex: 1, visible: true, anchor: { type: "frame", frameId: "frame-1" }, purpose: "breakout", elements: [{ id: "overlay-text", kind: "text", transform: { x: 0.5, y: -0.05, width: 0.45, height: 0.2 }, content: "破框文字", role: "sfx", style: { fontFamily: "Lantern Sans", fontSize: 18, color: "#111111", align: "center", writingMode: "vertical" } }] }],
      readingSequence: [{ frameId: "frame-1" }],
      layoutPolicy: { frameOverlap: "allow", defaultOverflow: "clip" },
    }],
  };
}

test("shared render scene defines visibility, clipping, geometry and overlay order", () => {
  const document = renderFixture();
  const unit = document.units[0];
  const scene = projectComicRenderScene(document, unit);
  assert.deepEqual(scene.elements.map((node) => node.element.id), ["image-1", "text-1", "balloon-1", "overlay-text"]);
  assert.equal(scene.elements[0].clipFrame?.id, "frame-1");
  assert.equal(scene.elements[1].clipFrame, undefined);
  assert.deepEqual(scene.elements.at(-1)?.geometry, { x: 100, y: 21, width: 72, height: 36 });
  assert.ok((scene.elements.at(-1)?.zIndex ?? 0) > scene.frames[0].borderZIndex);
  const raisedFrame = structuredClone(document);
  raisedFrame.units[0].frames[0].zIndex = 2;
  const raisedScene = projectComicRenderScene(raisedFrame, raisedFrame.units[0]);
  assert.ok((raisedScene.elements.find((node) => node.element.id === "image-1")?.zIndex ?? 0) > (raisedScene.elements.find((node) => node.element.id === "overlay-text")?.zIndex ?? 0));
  const balloon = scene.elements.find((node) => node.element.kind === "balloon")?.element;
  assert.ok(balloon?.kind === "balloon");
  assert.deepEqual(projectBalloonStrokeWidths({ ...balloon, shape: "thought" }), { outline: 1.8, tail: 1.8 });
  assert.deepEqual(projectBalloonStrokeWidths({ ...balloon, shape: "caption_box" }), { outline: 1.8, tail: 1.8 });
});

test("image crop uses one projection for workbench and export", () => {
  assert.deepEqual(projectImageCrop({ x: .1, y: .2, width: .5, height: .4 }), { x: -.2, y: -.5, width: 2, height: 2.5 });
});

test("crop zoom keeps the pointer anchor and never shrinks the projected image below its frame", () => {
  const zoomedIn = scaleImageCrop({ x: .1, y: .2, width: .5, height: .4 }, .5, { x: .25, y: .75 });
  assert.deepEqual(zoomedIn, { x: .1625, y: .35, width: .25, height: .2 });
  const sourceAnchorBefore = { x: .1 + .5 * .25, y: .2 + .4 * .75 };
  const sourceAnchorAfter = { x: zoomedIn.x + zoomedIn.width * .25, y: zoomedIn.y + zoomedIn.height * .75 };
  assert.deepEqual(sourceAnchorAfter, sourceAnchorBefore);

  const zoomedOut = scaleImageCrop(zoomedIn, 100, { x: .5, y: .5 });
  const projection = projectImageCrop(zoomedOut);
  assert.equal(zoomedOut.width, 1);
  assert.equal(zoomedOut.height, .8);
  assert.ok(projection.width >= 1);
  assert.ok(projection.height >= 1);
  assert.ok(zoomedOut.x >= 0 && zoomedOut.y >= 0);
  assert.ok(zoomedOut.x + zoomedOut.width <= 1);
  assert.ok(zoomedOut.y + zoomedOut.height <= 1);
});

test("export consumes the same render scene semantics", () => {
  const document = renderFixture();
  const unit = document.units[0];
  const svg = renderSurfaceSvg(document, unit, unit.surfaces[0], new Map([["asset-1-v1", "data:image/png;base64,AA=="]]));
  assert.match(svg, /<polygon/);
  assert.match(svg, /<polygon[^>]+stroke="#123456"[^>]+stroke-width="3"/);
  assert.match(svg, /fill="#f6f1e8"/);
  assert.match(svg, /data-scene-id="image-1"[^>]+mix-blend-mode:multiply[^>]+clip-path=/);
  assert.match(svg, /data-scene-id="balloon-1"/);
  assert.match(svg, /stroke="#234567"/);
  assert.match(svg, /stroke-width="2.5" vector-effect="non-scaling-stroke"/);
  assert.match(svg, /stroke-width="1.4"[^>]+vector-effect="non-scaling-stroke"/);
  assert.equal(svg.match(/vector-effect="non-scaling-stroke"/g)?.length, 2);
  assert.match(svg, /保持三端一致/);
  assert.match(svg, />白。<\/tspan>/);
  assert.match(svg, /data-scene-id="overlay-text"/);
  assert.doesNotMatch(svg, /hidden-effect/);
});

test("cross-page images, frames and balloons are projected into both physical surface exports", () => {
  const document = renderFixture();
  const unit = document.units[0];
  unit.kind = "spread";
  unit.canvas.width = 400;
  unit.surfaces = [
    { id: "surface-left", role: "left", geometry: { x: 0, y: 0, width: 200, height: 300 }, pageNumber: 1 },
    { id: "surface-right", role: "right", geometry: { x: 200, y: 0, width: 200, height: 300 }, pageNumber: 2 },
  ];
  unit.frames[0].surfaceScope = "unit";
  unit.frames[0].geometry = { x: 120, y: 30, width: 160, height: 180 };
  unit.overlayLayers.push({
    id: "cross-page-layer", name: "跨页", zIndex: 2, visible: true, anchor: { type: "unit" }, purpose: "cross_page",
    elements: [
      { id: "cross-page-image", kind: "image", assetId: "asset-1", assetVersionId: "asset-1-v1", transform: { x: 0, y: 0, width: 400, height: 300 }, crop: { x: 0, y: 0, width: 1, height: 1 } },
      { id: "cross-page-balloon", kind: "balloon", dialogueId: "dialogue-1", transform: { x: 160, y: 80, width: 80, height: 90 }, shape: "caption_box", style: { fontFamily: "Lantern Sans", fontSize: 12, textColor: "#172026", fill: "#ffffff", stroke: "#111111", strokeWidth: 2 } },
    ],
  });
  const assets = new Map([["asset-1-v1", "data:image/png;base64,AA=="]]);
  const left = renderSurfaceSvg(document, unit, unit.surfaces[0], assets);
  const right = renderSurfaceSvg(document, unit, unit.surfaces[1], assets);
  assert.match(left, /viewBox="0 0 200 300"/);
  assert.match(right, /viewBox="200 0 200 300"/);
  assert.equal(left.match(/data-scene-id="cross-page-image"/g)?.length, 1);
  assert.equal(right.match(/data-scene-id="cross-page-image"/g)?.length, 1);
  assert.equal(left.match(/data-scene-id="image-1"/g)?.length, 1);
  assert.equal(right.match(/data-scene-id="image-1"/g)?.length, 1);
  assert.equal(left.match(/data-scene-id="cross-page-balloon"/g)?.length, 1);
  assert.equal(right.match(/data-scene-id="cross-page-balloon"/g)?.length, 1);
});

test("true spread page download renders the complete presentation canvas", async () => {
  const document = renderFixture();
  const unit = document.units[0];
  unit.kind = "spread";
  unit.canvas.width = 400;
  unit.surfaces = [
    { id: "surface-left", role: "left", geometry: { x: 0, y: 0, width: 200, height: 300 }, pageNumber: 1 },
    { id: "surface-right", role: "right", geometry: { x: 200, y: 0, width: 200, height: 300 }, pageNumber: 2 },
  ];
  document.resources = [];

  assert.deepEqual(presentationUnitSurface(unit).geometry, { x: 0, y: 0, width: 400, height: 300 });
  const metadata = await sharp(await renderPagePng(document, unit)).metadata();
  assert.equal(metadata.width, 400);
  assert.equal(metadata.height, 300);

  const physicalMetadata = await sharp(await renderPagePng(document, unit, unit.surfaces[1])).metadata();
  assert.equal(physicalMetadata.width, 200);
  assert.equal(physicalMetadata.height, 300);
});

test("PNG, long PNG and structured JSON match the persistent runtime export golden", async () => {
  const golden = JSON.parse(await readFile(new URL("./fixtures/export-golden.json", import.meta.url), "utf8"));
  const document = compileChapterLayoutPlan({
    format: "page",
    preset: "page_basic",
    readingOrder: storyboardBeats.map((storyboardBeat) => storyboardBeat.id),
  }, storyboardBeats);
  document.comicId = "golden-comic";
  document.chapterId = "golden-chapter";

  const pageBuffers = await renderChapterPngPages(document);
  assert.equal(pageBuffers.length, golden.pageCount);
  for (const buffer of pageBuffers) {
    const metadata = await sharp(buffer).metadata();
    assert.equal(metadata.format, "png");
    assert.equal(metadata.width, golden.pageWidth);
    assert.equal(metadata.height, golden.pageHeight);
  }

  const longBuffer = await renderChapterLongPng(document, pageBuffers);
  const longMetadata = await sharp(longBuffer).metadata();
  assert.equal(longMetadata.format, "png");
  assert.equal(longMetadata.width, golden.longWidth);
  assert.equal(longMetadata.height, golden.longHeight);

  const payload = createStructuredExportPayload({
    document,
    storyboardBeats,
    assetVersions: golden.assetVersionHeads,
    exportedAt: "2026-07-12T00:00:00.000Z",
  });
  assert.equal(payload.protocol, golden.protocol);
  assert.equal(payload.lcd.units.length, golden.pageCount);
  assert.equal((payload.storyboardBeats as StoryboardBeat[]).length, golden.storyboardBeatCount);
  assert.equal((payload.storyboardBeats as StoryboardBeat[])[0].versionId, golden.firstStoryboardBeatVersion);
  assert.equal((payload.storyboardBeats as StoryboardBeat[]).at(-1)?.versionId, golden.lastStoryboardBeatVersion);
  assert.deepEqual(payload.assetVersions, golden.assetVersionHeads);
});

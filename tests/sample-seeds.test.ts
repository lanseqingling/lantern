import assert from "node:assert/strict";
import test from "node:test";
import { dryRunEditorCapability } from "@lantern/editor-core";
import type { Frame } from "@lantern/shared";
import type { StoredObject } from "@lantern/server/object-storage";
import { buildCampusLetterDocument, storyboardBeats } from "../samples/campus-letter/seed";

const storedObject: StoredObject = {
  objectKey: "samples/test.png",
  contentType: "image/png",
  byteSize: 1,
  checksum: "test",
  width: 1024,
  height: 1024,
};

function mapFiles(files: readonly string[]) {
  return new Map(files.map((fileName) => [fileName, storedObject]));
}

function frameImage(frame: Frame) {
  const element = frame.layers[0].elements[0];
  assert.equal(element.kind, "image");
  if (element.kind !== "image") throw new Error(`Expected image element in ${frame.id}`);
  return element;
}

test("built-in comic data rebuilds the latest page and spread composition with stable assets", () => {
  const document = buildCampusLetterDocument(mapFiles([
    "character-xiakui.png",
    "character-lincheng.png",
    "cover-before-wind-composite.png",
    "title-before-wind.png",
    "classroom-lesson-v2.png",
    "classroom-turn-v2.png",
    "bag-letter-v2.png",
    "classroom-after-bell-v2.png",
    "letter-from-black-bag-closeup-v10.png",
    "window-tree-shadow-v4.png",
    "breakout-rendezvous-v2.png",
    "breakout-rendezvous-crown-v2.png",
    "campus-route.png",
    "spread-rendezvous-girls-v6.png",
    "rendezvous-running-letter-closeup.png",
    "campus-sky-clouds.png",
    "rendezvous-friend-closeup-v8.png",
  ]) as Parameters<typeof buildCampusLetterDocument>[0]);

  assert.deepEqual(document.reading.unitOrder, ["campus-cover", "campus-page-01", "campus-page-02", "campus-page-03", "campus-spread-04-05"]);
  const cover = document.units.find((unit) => unit.id === "campus-cover")!;
  assert.equal(cover.pageRole, "cover");
  assert.equal(cover.surfaces[0].pageNumber, undefined);
  assert.equal(cover.frames.length, 0);
  assert.equal(cover.overlayLayers.some((layer) => layer.id === "campus-cover-title-art"), false);
  assert.equal(cover.overlayLayers.find((layer) => layer.id === "campus-cover-chapter-title")?.elements.length, 1);
  assert.equal(cover.overlayLayers.find((layer) => layer.id === "campus-cover-chapter-title")?.surfaceId, "campus-cover-surface");
  const coverChapterTitle = cover.overlayLayers
    .find((layer) => layer.id === "campus-cover-chapter-title")
    ?.elements.find((element) => element.id === "campus-cover-title-chapter");
  assert.equal(coverChapterTitle?.kind, "text");
  assert.equal(coverChapterTitle?.kind === "text" ? coverChapterTitle.role : undefined, "narration");
  assert.deepEqual(coverChapterTitle?.transform, {
    x: 679.5181686046512,
    y: 859.7696220930233,
    width: 27.03997093023258,
    height: 211.5588662790698,
  });
  assert.equal(coverChapterTitle?.kind === "text" ? coverChapterTitle.style.writingMode : undefined, "vertical");
  const verticalTitle = dryRunEditorCapability("update_narration", {
    unitId: cover.id,
    layerId: "campus-cover-chapter-title",
    elementId: "campus-cover-title-chapter",
    changes: { writingMode: "vertical" },
  }, {
    fixture: {
      working: {
        documentId: "campus-sample-test",
        chapterId: document.chapterId,
        projectId: "campus-sample-test-project",
        createdAt: new Date(0).toISOString(),
        state: "working",
        revision: 1,
        document,
      },
      storyboardBeats,
    },
    createId: (prefix) => `${prefix}-sample-test`,
    actor: "human",
  });
  const updatedCoverTitle = verticalTitle.result.working.document.units
    .find((unit) => unit.id === "campus-cover")
    ?.overlayLayers.flatMap((layer) => layer.elements)
    .find((element) => element.id === "campus-cover-title-chapter");
  assert.equal(updatedCoverTitle?.kind === "text" ? updatedCoverTitle.style.writingMode : undefined, "vertical");

  const page2 = document.units.find((unit) => unit.id === "campus-page-02")!;
  const letterFrame = page2.frames.find((frame) => frame.id === "campus-frame-06")!;
  const shadowFrame = page2.frames.find((frame) => frame.id === "campus-frame-07")!;
  assert.deepEqual(frameImage(letterFrame).crop, { x: 0.0563387056958035, y: 0, width: 0.8038186387529933, height: 0.8038186387529933 });
  assert.deepEqual(frameImage(shadowFrame).crop, { x: 0.1772824494643256, y: 0.2211066844855711, width: 0.6669768108584753, height: 0.6669768108584753 });
  assert.equal(page2.overlayLayers.find((layer) => layer.id === "campus-page-02-caption")?.surfaceId, "campus-page-02-surface");
  assert.equal(page2.frames.find((frame) => frame.id === "campus-frame-05")?.layers.some((layer) => layer.kind === "text"), false);
  const letterDialogue = document.dialogues.find((dialogue) => dialogue.id === "campus-dialogue-letter");
  assert.equal(letterDialogue?.content, "放学后，旧看台。");
  const letterBalloon = page2.overlayLayers
    .find((layer) => layer.id === "campus-page-02-caption")
    ?.elements.find((element) => element.id === "campus-balloon-letter");
  assert.deepEqual(letterBalloon?.transform, { x: 383.5013111888112, y: 407.6883741258741, width: 168, height: 52 });
  const page1 = document.units.find((unit) => unit.id === "campus-page-01")!;
  assert.equal(page1.frames.find((frame) => frame.id === "campus-frame-02")?.layers.length, 1);

  const page3 = document.units.find((unit) => unit.id === "campus-page-03")!;
  assert.equal(page3.frames.length, 3);
  assert.deepEqual(page3.overlayLayers, []);
  const runningFrame = page3.frames.find((frame) => frame.id === "campus-frame-10")!;
  assert.deepEqual(runningFrame.geometry, { x: 55, y: 570, width: 575.0524635036496, height: 293.845802919708 });
  assert.equal(runningFrame.surfaceScope, undefined);
  assert.equal(frameImage(runningFrame).assetId, "campus-asset-rendezvous-letter-run");
  assert.deepEqual(frameImage(runningFrame).crop, { x: 0, y: 3.33066907387547e-16, width: 0.943818281762779, height: 0.9999999999999997 });
  const skyFrame = page3.frames.find((frame) => frame.id === "campus-frame-11")!;
  assert.deepEqual(skyFrame.geometry, { x: 137.8581204379562, y: 893.8115875912409, width: 519.9846070899904, height: 137.2513207595324 });
  assert.ok(skyFrame.geometry.x > page3.canvas.width - skyFrame.geometry.x - skyFrame.geometry.width);
  assert.equal(frameImage(skyFrame).assetId, "campus-asset-sky-wind");
  assert.deepEqual(frameImage(skyFrame).crop, { x: 0, y: 0.1300726645860639, width: 1, height: 0.5524923848284263 });
  assert.equal(page3.frames.some((frame) => frame.id === "campus-frame-11-pause"), false);

  const spread = document.units.find((unit) => unit.id === "campus-spread-04-05")!;
  assert.deepEqual(spread.surfaces.map((surface) => surface.pageNumber), [4, 5]);
  assert.equal(spread.overlayLayers.some((layer) => layer.id === "campus-spread-birds"), false);
  assert.deepEqual(spread.frames.find((frame) => frame.id === "campus-frame-13")?.geometry, {
    x: 1020.241279069768,
    y: 756.3059593023257,
    width: 334.7056686046512,
    height: 233.9658430232558,
  });
  const spreadDialogueElements = spread.overlayLayers.find((layer) => layer.id === "campus-spread-cross-page")?.elements;
  assert.equal(spreadDialogueElements?.length, 1);
  const spreadCallElement = spreadDialogueElements?.[0];
  assert.equal(spreadCallElement?.kind, "balloon");
  assert.equal(spreadCallElement?.kind === "balloon" ? spreadCallElement.dialogueId : undefined, "campus-dialogue-spread-call");
  assert.deepEqual(spreadCallElement?.transform, {
    x: 568,
    y: 196,
    width: 126.7303779069767,
    height: 66.14970930232558,
  });
  assert.deepEqual(spreadCallElement?.kind === "balloon" ? spreadCallElement.tailTarget : undefined, {
    x: 555,
    y: 284,
  });
  const spreadCall = document.dialogues.find((dialogue) => dialogue.id === "campus-dialogue-spread-call");
  assert.equal(spreadCall?.speakerAssetId, "campus-asset-xiakui");
  assert.equal(spreadCall?.content, "林澄！");
  assert.equal(document.dialogues.some((dialogue) => dialogue.content === "林澄今天也没来。"), false);
  assert.equal(document.dialogues.some((dialogue) => dialogue.content === "你还是来了。"), false);
  assert.equal(document.dialogues.some((dialogue) => dialogue.content.includes("明天以后")), false);
  assert.equal(document.dialogues.length, 4);
  assert.deepEqual(frameImage(spread.frames.find((frame) => frame.id === "campus-frame-13")!).crop, { x: 0.14, y: 0.12, width: 0.76, height: 0.76 });
  assert.ok(document.resources.every((resource) => resource.assetId.startsWith("campus-asset-")));
});

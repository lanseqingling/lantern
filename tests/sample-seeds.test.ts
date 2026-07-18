import assert from "node:assert/strict";
import test from "node:test";
import type { Frame } from "../packages/shared/src";
import type { StoredObject } from "../packages/server/src/object-storage";
import { buildCampusLetterDocument } from "../samples/campus-letter/seed";
import { buildRainyStationDocument } from "../samples/rainy-station/seed";

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

test("campus sample rebuilds the latest page and spread composition with stable assets", () => {
  const document = buildCampusLetterDocument(mapFiles([
    "character-xiakui.png",
    "classroom-lesson-v2.png",
    "classroom-turn-v2.png",
    "bag-letter-v2.png",
    "classroom-after-bell-v2.png",
    "letter-from-black-bag-closeup-v10.png",
    "window-tree-shadow-v4.png",
    "breakout-rendezvous-v2.png",
    "breakout-rendezvous-crown-v2.png",
    "spread-rendezvous-girls-v3.png",
    "rendezvous-running-step.png",
    "rendezvous-friend-closeup-v3.png",
    "spread-birds-v3.png",
  ]) as Parameters<typeof buildCampusLetterDocument>[0]);

  const page2 = document.units.find((unit) => unit.id === "campus-page-02")!;
  const letterFrame = page2.frames.find((frame) => frame.id === "campus-frame-06")!;
  const shadowFrame = page2.frames.find((frame) => frame.id === "campus-frame-07")!;
  assert.deepEqual(frameImage(letterFrame).crop, { x: 0.0563387056958035, y: 0, width: 0.8038186387529933, height: 0.8038186387529933 });
  assert.deepEqual(frameImage(shadowFrame).crop, { x: 0.1772824494643256, y: 0.2211066844855711, width: 0.6669768108584753, height: 0.6669768108584753 });
  assert.equal(page2.overlayLayers.find((layer) => layer.id === "campus-page-02-caption")?.surfaceId, "campus-page-02-surface");

  const spread = document.units.find((unit) => unit.id === "campus-spread-03-04")!;
  const runningInset = spread.frames.find((frame) => frame.id === "campus-frame-10")!;
  assert.deepEqual(runningInset.geometry, { x: 63.00581395348826, y: 68.8466569767441, width: 178.1184593023256, height: 260.5566860465116 });
  assert.equal(runningInset.zIndex, 3);
  assert.equal(runningInset.surfaceScope, "unit");
  assert.deepEqual(frameImage(runningInset).crop, { x: 0, y: 0.06861415908469679, width: 0.92, height: 0.92 });
  assert.deepEqual(spread.frames.find((frame) => frame.id === "campus-frame-11")?.geometry, {
    x: 1020.241279069768,
    y: 756.3059593023257,
    width: 334.7056686046512,
    height: 233.9658430232558,
  });
  assert.equal(spread.overlayLayers.find((layer) => layer.id === "campus-spread-cross-page")?.elements.length, 1);
  assert.equal(document.dialogues.length, 2);
  assert.ok(document.resources.every((resource) => resource.assetId.startsWith("campus-asset-")));
});

test("rainy station sample rebuilds the latest crop and balloon presentation without runtime leftovers", () => {
  const document = buildRainyStationDocument(mapFiles([
    "frame-01.png",
    "frame-02.png",
    "frame-03.png",
    "frame-04.png",
    "frame-05.png",
    "frame-06.png",
    "frame-07.png",
    "frame-08.png",
  ]));

  assert.deepEqual(document.reading.unitOrder, ["rain-page-01", "rain-page-02"]);
  const frame1 = document.units[0].frames.find((frame) => frame.id === "rain-frame-01")!;
  const frame3 = document.units[0].frames.find((frame) => frame.id === "rain-frame-03")!;
  assert.deepEqual(frameImage(frame1).crop, { x: 0.05153518356643357, y: 0.01500907746100054, width: 0.92, height: 0.92 });
  assert.equal(frame3.layers[1].elements[0].kind, "balloon");
  assert.equal(frame3.layers[1].elements[0].kind === "balloon" ? frame3.layers[1].elements[0].shape : undefined, "thought");
  assert.equal(document.dialogues.length, 6);
  assert.ok(document.dialogues.every((dialogue) => dialogue.content !== "新对白"));
});

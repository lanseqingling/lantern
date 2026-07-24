import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, unzipSync, zipSync } from "fflate";
import { buildChapterArchive, parseChapterArchive } from "@lantern/server/chapter-archive-service";
import type { ComicDocument, StoryboardBeat } from "@lantern/shared";

const storyboardBeat: StoryboardBeat = {
  id: "beat-1",
  versionId: "beat-1-v1",
  title: "雨站相遇",
  description: "角色在站台雨幕中对视。",
};

const document: ComicDocument = {
  protocolVersion: "lcd-0.4",
  comicId: "comic-source",
  chapterId: "chapter-source",
  format: "page",
  reading: { direction: "ltr", viewer: "paged", unitOrder: ["unit-1"], showPageNumber: true },
  resources: [{ assetId: "asset-1", assetVersionId: "asset-1-v1", kind: "image", mediaType: "image/png" }],
  dialogues: [{ id: "dialogue-1", storyboardBeatId: "beat-1", storyboardBeatVersionId: "beat-1-v1", speakerAssetId: "speaker-asset", content: "你也在这里？" }],
  units: [{
    id: "unit-1",
    kind: "single_page",
    pageRole: "story",
    canvas: { width: 720, height: 1080, background: { color: "#ffffff" } },
    surfaces: [{ id: "surface-1", role: "single", geometry: { x: 0, y: 0, width: 720, height: 1080 }, pageNumber: 1 }],
    frames: [{
      id: "frame-1",
      geometry: { x: 40, y: 40, width: 640, height: 1000 },
      zIndex: 1,
      storyRefs: [{ storyboardBeatId: storyboardBeat.id, storyboardBeatVersionId: storyboardBeat.versionId, role: "primary" }],
      border: { color: "#111111", width: 2, style: "solid" },
      shape: { kind: "rect" },
      mask: { mode: "clip" },
      layers: [{
        id: "layer-1",
        name: "画面",
        zIndex: 1,
        visible: true,
        overflow: "clip",
        kind: "art",
        elements: [{
          id: "image-1",
          kind: "image",
          assetId: "asset-1",
          assetVersionId: "asset-1-v1",
          transform: { x: 0, y: 0, width: 1, height: 1 },
          crop: { x: 0, y: 0, width: 1, height: 1 },
        }],
      }],
    }],
    overlayLayers: [],
    readingSequence: [{ frameId: "frame-1" }],
    layoutPolicy: { frameOverlap: "forbid", defaultOverflow: "clip" },
  }],
};

function archive() {
  return buildChapterArchive({
    document,
    storyboardBeats: [storyboardBeat],
    assets: [
      { assetId: "asset-1", kind: "generated_image", name: "站台画面", description: "雨夜站台成稿" },
      { assetId: "speaker-asset", kind: "character", name: "林澄", description: "雨夜故事的主角" },
    ],
    resources: [{ assetId: "asset-1", assetVersionId: "asset-1-v1", mediaType: "image/png", width: 720, height: 1080, bytes: Buffer.from("test-png-bytes") }],
    createdAt: "2026-07-20T00:00:00.000Z",
  });
}

test("complete chapter archive round-trips LCD, storyboard beats, and fixed image bytes", () => {
  const parsed = parseChapterArchive(archive());
  assert.deepEqual(parsed.document, document);
  assert.deepEqual(parsed.storyboardBeats, [storyboardBeat]);
  assert.equal(parsed.manifest.protocol, "lantern-chapter-archive-1");
  assert.equal(parsed.manifest.resources.length, 1);
  assert.deepEqual(parsed.resourceFiles.get("asset-1-v1"), Buffer.from("test-png-bytes"));
});

test("complete chapter archive rejects image bytes that do not match the manifest checksum", () => {
  const files = unzipSync(archive());
  const resourcePath = Object.keys(files).find((path) => path.startsWith("resources/"));
  assert.ok(resourcePath);
  files[resourcePath] = strToU8("tampered");
  assert.throws(() => parseChapterArchive(Buffer.from(zipSync(files))), /校验失败/);
});

test("complete chapter archive rejects undeclared files", () => {
  const files = unzipSync(archive());
  files["unexpected.txt"] = strToU8("not part of the archive protocol");
  assert.throws(() => parseChapterArchive(Buffer.from(zipSync(files))), /未声明的文件/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import sharp from "sharp";
import { compileChapterLayoutPlan } from "../packages/layout-engine/src";
import {
  createStructuredExportPayload,
  renderChapterLongPng,
  renderChapterPngPages,
} from "../packages/server/src/export-renderer";
import type { StoryboardBeat } from "../packages/shared/src";

const storyboardBeats: StoryboardBeat[] = Array.from({ length: 8 }, (_, index) => ({
  id: `golden-storyboardBeat-${index + 1}`,
  versionId: `golden-storyboardBeat-${index + 1}-v1`,
  title: `节拍 ${index + 1}`,
  description: `${index % 2 ? "近景" : "远景"}中角色继续行动，主体与留白形成清楚阅读动线。`,
}));

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

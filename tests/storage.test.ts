import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSignedAssetPath, verifySignedAssetPath } from "../packages/server/src/signed-assets";
import { assertSupportedUpload, getObject, putImage } from "../packages/server/src/object-storage";
import { resetConfigForTests } from "../packages/server/src/config";

test("private object signatures expire and reject tampering", () => {
  process.env.LANTERN_LOCAL_TOKEN = "test-session-secret-at-least-32-characters";
  resetConfigForTests();
  const path = createSignedAssetPath("asset-version-1", 60);
  assert.equal(createSignedAssetPath("asset-version-1", 60), path);
  const url = new URL(path, "http://lantern.local");
  const expires = Number(url.searchParams.get("expires"));
  const signature = String(url.searchParams.get("signature"));
  assert.equal(verifySignedAssetPath("asset-version-1", expires, signature), true);
  assert.equal(verifySignedAssetPath("asset-version-2", expires, signature), false);
});

test("local object storage sniffs PNG bytes and reads immutable object keys", async () => {
  process.env.LANTERN_DATA_DIR = join(tmpdir(), `lantern-storage-test-${randomUUID()}`);
  resetConfigForTests();
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n0YAAAAASUVORK5CYII=", "base64");
  const stored = await putImage(png, "test");
  assert.equal(stored.contentType, "image/png");
  assert.equal(stored.width, 1);
  assert.equal(stored.height, 1);
  assert.deepEqual(await getObject(stored.objectKey), png);
});

test("upload validation uses sniffed image bytes over browser MIME aliases", async () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00]);
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n0YAAAAASUVORK5CYII=", "base64");
  assert.equal(await assertSupportedUpload("image/jpg", jpeg), "image/jpeg");
  assert.equal(await assertSupportedUpload("image/pjpeg", jpeg), "image/jpeg");
  assert.equal(await assertSupportedUpload("application/octet-stream", jpeg), "image/jpeg");
  assert.equal(await assertSupportedUpload("image/jpeg", png), "image/png");
});

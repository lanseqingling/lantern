import assert from "node:assert/strict";
import test from "node:test";
import { normalizeResolvedResourceUrls } from "../app/lib/document-asset-urls";

test("v0.4 resolved resource paths normalize outside the persisted LCD", () => {
  const normalized = normalizeResolvedResourceUrls({ version: { url: "/v1/assets/version/content?signature=test" } }, "/api/backend");
  assert.equal(normalized.version.url, "/api/backend/v1/assets/version/content?signature=test");
});

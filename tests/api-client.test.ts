import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAssetVersionDimensions } from "../apps/web/app/lib/asset-version-normalization";
import { normalizeResolvedResourceUrls } from "../apps/web/app/lib/document-asset-urls";

test("v0.4 resolved resource paths normalize outside the persisted LCD", () => {
  const normalized = normalizeResolvedResourceUrls({ version: { url: "/v1/assets/version/content?signature=test" } }, "/api/backend");
  assert.equal(normalized.version.url, "/api/backend/v1/assets/version/content?signature=test");
});

test("workbench asset versions omit unknown image dimensions", () => {
  const normalized = normalizeAssetVersionDimensions({
    id: "asset-version-legacy",
    version: 1,
    contentUrl: "/v1/assets/asset-version-legacy/content",
    width: null,
    height: null,
  });

  assert.equal(Object.hasOwn(normalized, "width"), false);
  assert.equal(Object.hasOwn(normalized, "height"), false);
});

test("workbench asset versions preserve valid image dimensions", () => {
  assert.deepEqual(
    normalizeAssetVersionDimensions({
      id: "asset-version-sized",
      version: 2,
      width: 1200,
      height: 1800,
    }),
    {
      id: "asset-version-sized",
      version: 2,
      width: 1200,
      height: 1800,
    },
  );
});

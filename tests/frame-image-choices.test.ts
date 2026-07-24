import assert from "node:assert/strict";
import test from "node:test";
import { buildFrameImageChoices } from "../apps/web/app/lib/frame-image-choices";
import type { ComicPage, ImageElement } from "@lantern/shared";

const image = (input: Pick<ImageElement, "id" | "assetId" | "assetVersionId" | "location">): ImageElement => ({
  ...input,
  type: "image",
  geometry: { x: 0, y: 0, width: 100, height: 100 },
  zIndex: 1,
  clipToFrame: false,
  layerId: input.location.layerId,
});

test("frame image choices put unbound current-page images before library assets", () => {
  const currentPage: ComicPage = {
    id: "spread-1",
    pageIndex: 0,
    kind: "spread",
    pageRole: "story",
    canvas: { width: 1600, height: 1200, background: { color: "#fff" } },
    elements: [
      image({ id: "cross", assetId: "cross-asset", assetVersionId: "cross-v1", location: { space: "overlay", layerId: "cross-layer", anchor: { type: "unit" }, purpose: "cross_page" } }),
      image({ id: "paper", assetId: "paper-asset", assetVersionId: "paper-v1", location: { space: "overlay", layerId: "paper-layer", anchor: { type: "unit" }, surfaceId: "surface-left", purpose: "page_content" } }),
      image({ id: "breakout", assetId: "breakout-asset", assetVersionId: "breakout-v1", location: { space: "overlay", layerId: "breakout-layer", anchor: { type: "frame", frameId: "frame-1" }, purpose: "breakout" } }),
      image({ id: "framed", assetId: "frame-asset", assetVersionId: "frame-v1", location: { space: "frame", frameId: "frame-1", layerId: "frame-layer" } }),
    ],
  };
  const choices = buildFrameImageChoices({
    assets: [{ id: "library-asset", kind: "reference_image", name: "资产图片", description: "", versionId: "library-v1", contentUrl: "/library.png" }],
    canvasImages: [{ id: "canvas-character", kind: "character", name: "画布人物", detail: "", imageSrc: "/character.png", assetId: "character-asset", assetVersionId: "character-v1", x: 0, y: 0, zoom: 1, collapsed: false, pinned: false }],
    resources: [
      { assetId: "cross-asset", assetVersionId: "cross-v1", kind: "image", mediaType: "image/png", width: 1600, height: 1200 },
      { assetId: "paper-asset", assetVersionId: "paper-v1", kind: "image", mediaType: "image/webp", width: 800, height: 1200 },
      { assetId: "breakout-asset", assetVersionId: "breakout-v1", kind: "image", mediaType: "image/png" },
      { assetId: "frame-asset", assetVersionId: "frame-v1", kind: "image", mediaType: "image/png" },
    ],
    resolvedResources: { "cross-v1": { url: "/cross.png" }, "paper-v1": { url: "/paper.webp" } },
    currentPage,
    includeCurrentPageImages: true,
  });

  assert.deepEqual(choices.map((choice) => choice.label), ["当前页 · 跨页图片 01", "当前页 · 纸面图 01", "画布 · 画布人物", "资产图片"]);
  assert.deepEqual(choices.slice(0, 2).map((choice) => choice.url), ["/cross.png", "/paper.webp"]);
  assert.equal(choices.some((choice) => choice.id === "page:breakout" || choice.id === "page:framed"), false);
});

test("non-frame image pickers keep using only library assets", () => {
  const choices = buildFrameImageChoices({
    assets: [{ id: "library-asset", kind: "reference_image", name: "资产图片", description: "", versionId: "library-v1" }],
    canvasImages: [],
    resources: [{ assetId: "paper-asset", assetVersionId: "paper-v1", kind: "image", mediaType: "image/png" }],
    currentPage: {
      id: "page-1",
    pageIndex: 0,
    kind: "page",
    pageRole: "story",
      canvas: { width: 800, height: 1200, background: { color: "#fff" } },
      elements: [image({ id: "paper", assetId: "paper-asset", assetVersionId: "paper-v1", location: { space: "overlay", layerId: "paper-layer", anchor: { type: "unit" }, purpose: "page_content" } })],
    },
    includeCurrentPageImages: false,
  });

  assert.deepEqual(choices.map((choice) => choice.label), ["资产图片"]);
});

test("frame image choices do not repeat an asset already placed on the canvas", () => {
  const choices = buildFrameImageChoices({
    assets: [{ id: "shared-asset", kind: "reference_image", name: "同一张图", description: "", versionId: "shared-v1", contentUrl: "/shared.png" }],
    canvasImages: [{ id: "shared-placement", kind: "reference_image", name: "同一张图", detail: "", imageSrc: "/shared.png", assetId: "shared-asset", assetVersionId: "shared-v1", x: 0, y: 0, zoom: 1, collapsed: false, pinned: false }],
    resources: [],
    includeCurrentPageImages: false,
  });

  assert.deepEqual(choices.map((choice) => choice.id), ["canvas:shared-placement"]);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  clampImageViewerZoom,
  imageViewerFitScale,
  imageViewerIndex,
  imageViewerWheelZoomDelta,
  imageViewerZoomStep,
} from "../apps/web/app/lib/image-viewer";

test("图片查看器适应窗口时不会放大小图", () => {
  assert.equal(imageViewerFitScale({ width: 400, height: 300 }, { width: 1200, height: 800 }), 1);
  assert.equal(imageViewerFitScale({ width: 1600, height: 900 }, { width: 800, height: 700 }), 0.5);
});

test("图片查看器缩放和浏览索引保持在合法范围", () => {
  assert.equal(imageViewerZoomStep, 0.05);
  assert.equal(clampImageViewerZoom(0.1), 0.25);
  assert.equal(clampImageViewerZoom(8), 4);
  assert.equal(imageViewerIndex(0, -1, 12), 0);
  assert.equal(imageViewerIndex(11, 1, 12), 11);
  assert.equal(imageViewerIndex(7, 1, 12), 8);
});

test("图片查看器滚轮按输入幅度微调且单次不超过百分之一", () => {
  assert.equal(imageViewerWheelZoomDelta(-100), 0.01);
  assert.equal(imageViewerWheelZoomDelta(100), -0.01);
  assert.equal(imageViewerWheelZoomDelta(-2), 0.002);
});

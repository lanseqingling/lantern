import assert from "node:assert/strict";
import test from "node:test";
import { findAvailableFrameImageCandidateForTask, isCandidatePreviewTargetVisible, resolveReadingUnitIndex, resolveWorkbenchPageIndex } from "../app/lib/workbench-location";

const units = [{ id: "page-a" }, { id: "page-b" }, { id: "page-c" }];

test("workbench location restores a page by stable presentation-unit id", () => {
  assert.equal(resolveWorkbenchPageIndex(units, "page-c"), 2);
});

test("workbench location clamps its fallback when a saved page no longer exists", () => {
  assert.equal(resolveWorkbenchPageIndex(units, "deleted-page", 8), 2);
  assert.equal(resolveWorkbenchPageIndex([], "deleted-page", 8), 0);
});

test("workbench refresh keeps the same page after units are inserted before it", () => {
  assert.equal(resolveWorkbenchPageIndex([{ id: "new-page" }, ...units], "page-b", 1), 2);
});

test("candidate target indexing follows reading order instead of document storage order", () => {
  const document = {
    reading: { unitOrder: ["page-a", "page-b"] },
    units: [{ id: "page-b" }, { id: "page-a" }],
  };
  assert.equal(resolveReadingUnitIndex(document, "page-a"), 0);
  assert.equal(resolveReadingUnitIndex(document, "page-b"), 1);
  assert.equal(resolveReadingUnitIndex(document, "missing-page"), -1);
});

test("candidate preview accepts only targets in the current visible page group", () => {
  const groups = [{ unitIndices: [0, 1] }, { unitIndices: [2, 3] }];
  assert.equal(isCandidatePreviewTargetVisible(groups, 0, 1), true);
  assert.equal(isCandidatePreviewTargetVisible(groups, 0, 2), false);
});

test("automatic preview selects only the available frame image from the completed task", () => {
  const candidates = [
    { id: "old-frame", kind: "frame_image", status: "available", metadata: { taskId: "old-task" } },
    { id: "storyboard", kind: "storyboard", status: "available", metadata: { taskId: "completed-task" } },
    { id: "stale-frame", kind: "frame_image", status: "stale", metadata: { taskId: "completed-task" } },
    { id: "completed-frame", kind: "frame_image", status: "available", metadata: { taskId: "completed-task" } },
  ];
  assert.equal(findAvailableFrameImageCandidateForTask(candidates, "completed-task")?.id, "completed-frame");
  assert.equal(findAvailableFrameImageCandidateForTask(candidates, "missing-task"), undefined);
});

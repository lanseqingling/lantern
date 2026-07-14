import assert from "node:assert/strict";
import test from "node:test";
import { validateComicDocument } from "../packages/shared/src";
import { createCapacityFixture } from "./fixtures/runtime-capacity";

test("persistent runtime capacity fixture keeps 120 storyboardBeats, 24 pages, 200 assets and 300 messages valid", () => {
  const fixture = createCapacityFixture();
  const document = validateComicDocument(fixture.document);
  assert.equal(fixture.storyboardBeats.length, 120);
  assert.equal(document.units.length, 24);
  assert.equal(document.units.reduce((sum, unit) => sum + unit.frames.length, 0), 120);
  assert.equal(document.resources.length, 200);
  assert.equal(fixture.messages.length, 300);
});

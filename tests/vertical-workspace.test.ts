import assert from "node:assert/strict";
import test from "node:test";
import { fitVerticalNavigatorPaper, fitVerticalViewportWidth, nextVerticalViewportMode, verticalNavigatorWindow } from "../apps/web/app/lib/vertical-workspace";

test("device viewport modes cycle through the compact preset set", () => {
  assert.equal(nextVerticalViewportMode("off"), "phone");
  assert.equal(nextVerticalViewportMode("phone"), "phone_tall");
  assert.equal(nextVerticalViewportMode("phone_tall"), "tablet");
  assert.equal(nextVerticalViewportMode("tablet"), "off");
});

test("device viewport fitting only shrinks the shared display width", () => {
  assert.equal(fitVerticalViewportWidth(430, 760, "off"), 430);
  assert.equal(fitVerticalViewportWidth(430, 760, "tablet"), 430);
  assert.equal(fitVerticalViewportWidth(430, 760, "phone"), 427.5);
  assert.equal(fitVerticalViewportWidth(430, 760, "phone_tall"), 342);
});

test("scroll navigator maps the visible window into normalized content bounds", () => {
  assert.deepEqual(verticalNavigatorWindow({ scrollTop: 72, viewportHeight: 800, contentTop: 72, contentHeight: 2400 }), { top: 0, height: 1 / 3 });
  assert.deepEqual(verticalNavigatorWindow({ scrollTop: 872, viewportHeight: 800, contentTop: 72, contentHeight: 2400 }), { top: 1 / 3, height: 1 / 3 });
  const end = verticalNavigatorWindow({ scrollTop: 2600, viewportHeight: 800, contentTop: 72, contentHeight: 2400 });
  assert.ok(Math.abs(end.top - 2 / 3) < Number.EPSILON);
  assert.equal(end.height, 1 / 3);
  assert.deepEqual(verticalNavigatorWindow({ scrollTop: 0, viewportHeight: 800, contentTop: 0, contentHeight: 0 }), { top: 0, height: 1 });
});

test("scroll navigator paper preserves the complete document ratio", () => {
  assert.deepEqual(fitVerticalNavigatorPaper(640, 960), { width: 50, height: 75 });
  assert.deepEqual(fitVerticalNavigatorPaper(640, 3200), { width: 29.6, height: 148 });
  assert.deepEqual(fitVerticalNavigatorPaper(0, 0), { width: 50, height: 148 });
});

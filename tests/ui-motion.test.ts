import assert from "node:assert/strict";
import test from "node:test";
import { MODE_SWITCH_MOTION_MS, REDUCED_ROUTE_MOTION_MS, modeSwitchMotionDelay, routeMotionDelay } from "../apps/web/app/lib/ui-motion";

function withMotionPreference(reduced: boolean, assertion: () => void) {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { matchMedia: () => ({ matches: reduced }) },
  });
  try {
    assertion();
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
}

test("route motion keeps full movement normally and a short fade for reduced motion", () => {
  withMotionPreference(false, () => {
    assert.equal(modeSwitchMotionDelay(), MODE_SWITCH_MOTION_MS);
    assert.equal(routeMotionDelay(340), 340);
  });
  withMotionPreference(true, () => {
    assert.equal(modeSwitchMotionDelay(), 0);
    assert.equal(routeMotionDelay(340), REDUCED_ROUTE_MOTION_MS);
  });
});

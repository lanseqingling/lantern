export const MODE_SWITCH_MOTION_MS = 190;
export const REDUCED_ROUTE_MOTION_MS = 140;

export function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function modeSwitchMotionDelay() {
  return prefersReducedMotion() ? 0 : MODE_SWITCH_MOTION_MS;
}

export function routeMotionDelay(defaultDelay: number) {
  return prefersReducedMotion() ? REDUCED_ROUTE_MOTION_MS : defaultDelay;
}

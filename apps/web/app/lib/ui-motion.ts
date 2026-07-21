export const MODE_SWITCH_MOTION_MS = 190;

export function modeSwitchMotionDelay() {
  if (typeof window === "undefined") return 0;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : MODE_SWITCH_MOTION_MS;
}

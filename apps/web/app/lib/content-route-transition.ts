"use client";

import { useEffect, useLayoutEffect, useState } from "react";

export type ContentRouteDirection = "forward" | "back";

const CONTENT_ROUTE_ENTRY_KEY = "lantern-content-route-entry";
const CONTENT_ROUTE_TRANSITION_MS = 180;
const ROUTE_LOADING_INDICATOR_DELAY_MS = 450;

function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function prepareContentRouteEntry(direction: ContentRouteDirection) {
  if (typeof window === "undefined" || reducedMotion()) return;
  window.sessionStorage.setItem(CONTENT_ROUTE_ENTRY_KEY, direction);
}

export function navigateWithContentTransition(direction: ContentRouteDirection, navigate: () => void) {
  if (typeof window === "undefined" || reducedMotion()) {
    navigate();
    return;
  }
  if (document.documentElement.dataset.lanternContentRouteTransition) return;
  prepareContentRouteEntry(direction);
  document.documentElement.dataset.lanternContentRouteTransition = direction;
  window.setTimeout(navigate, CONTENT_ROUTE_TRANSITION_MS);
}

export function useContentRouteEntryTransition() {
  const [direction, setDirection] = useState<ContentRouteDirection | null>(null);

  useLayoutEffect(() => {
    if (reducedMotion()) return;
    const next = window.sessionStorage.getItem(CONTENT_ROUTE_ENTRY_KEY);
    if (next !== "forward" && next !== "back") return;
    window.sessionStorage.removeItem(CONTENT_ROUTE_ENTRY_KEY);
    delete document.documentElement.dataset.lanternContentRouteTransition;
    setDirection(next);
  }, []);

  return direction ? `route-page-enter route-page-enter-${direction}` : "";
}

export function useDelayedLoadingIndicator(loading: boolean) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!loading) {
      setVisible(false);
      return;
    }
    const timer = window.setTimeout(() => setVisible(true), ROUTE_LOADING_INDICATOR_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [loading]);

  return visible;
}

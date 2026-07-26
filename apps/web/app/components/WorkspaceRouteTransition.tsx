"use client";

import { type PropsWithChildren, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { navigateWithContentTransition, useContentRouteEntryTransition } from "@/app/lib/content-route-transition";
import { routeMotionDelay } from "@/app/lib/ui-motion";

const RETURN_SCROLL_THRESHOLD = 180;
const RETURN_TOUCH_DISTANCE = 112;

export function WorkspaceRouteTransition({ children }: PropsWithChildren) {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  const touchStartY = useRef<number | null>(null);
  const transitionStarted = useRef(false);
  const upwardScrollDistance = useRef(0);
  const upwardScrollReset = useRef<number | null>(null);
  const entryTransition = useContentRouteEntryTransition();

  const returnToLanding = useCallback(() => {
    if (leaving || transitionStarted.current) return;
    transitionStarted.current = true;

    document.documentElement.dataset.lanternRouteTransition = "landing";
    setLeaving(true);
    window.setTimeout(() => router.push("/"), routeMotionDelay(340));
  }, [leaving, router]);

  useEffect(() => {
    if (document.documentElement.dataset.lanternRouteTransition !== "workspace") return;
    const timeout = window.setTimeout(() => {
      delete document.documentElement.dataset.lanternRouteTransition;
    }, 500);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    router.prefetch("/");
  }, [router]);

  useEffect(() => {
    const atPageTop = () => window.scrollY <= 0;
    const resetUpwardScroll = () => {
      upwardScrollDistance.current = 0;
      if (upwardScrollReset.current !== null) window.clearTimeout(upwardScrollReset.current);
      upwardScrollReset.current = null;
    };
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return;
      if (event.deltaY >= 0 || !atPageTop()) {
        resetUpwardScroll();
        return;
      }
      event.preventDefault();
      upwardScrollDistance.current += Math.abs(event.deltaY);
      if (upwardScrollReset.current !== null) window.clearTimeout(upwardScrollReset.current);
      upwardScrollReset.current = window.setTimeout(resetUpwardScroll, 450);
      if (upwardScrollDistance.current < RETURN_SCROLL_THRESHOLD) return;
      resetUpwardScroll();
      returnToLanding();
    };
    const onTouchStart = (event: TouchEvent) => {
      touchStartY.current = event.touches[0]?.clientY ?? null;
    };
    const onTouchEnd = (event: TouchEvent) => {
      const startY = touchStartY.current;
      const endY = event.changedTouches[0]?.clientY;
      touchStartY.current = null;
      if (startY !== null && endY !== undefined && endY - startY > RETURN_TOUCH_DISTANCE && atPageTop()) returnToLanding();
    };

    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchend", onTouchEnd);
      resetUpwardScroll();
    };
  }, [returnToLanding]);

  return <main className={`library-page app-surface workspace-route-transition route-page-transition ${entryTransition}${leaving ? " is-leaving" : ""}`} aria-busy={leaving} onClickCapture={(event) => {
    const target = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!target) return;
    const href = target.getAttribute("href");
    if (href === "/") {
      event.preventDefault();
      returnToLanding();
    }
    if (href?.startsWith("/settings")) {
      event.preventDefault();
      navigateWithContentTransition("forward", () => router.push(href));
    }
  }}>{children}</main>;
}

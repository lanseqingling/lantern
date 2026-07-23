"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@lantern/ui";
import { uiCopy } from "@/app/lib/ui-copy";

export function LandingClient() {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  const touchStartY = useRef<number | null>(null);
  const transitionStarted = useRef(false);

  const enterWorkspace = useCallback(() => {
    if (leaving || transitionStarted.current) return;
    transitionStarted.current = true;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      router.push("/workspace");
      return;
    }

    document.documentElement.dataset.lanternRouteTransition = "workspace";
    setLeaving(true);
    window.setTimeout(() => router.push("/workspace"), 340);
  }, [leaving, router]);

  useEffect(() => {
    router.prefetch("/workspace");
  }, [router]);

  useEffect(() => {
    if (document.documentElement.dataset.lanternRouteTransition !== "landing") return;
    const timeout = window.setTimeout(() => {
      delete document.documentElement.dataset.lanternRouteTransition;
    }, 500);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.deltaY <= 0) return;
      event.preventDefault();
      enterWorkspace();
    };
    const onTouchStart = (event: TouchEvent) => {
      touchStartY.current = event.touches[0]?.clientY ?? null;
    };
    const onTouchEnd = (event: TouchEvent) => {
      const startY = touchStartY.current;
      const endY = event.changedTouches[0]?.clientY;
      touchStartY.current = null;
      if (startY !== null && endY !== undefined && startY - endY > 48) enterWorkspace();
    };

    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [enterWorkspace]);

  return <main className={`landing-page landing-route-transition app-surface app-surface--hero${leaving ? " is-leaving" : ""}`} aria-busy={leaving}>
    <section className="landing-intro" aria-label={uiCopy.landing.hero.aria}>
      <div className="landing-brand"><span className="lantern-logo"><i /></span><strong>{uiCopy.brand.wordmark.primary} <em>{uiCopy.brand.wordmark.accent}</em></strong></div>
      <h1>{uiCopy.landing.hero.tagline}</h1>
      <p>{uiCopy.landing.hero.subtitle}</p>
      <button type="button" className="landing-start" onClick={enterWorkspace}>{uiCopy.landing.hero.start}</button>
    </section>

    <section className="landing-composition" aria-label={uiCopy.landing.demo.comicAria}>
      <article className="landing-storyboard"><img src="/landing-storyboard.png" alt={uiCopy.landing.demo.storyboardAlt} /><div className="landing-frame-selection" aria-label={uiCopy.landing.demo.selectedLastFrameAria} /><div className="landing-frame-toolbar" aria-label={uiCopy.landing.demo.frameToolbarAria}><button type="button" aria-label={uiCopy.landing.demo.aiToolbarAria}><Icon name="ai" /></button><button type="button" aria-label={uiCopy.workbench.action.moveFrame}><Icon name="move" /></button><button type="button" aria-label={uiCopy.landing.demo.cropFrameAria}><Icon name="crop" /></button><button type="button" aria-label={uiCopy.landing.demo.editFrameAria}><Icon name="edit" /></button></div></article>
      <aside className="landing-task-card" aria-label={uiCopy.landing.demo.taskCardAria}><div className="landing-task-glow"><i /></div><span /><span /><em /><b /><footer><i /><i /></footer></aside>
      <nav className="landing-tool-rail" aria-label={uiCopy.landing.demo.toolsAria}><button type="button" className="active" aria-label={uiCopy.landing.demo.selectToolAria}><Icon name="select" /></button><button type="button" aria-label={uiCopy.landing.demo.moveToolAria}><Icon name="pan" /></button><button type="button" aria-label={uiCopy.asset.action.addImage}><Icon name="asset" /></button><button type="button" aria-label={uiCopy.landing.demo.arrangeToolAria}><Icon name="layout" /></button><div className="mode-toggle creative-active" aria-label={uiCopy.landing.demo.modeSwitchAria}><button type="button" className="mode-star mode-active" aria-label={uiCopy.landing.demo.creationModeAria}><Icon name="ai" /></button><button type="button" className="mode-preview mode-idle" aria-label={uiCopy.comic.action.readingPreview}><Icon name="preview" /></button></div></nav>
    </section>
    <button type="button" className="landing-scroll-cue" onClick={enterWorkspace}><span>{uiCopy.landing.hero.scrollToLibrary}</span><Icon name="chevronDown" /></button>
  </main>;
}

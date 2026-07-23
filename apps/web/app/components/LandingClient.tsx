"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@lantern/ui";

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
    <section className="landing-intro" aria-label="Lantern AI">
      <div className="landing-brand"><span className="lantern-logo"><i /></span><strong>Lantern <em>AI</em></strong></div>
      <h1>一盏灯，陪你打磨漫画故事</h1>
      <p>续写旧作篇章，新建故事企划，打造独属于你的漫画世界</p>
      <button type="button" className="landing-start" onClick={enterWorkspace}>开始创作</button>
    </section>

    <section className="landing-composition" aria-label="漫画创作示例">
      <article className="landing-storyboard"><img src="/landing-storyboard.png" alt="漫画分镜编辑示意图" /><div className="landing-frame-selection" aria-label="已选中最后一个画格" /><div className="landing-frame-toolbar" aria-label="画格工具栏"><button type="button" aria-label="AI 创作工具"><Icon name="ai" /></button><button type="button" aria-label="移动画格"><Icon name="move" /></button><button type="button" aria-label="裁切画格"><Icon name="crop" /></button><button type="button" aria-label="编辑画格"><Icon name="edit" /></button></div></article>
      <aside className="landing-task-card" aria-label="创作任务卡片"><div className="landing-task-glow"><i /></div><span /><span /><em /><b /><footer><i /><i /></footer></aside>
      <nav className="landing-tool-rail" aria-label="创作工具示例"><button type="button" className="active" aria-label="选择工具"><Icon name="select" /></button><button type="button" aria-label="移动工具"><Icon name="pan" /></button><button type="button" aria-label="添加图片"><Icon name="asset" /></button><button type="button" aria-label="编排工具"><Icon name="layout" /></button><div className="mode-toggle creative-active" aria-label="创作与预览模式"><button type="button" className="mode-star mode-active" aria-label="当前为创作模式"><Icon name="ai" /></button><button type="button" className="mode-preview mode-idle" aria-label="阅读预览"><Icon name="preview" /></button></div></nav>
    </section>
    <button type="button" className="landing-scroll-cue" onClick={enterWorkspace}><span>向下滚动，进入我的漫画</span><Icon name="chevronDown" /></button>
  </main>;
}

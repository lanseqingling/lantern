"use client";

import { useRouter } from "next/navigation";
import { Icon } from "@/packages/ui/src";

export function LandingClient() {
  const router = useRouter();

  return <main className="landing-page">
    <div className="landing-ambient cyan" />
    <div className="landing-ambient amber" />
    <section className="landing-intro" aria-label="Lantern AI">
      <div className="landing-brand"><span className="lantern-logo"><i /></span><strong>Lantern <em>AI</em></strong></div>
      <h1>一盏灯，陪你打磨漫画故事</h1>
      <p>续写旧作篇章，新建故事企划，打造独属于你的漫画世界</p>
      <button type="button" className="landing-start" onClick={() => router.push("/workspace")}>开始创作 <span>→</span></button>
    </section>

    <section className="landing-composition" aria-label="漫画创作示例">
      <article className="landing-storyboard"><img src="/landing-storyboard.png" alt="教室、回头女孩、书包信件与撩发动作组成的漫画分镜" /><div className="landing-frame-selection" aria-label="已选中最后一个画格" /><div className="landing-frame-toolbar" aria-label="画格工具栏"><button type="button" aria-label="AI 创作工具"><Icon name="ai" /></button><button type="button" aria-label="移动画格"><Icon name="move" /></button><button type="button" aria-label="裁切画格"><Icon name="crop" /></button><button type="button" aria-label="编辑画格"><Icon name="edit" /></button></div></article>
      <aside className="landing-task-card" aria-label="创作任务卡片"><div className="landing-task-glow"><i /></div><span /><span /><em /><b /><footer><i /><i /></footer></aside>
      <nav className="landing-tool-rail" aria-label="创作工具示例"><button type="button" className="active" aria-label="选择工具"><Icon name="select" /></button><button type="button" aria-label="移动工具"><Icon name="pan" /></button><button type="button" aria-label="添加图片"><Icon name="asset" /></button><button type="button" aria-label="编排工具"><Icon name="layout" /></button><div className="mode-toggle creative-active" aria-label="创作与预览模式"><button type="button" className="mode-star mode-active" aria-label="当前为创作模式"><Icon name="ai" /></button><button type="button" className="mode-preview mode-idle" aria-label="阅读预览"><Icon name="preview" /></button></div></nav>
    </section>
  </main>;
}

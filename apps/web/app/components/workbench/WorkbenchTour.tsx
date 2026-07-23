"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "@lantern/ui";

type PanelSnapshot = { leftOpen: boolean; agentOpen: boolean };
type TargetRect = { id: string; left: number; top: number; width: number; height: number; radius: number };
type CalloutPlacement = "right" | "left" | "above" | "tools";

type TourCallout = {
  id: string;
  title: string;
  content?: string;
  items?: Array<{ icon: IconName; text: string }>;
  targets: string[];
  placement: CalloutPlacement;
};

type TourStep = {
  id: string;
  panel?: "left" | "agent";
  callouts: TourCallout[];
};

type CalloutLayout = {
  callout: TourCallout;
  style: CSSProperties;
  line: { startX: number; startY: number; endX: number; endY: number };
};

const workbenchTourStorageKey = "lantern.workbench-tour.v2";
const singleCardWidth = 246;
const singleCardHeight = 108;
const toolCardWidth = 188;
const toolCardHeight = 100;

const workbenchTourSteps: TourStep[] = [
  {
    id: "creation-space",
    panel: "left",
    callouts: [{
      id: "creation-space",
      title: "创作空间",
      content: "在资产与分镜之间切换，整理当前一话的创作素材。",
      targets: ["creation-space"],
      placement: "right",
    }],
  },
  {
    id: "comic-pages",
    panel: "left",
    callouts: [{
      id: "comic-pages",
      title: "漫画页",
      content: "切换、添加和管理漫画页；条漫会在这里显示滚动段。",
      targets: ["comic-pages"],
      placement: "right",
    }],
  },
  {
    id: "canvas-tools",
    callouts: [
      {
        id: "canvas-modes",
        title: "选择与拖动画布",
        items: [
          { icon: "select", text: "聚焦模式编辑对象。" },
          { icon: "pan", text: "自由模式移动画布。" },
        ],
        targets: ["tool-canvas-modes"],
        placement: "tools",
      },
      {
        id: "page-display",
        title: "页面显示",
        content: "页漫切换单双页；条漫切换设备视区。",
        targets: ["tool-display"],
        placement: "tools",
      },
      {
        id: "creation-preview",
        title: "创作与预览",
        items: [
          { icon: "ai", text: "创作模式编辑漫画。" },
          { icon: "preview", text: "预览模式检查最终画面。" },
        ],
        targets: ["tool-mode"],
        placement: "tools",
      },
    ],
  },
  {
    id: "agent-composer",
    panel: "agent",
    callouts: [{
      id: "agent-composer",
      title: "与 Agent 协作",
      content: "选择对象后，在这里描述要生成、修改或确认的内容。",
      targets: ["agent-composer"],
      placement: "left",
    }],
  },
];

function hasCompletedTour() {
  try {
    return window.localStorage.getItem(workbenchTourStorageKey) === "completed";
  } catch {
    return false;
  }
}

function storeCompletedTour() {
  try {
    window.localStorage.setItem(workbenchTourStorageKey, "completed");
  } catch {
    // The replay entry remains available when local storage is unavailable.
  }
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function measureTarget(id: string): TargetRect | null {
  const target = document.querySelector(`[data-tour-id="${id}"]`);
  if (!target) return null;
  const rect = target.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const padding = 4;
  const left = clamp(rect.left - padding, 6, window.innerWidth - 6);
  const top = clamp(rect.top - padding, 6, window.innerHeight - 6);
  const right = clamp(rect.right + padding, 6, window.innerWidth - 6);
  const bottom = clamp(rect.bottom + padding, 6, window.innerHeight - 6);
  const radius = Number.parseFloat(window.getComputedStyle(target).borderRadius) || 12;
  return {
    id,
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
    radius: clamp(radius + padding, 8, 28),
  };
}

function boundsForTargets(targetIds: string[], targets: TargetRect[]) {
  const matches = targetIds.map((id) => targets.find((target) => target.id === id)).filter((target): target is TargetRect => Boolean(target));
  if (!matches.length) return null;
  const left = Math.min(...matches.map((rect) => rect.left));
  const top = Math.min(...matches.map((rect) => rect.top));
  const right = Math.max(...matches.map((rect) => rect.left + rect.width));
  const bottom = Math.max(...matches.map((rect) => rect.top + rect.height));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function layoutSingleCallout(callout: TourCallout, targets: TargetRect[]): CalloutLayout | null {
  const bounds = boundsForTargets(callout.targets, targets);
  if (!bounds) return null;

  const canUseRight = bounds.right + 24 + singleCardWidth <= window.innerWidth - 16;
  const canUseLeft = bounds.left - 24 - singleCardWidth >= 16;
  let placement = callout.placement;
  if (placement === "right" && !canUseRight && canUseLeft) placement = "left";
  if (placement === "left" && !canUseLeft && canUseRight) placement = "right";

  if (placement === "above") {
    const left = clamp(bounds.left + bounds.width / 2 - singleCardWidth / 2, 16, window.innerWidth - singleCardWidth - 16);
    const aboveTop = bounds.top - singleCardHeight - 26;
    const top = aboveTop >= 72 ? aboveTop : clamp(bounds.bottom + 26, 72, window.innerHeight - singleCardHeight - 72);
    const cardAbove = top < bounds.top;
    return {
      callout,
      style: { left, top, width: singleCardWidth, minHeight: singleCardHeight },
      line: {
        startX: left + singleCardWidth / 2,
        startY: cardAbove ? top + singleCardHeight : top,
        endX: bounds.left + bounds.width / 2,
        endY: cardAbove ? bounds.top : bounds.bottom,
      },
    };
  }

  const placeRight = placement === "right" || (!canUseLeft && canUseRight);
  const left = placeRight
    ? clamp(bounds.right + 24, 16, window.innerWidth - singleCardWidth - 16)
    : clamp(bounds.left - singleCardWidth - 24, 16, window.innerWidth - singleCardWidth - 16);
  const top = clamp(bounds.top + bounds.height / 2 - singleCardHeight / 2, 72, window.innerHeight - singleCardHeight - 72);
  return {
    callout,
    style: { left, top, width: singleCardWidth, minHeight: singleCardHeight },
    line: {
      startX: placeRight ? left : left + singleCardWidth,
      startY: top + singleCardHeight / 2,
      endX: placeRight ? bounds.right : bounds.left,
      endY: bounds.top + bounds.height / 2,
    },
  };
}

function layoutToolCallouts(callouts: TourCallout[], targets: TargetRect[]): CalloutLayout[] {
  const allBounds = callouts
    .map((callout) => boundsForTargets(callout.targets, targets))
    .filter((bounds): bounds is NonNullable<ReturnType<typeof boundsForTargets>> => Boolean(bounds));
  if (!allBounds.length) return [];

  const gap = 12;
  const totalWidth = callouts.length * toolCardWidth + (callouts.length - 1) * gap;
  const groupLeft = Math.min(...allBounds.map((bounds) => bounds.left));
  const groupRight = Math.max(...allBounds.map((bounds) => bounds.right));
  const startLeft = clamp((groupLeft + groupRight) / 2 - totalWidth / 2, 16, window.innerWidth - totalWidth - 16);
  const targetTop = Math.min(...allBounds.map((bounds) => bounds.top));
  const top = clamp(targetTop - toolCardHeight - 34, 84, window.innerHeight - toolCardHeight - 84);

  return callouts.flatMap((callout, index) => {
    const bounds = boundsForTargets(callout.targets, targets);
    if (!bounds) return [];
    const left = startLeft + index * (toolCardWidth + gap);
    return [{
      callout,
      style: { left, top, width: toolCardWidth, minHeight: toolCardHeight },
      line: {
        startX: left + toolCardWidth / 2,
        startY: top + toolCardHeight,
        endX: bounds.left + bounds.width / 2,
        endY: bounds.top,
      },
    }];
  });
}

function connectorPath(line: CalloutLayout["line"]) {
  const horizontal = Math.abs(line.startX - line.endX) > Math.abs(line.startY - line.endY);
  if (horizontal) {
    const middleX = (line.startX + line.endX) / 2;
    return `M ${line.startX} ${line.startY} L ${middleX} ${line.startY} L ${middleX} ${line.endY} L ${line.endX} ${line.endY}`;
  }
  const middleY = (line.startY + line.endY) / 2;
  return `M ${line.startX} ${line.startY} L ${line.startX} ${middleY} L ${line.endX} ${middleY} L ${line.endX} ${line.endY}`;
}

export function WorkbenchTour({
  leftOpen,
  agentOpen,
  onLeftOpenChange,
  onAgentOpenChange,
}: {
  leftOpen: boolean;
  agentOpen: boolean;
  onLeftOpenChange: (open: boolean) => void;
  onAgentOpenChange: (open: boolean) => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [targets, setTargets] = useState<TargetRect[]>([]);
  const panelSnapshotRef = useRef<PanelSnapshot | null>(null);
  const nextActionRef = useRef<HTMLButtonElement>(null);
  const maskId = `workbench-tour-mask-${useId().replace(/:/g, "")}`;
  const step = workbenchTourSteps[stepIndex];

  const startTour = () => {
    panelSnapshotRef.current = { leftOpen, agentOpen };
    setStepIndex(0);
    setActive(true);
  };

  const restorePanels = () => {
    const snapshot = panelSnapshotRef.current;
    panelSnapshotRef.current = null;
    if (!snapshot) return;
    onLeftOpenChange(snapshot.leftOpen);
    onAgentOpenChange(snapshot.agentOpen);
  };

  const completeTour = () => {
    storeCompletedTour();
    setActive(false);
    restorePanels();
  };

  useEffect(() => {
    setMounted(true);
    if (hasCompletedTour()) return;
    const timer = window.setTimeout(startTour, 650);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!active) return;
    if (step.panel === "left") onLeftOpenChange(true);
    if (step.panel === "agent") onAgentOpenChange(true);
  }, [active, onAgentOpenChange, onLeftOpenChange, step.panel]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => nextActionRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [active, stepIndex]);

  useLayoutEffect(() => {
    if (!active) {
      setTargets([]);
      return;
    }

    const ids = [...new Set(step.callouts.flatMap((callout) => callout.targets))];
    const elements = ids
      .map((id) => document.querySelector(`[data-tour-id="${id}"]`))
      .filter((element): element is Element => Boolean(element));
    const update = () => setTargets(ids.map(measureTarget).filter((target): target is TargetRect => Boolean(target)));
    const frame = window.requestAnimationFrame(update);
    const settled = window.setTimeout(update, 260);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    elements.forEach((element) => observer?.observe(element));
    window.addEventListener("resize", update);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settled);
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [active, agentOpen, leftOpen, step]);

  const calloutLayouts = useMemo(() => {
    if (!active) return [];
    const toolCallouts = step.callouts.filter((callout) => callout.placement === "tools");
    if (toolCallouts.length) return layoutToolCallouts(toolCallouts, targets);
    return step.callouts.map((callout) => layoutSingleCallout(callout, targets)).filter((layout): layout is CalloutLayout => Boolean(layout));
  }, [active, step, targets]);

  const previousStep = () => setStepIndex((current) => Math.max(0, current - 1));
  const nextStep = () => {
    if (stepIndex === workbenchTourSteps.length - 1) {
      completeTour();
      return;
    }
    setStepIndex((current) => current + 1);
  };

  const layer = active ? (
    <div className="workbench-tour-layer" role="presentation">
      <svg className="workbench-tour-scrim" aria-hidden="true">
        <defs>
          <mask id={maskId}>
            <rect width="100%" height="100%" fill="white" />
            {targets.map((target) => <rect key={target.id} x={target.left} y={target.top} width={target.width} height={target.height} rx={target.radius} fill="black" />)}
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(17, 31, 35, .46)" mask={`url(#${maskId})`} />
        {calloutLayouts.map(({ callout, line }) => (
          <g key={`${callout.id}-connector`} className="workbench-tour-connector">
            <path d={connectorPath(line)} />
            <circle cx={line.endX} cy={line.endY} r="4" />
          </g>
        ))}
      </svg>

      {targets.map((target) => (
        <i
          className="workbench-tour-target"
          key={`${target.id}-outline`}
          style={{ left: target.left, top: target.top, width: target.width, height: target.height, borderRadius: target.radius }}
        />
      ))}

      {calloutLayouts.map(({ callout, style }) => (
        <section className={`workbench-tour-callout ${step.id === "canvas-tools" ? "tool-callout" : ""}`} style={style} key={callout.id} role="dialog" aria-label={callout.title}>
          <strong>{callout.title}</strong>
          {callout.items ? <div className="workbench-tour-callout-list">{callout.items.map((item) => <span key={item.text}><Icon name={item.icon} />{item.text}</span>)}</div> : <p>{callout.content}</p>}
        </section>
      ))}

      <div className="workbench-tour-controls">
        <nav className="workbench-tour-navigation" aria-label="工作台导览步骤">
          <button type="button" aria-label="上一步" onClick={previousStep} disabled={stepIndex === 0}><Icon name="collapse" /></button>
          <span>{stepIndex + 1} / {workbenchTourSteps.length}</span>
          <button ref={nextActionRef} type="button" className={stepIndex === workbenchTourSteps.length - 1 ? "finish" : ""} aria-label={stepIndex === workbenchTourSteps.length - 1 ? "完成导览" : "下一步"} onClick={nextStep}>{stepIndex === workbenchTourSteps.length - 1 ? "完成" : <Icon name="expand" />}</button>
        </nav>
      </div>
    </div>
  ) : null;

  return (
    <>
      <button type="button" className={`global-icon-button workbench-tour-trigger ${active ? "active" : ""}`} aria-label="播放工作台导览" aria-pressed={active} onClick={startTour}><Icon name="help" /></button>
      {mounted && layer ? createPortal(layer, document.body) : null}
    </>
  );
}

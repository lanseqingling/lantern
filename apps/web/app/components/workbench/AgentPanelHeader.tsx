"use client";

import type { KeyboardEvent } from "react";
import { Icon } from "@lantern/ui";
import { uiCopy } from "@/app/lib/ui-copy";

export type AgentPanelView = "activity" | "annotation" | "conversation";

const panelViews: AgentPanelView[] = ["activity", "annotation", "conversation"];

export function AgentPanelHeader({
  view,
  annotationNeedsAttention = false,
  activityNeedsAttention = false,
  sessionDrawerOpen,
  onViewChange,
  onToggleSessions,
  onCollapse,
}: {
  view: AgentPanelView;
  annotationNeedsAttention?: boolean;
  activityNeedsAttention?: boolean;
  sessionDrawerOpen: boolean;
  onViewChange: (view: AgentPanelView) => void;
  onToggleSessions: () => void;
  onCollapse: () => void;
}) {
  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const currentIndex = panelViews.indexOf(view);
    const next = event.key === "Home" ? panelViews[0]
      : event.key === "End" ? panelViews.at(-1)
      : event.key === "ArrowRight" ? panelViews[(currentIndex + 1) % panelViews.length]
      : event.key === "ArrowLeft" ? panelViews[(currentIndex - 1 + panelViews.length) % panelViews.length]
      : undefined;
    if (!next) return;
    event.preventDefault();
    onViewChange(next);
    event.currentTarget.parentElement
      ?.querySelector<HTMLButtonElement>(`[data-agent-panel-tab="${next}"]`)
      ?.focus();
  };

  return (
    <header className="agent-head">
      <div
        className={`agent-panel-tabs view-${view}`}
        data-tour-id="agent-panel-navigation"
        role="tablist"
        aria-label={uiCopy.workbench.agentActivity.navigationAria}
      >
        <span className="agent-panel-tab-slider" aria-hidden="true" />
        <button
          type="button"
          role="tab"
          id="agent-panel-activity-tab"
          data-agent-panel-tab="activity"
          aria-selected={view === "activity"}
          aria-controls="agent-panel-activity"
          tabIndex={view === "activity" ? 0 : -1}
          onKeyDown={handleTabKeyDown}
          onClick={() => onViewChange("activity")}
        >
          <Icon name="agentActivity" />
          <span>{uiCopy.workbench.agentActivity.activityTab}{activityNeedsAttention ? <i className="agent-panel-notice" aria-label={uiCopy.workbench.agentActivity.attentionAria} /> : null}</span>
        </button>
        <button
          type="button"
          role="tab"
          id="agent-panel-annotation-tab"
          data-agent-panel-tab="annotation"
          aria-selected={view === "annotation"}
          aria-controls="agent-panel-annotation"
          tabIndex={view === "annotation" ? 0 : -1}
          onKeyDown={handleTabKeyDown}
          onClick={() => onViewChange("annotation")}
        >
          <Icon name="annotation" />
          <span>{uiCopy.workbench.annotation.tab}{annotationNeedsAttention ? <i className="agent-panel-notice" aria-label={uiCopy.workbench.annotation.attentionAria} /> : null}</span>
        </button>
        <button
          type="button"
          role="tab"
          id="agent-panel-conversation-tab"
          data-agent-panel-tab="conversation"
          aria-selected={view === "conversation"}
          aria-controls="agent-panel-conversation"
          tabIndex={view === "conversation" ? 0 : -1}
          onKeyDown={handleTabKeyDown}
          onClick={() => onViewChange("conversation")}
        >
          <Icon name="message" />
          <span>{uiCopy.workbench.agentActivity.conversationTab}</span>
        </button>
      </div>
      <div className="agent-head-actions">
        {view !== "annotation" ? <button
          type="button"
          className={`session-drawer-trigger ${sessionDrawerOpen ? "active" : ""}`}
          aria-label={view === "activity"
            ? uiCopy.workbench.agentActivity.sessionFromActivityAria
            : uiCopy.workbench.chat.sessionsAria}
          aria-expanded={sessionDrawerOpen}
          onClick={onToggleSessions}
        >
          <Icon name="message" />
        </button> : null}
        <button type="button" aria-label={uiCopy.workbench.chat.collapseAria} onClick={onCollapse}>
          <Icon name="expand" />
        </button>
      </div>
    </header>
  );
}

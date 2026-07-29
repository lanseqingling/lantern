"use client";

import type { KeyboardEvent } from "react";
import { Icon } from "@lantern/ui";
import { uiCopy } from "@/app/lib/ui-copy";

export type AgentPanelView = "conversation" | "activity";

export function AgentPanelHeader({
  view,
  sessionDrawerOpen,
  onViewChange,
  onToggleSessions,
  onCollapse,
}: {
  view: AgentPanelView;
  sessionDrawerOpen: boolean;
  onViewChange: (view: AgentPanelView) => void;
  onToggleSessions: () => void;
  onCollapse: () => void;
}) {
  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const next = event.key === "ArrowRight" || event.key === "End"
      ? "conversation"
      : event.key === "ArrowLeft" || event.key === "Home"
        ? "activity"
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
        className={`agent-panel-tabs ${view === "conversation" ? "is-conversation" : ""}`}
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
          <span>{uiCopy.workbench.agentActivity.activityTab}</span>
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
        <button
          type="button"
          className={`session-drawer-trigger ${sessionDrawerOpen ? "active" : ""}`}
          aria-label={view === "activity"
            ? uiCopy.workbench.agentActivity.sessionFromActivityAria
            : uiCopy.workbench.chat.sessionsAria}
          aria-expanded={sessionDrawerOpen}
          onClick={onToggleSessions}
        >
          <Icon name="message" />
        </button>
        <button type="button" aria-label={uiCopy.workbench.chat.collapseAria} onClick={onCollapse}>
          <Icon name="expand" />
        </button>
      </div>
    </header>
  );
}

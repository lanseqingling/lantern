"use client";

import { useState } from "react";
import type { AgentActivityEvent, AgentActivityGroup as AgentActivityGroupData, AgentActivityNavigation } from "@lantern/shared";
import { Icon, type IconName } from "@lantern/ui";
import {
  agentActivityEventDescription,
  agentActivityEventDetails,
  agentActivityEventNavigation,
  agentActivityStatus,
  formatAgentActivityTime,
} from "@/app/lib/agent-activity-view";
import { uiCopy } from "@/app/lib/ui-copy";

function eventIcon(event: AgentActivityEvent): IconName {
  const value = `${event.projection.kind}:${event.projection.action}`;
  if (event.projection.kind === "system_notice") return "agentActivity";
  if (value.includes("image") || value.includes("upload")) return "referenceImage";
  if (value.includes("frame") || value.includes("composition")) return "layout";
  if (value.includes("page") || value.includes("spread")) return "pages";
  if (value.includes("balloon")) return "message";
  if (value.includes("narration")) return "text";
  if (value.includes("proposal")) return "history";
  if (value.includes("context")) return "context";
  if (value.includes("inspect")) return "scan";
  if (value.includes("asset")) return "asset";
  return "mcpConnection";
}

function navigationActionLabel(navigation: AgentActivityNavigation) {
  if (navigation.kind === "asset_version") {
    return uiCopy.workbench.agentActivity.openAssetVersionAction;
  }
  if (navigation.kind === "change_proposal") {
    return uiCopy.workbench.agentActivity.openProposalAction;
  }
  if (navigation.kind === "saved_snapshot") {
    return uiCopy.workbench.agentActivity.openFormalVersionAction;
  }
  return uiCopy.workbench.agentActivity.openTargetAction;
}

function navigationAriaLabel(
  event: AgentActivityEvent,
  navigation: AgentActivityNavigation,
  description: string,
) {
  if (event.projection.kind !== "proposal_created") {
    return uiCopy.workbench.agentActivity.openTargetAria(description);
  }
  return navigation.kind === "saved_snapshot"
    ? uiCopy.workbench.agentActivity.openFormalVersionAria
    : uiCopy.workbench.agentActivity.openProposalAria;
}

export function AgentActivityGroup({
  group,
  expanded,
  onToggle,
  onNavigate,
}: {
  group: AgentActivityGroupData;
  expanded: boolean;
  onToggle: () => void;
  onNavigate: (navigation: AgentActivityNavigation) => void;
}) {
  const status = agentActivityStatus(group);
  const eventListId = `agent-activity-events-${group.id}`;
  const [expandedEventIds, setExpandedEventIds] = useState<Set<string>>(() => new Set());

  const toggleEvent = (eventId: string) => {
    setExpandedEventIds((current) => {
      const next = new Set(current);
      if (next.has(eventId)) next.delete(eventId);
      else next.add(eventId);
      return next;
    });
  };

  return (
    <article className={`agent-activity-group status-${status.tone}`}>
      <button
        type="button"
        className="agent-activity-group-trigger"
        aria-expanded={expanded}
        aria-controls={eventListId}
        aria-label={expanded
          ? uiCopy.workbench.agentActivity.collapseGroup(group.title)
          : uiCopy.workbench.agentActivity.expandGroup(group.title)}
        onClick={onToggle}
      >
        <span className="agent-activity-group-title">
          <strong title={group.title}>{group.title}</strong>
          <small>
            {formatAgentActivityTime(group.updatedAt)}
            <i aria-hidden="true">·</i>
            {uiCopy.workbench.agentActivity.eventCount(group.eventCount)}
          </small>
        </span>
        <span
          className={`agent-activity-status ${status.tone}`}
          role="img"
          aria-label={status.label}
          title={status.label}
        >
          <i aria-hidden="true" />
        </span>
      </button>
      <div
        className={`agent-activity-event-reveal ${expanded ? "expanded" : ""}`}
        aria-hidden={!expanded}
      >
        <div>
          <ol id={eventListId} className="agent-activity-events">
            {group.events.map((event) => {
              const description = agentActivityEventDescription(event, group);
              if (event.projection.kind === "system_notice") {
                return (
                  <li
                    className="agent-activity-system-event"
                    role="note"
                    key={event.id}
                  >
                    <Icon name={eventIcon(event)} />
                    <span title={description}>{description}</span>
                    <time dateTime={event.completedAt ?? event.startedAt}>
                      {formatAgentActivityTime(event.completedAt ?? event.startedAt)}
                    </time>
                  </li>
                );
              }
              const navigation = agentActivityEventNavigation(event, group);
              const details = agentActivityEventDetails(event);
              const eventExpanded = expandedEventIds.has(event.id);
              const detailId = `agent-activity-event-detail-${event.id}`;
              const content = (
                <>
                  <Icon name={eventIcon(event)} />
                  <span title={description}>{description}</span>
                  {event.status !== "succeeded" ? (
                    <small className={`event-status ${event.status}`}>
                      {event.status === "running"
                        ? uiCopy.workbench.agentActivity.eventStatus.running
                        : uiCopy.workbench.agentActivity.eventStatus.failed}
                    </small>
                  ) : null}
                  <time dateTime={event.completedAt ?? event.startedAt}>
                    {formatAgentActivityTime(event.completedAt ?? event.startedAt)}
                  </time>
                </>
              );
              return (
                <li className={eventExpanded ? "expanded" : ""} key={event.id}>
                  <button
                    type="button"
                    className={`agent-activity-event-trigger ${event.projection.kind === "proposal_created" ? "result" : ""}`}
                    aria-expanded={eventExpanded}
                    aria-controls={detailId}
                    aria-label={eventExpanded
                      ? uiCopy.workbench.agentActivity.collapseEvent(description)
                      : uiCopy.workbench.agentActivity.expandEvent(description)}
                    tabIndex={expanded ? 0 : -1}
                    onClick={() => toggleEvent(event.id)}
                  >
                    {content}
                  </button>
                  <div
                    id={detailId}
                    className={`agent-activity-detail-reveal ${eventExpanded ? "expanded" : ""}`}
                    aria-hidden={!eventExpanded}
                  >
                    <div>
                      <dl className="agent-activity-event-detail">
                        {details.map((detail) => (
                          <div className={detail.block ? "block" : ""} key={detail.label}>
                            <dt>{detail.label}</dt>
                            <dd className={detail.code ? "code" : ""}>{detail.value}</dd>
                          </div>
                        ))}
                      </dl>
                      {navigation ? (
                        <button
                          type="button"
                          className="agent-activity-event-navigation"
                          aria-label={navigationAriaLabel(event, navigation, description)}
                          tabIndex={eventExpanded ? 0 : -1}
                          onClick={() => onNavigate(navigation)}
                        >
                          <span>{navigationActionLabel(navigation)}</span>
                          <Icon name="expand" />
                        </button>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </article>
  );
}

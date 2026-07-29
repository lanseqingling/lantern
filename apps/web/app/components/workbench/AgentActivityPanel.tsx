"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentActivityGroup as AgentActivityGroupData, AgentActivityNavigation } from "@lantern/shared";
import { Icon } from "@lantern/ui";
import { apiGetAgentActivity } from "@/app/lib/api-client";
import { appendAgentActivityGroups, mergeAgentActivityGroups } from "@/app/lib/agent-activity-view";
import { uiCopy } from "@/app/lib/ui-copy";
import { AgentActivityGroup } from "./AgentActivityGroup";

const pageSize = 20;
const pollIntervalMs = 6_000;

export function AgentActivityPanel({
  projectId,
  active,
  onNavigate,
}: {
  projectId?: string;
  active: boolean;
  onNavigate: (navigation: AgentActivityNavigation) => void;
}) {
  const [groups, setGroups] = useState<AgentActivityGroupData[]>([]);
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(() => new Set());
  const [nextCursor, setNextCursor] = useState<string>();
  const [initialLoading, setInitialLoading] = useState(Boolean(projectId));
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [error, setError] = useState("");
  const [refreshWarning, setRefreshWarning] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const requestInFlightRef = useRef(false);
  const hasLoadedRef = useRef(false);
  const hasLoadedEarlierRef = useRef(false);
  const requestGenerationRef = useRef(0);

  const loadLatest = useCallback(async (initial = false) => {
    if (!projectId || requestInFlightRef.current) return;
    const requestGeneration = requestGenerationRef.current;
    requestInFlightRef.current = true;
    try {
      const result = await apiGetAgentActivity(projectId, { limit: pageSize });
      if (requestGeneration !== requestGenerationRef.current) return;
      const scrollElement = listRef.current;
      const previousScrollHeight = scrollElement?.scrollHeight ?? 0;
      const previousScrollTop = scrollElement?.scrollTop ?? 0;
      setGroups((current) => initial ? result.groups : mergeAgentActivityGroups(current, result.groups));
      if (!initial && scrollElement && previousScrollTop > 4) {
        window.requestAnimationFrame(() => {
          scrollElement.scrollTop = previousScrollTop + scrollElement.scrollHeight - previousScrollHeight;
        });
      }
      if (initial || !hasLoadedEarlierRef.current) setNextCursor(result.nextCursor);
      setError("");
      setRefreshWarning("");
      hasLoadedRef.current = true;
    } catch {
      if (requestGeneration !== requestGenerationRef.current) return;
      if (hasLoadedRef.current) {
        setRefreshWarning(uiCopy.workbench.agentActivity.refreshWarning);
      } else {
        setError(uiCopy.workbench.agentActivity.unavailableDescription);
      }
    } finally {
      if (requestGeneration === requestGenerationRef.current) {
        requestInFlightRef.current = false;
        if (initial) setInitialLoading(false);
      }
    }
  }, [projectId]);

  useEffect(() => {
    const timer = projectId
      ? window.setTimeout(() => void loadLatest(true), 0)
      : undefined;
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      requestGenerationRef.current += 1;
      requestInFlightRef.current = false;
    };
  }, [loadLatest, projectId]);

  useEffect(() => {
    if (!active || !projectId) return;
    const timer = window.setInterval(() => void loadLatest(false), pollIntervalMs);
    return () => window.clearInterval(timer);
  }, [active, loadLatest, projectId]);

  const loadEarlier = async () => {
    if (!projectId || !nextCursor || loadingEarlier || requestInFlightRef.current) return;
    const requestGeneration = requestGenerationRef.current;
    requestInFlightRef.current = true;
    setLoadingEarlier(true);
    try {
      const result = await apiGetAgentActivity(projectId, { cursor: nextCursor, limit: pageSize });
      if (requestGeneration !== requestGenerationRef.current) return;
      setGroups((current) => appendAgentActivityGroups(current, result.groups));
      setNextCursor(result.nextCursor);
      hasLoadedEarlierRef.current = true;
      setRefreshWarning("");
    } catch {
      if (requestGeneration !== requestGenerationRef.current) return;
      setRefreshWarning(uiCopy.workbench.agentActivity.refreshWarning);
    } finally {
      if (requestGeneration === requestGenerationRef.current) {
        requestInFlightRef.current = false;
        setLoadingEarlier(false);
      }
    }
  };

  const toggleGroup = (groupId: string) => {
    setExpandedGroupIds((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  return (
    <section
      id="agent-panel-activity"
      className={`agent-panel-view agent-activity-panel ${active ? "active" : "inactive"}`}
      role="tabpanel"
      aria-labelledby="agent-panel-activity-tab"
      aria-hidden={!active}
    >
      <div ref={listRef} className="agent-activity-scroll" data-testid="agent-activity-list">
        {refreshWarning ? <p className="agent-activity-inline-warning" role="status">{refreshWarning}</p> : null}
        {initialLoading ? (
          <div className="agent-activity-state" role="status">
            <i className="spinner" aria-hidden="true" />
            <p>{uiCopy.workbench.agentActivity.loading}</p>
          </div>
        ) : null}
        {!initialLoading && error ? (
          <div className="agent-activity-state error" role="status">
            <span><Icon name="mcpConnection" /></span>
            <strong>{uiCopy.workbench.agentActivity.unavailableTitle}</strong>
            <p>{error}</p>
          </div>
        ) : null}
        {!initialLoading && !error && !groups.length ? (
          <div className="agent-activity-state empty">
            <span><Icon name="agentActivity" /></span>
            <strong>{uiCopy.workbench.agentActivity.emptyTitle}</strong>
            <a href={uiCopy.agentAccess.guideUrl} target="_blank" rel="noreferrer">
              {uiCopy.agentAccess.guideAction}
            </a>
          </div>
        ) : null}
        {!initialLoading && groups.length ? (
          <div className="agent-activity-groups">
            {groups.map((group) => (
              <AgentActivityGroup
                key={group.id}
                group={group}
                expanded={expandedGroupIds.has(group.id)}
                onToggle={() => toggleGroup(group.id)}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        ) : null}
        {!initialLoading && !error && groups.length ? (
          nextCursor ? (
            <button
              type="button"
              className="agent-activity-load-earlier"
              disabled={loadingEarlier}
              onClick={() => void loadEarlier()}
            >
              {loadingEarlier
                ? uiCopy.workbench.agentActivity.loadingEarlier
                : uiCopy.workbench.agentActivity.loadEarlier}
            </button>
          ) : null
        ) : null}
      </div>
    </section>
  );
}

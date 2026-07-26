"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@lantern/ui";
import { apiGetVersionTimeline, type VersionTimeline } from "@/app/lib/api-client";
import { formatVersionTime } from "@/app/lib/version-display";
import { uiCopy } from "@/app/lib/ui-copy";

export function VersionPanel({
  projectId,
  open,
  onClose,
  refreshKey,
}: {
  projectId?: string;
  open: boolean;
  onClose: () => void;
  refreshKey?: string;
}) {
  const router = useRouter();
  const [timeline, setTimeline] = useState<VersionTimeline | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !projectId) return;
    let canceled = false;
    void (async () => {
      await Promise.resolve();
      if (canceled) return;
      setLoading(true);
      setError("");
      try {
        const result = await apiGetVersionTimeline(projectId);
        if (!canceled) setTimeline(result);
      } catch {
        if (!canceled) setError(uiCopy.workbench.versions.loadFailed);
      } finally {
        if (!canceled) setLoading(false);
      }
    })();
    return () => { canceled = true; };
  }, [open, projectId, refreshKey]);

  const entries = timeline ? [
    {
      ...timeline.current,
      status: undefined,
      displayLabel: `r${timeline.current.workingRevision}`,
    },
    ...timeline.items.map((item) => ({ ...item, displayLabel: item.label })),
  ].sort((left, right) => right.createdAt.localeCompare(left.createdAt)) : [];

  return (
    <aside className={`version-workspace ${open ? "open" : "closed"}`} aria-label={uiCopy.workbench.versions.panelAria} data-tour-id="version-history-panel">
      <header className="version-panel-head">
        <strong>{uiCopy.workbench.versions.title}</strong>
        <button type="button" aria-label={uiCopy.workbench.versions.closeAria} onClick={onClose}><Icon name="expand" /></button>
      </header>
      <div className="version-list">
        {loading ? <p className="version-panel-state">{uiCopy.common.progress.processing}</p> : null}
        {error ? <p className="version-panel-state error">{error}</p> : null}
        {!loading && !error && entries.map((item) => item.kind === "working" ? (
          <button type="button" className="version-row current" key={`working:${item.id}`} disabled title={uiCopy.workbench.versions.currentHint}>
            <strong>{item.displayLabel} · {formatVersionTime(item.createdAt)}</strong>
            <i>{uiCopy.workbench.versions.type.current}</i>
          </button>
        ) : (
          <button
            type="button"
            className={`version-row ${item.kind} ${item.status ?? ""}`}
            key={`${item.kind}:${item.id}`}
            aria-label={uiCopy.workbench.versions.openComparison(item.label)}
            onClick={() => router.push(`/versions/${item.kind}/${encodeURIComponent(item.id)}`)}
          >
            <strong>{item.displayLabel} · {formatVersionTime(item.createdAt)}</strong>
            <i>{item.kind === "saved_snapshot" ? uiCopy.workbench.versions.type.saved : uiCopy.workbench.versions.type.proposal}</i>
          </button>
        ))}
        {!loading && !error && timeline && !timeline.items.length ? <p className="version-panel-state">{uiCopy.workbench.versions.empty}</p> : null}
      </div>
    </aside>
  );
}

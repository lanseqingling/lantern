"use client";

import { useMemo, useState } from "react";
import type { ArtworkAnnotation, ArtworkAnnotationAnchor, ArtworkAnnotationAttachmentInput } from "@lantern/shared";
import { Icon } from "@lantern/ui";
import { uiCopy } from "@/app/lib/ui-copy";
import { WorkbenchComposerBox } from "./WorkbenchComposerBox";

type AnnotationFilter = "actionable" | "review" | "resolved" | "dismissed" | "all";

export type PendingArtworkAnnotationReference = {
  id: string;
  anchor: ArtworkAnnotationAnchor;
  pageLabel: string;
  targetLabel: string;
};

export type PendingArtworkAnnotationAsset = ArtworkAnnotationAttachmentInput & {
  id: string;
};

function statusLabel(annotation: ArtworkAnnotation) {
  if (annotation.status === "in_progress") return uiCopy.workbench.annotation.status.inProgress;
  if (annotation.status === "awaiting_review") return uiCopy.workbench.annotation.status.awaitingReview;
  if (annotation.status === "resolved") return uiCopy.workbench.annotation.status.resolved;
  if (annotation.status === "dismissed") return uiCopy.workbench.annotation.status.dismissed;
  return uiCopy.workbench.annotation.status.open;
}

function latestContent(annotation: ArtworkAnnotation) {
  return [...annotation.messages].reverse().find((message) => message.authorType === "user")?.content ?? "";
}

function latestAgentReply(annotation: ArtworkAnnotation) {
  return [...annotation.messages].reverse().find((message) =>
    message.authorType === "external_agent" || message.authorType === "internal_agent");
}

function visibleForFilter(annotation: ArtworkAnnotation, filter: AnnotationFilter) {
  if (filter === "actionable") return annotation.status === "open" || annotation.status === "in_progress";
  if (filter === "review") return annotation.status === "awaiting_review";
  if (filter === "resolved") return annotation.status === "resolved";
  if (filter === "dismissed") return annotation.status === "dismissed";
  return true;
}

function referenceSummary(annotation: ArtworkAnnotation) {
  const first = annotation.references[0];
  if (!first) return annotation.attachments.length
    ? uiCopy.workbench.annotation.imageReferenceCount(annotation.attachments.length)
    : uiCopy.workbench.annotation.unbound;
  return annotation.references.length === 1
    ? `${first.pageLabel} · ${first.targetLabel}`
    : uiCopy.workbench.annotation.referenceCount(first.pageLabel, first.targetLabel, annotation.references.length);
}

export function ArtworkAnnotationPanel({
  active,
  annotations,
  loading,
  error,
  draft,
  draftReferences,
  draftAssets,
  saving,
  uploading,
  onDraftChange,
  onSave,
  onReferenceCurrent,
  onRemoveDraftReference,
  onRemoveDraftAsset,
  onOpenAnnotation,
  onAction,
  onDelete,
  onEdit,
  editingAnnotationId,
  onCancelEdit,
  onAddImage,
  onCopyHandoff,
}: {
  active: boolean;
  annotations: ArtworkAnnotation[];
  loading: boolean;
  error: string;
  draft: string;
  draftReferences: PendingArtworkAnnotationReference[];
  draftAssets: PendingArtworkAnnotationAsset[];
  saving: boolean;
  uploading: boolean;
  onDraftChange: (value: string) => void;
  onSave: () => void;
  onReferenceCurrent: () => void;
  onRemoveDraftReference: (id: string) => void;
  onRemoveDraftAsset: (id: string) => void;
  onOpenAnnotation: (annotation: ArtworkAnnotation) => void;
  onAction: (annotation: ArtworkAnnotation, action: "resolve" | "reopen" | "dismiss") => Promise<void>;
  onDelete: (annotation: ArtworkAnnotation) => void;
  onEdit: (annotation: ArtworkAnnotation) => void;
  editingAnnotationId: string | null;
  onCancelEdit: () => void;
  onAddImage?: (file?: File) => void;
  onCopyHandoff: () => void;
}) {
  const [filter, setFilter] = useState<AnnotationFilter>("actionable");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const visible = useMemo(() => annotations.filter((annotation) => visibleForFilter(annotation, filter)), [annotations, filter]);

  const act = async (annotation: ArtworkAnnotation, action: "resolve" | "reopen" | "dismiss") => {
    setBusyId(annotation.id);
    try {
      await onAction(annotation, action);
    } finally {
      setBusyId(null);
    }
  };

  const remove = (annotation: ArtworkAnnotation) => {
    onDelete(annotation);
    setExpandedId((current) => current === annotation.id ? null : current);
    setMenuId(null);
  };

  const openAnnotation = (annotation: ArtworkAnnotation) => {
    setExpandedId((current) => current === annotation.id ? null : annotation.id);
    setMenuId(null);
    onOpenAnnotation(annotation);
  };

  const composerReferences = draftReferences.length || draftAssets.length ? <div className="reference-tags">
    {draftReferences.map((reference) => <button type="button" key={reference.id} aria-label={uiCopy.workbench.annotation.removeReferenceAria(reference.targetLabel)} onClick={() => onRemoveDraftReference(reference.id)}><Icon name="annotation" /><span>{reference.pageLabel} · {reference.targetLabel}</span><Icon name="close" /></button>)}
    {draftAssets.map((asset) => <button type="button" key={asset.id} aria-label={uiCopy.workbench.annotation.removeReferenceAria(asset.name)} onClick={() => onRemoveDraftAsset(asset.id)}><Icon name="asset" /><span>{asset.name}</span><Icon name="close" /></button>)}
  </div> : undefined;

  return (
    <section
      id="agent-panel-annotation"
      className={`agent-panel-view artwork-annotation-panel ${active ? "active" : "inactive"}`}
      role="tabpanel"
      aria-labelledby="agent-panel-annotation-tab"
      aria-hidden={!active}
    >
      <div className="annotation-panel-toolbar">
        <div role="tablist" aria-label={uiCopy.workbench.annotation.panelAria}>
          {(["actionable", "review", "resolved", "dismissed", "all"] as const).map((value) => <button type="button" role="tab" aria-selected={filter === value} className={filter === value ? "active" : ""} key={value} onClick={() => setFilter(value)}>{uiCopy.workbench.annotation.filter[value]}</button>)}
        </div>
        <button type="button" className="annotation-handoff" onClick={onCopyHandoff}><Icon name="copy" />{uiCopy.workbench.annotation.handoff}</button>
      </div>
      <div className="annotation-list embedded-scrollbar">
        {loading ? <p className="annotation-panel-state">{uiCopy.workbench.annotation.loading}</p> : null}
        {!loading && error ? <p className="annotation-panel-state error">{uiCopy.workbench.annotation.loadFailed}</p> : null}
        {!loading && !error && !visible.length ? <div className="annotation-panel-empty"><span><Icon name="annotation" /></span><strong>{uiCopy.workbench.annotation.empty}</strong><p>{uiCopy.workbench.annotation.emptyHint}</p></div> : null}
        {!loading && !error ? visible.map((annotation) => {
          const content = latestContent(annotation);
          const expanded = expandedId === annotation.id;
          const menuOpen = menuId === annotation.id;
          const reply = latestAgentReply(annotation);
          const proposal = [...annotation.work].reverse().find((item) => item.reviewPath);
          return <article className={`annotation-row status-${annotation.status} ${expanded ? "expanded" : ""}`} key={annotation.id}>
            <button type="button" className="annotation-row-trigger" aria-expanded={expanded} aria-label={expanded ? uiCopy.workbench.annotation.collapseAria(content) : uiCopy.workbench.annotation.expandAria(content)} onClick={() => openAnnotation(annotation)}>
              <span className="annotation-row-icon" role="img" aria-label={statusLabel(annotation)}><Icon name="annotation" /></span>
              <strong>{content}</strong>
              <small>{referenceSummary(annotation)}</small>
            </button>
            <button type="button" className="annotation-row-more" aria-label={uiCopy.workbench.annotation.moreAria(content)} aria-expanded={menuOpen} onClick={(event) => { event.stopPropagation(); setMenuId((current) => current === annotation.id ? null : annotation.id); }}><Icon name="moreVertical" /></button>
            {menuOpen ? <div className="annotation-row-menu" role="menu">
              <div className="annotation-row-menu-group">
                <button type="button" disabled={busyId === annotation.id} onClick={() => { onEdit(annotation); setMenuId(null); }}><Icon name="edit" />{uiCopy.workbench.annotation.edit}</button>
              </div>
              <div className="annotation-row-menu-group secondary">
              {annotation.status === "resolved" || annotation.status === "dismissed" ? <button type="button" disabled={busyId === annotation.id} onClick={() => void act(annotation, "reopen")}><Icon name="replace" />{uiCopy.workbench.annotation.restore}</button> : <><button type="button" disabled={busyId === annotation.id} onClick={() => void act(annotation, "resolve")}><Icon name="save" />{uiCopy.workbench.annotation.resolve}</button><button type="button" disabled={busyId === annotation.id} onClick={() => void act(annotation, "dismiss")}><Icon name="close" />{uiCopy.workbench.annotation.shelve}</button></>}
              {proposal?.reviewPath ? <a href={proposal.reviewPath}><Icon name="history" />{uiCopy.workbench.annotation.viewProposal}</a> : null}
              <button type="button" className="danger" disabled={busyId === annotation.id} onClick={() => remove(annotation)}><Icon name="delete" />{uiCopy.workbench.annotation.delete}</button>
              </div>
            </div> : null}
            <div className="annotation-row-reveal"><div>
              <p>{content}</p>
              {annotation.references.length || annotation.attachments.length ? <div className="reference-tags annotation-row-references">{annotation.references.map((reference) => <button type="button" key={reference.id} onClick={() => onOpenAnnotation(annotation)}><Icon name="annotation" /><span>{reference.pageLabel} · {reference.targetLabel}</span>{reference.targetState === "changed" ? <em>{uiCopy.workbench.annotation.targetChanged}</em> : reference.targetState === "missing" ? <em>{uiCopy.workbench.annotation.targetMissing}</em> : null}</button>)}{annotation.attachments.map((attachment) => <span key={attachment.id}><Icon name="asset" />{attachment.name}</span>)}</div> : <small className="annotation-unbound">{uiCopy.workbench.annotation.unbound}</small>}
              {reply ? <blockquote><small>{uiCopy.workbench.annotation.latestReply}</small>{reply.content}</blockquote> : null}
            </div></div>
          </article>;
        }) : null}
      </div>
      <WorkbenchComposerBox
        className="annotation-composer"
        value={draft}
        placeholder={uiCopy.workbench.annotation.draftPlaceholder}
        references={composerReferences}
        submitIcon={editingAnnotationId ? "save" : "add"}
        submitAria={uploading ? uiCopy.workbench.annotation.imageUploadingAria : editingAnnotationId ? uiCopy.workbench.annotation.saveAria : uiCopy.workbench.annotation.addAria}
        addImageAria={uiCopy.workbench.annotation.addImageAria}
        referenceAria={editingAnnotationId ? uiCopy.workbench.annotation.cancelEditAria : uiCopy.workbench.annotation.referenceCurrentAria}
        referenceLabel={editingAnnotationId ? uiCopy.workbench.annotation.modify : uiCopy.workbench.annotation.referenceLabel}
        referenceIcon={editingAnnotationId ? "close" : "annotation"}
        disabled={saving || uploading}
        submitDisabled={!draft.trim() || uploading}
        onChange={onDraftChange}
        onSubmit={onSave}
        onAddImage={onAddImage}
        onReference={editingAnnotationId ? onCancelEdit : onReferenceCurrent}
      />
    </section>
  );
}

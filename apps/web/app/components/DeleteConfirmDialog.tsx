"use client";

import { createPortal } from "react-dom";
import { Icon, type IconName } from "@lantern/ui";
import { useDocumentBody } from "@/app/lib/client-environment";
import { uiCopy } from "@/app/lib/ui-copy";

export function DeleteConfirmDialog({
  dialogId,
  title,
  description,
  confirmLabel = uiCopy.common.action.confirmDelete,
  tone = "danger",
  icon = "delete",
  disabled = false,
  onCancel,
  onConfirm,
}: {
  dialogId: string;
  title: string;
  description: string;
  confirmLabel?: string;
  tone?: "danger" | "neutral";
  icon?: IconName;
  disabled?: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const portalTarget = useDocumentBody();
  const titleId = `${dialogId}-title`;
  const descriptionId = `${dialogId}-description`;

  const dialog = <div className="delete-confirm-overlay" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget && !disabled) onCancel(); }}>
    <section role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} onPointerDown={(event) => event.stopPropagation()}>
      <div className={`delete-confirm-icon ${tone}`}><Icon name={icon} /></div>
      <h2 id={titleId}>{title}</h2>
      <p id={descriptionId}>{description}</p>
      <div className="delete-confirm-actions">
        <button type="button" disabled={disabled} onClick={onCancel}>{uiCopy.common.action.cancel}</button>
        <button type="button" className={tone === "danger" ? "danger" : "neutral-primary"} disabled={disabled} onClick={() => void onConfirm()}>{confirmLabel}</button>
      </div>
    </section>
  </div>;

  return portalTarget ? createPortal(dialog, portalTarget) : null;
}

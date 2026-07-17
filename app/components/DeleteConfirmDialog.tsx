"use client";

import { Icon } from "@/packages/ui/src";

export function DeleteConfirmDialog({
  dialogId,
  title,
  description,
  confirmLabel = "确认删除",
  disabled = false,
  onCancel,
  onConfirm,
}: {
  dialogId: string;
  title: string;
  description: string;
  confirmLabel?: string;
  disabled?: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const titleId = `${dialogId}-title`;
  const descriptionId = `${dialogId}-description`;

  return <div className="delete-confirm-overlay" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget && !disabled) onCancel(); }}>
    <section role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} onPointerDown={(event) => event.stopPropagation()}>
      <div className="delete-confirm-icon"><Icon name="trash" /></div>
      <h2 id={titleId}>{title}</h2>
      <p id={descriptionId}>{description}</p>
      <div className="delete-confirm-actions">
        <button type="button" disabled={disabled} onClick={onCancel}>取消</button>
        <button type="button" className="danger" disabled={disabled} onClick={() => void onConfirm()}>{confirmLabel}</button>
      </div>
    </section>
  </div>;
}

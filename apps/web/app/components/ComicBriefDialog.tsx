"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@lantern/ui";
import { AssetImageViewer } from "@/app/components/AssetImageViewer";
import { DeleteConfirmDialog } from "@/app/components/DeleteConfirmDialog";
import type { ComicAssetImage } from "@/app/lib/api-client";
import { uiCopy } from "@/app/lib/ui-copy";

type ComicBriefDialogProps = {
  title: string;
  eyebrow: string;
  description: string;
  value: string;
  placeholder: string;
  maxLength: number;
  required?: boolean;
  referenceImages?: ComicAssetImage[];
  onUploadReference?: (file: File) => Promise<void>;
  onRenameReference?: (imageId: string, label: string) => Promise<void>;
  onDeleteReference?: (imageId: string) => Promise<void>;
  onSave: (value: string) => Promise<void>;
  onClose: () => void;
};

export function ComicBriefDialog({ title, eyebrow, description, value, placeholder, maxLength, required = false, referenceImages, onUploadReference, onRenameReference, onDeleteReference, onSave, onClose }: ComicBriefDialogProps) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [referenceError, setReferenceError] = useState("");
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [imageMenu, setImageMenu] = useState<{ x: number; y: number; imageId: string } | null>(null);
  const [pendingRenameImageId, setPendingRenameImageId] = useState<string | null>(null);
  const [pendingDeleteImageId, setPendingDeleteImageId] = useState<string | null>(null);
  const [imageNameDraft, setImageNameDraft] = useState("");
  const [imageNameError, setImageNameError] = useState("");
  const [imageMutating, setImageMutating] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const busy = saving || uploading || imageMutating;
  const activeImage = referenceImages?.[Math.min(activeImageIndex, Math.max(0, referenceImages.length - 1))];

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || busy) return;
      if (pendingRenameImageId) {
        setPendingRenameImageId(null);
        setImageNameError("");
      } else if (pendingDeleteImageId) {
        setPendingDeleteImageId(null);
      } else if (imageMenu) {
        setImageMenu(null);
      } else if (editing) {
        setDraft(value);
        setEditing(false);
        setError("");
      } else {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [busy, editing, imageMenu, onClose, pendingDeleteImageId, pendingRenameImageId, value]);

  useEffect(() => {
    if (editing) window.requestAnimationFrame(() => textareaRef.current?.focus());
  }, [editing]);

  const startEditing = () => {
    setDraft(value);
    setError("");
    setEditing(true);
  };

  const cancelEditing = () => {
    if (saving) return;
    setDraft(value);
    setEditing(false);
    setError("");
  };

  const save = async () => {
    const next = draft.trim();
    if (saving || (required && !next)) return;
    setSaving(true);
    setError("");
    try {
      await onSave(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : uiCopy.asset.error.briefSave);
      setSaving(false);
    }
  };

  const uploadReferences = async (files: FileList | null) => {
    if (!files?.length || !onUploadReference || busy) return;
    setUploading(true);
    setReferenceError("");
    try {
      const selectedFiles = Array.from(files);
      for (const file of selectedFiles) await onUploadReference(file);
      setActiveImageIndex((referenceImages?.length ?? 0) + selectedFiles.length - 1);
    } catch (reason) {
      setReferenceError(reason instanceof Error ? reason.message : uiCopy.asset.error.upload);
    } finally {
      setUploading(false);
      if (uploadInputRef.current) uploadInputRef.current.value = "";
    }
  };

  const triggerUpload = () => uploadInputRef.current?.click();

  const renameReference = async () => {
    const label = imageNameDraft.trim();
    if (!pendingRenameImageId || !onRenameReference || imageMutating) return;
    if (!label) {
      setImageNameError(uiCopy.asset.error.nameEmpty);
      return;
    }
    setImageMutating(true);
    setImageNameError("");
    try {
      await onRenameReference(pendingRenameImageId, label);
      setPendingRenameImageId(null);
    } catch (reason) {
      setImageNameError(reason instanceof Error ? reason.message : uiCopy.asset.error.nameSave);
    } finally {
      setImageMutating(false);
    }
  };

  const deleteReference = async () => {
    if (!pendingDeleteImageId || !onDeleteReference || imageMutating) return;
    setImageMutating(true);
    setReferenceError("");
    try {
      await onDeleteReference(pendingDeleteImageId);
      setActiveImageIndex((index) => Math.max(0, index - 1));
      setPendingDeleteImageId(null);
    } catch (reason) {
      setReferenceError(reason instanceof Error ? reason.message : uiCopy.asset.error.delete);
      setPendingDeleteImageId(null);
    } finally {
      setImageMutating(false);
    }
  };

  return <div className="comic-brief-backdrop" role="presentation" onMouseDown={() => { if (!busy) onClose(); }}>
    <section className={`comic-brief-dialog ${referenceImages ? "with-references" : ""}`} role="dialog" aria-modal="true" aria-labelledby="comic-brief-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
      <button type="button" className="comic-brief-dialog-close" aria-label={uiCopy.common.action.close} disabled={busy} onClick={onClose}><Icon name="close" /></button>
      <header>
        <small>{eyebrow}</small>
        <h2 id="comic-brief-dialog-title">{title}</h2>
        <p>{description}</p>
      </header>
      <div className="comic-brief-dialog-content">
        {editing ? <form className="comic-brief-copy asset-detail-copy asset-detail-unified-editor" aria-label={uiCopy.asset.aria.editBrief(title)} onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <div className="asset-detail-copy-actions asset-detail-edit-actions"><button type="button" disabled={saving} onClick={cancelEditing}>{uiCopy.common.action.cancel}</button><button type="submit" className="primary" disabled={saving || (required && !draft.trim())}><Icon name="save" />{saving ? uiCopy.common.progress.saving : uiCopy.common.action.saveDetails}</button></div>
          <label><small>{uiCopy.asset.label.content}</small><textarea ref={textareaRef} aria-label={uiCopy.asset.aria.briefContent(title)} value={draft} maxLength={maxLength} placeholder={placeholder} onChange={(event) => setDraft(event.target.value)} /></label>
          {error ? <em role="alert">{error}</em> : null}
        </form> : <section className="comic-brief-copy asset-detail-copy" aria-label={uiCopy.asset.aria.briefContent(title)}>
          <div className="asset-detail-copy-actions">
            <button type="button" aria-label={uiCopy.asset.aria.editBrief(title)} onClick={startEditing}><Icon name="edit" /></button>
            {onUploadReference ? <button type="button" aria-label={uiCopy.asset.visualStyle.uploadImageAria} disabled={uploading} onClick={triggerUpload}><Icon name="add" /></button> : null}
          </div>
          <div className="asset-detail-section"><small>{uiCopy.asset.label.content}</small><p>{value || uiCopy.asset.detail.emptyContent}</p></div>
          {referenceError ? <em className="asset-image-error" role="alert">{referenceError}</em> : null}
        </section>}
        {referenceImages ? <AssetImageViewer name={title} images={referenceImages} activeIndex={activeImageIndex} onActiveIndexChange={(index) => { setActiveImageIndex(index); setImageMenu(null); }} showPrimary={false} emptyTitle={uploading ? uiCopy.common.progress.uploading : uiCopy.asset.action.addImage} emptyDescription={uiCopy.asset.image.supportedFormats} onEmptyAction={triggerUpload} emptyActionDisabled={busy || !onUploadReference} hideControlsWhenEmpty onStagePointerDown={() => setImageMenu(null)} onImageContextMenu={(event, image) => { event.preventDefault(); event.stopPropagation(); const stage = event.currentTarget.parentElement?.getBoundingClientRect(); const rawX = event.clientX - (stage?.left ?? 0); const rawY = event.clientY - (stage?.top ?? 0); setImageMenu({ x: Math.max(12, Math.min(rawX, (stage?.width ?? rawX + 166) - 166)), y: Math.max(12, Math.min(rawY, (stage?.height ?? rawY + 122) - 122)), imageId: image.id }); }} stageOverlay={imageMenu && activeImage?.id === imageMenu.imageId ? <div className="asset-image-menu" role="menu" style={{ left: imageMenu.x, top: imageMenu.y }} onPointerDown={(event) => event.stopPropagation()}>
          <button type="button" role="menuitem" disabled={imageMutating} onClick={() => { setImageMenu(null); setPendingRenameImageId(activeImage.id); setImageNameDraft(activeImage.label); setImageNameError(""); }}><Icon name="edit" />{uiCopy.common.action.editName}</button>
          <button type="button" role="menuitem" disabled title={uiCopy.asset.image.editUnavailable}><Icon name="ai" />{uiCopy.common.action.createContent}</button>
          <button type="button" role="menuitem" className="danger" disabled={imageMutating} onClick={() => { setImageMenu(null); setPendingDeleteImageId(activeImage.id); }}><Icon name="delete" />{uiCopy.common.action.delete}</button>
        </div> : null} /> : null}
        {onUploadReference ? <input ref={uploadInputRef} className="asset-image-upload-input" type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={(event) => void uploadReferences(event.target.files)} /> : null}
      </div>
      {pendingRenameImageId ? <div className="asset-image-confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !imageMutating) { setPendingRenameImageId(null); setImageNameError(""); } }}><form className="asset-image-confirm asset-image-rename" role="dialog" aria-modal="true" aria-labelledby="visual-style-image-rename-title" onSubmit={(event) => { event.preventDefault(); void renameReference(); }}><span><Icon name="edit" /></span><h3 id="visual-style-image-rename-title">{uiCopy.common.action.renameImage}</h3><p>{uiCopy.asset.visualStyle.renameImageDescription}</p><label><small>{uiCopy.asset.image.label}</small><input autoFocus value={imageNameDraft} maxLength={80} disabled={imageMutating} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setImageNameDraft(event.target.value)} /></label>{imageNameError ? <em role="alert">{imageNameError}</em> : null}<footer><button type="button" disabled={imageMutating} onClick={() => { setPendingRenameImageId(null); setImageNameError(""); }}>{uiCopy.common.action.cancel}</button><button type="submit" className="primary" disabled={imageMutating}>{imageMutating ? uiCopy.common.progress.saving : uiCopy.common.action.save}</button></footer></form></div> : null}
      {pendingDeleteImageId ? <DeleteConfirmDialog dialogId="visual-style-image-delete" title={uiCopy.asset.image.deleteTitle} description={uiCopy.asset.visualStyle.deleteImageDescription} confirmLabel={imageMutating ? uiCopy.common.progress.deleting : uiCopy.common.action.confirmDelete} disabled={imageMutating} onCancel={() => setPendingDeleteImageId(null)} onConfirm={deleteReference} /> : null}
    </section>
  </div>;
}

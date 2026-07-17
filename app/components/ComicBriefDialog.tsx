"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/packages/ui/src";
import { AssetImageViewer } from "@/app/components/AssetImageViewer";
import { DeleteConfirmDialog } from "@/app/components/DeleteConfirmDialog";
import type { ComicAssetImage } from "@/app/lib/api-client";

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
      setError(reason instanceof Error ? reason.message : "保存失败，请稍后重试。");
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
      setReferenceError(reason instanceof Error ? reason.message : "参考图上传失败，请稍后重试。");
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
      setImageNameError("图片名称不能为空。");
      return;
    }
    setImageMutating(true);
    setImageNameError("");
    try {
      await onRenameReference(pendingRenameImageId, label);
      setPendingRenameImageId(null);
    } catch (reason) {
      setImageNameError(reason instanceof Error ? reason.message : "图片名称保存失败，请稍后重试。");
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
      setReferenceError(reason instanceof Error ? reason.message : "图片删除失败，请稍后重试。");
      setPendingDeleteImageId(null);
    } finally {
      setImageMutating(false);
    }
  };

  return <div className="comic-brief-backdrop" role="presentation" onMouseDown={() => { if (!busy) onClose(); }}>
    <section className={`comic-brief-dialog ${referenceImages ? "with-references" : ""}`} role="dialog" aria-modal="true" aria-labelledby="comic-brief-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
      <button type="button" className="comic-brief-dialog-close" aria-label="关闭" disabled={busy} onClick={onClose}><Icon name="x" /></button>
      <header>
        <small>{eyebrow}</small>
        <h2 id="comic-brief-dialog-title">{title}</h2>
        <p>{description}</p>
      </header>
      <div className="comic-brief-dialog-content">
        {editing ? <form className="comic-brief-copy asset-detail-copy asset-detail-unified-editor" aria-label={`编辑${title}`} onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <div className="asset-detail-copy-actions asset-detail-edit-actions"><button type="button" disabled={saving} onClick={cancelEditing}>取消</button><button type="submit" className="primary" disabled={saving || (required && !draft.trim())}><Icon name="save" />{saving ? "保存中…" : "保存资料"}</button></div>
          <label><small>内容</small><textarea ref={textareaRef} aria-label={`${title}内容`} value={draft} maxLength={maxLength} placeholder={placeholder} onChange={(event) => setDraft(event.target.value)} /></label>
          {error ? <em role="alert">{error}</em> : null}
        </form> : <section className="comic-brief-copy asset-detail-copy" aria-label={`${title}内容`}>
          <div className="asset-detail-copy-actions">
            <button type="button" aria-label={`编辑${title}`} onClick={startEditing}><Icon name="edit" /></button>
            {onUploadReference ? <button type="button" aria-label="上传视觉风格参考图片" disabled={uploading} onClick={triggerUpload}><Icon name="add" /></button> : null}
          </div>
          <div className="asset-detail-section"><small>内容</small><p>{value || "暂无内容"}</p></div>
          {referenceError ? <em className="asset-image-error" role="alert">{referenceError}</em> : null}
        </section>}
        {referenceImages ? <AssetImageViewer name={title} images={referenceImages} activeIndex={activeImageIndex} onActiveIndexChange={(index) => { setActiveImageIndex(index); setImageMenu(null); }} showPrimary={false} emptyTitle={uploading ? "上传中…" : "添加参考图片"} emptyDescription="PNG、JPEG 或 WebP" onEmptyAction={triggerUpload} emptyActionDisabled={busy || !onUploadReference} hideControlsWhenEmpty onStagePointerDown={() => setImageMenu(null)} onImageContextMenu={(event, image) => { event.preventDefault(); event.stopPropagation(); const stage = event.currentTarget.parentElement?.getBoundingClientRect(); const rawX = event.clientX - (stage?.left ?? 0); const rawY = event.clientY - (stage?.top ?? 0); setImageMenu({ x: Math.max(12, Math.min(rawX, (stage?.width ?? rawX + 166) - 166)), y: Math.max(12, Math.min(rawY, (stage?.height ?? rawY + 122) - 122)), imageId: image.id }); }} stageOverlay={imageMenu && activeImage?.id === imageMenu.imageId ? <div className="asset-image-menu" role="menu" style={{ left: imageMenu.x, top: imageMenu.y }} onPointerDown={(event) => event.stopPropagation()}>
          <button type="button" role="menuitem" disabled={imageMutating} onClick={() => { setImageMenu(null); setPendingRenameImageId(activeImage.id); setImageNameDraft(activeImage.label); setImageNameError(""); }}><Icon name="edit" />修改名称</button>
          <button type="button" role="menuitem" disabled title="AI 图片精修能力将在后续开放"><Icon name="ai" />创作</button>
          <button type="button" role="menuitem" className="danger" disabled={imageMutating} onClick={() => { setImageMenu(null); setPendingDeleteImageId(activeImage.id); }}><Icon name="trash" />删除</button>
        </div> : null} /> : null}
        {onUploadReference ? <input ref={uploadInputRef} className="asset-image-upload-input" type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={(event) => void uploadReferences(event.target.files)} /> : null}
      </div>
      {pendingRenameImageId ? <div className="asset-image-confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !imageMutating) { setPendingRenameImageId(null); setImageNameError(""); } }}><form className="asset-image-confirm asset-image-rename" role="dialog" aria-modal="true" aria-labelledby="visual-style-image-rename-title" onSubmit={(event) => { event.preventDefault(); void renameReference(); }}><span><Icon name="edit" /></span><h3 id="visual-style-image-rename-title">修改图片名称</h3><p>名称用于区分不同的视觉风格参考图片。</p><label><small>图片名称</small><input autoFocus value={imageNameDraft} maxLength={80} disabled={imageMutating} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setImageNameDraft(event.target.value)} /></label>{imageNameError ? <em role="alert">{imageNameError}</em> : null}<footer><button type="button" disabled={imageMutating} onClick={() => { setPendingRenameImageId(null); setImageNameError(""); }}>取消</button><button type="submit" className="primary" disabled={imageMutating}>{imageMutating ? "保存中…" : "保存"}</button></footer></form></div> : null}
      {pendingDeleteImageId ? <DeleteConfirmDialog dialogId="visual-style-image-delete" title="删除这张图片？" description="图片会从视觉风格参考中移除。" confirmLabel={imageMutating ? "删除中…" : "确认删除"} disabled={imageMutating} onCancel={() => setPendingDeleteImageId(null)} onConfirm={deleteReference} /> : null}
    </section>
  </div>;
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/packages/ui/src";
import { AssetImageViewer } from "@/app/components/AssetImageViewer";
import { DeleteConfirmDialog } from "@/app/components/DeleteConfirmDialog";
import type { ComicAssetDetail, ComicAssetListItem } from "@/app/lib/api-client";

function kindLabel(kind: ComicAssetListItem["kind"]) {
  return ({ character: "角色", scene: "场景", prop: "道具", style: "风格", sketch: "草图", reference_image: "参考", generated_image: "图片" } as const)[kind];
}

type AssetDetailPatch = { name?: string; description?: string };

export function AssetDetailDialog({
  detail,
  loading,
  error,
  onClose,
  onRetry,
  onSaveEntry,
  onUploadImage,
  onSetPrimaryImage,
  onRenameImage,
  onDeleteImage,
  onDeleteAsset,
  returnFocus,
}: {
  detail: ComicAssetDetail | null;
  loading: boolean;
  error: string;
  onClose: () => void;
  onRetry: () => void;
  onSaveEntry: (entryId: string, patch: AssetDetailPatch) => Promise<void>;
  onUploadImage: (entryId: string, file: File) => Promise<void>;
  onSetPrimaryImage: (entryId: string, imageId: string) => Promise<void>;
  onRenameImage: (entryId: string, imageId: string, label: string) => Promise<void>;
  onDeleteImage: (entryId: string, imageId: string) => Promise<void>;
  onDeleteAsset: (assetId: string) => Promise<void>;
  returnFocus: HTMLElement | null;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  const editingRef = useRef(false);
  const editingTitleRef = useRef(false);
  const imageMenuRef = useRef(false);
  const deleteConfirmRef = useRef(false);
  const renameDialogRef = useRef(false);
  const assetMenuRef = useRef(false);
  const assetDeleteConfirmRef = useRef(false);
  const assetDeletingRef = useRef(false);
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleSaving, setTitleSaving] = useState(false);
  const [titleError, setTitleError] = useState("");
  const [titleDraft, setTitleDraft] = useState("");
  const [imageMenu, setImageMenu] = useState<{ x: number; y: number; imageId: string } | null>(null);
  const [pendingDeleteImageId, setPendingDeleteImageId] = useState<string | null>(null);
  const [pendingRenameImageId, setPendingRenameImageId] = useState<string | null>(null);
  const [imageNameDraft, setImageNameDraft] = useState("");
  const [imageNameError, setImageNameError] = useState("");
  const [imageMutating, setImageMutating] = useState(false);
  const [imageError, setImageError] = useState("");
  const [assetMenuOpen, setAssetMenuOpen] = useState(false);
  const [pendingDeleteAsset, setPendingDeleteAsset] = useState(false);
  const [assetDeleting, setAssetDeleting] = useState(false);

  const entries = useMemo(() => detail ? [detail.root, ...detail.variants] : [], [detail]);
  const activeEntry = entries.find((entry) => entry.id === activeEntryId) ?? entries[0];
  const activeImage = activeEntry?.images[activeImageIndex] ?? activeEntry?.images[0];

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    editingRef.current = editing;
  }, [editing]);

  useEffect(() => {
    editingTitleRef.current = editingTitle;
  }, [editingTitle]);

  useEffect(() => { imageMenuRef.current = Boolean(imageMenu); }, [imageMenu]);
  useEffect(() => { deleteConfirmRef.current = Boolean(pendingDeleteImageId); }, [pendingDeleteImageId]);
  useEffect(() => { renameDialogRef.current = Boolean(pendingRenameImageId); }, [pendingRenameImageId]);
  useEffect(() => { assetMenuRef.current = assetMenuOpen; }, [assetMenuOpen]);
  useEffect(() => { assetDeleteConfirmRef.current = pendingDeleteAsset; }, [pendingDeleteAsset]);
  useEffect(() => { assetDeletingRef.current = assetDeleting; }, [assetDeleting]);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 0);
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (assetDeleteConfirmRef.current) {
          if (!assetDeletingRef.current) setPendingDeleteAsset(false);
          return;
        }
        if (renameDialogRef.current) {
          setPendingRenameImageId(null);
          setImageNameError("");
          return;
        }
        if (deleteConfirmRef.current) {
          setPendingDeleteImageId(null);
          return;
        }
        if (imageMenuRef.current) {
          setImageMenu(null);
          return;
        }
        if (assetMenuRef.current) {
          setAssetMenuOpen(false);
          return;
        }
        if (editingTitleRef.current) {
          setEditingTitle(false);
          setTitleError("");
          return;
        }
        if (editingRef.current) {
          setEditing(false);
          setEditError("");
          return;
        }
        onCloseRef.current();
        return;
      }
      if (event.key === "Tab") {
        const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), [href], input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])") ?? []);
        const first = focusable[0];
        const last = focusable.at(-1);
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previousOverflow;
      window.setTimeout(() => returnFocus?.focus(), 0);
    };
  }, [returnFocus]);

  const selectEntry = (entryId: string) => {
    setActiveEntryId(entryId);
    setActiveImageIndex(0);
    setEditing(false);
    setEditingTitle(false);
    setEditError("");
    setTitleError("");
    setImageMenu(null);
    setAssetMenuOpen(false);
    setPendingRenameImageId(null);
    setImageError("");
  };

  const startEditing = () => {
    if (!activeEntry) return;
    setDescriptionDraft(activeEntry.description);
    setEditError("");
    setEditing(true);
  };

  const cancelEditing = () => {
    if (saving) return;
    setEditing(false);
    setEditError("");
  };

  const saveDetails = async () => {
    if (!activeEntry || !editing || saving) return;
    setSaving(true);
    setEditError("");
    try {
      await onSaveEntry(activeEntry.id, {
        description: descriptionDraft.trim(),
      });
      setEditing(false);
    } catch (reason) {
      setEditError(reason instanceof Error ? reason.message : "资产资料保存失败，请稍后重试。");
    } finally {
      setSaving(false);
    }
  };

  const startTitleEditing = () => {
    if (!activeEntry || titleSaving) return;
    setTitleDraft(activeEntry.name);
    setTitleError("");
    setEditingTitle(true);
  };

  const saveTitle = async () => {
    if (!activeEntry || !editingTitle || titleSaving) return;
    const name = titleDraft.trim();
    if (!name) {
      setTitleError("资产名称不能为空。");
      window.requestAnimationFrame(() => titleInputRef.current?.focus());
      return;
    }
    if (name === activeEntry.name) {
      setEditingTitle(false);
      setTitleError("");
      return;
    }
    setTitleSaving(true);
    setTitleError("");
    try {
      await onSaveEntry(activeEntry.id, { name });
      setEditingTitle(false);
    } catch (reason) {
      setTitleError(reason instanceof Error ? reason.message : "资产名称保存失败，请稍后重试。");
      window.requestAnimationFrame(() => titleInputRef.current?.focus());
    } finally {
      setTitleSaving(false);
    }
  };

  const uploadImage = async (file: File) => {
    if (!activeEntry || imageMutating) return;
    setImageMutating(true);
    setImageError("");
    try {
      await onUploadImage(activeEntry.id, file);
      setActiveImageIndex(activeEntry.images.length);
    } catch (reason) {
      setImageError(reason instanceof Error ? reason.message : "图片上传失败，请稍后重试。");
    } finally {
      setImageMutating(false);
      if (uploadInputRef.current) uploadInputRef.current.value = "";
    }
  };

  const setPrimaryImage = async (imageId: string) => {
    if (!activeEntry || imageMutating) return;
    setImageMutating(true);
    setImageMenu(null);
    setImageError("");
    try {
      await onSetPrimaryImage(activeEntry.id, imageId);
      setActiveImageIndex(0);
    } catch (reason) {
      setImageError(reason instanceof Error ? reason.message : "主图设置失败，请稍后重试。");
    } finally {
      setImageMutating(false);
    }
  };

  const deleteImage = async () => {
    if (!activeEntry || !pendingDeleteImageId || imageMutating) return;
    setImageMutating(true);
    setImageError("");
    try {
      await onDeleteImage(activeEntry.id, pendingDeleteImageId);
      setActiveImageIndex((index) => Math.max(0, index - 1));
      setPendingDeleteImageId(null);
    } catch (reason) {
      setImageError(reason instanceof Error ? reason.message : "图片删除失败，请稍后重试。");
    } finally {
      setImageMutating(false);
    }
  };

  const renameImage = async () => {
    if (!activeEntry || !pendingRenameImageId || imageMutating) return;
    const label = imageNameDraft.trim();
    if (!label) {
      setImageNameError("图片名称不能为空。");
      return;
    }
    setImageMutating(true);
    setImageNameError("");
    try {
      await onRenameImage(activeEntry.id, pendingRenameImageId, label);
      setPendingRenameImageId(null);
    } catch (reason) {
      setImageNameError(reason instanceof Error ? reason.message : "图片名称保存失败，请稍后重试。");
    } finally {
      setImageMutating(false);
    }
  };

  const deleteAsset = async () => {
    if (!detail || assetDeleting) return;
    setAssetDeleting(true);
    setImageError("");
    try {
      await onDeleteAsset(detail.root.id);
      setPendingDeleteAsset(false);
      setAssetDeleting(false);
    } catch (reason) {
      setPendingDeleteAsset(false);
      setImageError(reason instanceof Error ? reason.message : "资产删除失败，请稍后重试。");
      setAssetDeleting(false);
    }
  };

  return <div className="asset-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className="asset-detail-dialog" role="dialog" aria-modal="true" aria-label={loading ? "正在加载资产详情" : error ? "资产详情加载失败" : activeEntry?.name} onMouseDown={(event) => event.stopPropagation()}>
      <button ref={closeButtonRef} type="button" className="asset-detail-close" aria-label="关闭资产详情" onClick={onClose}><Icon name="x" /></button>
      {loading ? <div className="asset-detail-loading" role="status"><span /><strong>正在打开资产…</strong></div> : null}
      {!loading && error ? <div className="asset-detail-error" role="alert"><span><Icon name="asset" /></span><strong>资产详情暂时无法读取</strong><p>{error}</p><button type="button" onClick={onRetry}><Icon name="replace" />重新加载</button></div> : null}
      {!loading && !error && detail && activeEntry ? <>
        <header className="asset-detail-head">
          <div><small>{kindLabel(detail.kind)} ASSET</small>{editingTitle ? <input ref={titleInputRef} className="asset-detail-title-input" autoFocus aria-label="资产名称" value={titleDraft} maxLength={120} disabled={titleSaving} onChange={(event) => setTitleDraft(event.target.value)} onBlur={() => void saveTitle()} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} /> : <h2 title="双击编辑资产名称" tabIndex={0} onDoubleClick={startTitleEditing} onKeyDown={(event) => { if (event.key === "Enter" || event.key === "F2") { event.preventDefault(); startTitleEditing(); } }}>{activeEntry.name}</h2>}{titleError ? <em className="asset-detail-title-error" role="alert">{titleError}</em> : null}{entries.length > 1 ? <p>{`共 ${entries.length} 个形态`}</p> : null}</div>
        </header>
        {entries.length > 1 ? <nav className="asset-variant-tabs" aria-label="资产派生形态">
          {entries.map((entry) => <button type="button" key={entry.id} className={entry.id === activeEntry.id ? "active" : ""} aria-pressed={entry.id === activeEntry.id} onClick={() => selectEntry(entry.id)}>{entry.label}</button>)}
        </nav> : null}
        <div className="asset-detail-body">
          {editing ? <form id="asset-detail-edit-form" className="asset-detail-copy asset-detail-unified-editor" aria-label="编辑资产文字资料" onSubmit={(event) => { event.preventDefault(); void saveDetails(); }}>
            <div className="asset-detail-copy-actions asset-detail-edit-actions"><button type="button" disabled={saving} onClick={cancelEditing}>取消</button><button type="submit" className="primary" disabled={saving}><Icon name="save" />{saving ? "保存中…" : "保存资料"}</button></div>
            <label><small>详细描述</small><textarea aria-label="详细描述" value={descriptionDraft} maxLength={4000} onChange={(event) => setDescriptionDraft(event.target.value)} /></label>
            {editError ? <em role="alert">{editError}</em> : null}
          </form> : <section className="asset-detail-copy" aria-label="资产文字资料">
            <div className="asset-detail-copy-actions"><button type="button" aria-label="编辑资产资料" onClick={startEditing}><Icon name="edit" /></button><button type="button" aria-label="上传资产图片" disabled={imageMutating} onClick={() => uploadInputRef.current?.click()}><Icon name="add" /></button><div className="asset-detail-more" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setAssetMenuOpen(false); }}><button type="button" aria-label="更多选项" aria-haspopup="menu" aria-expanded={assetMenuOpen} onClick={() => setAssetMenuOpen((open) => !open)}><Icon name="moreVertical" /></button>{assetMenuOpen ? <div className="asset-detail-more-menu" role="menu"><button type="button" role="menuitem" onClick={() => { setAssetMenuOpen(false); setPendingDeleteAsset(true); }}><Icon name="trash" />删除资产</button></div> : null}</div><input ref={uploadInputRef} className="asset-image-upload-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadImage(file); }} /></div>
            <div className="asset-detail-section"><small>详细描述</small><p>{activeEntry.description || "暂无描述"}</p></div>
            {imageError ? <em className="asset-image-error" role="alert">{imageError}</em> : null}
          </section>}
          <AssetImageViewer name={activeEntry.name} images={activeEntry.images} activeIndex={activeImageIndex} onActiveIndexChange={setActiveImageIndex} onStagePointerDown={() => setImageMenu(null)} onImageContextMenu={(event, image) => { event.preventDefault(); event.stopPropagation(); const stage = event.currentTarget.parentElement?.getBoundingClientRect(); const rawX = event.clientX - (stage?.left ?? 0); const rawY = event.clientY - (stage?.top ?? 0); setImageMenu({ x: Math.max(12, Math.min(rawX, (stage?.width ?? rawX + 166) - 166)), y: Math.max(12, Math.min(rawY, (stage?.height ?? rawY + 122) - 122)), imageId: image.id }); }} stageOverlay={imageMenu && activeImage?.id === imageMenu.imageId ? <div className="asset-image-menu" role="menu" style={{ left: imageMenu.x, top: imageMenu.y }} onPointerDown={(event) => event.stopPropagation()}>
                <button type="button" role="menuitem" disabled={activeImage.isPrimary || imageMutating} onClick={() => void setPrimaryImage(activeImage.id)}><Icon name="pin" />{activeImage.isPrimary ? "当前主图" : "设置为主图"}</button>
                <button type="button" role="menuitem" disabled={imageMutating} onClick={() => { setImageMenu(null); setPendingRenameImageId(activeImage.id); setImageNameDraft(activeImage.label); setImageNameError(""); }}><Icon name="edit" />修改名称</button>
                <button type="button" role="menuitem" disabled title="AI 图片精修能力将在后续开放"><Icon name="ai" />创作</button>
                <button type="button" role="menuitem" className="danger" disabled={imageMutating} onClick={() => { setImageMenu(null); setPendingDeleteImageId(activeImage.id); }}><Icon name="trash" />删除</button>
              </div> : null} />
        </div>
      </> : null}
      {pendingRenameImageId ? <div className="asset-image-confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !imageMutating) { setPendingRenameImageId(null); setImageNameError(""); } }}><form className="asset-image-confirm asset-image-rename" role="dialog" aria-modal="true" aria-labelledby="asset-image-rename-title" onSubmit={(event) => { event.preventDefault(); void renameImage(); }}><span><Icon name="edit" /></span><h3 id="asset-image-rename-title">修改图片名称</h3><p>名称用于区分同一资产中的不同图片。</p><label><small>图片名称</small><input autoFocus value={imageNameDraft} maxLength={80} disabled={imageMutating} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setImageNameDraft(event.target.value)} /></label>{imageNameError ? <em role="alert">{imageNameError}</em> : null}<footer><button type="button" disabled={imageMutating} onClick={() => { setPendingRenameImageId(null); setImageNameError(""); }}>取消</button><button type="submit" className="primary" disabled={imageMutating}>{imageMutating ? "保存中…" : "保存"}</button></footer></form></div> : null}
      {pendingDeleteImageId ? <DeleteConfirmDialog dialogId="asset-image-delete" title="删除这张图片？" description="图片会从当前资产中移除，已经放到画布上的内容不会被打断。" confirmLabel={imageMutating ? "删除中…" : "确认删除"} disabled={imageMutating} onCancel={() => setPendingDeleteImageId(null)} onConfirm={deleteImage} /> : null}
      {pendingDeleteAsset && detail ? <DeleteConfirmDialog dialogId="asset-delete" title={`删除资产“${detail.root.name}”？`} description={detail.variants.length ? `资产及其 ${detail.variants.length} 个派生形态会从资产空间和画布资产列表移除，已经放到页面或画布上的内容不会被打断。` : "资产会从资产空间和画布资产列表移除，已经放到页面或画布上的内容不会被打断。"} confirmLabel={assetDeleting ? "删除中…" : "确认删除"} disabled={assetDeleting} onCancel={() => setPendingDeleteAsset(false)} onConfirm={deleteAsset} /> : null}
    </section>
  </div>;
}

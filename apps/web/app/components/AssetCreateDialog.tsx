"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@lantern/ui";
import { CustomSelect } from "./CustomSelect";

type AssetKind = "character" | "scene" | "prop" | "reference_image";

const kindOptions = [
  { value: "character", label: "角色", icon: "user" as const },
  { value: "scene", label: "场景", icon: "scene" as const },
  { value: "prop", label: "道具", icon: "prop" as const },
  { value: "reference_image", label: "图片", icon: "referenceImage" as const },
];

export function AssetCreateDialog({
  initialKind,
  onCreate,
  onContinueWithAI,
  onClose,
}: {
  initialKind: AssetKind;
  onCreate: (input: { kind: AssetKind; name: string; description: string; image?: File }) => Promise<void>;
  onContinueWithAI: (input: { kind: AssetKind; name: string; description: string }) => Promise<void>;
  onClose: () => void;
}) {
  const nameInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [kind, setKind] = useState<AssetKind>(initialKind);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => setPortalTarget(document.body), []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => nameInputRef.current?.focus(), 0);
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || submitting) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose, submitting]);

  const submit = async () => {
    const trimmedName = name.trim();
    if (!trimmedName || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await onCreate({ kind, name: trimmedName, description: description.trim(), image: image ?? undefined });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "创建资产失败，请稍后重试。");
      setSubmitting(false);
    }
  };

  const continueWithAI = async () => {
    if (submitting) return;
    setError("");
    try {
      await onContinueWithAI({ kind, name: name.trim(), description: description.trim() });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "暂时无法进入对话，请稍后重试。");
    }
  };

  const dialog = <div className="asset-create-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !submitting) onClose(); }}>
    <form className="asset-create-dialog" role="dialog" aria-modal="true" aria-labelledby="asset-create-title" onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <button type="button" className="asset-create-close" aria-label="关闭创建资产" disabled={submitting} onClick={onClose}><Icon name="x" /></button>
      <header><small>NEW ASSET</small><h2 id="asset-create-title">添加资产</h2><p>先补全基础资料；图片可选，之后也能在资产详情中继续添加。</p></header>
      <label>资产类型<CustomSelect ariaLabel="资产类型" className="asset-create-kind" value={kind} options={kindOptions} onChange={(value) => setKind(value as AssetKind)} /></label>
      <label>名称<input ref={nameInputRef} value={name} maxLength={120} disabled={submitting} placeholder="例如：绯色斗篷" onChange={(event) => setName(event.target.value)} /></label>
      <label>描述<textarea value={description} maxLength={4000} disabled={submitting} placeholder="记录外观、用途、性格或在故事中的作用" onChange={(event) => setDescription(event.target.value)} /></label>
      <input ref={imageInputRef} className="asset-create-image-input" type="file" accept="image/png,image/jpeg,image/jpg,image/webp" disabled={submitting} onChange={(event) => setImage(event.target.files?.[0] ?? null)} />
      <div className="asset-create-image"><div><span><Icon name="referenceImage" /></span><strong>{image ? image.name : "添加一张图片"}</strong><small>{image ? "创建后会作为首张图片上传" : "可选，支持 PNG、JPG、WebP"}</small></div><button type="button" disabled={submitting} onClick={() => imageInputRef.current?.click()}>{image ? "重新选择" : "选择图片"}</button></div>
      {error ? <p className="asset-create-error" role="alert">{error}</p> : null}
      <footer><button type="button" disabled={submitting} onClick={onClose}>取消</button><button type="submit" className="primary" disabled={!name.trim() || submitting}>{submitting ? "创建中…" : "创建资产"}</button><button type="button" className="asset-create-ai" aria-label="交给 AI 创建" title="交给 AI 创建" disabled={submitting} onClick={() => void continueWithAI()}><Icon name="ai" /></button></footer>
    </form>
  </div>;

  return portalTarget ? createPortal(dialog, portalTarget) : null;
}

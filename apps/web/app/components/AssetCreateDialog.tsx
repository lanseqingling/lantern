"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@lantern/ui";
import { CustomSelect } from "./CustomSelect";
import { useDocumentBody } from "@/app/lib/client-environment";
import { uiCopy } from "@/app/lib/ui-copy";

type AssetKind = "character" | "scene" | "prop" | "reference_image";

const kindOptions = [
  { value: "character", label: uiCopy.asset.kind.character, icon: "user" as const },
  { value: "scene", label: uiCopy.asset.kind.scene, icon: "scene" as const },
  { value: "prop", label: uiCopy.asset.kind.prop, icon: "prop" as const },
  { value: "reference_image", label: uiCopy.asset.kind.image, icon: "referenceImage" as const },
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
  const portalTarget = useDocumentBody();
  const [kind, setKind] = useState<AssetKind>(initialKind);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

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
      setError(reason instanceof Error ? reason.message : uiCopy.asset.create.failed);
      setSubmitting(false);
    }
  };

  const continueWithAI = async () => {
    if (submitting) return;
    setError("");
    try {
      await onContinueWithAI({ kind, name: name.trim(), description: description.trim() });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : uiCopy.asset.create.aiUnavailable);
    }
  };

  const dialog = <div className="asset-create-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !submitting) onClose(); }}>
    <form className="asset-create-dialog" role="dialog" aria-modal="true" aria-labelledby="asset-create-title" onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <button type="button" className="asset-create-close" aria-label={uiCopy.asset.create.closeAria} disabled={submitting} onClick={onClose}><Icon name="close" /></button>
      <header><small>{uiCopy.eyebrow.newAsset}</small><h2 id="asset-create-title">{uiCopy.asset.create.title}</h2><p>{uiCopy.asset.create.description}</p></header>
      <label>{uiCopy.asset.label.type}<CustomSelect ariaLabel={uiCopy.asset.label.type} className="asset-create-kind" value={kind} options={kindOptions} onChange={(value) => setKind(value as AssetKind)} /></label>
      <label>{uiCopy.common.field.name}<input ref={nameInputRef} value={name} maxLength={120} disabled={submitting} placeholder={uiCopy.asset.create.namePlaceholder} onChange={(event) => setName(event.target.value)} /></label>
      <label>{uiCopy.common.field.description}<textarea value={description} maxLength={4000} disabled={submitting} placeholder={uiCopy.asset.create.descriptionPlaceholder} onChange={(event) => setDescription(event.target.value)} /></label>
      <input ref={imageInputRef} className="asset-create-image-input" type="file" accept="image/png,image/jpeg,image/jpg,image/webp" disabled={submitting} onChange={(event) => setImage(event.target.files?.[0] ?? null)} />
      <div className="asset-create-image"><div><span><Icon name="referenceImage" /></span><strong>{image ? image.name : uiCopy.asset.create.imagePickerEmpty}</strong><small>{image ? uiCopy.asset.create.imageAddedAsPrimary : uiCopy.asset.create.imageOptionalHint}</small></div><button type="button" disabled={submitting} onClick={() => imageInputRef.current?.click()}>{image ? uiCopy.asset.create.imagePickerReplace : uiCopy.asset.create.imagePickerSelect}</button></div>
      {error ? <p className="asset-create-error" role="alert">{error}</p> : null}
      <footer><button type="button" disabled={submitting} onClick={onClose}>{uiCopy.common.action.cancel}</button><button type="submit" className="primary" disabled={!name.trim() || submitting}>{submitting ? uiCopy.asset.create.creating : uiCopy.asset.create.submit}</button><button type="button" className="asset-create-ai" aria-label={uiCopy.asset.create.aiAria} title={uiCopy.asset.create.aiAria} disabled={submitting} onClick={() => void continueWithAI()}><Icon name="ai" /></button></footer>
    </form>
  </div>;

  return portalTarget ? createPortal(dialog, portalTarget) : null;
}

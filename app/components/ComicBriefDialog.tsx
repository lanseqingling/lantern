"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/packages/ui/src";

type ComicBriefDialogProps = {
  title: string;
  eyebrow: string;
  description: string;
  value: string;
  placeholder: string;
  maxLength: number;
  required?: boolean;
  onSave: (value: string) => Promise<void>;
  onClose: () => void;
};

export function ComicBriefDialog({ title, eyebrow, description, value, placeholder, maxLength, required = false, onSave, onClose }: ComicBriefDialogProps) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    textareaRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, saving]);

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

  return <div className="comic-brief-backdrop" role="presentation" onMouseDown={() => { if (!saving) onClose(); }}>
    <section className="comic-brief-dialog" role="dialog" aria-modal="true" aria-labelledby="comic-brief-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
      <button type="button" className="comic-brief-dialog-close" aria-label="关闭" disabled={saving} onClick={onClose}><Icon name="x" /></button>
      <header>
        <small>{eyebrow}</small>
        <h2 id="comic-brief-dialog-title">{title}</h2>
        <p>{description}</p>
      </header>
      <label>
        <span>内容</span>
        <textarea ref={textareaRef} value={draft} maxLength={maxLength} placeholder={placeholder} onChange={(event) => setDraft(event.target.value)} />
        <small>{draft.length} / {maxLength}</small>
      </label>
      {error ? <p className="comic-brief-dialog-error" role="alert">{error}</p> : null}
      <footer>
        <button type="button" disabled={saving} onClick={onClose}>取消</button>
        <button type="button" className="primary" disabled={saving || (required && !draft.trim())} onClick={() => void save()}>{saving ? "保存中…" : "保存"}</button>
      </footer>
    </section>
  </div>;
}

"use client";

import { useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { Icon, type IconName } from "@lantern/ui";

export function WorkbenchComposerBox({
  className = "",
  value,
  placeholder,
  references,
  modeLabel,
  submitIcon,
  submitAria,
  addImageAria,
  referenceAria,
  referenceLabel,
  referenceIcon = "reference",
  testId,
  disabled = false,
  submitDisabled = false,
  textareaRef,
  onChange,
  onSubmit,
  onAddImage,
  onReference,
}: {
  className?: string;
  value: string;
  placeholder: string;
  references?: ReactNode;
  modeLabel?: ReactNode;
  submitIcon: IconName;
  submitAria: string;
  addImageAria?: string;
  referenceAria: string;
  referenceLabel: string;
  referenceIcon?: IconName;
  testId?: string;
  disabled?: boolean;
  submitDisabled?: boolean;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onAddImage?: (file?: File) => void;
  onReference: () => void;
}) {
  const localRef = useRef<HTMLTextAreaElement>(null);
  const activeRef = textareaRef ?? localRef;

  useLayoutEffect(() => {
    const input = activeRef.current;
    if (!input) return;
    input.style.height = "auto";
    const maximum = 157;
    input.style.height = `${Math.min(maximum, Math.max(52, input.scrollHeight))}px`;
    input.style.overflowY = input.scrollHeight > maximum ? "auto" : "hidden";
  }, [activeRef, value]);

  return <div className={`composer-box ${className}`.trim()}>
    {references}
    <textarea
      ref={activeRef}
      data-testid={testId}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" || event.shiftKey) return;
        event.preventDefault();
        if (!submitDisabled) onSubmit();
      }}
    />
    <div className="composer-actions">
      {onAddImage && addImageAria ? <label className={`composer-file-trigger ${disabled ? "disabled" : ""}`} aria-label={addImageAria} aria-disabled={disabled}>
        <input type="file" accept="image/png,image/jpeg,image/jpg,image/webp,.png,.jpg,.jpeg,.webp" hidden disabled={disabled} onChange={(event) => { onAddImage(event.target.files?.[0]); event.currentTarget.value = ""; }} />
        <Icon name="add" />
      </label> : null}
      {modeLabel ? <span className="composer-mode-label">{modeLabel}</span> : null}
      <button type="button" className="at-button" aria-label={referenceAria} disabled={disabled} onClick={onReference}><Icon name={referenceIcon} /><span>{referenceLabel}</span></button>
      <button type="button" className="send" aria-label={submitAria} disabled={disabled || submitDisabled} onClick={onSubmit}><Icon name={submitIcon} /></button>
    </div>
  </div>;
}

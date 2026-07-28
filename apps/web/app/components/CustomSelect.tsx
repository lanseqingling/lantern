"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@lantern/ui";
import type { IconName } from "@lantern/ui";

type DiagramSelectIconName = "page" | "vertical" | "fourPanel";
type SelectIconName = DiagramSelectIconName | IconName;
const diagramIconNames: Record<DiagramSelectIconName, IconName> = {
  page: "comicFormatPage",
  vertical: "comicFormatVertical",
  fourPanel: "comicFormatFourPanel",
};

type CustomSelectOption = {
  value: string;
  label: string;
  detail?: string;
  icon?: SelectIconName;
  disabled?: boolean;
};

function isDiagramSelectIcon(name: SelectIconName): name is DiagramSelectIconName {
  return name === "page" || name === "vertical" || name === "fourPanel";
}

function SelectOptionIcon({ name }: { name: SelectIconName }) {
  const iconName = isDiagramSelectIcon(name) ? diagramIconNames[name] : name;
  return <span className="custom-select-leading-icon" aria-hidden="true"><Icon name={iconName} /></span>;
}

export function CustomSelect({
  ariaLabel,
  className,
  options,
  value,
  onChange,
  disabled = false,
}: {
  ariaLabel: string;
  className?: string;
  options: CustomSelectOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className={`custom-select ${className ?? ""} ${open ? "open" : ""} ${disabled ? "disabled" : ""}`} ref={ref}>
      <button
        type="button"
        className="custom-select-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => { if (!disabled) setOpen((current) => !current); }}
      >
        <span className="custom-select-trigger-label">
          {selected?.icon ? <SelectOptionIcon name={selected.icon} /> : null}
          <span>{selected?.label ?? value}</span>
        </span>
        <span className="custom-select-chevron"><Icon name="chevronDown" /></span>
      </button>
      {open ? (
        <div className="custom-select-menu" role="listbox" aria-label={ariaLabel}>
          {options.map((option) => (
            <button
              type="button"
              role="option"
              aria-selected={option.value === value}
              aria-disabled={option.disabled}
              disabled={option.disabled}
              className={`${option.value === value ? "active" : ""} ${option.disabled ? "disabled" : ""} ${option.icon ? "with-icon" : ""}`}
              key={option.value}
              onClick={() => {
                if (option.disabled) return;
                onChange(option.value);
                setOpen(false);
              }}
            >
              {option.icon ? <SelectOptionIcon name={option.icon} /> : null}
              <span className="custom-select-option-copy">
                <span>{option.label}</span>
                {option.detail ? <small>{option.detail}</small> : null}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/packages/ui/src";
import type { IconName } from "@/packages/ui/src";

type DiagramSelectIconName = "page" | "vertical" | "fourPanel";
type SelectIconName = DiagramSelectIconName | IconName;

type CustomSelectOption = {
  value: string;
  label: string;
  detail?: string;
  icon?: SelectIconName;
  disabled?: boolean;
};

function DiagramSelectIcon({ name }: { name: DiagramSelectIconName }) {
  const pieceCount = name === "vertical" ? 3 : 4;
  return (
    <span className={`custom-select-icon custom-select-icon-${name}`} aria-hidden="true">
      {Array.from({ length: pieceCount }).map((_, index) => <i key={index} />)}
    </span>
  );
}

function isDiagramSelectIcon(name: SelectIconName): name is DiagramSelectIconName {
  return name === "page" || name === "vertical" || name === "fourPanel";
}

function SelectOptionIcon({ name }: { name: SelectIconName }) {
  return isDiagramSelectIcon(name)
    ? <DiagramSelectIcon name={name} />
    : <span className="custom-select-leading-icon" aria-hidden="true"><Icon name={name} /></span>;
}

export function CustomSelect({
  ariaLabel,
  className,
  options,
  value,
  onChange,
}: {
  ariaLabel: string;
  className?: string;
  options: CustomSelectOption[];
  value: string;
  onChange: (value: string) => void;
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
    <div className={`custom-select ${className ?? ""} ${open ? "open" : ""}`} ref={ref}>
      <button
        type="button"
        className="custom-select-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
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

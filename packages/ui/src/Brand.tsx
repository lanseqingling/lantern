import type { HTMLAttributes } from "react";

export type LanternBrandVariant = "hero" | "toolbar";

export type LanternBrandMarkProps = Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
  variant?: LanternBrandVariant;
};

export function LanternBrandMark({ variant = "toolbar", className, ...props }: LanternBrandMarkProps) {
  return <span
    {...props}
    aria-hidden="true"
    className={`lantern-brand-mark lantern-brand-mark-${variant}${className ? ` ${className}` : ""}`}
  />;
}

export type LanternBrandProps = Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
  primary: string;
  accent?: string;
  variant?: LanternBrandVariant;
};

export function LanternBrand({
  primary,
  accent,
  variant = "toolbar",
  className,
  ...props
}: LanternBrandProps) {
  return <span
    {...props}
    className={`lantern-brand lantern-brand-${variant}${className ? ` ${className}` : ""}`}
  >
    <LanternBrandMark variant={variant} />
    <strong className="lantern-brand-wordmark">
      {primary}
      {accent ? <> <em>{accent}</em></> : null}
    </strong>
  </span>;
}

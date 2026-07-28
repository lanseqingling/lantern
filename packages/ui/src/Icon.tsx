import type { CSSProperties, ReactNode, SVGProps } from "react";
import { iconNames, iconRegistry, type IconName } from "./icons/registry";
import { iconSizePixels, type IconSize, type IconTone, type IconVariant } from "./icons/types";

export { iconNames };
export type { IconName, IconSize, IconTone, IconVariant };

export type IconProps = Omit<SVGProps<SVGSVGElement>, "name" | "color"> & {
  name: IconName;
  size?: IconSize | number;
  variant?: IconVariant;
  tone?: IconTone;
  strokeWidth?: number;
};

function definitionStrokeWidth(name: IconName, variant: IconVariant): number {
  const configured = iconRegistry[name].strokeWidth;
  if (typeof configured === "number") return configured;
  return configured?.[variant] ?? configured?.default ?? 2.35;
}

export function Icon({
  name,
  size = "md",
  variant = "default",
  tone = "inherit",
  strokeWidth,
  className,
  style,
  ...props
}: IconProps): ReactNode {
  const definition = iconRegistry[name];
  const Glyph = definition[variant] ?? definition.default;
  const pixels = typeof size === "number" ? size : iconSizePixels[size];
  const mergedStyle = {
    "--icon-size": `${pixels}px`,
    ...style,
  } as CSSProperties;

  return <Glyph
    {...props}
    aria-hidden="true"
    className={`lantern-icon lantern-icon-tone-${tone}${className ? ` ${className}` : ""}`}
    data-icon-name={name}
    data-icon-variant={variant}
    size={pixels}
    strokeWidth={strokeWidth ?? definitionStrokeWidth(name, variant)}
    style={mergedStyle}
  />;
}

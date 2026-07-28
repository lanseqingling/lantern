import type { ButtonHTMLAttributes } from "react";
import { Icon, type IconName, type IconTone, type IconVariant } from "./Icon";

export type IconButtonSize = "compact" | "small" | "medium" | "large";
export type IconButtonAppearance = "ghost" | "soft" | "solid";

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label"> & {
  icon: IconName;
  label: string;
  size?: IconButtonSize;
  appearance?: IconButtonAppearance;
  iconVariant?: IconVariant;
  iconTone?: IconTone;
};

const glyphSizeByButton: Record<IconButtonSize, number> = {
  compact: 12,
  small: 14,
  medium: 16,
  large: 18,
};

export function IconButton({
  icon,
  label,
  size = "medium",
  appearance = "ghost",
  iconVariant,
  iconTone,
  className,
  type = "button",
  ...props
}: IconButtonProps) {
  return <button
    {...props}
    type={type}
    aria-label={label}
    className={`lantern-icon-button lantern-icon-button-${size} lantern-icon-button-${appearance}${className ? ` ${className}` : ""}`}
  >
    <Icon name={icon} size={glyphSizeByButton[size]} variant={iconVariant} tone={iconTone} />
  </button>;
}

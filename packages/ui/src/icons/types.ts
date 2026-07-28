import type { ReactElement, SVGProps } from "react";
import type { LucideIcon } from "lucide-react";

export type IconGlyphProps = SVGProps<SVGSVGElement> & { size?: number | string };
export type IconGlyph = LucideIcon | ((props: IconGlyphProps) => ReactElement);
export type IconVariant = "default" | "compact" | "display";
export type IconTone = "inherit" | "muted" | "accent" | "danger" | "inverse";
export type IconSize = "micro" | "xs" | "sm" | "md" | "lg" | "xl" | "display";

export type IconDefinition = {
  default: IconGlyph;
  compact?: IconGlyph;
  display?: IconGlyph;
  strokeWidth?: number | Partial<Record<IconVariant, number>>;
};

export const iconSizePixels: Record<IconSize, number> = {
  micro: 10,
  xs: 12,
  sm: 14,
  md: 16,
  lg: 18,
  xl: 22,
  display: 32,
};

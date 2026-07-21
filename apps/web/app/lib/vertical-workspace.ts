export const verticalViewportModes = ["off", "phone", "phone_tall", "tablet"] as const;
export type VerticalViewportMode = typeof verticalViewportModes[number];

export const verticalViewportModeMeta: Record<Exclude<VerticalViewportMode, "off">, { label: string; width: number; height: number }> = {
  phone: { label: "手机 9:16", width: 9, height: 16 },
  phone_tall: { label: "长屏手机 9:20", width: 9, height: 20 },
  tablet: { label: "平板 3:4", width: 3, height: 4 },
};

export function nextVerticalViewportMode(mode: VerticalViewportMode): VerticalViewportMode {
  return verticalViewportModes[(verticalViewportModes.indexOf(mode) + 1) % verticalViewportModes.length];
}

export function fitVerticalViewportWidth(baseWidth: number, availableHeight: number, mode: VerticalViewportMode) {
  if (mode === "off") return baseWidth;
  const viewport = verticalViewportModeMeta[mode];
  return Math.min(baseWidth, availableHeight * viewport.width / viewport.height);
}

export function verticalNavigatorWindow(args: { scrollTop: number; viewportHeight: number; contentTop: number; contentHeight: number }) {
  if (args.contentHeight <= 0) return { top: 0, height: 1 };
  const height = Math.min(1, args.viewportHeight / args.contentHeight);
  const rawTop = (args.scrollTop - args.contentTop) / args.contentHeight;
  return { top: Math.max(0, Math.min(1 - height, rawTop)), height };
}

export function fitVerticalNavigatorPaper(width: number, height: number, maxWidth = 50, maxHeight = 148) {
  if (width <= 0 || height <= 0) return { width: maxWidth, height: maxHeight };
  const scale = Math.min(maxWidth / width, maxHeight / height);
  return { width: width * scale, height: height * scale };
}

export function AspectRatioGlyph({ width, height, maxSize = 18 }: { width: number; height: number; maxSize?: number }) {
  const scale = Math.min(maxSize / width, maxSize / height);
  return <span className="aspect-ratio-glyph" aria-hidden="true"><i style={{ width: width * scale, height: height * scale }} /></span>;
}

export function DeviceViewportGlyph({ width, height, disabled = false, className }: { width: number; height: number; disabled?: boolean; className?: string }) {
  return <span className={`device-viewport-glyph ${disabled ? "is-disabled" : ""}${className ? ` ${className}` : ""}`} aria-hidden="true"><i style={{ aspectRatio: `${width} / ${height}` }} /></span>;
}

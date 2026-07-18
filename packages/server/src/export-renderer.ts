import sharp from "sharp";
import type { BalloonElement, ComicDocument, Frame, Geometry, PageSurface, PresentationUnit, SceneElementNode, TextElement } from "../../shared/src";
import { projectBalloonStrokeWidths, projectBalloonTail, projectComicRenderScene, projectImageCrop, projectTextStrokeWidth } from "../../shared/src";
import { prisma } from "./db";
import { getObject, putObject } from "./object-storage";

export type ExportKind = "png" | "long_png" | "json";
export type ExportArtifact = { objectKey: string; contentType: "image/png" | "application/json"; fileName: string; byteSize: number; checksum: string };
const escapeXml = (value: string) => value.replace(/[<>&"']/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "\"": "&quot;", "'": "&apos;" })[char]!);
const textLines = (value: string, maxChars = 12) => Array.from({ length: Math.ceil(Array.from(value).length / maxChars) }, (_, index) => Array.from(value).slice(index * maxChars, (index + 1) * maxChars).join(""));

async function assetDataByVersion(document: ComicDocument) {
  const versionIds = [...new Set(document.resources.filter((resource) => resource.kind === "image").map((resource) => resource.assetVersionId))];
  const versions = versionIds.length ? await prisma.assetVersion.findMany({ where: { id: { in: versionIds } } }) : [];
  const result = new Map<string, string>();
  for (const version of versions) {
    if (!version.objectKey || !version.contentType) continue;
    const bytes = await getObject(version.objectKey);
    result.set(version.id, `data:${version.contentType};base64,${bytes.toString("base64")}`);
  }
  return result;
}

function frameShape(frame: Frame, fill: string, stroke: string, strokeWidth: number) {
  const g = frame.geometry;
  const rough = frame.border.style === "rough" && stroke !== "none" ? ` stroke-dasharray="7 3 2 3"` : "";
  if (frame.shape.kind === "ellipse") return `<ellipse cx="${g.x + g.width / 2}" cy="${g.y + g.height / 2}" rx="${g.width / 2}" ry="${g.height / 2}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"${rough}/>`;
  if (frame.shape.kind === "polygon") return `<polygon points="${frame.shape.points.map((point) => `${g.x + point.x * g.width},${g.y + point.y * g.height}`).join(" ")}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"${rough}/>`;
  return `<rect x="${g.x}" y="${g.y}" width="${g.width}" height="${g.height}" rx="${frame.shape.radius ?? 0}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"${rough}/>`;
}

function transformAttribute(geometry: Geometry) {
  return geometry.rotate ? ` transform="rotate(${geometry.rotate} ${geometry.x + geometry.width / 2} ${geometry.y + geometry.height / 2})"` : "";
}

function renderAppearance(appearance: { assetVersionId: string } | undefined, geometry: Geometry, assets: Map<string, string>) {
  if (!appearance) return undefined;
  const data = assets.get(appearance.assetVersionId);
  if (!data) return undefined;
  return `<image href="${data}" x="${geometry.x}" y="${geometry.y}" width="${geometry.width}" height="${geometry.height}" preserveAspectRatio="none"/>`;
}

const textAnchor = (align: "left" | "center" | "right" | undefined) => align === "center" ? "middle" : align === "right" ? "end" : "start";
const textX = (geometry: Geometry, align: "left" | "center" | "right" | undefined) => align === "center" ? geometry.x + geometry.width / 2 : align === "right" ? geometry.x + geometry.width : geometry.x;

function renderTextContent(value: string, geometry: Geometry, style: TextElement["style"] | BalloonElement["style"], color: string, align: "left" | "center" | "right" | undefined = "center", projectedStrokeWidth?: number) {
  const vertical = style.writingMode === "vertical";
  const fontFamily = escapeXml(style.fontFamily);
  const fontWeight = "fontWeight" in style && style.fontWeight ? ` font-weight="${style.fontWeight}"` : "";
  const strokeWidth = projectedStrokeWidth ?? ("strokeWidth" in style ? style.strokeWidth : undefined);
  const textStroke = "stroke" in style && style.stroke && strokeWidth
    ? ` stroke="${escapeXml(style.stroke)}" stroke-width="${strokeWidth}" stroke-linejoin="round" paint-order="stroke fill"`
    : "";
  if (vertical) {
    const maxRows = Math.max(1, Math.floor(geometry.height / Math.max(1, style.fontSize * 1.05)));
    const columns = textLines(value, maxRows);
    return columns.map((column, columnIndex) => {
      const x = geometry.x + style.fontSize * .55 + columnIndex * style.fontSize * 1.2;
      return `<text x="${x}" y="${geometry.y + style.fontSize}" text-anchor="middle" font-family="${fontFamily}" font-size="${style.fontSize}"${fontWeight}${textStroke} fill="${escapeXml(color)}">${Array.from(column).map((char, index) => `<tspan x="${x}" dy="${index ? style.fontSize * 1.05 : 0}">${escapeXml(char)}</tspan>`).join("")}</text>`;
    }).join("");
  }
  const maxChars = Math.max(1, Math.floor(geometry.width / Math.max(1, style.fontSize * 0.72)));
  const lines = textLines(value, maxChars);
  const x = textX(geometry, align);
  const startY = geometry.y + Math.max(style.fontSize, (geometry.height - lines.length * style.fontSize * 1.2) / 2 + style.fontSize);
  return `<text x="${x}" y="${startY}" text-anchor="${textAnchor(align)}" font-family="${fontFamily}" font-size="${style.fontSize}"${fontWeight}${textStroke} fill="${escapeXml(color)}">${lines.map((line, index) => `<tspan x="${x}" dy="${index ? style.fontSize * 1.2 : 0}">${escapeXml(line)}</tspan>`).join("")}</text>`;
}

function renderBalloonShell(element: BalloonElement, geometry: Geometry) {
  const style = element.style;
  const strokeWidths = projectBalloonStrokeWidths(element);
  const tail = projectBalloonTail(element);
  const tailFill = tail ? `M ${tail.start.x} ${tail.start.y} C ${tail.startControl.x} ${tail.startControl.y}, ${tail.tip.x} ${tail.tip.y}, ${tail.tip.x} ${tail.tip.y} C ${tail.tip.x} ${tail.tip.y}, ${tail.endControl.x} ${tail.endControl.y}, ${tail.end.x} ${tail.end.y} Z` : "";
  const tailOutline = tail ? `M ${tail.start.x} ${tail.start.y} C ${tail.startControl.x} ${tail.startControl.y}, ${tail.tip.x} ${tail.tip.y}, ${tail.tip.x} ${tail.tip.y} C ${tail.tip.x} ${tail.tip.y}, ${tail.endControl.x} ${tail.endControl.y}, ${tail.end.x} ${tail.end.y}` : "";
  const shape = element.shape === "caption_box"
    ? `<rect x="1.5" y="1.5" width="97" height="97" rx="3" fill="${escapeXml(style.fill)}" stroke="${escapeXml(style.stroke)}" stroke-width="${strokeWidths.outline}" vector-effect="non-scaling-stroke"/>`
    : `<ellipse cx="50" cy="50" rx="48" ry="46" fill="${escapeXml(style.fill)}" stroke="${escapeXml(style.stroke)}" stroke-width="${strokeWidths.outline}" vector-effect="non-scaling-stroke"/>`;
  const tailShape = tail ? `<path d="${tailFill}" fill="${escapeXml(style.fill)}"/><path d="${tailOutline}" fill="none" stroke="${escapeXml(style.stroke)}" stroke-width="${strokeWidths.tail}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/><ellipse cx="50" cy="50" rx="48" ry="46" fill="${escapeXml(style.fill)}"/>` : "";
  return `<svg x="${geometry.x}" y="${geometry.y}" width="${geometry.width}" height="${geometry.height}" viewBox="0 0 100 100" overflow="visible" preserveAspectRatio="none">${shape}${tailShape}</svg>`;
}

function renderElement(node: SceneElementNode, assets: Map<string, string>) {
  const element = node.element;
  const geometry = node.geometry;
  const clip = node.clipFrame ? ` clip-path="url(#frame-clip-${escapeXml(node.clipFrame.id)})"` : "";
  const transform = transformAttribute(geometry);
  if (element.kind === "image") {
    const data = assets.get(element.assetVersionId); if (!data) return "";
    const crop = projectImageCrop(element.crop);
    const width = geometry.width * crop.width; const height = geometry.height * crop.height;
    const blend = element.blendMode && element.blendMode !== "normal" ? ` style="mix-blend-mode:${element.blendMode}"` : "";
    return `<image data-scene-id="${escapeXml(element.id)}" href="${data}" x="${geometry.x + crop.x * geometry.width}" y="${geometry.y + crop.y * geometry.height}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice" opacity="${element.opacity ?? 1}"${blend}${clip}${transform}/>`;
  }
  if (element.kind === "balloon") {
    const shell = renderAppearance(element.appearance, geometry, assets) ?? renderBalloonShell(element, geometry);
    return `<g data-scene-id="${escapeXml(element.id)}"${clip}${transform}>${shell}${renderTextContent(node.dialogueText ?? "", geometry, element.style, element.style.textColor, "center")}</g>`;
  }
  if (element.kind === "text") return `<g data-scene-id="${escapeXml(element.id)}"${clip}${transform}>${renderAppearance(element.appearance, geometry, assets) ?? renderTextContent(element.content, geometry, element.style, element.style.color, element.style.align, projectTextStrokeWidth(element))}</g>`;
  if (element.assetVersionId) {
    const data = assets.get(element.assetVersionId); if (!data) return "";
    return `<image data-scene-id="${escapeXml(element.id)}" href="${data}" x="${geometry.x}" y="${geometry.y}" width="${geometry.width}" height="${geometry.height}" preserveAspectRatio="none" opacity="${element.opacity ?? 1}"${clip}${transform}/>`;
  }
  return "";
}

export function renderSurfaceSvg(document: ComicDocument, unit: PresentationUnit, surface: PageSurface, assets = new Map<string, string>()) {
  const scene = projectComicRenderScene(document, unit);
  const defs: string[] = []; const body: Array<{ z: number; svg: string }> = [];
  for (const { frame, fillZIndex, borderZIndex } of scene.frames) {
    const clipId = `frame-clip-${escapeXml(frame.id)}`;
    defs.push(`<clipPath id="${clipId}">${frameShape(frame, "#fff", "none", 0)}</clipPath>`);
    body.push({ z: fillZIndex, svg: frameShape(frame, "#fff", "none", 0) });
    body.push({ z: borderZIndex, svg: frameShape(frame, "none", escapeXml(frame.border.color), frame.border.style === "none" ? 0 : frame.border.width) });
  }
  scene.elements.forEach((node) => body.push({ z: node.zIndex, svg: renderElement(node, assets) }));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${surface.geometry.width}" height="${surface.geometry.height}" viewBox="${surface.geometry.x} ${surface.geometry.y} ${surface.geometry.width} ${surface.geometry.height}"><defs>${defs.join("")}</defs><rect x="${surface.geometry.x}" y="${surface.geometry.y}" width="${surface.geometry.width}" height="${surface.geometry.height}" fill="${escapeXml(unit.canvas.background.color)}"/>${body.sort((a, b) => a.z - b.z).map((entry) => entry.svg).join("")}</svg>`;
}

async function renderSurface(document: ComicDocument, unit: PresentationUnit, surface: PageSurface, assets: Map<string, string>) {
  return sharp(Buffer.from(renderSurfaceSvg(document, unit, surface, assets))).png().toBuffer();
}

export function presentationUnitSurface(unit: PresentationUnit): PageSurface {
  if (unit.kind !== "spread") {
    const surface = unit.surfaces[0];
    if (!surface) throw new Error(`${unit.id} has no output surface`);
    return surface;
  }
  return {
    id: `${unit.id}-presentation`,
    role: "single",
    geometry: { x: 0, y: 0, width: unit.canvas.width, height: unit.canvas.height },
  };
}

export async function renderPagePng(document: ComicDocument, unit: PresentationUnit, surface?: PageSurface) {
  return renderSurface(document, unit, surface ?? presentationUnitSurface(unit), await assetDataByVersion(document));
}

export function createStructuredExportPayload(args: { document: ComicDocument; storyboardBeats: unknown; assetVersions: unknown; exportedAt?: string }) {
  return { protocol: "lantern-export-0.2", lcd: args.document, storyboardBeats: args.storyboardBeats, assetVersions: args.assetVersions, exportedAt: args.exportedAt ?? new Date().toISOString() };
}

export async function renderChapterPngPages(document: ComicDocument) {
  const assets = await assetDataByVersion(document);
  const unitById = new Map(document.units.map((unit) => [unit.id, unit]));
  const outputs: Buffer[] = [];
  for (const unitId of document.reading.unitOrder) {
    const unit = unitById.get(unitId); if (!unit) continue;
    for (const surface of [...unit.surfaces].sort((a, b) => (a.pageNumber ?? 0) - (b.pageNumber ?? 0))) outputs.push(await renderSurface(document, unit, surface, assets));
  }
  return outputs;
}

export async function renderChapterLongPng(document: ComicDocument, pages?: Awaited<ReturnType<typeof renderChapterPngPages>>) {
  const rendered = pages ?? await renderChapterPngPages(document); const gap = document.reading.gap ?? 24;
  const unitById = new Map(document.units.map((unit) => [unit.id, unit]));
  const surfaces = document.reading.unitOrder.flatMap((unitId) => [...(unitById.get(unitId)?.surfaces ?? [])].sort((a, b) => (a.pageNumber ?? 0) - (b.pageNumber ?? 0)));
  const width = Math.max(...surfaces.map((surface) => surface.geometry.width)); const height = surfaces.reduce((sum, surface) => sum + surface.geometry.height, 0) + gap * Math.max(0, rendered.length - 1);
  let top = 0;
  const composite = rendered.map((input, index) => { const surface = surfaces[index]; const item = { input, top, left: Math.floor((width - surface.geometry.width) / 2) }; top += surface.geometry.height + gap; return item; });
  return sharp({ create: { width, height, channels: 4, background: "#ffffff" } }).composite(composite).png().toBuffer();
}

export async function exportChapter(args: { projectId: string; document: ComicDocument; storyboardBeats: unknown; assetVersions: unknown; kind: ExportKind }) {
  const namespace = `exports/${args.projectId}`;
  if (args.kind === "json") {
    const bytes = Buffer.from(JSON.stringify(createStructuredExportPayload(args), null, 2)); const stored = await putObject(bytes, namespace, "json", "application/json");
    return [{ ...stored, fileName: `${args.document.chapterId}.json` }] satisfies ExportArtifact[];
  }
  const pages = await renderChapterPngPages(args.document);
  if (args.kind === "png") {
    const artifacts: ExportArtifact[] = [];
    for (let index = 0; index < pages.length; index += 1) { const stored = await putObject(pages[index], namespace, "png", "image/png"); artifacts.push({ ...stored, fileName: `${args.document.chapterId}-${String(index + 1).padStart(2, "0")}.png` }); }
    return artifacts;
  }
  const stored = await putObject(await renderChapterLongPng(args.document, pages), namespace, "png", "image/png");
  return [{ ...stored, fileName: `${args.document.chapterId}-long.png` }] satisfies ExportArtifact[];
}

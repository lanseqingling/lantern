import sharp from "sharp";
import type { ComicDocument, Frame, FrameElement, Geometry, PageSurface, PresentationUnit } from "../../shared/src";
import { resolveLocalTransform } from "../../shared/src";
import { prisma } from "./db";
import { getObject, putObject } from "./object-storage";

export type ExportKind = "png" | "long_png" | "json";
export type ExportArtifact = { objectKey: string; contentType: "image/png" | "application/json"; fileName: string; byteSize: number; checksum: string };
const escapeXml = (value: string) => value.replace(/[<>&"']/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "\"": "&quot;", "'": "&apos;" })[char]!);
const textLines = (value: string, maxChars = 12) => Array.from({ length: Math.ceil(Array.from(value).length / maxChars) }, (_, index) => Array.from(value).slice(index * maxChars, (index + 1) * maxChars).join("")).slice(0, 5);

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
  if (frame.shape.kind === "ellipse") return `<ellipse cx="${g.x + g.width / 2}" cy="${g.y + g.height / 2}" rx="${g.width / 2}" ry="${g.height / 2}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
  if (frame.shape.kind === "polygon") return `<polygon points="${frame.shape.points.map((point) => `${g.x + point.x * g.width},${g.y + point.y * g.height}`).join(" ")}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
  return `<rect x="${g.x}" y="${g.y}" width="${g.width}" height="${g.height}" rx="${frame.shape.radius ?? 0}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
}

function renderElement(element: FrameElement, geometry: Geometry, assets: Map<string, string>, dialogues: Map<string, string>, clipId?: string) {
  if (element.visible === false) return "";
  const clip = clipId ? ` clip-path="url(#${clipId})"` : "";
  if (element.kind === "image") {
    const data = assets.get(element.assetVersionId); if (!data) return "";
    const crop = element.crop;
    const width = geometry.width / crop.width; const height = geometry.height / crop.height;
    return `<image href="${data}" x="${geometry.x - crop.x * width}" y="${geometry.y - crop.y * height}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice" opacity="${element.opacity ?? 1}"${clip}/>`;
  }
  if (element.kind === "balloon") {
    const value = dialogues.get(element.dialogueId) ?? ""; const style = element.style;
    const shape = element.shape === "caption_box" ? `<rect x="${geometry.x}" y="${geometry.y}" width="${geometry.width}" height="${geometry.height}" rx="5"/>` : `<ellipse cx="${geometry.x + geometry.width / 2}" cy="${geometry.y + geometry.height / 2}" rx="${geometry.width / 2}" ry="${geometry.height / 2}"/>`;
    const lines = textLines(value, Math.max(5, Math.floor(geometry.width / Math.max(12, style.fontSize))));
    return `<g${clip}><g fill="${escapeXml(style.fill)}" stroke="${escapeXml(style.stroke)}" stroke-width="${style.strokeWidth}">${shape}</g><text x="${geometry.x + geometry.width / 2}" y="${geometry.y + Math.max(style.fontSize + 5, (geometry.height - lines.length * style.fontSize * 1.2) / 2 + style.fontSize)}" text-anchor="middle" font-family="sans-serif" font-size="${style.fontSize}" fill="${escapeXml(style.textColor)}">${lines.map((line, index) => `<tspan x="${geometry.x + geometry.width / 2}" dy="${index ? style.fontSize * 1.2 : 0}">${escapeXml(line)}</tspan>`).join("")}</text></g>`;
  }
  if (element.kind === "text") return `<text x="${geometry.x}" y="${geometry.y + element.style.fontSize}" font-family="sans-serif" font-size="${element.style.fontSize}" fill="${escapeXml(element.style.color)}"${clip}>${escapeXml(element.content)}</text>`;
  return "";
}

async function renderSurface(document: ComicDocument, unit: PresentationUnit, surface: PageSurface, assets: Map<string, string>) {
  const dialogues = new Map(document.dialogues.map((dialogue) => [dialogue.id, dialogue.content]));
  const defs: string[] = []; const body: Array<{ z: number; svg: string }> = [];
  for (const frame of unit.frames) {
    const clipId = `frame-clip-${escapeXml(frame.id)}`;
    defs.push(`<clipPath id="${clipId}">${frameShape(frame, "#fff", "none", 0)}</clipPath>`);
    body.push({ z: frame.zIndex * 100, svg: frameShape(frame, "#fff", "none", 0) });
    for (const layer of frame.layers) for (const element of layer.elements) {
      const shouldClip = frame.mask.mode === "clip" && layer.overflow !== "visible" && (!("overflow" in element) || element.overflow !== "visible");
      body.push({ z: frame.zIndex * 100 + layer.zIndex, svg: renderElement(element, resolveLocalTransform(frame.geometry, element.transform), assets, dialogues, shouldClip ? clipId : undefined) });
    }
    body.push({ z: frame.zIndex * 100 + 90, svg: frameShape(frame, "none", escapeXml(frame.border.color), frame.border.style === "none" ? 0 : frame.border.width) });
  }
  for (const layer of unit.overlayLayers) {
    const anchorFrameId = layer.anchor.type === "frame" ? layer.anchor.frameId : undefined;
    const anchorFrame = anchorFrameId ? unit.frames.find((frame) => frame.id === anchorFrameId) : undefined;
    for (const element of layer.elements) {
      const geometry = anchorFrame ? resolveLocalTransform(anchorFrame.geometry, element.transform) : element.transform;
      body.push({ z: 100000 + layer.zIndex, svg: renderElement(element, geometry, assets, dialogues) });
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${surface.geometry.width}" height="${surface.geometry.height}" viewBox="${surface.geometry.x} ${surface.geometry.y} ${surface.geometry.width} ${surface.geometry.height}"><defs>${defs.join("")}</defs><rect x="${surface.geometry.x}" y="${surface.geometry.y}" width="${surface.geometry.width}" height="${surface.geometry.height}" fill="${escapeXml(unit.canvas.background.color)}"/>${body.sort((a, b) => a.z - b.z).map((entry) => entry.svg).join("")}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

export async function renderPagePng(document: ComicDocument, unit: PresentationUnit, surface = unit.surfaces[0]) {
  if (!surface) throw new Error(`${unit.id} has no output surface`);
  return renderSurface(document, unit, surface, await assetDataByVersion(document));
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

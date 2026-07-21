import { prisma } from "./db";
import { AppError } from "./errors";
import { renderPagePng, renderPreviewPageGroupPng } from "./export-renderer";
import { getObject } from "./object-storage";
import { verifySignedAssetPath, verifySignedExportPath } from "./signed-assets";
import { getWorkbench } from "./workbench-service";

export async function getSignedAssetDownload(versionId: string, expires: number, signature: string) {
  if (!verifySignedAssetPath(versionId, expires, signature)) throw new AppError("forbidden", "资源链接已失效。", 403);
  const version = await prisma.assetVersion.findUnique({ where: { id: versionId } });
  if (!version?.objectKey || !version.contentType) throw new AppError("not_found", "资源不存在。", 404);
  return { bytes: await getObject(version.objectKey), contentType: version.contentType };
}

async function savedDocument(ownerUserId: string, chapterId: string) {
  const workbench = await getWorkbench(ownerUserId, chapterId);
  const document = workbench.snapshot?.document;
  if (!document) throw new AppError("not_found", "当前一话还没有已保存版本。", 404);
  return document;
}

export async function getChapterPageDownload(ownerUserId: string, chapterId: string, unitId: string, surfaceId?: string) {
  const document = await savedDocument(ownerUserId, chapterId);
  const unit = document.units.find((item) => item.id === unitId);
  if (!unit) throw new AppError("not_found", surfaceId ? "当前版本中不存在该展示单元。" : "当前版本中不存在该漫画页。", 404);
  if (surfaceId) {
    const surface = unit.surfaces.find((item) => item.id === surfaceId);
    if (!surface) throw new AppError("not_found", "当前展示单元中不存在该物理纸面。", 404);
    return { bytes: await renderPagePng(document, unit, surface), contentType: "image/png" as const, fileName: `${chapterId}-page-${surface.pageNumber ?? 1}.png` };
  }
  const pageNumbers = unit.surfaces
    .map((surface) => surface.pageNumber)
    .filter((pageNumber): pageNumber is number => typeof pageNumber === "number")
    .sort((a, b) => a - b);
  const pageLabel = unit.kind === "spread" && pageNumbers.length > 1
    ? `${pageNumbers[0]}-${pageNumbers.at(-1)}`
    : `${pageNumbers[0] ?? 1}`;
  return { bytes: await renderPagePng(document, unit), contentType: "image/png" as const, fileName: `${chapterId}-page-${pageLabel}.png` };
}

export async function getPreviewSpreadDownload(ownerUserId: string, chapterId: string, firstUnitId: string, secondUnitId: string) {
  const document = await savedDocument(ownerUserId, chapterId);
  const firstIndex = document.reading.unitOrder.indexOf(firstUnitId);
  const secondIndex = document.reading.unitOrder.indexOf(secondUnitId);
  const units = [firstUnitId, secondUnitId].map((unitId) => document.units.find((unit) => unit.id === unitId));
  if (firstIndex < 0 || secondIndex !== firstIndex + 1 || units.some((unit) => !unit || unit.kind !== "single_page")) {
    throw new AppError("validation", "当前两页不能作为同一个双页预览下载。", 400);
  }
  const resolvedUnits = units.filter((unit): unit is NonNullable<typeof unit> => Boolean(unit));
  const pages = resolvedUnits.flatMap((unit) => unit.surfaces);
  const pageNumbers = pages.map((surface) => surface.pageNumber).filter((pageNumber): pageNumber is number => typeof pageNumber === "number").sort((a, b) => a - b);
  return {
    bytes: await renderPreviewPageGroupPng(document, resolvedUnits),
    contentType: "image/png" as const,
    fileName: `${chapterId}-pages-${pageNumbers[0] ?? firstIndex + 1}-${pageNumbers.at(-1) ?? secondIndex + 1}.png`,
  };
}

export async function getSignedExportDownload(taskId: string, index: number, expires: number, signature: string) {
  if (!Number.isInteger(index) || !verifySignedExportPath(taskId, index, expires, signature)) throw new AppError("forbidden", "导出链接已失效。", 403);
  const task = await prisma.generationTask.findUnique({ where: { id: taskId } });
  const output = task?.output as { artifacts?: Array<{ objectKey: string; contentType: string; fileName: string }> } | null;
  const artifact = output?.artifacts?.[index];
  if (!artifact) throw new AppError("not_found", "导出文件不存在。", 404);
  return { bytes: await getObject(artifact.objectKey), contentType: artifact.contentType, fileName: artifact.fileName };
}

import sharp from "sharp";
import type { WorkspaceReference } from "./schemas";
import { prisma } from "@lantern/server/db";
import { getObject } from "@lantern/server/object-storage";
import { QwenVisionProvider } from "./providers/qwen-vision";

async function modelDataUrl(bytes: Buffer, contentType: string) {
  if (bytes.length <= 6 * 1024 * 1024) return `data:${contentType};base64,${bytes.toString("base64")}`;
  const normalized = await sharp(bytes, { limitInputPixels: false })
    .rotate()
    .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  return `data:image/jpeg;base64,${normalized.toString("base64")}`;
}

export async function analyzeImageVersions(input: {
  ownerUserId: string;
  projectId: string;
  message: string;
  versionIds: string[];
}) {
  const versionIds = [...new Set(input.versionIds)].slice(0, 3);
  if (!versionIds.length) return undefined;
  const versions = await prisma.assetVersion.findMany({
    where: {
      id: { in: versionIds },
      objectKey: { not: null },
      contentType: { startsWith: "image/" },
      asset: { ownerUserId: input.ownerUserId, projectId: input.projectId },
    },
  });
  const byId = new Map(versions.map((version) => [version.id, version]));
  const imageUrls: string[] = [];
  for (const versionId of versionIds) {
    const version = byId.get(versionId);
    if (!version?.objectKey || !version.contentType) continue;
    imageUrls.push(await modelDataUrl(await getObject(version.objectKey), version.contentType));
  }
  if (!imageUrls.length) return undefined;
  return new QwenVisionProvider().analyze({ question: input.message, imageUrls });
}

export async function analyzeAttachedImages(input: {
  ownerUserId: string;
  projectId: string;
  message: string;
  references: WorkspaceReference[];
}) {
  return analyzeImageVersions({
    ownerUserId: input.ownerUserId,
    projectId: input.projectId,
    message: input.message,
    versionIds: input.references.map((reference) => reference.versionId).filter((id): id is string => Boolean(id)),
  });
}

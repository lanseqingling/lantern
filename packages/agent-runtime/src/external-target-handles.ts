import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { getConfig } from "@lantern/server/config";
import { prisma } from "@lantern/server/db";
import { AppError } from "@lantern/server/errors";

export const externalTargetHandlePayloadSchema = z.strictObject({
  version: z.literal(1),
  ownerUserId: z.string().min(1),
  projectId: z.string().min(1),
  baseRevision: z.number().int().positive(),
  snapshotId: z.string().min(1).optional(),
  expiresAt: z.number().int().positive(),
  nonce: z.string().min(16),
  target: z.strictObject({
    type: z.string().min(1),
    pageId: z.string().min(1).optional(),
    surfaceId: z.string().min(1).optional(),
    elementId: z.string().min(1).optional(),
    frameId: z.string().min(1).optional(),
    storyboardBeatId: z.string().min(1).optional(),
    assetVersionIds: z.array(z.string().min(1)).max(12),
    dialogueIds: z.array(z.string().min(1)).max(12),
  }),
});

export type ExternalTargetHandlePayload = z.infer<typeof externalTargetHandlePayloadSchema>;

const handlePrefix = "lctx1";
const handleAdditionalData = Buffer.from("lantern-context-handle-v1", "utf8");

function handleKey(secret: string) {
  return createHash("sha256").update(`lantern-context-handle:${secret}`).digest();
}

export function createExternalTargetHandle(
  input: Omit<ExternalTargetHandlePayload, "version" | "nonce">,
  secret = getConfig().LANTERN_MCP_TOKEN,
) {
  const payload: ExternalTargetHandlePayload = {
    ...input,
    version: 1,
    nonce: randomBytes(12).toString("base64url"),
  };
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", handleKey(secret), iv);
  cipher.setAAD(handleAdditionalData);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return [handlePrefix, iv.toString("base64url"), encrypted.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
}

export function decodeExternalTargetHandle(
  handle: string,
  secret = getConfig().LANTERN_MCP_TOKEN,
) {
  try {
    const [prefix, ivValue, encryptedValue, tagValue, extra] = handle.split(".");
    if (prefix !== handlePrefix || !ivValue || !encryptedValue || !tagValue || extra) throw new Error("INVALID_HANDLE_SHAPE");
    const decipher = createDecipheriv("aes-256-gcm", handleKey(secret), Buffer.from(ivValue, "base64url"));
    decipher.setAAD(handleAdditionalData);
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    const decoded = Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64url")), decipher.final()]).toString("utf8");
    return externalTargetHandlePayloadSchema.parse(JSON.parse(decoded));
  } catch {
    throw new AppError("invalid_context_handle", "上下文目标已失效，请重新读取 Lantern 上下文。", 422);
  }
}

export async function resolveExternalTargetHandles(input: {
  ownerUserId: string;
  projectId?: string;
  handles: string[];
  expectedRevision?: number;
  allowSavedSnapshot?: boolean;
  now?: number;
}) {
  if (new Set(input.handles).size !== input.handles.length) {
    throw new AppError("invalid_context_handle", "同一次调用不能重复提交同一个上下文目标。", 422);
  }
  const decoded = input.handles.map((handle) => ({ handle, payload: decodeExternalTargetHandle(handle) }));
  const projectId = input.projectId ?? decoded[0]?.payload.projectId;
  if (!projectId || decoded.some(({ payload }) => payload.ownerUserId !== input.ownerUserId || payload.projectId !== projectId)) {
    throw new AppError("invalid_context_handle", "上下文目标不属于当前创作空间。", 403);
  }
  if (decoded.some(({ payload }) => payload.expiresAt <= (input.now ?? Date.now()))) {
    throw new AppError("context_handle_expired", "上下文目标已过期，请重新读取 Lantern 上下文。", 409);
  }
  const snapshotIds = [...new Set(decoded.map(({ payload }) => payload.snapshotId ?? null))];
  if (snapshotIds.length !== 1) {
    throw new AppError("invalid_context_handle", "同一次调用的上下文目标必须来自同一个作品版本。", 422);
  }
  const snapshotId = snapshotIds[0];
  if (snapshotId) {
    if (!input.allowSavedSnapshot) {
      throw new AppError("saved_snapshot_read_only", "已保存版本目标仅供观察，不能用于修改当前工作稿。", 422);
    }
    if (input.expectedRevision !== undefined) {
      throw new AppError("saved_snapshot_read_only", "已保存版本目标不能携带工作稿修改版本。", 422);
    }
    const snapshot = await prisma.savedSnapshot.findFirst({
      where: {
        id: snapshotId,
        projectId,
        ownerUserId: input.ownerUserId,
        project: { chapter: { archivedAt: null, comic: { archivedAt: null } } },
      },
      select: { id: true, sourceWorkingRevision: true, createdAt: true },
    });
    if (!snapshot) throw new AppError("not_found", "已保存版本不存在或不属于当前创作空间。", 404);
    if (decoded.some(({ payload }) => payload.baseRevision !== snapshot.sourceWorkingRevision)) {
      throw new AppError("invalid_context_handle", "已保存版本目标与其来源修订不一致。", 422);
    }
    return {
      projectId,
      workingRevision: snapshot.sourceWorkingRevision,
      source: {
        kind: "saved_snapshot" as const,
        snapshotId: snapshot.id,
        sourceWorkingRevision: snapshot.sourceWorkingRevision,
        createdAt: snapshot.createdAt.toISOString(),
      },
      decoded,
    };
  }
  const working = await prisma.workingRevision.findFirst({
    where: { projectId, project: { ownerUserId: input.ownerUserId } },
    orderBy: { revision: "desc" },
    select: { revision: true, createdAt: true },
  });
  if (!working) throw new AppError("not_found", "工作稿不存在。", 404);
  if (input.expectedRevision !== undefined && input.expectedRevision !== working.revision) {
    throw new AppError("revision_conflict", "工作稿已经变化，请重新读取 Lantern 上下文。", 409, {
      expectedRevision: input.expectedRevision,
      currentRevision: working.revision,
    });
  }
  if (decoded.some(({ payload }) => payload.baseRevision !== working.revision)) {
    throw new AppError("context_stale", "工作稿已经变化，请重新读取 Lantern 上下文。", 409, {
      currentRevision: working.revision,
    });
  }
  return {
    projectId,
    workingRevision: working.revision,
    source: {
      kind: "working" as const,
      workingRevision: working.revision,
      createdAt: working.createdAt.toISOString(),
    },
    decoded,
  };
}

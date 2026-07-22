import { createHash } from "node:crypto";
import { ExternalOperationStatus, type Prisma } from "@prisma/client";
import { prisma } from "./db";
import { AppError } from "./errors";

type ExternalMutationInput<T> = {
  ownerUserId: string;
  capabilityId: string;
  capabilityVersion: number;
  idempotencyKey: string;
  input: unknown;
  operation: () => Promise<T>;
};

function stableJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, stableJson(item)]));
}

function persistedJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function inputFingerprint(capabilityId: string, capabilityVersion: number, input: unknown) {
  const normalized = typeof input === "object" && input !== null
    ? Object.fromEntries(Object.entries(input as Record<string, unknown>).filter(([key]) => key !== "idempotencyKey"))
    : input;
  return createHash("sha256")
    .update(JSON.stringify(stableJson({ capabilityId, capabilityVersion, input: normalized })))
    .digest("hex");
}

function targetReference(input: unknown) {
  if (!input || typeof input !== "object") return undefined;
  const record = input as Record<string, unknown>;
  return [record.asset, record.chapter, record.comic].find((value): value is string => typeof value === "string");
}

function operationError(error: unknown) {
  return error instanceof AppError
    ? { code: error.code, message: error.message }
    : { code: "internal", message: "Lantern 未能完成这次同步写入。" };
}

export async function executeIdempotentExternalMutation<T>(input: ExternalMutationInput<T>): Promise<T> {
  const fingerprint = inputFingerprint(input.capabilityId, input.capabilityVersion, input.input);
  let operation = await prisma.externalAgentOperation.findUnique({
    where: { ownerUserId_idempotencyKey: { ownerUserId: input.ownerUserId, idempotencyKey: input.idempotencyKey } },
  });
  let created = false;

  if (!operation) {
    try {
      operation = await prisma.externalAgentOperation.create({
        data: {
          ownerUserId: input.ownerUserId,
          capabilityId: input.capabilityId,
          capabilityVersion: input.capabilityVersion,
          idempotencyKey: input.idempotencyKey,
          inputHash: fingerprint,
          targetReference: targetReference(input.input),
        },
      });
      created = true;
    } catch {
      operation = await prisma.externalAgentOperation.findUnique({
        where: { ownerUserId_idempotencyKey: { ownerUserId: input.ownerUserId, idempotencyKey: input.idempotencyKey } },
      });
      if (!operation) throw new AppError("idempotency_unavailable", "无法建立同步写入记录，请重试。", 503);
    }
  }

  if (operation.capabilityId !== input.capabilityId
    || operation.capabilityVersion !== input.capabilityVersion
    || operation.inputHash !== fingerprint) {
    throw new AppError("idempotency_conflict", "该幂等键已经用于另一项 Lantern 写入。", 409, {
      capabilityId: operation.capabilityId,
      targetReference: operation.targetReference,
    });
  }

  if (operation.status === ExternalOperationStatus.SUCCEEDED && operation.result !== null) {
    return persistedJson(operation.result) as T;
  }
  if (!created && operation.status === ExternalOperationStatus.RUNNING) {
    throw new AppError("operation_in_progress", "相同写入仍在执行，请稍后使用同一幂等键查询结果。", 409);
  }
  if (!created && operation.status === ExternalOperationStatus.FAILED) {
    const claimed = await prisma.externalAgentOperation.updateMany({
      where: { id: operation.id, status: ExternalOperationStatus.FAILED },
      data: {
        status: ExternalOperationStatus.RUNNING,
        startedAt: new Date(),
        completedAt: null,
        errorCode: null,
        errorMessage: null,
      },
    });
    if (claimed.count !== 1) throw new AppError("operation_in_progress", "相同写入仍在执行，请稍后重试。", 409);
  }

  try {
    const result = persistedJson(await input.operation());
    const resultRecord = result as unknown as { resource?: { uri?: string } };
    await prisma.externalAgentOperation.update({
      where: { id: operation.id },
      data: {
        status: ExternalOperationStatus.SUCCEEDED,
        result: result as unknown as Prisma.InputJsonValue,
        targetReference: resultRecord.resource?.uri ?? operation.targetReference,
        completedAt: new Date(),
      },
    });
    return result;
  } catch (error) {
    const recorded = operationError(error);
    await prisma.externalAgentOperation.update({
      where: { id: operation.id },
      data: {
        status: ExternalOperationStatus.FAILED,
        errorCode: recorded.code,
        errorMessage: recorded.message,
        completedAt: new Date(),
      },
    }).catch(() => undefined);
    throw error;
  }
}

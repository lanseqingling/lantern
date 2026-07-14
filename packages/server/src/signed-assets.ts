import { createHmac, timingSafeEqual } from "node:crypto";
import { getConfig } from "./config";

function signature(versionId: string, expires: number) {
  return createHmac("sha256", getConfig().SESSION_SECRET).update(`${versionId}:${expires}`).digest("base64url");
}

function expiryWindow(ttlSeconds: number) {
  const now = Math.floor(Date.now() / 1000);
  return (Math.floor(now / ttlSeconds) + 1) * ttlSeconds;
}

export function createSignedAssetPath(versionId: string, ttlSeconds = 900) {
  const expires = expiryWindow(ttlSeconds);
  return `/v1/objects/${encodeURIComponent(versionId)}?expires=${expires}&signature=${signature(versionId, expires)}`;
}

export function verifySignedAssetPath(versionId: string, expires: number, supplied: string) {
  if (!Number.isSafeInteger(expires) || expires < Math.floor(Date.now() / 1000)) return false;
  const expected = signature(versionId, expires);
  if (expected.length !== supplied.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
}

export function createSignedExportPath(taskId: string, index: number, ttlSeconds = 900) {
  const expires = expiryWindow(ttlSeconds);
  return `/v1/exports/${encodeURIComponent(taskId)}/${index}?expires=${expires}&signature=${signature(`export:${taskId}:${index}`, expires)}`;
}

export function verifySignedExportPath(taskId: string, index: number, expires: number, supplied: string) {
  return verifySignedAssetPath(`export:${taskId}:${index}`, expires, supplied);
}

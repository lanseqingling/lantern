import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { getRuntimePaths } from "./runtime-paths";

const allowedTypes = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
]);

const MAX_IMAGE_BYTES = 50 * 1024 * 1024;

export type StoredObject = {
  objectKey: string;
  contentType: "image/png" | "image/jpeg" | "image/webp";
  byteSize: number;
  checksum: string;
  width?: number;
  height?: number;
};

function sniffContentType(bytes: Buffer) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png" as const;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg" as const;
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp" as const;
  throw new Error("UNSUPPORTED_IMAGE_CONTENT");
}

async function inspectImage(bytes: Buffer): Promise<{ contentType: StoredObject["contentType"]; width?: number; height?: number }> {
  try {
    const contentType = sniffContentType(bytes);
    return { contentType, ...imageDimensions(bytes, contentType) };
  } catch {
    const metadata = await sharp(bytes, { limitInputPixels: false }).metadata();
    const contentType: StoredObject["contentType"] | undefined = metadata.format === "jpeg" || metadata.format === "jpg"
      ? "image/jpeg"
      : metadata.format === "png"
        ? "image/png"
        : metadata.format === "webp"
          ? "image/webp"
          : undefined;
    if (!contentType) throw new Error("UNSUPPORTED_IMAGE_CONTENT");
    return { contentType, width: metadata.width, height: metadata.height };
  }
}

function imageDimensions(bytes: Buffer, contentType: StoredObject["contentType"]) {
  if (contentType === "image/png" && bytes.length >= 24) return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  if (contentType === "image/webp" && bytes.length >= 30 && bytes.subarray(12, 16).toString("ascii") === "VP8X") {
    return {
      width: 1 + bytes.readUIntLE(24, 3),
      height: 1 + bytes.readUIntLE(27, 3),
    };
  }
  return {};
}

function storageRoot() {
  return getRuntimePaths().objectsDir;
}

function assertObjectKey(objectKey: string) {
  if (!/^[a-zA-Z0-9/_-]+\.(png|jpg|webp|json)$/.test(objectKey) || objectKey.includes("..")) throw new Error("INVALID_OBJECT_KEY");
}

function categorizedNamespace(namespace: string, category: "image" | "export") {
  if (!/^[a-zA-Z0-9/_-]+$/.test(namespace) || namespace.includes("..")) throw new Error("INVALID_OBJECT_NAMESPACE");
  if (namespace.startsWith("assets/") || namespace.startsWith("candidates/") || namespace.startsWith("exports/")) return namespace;
  if (category === "export") return `exports/${namespace}`;
  return namespace.includes("candidate") ? `candidates/${namespace}` : `assets/${namespace}`;
}

export async function putImage(bytes: Buffer, namespace: string): Promise<StoredObject> {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error("IMAGE_SIZE_LIMIT");
  const inspected = await inspectImage(bytes);
  const contentType = inspected.contentType;
  const extension = allowedTypes.get(contentType)!;
  const objectKey = `${categorizedNamespace(namespace, "image")}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}${extension}`;
  const target = path.join(storageRoot(), objectKey);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes, { flag: "wx" });
  return {
    objectKey,
    contentType,
    byteSize: bytes.length,
    checksum: createHash("sha256").update(bytes).digest("hex"),
    width: inspected.width,
    height: inspected.height,
  };
}

export async function putObject(bytes: Buffer, namespace: string, extension: "png" | "json", contentType: "image/png" | "application/json") {
  if (!bytes.length || bytes.length > 100 * 1024 * 1024) throw new Error("OBJECT_SIZE_LIMIT");
  const objectKey = `${categorizedNamespace(namespace, "export")}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${extension}`;
  const target = path.join(storageRoot(), objectKey);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes, { flag: "wx" });
  return {
    objectKey,
    contentType,
    byteSize: bytes.length,
    checksum: createHash("sha256").update(bytes).digest("hex"),
  };
}

export async function getObject(objectKey: string) {
  assertObjectKey(objectKey);
  return readFile(path.join(storageRoot(), objectKey));
}

export async function deleteObject(objectKey: string) {
  assertObjectKey(objectKey);
  await unlink(path.join(storageRoot(), objectKey)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

export async function clearImageNamespace(namespace: string) {
  const objectNamespace = categorizedNamespace(namespace, "image");
  await rm(path.join(storageRoot(), objectNamespace), { recursive: true, force: true });
}

export async function assertSupportedUpload(_declaredContentType: string, bytes: Buffer) {
  const actual = (await inspectImage(bytes)).contentType;
  // Mobile exports occasionally keep a .jpg name after encoding PNG bytes.
  // The declared multipart type is derived from that name, so use the sniffed
  // bytes as the authority. Unsupported content still fails in inspectImage.
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error("IMAGE_SIZE_LIMIT");
  return actual;
}

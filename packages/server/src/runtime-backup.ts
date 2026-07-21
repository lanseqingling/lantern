import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { strToU8, unzipSync, zipSync } from "fflate";
import { z } from "zod";
import type { LanternRuntimePaths } from "./runtime-paths";

const BACKUP_PROTOCOL = "lantern-backup-1";
const ARCHIVE_ROOT = "lantern-backup";
const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 8 * 1024 * 1024 * 1024;
const MAX_BACKUP_FILES = 50_000;

const backupFileSchema = z.strictObject({
  path: z.string().min(1),
  byteSize: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

const backupManifestSchema = z.strictObject({
  protocol: z.literal(BACKUP_PROTOCOL),
  createdAt: z.string().datetime(),
  lanternVersion: z.string().min(1),
  files: z.array(backupFileSchema).min(1).max(MAX_BACKUP_FILES),
});

export type RuntimeBackupManifest = z.infer<typeof backupManifestSchema>;

function checksum(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function archivePath(relativePath: string) {
  return `${ARCHIVE_ROOT}/${relativePath.replaceAll("\\", "/")}`;
}

function assertBackupRelativePath(relativePath: string) {
  const normalized = relativePath.replaceAll("\\", "/");
  if (normalized !== relativePath || path.posix.normalize(normalized) !== normalized || normalized.startsWith("/") || normalized.includes("..")) {
    throw new Error(`INVALID_BACKUP_PATH:${relativePath}`);
  }
  if (normalized !== "lantern.db" && !normalized.startsWith("objects/")) throw new Error(`UNSUPPORTED_BACKUP_PATH:${relativePath}`);
}

async function collectFiles(root: string, prefix: string): Promise<Array<{ absolutePath: string; relativePath: string }>> {
  const result: Array<{ absolutePath: string; relativePath: string }> = [];
  const visit = async (directory: string, relativeDirectory: string) => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = path.posix.join(prefix, relativeDirectory.replaceAll("\\", "/"), entry.name);
      if (entry.isSymbolicLink()) throw new Error(`BACKUP_SYMLINK_NOT_ALLOWED:${relativePath}`);
      if (entry.isDirectory()) await visit(absolutePath, path.join(relativeDirectory, entry.name));
      else if (entry.isFile()) result.push({ absolutePath, relativePath });
    }
  };
  await visit(root, "");
  return result;
}

function databaseUrl(databaseFile: string) {
  return `file:${path.resolve(databaseFile).replaceAll("\\", "/")}`;
}

async function assertDatabaseIntegrity(databaseFile: string, checkpoint = false) {
  const client = new PrismaClient({ datasourceUrl: databaseUrl(databaseFile), log: ["error"] });
  try {
    await client.$connect();
    if (checkpoint) await client.$queryRawUnsafe("PRAGMA wal_checkpoint(TRUNCATE)");
    const rows = await client.$queryRawUnsafe<Array<{ integrity_check: string }>>("PRAGMA integrity_check");
    if (rows.length !== 1 || rows[0]?.integrity_check !== "ok") throw new Error("BACKUP_DATABASE_INTEGRITY_FAILED");
  } finally {
    await client.$disconnect();
  }
}

export async function createRuntimeBackup(
  paths: LanternRuntimePaths,
  options: { lanternVersion: string; outputFile?: string },
) {
  await assertDatabaseIntegrity(paths.databaseFile, true);
  const sourceFiles = [
    { absolutePath: paths.databaseFile, relativePath: "lantern.db" },
    ...await collectFiles(paths.objectsDir, "objects"),
  ];
  if (sourceFiles.length > MAX_BACKUP_FILES) throw new Error(`BACKUP_FILE_LIMIT_EXCEEDED:${sourceFiles.length}`);

  const archive: Record<string, Uint8Array | [Uint8Array, { os: number; attrs: number }]> = {};
  const files: RuntimeBackupManifest["files"] = [];
  for (const file of sourceFiles) {
    assertBackupRelativePath(file.relativePath);
    const bytes = new Uint8Array(await readFile(file.absolutePath));
    files.push({ path: file.relativePath, byteSize: bytes.byteLength, sha256: checksum(bytes) });
    archive[archivePath(file.relativePath)] = [bytes, { os: 3, attrs: 0o600 << 16 }];
  }

  const manifest: RuntimeBackupManifest = {
    protocol: BACKUP_PROTOCOL,
    createdAt: new Date().toISOString(),
    lanternVersion: options.lanternVersion,
    files,
  };
  archive[archivePath("manifest.json")] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);
  const timestamp = manifest.createdAt.replaceAll(":", "-").replaceAll(".", "-");
  const outputFile = path.resolve(options.outputFile ?? path.join(paths.backupsDir, `lantern-backup-${timestamp}.zip`));
  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(outputFile, zipSync(archive, { level: 6 }), { mode: 0o600 });
  await chmod(outputFile, 0o600).catch(() => undefined);
  return { outputFile, manifest };
}

function parseRuntimeBackup(bytes: Uint8Array) {
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) throw new Error(`BACKUP_ARCHIVE_TOO_LARGE:${bytes.byteLength}`);
  let extractedBytes = 0;
  let fileCount = 0;
  const entries = unzipSync(bytes, {
    filter(file) {
      fileCount += 1;
      extractedBytes += file.originalSize;
      if (fileCount > MAX_BACKUP_FILES + 1) throw new Error(`BACKUP_FILE_LIMIT_EXCEEDED:${fileCount}`);
      if (extractedBytes > MAX_EXTRACTED_BYTES) throw new Error(`BACKUP_EXTRACTED_SIZE_LIMIT_EXCEEDED:${extractedBytes}`);
      return true;
    },
  });
  const manifestBytes = entries[archivePath("manifest.json")];
  if (!manifestBytes) throw new Error("BACKUP_MANIFEST_MISSING");
  const manifest = backupManifestSchema.parse(JSON.parse(Buffer.from(manifestBytes).toString("utf8")));
  const declaredPaths = new Set<string>();
  for (const file of manifest.files) {
    assertBackupRelativePath(file.path);
    if (declaredPaths.has(file.path)) throw new Error(`BACKUP_DUPLICATE_PATH:${file.path}`);
    declaredPaths.add(file.path);
    const entry = entries[archivePath(file.path)];
    if (!entry) throw new Error(`BACKUP_FILE_MISSING:${file.path}`);
    if (entry.byteLength !== file.byteSize) throw new Error(`BACKUP_SIZE_MISMATCH:${file.path}`);
    if (checksum(entry) !== file.sha256) throw new Error(`BACKUP_CHECKSUM_MISMATCH:${file.path}`);
  }
  if (!declaredPaths.has("lantern.db")) throw new Error("BACKUP_DATABASE_MISSING");
  for (const name of Object.keys(entries)) {
    if (name === archivePath("manifest.json")) continue;
    if (!name.startsWith(`${ARCHIVE_ROOT}/`)) throw new Error(`BACKUP_UNDECLARED_FILE:${name}`);
    const relativePath = name.slice(ARCHIVE_ROOT.length + 1);
    if (!declaredPaths.has(relativePath)) throw new Error(`BACKUP_UNDECLARED_FILE:${name}`);
  }
  return { entries, manifest };
}

async function moveIfPresent(source: string, target: string) {
  const exists = await stat(source).then(() => true).catch(() => false);
  if (!exists) return false;
  await rename(source, target);
  return true;
}

export async function restoreRuntimeBackup(
  paths: LanternRuntimePaths,
  backupFile: string,
  options: { prepareDatabase?: (databaseFile: string) => Promise<void> } = {},
) {
  const parsed = parseRuntimeBackup(new Uint8Array(await readFile(path.resolve(backupFile))));
  const operationId = `${process.pid}-${randomUUID()}`;
  const stagingRoot = path.join(paths.tempDir, `backup-restore-${operationId}`);
  const stagedDatabase = path.join(stagingRoot, "lantern.db");
  const stagedObjects = path.join(stagingRoot, "objects");
  await mkdir(stagedObjects, { recursive: true });
  try {
    for (const file of parsed.manifest.files) {
      const target = file.path === "lantern.db"
        ? stagedDatabase
        : path.join(stagingRoot, ...file.path.split("/"));
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, parsed.entries[archivePath(file.path)], { mode: 0o600 });
    }
    await assertDatabaseIntegrity(stagedDatabase);
    await options.prepareDatabase?.(stagedDatabase);
    await assertDatabaseIntegrity(stagedDatabase, true);

    const previousDatabase = `${paths.databaseFile}.restore-${operationId}`;
    const previousWal = `${previousDatabase}-wal`;
    const previousShm = `${previousDatabase}-shm`;
    const previousObjects = `${paths.objectsDir}.restore-${operationId}`;
    const movedDatabase = await moveIfPresent(paths.databaseFile, previousDatabase);
    const movedWal = await moveIfPresent(`${paths.databaseFile}-wal`, previousWal);
    const movedShm = await moveIfPresent(`${paths.databaseFile}-shm`, previousShm);
    const movedObjects = await moveIfPresent(paths.objectsDir, previousObjects);
    try {
      await rename(stagedDatabase, paths.databaseFile);
      await rename(stagedObjects, paths.objectsDir);
      await rm(paths.starterStateFile, { force: true });
      await Promise.all([previousDatabase, previousWal, previousShm, previousObjects].map((target) => rm(target, { recursive: true, force: true })));
    } catch (error) {
      await rm(paths.databaseFile, { force: true });
      await rm(paths.objectsDir, { recursive: true, force: true });
      if (movedDatabase) await rename(previousDatabase, paths.databaseFile);
      if (movedWal) await rename(previousWal, `${paths.databaseFile}-wal`);
      if (movedShm) await rename(previousShm, `${paths.databaseFile}-shm`);
      if (movedObjects) await rename(previousObjects, paths.objectsDir);
      throw error;
    }
    return parsed.manifest;
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}

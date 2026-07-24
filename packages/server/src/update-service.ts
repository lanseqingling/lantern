import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, chmod, lstat, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import { AppError } from "./errors";
import { getRuntimePaths } from "./runtime-paths";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const updateEndpoint = "https://github.com/lanseqingling/lantern/releases/latest";
const releaseDownloadRoot = "https://github.com/lanseqingling/lantern/releases/download";
const checkIntervalMs = 30 * 60 * 1000;

export type UpdateStatus = {
  currentVersion: string;
  checkedAt?: string;
  state: "idle" | "checking" | "upToDate" | "available" | "unavailable";
  latestVersion?: string;
  releaseUrl?: string;
  archiveUrl?: string;
  checksumUrl?: string;
  canAutoUpdate: boolean;
};

export type UpdateInstallStatus = {
  state: "idle" | "downloading" | "verifying" | "extracting" | "stopping" | "replacing" | "restarting" | "completed" | "failed";
  version?: string;
  progress?: number;
  downloadedBytes?: number;
  totalBytes?: number;
  updatedAt?: string;
};

let status: UpdateStatus | undefined;
let inFlight: Promise<UpdateStatus> | undefined;
let preparingUpdate: Promise<{ version: string }> | undefined;

async function canAutoUpdate() {
  const rootStat = await lstat(repositoryRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return false;
  if (await access(path.join(repositoryRoot, ".git")).then(() => true).catch(() => false)) return false;
  const resolvedRoot = await realpath(repositoryRoot);
  if (resolvedRoot !== repositoryRoot) return false;
  try {
    const [manifest, version] = await Promise.all([
      readFile(path.join(repositoryRoot, ".lantern-release.json"), "utf8").then((value) => JSON.parse(value) as { distribution?: string; version?: string }),
      currentVersion(),
    ]);
    return manifest.distribution === "source-release" && manifest.version === version;
  } catch {
    return false;
  }
}

export function compareVersions(left: string, right: string) {
  const parse = (value: string) => value.replace(/^v/, "").split("-")[0].split(".").map((part) => Number(part) || 0);
  const [leftMajor, leftMinor, leftPatch] = parse(left);
  const [rightMajor, rightMinor, rightPatch] = parse(right);
  return leftMajor - rightMajor || leftMinor - rightMinor || leftPatch - rightPatch;
}

export function versionFromReleaseUrl(value: string) {
  const url = new URL(value);
  const match = /^\/lanseqingling\/lantern\/releases\/tag\/v([^/]+)$/.exec(url.pathname);
  if (url.protocol !== "https:" || url.hostname !== "github.com" || !match?.[1]) {
    throw new Error("Latest release redirect is invalid");
  }
  return decodeURIComponent(match[1]);
}

async function currentVersion() {
  const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8")) as { version: string };
  return packageJson.version;
}

async function fetchUpdate(force: boolean): Promise<UpdateStatus> {
  const current = await currentVersion();
  const autoUpdate = await canAutoUpdate();
  if (!force && status?.checkedAt && Date.now() - Date.parse(status.checkedAt) < checkIntervalMs) return status;
  status = { currentVersion: current, checkedAt: status?.checkedAt, state: "checking", canAutoUpdate: autoUpdate };
  try {
    const response = await fetch(updateEndpoint, { headers: { "User-Agent": "Lantern" }, redirect: "follow", signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`Update check failed: ${response.status}`);
    const latestVersion = versionFromReleaseUrl(response.url);
    const releaseUrl = response.url;
    const releaseAssetRoot = `${releaseDownloadRoot}/v${latestVersion}`;
    const archiveUrl = `${releaseAssetRoot}/lantern-${latestVersion}-source.zip`;
    const checksumUrl = `${releaseAssetRoot}/SHA256SUMS`;
    status = { currentVersion: current, checkedAt: new Date().toISOString(), state: compareVersions(latestVersion, current) > 0 ? "available" : "upToDate", latestVersion, releaseUrl, archiveUrl, checksumUrl, canAutoUpdate: autoUpdate };
  } catch {
    status = { currentVersion: current, checkedAt: new Date().toISOString(), state: "unavailable", canAutoUpdate: autoUpdate };
  }
  return status;
}

export function getUpdateStatus(force = false) {
  if (inFlight) return inFlight;
  inFlight = fetchUpdate(force).finally(() => { inFlight = undefined; });
  return inFlight;
}

export function checkForUpdateInBackground() {
  if (process.env.APP_ENV === "test") return;
  void getUpdateStatus(false);
}

function trustedReleaseUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "github.com") throw new AppError("invalid_update_source", "更新来源不受信任。", 422);
  return url;
}

async function writeUpdateInstallStatus(value: Omit<UpdateInstallStatus, "updatedAt">) {
  const statusFile = path.join(getRuntimePaths().dataDir, "update-status.json");
  await writeFile(statusFile, `${JSON.stringify({ ...value, updatedAt: new Date().toISOString() })}\n`, "utf8");
}

async function download(url: URL, maximumBytes: number, onProgress?: (downloadedBytes: number, totalBytes?: number) => Promise<void>) {
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(5 * 60 * 1000) });
  if (!response.ok) throw new AppError("update_download_failed", "下载更新失败。", 502);
  const declaredSize = Number(response.headers.get("content-length") || 0);
  if (declaredSize > maximumBytes) throw new AppError("update_too_large", "更新文件超过允许大小。", 502);
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maximumBytes) throw new AppError("update_too_large", "更新文件超过允许大小。", 502);
    await onProgress?.(bytes.byteLength, declaredSize || bytes.byteLength);
    return bytes;
  }
  const chunks: Uint8Array[] = [];
  const reader = response.body.getReader();
  let downloadedBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    downloadedBytes += value.byteLength;
    if (downloadedBytes > maximumBytes) {
      await reader.cancel();
      throw new AppError("update_too_large", "更新文件超过允许大小。", 502);
    }
    chunks.push(value);
    await onProgress?.(downloadedBytes, declaredSize || undefined);
  }
  const bytes = new Uint8Array(downloadedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  await onProgress?.(downloadedBytes, declaredSize || downloadedBytes);
  return bytes;
}

export function expectedChecksum(contents: Uint8Array, archiveUrl: URL) {
  const text = new TextDecoder().decode(contents);
  const filename = path.basename(archiveUrl.pathname);
  const match = text.split(/\r?\n/).map((line) => line.trim().split(/\s+/)).find((parts) => parts.at(-1) === filename);
  const checksum = match?.[0]?.toLowerCase();
  if (!checksum || !/^[a-f0-9]{64}$/.test(checksum)) throw new AppError("update_checksum_missing", "更新包缺少有效校验值。", 502);
  return checksum;
}

export function safeArchiveEntries(archive: Uint8Array, version: string) {
  const entries = unzipSync(archive);
  const archiveRoot = `lantern-${version}/`;
  const files = Object.entries(entries).flatMap(([name, bytes]) => {
    const normalized = name.replaceAll("\\", "/");
    if (!normalized.startsWith(archiveRoot) || normalized.includes("../") || normalized.startsWith("/")) {
      throw new AppError("invalid_update_archive", "更新包目录结构无效。", 502);
    }
    const relative = normalized.slice(archiveRoot.length);
    return relative && !relative.endsWith("/") ? [{ relative, bytes }] : [];
  });
  if (files.reduce((total, file) => total + file.bytes.byteLength, 0) > 1024 * 1024 * 1024) {
    throw new AppError("update_too_large", "更新包解压后超过允许大小。", 502);
  }
  if (!files.some((file) => file.relative === "package.json") || !files.some((file) => file.relative === ".lantern-release.json")) {
    throw new AppError("invalid_update_archive", "更新包缺少发行信息。", 502);
  }
  return files;
}

async function prepareUpdate() {
  const update = await getUpdateStatus(true);
  if (!update.canAutoUpdate) throw new AppError("development_install", "开发目录不能自动覆盖，请从 Release 下载更新。", 409);
  if (update.state !== "available" || !update.latestVersion || !update.archiveUrl || !update.checksumUrl) {
    throw new AppError("update_not_available", "当前没有可安装的新版本。", 409);
  }
  const archiveUrl = trustedReleaseUrl(update.archiveUrl);
  const checksumUrl = trustedReleaseUrl(update.checksumUrl);
  let lastDownloadProgress = -1;
  await writeUpdateInstallStatus({ state: "downloading", version: update.latestVersion, progress: 0 });
  const [archive, checksums] = await Promise.all([
    download(archiveUrl, 500 * 1024 * 1024, async (downloadedBytes, totalBytes) => {
      const progress = totalBytes ? Math.min(75, Math.floor(downloadedBytes / totalBytes * 75)) : 0;
      if (progress === lastDownloadProgress) return;
      lastDownloadProgress = progress;
      await writeUpdateInstallStatus({ state: "downloading", version: update.latestVersion, progress, downloadedBytes, totalBytes });
    }),
    download(checksumUrl, 1024 * 1024),
  ]);
  await writeUpdateInstallStatus({ state: "verifying", version: update.latestVersion, progress: 78 });
  const actual = createHash("sha256").update(archive).digest("hex");
  if (actual !== expectedChecksum(checksums, archiveUrl)) throw new AppError("update_checksum_mismatch", "更新包校验失败。", 502);

  const parent = path.dirname(repositoryRoot);
  const token = randomUUID();
  const stagedRoot = path.join(parent, `.lantern-update-${update.latestVersion}-${token}`);
  const backupRoot = path.join(parent, `.lantern-previous-${token}`);
  await mkdir(stagedRoot, { recursive: false });
  try {
    await writeUpdateInstallStatus({ state: "extracting", version: update.latestVersion, progress: 82 });
    const files = safeArchiveEntries(archive, update.latestVersion);
    let lastExtractProgress = 82;
    for (const [index, file] of files.entries()) {
      const target = path.join(stagedRoot, file.relative);
      if (!target.startsWith(`${stagedRoot}${path.sep}`)) throw new AppError("invalid_update_archive", "更新包路径无效。", 502);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, file.bytes);
      const progress = Math.floor(82 + (index + 1) / files.length * 8);
      if (progress !== lastExtractProgress) {
        lastExtractProgress = progress;
        await writeUpdateInstallStatus({ state: "extracting", version: update.latestVersion, progress });
      }
    }
    const stagedPackage = JSON.parse(await readFile(path.join(stagedRoot, "package.json"), "utf8")) as { version?: string };
    const stagedManifest = JSON.parse(await readFile(path.join(stagedRoot, ".lantern-release.json"), "utf8")) as { distribution?: string; version?: string };
    if (stagedPackage.version !== update.latestVersion || stagedManifest.distribution !== "source-release" || stagedManifest.version !== update.latestVersion) {
      throw new AppError("update_version_mismatch", "更新包版本不匹配。", 502);
    }
    if (process.platform !== "win32") await chmod(path.join(stagedRoot, "lantern"), 0o755);

    const paths = getRuntimePaths();
    const workerSource = await readFile(path.join(repositoryRoot, "scripts", "update-worker.mjs"));
    const workerFile = path.join(paths.tempDir, `update-worker-${token}.mjs`);
    await writeFile(workerFile, workerSource, { mode: 0o700 });
    await writeUpdateInstallStatus({ state: "stopping", version: update.latestVersion, progress: 92 });
    const child = spawn(process.execPath, [workerFile, repositoryRoot, stagedRoot, backupRoot, paths.dataDir, update.latestVersion], {
      cwd: parent,
      env: process.env,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    await once(child, "spawn");
    child.unref();
    return { version: update.latestVersion };
  } catch (error) {
    await rm(stagedRoot, { recursive: true, force: true });
    await writeUpdateInstallStatus({ state: "failed", version: update.latestVersion }).catch(() => undefined);
    throw error;
  }
}

export function installAvailableUpdate() {
  if (preparingUpdate) return preparingUpdate;
  preparingUpdate = prepareUpdate()
    .catch(async (error) => {
      await writeUpdateInstallStatus({ state: "failed", version: status?.latestVersion }).catch(() => undefined);
      throw error;
    })
    .finally(() => { preparingUpdate = undefined; });
  return preparingUpdate;
}

export async function getUpdateInstallStatus(): Promise<UpdateInstallStatus> {
  try {
    const value = JSON.parse(await readFile(path.join(getRuntimePaths().dataDir, "update-status.json"), "utf8")) as UpdateInstallStatus;
    if (!["downloading", "verifying", "extracting", "stopping", "replacing", "restarting", "completed", "failed"].includes(value.state)) return { state: "idle" };
    return {
      ...value,
      progress: typeof value.progress === "number" ? Math.max(0, Math.min(100, Math.round(value.progress))) : undefined,
    };
  } catch {
    return { state: "idle" };
  }
}

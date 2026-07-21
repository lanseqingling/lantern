import { randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { getRuntimePaths, type LanternRuntimePaths } from "./runtime-paths";

export const LOCAL_USER_ID = "user-local-creator";
export const LOCAL_USER_EMAIL = "creator@lantern.local";
export const LOCAL_USER_DISPLAY_NAME = "Lantern Creator";

const defaultRuntimeConfig = {
  apiPort: 18787,
  webPort: 3000,
  logLevel: "info",
} as const;

const providerDefaults = [
  "TEXT_MODEL_PROVIDER=deepseek",
  "TEXT_MODEL_BASE_URL=https://api.deepseek.com",
  "TEXT_MODEL_NAME=deepseek-v4-flash",
  "TEXT_MODEL_API_KEY=",
  "",
  "IMAGE_MODEL_PROVIDER=qwen",
  "IMAGE_MODEL_BASE_URL=https://dashscope.aliyuncs.com/api/v1",
  "IMAGE_MODEL_NAME=qwen-image-2.0",
  "IMAGE_MODEL_API_KEY=",
  "",
  "VISION_MODEL_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1",
  "VISION_MODEL_NAME=qwen3.6-flash",
  "VISION_MODEL_API_KEY=",
] as const;

async function writeRestricted(filePath: string, contents: string) {
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, contents, { encoding: "utf8", mode: 0o600 });
  await chmod(temporary, 0o600).catch(() => undefined);
  await rename(temporary, filePath);
  await chmod(filePath, 0o600).catch(() => undefined);
}

export async function ensureRuntimeLayout(paths = getRuntimePaths()) {
  await Promise.all([
    paths.dataDir,
    paths.assetsDir,
    paths.candidatesDir,
    paths.exportsDir,
    paths.configDir,
    paths.logsDir,
    paths.tempDir,
    paths.backupsDir,
  ].map((directory) => mkdir(directory, { recursive: true })));

  await open(paths.databaseFile, "a", 0o600).then((handle) => handle.close());
  await chmod(paths.databaseFile, 0o600).catch(() => undefined);

  await open(paths.runtimeConfigFile, "wx", 0o600)
    .then(async (handle) => {
      await handle.writeFile(`${JSON.stringify(defaultRuntimeConfig, null, 2)}\n`);
      await handle.close();
    })
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });

  let providerText = "";
  let providerExists = true;
  try {
    providerText = await readFile(paths.providerConfigFile, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    providerExists = false;
  }
  let providerChanged = !providerExists;
  if (!providerText) {
    providerText = `${providerDefaults.join("\n")}\n`;
    providerChanged = true;
  }
  if (!/^LANTERN_LOCAL_TOKEN=/m.test(providerText)) {
    providerText = `LANTERN_LOCAL_TOKEN=${randomBytes(32).toString("base64url")}\n${providerText}`;
    providerChanged = true;
  }
  if (providerChanged) await writeRestricted(paths.providerConfigFile, providerText);
  else await chmod(paths.providerConfigFile, 0o600).catch(() => undefined);
  return paths;
}

export async function resetRuntimeTemp(paths = getRuntimePaths()) {
  await rm(paths.tempDir, { recursive: true, force: true });
  await mkdir(paths.tempDir, { recursive: true });
}

function processExists(pid: number) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export type RuntimeLock = {
  paths: LanternRuntimePaths;
  owner: RuntimeOwner;
  release(): Promise<void>;
};

export type RuntimeOwner = {
  pid: number;
  instanceId?: string;
  startedAt?: string;
};

type RuntimeStopRequest = {
  instanceId: string;
  requestedAt: string;
};

async function readRuntimeOwner(paths: LanternRuntimePaths) {
  return readFile(paths.lockFile, "utf8")
    .then((value) => JSON.parse(value) as RuntimeOwner)
    .catch(() => undefined);
}

export async function acquireRuntimeLock(paths = getRuntimePaths()): Promise<RuntimeLock> {
  await mkdir(paths.dataDir, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(paths.lockFile, "wx", 0o600);
      const owner: RuntimeOwner = {
        pid: process.pid,
        instanceId: randomUUID(),
        startedAt: new Date().toISOString(),
      };
      await handle.writeFile(`${JSON.stringify(owner)}\n`);
      await handle.close();
      return {
        paths,
        owner,
        async release() {
          const current = await readRuntimeOwner(paths);
          if (current?.pid === owner.pid && current.instanceId === owner.instanceId) {
            await Promise.all([
              unlink(paths.lockFile).catch(() => undefined),
              unlink(paths.stopRequestFile).catch(() => undefined),
            ]);
          }
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const owner = await readRuntimeOwner(paths);
      if (owner?.pid && processExists(owner.pid)) throw new Error(`LANTERN_ALREADY_RUNNING:${owner.pid}`);
      await unlink(paths.lockFile).catch(() => undefined);
    }
  }
  throw new Error("LANTERN_LOCK_UNAVAILABLE");
}

export async function runtimeOwner(paths = getRuntimePaths()) {
  const owner = await readRuntimeOwner(paths);
  return owner?.pid && processExists(owner.pid) ? owner : undefined;
}

export async function requestRuntimeStop(paths = getRuntimePaths()) {
  const owner = await runtimeOwner(paths);
  if (!owner?.instanceId) return owner;
  const request: RuntimeStopRequest = {
    instanceId: owner.instanceId,
    requestedAt: new Date().toISOString(),
  };
  await writeRestricted(paths.stopRequestFile, `${JSON.stringify(request)}\n`);
  return owner;
}

export async function consumeRuntimeStopRequest(owner: RuntimeOwner, paths = getRuntimePaths()) {
  let request: RuntimeStopRequest | undefined;
  try {
    request = JSON.parse(await readFile(paths.stopRequestFile, "utf8")) as RuntimeStopRequest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    await unlink(paths.stopRequestFile).catch(() => undefined);
    return false;
  }
  await unlink(paths.stopRequestFile).catch(() => undefined);
  return Boolean(owner.instanceId && request.instanceId === owner.instanceId);
}

export function runtimeRelativePath(paths: LanternRuntimePaths, filePath: string) {
  return path.relative(paths.dataDir, filePath);
}

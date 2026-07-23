import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { unzipSync, zipSync } from "fflate";
import {
  acquireRuntimeLock,
  consumeRuntimeStopRequest,
  ensureRuntimeLayout,
  releaseRuntimeOwner,
  requestRuntimeStop,
  runtimeOwner,
} from "@lantern/server/local-runtime";
import { createRuntimeBackup, restoreRuntimeBackup } from "@lantern/server/runtime-backup";
import { defaultLanternDataDir, getRuntimePaths } from "@lantern/server/runtime-paths";
import { getConfig, resetConfigForTests } from "@lantern/server/config";
import { getGlobalSettings, updateGlobalSettings } from "@lantern/server/settings-service";
import { initializeInitialData } from "../scripts/starter-data";

test("platform data directories never default to the repository", () => {
  assert.equal(defaultLanternDataDir("darwin", "/Users/creator", {}), "/Users/creator/Library/Application Support/Lantern");
  assert.equal(defaultLanternDataDir("linux", "/home/creator", {}), "/home/creator/.local/share/Lantern");
  assert.equal(defaultLanternDataDir("linux", "/home/creator", { XDG_DATA_HOME: "/data" }), "/data/Lantern");
  assert.equal(defaultLanternDataDir("win32", "C:\\Users\\creator", { APPDATA: "C:\\Users\\creator\\AppData\\Roaming" }), path.join("C:\\Users\\creator\\AppData\\Roaming", "Lantern"));
});

test("runtime initialization creates one data tree and a restricted installation token", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "lantern-runtime-layout-"));
  const paths = getRuntimePaths(dataDir);
  try {
    await ensureRuntimeLayout(paths);
    const providerConfig = await readFile(paths.providerConfigFile, "utf8");
    const mcpConfig = await readFile(paths.mcpConfigFile, "utf8");
    assert.match(providerConfig, /^LANTERN_LOCAL_TOKEN=[A-Za-z0-9_-]{40,}/m);
    assert.match(mcpConfig, /^LANTERN_MCP_TOKEN=[A-Za-z0-9_-]{40,}/m);
    const runtimeConfig = JSON.parse(await readFile(paths.runtimeConfigFile, "utf8"));
    assert.equal(runtimeConfig.configVersion, 1);
    assert.equal(runtimeConfig.apiPort, 18787);
    assert.equal(runtimeConfig.webPort, 18788);
    assert.equal((await stat(paths.databaseFile)).isFile(), true);
    if (process.platform !== "win32") assert.equal((await stat(paths.providerConfigFile)).mode & 0o777, 0o600);
    if (process.platform !== "win32") assert.equal((await stat(paths.mcpConfigFile)).mode & 0o777, 0o600);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("runtime initialization migrates only the generated legacy web port", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "lantern-runtime-port-"));
  const paths = getRuntimePaths(dataDir);
  try {
    await ensureRuntimeLayout(paths);
    await writeFile(paths.runtimeConfigFile, `${JSON.stringify({ apiPort: 18787, webPort: 3000, logLevel: "info" })}\n`);
    await ensureRuntimeLayout(paths);
    assert.deepEqual(JSON.parse(await readFile(paths.runtimeConfigFile, "utf8")), {
      apiPort: 18787,
      webPort: 18788,
      logLevel: "info",
      configVersion: 1,
    });

    await writeFile(paths.runtimeConfigFile, `${JSON.stringify({ apiPort: 18787, webPort: 3100, logLevel: "info" })}\n`);
    await ensureRuntimeLayout(paths);
    assert.deepEqual(JSON.parse(await readFile(paths.runtimeConfigFile, "utf8")), {
      apiPort: 18787,
      webPort: 3100,
      logLevel: "info",
      configVersion: 1,
    });
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("runtime initialization preserves existing provider configuration", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "lantern-runtime-provider-"));
  const paths = getRuntimePaths(dataDir);
  try {
    await ensureRuntimeLayout(paths);
    const original = await readFile(paths.providerConfigFile, "utf8");
    const configured = `${original}TEXT_MODEL_API_KEY=creator-key\n`;
    await writeFile(paths.providerConfigFile, configured);
    await ensureRuntimeLayout(paths);
    assert.equal(await readFile(paths.providerConfigFile, "utf8"), configured);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("runtime initialization imports a legacy model environment only once", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "lantern-runtime-legacy-provider-"));
  const paths = getRuntimePaths(dataDir);
  const previousKey = process.env.TEXT_MODEL_API_KEY;
  try {
    process.env.TEXT_MODEL_API_KEY = "legacy-key";
    await ensureRuntimeLayout(paths);
    assert.match(await readFile(paths.providerConfigFile, "utf8"), /TEXT_MODEL_API_KEY=\"legacy-key\"/);
    await writeFile(paths.providerConfigFile, (await readFile(paths.providerConfigFile, "utf8")).replace("legacy-key", "settings-key"));
    process.env.TEXT_MODEL_API_KEY = "different-legacy-key";
    await ensureRuntimeLayout(paths);
    const preserved = await readFile(paths.providerConfigFile, "utf8");
    assert.match(preserved, /TEXT_MODEL_API_KEY=\"settings-key\"/);
    assert.doesNotMatch(preserved, /different-legacy-key/);
  } finally {
    if (previousKey === undefined) delete process.env.TEXT_MODEL_API_KEY;
    else process.env.TEXT_MODEL_API_KEY = previousKey;
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("global settings update model configuration without exposing stored keys", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "lantern-runtime-settings-"));
  const paths = getRuntimePaths(dataDir);
  const previousDataDir = process.env.LANTERN_DATA_DIR;
  const modelEnvironmentKeys = [
    "TEXT_MODEL_PROVIDER",
    "TEXT_MODEL_BASE_URL",
    "TEXT_MODEL_NAME",
    "TEXT_MODEL_API_KEY",
    "IMAGE_MODEL_PROVIDER",
    "IMAGE_MODEL_BASE_URL",
    "IMAGE_MODEL_NAME",
    "IMAGE_MODEL_API_KEY",
    "VISION_MODEL_PROVIDER",
    "VISION_MODEL_BASE_URL",
    "VISION_MODEL_NAME",
    "VISION_MODEL_API_KEY",
  ] as const;
  const previousModelEnvironment = new Map(modelEnvironmentKeys.map((key) => [key, process.env[key]]));
  try {
    process.env.LANTERN_DATA_DIR = dataDir;
    modelEnvironmentKeys.forEach((key) => delete process.env[key]);
    await ensureRuntimeLayout(paths);
    resetConfigForTests();
    const before = getGlobalSettings();
    const text = before.models.find((model) => model.capability === "text");
    assert.ok(text);
    assert.equal(text.providerOptions[0]?.id, "deepseek");
    assert.equal(text.keyConfigured, false);

    const updated = await updateGlobalSettings({
      models: [{
        capability: "text",
        providerId: text.providerOptions[0].id,
        baseUrl: "https://models.example.test/v1",
        model: "creator-chat",
        apiKey: "private-settings-key",
      }],
    });
    const stored = await readFile(paths.providerConfigFile, "utf8");
    assert.match(stored, /LANTERN_LOCAL_TOKEN=/);
    assert.match(stored, /TEXT_MODEL_BASE_URL=\"https:\/\/models\.example\.test\/v1\"/);
    assert.match(stored, /TEXT_MODEL_API_KEY=\"private-settings-key\"/);
    assert.equal(updated.models.find((model) => model.capability === "text")?.keyConfigured, true);
    assert.equal(JSON.stringify(updated).includes("private-settings-key"), false);
    assert.equal(getConfig().TEXT_MODEL_NAME, "creator-chat");
    if (process.platform !== "win32") assert.equal((await stat(paths.providerConfigFile)).mode & 0o777, 0o600);
  } finally {
    if (previousDataDir === undefined) delete process.env.LANTERN_DATA_DIR;
    else process.env.LANTERN_DATA_DIR = previousDataDir;
    for (const [key, value] of previousModelEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetConfigForTests();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("invalid runtime configuration fails with its file path", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "lantern-runtime-config-"));
  const paths = getRuntimePaths(dataDir);
  const previousDataDir = process.env.LANTERN_DATA_DIR;
  try {
    process.env.LANTERN_DATA_DIR = dataDir;
    await ensureRuntimeLayout(paths);
    await writeFile(paths.runtimeConfigFile, "{not-json}\n");
    resetConfigForTests();
    assert.throws(() => getConfig(), new RegExp(`Invalid Lantern runtime configuration at ${dataDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  } finally {
    if (previousDataDir === undefined) delete process.env.LANTERN_DATA_DIR;
    else process.env.LANTERN_DATA_DIR = previousDataDir;
    resetConfigForTests();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("initial data creation resumes the single built-in comic after interruption", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "lantern-runtime-starter-"));
  const paths = getRuntimePaths(dataDir);
  let seedCalls = 0;
  let shouldFail = true;
  const seed = async () => {
    seedCalls += 1;
    if (shouldFail) throw new Error("simulated initial data interruption");
  };
  try {
    await ensureRuntimeLayout(paths);
    await assert.rejects(() => initializeInitialData(paths, {
      comicCount: async () => 0,
      seed,
    }), /simulated initial data interruption/);
    assert.equal(seedCalls, 1);

    shouldFail = false;
    assert.equal(await initializeInitialData(paths, {
      comicCount: async () => 0,
      seed,
    }), "resumed");
    assert.equal(seedCalls, 2);
    assert.equal(JSON.parse(await readFile(paths.starterStateFile, "utf8")).status, "complete");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("initial data never adds the built-in comic to an existing library", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "lantern-runtime-existing-data-"));
  const paths = getRuntimePaths(dataDir);
  let seedCalls = 0;
  try {
    await ensureRuntimeLayout(paths);
    assert.equal(await initializeInitialData(paths, {
      comicCount: async () => 1,
      seed: async () => { seedCalls += 1; },
    }), "skipped");
    assert.equal(await initializeInitialData(paths, {
      comicCount: async () => 0,
      seed: async () => { seedCalls += 1; },
    }), "complete");
    assert.equal(seedCalls, 0);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("the runtime lock rejects a second local service and can be released", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "lantern-runtime-lock-"));
  const paths = getRuntimePaths(dataDir);
  const lock = await acquireRuntimeLock(paths);
  try {
    await assert.rejects(() => acquireRuntimeLock(paths), /LANTERN_ALREADY_RUNNING/);
    await lock.updateServices({ apiPid: process.pid + 1, webPid: process.pid + 2 }, { api: 18787, web: 18788 });
    assert.deepEqual(JSON.parse(await readFile(paths.lockFile, "utf8")).services, {
      apiPid: process.pid + 1,
      webPid: process.pid + 2,
    });
  } finally {
    await lock.release();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("runtime stop requests only target the active runtime instance", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "lantern-runtime-stop-"));
  const paths = getRuntimePaths(dataDir);
  const lock = await acquireRuntimeLock(paths);
  try {
    assert.ok(lock.owner.instanceId);
    assert.deepEqual(await requestRuntimeStop(paths), lock.owner);
    assert.equal(await consumeRuntimeStopRequest({ ...lock.owner, instanceId: "another-instance" }, paths), false);

    await requestRuntimeStop(paths);
    assert.equal(await consumeRuntimeStopRequest(lock.owner, paths), true);
    assert.equal(await consumeRuntimeStopRequest(lock.owner, paths), false);
  } finally {
    await lock.release();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("runtime ownership keeps orphaned services discoverable after the supervisor exits", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "lantern-runtime-orphan-"));
  const paths = getRuntimePaths(dataDir);
  const owner = {
    pid: 2_147_483_647,
    instanceId: "orphaned-runtime",
    services: { webPid: process.pid },
    ports: { api: 18787, web: 18788 },
  };
  try {
    await ensureRuntimeLayout(paths);
    await writeFile(paths.lockFile, `${JSON.stringify(owner)}\n`);
    assert.deepEqual(await runtimeOwner(paths), owner);
    await assert.rejects(() => acquireRuntimeLock(paths), /LANTERN_ALREADY_RUNNING/);
    assert.equal(await releaseRuntimeOwner(owner, paths), true);
    assert.equal(await runtimeOwner(paths), undefined);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("runtime backup restores a consistent database and object snapshot without replacing provider keys", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "lantern-runtime-backup-"));
  const paths = getRuntimePaths(dataDir);
  const objectFile = path.join(paths.assetsDir, "probe.png");
  const databaseUrl = `file:${paths.databaseFile.replaceAll("\\", "/")}`;
  try {
    await ensureRuntimeLayout(paths);
    const client = new PrismaClient({ datasourceUrl: databaseUrl });
    await client.$executeRawUnsafe("CREATE TABLE backup_probe (value TEXT NOT NULL)");
    await client.$executeRawUnsafe("INSERT INTO backup_probe (value) VALUES ('original')");
    await client.$disconnect();
    await writeFile(objectFile, "original-object");
    await writeFile(paths.providerConfigFile, "LANTERN_LOCAL_TOKEN=preserved\nTEXT_MODEL_API_KEY=private-key\n");
    await writeFile(paths.starterStateFile, "stale-starter-state\n");

    const backup = await createRuntimeBackup(paths, { lanternVersion: "0.1.0" });
    const changedClient = new PrismaClient({ datasourceUrl: databaseUrl });
    await changedClient.$executeRawUnsafe("UPDATE backup_probe SET value = 'changed'");
    await changedClient.$disconnect();
    await writeFile(objectFile, "changed-object");

    const manifest = await restoreRuntimeBackup(paths, backup.outputFile);
    assert.equal(manifest.protocol, "lantern-backup-1");
    const restoredClient = new PrismaClient({ datasourceUrl: databaseUrl });
    const rows = await restoredClient.$queryRawUnsafe<Array<{ value: string }>>("SELECT value FROM backup_probe");
    await restoredClient.$disconnect();
    assert.deepEqual(rows, [{ value: "original" }]);
    assert.equal(await readFile(objectFile, "utf8"), "original-object");
    assert.match(await readFile(paths.providerConfigFile, "utf8"), /TEXT_MODEL_API_KEY=private-key/);
    await assert.rejects(() => readFile(paths.starterStateFile), { code: "ENOENT" });
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("runtime restore rejects a backup whose declared object bytes were modified", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "lantern-runtime-backup-tamper-"));
  const paths = getRuntimePaths(dataDir);
  const databaseUrl = `file:${paths.databaseFile.replaceAll("\\", "/")}`;
  try {
    await ensureRuntimeLayout(paths);
    const client = new PrismaClient({ datasourceUrl: databaseUrl });
    await client.$executeRawUnsafe("CREATE TABLE backup_probe (value TEXT NOT NULL)");
    await client.$disconnect();
    await writeFile(path.join(paths.assetsDir, "probe.png"), "original-object");
    const backup = await createRuntimeBackup(paths, { lanternVersion: "0.1.0" });
    const entries = unzipSync(new Uint8Array(await readFile(backup.outputFile)));
    const objectEntry = entries["lantern-backup/objects/assets/probe.png"];
    assert.ok(objectEntry);
    objectEntry[0] = objectEntry[0] ^ 0xff;
    const corruptedBackup = path.join(paths.backupsDir, "corrupted.zip");
    await writeFile(corruptedBackup, zipSync(entries));
    await assert.rejects(() => restoreRuntimeBackup(paths, corruptedBackup), /BACKUP_CHECKSUM_MISMATCH/);
    assert.equal(await readFile(path.join(paths.assetsDir, "probe.png"), "utf8"), "original-object");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

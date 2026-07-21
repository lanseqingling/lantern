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
  requestRuntimeStop,
} from "../packages/server/src/local-runtime";
import { createRuntimeBackup, restoreRuntimeBackup } from "../packages/server/src/runtime-backup";
import { defaultLanternDataDir, getRuntimePaths } from "../packages/server/src/runtime-paths";
import { getConfig, resetConfigForTests } from "../packages/server/src/config";
import { initializeStarterData } from "../scripts/starter-data";

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
    assert.match(providerConfig, /^LANTERN_LOCAL_TOKEN=[A-Za-z0-9_-]{40,}/m);
    assert.equal(JSON.parse(await readFile(paths.runtimeConfigFile, "utf8")).apiPort, 18787);
    assert.equal((await stat(paths.databaseFile)).isFile(), true);
    if (process.platform !== "win32") assert.equal((await stat(paths.providerConfigFile)).mode & 0o777, 0o600);
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

test("starter initialization resumes from the last completed sample", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "lantern-runtime-starter-"));
  const paths = getRuntimePaths(dataDir);
  let rainyCalls = 0;
  let campusCalls = 0;
  let campusShouldFail = true;
  const samples = [
    { key: "rainy-station" as const, seed: async () => { rainyCalls += 1; } },
    { key: "campus-letter" as const, seed: async () => {
      campusCalls += 1;
      if (campusShouldFail) throw new Error("simulated starter interruption");
    } },
  ];
  try {
    await ensureRuntimeLayout(paths);
    await assert.rejects(() => initializeStarterData(paths, {
      databaseCounts: async () => ({ users: 0, comics: 0 }),
      samples,
    }), /simulated starter interruption/);
    assert.equal(rainyCalls, 1);
    assert.equal(campusCalls, 1);

    campusShouldFail = false;
    assert.equal(await initializeStarterData(paths, {
      databaseCounts: async () => ({ users: 1, comics: 1 }),
      samples,
    }), "resumed");
    assert.equal(rainyCalls, 1);
    assert.equal(campusCalls, 2);
    assert.equal(JSON.parse(await readFile(paths.starterStateFile, "utf8")).status, "complete");
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

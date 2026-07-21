import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { acquireRuntimeLock, ensureRuntimeLayout } from "../packages/server/src/local-runtime";
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

import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import { access, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { getConfig, resetConfigForTests } from "../packages/server/src/config";
import { acquireRuntimeLock, ensureRuntimeLayout, resetRuntimeTemp, runtimeOwner } from "../packages/server/src/local-runtime";
import { getRuntimePaths } from "../packages/server/src/runtime-paths";
import { initializeRuntime, repositoryRoot, runCommand, runPrismaCommand } from "./runtime-init";

type Command = "start" | "dev" | "stop" | "status" | "doctor" | "sample:init" | "backup:create" | "backup:restore";
const command = (process.argv[2] ?? "start") as Command;
const commandArgs = process.argv.slice(3);
const supportedCommands: Command[] = ["start", "dev", "stop", "status", "doctor", "sample:init", "backup:create", "backup:restore"];

function pnpmCli() {
  const inherited = process.env.npm_execpath;
  if (inherited && /pnpm(?:\.cjs)?$/i.test(inherited)) return inherited;
  return path.join(repositoryRoot, "node_modules", "pnpm", "bin", "pnpm.cjs");
}

function spawnService(args: string[], env: Record<string, string | undefined>, logFile: string) {
  const child = spawn(process.execPath, [pnpmCli(), ...args], {
    cwd: repositoryRoot,
    env: { ...process.env, ...env },
    stdio: ["inherit", "pipe", "pipe"],
    windowsHide: true,
  });
  const log = createWriteStream(logFile, { flags: "a", mode: 0o600 });
  child.stdout?.pipe(process.stdout);
  child.stderr?.pipe(process.stderr);
  child.stdout?.pipe(log, { end: false });
  child.stderr?.pipe(log, { end: false });
  child.once("close", () => log.end());
  return child;
}

async function waitForUrl(url: string, attempts = 120) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {}
    await delay(500);
  }
  throw new Error(`SERVICE_HEALTH_TIMEOUT:${url}`);
}

async function assertPortAvailable(host: string, port: number, label: string) {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", (error) => reject(new Error(`${label} port ${port} is already in use on ${host}.`, { cause: error })));
    server.listen({ host, port, exclusive: true }, () => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });
}

function openBrowser(url: string) {
  const child = process.platform === "darwin"
    ? spawn("open", [url], { detached: true, stdio: "ignore" })
    : process.platform === "win32"
      ? spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true })
      : spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
  child.on("error", () => undefined);
  child.unref();
}

async function stopChildren(children: ChildProcess[]) {
  for (const child of children) if (child.exitCode === null && child.pid) child.kill("SIGTERM");
  await Promise.all(children.map((child) => child.exitCode !== null
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
        resolve();
      }, 5000).unref();
    })));
}

async function runServices(mode: "start" | "dev") {
  const paths = await ensureRuntimeLayout(getRuntimePaths());
  const lock = await acquireRuntimeLock(paths);
  await resetRuntimeTemp(paths);
  const children: ChildProcess[] = [];
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    await stopChildren(children);
    await lock.release();
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());

  try {
    await initializeRuntime();
    resetConfigForTests();
    const config = getConfig();
    if (mode === "start") {
      const productionEntry = path.join(repositoryRoot, "dist", "server", "index.js");
      if (!await access(productionEntry).then(() => true).catch(() => false)) await runCommand(["build"]);
    }

    await assertPortAvailable("127.0.0.1", config.API_PORT, "Lantern API");
    await assertPortAvailable("localhost", config.WEB_PORT, "Lantern Web");

    const sharedEnv = {
      LANTERN_DATA_DIR: paths.dataDir,
      DATABASE_URL: paths.databaseUrl,
      APP_ENV: mode === "start" ? "production" : "local",
      PORT: String(config.WEB_PORT),
      LANTERN_API_INTERNAL_URL: `http://127.0.0.1:${config.API_PORT}`,
    };
    const apiArgs = mode === "dev"
      ? ["exec", "tsx", "watch", "apps/api/src/index.ts"]
      : ["exec", "tsx", "apps/api/src/index.ts"];
    const webArgs = mode === "dev"
      ? ["exec", "vinext", "dev", "--host", "localhost", "--port", String(config.WEB_PORT), "--strictPort"]
      : ["exec", "vinext", "start", "--hostname", "localhost", "--port", String(config.WEB_PORT)];
    children.push(
      spawnService(apiArgs, sharedEnv, path.join(paths.logsDir, "api.log")),
      spawnService(webArgs, sharedEnv, path.join(paths.logsDir, "web.log")),
    );
    const exitPromise = Promise.race(children.map((child) => new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => resolve(code ?? 1));
    })));

    await Promise.race([
      Promise.all([
        waitForUrl(`http://127.0.0.1:${config.API_PORT}/health`),
        waitForUrl(`http://localhost:${config.WEB_PORT}`),
      ]),
      exitPromise.then((code) => { throw new Error(`LANTERN_SERVICE_EXITED_BEFORE_READY:${code}`); }),
    ]);
    const webUrl = `http://localhost:${config.WEB_PORT}`;
    console.log(`Lantern is ready: ${webUrl}`);
    if (process.env.LANTERN_NO_OPEN !== "1") openBrowser(webUrl);
    const exitCode = await exitPromise;
    if (!stopping) process.exitCode = exitCode;
  } finally {
    await shutdown();
  }
}

async function showStatus() {
  const owner = await runtimeOwner();
  if (!owner) {
    console.log("Lantern is stopped.");
    return;
  }
  console.log(`Lantern is running (pid ${owner.pid}, since ${owner.startedAt ?? "unknown"}).`);
}

async function stopRuntime() {
  const owner = await runtimeOwner();
  if (!owner?.pid) {
    console.log("Lantern is already stopped.");
    return;
  }
  process.kill(owner.pid, "SIGTERM");
  console.log(`Stopping Lantern (pid ${owner.pid}).`);
}

async function doctor() {
  const paths = await ensureRuntimeLayout(getRuntimePaths());
  const issues: string[] = [];
  const [major, minor] = process.versions.node.split(".").map(Number);
  const nodeSupported = major > 22 || (major === 22 && minor >= 13);
  if (!nodeSupported) issues.push(`Node.js 22.13 or newer is required; found ${process.versions.node}.`);

  let dataWritable = false;
  const writeProbe = path.join(paths.tempDir, `.doctor-${process.pid}`);
  try {
    await Promise.all([paths.dataDir, paths.configDir, paths.objectsDir, paths.tempDir].map((directory) => access(directory)));
    await writeFile(writeProbe, "ok", { mode: 0o600 });
    await rm(writeProbe, { force: true });
    dataWritable = true;
  } catch (error) {
    issues.push(`Lantern data directory is not writable: ${error instanceof Error ? error.message : error}`);
  }

  let providerPermissions: string | undefined;
  if (process.platform !== "win32") {
    providerPermissions = ((await stat(paths.providerConfigFile)).mode & 0o777).toString(8).padStart(3, "0");
    if (providerPermissions !== "600") issues.push(`Provider configuration permissions should be 600; found ${providerPermissions}.`);
  }

  let runtimeJson: unknown;
  let config: ReturnType<typeof getConfig> | undefined;
  try {
    runtimeJson = JSON.parse(await readFile(paths.runtimeConfigFile, "utf8")) as unknown;
    resetConfigForTests();
    config = getConfig();
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }

  let databaseIntegrity = "unavailable";
  let checkedObjects = 0;
  let missingObjects = 0;
  let damagedObjects = 0;
  const { initializeDatabaseConnection, prisma } = await import("../packages/server/src/db");
  try {
    await initializeDatabaseConnection();
    const integrity = await prisma.$queryRawUnsafe<Array<{ integrity_check: string }>>("PRAGMA integrity_check");
    databaseIntegrity = integrity.length === 1 && integrity[0]?.integrity_check === "ok" ? "ok" : "failed";
    if (databaseIntegrity !== "ok") issues.push("SQLite integrity check failed.");
    const versions = await prisma.assetVersion.findMany({
      where: { objectKey: { not: null } },
      select: { objectKey: true, byteSize: true, checksum: true },
    });
    for (const version of versions) {
      if (!version.objectKey) continue;
      checkedObjects += 1;
      const objectFile = path.resolve(paths.objectsDir, version.objectKey);
      if (!objectFile.startsWith(`${path.resolve(paths.objectsDir)}${path.sep}`)) {
        damagedObjects += 1;
        continue;
      }
      try {
        const bytes = await readFile(objectFile);
        const objectChecksum = createHash("sha256").update(bytes).digest("hex");
        if ((version.byteSize !== null && version.byteSize !== bytes.byteLength) || (version.checksum && version.checksum !== objectChecksum)) damagedObjects += 1;
      } catch {
        missingObjects += 1;
      }
    }
    if (missingObjects) issues.push(`${missingObjects} referenced object file(s) are missing.`);
    if (damagedObjects) issues.push(`${damagedObjects} referenced object file(s) failed validation.`);
  } catch (error) {
    issues.push(`Unable to inspect Lantern database: ${error instanceof Error ? error.message : error}`);
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }

  const owner = await runtimeOwner(paths);
  let serviceHealth: "running" | "stopped" | "unhealthy" = owner ? "running" : "stopped";
  if (owner && config) {
    try {
      await Promise.all([
        waitForUrl(`http://127.0.0.1:${config.API_PORT}/health`, 2),
        waitForUrl(`http://localhost:${config.WEB_PORT}`, 2),
      ]);
    } catch {
      serviceHealth = "unhealthy";
      issues.push("Lantern has a runtime lock but one or more services are unhealthy.");
    }
  }

  console.log(JSON.stringify({
    status: issues.length ? "attention" : "ok",
    node: { version: process.versions.node, supported: nodeSupported },
    data: { directory: paths.dataDir, writable: dataWritable, providerConfigPermissions: providerPermissions },
    runtimeConfig: runtimeJson,
    database: { integrity: databaseIntegrity },
    objects: { checked: checkedObjects, missing: missingObjects, damaged: damagedObjects },
    providers: config ? {
      text: { provider: config.TEXT_MODEL_PROVIDER, configured: Boolean(config.TEXT_MODEL_API_KEY) },
      image: { provider: config.IMAGE_MODEL_PROVIDER, configured: Boolean(config.IMAGE_MODEL_API_KEY) },
      vision: { configured: Boolean(config.VISION_MODEL_API_KEY ?? config.IMAGE_MODEL_API_KEY) },
    } : "unavailable",
    service: { status: serviceHealth, pid: owner?.pid },
    issues,
  }, null, 2));
  if (issues.length) process.exitCode = 1;
}

async function withExclusiveRuntime<T>(operation: (paths: ReturnType<typeof getRuntimePaths>) => Promise<T>) {
  const paths = await ensureRuntimeLayout(getRuntimePaths());
  const lock = await acquireRuntimeLock(paths);
  try {
    await resetRuntimeTemp(paths);
    return await operation(paths);
  } finally {
    await lock.release();
  }
}

async function createBackup() {
  await withExclusiveRuntime(async (paths) => {
    await initializeRuntime({ seedIfEmpty: false });
    const { createRuntimeBackup } = await import("../packages/server/src/runtime-backup");
    const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8")) as { version: string };
    const result = await createRuntimeBackup(paths, {
      lanternVersion: packageJson.version,
      outputFile: commandArgs[0],
    });
    console.log(`Lantern backup created: ${result.outputFile}`);
  });
}

async function restoreBackup() {
  const backupFile = commandArgs[0];
  if (!backupFile) throw new Error("Usage: lantern backup:restore <backup-file>");
  await withExclusiveRuntime(async (paths) => {
    await initializeRuntime({ seedIfEmpty: false });
    const { restoreRuntimeBackup } = await import("../packages/server/src/runtime-backup");
    const manifest = await restoreRuntimeBackup(paths, backupFile, {
      prepareDatabase: async (databaseFile) => runPrismaCommand(["migrate", "deploy"], {
        ...process.env,
        LANTERN_DATA_DIR: paths.dataDir,
        DATABASE_URL: `file:${path.resolve(databaseFile).replaceAll("\\", "/")}`,
      }),
    });
    console.log(`Lantern backup restored (${manifest.createdAt}, version ${manifest.lanternVersion}).`);
  });
}

async function initializeSample() {
  const paths = await initializeRuntime({ seedIfEmpty: false });
  const { initializeDatabaseConnection, prisma } = await import("../packages/server/src/db");
  const { initializeStarterData } = await import("./starter-data");
  await initializeDatabaseConnection();
  try {
    await initializeStarterData(paths, { requireEmpty: true });
  } finally {
    await prisma.$disconnect();
  }
  console.log("Lantern sample initialized.");
}

async function main() {
  if (!supportedCommands.includes(command)) throw new Error(`Unknown command: ${command}`);
  if (command === "start" || command === "dev") return runServices(command);
  if (command === "stop") return stopRuntime();
  if (command === "status") return showStatus();
  if (command === "doctor") return doctor();
  if (command === "sample:init") return initializeSample();
  if (command === "backup:create") return createBackup();
  return restoreBackup();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});

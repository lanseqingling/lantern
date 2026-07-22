import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import { access, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { getConfig, resetConfigForTests } from "@lantern/server/config";
import {
  acquireRuntimeLock,
  consumeRuntimeStopRequest,
  ensureRuntimeLayout,
  requestRuntimeStop,
  releaseRuntimeOwner,
  resetRuntimeTemp,
  runtimeProcessExists,
  runtimeOwner,
} from "@lantern/server/local-runtime";
import { getRuntimePaths } from "@lantern/server/runtime-paths";
import commandCatalog from "./lantern-commands.json";
import { initializeRuntime, repositoryRoot, runCommand, runPrismaCommand } from "./runtime-init";

type Command = keyof typeof commandCatalog.runtimeCommands;
const command = (process.argv[2] ?? "start") as Command;
const commandArgs = process.argv.slice(3);
const supportedCommands = Object.keys(commandCatalog.runtimeCommands) as Command[];

type ManagedService = {
  name: "api" | "web";
  child: ChildProcess;
  requestShutdown?: () => void;
};

function spawnService(
  name: ManagedService["name"],
  args: string[],
  env: Record<string, string | undefined>,
  logFile: string,
  options: { ipc?: boolean; cwd?: string } = {},
): ManagedService {
  const child = spawn(process.execPath, args, {
    cwd: options.cwd ?? repositoryRoot,
    env: { ...process.env, ...env },
    stdio: options.ipc ? ["inherit", "pipe", "pipe", "ipc"] : ["inherit", "pipe", "pipe"],
    detached: process.platform !== "win32",
    windowsHide: true,
  });
  const log = createWriteStream(logFile, { flags: "a", mode: 0o600 });
  child.stdout?.pipe(process.stdout);
  child.stderr?.pipe(process.stderr);
  child.stdout?.pipe(log, { end: false });
  child.stderr?.pipe(log, { end: false });
  child.once("close", () => log.end());
  return {
    name,
    child,
    requestShutdown: options.ipc
      ? () => {
          if (child.connected) child.send({ type: "lantern:shutdown" });
        }
      : undefined,
  };
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

function childHasExited(child: ChildProcess) {
  return child.exitCode !== null || child.signalCode !== null;
}

async function waitForChildExit(child: ChildProcess, timeoutMs: number) {
  if (childHasExited(child)) return true;
  return new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timeout);
      resolve(true);
    };
    child.once("exit", onExit);
  });
}

async function terminateWindowsProcessTree(pid: number) {
  const killer = spawn("taskkill", ["/pid", String(pid), "/t", "/f"], {
    stdio: "ignore",
    windowsHide: true,
  });
  await new Promise<void>((resolve, reject) => {
    killer.once("error", reject);
    killer.once("exit", () => resolve());
  });
}

function processExists(pid: number) {
  return runtimeProcessExists(pid);
}

function posixProcessGroupExists(pid: number) {
  if (process.platform === "win32") return false;
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function signalPosixProcessTree(pid: number, signal: NodeJS.Signals) {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    try {
      process.kill(pid, signal);
    } catch (fallbackError) {
      if ((fallbackError as NodeJS.ErrnoException).code !== "ESRCH") throw fallbackError;
    }
  }
}

async function waitForProcessExit(pid: number, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processExists(pid) && !posixProcessGroupExists(pid)) return true;
    await delay(100);
  }
  return !processExists(pid) && !posixProcessGroupExists(pid);
}

async function terminateProcessTree(pid: number) {
  if (!processExists(pid) && !posixProcessGroupExists(pid)) return;
  if (process.platform === "win32") {
    await terminateWindowsProcessTree(pid);
    return;
  }
  signalPosixProcessTree(pid, "SIGTERM");
  if (await waitForProcessExit(pid, 5000)) return;
  signalPosixProcessTree(pid, "SIGKILL");
  if (!await waitForProcessExit(pid, 5000)) throw new Error(`LANTERN_SERVICE_STOP_TIMEOUT:${pid}`);
}

async function stopChildren(services: ManagedService[]) {
  for (const service of services) {
    const { child } = service;
    if (childHasExited(child) || !child.pid) continue;
    if (service.requestShutdown) service.requestShutdown();
    else if (process.platform === "win32") await terminateWindowsProcessTree(child.pid);
    else signalPosixProcessTree(child.pid, "SIGTERM");
  }

  await Promise.all(services.map(async ({ child }) => {
    if (!child.pid) return;
    const childExited = await waitForChildExit(child, 5000);
    if (childExited && !posixProcessGroupExists(child.pid)) return;
    await terminateProcessTree(child.pid);
    if (!childHasExited(child) && !await waitForChildExit(child, 5000)) throw new Error(`LANTERN_SERVICE_STOP_TIMEOUT:${child.pid}`);
  }));
}

async function runServices(mode: "start" | "dev") {
  const paths = await ensureRuntimeLayout(getRuntimePaths());
  const lock = await acquireRuntimeLock(paths);
  await resetRuntimeTemp(paths);
  const services: ManagedService[] = [];
  let stopping = false;
  let shutdownPromise: Promise<void> | undefined;
  let acceptStopRequests = false;
  let checkingStopRequest = false;
  const shutdown = () => {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      stopping = true;
      clearInterval(stopMonitor);
      await stopChildren(services);
      await lock.release();
    })();
    return shutdownPromise;
  };
  const requestShutdown = () => void shutdown().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });

  const checkStopRequest = async () => {
    if (!acceptStopRequests || checkingStopRequest || stopping) return;
    checkingStopRequest = true;
    try {
      if (await consumeRuntimeStopRequest(lock.owner, paths)) await shutdown();
    } finally {
      checkingStopRequest = false;
    }
  };
  const stopMonitor = setInterval(() => void checkStopRequest(), 250);
  stopMonitor.unref();
  process.once("SIGINT", requestShutdown);
  process.once("SIGTERM", requestShutdown);

  try {
    await initializeRuntime();
    if (stopping) return;
    resetConfigForTests();
    const config = getConfig();
    const webRoot = path.join(repositoryRoot, "apps", "web");
    if (mode === "start") {
      const productionEntry = path.join(webRoot, "dist", "server", "index.js");
      if (!await access(productionEntry).then(() => true).catch(() => false)) await runCommand(["build"]);
    }

    await assertPortAvailable("127.0.0.1", config.API_PORT, "Lantern API");
    await assertPortAvailable("localhost", config.WEB_PORT, "Lantern Web");
    if (stopping) return;

    const sharedEnv = {
      LANTERN_DATA_DIR: paths.dataDir,
      DATABASE_URL: paths.databaseUrl,
      APP_ENV: mode === "start" ? "production" : "local",
      PORT: String(config.WEB_PORT),
      LANTERN_API_INTERNAL_URL: `http://127.0.0.1:${config.API_PORT}`,
    };
    const apiArgs = mode === "dev"
      ? ["--watch", "--import", "tsx", "apps/api/src/index.ts"]
      : ["--import", "tsx", "apps/api/src/index.ts"];
    const vinextCli = path.join(repositoryRoot, "node_modules", "vinext", "dist", "cli.js");
    const webArgs = mode === "dev"
      ? [vinextCli, "dev", "--host", "localhost", "--port", String(config.WEB_PORT), "--strictPort"]
      : [vinextCli, "start", "--hostname", "localhost", "--port", String(config.WEB_PORT)];
    services.push(
      spawnService("api", apiArgs, sharedEnv, path.join(paths.logsDir, "api.log"), { ipc: true }),
      spawnService("web", webArgs, sharedEnv, path.join(paths.logsDir, "web.log"), { cwd: webRoot }),
    );
    await lock.updateServices({
      apiPid: services.find((service) => service.name === "api")?.child.pid,
      webPid: services.find((service) => service.name === "web")?.child.pid,
    }, { api: config.API_PORT, web: config.WEB_PORT });
    acceptStopRequests = true;
    void checkStopRequest();
    const exitPromise = Promise.race(services.map(({ child }) => new Promise<number>((resolve, reject) => {
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
  const paths = getRuntimePaths();
  const owner = await requestRuntimeStop(paths);
  if (!owner?.pid) {
    console.log("Lantern is already stopped.");
    return;
  }
  console.log(`Stopping Lantern (pid ${owner.pid}).`);
  if (!runtimeProcessExists(owner.pid)) {
    const servicePids = [owner.services?.apiPid, owner.services?.webPid].filter((pid): pid is number => Boolean(pid));
    await Promise.all(servicePids.map((pid) => terminateProcessTree(pid)));
    await releaseRuntimeOwner(owner, paths);
    console.log("Lantern stopped.");
    return;
  }
  if (!owner.instanceId) {
    if (process.platform === "win32") await terminateWindowsProcessTree(owner.pid);
    else process.kill(owner.pid, "SIGTERM");
  }
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const current = await runtimeOwner(paths);
    if (!current || current.instanceId !== owner.instanceId) {
      const servicePids = [owner.services?.apiPid, owner.services?.webPid].filter((pid): pid is number => Boolean(pid));
      await Promise.all(servicePids.map((pid) => terminateProcessTree(pid)));
      if (!current && owner.ports) {
        for (let portAttempt = 0; portAttempt < 40; portAttempt += 1) {
          try {
            await Promise.all([
              assertPortAvailable("127.0.0.1", owner.ports.api, "Lantern API"),
              assertPortAvailable("localhost", owner.ports.web, "Lantern Web"),
            ]);
            console.log("Lantern stopped.");
            return;
          } catch {
            await delay(250);
          }
        }
        throw new Error(`LANTERN_PORT_RELEASE_TIMEOUT:${owner.ports.api}:${owner.ports.web}`);
      }
      console.log("Lantern stopped.");
      return;
    }
    await delay(250);
  }
  throw new Error(`LANTERN_STOP_TIMEOUT:${owner.pid}`);
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
  let mcpPermissions: string | undefined;
  if (process.platform !== "win32") {
    providerPermissions = ((await stat(paths.providerConfigFile)).mode & 0o777).toString(8).padStart(3, "0");
    if (providerPermissions !== "600") issues.push(`Provider configuration permissions should be 600; found ${providerPermissions}.`);
    mcpPermissions = ((await stat(paths.mcpConfigFile)).mode & 0o777).toString(8).padStart(3, "0");
    if (mcpPermissions !== "600") issues.push(`MCP configuration permissions should be 600; found ${mcpPermissions}.`);
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
  const { initializeDatabaseConnection, prisma } = await import("@lantern/server/db");
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
    data: { directory: paths.dataDir, writable: dataWritable, providerConfigPermissions: providerPermissions, mcpConfigPermissions: mcpPermissions },
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

async function installExternalAgent() {
  await ensureRuntimeLayout(getRuntimePaths());
  resetConfigForTests();
  const config = getConfig();
  const { installLanternAgentIntegration, resolveAgentForInstall } = await import("./agent-install");
  const agentId = await resolveAgentForInstall({ requestedAgent: commandArgs[0] });
  const result = await installLanternAgentIntegration({
    agentId,
    sourceSkillDir: path.join(repositoryRoot, "skills", "create-with-lantern"),
    mcpUrl: `http://127.0.0.1:${config.API_PORT}/mcp`,
    token: config.LANTERN_MCP_TOKEN,
  });
  console.log(`Lantern Agent integration installed for ${result.agentName}.`);
  console.log(`Lantern application Skill installed: ${result.skillDirectories.join(", ")}`);
  console.log(`Lantern MCP configured: ${result.configFile}`);
  console.log(`Restart ${result.agentName} after Lantern is running to load the integration.`);
}

async function initializeExampleComic() {
  await withExclusiveRuntime(async () => {
    await initializeRuntime({ seedIfEmpty: false });
    const { prisma } = await import("@lantern/server/db");
    try {
      const existing = await prisma.comic.findFirst({
        where: { id: "comic-campus-letter", archivedAt: null },
        select: { id: true },
      });
      if (existing) {
        console.log("The example comic already exists.");
        return;
      }
      const { seedCampusLetter } = await import("../samples/campus-letter/seed");
      await seedCampusLetter();
      console.log("The example comic has been restored.");
    } finally {
      await prisma.$disconnect();
    }
  });
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
    const { createRuntimeBackup } = await import("@lantern/server/runtime-backup");
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
    const { restoreRuntimeBackup } = await import("@lantern/server/runtime-backup");
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

async function main() {
  if (!supportedCommands.includes(command)) throw new Error(`Unknown command: ${command}`);
  if (command === "start" || command === "dev") return runServices(command);
  if (command === "stop") return stopRuntime();
  if (command === "status") return showStatus();
  if (command === "doctor") return doctor();
  if (command === "sample:init") return initializeExampleComic();
  if (command === "agent:install") return installExternalAgent();
  if (command === "backup:create") return createBackup();
  if (command === "backup:restore") return restoreBackup();
  command satisfies never;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});

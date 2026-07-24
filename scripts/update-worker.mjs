#!/usr/bin/env node

import { spawn } from "node:child_process";
import { access, appendFile, copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const [installRoot, stagedRoot, backupRoot, dataDir, updateVersion] = process.argv.slice(2);
if (!installRoot || !stagedRoot || !backupRoot || !dataDir || !updateVersion) throw new Error("LANTERN_UPDATE_WORKER_ARGUMENTS");

const logFile = path.join(dataDir, "logs", "update.log");
const statusFile = path.join(dataDir, "update-status.json");
const bootstrapFile = path.join(installRoot, "scripts", "lantern-bootstrap.mjs");
let backupCreated = false;

async function log(message) {
  await mkdir(path.dirname(logFile), { recursive: true });
  await appendFile(logFile, `${new Date().toISOString()} ${message}\n`, "utf8");
}

async function writeStatus(state, progress) {
  await writeFile(statusFile, `${JSON.stringify({ state, version: updateVersion, progress, updatedAt: new Date().toISOString() })}\n`, "utf8");
}

function runLantern(command) {
  const child = spawn(process.execPath, [bootstrapFile, command], {
    cwd: installRoot,
    env: { ...process.env, LANTERN_DATA_DIR: dataDir, LANTERN_NO_OPEN: "1" },
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.once("error", (error) => {
    void log(`Lantern ${command} command failed to launch: ${error.message}`).catch(() => undefined);
  });
  child.unref();
}

async function waitForStopped() {
  const lockFile = path.join(dataDir, "lantern.lock");
  for (let attempt = 0; attempt < 160; attempt += 1) {
    if (!await access(lockFile).then(() => true).catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("LANTERN_UPDATE_STOP_TIMEOUT");
}

async function apiPort() {
  const configuredPort = Number(process.env.API_PORT);
  if (configuredPort) return configuredPort;
  const runtimeFile = path.join(dataDir, "config", "runtime.json");
  const runtime = JSON.parse(await readFile(runtimeFile, "utf8"));
  return Number(runtime.apiPort) || 18787;
}

async function waitForStarted() {
  const port = await apiPort();
  for (let attempt = 0; attempt < 300; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {
      // The service is expected to be temporarily unavailable while restarting.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("LANTERN_UPDATE_START_TIMEOUT");
}

async function preserveLocalRuntimeFiles() {
  const previousEnv = path.join(backupRoot, ".env");
  if (await access(previousEnv).then(() => true).catch(() => false)) await copyFile(previousEnv, path.join(installRoot, ".env"));
  const previousModules = path.join(backupRoot, "node_modules");
  if (await access(previousModules).then(() => true).catch(() => false)) {
    await rename(previousModules, path.join(installRoot, "node_modules"));
  }
}

async function restorePreviousInstall(error) {
  await log(`Update failed after replacement: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  runLantern("stop");
  await waitForStopped().catch(() => undefined);
  const failedRoot = `${stagedRoot}.failed`;
  await rm(failedRoot, { recursive: true, force: true });
  await rename(installRoot, failedRoot).catch(() => undefined);
  await rename(backupRoot, installRoot);
  backupCreated = false;
  runLantern("start");
  await writeStatus("failed");
}

try {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await writeStatus("stopping", 92);
  await log(`Stopping Lantern before replacing ${installRoot}`);
  runLantern("stop");
  await waitForStopped();
  await rm(backupRoot, { recursive: true, force: true });
  await writeStatus("replacing", 95);
  await rename(installRoot, backupRoot);
  backupCreated = true;
  await rename(stagedRoot, installRoot);
  await preserveLocalRuntimeFiles();
  await writeStatus("restarting", 98);
  await log("Starting updated Lantern");
  runLantern("start");
  await waitForStarted();
  await log("Lantern update completed");
  await writeStatus("completed", 100);
  await rm(backupRoot, { recursive: true, force: true });
  backupCreated = false;
} catch (error) {
  if (backupCreated) {
    await restorePreviousInstall(error).catch(async (restoreError) => {
      await writeStatus("failed").catch(() => undefined);
      await log(`Lantern rollback failed: ${restoreError instanceof Error ? restoreError.stack ?? restoreError.message : String(restoreError)}`);
    });
  } else {
    await writeStatus("failed").catch(() => undefined);
    await log(`Lantern update failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  }
  process.exitCode = 1;
}

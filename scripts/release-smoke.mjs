#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bootstrap = path.join(repositoryRoot, "scripts", "lantern-bootstrap.mjs");

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : undefined;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (!port) throw new Error("Unable to reserve a smoke-test port.");
  return port;
}

function runBootstrap(args, env, stdio = "pipe") {
  return spawn(process.execPath, [bootstrap, ...args], {
    cwd: repositoryRoot,
    env: { ...process.env, ...env },
    stdio,
    windowsHide: true,
  });
}

async function waitForWorkbench(url, child, timeoutMs = 10 * 60 * 1000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) throw new Error(`Lantern exited before becoming ready (${child.exitCode}).`);
    try {
      const response = await fetch(`${url}/api/backend/v1/comics`, { signal: AbortSignal.timeout(1500) });
      if (response.ok) {
        const payload = await response.json();
        const titles = payload?.data?.items?.map?.((comic) => comic.title) ?? [];
        if (titles.includes("雨夜车站") && titles.includes("风停之前")) return titles.sort();
      }
    } catch {}
    await delay(500);
  }
  throw new Error(`Lantern did not become ready within ${timeoutMs}ms.`);
}

async function stopLantern(env, child) {
  const stopper = runBootstrap(["stop"], env, "inherit");
  await new Promise((resolve, reject) => {
    stopper.once("error", reject);
    stopper.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Lantern stop failed (${code}).`)));
  });
  const exited = child.exitCode !== null ? child.exitCode : await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(15_000).then(() => "timeout"),
  ]);
  if (exited === "timeout") {
    child.kill("SIGTERM");
    throw new Error("Lantern did not stop within 15 seconds.");
  }
}

async function runOnce(env, webUrl) {
  console.log(`Starting Lantern release smoke at ${webUrl}...`);
  const child = runBootstrap(["start"], env);
  let output = "";
  child.stdout?.on("data", (chunk) => { output += chunk.toString(); process.stdout.write(chunk); });
  child.stderr?.on("data", (chunk) => { output += chunk.toString(); process.stderr.write(chunk); });
  try {
    const titles = await waitForWorkbench(webUrl, child);
    console.log(`Workbench ready with ${titles.length} starter comics; stopping...`);
    await stopLantern(env, child);
    return { titles, output };
  } catch (error) {
    child.kill("SIGTERM");
    throw error;
  }
}

const dataDir = await mkdtemp(path.join(tmpdir(), "lantern-release-smoke-"));
console.log(`Using isolated Lantern data: ${dataDir}`);
const apiPort = await freePort();
const webPort = await freePort();
const env = {
  LANTERN_DATA_DIR: dataDir,
  API_PORT: String(apiPort),
  WEB_PORT: String(webPort),
  LANTERN_NO_OPEN: "1",
};

try {
  const first = await runOnce(env, `http://localhost:${webPort}`);
  const databaseBeforeRestart = await readFile(path.join(dataDir, "lantern.db"));
  const second = await runOnce(env, `http://localhost:${webPort}`);
  const databaseAfterRestart = await readFile(path.join(dataDir, "lantern.db"));
  if (first.titles.join("|") !== second.titles.join("|")) throw new Error("Starter comics changed after restart.");
  if (!databaseBeforeRestart.length || !databaseAfterRestart.length) throw new Error("Lantern database was not persisted.");
  console.log(`Lantern release smoke passed on ${process.platform}: ${second.titles.join(", ")}`);
} finally {
  await rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}

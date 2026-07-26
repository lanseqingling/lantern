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

function childHasExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

async function waitForChildExit(child, timeoutMs) {
  if (childHasExited(child)) return { code: child.exitCode, signal: child.signalCode };
  return Promise.race([
    new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal }))),
    delay(timeoutMs).then(() => undefined),
  ]);
}

async function portAvailable(port) {
  const server = createServer();
  return new Promise((resolve) => {
    server.once("error", () => resolve(false));
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      server.close((error) => resolve(!error));
    });
  });
}

async function waitForPortsReleased(env, timeoutMs = 15_000) {
  const ports = [Number(env.API_PORT), Number(env.WEB_PORT)];
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if ((await Promise.all(ports.map(portAvailable))).every(Boolean)) return;
    await delay(250);
  }
  throw new Error(`Lantern ports were not released within ${timeoutMs}ms.`);
}

async function forceStopChild(child) {
  if (childHasExited(child) || !child.pid) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    });
    await new Promise((resolve) => killer.once("exit", resolve));
  } else {
    child.kill("SIGKILL");
  }
  await waitForChildExit(child, 5000);
}

async function waitForWorkbench(url, child, timeoutMs = 10 * 60 * 1000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) throw new Error(`Lantern exited before becoming ready (${child.exitCode}).`);
    try {
      const response = await fetch(`${url}/api/backend/v1/comics`, { signal: AbortSignal.timeout(1500) });
      if (response.ok) {
        const payload = await response.json();
        const comics = payload?.data?.items ?? [];
        const example = comics.find?.((comic) => comic.title === "风停之前");
        if (example?.isExample === true && comics.length === 1) return comics.map((comic) => comic.title);
      }
    } catch {}
    await delay(500);
  }
  throw new Error(`Lantern did not become ready within ${timeoutMs}ms.`);
}

async function verifyWebAssets(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Lantern web page returned ${response.status}.`);
  const html = await response.text();
  const assetPaths = [...html.matchAll(/(?:href|src)=["']([^"']+)["']/g)]
    .map((match) => match[1])
    .filter((assetPath) => /^\/assets\/.+\.(?:css|m?js)(?:\?.*)?$/.test(assetPath));
  const uniqueAssetPaths = [...new Set(assetPaths)];
  if (!uniqueAssetPaths.some((assetPath) => /\.css(?:\?|$)/.test(assetPath))) {
    throw new Error("Lantern web page did not reference a built stylesheet.");
  }
  if (!uniqueAssetPaths.some((assetPath) => /\.m?js(?:\?|$)/.test(assetPath))) {
    throw new Error("Lantern web page did not reference a built client script.");
  }
  for (const assetPath of uniqueAssetPaths) {
    const assetResponse = await fetch(new URL(assetPath, url), { signal: AbortSignal.timeout(5000) });
    if (!assetResponse.ok) throw new Error(`Lantern asset ${assetPath} returned ${assetResponse.status}.`);
    const contentType = assetResponse.headers.get("content-type") ?? "";
    const expectedType = /\.css(?:\?|$)/.test(assetPath) ? "text/css" : "javascript";
    if (!contentType.toLowerCase().includes(expectedType)) {
      throw new Error(`Lantern asset ${assetPath} returned unexpected content type ${contentType || "(missing)"}.`);
    }
    await assetResponse.arrayBuffer();
  }
  return uniqueAssetPaths.length;
}

async function stopLantern(env, child) {
  const stopper = runBootstrap(["stop"], env, "inherit");
  await new Promise((resolve, reject) => {
    stopper.once("error", reject);
    stopper.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Lantern stop failed (${code}).`)));
  });
  const exited = await waitForChildExit(child, 15_000);
  if (!exited) {
    await forceStopChild(child);
    throw new Error("Lantern did not stop within 15 seconds.");
  }
  if (exited.code !== 0) throw new Error(`Lantern start process exited during stop (${exited.code ?? exited.signal}).`);
  await waitForPortsReleased(env);
}

async function runOnce(env, webUrl) {
  console.log(`Starting Lantern release smoke at ${webUrl}...`);
  const child = runBootstrap(["start"], env);
  let output = "";
  child.stdout?.on("data", (chunk) => { output += chunk.toString(); process.stdout.write(chunk); });
  child.stderr?.on("data", (chunk) => { output += chunk.toString(); process.stderr.write(chunk); });
  try {
    const titles = await waitForWorkbench(webUrl, child);
    const assetCount = await verifyWebAssets(webUrl);
    console.log(`Workbench ready with ${titles.length} comics and ${assetCount} web assets; stopping...`);
    await stopLantern(env, child);
    return { titles, output };
  } catch (error) {
    const stopper = runBootstrap(["stop"], env, "ignore");
    await waitForChildExit(stopper, 5000).catch(() => undefined);
    await forceStopChild(child);
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
  if (first.titles.join("|") !== second.titles.join("|")) throw new Error("Comics changed after restart.");
  if (!databaseBeforeRestart.length || !databaseAfterRestart.length) throw new Error("Lantern database was not persisted.");
  console.log(`Lantern release smoke passed on ${process.platform}: ${second.titles.join(", ")}`);
} finally {
  await rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}

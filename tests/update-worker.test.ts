import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workerFile = path.join(repositoryRoot, "scripts", "update-worker.mjs");

async function availablePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

const fixtureBootstrap = `
import { createServer } from "node:http";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
const command = process.argv[2];
const dataDir = process.env.LANTERN_DATA_DIR;
const lockFile = path.join(dataDir, "lantern.lock");
if (command === "stop") {
  await rm(lockFile, { force: true });
} else if (command === "start") {
  const runtime = JSON.parse(await import("node:fs/promises").then(({ readFile }) => readFile(path.join(dataDir, "config", "runtime.json"), "utf8")));
  const apiPort = Number(process.env.API_PORT) || runtime.apiPort;
  await mkdir(dataDir, { recursive: true });
  await writeFile(lockFile, JSON.stringify({ pid: process.pid }));
  const server = createServer((request, response) => {
    response.writeHead(request.url === "/health" ? 200 : 404, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: request.url === "/health" }));
  });
  server.listen(apiPort, "127.0.0.1");
}
`;

const rollbackFixtureBootstrap = `
import { rm } from "node:fs/promises";
import path from "node:path";
if (process.argv[2] === "stop") {
  await rm(path.join(process.env.LANTERN_DATA_DIR, "lantern.lock"), { force: true });
}
`;

test("application update worker replaces the install and restarts its health endpoint", { timeout: 30_000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "lantern-update-worker-"));
  const installRoot = path.join(root, "lantern");
  const stagedRoot = path.join(root, "staged");
  const backupRoot = path.join(root, "backup");
  const dataDir = path.join(root, "data");
  const port = await availablePort();
  let restartedPid: number | undefined;

  try {
    await Promise.all([
      mkdir(path.join(installRoot, "scripts"), { recursive: true }),
      mkdir(path.join(stagedRoot, "scripts"), { recursive: true }),
      mkdir(path.join(dataDir, "config"), { recursive: true }),
      mkdir(path.join(dataDir, "logs"), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(path.join(installRoot, "scripts", "lantern-bootstrap.mjs"), fixtureBootstrap),
      writeFile(path.join(stagedRoot, "scripts", "lantern-bootstrap.mjs"), fixtureBootstrap),
      writeFile(path.join(installRoot, "marker.txt"), "old"),
      writeFile(path.join(stagedRoot, "marker.txt"), "new"),
      writeFile(path.join(dataDir, "config", "runtime.json"), JSON.stringify({ apiPort: port + 1 })),
      writeFile(path.join(dataDir, "lantern.lock"), JSON.stringify({ pid: process.pid })),
    ]);

    const worker = spawn(process.execPath, [workerFile, installRoot, stagedRoot, backupRoot, dataDir, "0.1.4"], {
      cwd: root,
      env: { ...process.env, API_PORT: String(port) },
      stdio: "inherit",
    });
    const [exitCode] = await once(worker, "exit");
    const updateLog = await readFile(path.join(dataDir, "logs", "update.log"), "utf8").catch(() => "");
    assert.equal(exitCode, 0, updateLog);
    assert.equal(await readFile(path.join(installRoot, "marker.txt"), "utf8"), "new");
    const updateStatus = JSON.parse(await readFile(path.join(dataDir, "update-status.json"), "utf8"));
    assert.equal(updateStatus.state, "completed");
    assert.equal(updateStatus.progress, 100);
    restartedPid = JSON.parse(await readFile(path.join(dataDir, "lantern.lock"), "utf8")).pid;
    assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200);
  } finally {
    if (restartedPid) {
      try {
        process.kill(restartedPid, "SIGTERM");
      } catch {
        // The fixture server may already have exited.
      }
    }
    await rm(root, { recursive: true, force: true });
  }
});

test("application update worker restores the previous install when staged replacement fails", { timeout: 10_000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "lantern-update-rollback-"));
  const installRoot = path.join(root, "lantern");
  const stagedRoot = path.join(root, "missing-staged");
  const backupRoot = path.join(root, "backup");
  const dataDir = path.join(root, "data");

  try {
    await Promise.all([
      mkdir(path.join(installRoot, "scripts"), { recursive: true }),
      mkdir(path.join(dataDir, "logs"), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(path.join(installRoot, "scripts", "lantern-bootstrap.mjs"), rollbackFixtureBootstrap),
      writeFile(path.join(installRoot, "marker.txt"), "old"),
      writeFile(path.join(dataDir, "lantern.lock"), JSON.stringify({ pid: process.pid })),
    ]);

    const worker = spawn(process.execPath, [workerFile, installRoot, stagedRoot, backupRoot, dataDir, "0.1.4"], {
      cwd: root,
      stdio: "inherit",
    });
    const [exitCode] = await once(worker, "exit");
    assert.equal(exitCode, 1);
    assert.equal(await readFile(path.join(installRoot, "marker.txt"), "utf8"), "old");
    assert.equal(JSON.parse(await readFile(path.join(dataDir, "update-status.json"), "utf8")).state, "failed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

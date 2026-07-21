#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prismaClientReady, prismaSchemaState, recordPrismaClientState } from "./prisma-client-state.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJsonPath = path.join(repositoryRoot, "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const packageManager = String(packageJson.packageManager ?? "");
const packageManagerMatch = /^pnpm@(.+)$/.exec(packageManager);

if (!packageManagerMatch) throw new Error(`Unsupported packageManager: ${packageManager || "missing"}`);

const pnpmVersion = packageManagerMatch[1];
const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
const pnpmExecutable = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const bundledPnpmCli = path.join(repositoryRoot, "node_modules", "pnpm", "bin", "pnpm.cjs");
const installMarker = path.join(repositoryRoot, "node_modules", ".lantern-install-state");
const prismaCli = path.join(repositoryRoot, "node_modules", "prisma", "build", "index.js");

function toolCacheRoot() {
  if (process.env.LANTERN_TOOL_CACHE_DIR) return path.resolve(process.env.LANTERN_TOOL_CACHE_DIR);
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Caches", "Lantern", "tools");
  if (process.platform === "win32") return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Lantern", "Cache", "tools");
  return path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"), "lantern", "tools");
}

function assertNodeVersion() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 13)) {
    throw new Error(`Lantern requires Node.js 22.13 or newer; found ${process.versions.node}.`);
  }
}

function commandResult(executable, args, options = {}) {
  const useCommandShell = process.platform === "win32" && /\.(?:cmd|bat)$/i.test(executable);
  return spawnSync(useCommandShell ? process.env.ComSpec || "cmd.exe" : executable, useCommandShell ? ["/d", "/s", "/c", executable, ...args] : args, {
    cwd: repositoryRoot,
    env: options.env ?? process.env,
    encoding: options.encoding,
    stdio: options.stdio,
    windowsHide: true,
  });
}

function availablePnpmExecutable() {
  const candidates = [
    { executable: process.execPath, prefix: [bundledPnpmCli], available: existsSync(bundledPnpmCli) },
    { executable: pnpmExecutable, prefix: [], available: true },
  ];
  for (const candidate of candidates) {
    if (!candidate.available) continue;
    const result = commandResult(candidate.executable, [...candidate.prefix, "--version"], { encoding: "utf8" });
    if (result.status === 0 && result.stdout.trim() === pnpmVersion) return candidate;
  }
  return undefined;
}

function cachedPnpmExecutable() {
  const packageRoot = path.join(toolCacheRoot(), `pnpm-${pnpmVersion}`);
  const cli = path.join(packageRoot, "node_modules", "pnpm", "bin", "pnpm.cjs");
  if (existsSync(cli)) {
    const current = commandResult(process.execPath, [cli, "--version"], { encoding: "utf8" });
    if (current.status === 0 && current.stdout.trim() === pnpmVersion) return { executable: process.execPath, prefix: [cli] };
  }
  if (!npmAvailable()) return undefined;
  mkdirSync(packageRoot, { recursive: true, mode: 0o700 });
  const install = commandResult(npmExecutable, [
    "install",
    "--prefix",
    packageRoot,
    "--no-save",
    "--ignore-scripts",
    "--package-lock=false",
    `pnpm@${pnpmVersion}`,
  ], { stdio: "inherit" });
  if (install.error) throw install.error;
  if (install.status !== 0 || !existsSync(cli)) return undefined;
  return { executable: process.execPath, prefix: [cli] };
}

function npmAvailable() {
  return commandResult(npmExecutable, ["--version"], { stdio: "ignore" }).status === 0;
}

function runPnpm(args, options = {}) {
  const availablePnpm = options.external ? cachedPnpmExecutable() : availablePnpmExecutable();
  const result = availablePnpm
    ? commandResult(availablePnpm.executable, [...availablePnpm.prefix, ...args], { stdio: "inherit" })
    : undefined;
  if (!result) {
    throw new Error(`Neither pnpm ${pnpmVersion} nor npm is available. Install Node.js 22.13+ with npm and retry.`);
  }
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function dependencyState() {
  const hash = createHash("sha256");
  const workspaceManifests = ["apps", "packages"].flatMap((workspaceDirectory) => {
    const absoluteDirectory = path.join(repositoryRoot, workspaceDirectory);
    if (!existsSync(absoluteDirectory)) return [];
    return readdirSync(absoluteDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(path.join(absoluteDirectory, entry.name, "package.json")))
      .map((entry) => `${workspaceDirectory}/${entry.name}/package.json`);
  });
  for (const filename of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ...workspaceManifests].sort()) {
    hash.update(filename);
    hash.update(readFileSync(path.join(repositoryRoot, filename)));
  }
  return hash.digest("hex");
}

function dependenciesReady(expectedState) {
  if (!existsSync(path.join(repositoryRoot, "node_modules", ".modules.yaml"))) return false;
  if (!existsSync(path.join(repositoryRoot, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx"))) return false;
  try {
    return readFileSync(installMarker, "utf8").trim() === expectedState;
  } catch {
    return false;
  }
}

function installDependencies(force = false) {
  const expectedState = dependencyState();
  if (!force && dependenciesReady(expectedState)) return;
  console.log(`Preparing Lantern dependencies with pnpm ${pnpmVersion}...`);
  runPnpm(["install", "--frozen-lockfile"], { external: true });
  writeFileSync(installMarker, `${expectedState}\n`, { encoding: "utf8", mode: 0o600 });
}

function ensurePrismaClient() {
  const expectedState = prismaSchemaState(repositoryRoot);
  if (prismaClientReady(repositoryRoot, expectedState)) return;
  console.log("Generating the Lantern database client...");
  const result = commandResult(process.execPath, [prismaCli, "generate"], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL || "file:./lantern-bootstrap.db" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  recordPrismaClientState(repositoryRoot, expectedState);
}

function printHelp() {
  console.log(`Lantern local launcher

Usage:
  ./lantern start       Initialize and start Lantern
  ./lantern dev         Start Lantern in development mode
  ./lantern stop        Stop the running local service
  ./lantern status      Show local service status
  ./lantern doctor      Inspect the local runtime
  ./lantern sample:init Initialize the sample in an empty database
  ./lantern backup:create [file] Create a consistent work backup
  ./lantern backup:restore <file> Restore a validated work backup
  ./lantern setup       Install the locked dependencies only
  ./lantern test        Run any package.json script without global pnpm

Windows PowerShell or Command Prompt: lantern.cmd <command>
The first command automatically installs the repository-locked pnpm and dependencies.`);
}

assertNodeVersion();
const args = process.argv.slice(2);
if (args[0] === "--help" || args[0] === "-h" || args[0] === "help") {
  printHelp();
  process.exit(0);
}
if (args[0] === "setup") {
  installDependencies(true);
  ensurePrismaClient();
  console.log("Lantern dependencies are ready. Run ./lantern start.");
  process.exit(0);
}

installDependencies();
ensurePrismaClient();
const requestedCommand = args[0] ?? "start";
const commandArgs = args.slice(1);
const runtimeCommands = new Set(["start", "dev", "stop", "status", "doctor", "sample:init", "backup:create", "backup:restore"]);
if (runtimeCommands.has(requestedCommand)) {
  runPnpm(["run", "lantern", requestedCommand, ...commandArgs]);
} else if (requestedCommand !== "lantern" && packageJson.scripts?.[requestedCommand]) {
  runPnpm(["run", requestedCommand, ...commandArgs]);
} else {
  throw new Error(`Unknown Lantern command: ${requestedCommand}. Run ./lantern --help.`);
}

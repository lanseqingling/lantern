#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
const prismaMarker = path.join(repositoryRoot, "node_modules", ".lantern-prisma-schema-state");
const prismaCli = path.join(repositoryRoot, "node_modules", "prisma", "build", "index.js");

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

function npmAvailable() {
  return commandResult(npmExecutable, ["--version"], { stdio: "ignore" }).status === 0;
}

function runPnpm(args) {
  const availablePnpm = availablePnpmExecutable();
  const result = availablePnpm
    ? commandResult(availablePnpm.executable, [...availablePnpm.prefix, ...args], { stdio: "inherit" })
    : npmAvailable()
      ? commandResult(npmExecutable, ["exec", "--yes", `--package=pnpm@${pnpmVersion}`, "--", "pnpm", ...args], { stdio: "inherit" })
      : undefined;
  if (!result) {
    throw new Error(`Neither pnpm ${pnpmVersion} nor npm is available. Install Node.js 22.13+ with npm and retry.`);
  }
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function dependencyState() {
  const hash = createHash("sha256");
  for (const filename of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"]) {
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
  runPnpm(["install", "--frozen-lockfile"]);
  writeFileSync(installMarker, `${expectedState}\n`, { encoding: "utf8", mode: 0o600 });
}

function prismaSchemaState() {
  const hash = createHash("sha256");
  for (const filename of ["package.json", path.join("prisma", "schema.prisma")]) {
    hash.update(filename);
    hash.update(readFileSync(path.join(repositoryRoot, filename)));
  }
  return hash.digest("hex");
}

function ensurePrismaClient() {
  const expectedState = prismaSchemaState();
  const currentState = existsSync(prismaMarker) ? readFileSync(prismaMarker, "utf8").trim() : undefined;
  if (currentState === expectedState && existsSync(path.join(repositoryRoot, "node_modules", ".prisma", "client", "index.js"))) return;
  console.log("Generating the Lantern database client...");
  const result = commandResult(process.execPath, [prismaCli, "generate"], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL || "file:./lantern-bootstrap.db" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  writeFileSync(prismaMarker, `${expectedState}\n`, { encoding: "utf8", mode: 0o600 });
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
const runtimeCommands = new Set(["start", "dev", "stop", "status", "doctor", "sample:init"]);
if (runtimeCommands.has(requestedCommand)) {
  runPnpm(["run", "lantern", requestedCommand, ...commandArgs]);
} else if (requestedCommand !== "lantern" && packageJson.scripts?.[requestedCommand]) {
  runPnpm(["run", requestedCommand, ...commandArgs]);
} else {
  throw new Error(`Unknown Lantern command: ${requestedCommand}. Run ./lantern --help.`);
}

#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const maximumTrackedFileBytes = 10 * 1024 * 1024;
const allowedLicense = /(?:^|\b)(MIT|ISC|0BSD|BSD(?:-\d-Clause)?|Apache-2\.0|BlueOak-1\.0\.0|CC0-1\.0|CC-BY-4\.0|LGPL-3\.0-or-later|MPL-2\.0|Python-2\.0|Unlicense)(?:\b|$)/i;

function trackedFiles() {
  const result = spawnSync("git", ["ls-files", "-z"], { cwd: repositoryRoot, encoding: "utf8", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("Release audit requires a Git checkout.");
  return result.stdout.split("\0").filter(Boolean);
}

const issues = [];
for (const relativePath of trackedFiles()) {
  const normalized = relativePath.replaceAll("\\", "/");
  const absolutePath = path.join(repositoryRoot, relativePath);
  const fileStat = await lstat(absolutePath);
  if (!fileStat.isFile()) continue;
  if (fileStat.size > maximumTrackedFileBytes) issues.push(`${normalized}: tracked file exceeds 10 MiB`);
  if ((/^\.env(?:\.|$)/.test(normalized) && normalized !== ".env.example") || /(?:^|\/)(?:id_rsa|id_ed25519|[^/]+\.(?:pem|p12|pfx|key))$/i.test(normalized)) {
    issues.push(`${normalized}: sensitive file name must not be tracked`);
  }
  if (fileStat.size <= 2 * 1024 * 1024) {
    const text = await readFile(absolutePath, "utf8").catch(() => "");
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) issues.push(`${normalized}: private key material detected`);
    if (/(?:ghp|github_pat|sk-proj)-[A-Za-z0-9_-]{20,}/.test(text)) issues.push(`${normalized}: credential-like token detected`);
  }
}

const pnpmStore = path.join(repositoryRoot, "node_modules", ".pnpm");
const dependencyLicenses = new Map();
for (const storeEntry of await readdir(pnpmStore, { withFileTypes: true })) {
  if (!storeEntry.isDirectory()) continue;
  const modulesDirectory = path.join(pnpmStore, storeEntry.name, "node_modules");
  const moduleEntries = await readdir(modulesDirectory, { withFileTypes: true }).catch(() => []);
  for (const moduleEntry of moduleEntries) {
    if (!moduleEntry.isDirectory()) continue;
    const packageDirectories = moduleEntry.name.startsWith("@")
      ? (await readdir(path.join(modulesDirectory, moduleEntry.name), { withFileTypes: true }).catch(() => []))
          .filter((entry) => entry.isDirectory())
          .map((entry) => path.join(modulesDirectory, moduleEntry.name, entry.name))
      : [path.join(modulesDirectory, moduleEntry.name)];
    for (const packageDirectory of packageDirectories) {
      const packageJson = await readFile(path.join(packageDirectory, "package.json"), "utf8").then(JSON.parse).catch(() => undefined);
      if (!packageJson?.name || dependencyLicenses.has(`${packageJson.name}@${packageJson.version}`)) continue;
      const license = typeof packageJson.license === "string" ? packageJson.license : "missing";
      dependencyLicenses.set(`${packageJson.name}@${packageJson.version}`, license);
      if (!allowedLicense.test(license)) issues.push(`${packageJson.name}@${packageJson.version}: review dependency license ${license}`);
    }
  }
}

if (issues.length) throw new Error(`Release audit failed:\n${issues.map((issue) => `  - ${issue}`).join("\n")}`);
console.log(`Release audit passed: ${trackedFiles().length} tracked files, ${dependencyLicenses.size} dependency packages.`);

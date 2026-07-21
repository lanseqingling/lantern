#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseDirectory = path.resolve(process.env.LANTERN_PACKAGE_DIR || path.join(repositoryRoot, "release"));
const assetNames = (await readdir(releaseDirectory))
  .filter((name) => name.endsWith("-source.zip"))
  .sort();

if (!assetNames.length) throw new Error(`No Lantern source archive found in ${releaseDirectory}.`);

const entries = [];
for (const name of assetNames) {
  const contents = await readFile(path.join(releaseDirectory, name));
  entries.push(`${createHash("sha256").update(contents).digest("hex")}  ${name}`);
}

const checksumFile = path.join(releaseDirectory, "SHA256SUMS");
await writeFile(checksumFile, `${entries.join("\n")}\n`, "utf8");
console.log(`Lantern release checksums: ${checksumFile}`);

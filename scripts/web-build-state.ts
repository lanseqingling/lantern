import { createHash } from "node:crypto";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const buildStateSchema = "lantern-web-build-v1";
const buildInputPaths = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  "tsconfig.json",
  "apps/web",
  "packages",
];
const excludedDirectoryNames = new Set(["dist", "node_modules"]);
const excludedFileSuffixes = [".tsbuildinfo"];

export function webBuildEntry(root: string) {
  return path.join(root, "apps", "web", "dist", "server", "index.js");
}

export function webBuildStateFile(root: string) {
  return path.join(root, "apps", "web", "dist", ".lantern-build-state.json");
}

function compareNames(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function appendPathState(root: string, relativePath: string, hash: ReturnType<typeof createHash>): Promise<void> {
  const absolutePath = path.join(root, relativePath);
  const entries = await readdir(absolutePath, { withFileTypes: true }).catch(() => undefined);
  if (!entries) {
    const contents = await readFile(absolutePath).catch(() => undefined);
    if (!contents) return;
    hash.update(relativePath.replaceAll(path.sep, "/"));
    hash.update("\0");
    hash.update(contents);
    hash.update("\0");
    return;
  }

  for (const entry of entries.sort((left, right) => compareNames(left.name, right.name))) {
    if (entry.isDirectory() && excludedDirectoryNames.has(entry.name)) continue;
    if (entry.isFile() && excludedFileSuffixes.some((suffix) => entry.name.endsWith(suffix))) continue;
    if (!entry.isDirectory() && !entry.isFile()) continue;
    await appendPathState(root, path.join(relativePath, entry.name), hash);
  }
}

export async function currentWebBuildState(root: string) {
  const hash = createHash("sha256");
  hash.update(buildStateSchema);
  for (const relativePath of buildInputPaths) await appendPathState(root, relativePath, hash);
  return hash.digest("hex");
}

export async function recordCurrentWebBuild(root: string) {
  const stateFile = webBuildStateFile(root);
  const state = await currentWebBuildState(root);
  await mkdir(path.dirname(stateFile), { recursive: true });
  await writeFile(stateFile, `${JSON.stringify({ schema: buildStateSchema, state }, null, 2)}\n`, "utf8");
  return state;
}

export async function webBuildIsCurrent(root: string) {
  if (!await access(webBuildEntry(root)).then(() => true).catch(() => false)) return false;
  try {
    const recorded = JSON.parse(await readFile(webBuildStateFile(root), "utf8")) as { schema?: string; state?: string };
    return recorded.schema === buildStateSchema && recorded.state === await currentWebBuildState(root);
  } catch {
    return false;
  }
}

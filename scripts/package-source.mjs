import { spawnSync } from "node:child_process";
import { readFile, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8"));
const archiveRoot = `lantern-${packageJson.version}`;
const outputDirectory = path.resolve(process.env.LANTERN_PACKAGE_DIR || path.join(repositoryRoot, "release"));
const outputFile = path.join(outputDirectory, `${archiveRoot}-source.zip`);
const excludedDirectories = new Set([
  ".git",
  ".idea",
  ".next",
  ".pnpm-store",
  ".vinext",
  ".vite",
  ".wrangler",
  "dist",
  "lantern-data",
  "node_modules",
  "out",
  "outputs",
  "release",
  "work",
]);

function gitFiles(args) {
  const result = spawnSync("git", ["ls-files", "-z", ...args], { cwd: repositoryRoot, encoding: "utf8", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("Source packaging requires a Git checkout so the release boundary is explicit.");
  return result.stdout.split("\0").filter(Boolean);
}

function excluded(relativePath) {
  const parts = relativePath.split(/[\\/]/);
  if (parts.some((part) => excludedDirectories.has(part))) return true;
  const name = parts.at(-1) || "";
  if (name === ".DS_Store" || name === ".env" || name.endsWith(".tsbuildinfo")) return true;
  return name.startsWith(".env.") && name !== ".env.example";
}

const untracked = gitFiles(["--others", "--exclude-standard"]).filter((file) => !excluded(file));
if (untracked.length) {
  const preview = untracked.slice(0, 12).map((file) => `  - ${file}`).join("\n");
  const remainder = untracked.length > 12 ? `\n  ... and ${untracked.length - 12} more` : "";
  throw new Error(`Refusing to create a source release with untracked files:\n${preview}${remainder}\nCommit, stage, ignore, or remove them first.`);
}

const files = gitFiles(["--cached"]).filter((file) => !excluded(file));
const archive = {};
for (const relativePath of files) {
  const absolutePath = path.join(repositoryRoot, relativePath);
  const fileStat = await stat(absolutePath).catch(() => undefined);
  if (!fileStat?.isFile()) continue;
  const mode = fileStat.mode & 0o111 ? 0o755 : 0o644;
  archive[`${archiveRoot}/${relativePath.replaceAll("\\", "/")}`] = [
    new Uint8Array(await readFile(absolutePath)),
    { os: 3, attrs: mode << 16 },
  ];
}
archive[`${archiveRoot}/.lantern-release.json`] = [
  new TextEncoder().encode(`${JSON.stringify({ distribution: "source-release", version: packageJson.version }, null, 2)}\n`),
  { os: 3, attrs: 0o644 << 16 },
];

await mkdir(outputDirectory, { recursive: true });
await writeFile(outputFile, zipSync(archive, { level: 9 }));
console.log(`Lantern source package: ${outputFile}`);

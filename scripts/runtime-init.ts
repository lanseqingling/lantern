import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ensureRuntimeLayout } from "../packages/server/src/local-runtime";
import { getRuntimePaths } from "../packages/server/src/runtime-paths";

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function pnpmCli() {
  const inherited = process.env.npm_execpath;
  if (inherited && /pnpm(?:\.cjs)?$/i.test(inherited)) return inherited;
  return path.join(repositoryRoot, "node_modules", "pnpm", "bin", "pnpm.cjs");
}

export function runCommand(args: string[], options: { env?: Record<string, string | undefined>; quiet?: boolean } = {}) {
  return runExecutable(process.execPath, [pnpmCli(), ...args], options);
}

function runExecutable(executable: string, args: string[], options: { env?: Record<string, string | undefined>; quiet?: boolean } = {}) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: repositoryRoot,
      env: { ...process.env, ...options.env },
      stdio: options.quiet ? "ignore" : "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`COMMAND_FAILED:${args.join(" ")}:${code ?? signal ?? "unknown"}`));
    });
  });
}

export function runPrismaCommand(args: string[], env: Record<string, string | undefined>) {
  return runExecutable(process.execPath, [path.join(repositoryRoot, "node_modules", "prisma", "build", "index.js"), ...args], { env });
}

function prismaSchemaState() {
  const hash = createHash("sha256");
  for (const filename of ["package.json", path.join("prisma", "schema.prisma")]) {
    hash.update(filename);
    hash.update(readFileSync(path.join(repositoryRoot, filename)));
  }
  return hash.digest("hex");
}

export async function initializeRuntime(options: { seedIfEmpty?: boolean; forceGenerate?: boolean } = {}) {
  const paths = await ensureRuntimeLayout(getRuntimePaths());
  const runtimeEnv = {
    ...process.env,
    LANTERN_DATA_DIR: paths.dataDir,
    DATABASE_URL: paths.databaseUrl,
    RUST_LOG: process.env.RUST_LOG || "info",
  };
  process.env.LANTERN_DATA_DIR = paths.dataDir;
  process.env.DATABASE_URL = paths.databaseUrl;
  process.env.RUST_LOG ||= "info";

  const generatedStateFile = path.join(repositoryRoot, "node_modules", ".lantern-prisma-schema-state");
  const expectedSchemaState = prismaSchemaState();
  const generatedSchemaState = existsSync(generatedStateFile) ? readFileSync(generatedStateFile, "utf8").trim() : undefined;
  if (options.forceGenerate || generatedSchemaState !== expectedSchemaState) {
    await runPrismaCommand(["generate"], runtimeEnv);
    writeFileSync(generatedStateFile, `${expectedSchemaState}\n`, { encoding: "utf8", mode: 0o600 });
  }
  await runPrismaCommand(["migrate", "deploy"], runtimeEnv);

  const { initializeDatabaseConnection, prisma } = await import("../packages/server/src/db");
  await initializeDatabaseConnection();
  try {
    if (options.seedIfEmpty !== false) {
      const { initializeStarterData } = await import("./starter-data");
      await initializeStarterData(paths);
    }
  } finally {
    await prisma.$disconnect();
  }
  return paths;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  initializeRuntime()
    .then((paths) => console.log(`Lantern runtime ready: ${paths.dataDir}`))
    .catch((error) => {
      console.error(error instanceof Error ? error.stack ?? error.message : error);
      process.exitCode = 1;
    });
}

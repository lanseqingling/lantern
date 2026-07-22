import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ensureRuntimeLayout } from "@lantern/server/local-runtime";
import { getRuntimePaths } from "@lantern/server/runtime-paths";
import { prismaClientReady, prismaSchemaState, recordPrismaClientState } from "./prisma-client-state.mjs";

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function pnpmCli() {
  const inherited = process.env.npm_execpath;
  if (inherited && /pnpm(?:\.cjs)?$/i.test(inherited)) return inherited;
  return path.join(repositoryRoot, "node_modules", "pnpm", "bin", "pnpm.cjs");
}

export function runCommand(args: string[], options: { env?: Record<string, string | undefined>; quiet?: boolean } = {}) {
  return runExecutable(process.execPath, [pnpmCli(), ...args], options);
}

export function runNodeCommand(args: string[], options: { env?: Record<string, string | undefined>; quiet?: boolean } = {}) {
  return runExecutable(process.execPath, args, options);
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

  const expectedSchemaState = prismaSchemaState(repositoryRoot);
  if (options.forceGenerate || !prismaClientReady(repositoryRoot, expectedSchemaState)) {
    await runPrismaCommand(["generate"], runtimeEnv);
    recordPrismaClientState(repositoryRoot, expectedSchemaState);
  }
  await runPrismaCommand(["migrate", "deploy"], runtimeEnv);

  const { initializeDatabaseConnection, prisma } = await import("@lantern/server/db");
  await initializeDatabaseConnection();
  try {
    if (options.seedIfEmpty !== false) {
      const { initializeInitialData } = await import("./starter-data");
      await initializeInitialData(paths);
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

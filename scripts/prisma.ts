import { pathToFileURL } from "node:url";
import { ensureRuntimeLayout } from "@lantern/server/local-runtime";
import { getRuntimePaths } from "@lantern/server/runtime-paths";
import { runPrismaCommand } from "./runtime-init";

export async function runPrismaForLocalRuntime(args: string[]) {
  const paths = await ensureRuntimeLayout(getRuntimePaths());
  const env = {
    ...process.env,
    LANTERN_DATA_DIR: paths.dataDir,
    DATABASE_URL: paths.databaseUrl,
    RUST_LOG: process.env.RUST_LOG || "info",
  };
  await runPrismaCommand(args, env);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPrismaForLocalRuntime(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}

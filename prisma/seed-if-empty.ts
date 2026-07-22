import { initializeDatabaseConnection, prisma } from "@lantern/server/db";
import { ensureRuntimeLayout } from "@lantern/server/local-runtime";
import { getRuntimePaths } from "@lantern/server/runtime-paths";
import { initializeInitialData } from "../scripts/starter-data";

try {
  const paths = await ensureRuntimeLayout(getRuntimePaths());
  await initializeDatabaseConnection();
  const result = await initializeInitialData(paths);
  console.log(result === "skipped" || result === "complete"
    ? "Lantern database already contains initialized data."
    : `Lantern initial data ${result}.`);
} finally {
  await prisma.$disconnect();
}

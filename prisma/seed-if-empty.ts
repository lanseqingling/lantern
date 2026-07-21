import { initializeDatabaseConnection, prisma } from "../packages/server/src/db";
import { ensureRuntimeLayout } from "../packages/server/src/local-runtime";
import { getRuntimePaths } from "../packages/server/src/runtime-paths";
import { initializeStarterData } from "../scripts/starter-data";

try {
  const paths = await ensureRuntimeLayout(getRuntimePaths());
  await initializeDatabaseConnection();
  const result = await initializeStarterData(paths);
  console.log(result === "skipped" || result === "complete"
    ? "Lantern database already contains initialized data; starter initialization skipped."
    : `Lantern starter data ${result}.`);
} finally {
  await prisma.$disconnect();
}

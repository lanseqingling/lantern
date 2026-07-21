import { getConfig } from "@lantern/server/config";
import { initializeDatabaseConnection, prisma } from "@lantern/server/db";
import { localTaskRunner } from "@lantern/agent-runtime/local-task-runner";
import { createApiApp } from "./app";

const config = getConfig();
const app = await createApiApp();

await initializeDatabaseConnection();
await localTaskRunner.start();

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "Lantern API stopping");
  await localTaskRunner.stop();
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("message", (message) => {
  if (typeof message === "object" && message !== null && "type" in message && message.type === "lantern:shutdown") {
    void shutdown("IPC");
  }
});

await app.listen({ port: config.API_PORT, host: "127.0.0.1" });

import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { getConfig } from "../../../packages/server/src/config";
import { initializeDatabaseConnection, prisma } from "../../../packages/server/src/db";
import { localTaskRunner } from "../../../packages/agent-runtime/src/local-task-runner";
import { installErrorHandler } from "./http";
import { registerAgentRoutes } from "./routes/agent";
import { registerAssetRoutes } from "./routes/assets";
import { registerComicRoutes } from "./routes/comics";
import { registerExportRoutes } from "./routes/export";
import { registerSystemRoutes } from "./routes/system";
import { registerWorkbenchRoutes } from "./routes/workbench";

const config = getConfig();
const app = Fastify({
  bodyLimit: 60 * 1024 * 1024,
  logger: { redact: ["req.headers.authorization", "req.body.input", "req.body.contextSnapshot"] },
});

const loopbackWebOriginPattern = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\]):\d+$/;

await app.register(cors, {
  origin: config.APP_ENV === "test" ? loopbackWebOriginPattern : config.WEB_ORIGIN,
  credentials: true,
  methods: ["GET", "HEAD", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
});
await app.register(multipart, { limits: { files: 1, fileSize: 50 * 1024 * 1024, fields: 12 } });

installErrorHandler(app);
registerSystemRoutes(app);
registerComicRoutes(app);
registerAssetRoutes(app);
registerWorkbenchRoutes(app);
registerAgentRoutes(app);
registerExportRoutes(app);

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

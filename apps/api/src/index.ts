import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { getConfig } from "../../../packages/server/src/config";
import { prisma } from "../../../packages/server/src/db";
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

const localWebOriginPattern = /^http:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}):\d+$/;

await app.register(cors, {
  origin: config.APP_ENV === "local" ? localWebOriginPattern : config.WEB_ORIGIN,
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

async function shutdown(signal: string) {
  app.log.info({ signal }, "Lantern API stopping");
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ port: config.API_PORT, host: "0.0.0.0" });

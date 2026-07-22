import Fastify, { type FastifyServerOptions } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { getConfig } from "@lantern/server/config";
import { installErrorHandler } from "./http";
import { registerAgentRoutes } from "./routes/agent";
import { registerAssetRoutes } from "./routes/assets";
import { registerComicRoutes } from "./routes/comics";
import { registerExportRoutes } from "./routes/export";
import { registerMcpRoutes } from "./routes/mcp";
import { registerSystemRoutes } from "./routes/system";
import { registerWorkbenchRoutes } from "./routes/workbench";

const loopbackWebOriginPattern = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\]):\d+$/;

const defaultLogger: FastifyServerOptions["logger"] = {
  redact: ["req.headers.authorization", "req.body.input", "req.body.contextSnapshot"],
};

export async function createApiApp(options: { logger?: FastifyServerOptions["logger"] } = {}) {
  const config = getConfig();
  const app = Fastify({
    bodyLimit: 60 * 1024 * 1024,
    logger: options.logger ?? defaultLogger,
  });

  await app.register(cors, {
    origin: config.APP_ENV === "test" ? loopbackWebOriginPattern : config.WEB_ORIGIN,
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  });
  await app.register(multipart, { limits: { files: 1, fileSize: 50 * 1024 * 1024, fields: 12 } });
  for (const contentType of ["image/png", "image/jpeg", "image/webp"]) {
    app.addContentTypeParser(contentType, { parseAs: "buffer" }, (_request, body, done) => done(null, body));
  }

  installErrorHandler(app);
  registerSystemRoutes(app);
  registerComicRoutes(app);
  registerAssetRoutes(app);
  registerWorkbenchRoutes(app);
  registerAgentRoutes(app);
  registerExportRoutes(app);
  registerMcpRoutes(app);

  return app;
}

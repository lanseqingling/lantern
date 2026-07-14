import type { FastifyInstance } from "fastify";
import { getConfig } from "../../../../packages/server/src/config";
import { prisma } from "../../../../packages/server/src/db";
import { currentUser, ok } from "../http";

const config = getConfig();

export function registerSystemRoutes(app: FastifyInstance) {
  app.get("/health", async (request) => {
    await prisma.$queryRaw`SELECT 1`;
    return ok(request, { status: "ok", database: "ok", queue: "configured", objectStorage: config.OBJECT_STORAGE_DRIVER });
  });

  app.get("/v1/auth/me", async (request) => ok(request, await currentUser(request)));
}

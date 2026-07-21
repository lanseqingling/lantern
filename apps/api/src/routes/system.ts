import type { FastifyInstance } from "fastify";
import { prisma } from "@lantern/server/db";
import { localTaskRunner } from "@lantern/agent-runtime/local-task-runner";
import { currentUser, ok } from "../http";

export function registerSystemRoutes(app: FastifyInstance) {
  app.get("/health", async (request) => {
    await prisma.$queryRaw`SELECT 1`;
    return ok(request, { status: "ok", database: "ok", taskRunner: localTaskRunner.getState(), objectStorage: "local" });
  });

  app.get("/v1/auth/me", async (request) => ok(request, await currentUser(request)));
}

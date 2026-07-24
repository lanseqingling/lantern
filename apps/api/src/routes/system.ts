import type { FastifyInstance } from "fastify";
import { prisma } from "@lantern/server/db";
import { localTaskRunner } from "@lantern/agent-runtime/local-task-runner";
import { getGlobalSettings, updateGlobalSettings, updateSettingsSchema } from "@lantern/server/settings-service";
import { checkForUpdateInBackground, getUpdateInstallStatus, getUpdateStatus, installAvailableUpdate } from "@lantern/server/update-service";
import { currentUser, ok } from "../http";

export function registerSystemRoutes(app: FastifyInstance) {
  checkForUpdateInBackground();
  app.get("/health", async (request) => {
    await prisma.$queryRaw`SELECT 1`;
    return ok(request, { status: "ok", database: "ok", taskRunner: localTaskRunner.getState(), objectStorage: "local" });
  });

  app.get("/v1/auth/me", async (request) => ok(request, await currentUser(request)));

  app.get("/v1/settings", async (request) => {
    await currentUser(request);
    return ok(request, getGlobalSettings());
  });

  app.patch("/v1/settings", async (request) => {
    await currentUser(request);
    return ok(request, await updateGlobalSettings(updateSettingsSchema.parse(request.body)));
  });

  app.get("/v1/update", async (request) => {
    await currentUser(request);
    return ok(request, await getUpdateStatus(request.query !== undefined && (request.query as { refresh?: string }).refresh === "1"));
  });

  app.post("/v1/update/install", async (request) => {
    await currentUser(request);
    return ok(request, await installAvailableUpdate());
  });

  app.get("/v1/update/install/status", async (request) => {
    await currentUser(request);
    return ok(request, await getUpdateInstallStatus());
  });
}

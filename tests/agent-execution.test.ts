import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerAgentRoutes } from "../apps/api/src/routes/agent";
import { installErrorHandler } from "../apps/api/src/http";
import { assertTaskCreationAllowed, type CreateTaskInput } from "../packages/agent-runtime/src/task-service";

test("the frozen Agent interaction entry rejects work before touching conversation state", async () => {
  const app = Fastify({ logger: false });
  installErrorHandler(app);
  registerAgentRoutes(app);

  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/conversations/missing/interactions",
      payload: {},
    });

    assert.equal(response.statusCode, 503);
    assert.equal(response.json().error.code, "agent_execution_disabled");
  } finally {
    await app.close();
  }
});

test("legacy AI task creation is rejected while deterministic export remains available", () => {
  const legacyTaskTypes: CreateTaskInput["taskType"][] = [
    "storyboard",
    "page_layout",
    "frame_image_generate",
    "frame_image_refine",
    "asset_parse",
    "dialogue",
  ];

  for (const taskType of legacyTaskTypes) {
    assert.throws(
      () => assertTaskCreationAllowed(taskType),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "agent_execution_disabled",
    );
  }
  assert.doesNotThrow(() => assertTaskCreationAllowed("export"));
});

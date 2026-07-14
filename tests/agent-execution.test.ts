import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerAgentRoutes } from "../apps/api/src/routes/agent";
import { installErrorHandler } from "../apps/api/src/http";
import { resetConfigForTests } from "../packages/server/src/config";

test("the frozen Agent interaction entry rejects work before touching conversation state", async () => {
  const previousMode = process.env.AGENT_EXECUTION_MODE;
  process.env.AGENT_EXECUTION_MODE = "disabled";
  resetConfigForTests();

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
    if (previousMode === undefined) delete process.env.AGENT_EXECUTION_MODE;
    else process.env.AGENT_EXECUTION_MODE = previousMode;
    resetConfigForTests();
  }
});

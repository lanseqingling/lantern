import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerAgentRoutes } from "../apps/api/src/routes/agent";
import { installErrorHandler } from "../apps/api/src/http";
import { enforceSafetyDecision } from "../packages/agent-runtime/src/orchestrator";
import { assetDraftSchema } from "../packages/agent-runtime/src/schemas";
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

test("asset drafts use type, name and description as the complete semantic contract", () => {
  assert.deepEqual(assetDraftSchema.parse({ kind: "character", name: "林澄", description: "肩长黑发，穿浅色风衣，神态克制。" }), {
    kind: "character",
    name: "林澄",
    description: "肩长黑发，穿浅色风衣，神态克制。",
  });
  assert.throws(() => assetDraftSchema.parse({
    kind: "character",
    name: "林澄",
    description: "角色描述",
    attributes: { outfit: "浅色风衣" },
  }));
});

test("the asset work focus routes generation to an asset candidate without encoding a subtype", () => {
  const decision = enforceSafetyDecision({
    message: "根据这些参考整理一个可复用设定",
    intent: "资产",
    scope: "当前漫画资产",
    selection: { type: "none" },
    contextSummary: {},
  }, {
    kind: "ready_to_run",
    message: "我会先生成候选。",
    scope: "current_page",
    taskType: "storyboard",
  });

  assert.deepEqual(decision, {
    kind: "ready_to_run",
    message: "我会先按当前描述生成可编辑的资产候选；细节可以在资产画布中继续完善。",
    scope: "reference_only",
    taskType: "asset_parse",
  });
});

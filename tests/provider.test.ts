import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { DeepSeekProvider } from "@lantern/agent-runtime/providers/deepseek";
import { QwenImageProvider } from "@lantern/agent-runtime/providers/qwen-image";
import { QwenVisionProvider } from "@lantern/agent-runtime/providers/qwen-vision";
import { planInteraction } from "@lantern/agent-runtime/orchestrator";
import { resetConfigForTests } from "@lantern/server/config";

test("DeepSeek adapter sends V4 JSON mode and validates the response", async () => {
  const originalFetch = globalThis.fetch;
  process.env.TEXT_MODEL_PROVIDER = "deepseek";
  process.env.TEXT_MODEL_API_KEY = "test-key";
  process.env.TEXT_MODEL_NAME = "deepseek-v4-flash";
  resetConfigForTests();
  let requestBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: "{\"ok\":true}" } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const result = await new DeepSeekProvider().generateJson({ schema: z.object({ ok: z.boolean() }), system: "test", user: "test" });
    assert.deepEqual(result, { ok: true });
    assert.equal(requestBody?.model, "deepseek-v4-flash");
    assert.deepEqual(requestBody?.response_format, { type: "json_object" });
    assert.deepEqual(requestBody?.thinking, { type: "disabled" });
  } finally {
    globalThis.fetch = originalFetch;
    resetConfigForTests();
  }
});

test("DeepSeek adapter repairs one invalid structured response before failing the turn", async () => {
  const originalFetch = globalThis.fetch;
  process.env.TEXT_MODEL_PROVIDER = "deepseek";
  process.env.TEXT_MODEL_API_KEY = "test-key";
  resetConfigForTests();
  const requestBodies: Array<{ messages?: Array<{ role?: string; content?: string }> }> = [];
  globalThis.fetch = async (_input, init) => {
    requestBodies.push(JSON.parse(String(init?.body)));
    const content = requestBodies.length === 1 ? "{\"ok\":\"yes\"}" : "{\"ok\":true}";
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const result = await new DeepSeekProvider().generateJson({ schema: z.object({ ok: z.boolean() }), system: "test", user: "test" });
    assert.deepEqual(result, { ok: true });
    assert.equal(requestBodies.length, 2);
    assert.equal(requestBodies[1].messages?.at(-2)?.role, "assistant");
    assert.match(requestBodies[1].messages?.at(-1)?.content ?? "", /未通过结构校验/);
  } finally {
    globalThis.fetch = originalFetch;
    resetConfigForTests();
  }
});

test("the universal Planner receives context and returns a guarded interaction plan", async () => {
  const originalFetch = globalThis.fetch;
  process.env.TEXT_MODEL_PROVIDER = "deepseek";
  process.env.TEXT_MODEL_API_KEY = "test-key";
  resetConfigForTests();
  const requestBodies: Array<{ messages?: Array<{ role?: string; content?: string }>; response_format?: unknown }> = [];
  globalThis.fetch = async (_input, init) => {
    requestBodies.push(JSON.parse(String(init?.body)));
    const content = JSON.stringify({
      outcome: "respond",
      requestType: "conversation",
      goal: "比较画格与对白的情绪衔接",
      message: "第二格延续了第一格的克制情绪，但对白转折略快，可以增加一个停顿。",
      evidenceHandles: ["ref:0"],
      confidence: 0.94,
    });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const result = await planInteraction({
      message: "比较这两个画格和对白的情绪衔接",
      intent: "创作",
      scope: "仅图片",
      selection: { type: "none" },
      contextSummary: {
        currentView: { unitIds: ["page-01", "page-02"], label: "Page 01–02", physicalPageNumbers: [1, 2] },
        explicitComicFrameReferences: [{ frameId: "frame-1", storyboardBeat: { description: "男主沉默地看向窗外。" } }],
        explicitDialogueReferences: [{ text: "我没事。" }],
      },
    });
    assert.deepEqual(result.route, {
      kind: "decision",
      decision: {
        kind: "direct_answer",
        message: "第二格延续了第一格的克制情绪，但对白转折略快，可以增加一个停顿。",
      },
    });
    assert.equal(requestBodies.length, 1);
    assert.deepEqual(requestBodies[0].response_format, { type: "json_object" });
    assert.match(requestBodies[0].messages?.[0]?.content ?? "", /Capability catalog/);
    assert.match(requestBodies[0].messages?.[0]?.content ?? "", /storyboard\.edit_single_entry/);
    assert.match(requestBodies[0].messages?.[0]?.content ?? "", /必须选择 unsupported/);
    assert.match(requestBodies[0].messages?.[1]?.content ?? "", /"workspaceView":\{"unitIds":\["page-01","page-02"\],"label":"Page 01–02"/);
    assert.equal(result.trace.prompt.id, "lantern.agent.planner");
    assert.equal(result.trace.prompt.version, "1.3.0");
    assert.equal(result.trace.prompt.contextPolicyVersion, "interaction-context-v3");
    assert.equal(result.trace.prompt.outputSchemaVersion, "interaction-plan-v2");
  } finally {
    globalThis.fetch = originalFetch;
    resetConfigForTests();
  }
});

test("Qwen adapter uses non-Pro qwen-image-2.0 and downloads the temporary output", async () => {
  const originalFetch = globalThis.fetch;
  process.env.IMAGE_MODEL_PROVIDER = "qwen";
  process.env.IMAGE_MODEL_API_KEY = "test-key";
  process.env.IMAGE_MODEL_NAME = "qwen-image-2.0";
  resetConfigForTests();
  let call = 0;
  let requestBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => {
    call += 1;
    if (call === 1) {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ output: { choices: [{ message: { content: [{ image: "https://temporary.example/result.png" }] } }] }, request_id: "qwen-test" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(Buffer.from([137, 80, 78, 71]), { status: 200, headers: { "Content-Type": "image/png" } });
  };
  try {
    const result = await new QwenImageProvider().generate({ prompt: "漫画格", size: "512*512" });
    assert.equal(requestBody?.model, "qwen-image-2.0");
    assert.equal(result.requestId, "qwen-test");
    assert.equal(result.contentType, "image/png");
  } finally {
    globalThis.fetch = originalFetch;
    resetConfigForTests();
  }
});

test("Qwen Vision adapter sends uploaded image data as multimodal evidence", async () => {
  const originalFetch = globalThis.fetch;
  process.env.IMAGE_MODEL_API_KEY = "test-key";
  process.env.VISION_MODEL_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
  process.env.VISION_MODEL_NAME = "qwen3.6-flash";
  resetConfigForTests();
  let requestBody: {
    model?: string;
    messages?: Array<{ role?: string; content?: string | Array<{ type?: string; text?: string; image_url?: { url?: string } }> }>;
  } | undefined;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: "图片中写着：今晚七点，旧站见。" } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const result = await new QwenVisionProvider().analyze({
      question: "这张图说了啥",
      imageUrls: ["data:image/png;base64,aW1hZ2U="],
    });
    assert.equal(result, "图片中写着：今晚七点，旧站见。");
    assert.equal(requestBody?.model, "qwen3.6-flash");
    const content = requestBody?.messages?.[1]?.content;
    assert.ok(Array.isArray(content));
    assert.match(content[0]?.text ?? "", /这张图说了啥/);
    assert.deepEqual(content[1], { type: "image_url", image_url: { url: "data:image/png;base64,aW1hZ2U=" } });
  } finally {
    globalThis.fetch = originalFetch;
    resetConfigForTests();
  }
});

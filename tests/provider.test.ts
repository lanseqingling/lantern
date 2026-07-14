import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { DeepSeekProvider } from "../packages/agent-runtime/src/providers/deepseek";
import { QwenImageProvider } from "../packages/agent-runtime/src/providers/qwen-image";
import { resetConfigForTests } from "../packages/server/src/config";

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

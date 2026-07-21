import { z } from "zod";
import { DeepSeekProvider } from "@lantern/agent-runtime/providers/deepseek";
import { QwenImageProvider } from "@lantern/agent-runtime/providers/qwen-image";

async function main() {
  const textStartedAt = Date.now();
  const text = await new DeepSeekProvider().generateJson({
    schema: z.object({ ok: z.literal(true), summary: z.string().min(1).max(80) }),
    system: "你是 Lantern AI Provider 连通性探针。",
    user: "只返回 JSON：{\"ok\":true,\"summary\":\"文本模型连接正常\"}",
    maxTokens: 80,
  });
  console.log(JSON.stringify({ provider: "deepseek", ok: text.ok, latencyMs: Date.now() - textStartedAt, summary: text.summary }));

  const imageStartedAt = Date.now();
  const image = await new QwenImageProvider().generate({
    prompt: "极简黑白漫画图标，一盏小台灯，白色背景，日式轻线条，不要文字，只用于 API 连通性测试。",
    size: "1024*1024",
    seed: 20260712,
  });
  console.log(JSON.stringify({
    provider: "qwen-image-2.0",
    ok: image.bytes.length > 0,
    latencyMs: Date.now() - imageStartedAt,
    requestId: image.requestId,
    contentType: image.contentType,
    byteSize: image.bytes.length,
  }));

  const refineStartedAt = Date.now();
  const refined = await new QwenImageProvider().generate({
    prompt: "保留参考图中台灯的主体轮廓和黑白轻线条，只在背景增加少量斜向雨线，不要文字。",
    referenceUrls: [`data:${image.contentType};base64,${image.bytes.toString("base64")}`],
    size: "1024*1024",
    seed: 20260713,
  });
  console.log(JSON.stringify({
    provider: "qwen-image-2.0-refine",
    ok: refined.bytes.length > 0,
    latencyMs: Date.now() - refineStartedAt,
    requestId: refined.requestId,
    contentType: refined.contentType,
    byteSize: refined.bytes.length,
  }));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Provider probe failed";
  console.error(JSON.stringify({ ok: false, message }));
  process.exitCode = 1;
});

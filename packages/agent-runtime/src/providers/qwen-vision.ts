import { getConfig } from "@lantern/server/config";
import { AppError, providerConfigurationError, safeProviderError } from "@lantern/server/errors";

export type QwenVisionRequest = {
  question: string;
  imageUrls: string[];
  maxTokens?: number;
};

export class QwenVisionProvider {
  readonly name = "qwen-vision";

  async analyze(request: QwenVisionRequest) {
    const config = getConfig();
    if (config.VISION_MODEL_PROVIDER === "test") throw new Error("VISION_PROVIDER_IS_TEST_ADAPTER");
    if (config.VISION_MODEL_PROVIDER !== "qwen") throw new AppError("unsupported_model_provider", "当前版本尚未接入所选视觉理解模型提供方。", 400);
    const apiKey = config.VISION_MODEL_API_KEY ?? config.IMAGE_MODEL_API_KEY;
    if (!apiKey) throw providerConfigurationError("vision");
    if (!request.imageUrls.length) throw new Error("VISION_INPUT_MISSING");

    try {
      const response = await fetch(`${config.VISION_MODEL_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: config.VISION_MODEL_NAME,
          messages: [
            {
              role: "system",
              content: "你是 Lantern Agent 的只读视觉分析器。只记录本轮图片中可见的对象、人物、构图、风格和文字，准确抄录能辨认的文字，并明确说明看不清或无法确定的部分。不要回答图片之外的问题，不要引用漫画故事、当前画格或历史对话补全图片。输出将作为 Planner 的 Observation。",
            },
            {
              role: "user",
              content: [
                { type: "text", text: `用户本轮目标：${request.question}\n请提供与该目标相关的视觉观察，不要猜测图片外的信息。` },
                ...request.imageUrls.slice(0, 3).map((url) => ({ type: "image_url", image_url: { url } })),
              ],
            },
          ],
          enable_thinking: false,
          max_tokens: request.maxTokens ?? 1600,
          temperature: 0.2,
          stream: false,
        }),
        signal: AbortSignal.timeout(90_000),
      });
      const body = await response.json() as {
        choices?: Array<{ message?: { content?: string } }>;
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(body.error?.message ?? `Qwen Vision HTTP ${response.status}`);
      const content = body.choices?.[0]?.message?.content?.trim();
      if (!content) throw new Error("Qwen Vision returned empty content");
      return content;
    } catch (error) {
      throw safeProviderError(error);
    }
  }
}

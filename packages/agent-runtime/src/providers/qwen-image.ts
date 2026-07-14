import { getConfig } from "../../../server/src/config";
import { safeProviderError } from "../../../server/src/errors";

export type QwenImageRequest = {
  prompt: string;
  referenceUrls?: string[];
  size?: string;
  negativePrompt?: string;
  seed?: number;
};

export type QwenImageResult = {
  requestId: string;
  bytes: Buffer;
  contentType: string;
  width?: number;
  height?: number;
};

export class QwenImageProvider {
  readonly name = "qwen";

  async generate(request: QwenImageRequest): Promise<QwenImageResult> {
    const config = getConfig();
    if (config.IMAGE_MODEL_PROVIDER === "test") throw new Error("IMAGE_PROVIDER_IS_TEST_ADAPTER");
    if (!config.IMAGE_MODEL_API_KEY) throw new Error("IMAGE_MODEL_API_KEY_MISSING");
    const content = [
      ...(request.referenceUrls ?? []).slice(0, 3).map((image) => ({ image })),
      { text: request.prompt },
    ];

    try {
      const response = await fetch(`${config.IMAGE_MODEL_BASE_URL.replace(/\/$/, "")}/services/aigc/multimodal-generation/generation`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.IMAGE_MODEL_API_KEY}`,
        },
        body: JSON.stringify({
          model: config.IMAGE_MODEL_NAME,
          input: { messages: [{ role: "user", content }] },
          parameters: {
            n: 1,
            negative_prompt: request.negativePrompt ?? "低分辨率，肢体畸形，手指畸形，角色身份漂移，构图混乱，水印，文字乱码",
            prompt_extend: false,
            watermark: false,
            size: request.size ?? "1024*1024",
            ...(request.seed === undefined ? {} : { seed: request.seed }),
          },
        }),
        signal: AbortSignal.timeout(180_000),
      });
      const body = await response.json() as {
        output?: { choices?: Array<{ message?: { content?: Array<{ image?: string }> } }> };
        request_id?: string;
        code?: string;
        message?: string;
      };
      if (!response.ok || body.code) throw new Error(body.message ?? body.code ?? `Qwen HTTP ${response.status}`);
      const imageUrl = body.output?.choices?.[0]?.message?.content?.find((item) => item.image)?.image;
      if (!imageUrl) throw new Error("Qwen returned no image");

      const imageResponse = await fetch(imageUrl, { signal: AbortSignal.timeout(90_000) });
      if (!imageResponse.ok) throw new Error(`Qwen output download HTTP ${imageResponse.status}`);
      return {
        requestId: body.request_id ?? "unknown",
        bytes: Buffer.from(await imageResponse.arrayBuffer()),
        contentType: imageResponse.headers.get("content-type") ?? "image/png",
      };
    } catch (error) {
      throw safeProviderError(error);
    }
  }
}

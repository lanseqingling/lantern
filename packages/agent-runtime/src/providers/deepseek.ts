import { ZodError, type z } from "zod";
import { getConfig } from "../../../server/src/config";
import { AppError, safeProviderError } from "../../../server/src/errors";

type JsonRequest<T extends z.ZodType> = {
  schema: T;
  system: string;
  user: string;
  maxTokens?: number;
};

function parseJsonContent(content: string) {
  const trimmed = content.trim();
  const unfenced = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
    : trimmed;
  return JSON.parse(unfenced) as unknown;
}

export class DeepSeekProvider {
  readonly name = "deepseek";

  async generateJson<T extends z.ZodType>(request: JsonRequest<T>): Promise<z.infer<T>> {
    const config = getConfig();
    if (config.TEXT_MODEL_PROVIDER === "test") throw new Error("TEXT_PROVIDER_IS_TEST_ADAPTER");
    if (!config.TEXT_MODEL_API_KEY) throw new Error("TEXT_MODEL_API_KEY_MISSING");

    try {
      const response = await fetch(`${config.TEXT_MODEL_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.TEXT_MODEL_API_KEY}`,
        },
        body: JSON.stringify({
          model: config.TEXT_MODEL_NAME,
          messages: [
            { role: "system", content: `${request.system}\nYou must return one valid JSON object and no markdown.` },
            { role: "user", content: request.user },
          ],
          thinking: { type: "disabled" },
          response_format: { type: "json_object" },
          max_tokens: request.maxTokens ?? 2400,
          temperature: 0.5,
          stream: false,
        }),
        signal: AbortSignal.timeout(90_000),
      });
      const body = await response.json() as {
        choices?: Array<{ message?: { content?: string } }>;
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(body.error?.message ?? `DeepSeek HTTP ${response.status}`);
      const content = body.choices?.[0]?.message?.content;
      if (!content) throw new Error("DeepSeek returned empty JSON content");
      return request.schema.parse(parseJsonContent(content));
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) {
        if (error instanceof ZodError) {
          console.warn("DeepSeek JSON contract rejected", error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.code, message: issue.message })));
        } else {
          console.warn("DeepSeek returned invalid JSON syntax");
        }
        throw new AppError("invalid_model_output", "模型返回的结构未通过校验，已拒绝保存。", 502);
      }
      throw safeProviderError(error);
    }
  }
}

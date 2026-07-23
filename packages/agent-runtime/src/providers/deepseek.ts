import { ZodError, type z } from "zod";
import { getConfig } from "@lantern/server/config";
import { AppError, providerConfigurationError, safeProviderError } from "@lantern/server/errors";

type JsonRequest<T extends z.ZodType> = {
  schema: T;
  system: string;
  user: string;
  maxTokens?: number;
};

type TextRequest = {
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

function validationSummary(error: ZodError | SyntaxError) {
  if (error instanceof SyntaxError) return "返回内容不是合法 JSON";
  return error.issues.slice(0, 8).map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`).join("；");
}

export class DeepSeekProvider {
  readonly name = "deepseek";

  async generateJson<T extends z.ZodType>(request: JsonRequest<T>): Promise<z.infer<T>> {
    const config = getConfig();
    if (config.TEXT_MODEL_PROVIDER === "test") throw new Error("TEXT_PROVIDER_IS_TEST_ADAPTER");
    if (config.TEXT_MODEL_PROVIDER !== this.name) throw new AppError("unsupported_model_provider", "当前版本尚未接入所选对话模型提供方。", 400);
    if (!config.TEXT_MODEL_API_KEY) throw providerConfigurationError("text");

    const requestContent = async (repair?: { content: string; reason: string }) => {
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
            ...(repair ? [
              { role: "assistant", content: repair.content },
              { role: "user", content: `上一条输出未通过结构校验：${repair.reason}。请严格按照最初要求修正，只返回一个合法 JSON 对象，不要解释。` },
            ] : []),
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
      return content;
    };

    try {
      const content = await requestContent();
      try {
        return request.schema.parse(parseJsonContent(content));
      } catch (error) {
        if (!(error instanceof ZodError || error instanceof SyntaxError)) throw error;
        const reason = validationSummary(error);
        console.warn("DeepSeek JSON contract rejected; requesting one repair", reason);
        const repairedContent = await requestContent({ content, reason });
        try {
          return request.schema.parse(parseJsonContent(repairedContent));
        } catch (repairedError) {
          if (!(repairedError instanceof ZodError || repairedError instanceof SyntaxError)) throw repairedError;
          console.warn("DeepSeek repaired JSON contract rejected", validationSummary(repairedError));
          throw new AppError("invalid_model_output", "模型返回的结构未通过校验，已拒绝保存。", 502);
        }
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw safeProviderError(error);
    }
  }

  async generateText(request: TextRequest) {
    const config = getConfig();
    if (config.TEXT_MODEL_PROVIDER === "test") throw new Error("TEXT_PROVIDER_IS_TEST_ADAPTER");
    if (config.TEXT_MODEL_PROVIDER !== this.name) throw new AppError("unsupported_model_provider", "当前版本尚未接入所选对话模型提供方。", 400);
    if (!config.TEXT_MODEL_API_KEY) throw providerConfigurationError("text");
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
            { role: "system", content: request.system },
            { role: "user", content: request.user },
          ],
          thinking: { type: "disabled" },
          max_tokens: request.maxTokens ?? 1800,
          temperature: 0.6,
          stream: false,
        }),
        signal: AbortSignal.timeout(90_000),
      });
      const body = await response.json() as {
        choices?: Array<{ message?: { content?: string } }>;
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(body.error?.message ?? `DeepSeek HTTP ${response.status}`);
      const content = body.choices?.[0]?.message?.content?.trim();
      if (!content) throw new Error("DeepSeek returned empty text content");
      return content;
    } catch (error) {
      throw safeProviderError(error);
    }
  }
}

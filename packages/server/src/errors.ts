export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export function safeProviderError(error: unknown) {
  if (error instanceof AppError) return error;
  const message = error instanceof Error ? error.message : "Provider request failed";
  if (/balance|quota|insufficient|余额|额度/i.test(message)) return new AppError("provider_quota_exhausted", "模型额度不足，请补充额度后重试。", 429);
  if (/rate|429|limit/i.test(message)) return new AppError("rate_limited", "模型请求过于频繁，请稍后重试。", 429);
  return new AppError("provider_failed", "模型暂时不可用，旧内容未改变。", 502);
}

export function providerConfigurationError(capability: "text" | "image" | "vision") {
  const label = capability === "text" ? "对话模型" : capability === "image" ? "生图模型" : "视觉理解模型";
  return new AppError(
    "provider_not_configured",
    `请先在全局设置中配置${label} API Key。`,
    409,
    { capability, settingsUrl: "/settings?section=models" },
  );
}

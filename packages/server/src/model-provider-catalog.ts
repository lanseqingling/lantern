export type ModelCapability = "text" | "image" | "vision";

export type ModelProviderDefinition = {
  id: string;
  capability: ModelCapability;
  label: string;
  description: string;
  defaultBaseUrl: string;
  defaultModel: string;
};

export const modelProviderCatalog: readonly ModelProviderDefinition[] = [
  {
    id: "deepseek",
    capability: "text",
    label: "DeepSeek",
    description: "用于创作对话、理解指令与文字生成",
    defaultBaseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-v4-flash",
  },
  {
    id: "qwen",
    capability: "image",
    label: "通义千问",
    description: "用于生成漫画画面与资产图片",
    defaultBaseUrl: "https://dashscope.aliyuncs.com/api/v1",
    defaultModel: "qwen-image-2.0",
  },
  {
    id: "qwen",
    capability: "vision",
    label: "通义千问",
    description: "用于理解参考图片和画面内容",
    defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen3.6-flash",
  },
] as const;

export function modelProvidersFor(capability: ModelCapability) {
  return modelProviderCatalog.filter((provider) => provider.capability === capability);
}

export function defaultModelProvider(capability: ModelCapability) {
  const provider = modelProvidersFor(capability)[0];
  if (!provider) throw new Error(`MODEL_PROVIDER_CATALOG_EMPTY:${capability}`);
  return provider;
}

export function findModelProvider(capability: ModelCapability, providerId: string) {
  return modelProviderCatalog.find((provider) => provider.capability === capability && provider.id === providerId);
}

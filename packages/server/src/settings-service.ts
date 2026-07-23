import { readFile } from "node:fs/promises";
import { z } from "zod";
import { getConfig, reloadConfig } from "./config";
import { AppError } from "./errors";
import { findModelProvider, modelProvidersFor, type ModelCapability } from "./model-provider-catalog";
import { writeRestrictedRuntimeFile } from "./local-runtime";
import { getRuntimePaths } from "./runtime-paths";

const capabilityConfig = {
  text: {
    label: "对话模型",
    description: "用于创作对话、意图理解与文字生成。",
    providerKey: "TEXT_MODEL_PROVIDER",
    baseUrlKey: "TEXT_MODEL_BASE_URL",
    modelKey: "TEXT_MODEL_NAME",
    apiKeyKey: "TEXT_MODEL_API_KEY",
  },
  image: {
    label: "生图模型",
    description: "用于生成漫画画面与角色、场景等图片资产。",
    providerKey: "IMAGE_MODEL_PROVIDER",
    baseUrlKey: "IMAGE_MODEL_BASE_URL",
    modelKey: "IMAGE_MODEL_NAME",
    apiKeyKey: "IMAGE_MODEL_API_KEY",
  },
  vision: {
    label: "视觉理解模型",
    description: "用于理解参考图、已有画面与视觉内容。",
    providerKey: "VISION_MODEL_PROVIDER",
    baseUrlKey: "VISION_MODEL_BASE_URL",
    modelKey: "VISION_MODEL_NAME",
    apiKeyKey: "VISION_MODEL_API_KEY",
  },
} as const satisfies Record<ModelCapability, {
  label: string;
  description: string;
  providerKey: keyof ReturnType<typeof getConfig>;
  baseUrlKey: keyof ReturnType<typeof getConfig>;
  modelKey: keyof ReturnType<typeof getConfig>;
  apiKeyKey: keyof ReturnType<typeof getConfig>;
}>;

const capabilitySchema = z.enum(["text", "image", "vision"]);

export const updateSettingsSchema = z.object({
  models: z.array(z.object({
    capability: capabilitySchema,
    providerId: z.string().trim().min(1).max(80),
    baseUrl: z.string().trim().url().max(1000),
    model: z.string().trim().min(1).max(200),
    apiKey: z.union([z.string().trim().max(2000), z.null()]).optional(),
  })).min(1).max(3),
});

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

function environmentOverride(capability: ModelCapability) {
  if (process.env.LANTERN_PROVIDER_ENV_OVERRIDE !== "1") return false;
  const definition = capabilityConfig[capability];
  return [definition.providerKey, definition.baseUrlKey, definition.modelKey, definition.apiKeyKey]
    .some((key) => process.env[key] !== undefined);
}

function publicSettings() {
  const config = getConfig();
  const paths = getRuntimePaths();
  return {
    models: (Object.keys(capabilityConfig) as ModelCapability[]).map((capability) => {
      const definition = capabilityConfig[capability];
      const apiKey = config[definition.apiKeyKey];
      const usesFallbackKey = capability === "vision" && !apiKey && Boolean(config.IMAGE_MODEL_API_KEY);
      return {
        capability,
        label: definition.label,
        description: definition.description,
        providerId: config[definition.providerKey],
        baseUrl: config[definition.baseUrlKey],
        model: config[definition.modelKey],
        keyConfigured: (typeof apiKey === "string" && apiKey.length > 0) || usesFallbackKey,
        usesFallbackKey,
        environmentOverride: environmentOverride(capability),
        providerOptions: modelProvidersFor(capability).map((provider) => ({
          id: provider.id,
          label: provider.label,
          description: provider.description,
          defaultBaseUrl: provider.defaultBaseUrl,
          defaultModel: provider.defaultModel,
        })),
      };
    }),
    runtime: {
      dataDirectory: paths.dataDir,
      apiPort: config.API_PORT,
      webPort: config.WEB_PORT,
      objectStorage: "本地存储",
    },
  };
}

export function getGlobalSettings() {
  return publicSettings();
}

function quoteEnvValue(value: string) {
  return JSON.stringify(value);
}

function patchEnvironment(contents: string, updates: ReadonlyMap<string, string>) {
  const remaining = new Map(updates);
  const lines = contents.replace(/\r\n/g, "\n").split("\n");
  const next = lines.map((line) => {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=/);
    if (!match || !remaining.has(match[1])) return line;
    const value = remaining.get(match[1]) ?? "";
    remaining.delete(match[1]);
    return `${match[1]}=${quoteEnvValue(value)}`;
  });
  if (next.at(-1) === "") next.pop();
  for (const [key, value] of remaining) next.push(`${key}=${quoteEnvValue(value)}`);
  return `${next.join("\n")}\n`;
}

export async function updateGlobalSettings(input: UpdateSettingsInput) {
  const parsed = updateSettingsSchema.parse(input);
  const updates = new Map<string, string>();
  const seen = new Set<ModelCapability>();

  for (const model of parsed.models) {
    if (seen.has(model.capability)) throw new AppError("duplicate_model_capability", "同一种模型能力只能配置一次。");
    seen.add(model.capability);
    if (environmentOverride(model.capability)) {
      throw new AppError("settings_environment_override", `${capabilityConfig[model.capability].label}由启动环境变量管理，不能在设置页修改。`, 409);
    }
    if (!findModelProvider(model.capability, model.providerId)) {
      throw new AppError("unsupported_model_provider", "当前版本尚未接入所选模型提供方。", 400);
    }
    const definition = capabilityConfig[model.capability];
    updates.set(definition.providerKey, model.providerId);
    updates.set(definition.baseUrlKey, model.baseUrl);
    updates.set(definition.modelKey, model.model);
    if (model.apiKey !== undefined) updates.set(definition.apiKeyKey, model.apiKey ?? "");
  }

  const paths = getRuntimePaths();
  const current = await readFile(paths.providerConfigFile, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  await writeRestrictedRuntimeFile(paths.providerConfigFile, patchEnvironment(current, updates));
  reloadConfig();
  return publicSettings();
}

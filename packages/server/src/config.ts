import { readFileSync } from "node:fs";
import dotenv from "dotenv";
import { z } from "zod";
import { getRuntimePaths } from "./runtime-paths";
import { defaultModelProvider } from "./model-provider-catalog";

const defaultTextProvider = defaultModelProvider("text");
const defaultImageProvider = defaultModelProvider("image");
const defaultVisionProvider = defaultModelProvider("vision");

const optionalSecret = z.preprocess((value) => value === "" ? undefined : value, z.string().optional());
const modelEnvironmentKeys = [
  "TEXT_MODEL_PROVIDER",
  "TEXT_MODEL_BASE_URL",
  "TEXT_MODEL_NAME",
  "TEXT_MODEL_API_KEY",
  "IMAGE_MODEL_PROVIDER",
  "IMAGE_MODEL_BASE_URL",
  "IMAGE_MODEL_NAME",
  "IMAGE_MODEL_API_KEY",
  "VISION_MODEL_PROVIDER",
  "VISION_MODEL_BASE_URL",
  "VISION_MODEL_NAME",
  "VISION_MODEL_API_KEY",
] as const;
const runtimeConfigSchema = z.object({
  configVersion: z.number().int().positive().default(1),
  apiPort: z.number().int().positive(),
  webPort: z.number().int().positive(),
});

const envSchema = z.object({
  APP_ENV: z.enum(["local", "test", "production"]).default("local"),
  WEB_PORT: z.coerce.number().int().positive().default(18788),
  WEB_ORIGIN: z.string().default("http://localhost:18788"),
  API_PORT: z.coerce.number().int().positive().default(18787),
  LANTERN_LOCAL_TOKEN: z.string().min(32),
  LANTERN_MCP_TOKEN: z.string().min(32),
  TEXT_MODEL_PROVIDER: z.string().min(1).default(defaultTextProvider.id),
  TEXT_MODEL_BASE_URL: z.string().url().default(defaultTextProvider.defaultBaseUrl),
  TEXT_MODEL_NAME: z.string().min(1).default(defaultTextProvider.defaultModel),
  TEXT_MODEL_API_KEY: optionalSecret,
  IMAGE_MODEL_PROVIDER: z.string().min(1).default(defaultImageProvider.id),
  IMAGE_MODEL_BASE_URL: z.string().url().default(defaultImageProvider.defaultBaseUrl),
  IMAGE_MODEL_NAME: z.string().min(1).default(defaultImageProvider.defaultModel),
  IMAGE_MODEL_API_KEY: optionalSecret,
  VISION_MODEL_PROVIDER: z.string().min(1).default(defaultVisionProvider.id),
  VISION_MODEL_BASE_URL: z.string().url().default(defaultVisionProvider.defaultBaseUrl),
  VISION_MODEL_NAME: z.string().min(1).default(defaultVisionProvider.defaultModel),
  VISION_MODEL_API_KEY: optionalSecret,
});

export type LanternConfig = z.infer<typeof envSchema>;

let cachedConfig: LanternConfig | undefined;

function fileEnvironment(): Record<string, string | number | undefined> {
  const paths = getRuntimePaths();
  let runtime: z.infer<typeof runtimeConfigSchema> | undefined;
  let providers: Record<string, string> = {};
  let mcp: Record<string, string> = {};
  try {
    runtime = runtimeConfigSchema.parse(JSON.parse(readFileSync(paths.runtimeConfigFile, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(`Invalid Lantern runtime configuration at ${paths.runtimeConfigFile}`, { cause: error });
    }
  }
  try {
    providers = dotenv.parse(readFileSync(paths.providerConfigFile, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(`Unable to read Lantern provider configuration at ${paths.providerConfigFile}`, { cause: error });
    }
  }
  try {
    mcp = dotenv.parse(readFileSync(paths.mcpConfigFile, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(`Unable to read Lantern MCP configuration at ${paths.mcpConfigFile}`, { cause: error });
    }
  }
  return {
    ...(runtime ? { API_PORT: runtime.apiPort, WEB_PORT: runtime.webPort, WEB_ORIGIN: `http://localhost:${runtime.webPort}` } : {}),
    ...providers,
    ...mcp,
  };
}

export function getConfig() {
  const files = fileEnvironment();
  const merged: Record<string, string | number | undefined> = { ...files, ...process.env };
  if (process.env.LANTERN_PROVIDER_ENV_OVERRIDE !== "1" && merged.APP_ENV !== "test") {
    for (const key of modelEnvironmentKeys) {
      if (files[key] !== undefined) merged[key] = files[key];
    }
  }
  if (!process.env.WEB_ORIGIN && process.env.WEB_PORT) merged.WEB_ORIGIN = `http://localhost:${process.env.WEB_PORT}`;
  if (merged.APP_ENV === "test") {
    merged.LANTERN_LOCAL_TOKEN ??= "lantern-test-token-000000000000000000000000";
    merged.LANTERN_MCP_TOKEN ??= "lantern-test-mcp-token-00000000000000000000";
    merged.TEXT_MODEL_PROVIDER ??= "test";
    merged.IMAGE_MODEL_PROVIDER ??= "test";
    merged.VISION_MODEL_PROVIDER ??= "test";
  }
  cachedConfig ??= envSchema.parse(merged);
  return cachedConfig;
}

export function resetConfigForTests() {
  cachedConfig = undefined;
}

export function reloadConfig() {
  cachedConfig = undefined;
  return getConfig();
}

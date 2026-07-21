import { readFileSync } from "node:fs";
import dotenv from "dotenv";
import { z } from "zod";
import { getRuntimePaths } from "./runtime-paths";

const optionalSecret = z.preprocess((value) => value === "" ? undefined : value, z.string().optional());
const runtimeConfigSchema = z.object({
  apiPort: z.number().int().positive(),
  webPort: z.number().int().positive(),
});

const envSchema = z.object({
  APP_ENV: z.enum(["local", "test", "production"]).default("local"),
  WEB_PORT: z.coerce.number().int().positive().default(3000),
  WEB_ORIGIN: z.string().default("http://localhost:3000"),
  API_PORT: z.coerce.number().int().positive().default(18787),
  LANTERN_LOCAL_TOKEN: z.string().min(32),
  LANTERN_MCP_TOKEN: z.string().min(32),
  TEXT_MODEL_PROVIDER: z.enum(["deepseek", "test"]).default("deepseek"),
  TEXT_MODEL_BASE_URL: z.string().url().default("https://api.deepseek.com"),
  TEXT_MODEL_NAME: z.string().default("deepseek-v4-flash"),
  TEXT_MODEL_API_KEY: optionalSecret,
  IMAGE_MODEL_PROVIDER: z.enum(["qwen", "test"]).default("qwen"),
  IMAGE_MODEL_BASE_URL: z.string().url().default("https://dashscope.aliyuncs.com/api/v1"),
  IMAGE_MODEL_NAME: z.string().default("qwen-image-2.0"),
  IMAGE_MODEL_API_KEY: optionalSecret,
  VISION_MODEL_BASE_URL: z.string().url().default("https://dashscope.aliyuncs.com/compatible-mode/v1"),
  VISION_MODEL_NAME: z.string().default("qwen3.6-flash"),
  VISION_MODEL_API_KEY: optionalSecret,
});

export type LanternConfig = z.infer<typeof envSchema>;

let cachedConfig: LanternConfig | undefined;

function fileEnvironment() {
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
  const merged: Record<string, string | number | undefined> = { ...fileEnvironment(), ...process.env };
  if (!process.env.WEB_ORIGIN && process.env.WEB_PORT) merged.WEB_ORIGIN = `http://localhost:${process.env.WEB_PORT}`;
  if (merged.APP_ENV === "test") {
    merged.LANTERN_LOCAL_TOKEN ??= "lantern-test-token-000000000000000000000000";
    merged.LANTERN_MCP_TOKEN ??= "lantern-test-mcp-token-00000000000000000000";
    merged.TEXT_MODEL_PROVIDER ??= "test";
    merged.IMAGE_MODEL_PROVIDER ??= "test";
  }
  cachedConfig ??= envSchema.parse(merged);
  return cachedConfig;
}

export function resetConfigForTests() {
  cachedConfig = undefined;
}

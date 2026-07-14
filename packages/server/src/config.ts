import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  APP_ENV: z.enum(["local", "test", "production"]).default("local"),
  WEB_ORIGIN: z.string().default("http://localhost:3000"),
  API_PORT: z.coerce.number().int().positive().default(18787),
  DATABASE_URL: z.string().default("postgresql://lantern:lantern@localhost:54329/lantern?schema=public"),
  REDIS_URL: z.string().default("redis://localhost:56379"),
  OBJECT_STORAGE_DRIVER: z.literal("local").default("local"),
  OBJECT_STORAGE_LOCAL_DIR: z.string().default(".lantern-runtime/objects"),
  SESSION_SECRET: z.string().min(16).default("lantern-local-session-secret"),
  TEXT_MODEL_PROVIDER: z.enum(["deepseek", "test"]).default("test"),
  TEXT_MODEL_BASE_URL: z.string().url().default("https://api.deepseek.com"),
  TEXT_MODEL_NAME: z.string().default("deepseek-v4-flash"),
  TEXT_MODEL_API_KEY: z.string().optional(),
  IMAGE_MODEL_PROVIDER: z.enum(["qwen", "test"]).default("test"),
  IMAGE_MODEL_BASE_URL: z.string().url().default("https://dashscope.aliyuncs.com/api/v1"),
  IMAGE_MODEL_NAME: z.string().default("qwen-image-2.0"),
  IMAGE_MODEL_API_KEY: z.string().optional(),
  LANTERN_DEV_USER_EMAIL: z.string().email().default("creator@lantern.local"),
});

export type LanternConfig = z.infer<typeof envSchema>;

let cachedConfig: LanternConfig | undefined;

export function getConfig() {
  cachedConfig ??= envSchema.parse(process.env);
  if (cachedConfig.APP_ENV === "production" && cachedConfig.SESSION_SECRET === "lantern-local-session-secret") {
    throw new Error("SESSION_SECRET must be replaced in production");
  }
  if (cachedConfig.APP_ENV === "production" && cachedConfig.TEXT_MODEL_PROVIDER === "test") {
    throw new Error("TEXT_MODEL_PROVIDER=test is not allowed in production");
  }
  if (cachedConfig.APP_ENV === "production" && !cachedConfig.TEXT_MODEL_API_KEY) {
    throw new Error("TEXT_MODEL_API_KEY is required in production");
  }
  if (cachedConfig.APP_ENV === "production" && cachedConfig.IMAGE_MODEL_PROVIDER === "test") {
    throw new Error("IMAGE_MODEL_PROVIDER=test is not allowed in production");
  }
  if (cachedConfig.APP_ENV === "production" && !cachedConfig.IMAGE_MODEL_API_KEY) {
    throw new Error("IMAGE_MODEL_API_KEY is required in production");
  }
  return cachedConfig;
}

export function resetConfigForTests() {
  cachedConfig = undefined;
}

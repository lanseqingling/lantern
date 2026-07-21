import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    settings: {
      next: { rootDir: "apps/web/" },
      react: { version: "19.2.6" },
    },
    rules: {
      // Lantern renders user-owned, signed, blob, and data URLs at exact canvas
      // dimensions; routing them through Next Image would change that contract.
      "@next/next/no-img-element": "off",
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["**/packages/*/src", "**/packages/*/src/**", "@/packages/**"],
          message: "Import a declared @lantern/* package export instead of reaching into workspace source directories.",
        }],
      }],
    },
  },
  {
    files: ["apps/api/src/routes/**/*.ts"],
    ignores: ["apps/api/src/routes/system.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: [{ name: "@prisma/client", message: "API routes must call an application service instead of depending on Prisma models." }],
        patterns: [
          {
            group: ["**/packages/*/src", "**/packages/*/src/**", "@/packages/**"],
            message: "Import a declared @lantern/* package export instead of reaching into workspace source directories.",
          },
          { group: ["@lantern/server/db"], message: "API routes must call an application service instead of accessing Prisma directly." },
        ],
      }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "**/.next/**",
    "**/.vinext/**",
    "**/.vite/**",
    "**/dist/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;

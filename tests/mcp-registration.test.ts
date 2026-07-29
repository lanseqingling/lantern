import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

test("all Lantern MCP tools use the registration descriptor with an explicit activity policy", () => {
  const source = readFileSync(path.join(repositoryRoot, "apps/api/src/mcp/server.ts"), "utf8");
  const directSdkRegistrations = source.match(/\bserver\.registerTool\(/g) ?? [];

  assert.equal(directSdkRegistrations.length, 1, "MCP tools must be registered through registerLanternTool");
  assert.match(source, /activity:\s*\{\s*mode:\s*"none"/);
  assert.match(source, /projection:\s*"safe_semantic"/);
});

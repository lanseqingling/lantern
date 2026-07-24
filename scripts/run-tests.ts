import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { initializeRuntime, repositoryRoot, runNodeCommand } from "./runtime-init";

const suite = process.argv[2] ?? "unit";

async function testFiles() {
  if (suite === "integration") return ["tests/integration/db.test.ts"];
  if (suite === "unit") {
    const entries = await readdir(path.join(repositoryRoot, "tests"));
    return entries.filter((entry) => entry.endsWith(".test.ts")).sort().map((entry) => `tests/${entry}`);
  }
  const suites: Record<string, string> = {
    editor: "tests/editor-domain.test.ts",
    agent: "tests/agent-execution.test.ts",
    "api-client": "tests/api-client.test.ts",
    provider: "tests/provider.test.ts",
    export: "tests/export.test.ts",
    storage: "tests/storage.test.ts",
    capacity: "tests/runtime-capacity.test.ts",
    runtime: "tests/local-runtime.test.ts",
  };
  const file = suites[suite];
  if (!file) throw new Error(`Unknown test suite: ${suite}`);
  return [file];
}

const testTempRoot = process.platform === "darwin" ? "/tmp" : tmpdir();
const dataDir = await mkdtemp(path.join(testTempRoot, "lantern-test-"));
const env = {
  APP_ENV: "test",
  LANTERN_DATA_DIR: dataDir,
  LANTERN_NO_OPEN: "1",
  TEXT_MODEL_PROVIDER: "test",
  IMAGE_MODEL_PROVIDER: "test",
  VISION_MODEL_PROVIDER: "test",
};

try {
  Object.assign(process.env, env);
  await initializeRuntime({ seedIfEmpty: false });
  await runNodeCommand(["--import", "tsx", "--test", ...await testFiles()], { env });
} finally {
  await rm(dataDir, { recursive: true, force: true });
}

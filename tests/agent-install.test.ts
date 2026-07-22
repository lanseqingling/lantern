import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  detectCurrentAgent,
  detectInstalledAgents,
  installLanternAgentIntegration,
  resolveAgentForInstall,
  updateClaudeMcpConfig,
  updateCodexMcpConfig,
  updateKimiMcpConfig,
  updateOpenCodeMcpConfig,
  type SupportedAgentId,
} from "../scripts/agent-install";

test("Codex MCP config update preserves unrelated settings and owns only the Lantern table", () => {
  const original = [
    'model = "gpt-5"',
    "",
    "[mcp_servers.other]",
    'url = "https://example.test/mcp"',
    "",
    "[mcp_servers.lantern]",
    'url = "http://old.test/mcp"',
    "",
    "[mcp_servers.lantern.env]",
    'OLD = "value"',
    "",
    '[projects."/tmp/example"]',
    'trust_level = "trusted"',
    "",
  ].join("\n");
  const updated = updateCodexMcpConfig(original, {
    mcpUrl: "http://127.0.0.1:18787/mcp",
    token: "secret-token",
  });
  assert.match(updated, /^model = "gpt-5"/);
  assert.match(updated, /\[mcp_servers\.other]/);
  assert.match(updated, /\[projects\."\/tmp\/example"]/);
  assert.doesNotMatch(updated, /old\.test|OLD/);
  assert.equal(updated.match(/\[mcp_servers\.lantern]/g)?.length, 1);
  assert.match(updated, /http_headers = \{ Authorization = "Bearer secret-token" \}/);
  assert.match(updated, /default_tools_approval_mode = "prompt"/);
  assert.equal(updated.match(/approval_mode = "auto"/g)?.length, 4);
});

test("JSON Agent adapters preserve unrelated configuration and replace only Lantern", () => {
  const options = { mcpUrl: "http://127.0.0.1:18787/mcp", token: "adapter-token" };
  const claude = updateClaudeMcpConfig({ theme: "dark", mcpServers: { other: { command: "other" } } }, options);
  const kimi = updateKimiMcpConfig({ locale: "zh", mcpServers: { other: { url: "https://example.test" } } }, options);
  const openCode = updateOpenCodeMcpConfig({ plugin: ["example"], mcp: { other: { type: "local" } } }, options);

  assert.equal(claude.theme, "dark");
  assert.deepEqual((claude.mcpServers as Record<string, unknown>).other, { command: "other" });
  assert.deepEqual((claude.mcpServers as Record<string, unknown>).lantern, {
    type: "http",
    url: options.mcpUrl,
    headers: { Authorization: "Bearer adapter-token" },
  });
  assert.equal(kimi.locale, "zh");
  assert.deepEqual((kimi.mcpServers as Record<string, unknown>).lantern, {
    url: options.mcpUrl,
    headers: { Authorization: "Bearer adapter-token" },
    enabled: true,
  });
  assert.deepEqual(openCode.plugin, ["example"]);
  assert.deepEqual((openCode.mcp as Record<string, unknown>).lantern, {
    type: "remote",
    url: options.mcpUrl,
    enabled: true,
    headers: { Authorization: "Bearer adapter-token" },
  });
});

test("Agent selection prefers the current caller and detects installed clients as a fallback", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "lantern-agent-detection-"));
  try {
    assert.equal(detectCurrentAgent({ CODEX_THREAD_ID: "thread" }), "codex");
    assert.equal(detectCurrentAgent({ CLAUDE_CODE_ENTRYPOINT: "cli" }), "claude-code");
    assert.equal(detectCurrentAgent({ KIMI_CODE_HOME: "/tmp/kimi" }), "kimi-code");
    assert.equal(detectCurrentAgent({ OPENCODE: "1" }), "opencode");
    assert.equal(await resolveAgentForInstall({
      homeDirectory: root,
      environment: { CODEX_THREAD_ID: "thread" },
      interactive: false,
    }), "codex");

    await mkdir(path.join(root, ".kimi-code"), { recursive: true });
    assert.deepEqual(await detectInstalledAgents({ homeDirectory: root, environment: {} }), ["kimi-code"]);
    assert.equal(await resolveAgentForInstall({ homeDirectory: root, environment: {}, interactive: false }), "kimi-code");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Agent installer deploys the shared Skill and writes each supported client configuration", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "lantern-agent-install-"));
  const sourceSkillDir = path.join(root, "source-skill");
  const homeDirectory = path.join(root, "home");
  try {
    await mkdir(path.join(sourceSkillDir, "agents"), { recursive: true });
    await mkdir(path.join(sourceSkillDir, "references"), { recursive: true });
    await writeFile(path.join(sourceSkillDir, "SKILL.md"), "---\nname: create-with-lantern\ndescription: test\n---\n");
    await writeFile(path.join(sourceSkillDir, "agents", "openai.yaml"), "interface:\n  display_name: Lantern\ndependencies:\n  tools:\n    - type: mcp\n      url: \"http://127.0.0.1:18787/mcp\"\n");
    await writeFile(path.join(sourceSkillDir, "references", "resources.md"), "# Resource Reference\n");

    const agentIds: SupportedAgentId[] = ["codex", "claude-code", "kimi-code", "opencode"];
    for (const agentId of agentIds) {
      const result = await installLanternAgentIntegration({
        agentId,
        sourceSkillDir,
        homeDirectory,
        environment: {},
        mcpUrl: "http://127.0.0.1:19000/mcp",
        token: "installer-token",
      });
      assert.equal(result.agentId, agentId);
      assert.match(await readFile(result.configFile, "utf8"), /installer-token/);
      if (process.platform !== "win32") assert.equal((await stat(result.configFile)).mode & 0o777, 0o600);
    }

    const sharedSkill = path.join(homeDirectory, ".agents", "skills", "create-with-lantern");
    assert.match(await readFile(path.join(sharedSkill, "SKILL.md"), "utf8"), /create-with-lantern/);
    assert.match(await readFile(path.join(sharedSkill, "agents", "openai.yaml"), "utf8"), /http:\/\/127\.0\.0\.1:19000\/mcp/);
    assert.match(await readFile(path.join(sharedSkill, "references", "resources.md"), "utf8"), /Resource Reference/);
    assert.match(await readFile(path.join(homeDirectory, ".claude", "skills", "create-with-lantern", "SKILL.md"), "utf8"), /create-with-lantern/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

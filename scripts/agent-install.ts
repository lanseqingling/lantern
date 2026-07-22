import { access, chmod, cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";

export const supportedAgentIds = ["codex", "claude-code", "kimi-code", "opencode"] as const;
export type SupportedAgentId = typeof supportedAgentIds[number];

type Environment = Record<string, string | undefined>;
type JsonObject = Record<string, unknown>;

const managedBlockStart = "# BEGIN LANTERN MANAGED MCP";
const managedBlockEnd = "# END LANTERN MANAGED MCP";
const agentAliases: Record<string, SupportedAgentId> = {
  codex: "codex",
  claude: "claude-code",
  "claude-code": "claude-code",
  kimi: "kimi-code",
  "kimi-code": "kimi-code",
  opencode: "opencode",
};

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function exists(file: string) {
  return access(file).then(() => true, () => false);
}

function removeManagedBlock(source: string) {
  const start = source.indexOf(managedBlockStart);
  if (start < 0) return source;
  const end = source.indexOf(managedBlockEnd, start);
  if (end < 0) return source.slice(0, start);
  return `${source.slice(0, start)}${source.slice(end + managedBlockEnd.length)}`;
}

function removeLanternMcpTables(source: string) {
  const lines = source.split("\n");
  const output: string[] = [];
  let skip = false;
  for (const line of lines) {
    const section = /^\s*\[([^\]]+)]\s*(?:#.*)?$/.exec(line)?.[1]?.trim();
    if (section) skip = section === "mcp_servers.lantern" || section.startsWith("mcp_servers.lantern.");
    if (!skip) output.push(line);
  }
  return output.join("\n");
}

export function updateCodexMcpConfig(source: string, options: { mcpUrl: string; token: string }) {
  const preserved = removeLanternMcpTables(removeManagedBlock(source)).trimEnd();
  const block = [
    managedBlockStart,
    "[mcp_servers.lantern]",
    `url = ${JSON.stringify(options.mcpUrl)}`,
    `http_headers = { Authorization = ${JSON.stringify(`Bearer ${options.token}`)} }`,
    'default_tools_approval_mode = "prompt"',
    "enabled = true",
    "required = false",
    "",
    "[mcp_servers.lantern.tools.lantern_projects_list]",
    'approval_mode = "auto"',
    "",
    "[mcp_servers.lantern.tools.lantern_context_get]",
    'approval_mode = "auto"',
    "",
    "[mcp_servers.lantern.tools.lantern_capabilities_list]",
    'approval_mode = "auto"',
    "",
    "[mcp_servers.lantern.tools.lantern_images_inspect]",
    'approval_mode = "auto"',
    "",
    "[mcp_servers.lantern.tools.lantern_comic_list]",
    'approval_mode = "auto"',
    "",
    "[mcp_servers.lantern.tools.lantern_comic_get]",
    'approval_mode = "auto"',
    "",
    "[mcp_servers.lantern.tools.lantern_chapter_get]",
    'approval_mode = "auto"',
    "",
    "[mcp_servers.lantern.tools.lantern_asset_list]",
    'approval_mode = "auto"',
    "",
    "[mcp_servers.lantern.tools.lantern_asset_get]",
    'approval_mode = "auto"',
    managedBlockEnd,
  ].join("\n");
  return `${preserved ? `${preserved}\n\n` : ""}${block}\n`;
}

export function updateClaudeMcpConfig(source: JsonObject, options: { mcpUrl: string; token: string }): JsonObject {
  const existing = isObject(source.mcpServers) ? source.mcpServers : {};
  return {
    ...source,
    mcpServers: {
      ...existing,
      lantern: {
        type: "http",
        url: options.mcpUrl,
        headers: { Authorization: `Bearer ${options.token}` },
      },
    },
  };
}

export function updateKimiMcpConfig(source: JsonObject, options: { mcpUrl: string; token: string }): JsonObject {
  const existing = isObject(source.mcpServers) ? source.mcpServers : {};
  return {
    ...source,
    mcpServers: {
      ...existing,
      lantern: {
        url: options.mcpUrl,
        headers: { Authorization: `Bearer ${options.token}` },
        enabled: true,
      },
    },
  };
}

export function updateOpenCodeMcpConfig(source: JsonObject, options: { mcpUrl: string; token: string }): JsonObject {
  const existing = isObject(source.mcp) ? source.mcp : {};
  return {
    ...source,
    mcp: {
      ...existing,
      lantern: {
        type: "remote",
        url: options.mcpUrl,
        enabled: true,
        headers: { Authorization: `Bearer ${options.token}` },
      },
    },
  };
}

async function atomicWrite(file: string, content: string, mode: number) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.lantern-${process.pid}`;
  await writeFile(temporary, content, { encoding: "utf8", mode });
  await rename(temporary, file);
  await chmod(file, mode);
}

async function readJsonObject(file: string) {
  const source = await readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "{}";
    throw error;
  });
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new Error(`Invalid Agent configuration at ${file}`, { cause: error });
  }
  if (!isObject(value)) throw new Error(`Invalid Agent configuration at ${file}`);
  return value;
}

async function updateJsonFile(file: string, update: (source: JsonObject) => JsonObject) {
  const updated = update(await readJsonObject(file));
  await atomicWrite(file, `${JSON.stringify(updated, null, 2)}\n`, 0o600);
}

async function deploySkill(sourceSkillDir: string, skillDirectory: string, mcpUrl: string) {
  const skillParent = path.dirname(skillDirectory);
  const temporarySkill = path.join(skillParent, `.${path.basename(skillDirectory)}-${process.pid}`);
  await mkdir(skillParent, { recursive: true });
  await rm(temporarySkill, { recursive: true, force: true });
  await cp(sourceSkillDir, temporarySkill, { recursive: true, errorOnExist: true });

  const metadataFile = path.join(temporarySkill, "agents", "openai.yaml");
  const metadata = await readFile(metadataFile, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (metadata !== undefined) {
    const configured = metadata.replace(/(^\s+url:\s*)[^\r\n]+/m, `$1${JSON.stringify(mcpUrl)}`);
    if (configured === metadata && !metadata.includes(mcpUrl)) {
      throw new Error("LANTERN_SKILL_MCP_DEPENDENCY_MISSING");
    }
    await writeFile(metadataFile, configured, { encoding: "utf8", mode: 0o644 });
  }

  await rm(skillDirectory, { recursive: true, force: true });
  await rename(temporarySkill, skillDirectory);
  return skillDirectory;
}

function hasEnvironmentSignal(environment: Environment, prefixes: string[], exact: string[] = []) {
  if (exact.some((name) => Boolean(environment[name]))) return true;
  return Object.entries(environment).some(([name, value]) => Boolean(value) && prefixes.some((prefix) => name.startsWith(prefix)));
}

export function detectCurrentAgent(environment: Environment = process.env) {
  if (hasEnvironmentSignal(environment, ["CODEX_"], ["CODEX_HOME"])) return "codex" as const;
  if (hasEnvironmentSignal(environment, ["CLAUDE_CODE_"], ["CLAUDECODE"])) return "claude-code" as const;
  if (hasEnvironmentSignal(environment, ["KIMI_"], ["KIMI_CODE_HOME"])) return "kimi-code" as const;
  if (hasEnvironmentSignal(environment, ["OPENCODE_"], ["OPENCODE"])) return "opencode" as const;
  return undefined;
}

function agentPaths(homeDirectory: string, environment: Environment) {
  const configHome = environment.XDG_CONFIG_HOME || path.join(homeDirectory, ".config");
  return {
    codexHome: environment.CODEX_HOME || path.join(homeDirectory, ".codex"),
    claudeHome: path.join(homeDirectory, ".claude"),
    claudeConfigFile: path.join(homeDirectory, ".claude.json"),
    kimiHome: environment.KIMI_CODE_HOME || path.join(homeDirectory, ".kimi-code"),
    openCodeHome: path.join(configHome, "opencode"),
  };
}

export async function detectInstalledAgents(options: { homeDirectory?: string; environment?: Environment } = {}) {
  const homeDirectory = options.homeDirectory ?? os.homedir();
  const environment = options.environment ?? process.env;
  const paths = agentPaths(homeDirectory, environment);
  const checks: Array<[SupportedAgentId, Promise<boolean>]> = [
    ["codex", exists(paths.codexHome)],
    ["claude-code", Promise.all([exists(paths.claudeHome), exists(paths.claudeConfigFile)]).then((values) => values.some(Boolean))],
    ["kimi-code", exists(paths.kimiHome)],
    ["opencode", exists(paths.openCodeHome)],
  ];
  const resolved = await Promise.all(checks.map(async ([id, check]) => [id, await check] as const));
  return resolved.filter(([, installed]) => installed).map(([id]) => id);
}

export function parseAgentId(value: string | undefined) {
  if (!value) return undefined;
  return agentAliases[value.trim().toLowerCase()];
}

const agentDisplayNames: Record<SupportedAgentId, string> = {
  codex: "Codex",
  "claude-code": "Claude Code",
  "kimi-code": "Kimi Code",
  opencode: "OpenCode",
};

async function chooseInteractively(agentIds: SupportedAgentId[]) {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log("Detected compatible local Agents:");
    agentIds.forEach((id, index) => console.log(`  ${index + 1}. ${agentDisplayNames[id]}`));
    const answer = (await terminal.question("Choose the Agent to connect to Lantern: ")).trim();
    const byIndex = Number.parseInt(answer, 10);
    if (Number.isInteger(byIndex) && byIndex >= 1 && byIndex <= agentIds.length) return agentIds[byIndex - 1];
    const byName = parseAgentId(answer);
    if (byName && agentIds.includes(byName)) return byName;
    throw new Error("LANTERN_AGENT_SELECTION_INVALID");
  } finally {
    terminal.close();
  }
}

export async function resolveAgentForInstall(options: {
  requestedAgent?: string;
  homeDirectory?: string;
  environment?: Environment;
  interactive?: boolean;
} = {}) {
  if (options.requestedAgent) {
    const requested = parseAgentId(options.requestedAgent);
    if (!requested) throw new Error(`Unsupported Agent: ${options.requestedAgent}`);
    return requested;
  }
  const environment = options.environment ?? process.env;
  const current = detectCurrentAgent(environment);
  if (current) return current;
  const installed = await detectInstalledAgents({ homeDirectory: options.homeDirectory, environment });
  if (installed.length === 1) return installed[0];
  if (installed.length > 1 && (options.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY))) {
    return chooseInteractively(installed);
  }
  const candidates = (installed.length ? installed : supportedAgentIds)
    .map((id) => `  lantern agent:install ${id}`)
    .join("\n");
  throw new Error(`LANTERN_AGENT_SELECTION_REQUIRED\n${candidates}`);
}

export async function installLanternAgentIntegration(options: {
  agentId: SupportedAgentId;
  sourceSkillDir: string;
  mcpUrl: string;
  token: string;
  homeDirectory?: string;
  environment?: Environment;
  codexHome?: string;
  claudeConfigFile?: string;
  kimiHome?: string;
  openCodeConfigFile?: string;
}) {
  const homeDirectory = options.homeDirectory ?? os.homedir();
  const environment = options.environment ?? process.env;
  const paths = agentPaths(homeDirectory, environment);
  const canonicalSkillDirectory = await deploySkill(
    options.sourceSkillDir,
    path.join(homeDirectory, ".agents", "skills", "create-with-lantern"),
    options.mcpUrl,
  );
  const skillDirectories = [canonicalSkillDirectory];
  let configFile: string;

  if (options.agentId === "codex") {
    configFile = path.join(options.codexHome ?? paths.codexHome, "config.toml");
    const existing = await readFile(configFile, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    await atomicWrite(configFile, updateCodexMcpConfig(existing, options), 0o600);
  } else if (options.agentId === "claude-code") {
    const claudeSkillDirectory = await deploySkill(
      options.sourceSkillDir,
      path.join(paths.claudeHome, "skills", "create-with-lantern"),
      options.mcpUrl,
    );
    skillDirectories.push(claudeSkillDirectory);
    configFile = options.claudeConfigFile ?? paths.claudeConfigFile;
    await updateJsonFile(configFile, (source) => updateClaudeMcpConfig(source, options));
  } else if (options.agentId === "kimi-code") {
    const kimiHome = options.kimiHome ?? paths.kimiHome;
    configFile = path.join(kimiHome, "mcp.json");
    await updateJsonFile(configFile, (source) => updateKimiMcpConfig(source, options));
  } else {
    configFile = options.openCodeConfigFile ?? path.join(paths.openCodeHome, "opencode.json");
    await updateJsonFile(configFile, (source) => updateOpenCodeMcpConfig(source, options));
  }

  return {
    agentId: options.agentId,
    agentName: agentDisplayNames[options.agentId],
    skillDirectories,
    configFile,
  };
}

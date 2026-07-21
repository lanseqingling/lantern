import { homedir, platform as currentPlatform } from "node:os";
import path from "node:path";

export type LanternRuntimePaths = {
  dataDir: string;
  databaseFile: string;
  databaseUrl: string;
  objectsDir: string;
  assetsDir: string;
  candidatesDir: string;
  exportsDir: string;
  configDir: string;
  runtimeConfigFile: string;
  providerConfigFile: string;
  mcpConfigFile: string;
  starterStateFile: string;
  logsDir: string;
  tempDir: string;
  backupsDir: string;
  lockFile: string;
  stopRequestFile: string;
};

export function defaultLanternDataDir(
  platform = currentPlatform(),
  home = homedir(),
  env: Record<string, string | undefined> = process.env,
) {
  if (platform === "win32") return path.join(env.APPDATA || path.join(home, "AppData", "Roaming"), "Lantern");
  if (platform === "darwin") return path.join(home, "Library", "Application Support", "Lantern");
  return path.join(env.XDG_DATA_HOME || path.join(home, ".local", "share"), "Lantern");
}

export function resolveLanternDataDir(env: Record<string, string | undefined> = process.env) {
  const configured = env.LANTERN_DATA_DIR?.trim();
  return path.resolve(configured || defaultLanternDataDir(currentPlatform(), homedir(), env));
}

export function getRuntimePaths(dataDir = resolveLanternDataDir()): LanternRuntimePaths {
  const resolved = path.resolve(dataDir);
  const objectsDir = path.join(resolved, "objects");
  const configDir = path.join(resolved, "config");
  const databaseFile = path.join(resolved, "lantern.db");
  return {
    dataDir: resolved,
    databaseFile,
    databaseUrl: `file:${databaseFile.replaceAll("\\", "/")}`,
    objectsDir,
    assetsDir: path.join(objectsDir, "assets"),
    candidatesDir: path.join(objectsDir, "candidates"),
    exportsDir: path.join(objectsDir, "exports"),
    configDir,
    runtimeConfigFile: path.join(configDir, "runtime.json"),
    providerConfigFile: path.join(configDir, "providers.env"),
    mcpConfigFile: path.join(configDir, "mcp.env"),
    starterStateFile: path.join(configDir, "starter.json"),
    logsDir: path.join(resolved, "logs"),
    tempDir: path.join(resolved, "temp"),
    backupsDir: path.join(resolved, "backups"),
    lockFile: path.join(resolved, "lantern.lock"),
    stopRequestFile: path.join(resolved, "lantern.stop"),
  };
}

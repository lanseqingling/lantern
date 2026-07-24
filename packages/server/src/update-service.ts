import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const updateEndpoint = "https://api.github.com/repos/lanseqingling/lantern/releases/latest";
const checkIntervalMs = 30 * 60 * 1000;

export type UpdateStatus = {
  currentVersion: string;
  checkedAt?: string;
  state: "idle" | "checking" | "upToDate" | "available" | "unavailable";
  latestVersion?: string;
  releaseUrl?: string;
};

let status: UpdateStatus | undefined;
let inFlight: Promise<UpdateStatus> | undefined;

function compareVersions(left: string, right: string) {
  const parse = (value: string) => value.replace(/^v/, "").split("-")[0].split(".").map((part) => Number(part) || 0);
  const [leftMajor, leftMinor, leftPatch] = parse(left);
  const [rightMajor, rightMinor, rightPatch] = parse(right);
  return leftMajor - rightMajor || leftMinor - rightMinor || leftPatch - rightPatch;
}

async function currentVersion() {
  const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8")) as { version: string };
  return packageJson.version;
}

async function fetchUpdate(force: boolean): Promise<UpdateStatus> {
  const current = await currentVersion();
  if (!force && status?.checkedAt && Date.now() - Date.parse(status.checkedAt) < checkIntervalMs) return status;
  status = { currentVersion: current, checkedAt: status?.checkedAt, state: "checking" };
  try {
    const response = await fetch(updateEndpoint, { headers: { Accept: "application/vnd.github+json", "User-Agent": "Lantern" }, signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`Update check failed: ${response.status}`);
    const release = await response.json() as { tag_name?: string; html_url?: string };
    const latestVersion = release.tag_name?.replace(/^v/, "");
    if (!latestVersion) throw new Error("Latest release has no version");
    status = { currentVersion: current, checkedAt: new Date().toISOString(), state: compareVersions(latestVersion, current) > 0 ? "available" : "upToDate", latestVersion, releaseUrl: release.html_url };
  } catch {
    status = { currentVersion: current, checkedAt: new Date().toISOString(), state: "unavailable" };
  }
  return status;
}

export function getUpdateStatus(force = false) {
  if (inFlight) return inFlight;
  inFlight = fetchUpdate(force).finally(() => { inFlight = undefined; });
  return inFlight;
}

export function checkForUpdateInBackground() {
  void getUpdateStatus(false);
}

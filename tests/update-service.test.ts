import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { zipSync } from "fflate";
import { compareVersions, expectedChecksum, getUpdateInstallStatus, safeArchiveEntries, versionFromReleaseUrl } from "@lantern/server/update-service";

test("application update versions compare stable semantic versions", () => {
  assert.ok(compareVersions("0.1.4", "0.1.3") > 0);
  assert.equal(compareVersions("v0.1.3", "0.1.3"), 0);
  assert.ok(compareVersions("0.2.0", "0.1.99") > 0);
  assert.ok(compareVersions("1.0.0", "2.0.0") < 0);
});

test("application update reads the version from GitHub's latest release redirect", () => {
  assert.equal(versionFromReleaseUrl("https://github.com/lanseqingling/lantern/releases/tag/v0.1.6"), "0.1.6");
  assert.throws(() => versionFromReleaseUrl("https://example.com/lanseqingling/lantern/releases/tag/v0.1.6"));
});

test("application update checksum selects the exact release archive", () => {
  const hash = "a".repeat(64);
  const checksum = new TextEncoder().encode(`${"b".repeat(64)}  other.zip\n${hash}  lantern-0.1.4-source.zip\n`);
  assert.equal(expectedChecksum(checksum, new URL("https://github.com/example/releases/lantern-0.1.4-source.zip")), hash);
});

test("application update archives keep every file inside the version root", () => {
  const valid = zipSync({
    "lantern-0.1.4/package.json": new TextEncoder().encode('{"version":"0.1.4"}'),
    "lantern-0.1.4/.lantern-release.json": new TextEncoder().encode('{"distribution":"source-release","version":"0.1.4"}'),
    "lantern-0.1.4/lantern": new TextEncoder().encode("launcher"),
  });
  assert.deepEqual(safeArchiveEntries(valid, "0.1.4").map((entry) => entry.relative).sort(), [".lantern-release.json", "lantern", "package.json"]);

  const invalid = zipSync({
    "lantern-0.1.4/package.json": new TextEncoder().encode('{"version":"0.1.4"}'),
    "lantern-0.1.4/.lantern-release.json": new TextEncoder().encode('{"distribution":"source-release","version":"0.1.4"}'),
    "lantern-0.1.4/../outside.txt": new TextEncoder().encode("unsafe"),
  });
  assert.throws(() => safeArchiveEntries(invalid, "0.1.4"), /更新包目录结构无效/);
});

test("application update progress survives a settings page refresh", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "lantern-update-status-"));
  const previousDataDir = process.env.LANTERN_DATA_DIR;
  process.env.LANTERN_DATA_DIR = dataDir;
  try {
    await writeFile(path.join(dataDir, "update-status.json"), JSON.stringify({
      state: "downloading",
      version: "0.1.8",
      progress: 37.4,
      downloadedBytes: 1024,
      totalBytes: 4096,
    }));
    assert.deepEqual(await getUpdateInstallStatus(), {
      state: "downloading",
      version: "0.1.8",
      progress: 37,
      downloadedBytes: 1024,
      totalBytes: 4096,
    });
  } finally {
    if (previousDataDir === undefined) delete process.env.LANTERN_DATA_DIR;
    else process.env.LANTERN_DATA_DIR = previousDataDir;
    await rm(dataDir, { recursive: true, force: true });
  }
});

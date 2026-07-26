import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  recordCurrentWebBuild,
  webBuildEntry,
  webBuildIsCurrent,
} from "../scripts/web-build-state";

async function createBuildFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "lantern-web-build-"));
  await Promise.all([
    mkdir(path.join(root, "apps", "web", "app"), { recursive: true }),
    mkdir(path.join(root, "packages", "shared", "src"), { recursive: true }),
    mkdir(path.dirname(webBuildEntry(root)), { recursive: true }),
    writeFile(path.join(root, "package.json"), '{"version":"0.3.1"}\n'),
    writeFile(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n"),
    writeFile(path.join(root, "pnpm-workspace.yaml"), "packages: []\n"),
    writeFile(path.join(root, "tsconfig.base.json"), "{}\n"),
    writeFile(path.join(root, "tsconfig.json"), "{}\n"),
  ]);
  await Promise.all([
    writeFile(path.join(root, "apps", "web", "app", "page.tsx"), "export default function Page() { return null; }\n"),
    writeFile(path.join(root, "packages", "shared", "src", "index.ts"), "export const value = 1;\n"),
    writeFile(webBuildEntry(root), "production build\n"),
  ]);
  return root;
}

test("production web builds require a matching source fingerprint", async () => {
  const root = await createBuildFixture();
  try {
    assert.equal(await webBuildIsCurrent(root), false);
    await recordCurrentWebBuild(root);
    assert.equal(await webBuildIsCurrent(root), true);

    await writeFile(path.join(root, "apps", "web", "app", "page.tsx"), "export default function Page() { return <main />; }\n");
    assert.equal(await webBuildIsCurrent(root), false);

    await recordCurrentWebBuild(root);
    await writeFile(webBuildEntry(root), "updated production build\n");
    assert.equal(await webBuildIsCurrent(root), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("shared package changes invalidate an otherwise complete web build", async () => {
  const root = await createBuildFixture();
  try {
    await recordCurrentWebBuild(root);
    await writeFile(path.join(root, "packages", "shared", "src", "index.ts"), "export const value = 2;\n");
    assert.equal(await webBuildIsCurrent(root), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

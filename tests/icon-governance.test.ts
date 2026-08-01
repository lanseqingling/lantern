import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { iconNames, iconRegistry } from "@lantern/ui";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

function filesUnder(directory: string, extensions: Set<string>): string[] {
  const absolute = path.join(repositoryRoot, directory);
  return readdirSync(absolute).flatMap((entry) => {
    const file = path.join(absolute, entry);
    if (statSync(file).isDirectory()) return filesUnder(path.relative(repositoryRoot, file), extensions);
    return extensions.has(path.extname(file)) ? [file] : [];
  });
}

test("the shared semantic registry exposes complete unique definitions", () => {
  assert.ok(iconNames.length > 0);
  assert.equal(new Set(iconNames).size, iconNames.length);
  for (const name of iconNames) {
    assert.ok(iconRegistry[name].default, `missing default glyph for ${name}`);
  }
});

test("lucide imports stay inside the shared icon registry", () => {
  const sources = [
    ...filesUnder("apps", new Set([".ts", ".tsx"])),
    ...filesUnder("packages", new Set([".ts", ".tsx"])),
  ];
  const violations = sources
    .filter((file) => file.includes("node_modules") === false)
    .filter((file) => file.includes(`${path.sep}packages${path.sep}ui${path.sep}src${path.sep}icons${path.sep}`) === false)
    .filter((file) => readFileSync(file, "utf8").includes("lucide-react"))
    .map((file) => path.relative(repositoryRoot, file));
  assert.deepEqual(violations, []);
});

test("ordinary web UI does not reintroduce raw or CSS-drawn icons", () => {
  const componentAllowlist = new Set([
    path.join(repositoryRoot, "apps/web/app/components/ComicRenderer.tsx"),
    path.join(repositoryRoot, "apps/web/app/components/workbench/WorkbenchTour.tsx"),
  ]);
  const rawSvgViolations = filesUnder("apps/web/app/components", new Set([".tsx"]))
    .filter((file) => !componentAllowlist.has(file))
    .filter((file) => readFileSync(file, "utf8").includes("<svg"))
    .map((file) => path.relative(repositoryRoot, file));
  assert.deepEqual(rawSvgViolations, []);

  const bannedGlyphMarkers = ["menu-item-glyph", "custom-select-icon"];
  const markerViolations = filesUnder("apps/web/app", new Set([".ts", ".tsx", ".css"]))
    .filter((file) => bannedGlyphMarkers.some((marker) => readFileSync(file, "utf8").includes(marker)))
    .map((file) => path.relative(repositoryRoot, file));
  assert.deepEqual(markerViolations, []);

  const svgSelectorViolations = filesUnder("apps/web/app/styles", new Set([".css"]))
    .filter((file) => readFileSync(file, "utf8").includes(" svg"))
    .map((file) => path.relative(repositoryRoot, file));
  assert.deepEqual(svgSelectorViolations, []);
});

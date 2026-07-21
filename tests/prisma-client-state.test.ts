import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  generatedPrismaSchemaMatches,
  prismaClientReady,
  prismaSchemaState,
  recordPrismaClientState,
} from "../scripts/prisma-client-state.mjs";

test("Prisma client readiness verifies the generated schema instead of trusting the marker", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "lantern-prisma-state-"));
  try {
    const schema = [
      "generator client {",
      '  provider = "prisma-client-js"',
      "}",
      "",
      "datasource db {",
      '  provider = "sqlite"',
      '  url = env("DATABASE_URL")',
      "}",
      "",
    ].join("\n");
    await mkdir(path.join(root, "prisma"), { recursive: true });
    await mkdir(path.join(root, "node_modules", ".prisma", "client"), { recursive: true });
    await mkdir(path.join(root, "node_modules", "@prisma", "client"), { recursive: true });
    await writeFile(path.join(root, "package.json"), '{"name":"fixture"}\n');
    await writeFile(path.join(root, "prisma", "schema.prisma"), schema);
    await writeFile(path.join(root, "node_modules", ".prisma", "client", "schema.prisma"), schema.replace("sqlite", "postgresql"));

    const state = prismaSchemaState(root);
    await writeFile(path.join(root, "node_modules", ".lantern-prisma-schema-state"), `${state}\n`);
    assert.equal(generatedPrismaSchemaMatches(root), false);
    assert.equal(prismaClientReady(root, state), false);
    assert.throws(() => recordPrismaClientState(root, state), /does not match/);

    await writeFile(path.join(root, "node_modules", ".prisma", "client", "schema.prisma"), schema);
    recordPrismaClientState(root, state);
    assert.equal(generatedPrismaSchemaMatches(root), true);
    assert.equal(prismaClientReady(root, state), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

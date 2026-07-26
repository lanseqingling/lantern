import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";

function sourceSchemaPath(repositoryRoot) {
  return path.join(repositoryRoot, "prisma", "schema.prisma");
}

function generatedSchemaPath(repositoryRoot) {
  const clientPackage = path.join(repositoryRoot, "node_modules", "@prisma", "client");
  if (!existsSync(clientPackage)) return undefined;
  return path.resolve(realpathSync(clientPackage), "..", "..", ".prisma", "client", "schema.prisma");
}

function stateFilePath(repositoryRoot) {
  return path.join(repositoryRoot, "node_modules", ".lantern-prisma-schema-state");
}

function schemaContents(filename) {
  return readFileSync(filename, "utf8").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

export function prismaSchemaState(repositoryRoot) {
  const hash = createHash("sha256");
  for (const filename of ["package.json", path.join("prisma", "schema.prisma")]) {
    hash.update(filename);
    hash.update(readFileSync(path.join(repositoryRoot, filename)));
  }
  return hash.digest("hex");
}

export function generatedPrismaSchemaMatches(repositoryRoot) {
  const generated = generatedSchemaPath(repositoryRoot);
  if (!generated || !existsSync(generated)) return false;
  return schemaContents(generated) === schemaContents(sourceSchemaPath(repositoryRoot));
}

export function prismaClientReady(repositoryRoot, expectedState = prismaSchemaState(repositoryRoot)) {
  const stateFile = stateFilePath(repositoryRoot);
  if (!existsSync(stateFile) || !generatedPrismaSchemaMatches(repositoryRoot)) return false;
  return readFileSync(stateFile, "utf8").trim() === expectedState;
}

export function recordPrismaClientState(repositoryRoot, state = prismaSchemaState(repositoryRoot)) {
  if (!generatedPrismaSchemaMatches(repositoryRoot)) {
    throw new Error("Generated Prisma Client schema does not match prisma/schema.prisma.");
  }
  writeFileSync(stateFilePath(repositoryRoot), `${state}\n`, { encoding: "utf8", mode: 0o600 });
}

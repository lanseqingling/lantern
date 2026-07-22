import { randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { z } from "zod";
import { prisma } from "@lantern/server/db";
import { getRuntimePaths, type LanternRuntimePaths } from "@lantern/server/runtime-paths";
import { seedCampusLetter } from "../samples/campus-letter/seed";

const initialDataStateSchema = z.object({
  protocol: z.literal("lantern-starter-state-1"),
  status: z.enum(["initializing", "complete"]),
  updatedAt: z.string().datetime(),
});

type InitialDataState = z.infer<typeof initialDataStateSchema>;

async function readState(paths: LanternRuntimePaths) {
  let text: string;
  try {
    text = await readFile(paths.starterStateFile, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error(`Unable to read Lantern initial data state at ${paths.starterStateFile}`, { cause: error });
  }
  try {
    return initialDataStateSchema.parse(JSON.parse(text));
  } catch (error) {
    throw new Error(`Invalid Lantern initial data state at ${paths.starterStateFile}`, { cause: error });
  }
}

async function writeState(paths: LanternRuntimePaths, status: InitialDataState["status"]) {
  const temporary = `${paths.starterStateFile}.${process.pid}.${randomUUID()}.tmp`;
  const contents = `${JSON.stringify({
    protocol: "lantern-starter-state-1",
    status,
    updatedAt: new Date().toISOString(),
  }, null, 2)}\n`;
  await writeFile(temporary, contents, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, paths.starterStateFile);
}

export type InitialDataInitializationResult = "initialized" | "resumed" | "complete" | "skipped";

export async function initializeInitialData(
  paths = getRuntimePaths(),
  options: {
    comicCount?: () => Promise<number>;
    seed?: () => Promise<void>;
  } = {},
): Promise<InitialDataInitializationResult> {
  const state = await readState(paths);
  if (state?.status === "complete") return "complete";

  if (!state) {
    const comicCount = await (options.comicCount ?? (() => prisma.comic.count()))();
    if (comicCount > 0) {
      await writeState(paths, "complete");
      return "skipped";
    }
  }

  await writeState(paths, "initializing");
  await (options.seed ?? seedCampusLetter)();
  await writeState(paths, "complete");
  return state ? "resumed" : "initialized";
}

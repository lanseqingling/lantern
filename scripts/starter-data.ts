import { randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { z } from "zod";
import { prisma } from "../packages/server/src/db";
import { getRuntimePaths, type LanternRuntimePaths } from "../packages/server/src/runtime-paths";
import { seedCampusLetter } from "../samples/campus-letter/seed";
import { seedRainyStation } from "../samples/rainy-station/seed";

const starterSampleKeys = ["rainy-station", "campus-letter"] as const;
type StarterSampleKey = typeof starterSampleKeys[number];

const starterStateSchema = z.strictObject({
  protocol: z.literal("lantern-starter-state-1"),
  status: z.enum(["initializing", "complete"]),
  completedSamples: z.array(z.enum(starterSampleKeys)),
  updatedAt: z.string().datetime(),
});

type StarterState = z.infer<typeof starterStateSchema>;
type StarterSample = { key: StarterSampleKey; seed(): Promise<void> };

const defaultSamples: readonly StarterSample[] = [
  { key: "rainy-station", seed: seedRainyStation },
  { key: "campus-letter", seed: seedCampusLetter },
];

async function readState(paths: LanternRuntimePaths) {
  let text: string;
  try {
    text = await readFile(paths.starterStateFile, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error(`Unable to read Lantern starter state at ${paths.starterStateFile}`, { cause: error });
  }
  try {
    return starterStateSchema.parse(JSON.parse(text));
  } catch (error) {
    throw new Error(`Invalid Lantern starter state at ${paths.starterStateFile}`, { cause: error });
  }
}

async function writeState(paths: LanternRuntimePaths, state: Omit<StarterState, "protocol" | "updatedAt">) {
  const temporary = `${paths.starterStateFile}.${process.pid}.${randomUUID()}.tmp`;
  const contents = `${JSON.stringify({
    protocol: "lantern-starter-state-1",
    ...state,
    updatedAt: new Date().toISOString(),
  }, null, 2)}\n`;
  await writeFile(temporary, contents, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, paths.starterStateFile);
}

export type StarterInitializationResult = "initialized" | "resumed" | "complete" | "skipped";

export async function initializeStarterData(
  paths = getRuntimePaths(),
  options: {
    databaseCounts?: () => Promise<{ users: number; comics: number }>;
    samples?: readonly StarterSample[];
    requireEmpty?: boolean;
  } = {},
): Promise<StarterInitializationResult> {
  const counts = await (options.databaseCounts ?? (async () => {
    const [users, comics] = await prisma.$transaction([prisma.user.count(), prisma.comic.count()]);
    return { users, comics };
  }))();
  const samples = options.samples ?? defaultSamples;
  let state = await readState(paths);

  if (options.requireEmpty && (counts.users > 0 || counts.comics > 0)) throw new Error("SAMPLE_INIT_REQUIRES_EMPTY_DATABASE");

  if (counts.users === 0 && counts.comics === 0 && state) {
    state = undefined;
  } else if (state?.status === "complete") {
    return "complete";
  }

  if (!state) {
    if (counts.users > 0 || counts.comics > 0) return "skipped";
    state = {
      protocol: "lantern-starter-state-1",
      status: "initializing",
      completedSamples: [],
      updatedAt: new Date().toISOString(),
    };
    await writeState(paths, { status: state.status, completedSamples: state.completedSamples });
  }

  const resumed = state.completedSamples.length > 0 || counts.users > 0 || counts.comics > 0;
  const completed = new Set(state.completedSamples);
  for (const sample of samples) {
    if (completed.has(sample.key)) continue;
    await sample.seed();
    completed.add(sample.key);
    await writeState(paths, { status: "initializing", completedSamples: [...completed] });
  }
  await writeState(paths, { status: "complete", completedSamples: [...completed] });
  return resumed ? "resumed" : "initialized";
}

import "dotenv/config";
import { rm } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../packages/server/src/db";
import { getConfig } from "../packages/server/src/config";
import { seedCampusLetter } from "../samples/campus-letter/seed";

async function resetToCampusLetter() {
  const config = getConfig();
  if (config.APP_ENV === "production") throw new Error("Refusing to clear local data in production");

  await prisma.$transaction([
    prisma.candidate.deleteMany(),
    prisma.generationAttempt.deleteMany(),
    prisma.generationTask.deleteMany(),
    prisma.messageReference.deleteMany(),
    prisma.message.deleteMany(),
    prisma.agentConversation.deleteMany(),
    prisma.canvasReferencePlacement.deleteMany(),
    prisma.canvasAssetListItem.deleteMany(),
    prisma.assetImage.deleteMany(),
    prisma.asset.updateMany({ data: { variantOfAssetId: null } }),
    prisma.assetVersion.deleteMany(),
    prisma.asset.deleteMany(),
    prisma.storyboardBeatVersion.deleteMany(),
    prisma.storyboardBeat.deleteMany(),
    prisma.savedSnapshot.deleteMany(),
    prisma.workingRevision.deleteMany(),
    prisma.project.deleteMany(),
    prisma.chapter.deleteMany(),
    prisma.comicSetting.deleteMany(),
    prisma.comic.deleteMany(),
    prisma.user.deleteMany(),
  ]);

  const storageDirectory = path.resolve(process.cwd(), config.OBJECT_STORAGE_LOCAL_DIR);
  await rm(storageDirectory, { recursive: true, force: true });
  await seedCampusLetter();
  console.log("Local data reset: only the 风停之前 sample remains.");
}

resetToCampusLetter()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    await prisma.$disconnect();
    process.exit(1);
  });

import { rm } from "node:fs/promises";
import { prisma } from "@lantern/server/db";
import { getRuntimePaths } from "@lantern/server/runtime-paths";
import { seedCampusLetter } from "../samples/campus-letter/seed";

async function resetToCampusLetter() {
  if (process.env.APP_ENV === "production") throw new Error("Refusing to clear local data in production");

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

  await rm(getRuntimePaths().objectsDir, { recursive: true, force: true });
  await seedCampusLetter();
  console.log("Local data reset: only 风停之前 remains.");
}

resetToCampusLetter()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    await prisma.$disconnect();
    process.exit(1);
  });

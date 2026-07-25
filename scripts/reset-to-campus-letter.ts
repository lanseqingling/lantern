import { pathToFileURL } from "node:url";
import { prisma } from "@lantern/server/db";
import { seedCampusLetter } from "../samples/campus-letter/seed";

export async function resetToCampusLetter(seed = seedCampusLetter) {
  if (process.env.APP_ENV === "production") throw new Error("Refusing to clear local data in production");

  await seed();
  console.log("The 风停之前 example was reloaded. Other comics were preserved.");
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  resetToCampusLetter()
    .then(() => prisma.$disconnect())
    .catch(async (error) => {
      console.error(error instanceof Error ? error.stack ?? error.message : error);
      await prisma.$disconnect();
      process.exit(1);
    });
}

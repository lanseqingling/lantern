import { seedRainyStation } from "../samples/rainy-station/seed";
import { prisma } from "../packages/server/src/db";
import { pathToFileURL } from "node:url";

/** The only development seed is the reviewed 雨夜车站 sample. */
export async function seed() {
  await seedRainyStation();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  seed()
    .then(() => prisma.$disconnect())
    .catch(async (error) => {
      console.error(error);
      await prisma.$disconnect();
      process.exitCode = 1;
    });
}

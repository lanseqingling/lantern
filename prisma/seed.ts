import { seedCampusLetter } from "../samples/campus-letter/seed";
import { seedRainyStation } from "../samples/rainy-station/seed";
import { prisma } from "@lantern/server/db";
import { pathToFileURL } from "node:url";

export async function seed() {
  await seedRainyStation();
  await seedCampusLetter();
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

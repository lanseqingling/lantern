import "dotenv/config";
import { prisma } from "../packages/server/src/db";
import { seed } from "./seed";

try {
  const existingUsers = await prisma.user.count();
  if (existingUsers === 0) {
    console.log("Lantern database is empty; creating local starter data.");
    await seed();
  } else {
    console.log("Lantern database already contains data; seed skipped.");
  }
} finally {
  await prisma.$disconnect();
}

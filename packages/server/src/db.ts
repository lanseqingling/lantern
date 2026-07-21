import { PrismaClient } from "@prisma/client";
import { getRuntimePaths } from "./runtime-paths";

const globalForPrisma = globalThis as unknown as { lanternPrisma?: PrismaClient };

export const prisma = globalForPrisma.lanternPrisma ?? new PrismaClient({
  datasourceUrl: getRuntimePaths().databaseUrl,
  log: process.env.APP_ENV === "local" ? ["warn", "error"] : ["error"],
});

if (process.env.APP_ENV !== "production") globalForPrisma.lanternPrisma = prisma;

export async function initializeDatabaseConnection() {
  await prisma.$connect();
  await prisma.$executeRawUnsafe("PRAGMA foreign_keys = ON");
  await prisma.$queryRawUnsafe("PRAGMA busy_timeout = 5000");
  await prisma.$queryRawUnsafe("PRAGMA journal_mode = WAL");
}

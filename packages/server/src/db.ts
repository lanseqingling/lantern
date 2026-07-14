import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { lanternPrisma?: PrismaClient };

export const prisma = globalForPrisma.lanternPrisma ?? new PrismaClient({
  log: process.env.APP_ENV === "local" ? ["warn", "error"] : ["error"],
});

if (process.env.APP_ENV !== "production") globalForPrisma.lanternPrisma = prisma;

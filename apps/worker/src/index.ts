import "dotenv/config";
import { Worker } from "bullmq";
import { generationQueueName, createRedisConnection } from "../../../packages/server/src/queue";
import { processGenerationTask } from "../../../packages/agent-runtime/src/task-processor";
import { prisma } from "../../../packages/server/src/db";

const connection = createRedisConnection();
const worker = new Worker<{ taskId: string }>(
  generationQueueName,
  async (job) => processGenerationTask(job.data.taskId),
  { connection, concurrency: 2 },
);

worker.on("ready", () => console.log("Lantern worker ready"));
worker.on("failed", (job, error) => console.error("Lantern task failed", { jobId: job?.id, message: error.message }));

async function shutdown(signal: string) {
  console.log(`Lantern worker stopping (${signal})`);
  await worker.close();
  await connection.quit();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

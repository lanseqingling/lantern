import { Queue } from "bullmq";
import IORedis from "ioredis";
import { getConfig } from "./config";

export const generationQueueName = "lantern-generation";

export function createRedisConnection() {
  return new IORedis(getConfig().REDIS_URL, { maxRetriesPerRequest: null });
}

let queue: Queue | undefined;

export function getGenerationQueue() {
  queue ??= new Queue(generationQueueName, { connection: createRedisConnection() });
  return queue;
}

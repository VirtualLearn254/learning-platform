import IORedis from "ioredis";
import type { ConnectionOptions } from "bullmq";

import { env } from "../env.js";

/** Single Redis connection shared across all workers (BullMQ recommendation). */
export const workerConnection: ConnectionOptions = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
}) as unknown as ConnectionOptions;

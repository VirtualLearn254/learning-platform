/**
 * Queue topology.
 *
 * Each pipeline stage has its own BullMQ queue so we can scale workers
 * independently and observe each stage's throughput. A beat moves through:
 *
 *   ingest → author → ai_review → (human_review gate) → render → stitch → audit
 *
 * Beats progress per-beat, not per-lesson — so beat A's render can be
 * running while beat B is still in human-review.
 */

import { Queue, type ConnectionOptions } from "bullmq";
import IORedis from "ioredis";

import { env } from "../env.js";

export const QueueNames = {
  Ingest:     "ingest",      // course material → modules/sections/lessons/beats outline
  Author:     "author",      // generate beat HTML/CSS/JS
  AIReview:   "ai_review",   // automated per-beat review pass
  Holistic:   "holistic",    // cross-beat lesson review (post-author, pre-render gate)
  Render:     "render",      // hyperframes render → MP4
  Stitch:     "stitch",      // lesson-level: stitch all beats into master
  Audit:      "audit",       // post-stitch audit-toolkit pass
  ScormBuild: "scorm_build", // package master + assets → SCORM zip
} as const;

export type QueueName = (typeof QueueNames)[keyof typeof QueueNames];

// One connection shared across all queues (BullMQ recommendation).
const connection: ConnectionOptions = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
}) as unknown as ConnectionOptions;

function makeQueue<T = unknown>(name: QueueName): Queue<T> {
  return new Queue<T>(name, { connection });
}

export const queues = {
  ingest: makeQueue<{ courseId: string; materialId: string }>(QueueNames.Ingest),
  author: makeQueue<{ beatId: string; isRevision: boolean }>(QueueNames.Author),
  aiReview: makeQueue<{ beatId: string }>(QueueNames.AIReview),
  holistic: makeQueue<{ lessonId: string }>(QueueNames.Holistic),
  render: makeQueue<{ beatId: string }>(QueueNames.Render),
  stitch: makeQueue<{ lessonId: string }>(QueueNames.Stitch),
  audit: makeQueue<{ lessonId: string }>(QueueNames.Audit),
  scormBuild: makeQueue<{ lessonId: string }>(QueueNames.ScormBuild),
} as const;

export type Queues = typeof queues;

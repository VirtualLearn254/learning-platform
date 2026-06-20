/**
 * Stitch worker — combines per-beat MP4s into the lesson master.
 * Alt beats are excluded from the master (they're loaded on-demand
 * by the player for scenario branching).
 */

import { Worker } from "bullmq";
import { eq, asc } from "drizzle-orm";

import { db, tables } from "../db/index.js";
import { QueueNames, queues } from "../queue/index.js";
import { workerConnection } from "./connection.js";
import { renderEngine } from "./services.js";

interface JobData { lessonId: string }

export function startStitchWorker() {
  return new Worker<JobData>(QueueNames.Stitch, async (job) => {
    const { lessonId } = job.data;
    const beats = await db.select().from(tables.beats)
      .where(eq(tables.beats.lessonId, lessonId))
      .orderBy(asc(tables.beats.order));
    const mainBeats = beats.filter((b) => !b.isAlt && b.mp4Key);

    const stitchResult = await renderEngine.stitchLesson({
      lessonId,
      beatMp4Keys: mainBeats.map((b) => b.mp4Key!),
      outputKey: `lessons/${lessonId}/master.mp4`,
    });

    await db.update(tables.lessons).set({
      masterMp4Key: stitchResult.masterMp4Key,
    }).where(eq(tables.lessons.id, lessonId));

    // Mark all main beats as stitched.
    for (const beat of mainBeats) {
      await db.update(tables.beats).set({ stage: "stitched" }).where(eq(tables.beats.id, beat.id));
    }

    await queues.audit.add("audit-lesson", { lessonId });
  }, { connection: workerConnection, concurrency: 1 });
}

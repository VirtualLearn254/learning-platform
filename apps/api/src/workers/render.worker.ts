/**
 * Render worker — produces the per-beat MP4 from the approved HTML.
 * On success, checks if the entire lesson is ready to stitch.
 */

import { Worker } from "bullmq";
import { eq, and } from "drizzle-orm";

import { db, tables } from "../db/index.js";
import { QueueNames, queues } from "../queue/index.js";
import { workerConnection } from "./connection.js";
import { renderEngine } from "./services.js";

interface JobData { beatId: string }

export function startRenderWorker() {
  return new Worker<JobData>(QueueNames.Render, async (job) => {
    const { beatId } = job.data;
    const beat = await db.query.beats.findFirst({ where: eq(tables.beats.id, beatId) });
    if (!beat) throw new Error(`Beat ${beatId} not found`);

    await db.update(tables.beats).set({ stage: "rendering", status: "running" }).where(eq(tables.beats.id, beatId));

    const ttsResult = await renderEngine.tts({
      text: beat.script,
      voice: { language: "en", voice: "onyx", speed: 0.95 },
      outputKey: `beats/${beatId}/audio.wav`,
    });
    const renderResult = await renderEngine.renderBeat({
      beatKey: beat.beatKey,
      html: "",  // would fetch by htmlKey
      audioKey: ttsResult.audioKey,
      outputKey: `beats/${beatId}/${beat.beatKey}.mp4`,
    });

    await db.update(tables.beats).set({
      audioKey: ttsResult.audioKey,
      mp4Key: renderResult.mp4Key,
      durationSeconds: renderResult.durationSeconds,
      stage: "approved",  // render is the last per-beat stage; awaiting stitch
      status: "succeeded",
      updatedAt: new Date(),
    }).where(eq(tables.beats.id, beatId));

    // Check if all beats in the lesson are now rendered and approved.
    const siblings = await db.select().from(tables.beats).where(eq(tables.beats.lessonId, beat.lessonId));
    const allReady = siblings.every((b) =>
      b.stage === "approved" || b.stage === "stitched" || b.stage === "published"
    );
    if (allReady) {
      await queues.stitch.add("stitch-lesson", { lessonId: beat.lessonId });
    }
  }, { connection: workerConnection, concurrency: 2 }); // RAM-bound — kept low
}

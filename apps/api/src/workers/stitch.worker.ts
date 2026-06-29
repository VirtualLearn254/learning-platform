/**
 * Stitch worker — concatenates all main-beat MP4s in a lesson into
 * a single master video. Alt beats stay separate (used on demand
 * by the player for scenario branching).
 *
 * Pipeline:
 *   1. Load lesson's main beats ordered by `order`
 *   2. Download each beat MP4 from S3
 *   3. ffmpeg concat (re-encoded to libx264+aac for safety)
 *   4. Upload master MP4 to S3
 *   5. Update lesson.masterMp4Key + durationSeconds
 *   6. Mark all beats as `stitched`
 */

import { Worker } from "bullmq";
import { eq, asc } from "drizzle-orm";

import { db, tables } from "../db/index.js";
import { QueueNames, queues } from "../queue/index.js";
import { workerConnection } from "./connection.js";
import { s3 } from "../lib/s3.js";
import { concatMp4s } from "../lib/render.js";

interface JobData { lessonId: string }

export function startStitchWorker() {
  return new Worker<JobData>(QueueNames.Stitch, async (job) => {
    const { lessonId } = job.data;
    console.log(`[stitch] start lesson=${lessonId}`);

    const [jobRow] = await db.insert(tables.jobs).values({
      queue: "stitch",
      lessonId,
      status: "running",
      progressNote: "loading beats",
      startedAt: new Date(),
    }).returning();
    const jobId = jobRow!.id;

    async function note(text: string) {
      console.log(`[stitch:${jobId.slice(0, 8)}] ${text}`);
      await db.update(tables.jobs).set({ progressNote: text }).where(eq(tables.jobs.id, jobId));
    }
    async function fail(err: unknown): Promise<never> {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[stitch:${jobId.slice(0, 8)}] FAILED:`, msg);
      await db.update(tables.jobs).set({
        status: "failed", progressNote: "failed",
        errorMessage: msg.slice(0, 2000), endedAt: new Date(),
      }).where(eq(tables.jobs.id, jobId));
      throw err;
    }

    try {
      const beats = await db.select().from(tables.beats)
        .where(eq(tables.beats.lessonId, lessonId))
        .orderBy(asc(tables.beats.order));
      const main = beats.filter((b) => !b.isAlt && b.mp4Key);

      if (main.length === 0) return await fail(new Error("No main-beat MP4s found for this lesson"));

      await note(`downloading ${main.length} beat MP4s from storage`);
      const inputs: Buffer[] = [];
      let totalSize = 0;
      for (let i = 0; i < main.length; i++) {
        const b = main[i]!;
        const obj = await s3.getObject(b.mp4Key!);
        inputs.push(Buffer.from(obj.body));
        totalSize += obj.body.length;
        await note(`downloaded ${i + 1}/${main.length} · ${(totalSize / 1024 / 1024).toFixed(1)} MB so far`);
      }

      await note(`concatenating ${main.length} beats with ffmpeg`);
      const { mp4, durationSec } = await concatMp4s(inputs);
      await note(`master ${(mp4.length / 1024 / 1024).toFixed(2)} MB · ${durationSec.toFixed(1)}s`);

      const masterKey = `lessons/${lessonId}/master.mp4`;
      await s3.putObject(masterKey, mp4, { contentType: "video/mp4" });

      await db.update(tables.lessons).set({
        masterMp4Key: masterKey,
      }).where(eq(tables.lessons.id, lessonId));

      // Mark all main beats as stitched.
      for (const beat of main) {
        await db.update(tables.beats).set({
          stage: "stitched", updatedAt: new Date(),
        }).where(eq(tables.beats.id, beat.id));
      }

      await db.update(tables.jobs).set({
        status: "succeeded",
        progressNote: `done · ${main.length} beats · ${durationSec.toFixed(1)}s · ${(mp4.length / 1024 / 1024).toFixed(1)} MB`,
        endedAt: new Date(),
      }).where(eq(tables.jobs.id, jobId));

      console.log(`[stitch] DONE lesson=${lessonId} duration=${durationSec.toFixed(1)}s`);

      // Hand off to audit (stub today; will become the holistic-review gate).
      await queues.audit.add("audit-lesson", { lessonId });

      return { lessonId, masterKey, durationSec };
    } catch (err) {
      return await fail(err);
    }
  }, { connection: workerConnection, concurrency: 1 });
}

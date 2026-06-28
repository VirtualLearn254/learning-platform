/**
 * Render worker — produces the per-beat MP4.
 *
 * Pipeline per beat:
 *   1. Build HTML from script + visualSpec
 *   2. Headless Chromium screenshots 1920x1080 PNG
 *   3. OpenAI TTS narrates the script to MP3
 *   4. ffmpeg loops the PNG over the audio duration -> H.264 + AAC MP4
 *   5. Upload both audio + mp4 to S3, update beat row
 *
 * Tracks live progress in jobs table. Concurrency capped at 2 since each
 * job spawns Chromium + ffmpeg (RAM- and CPU-bound).
 *
 * After a beat lands, checks if all sibling beats are rendered and queues
 * the lesson stitch if so.
 */

import { Worker } from "bullmq";
import { eq } from "drizzle-orm";

import { db, tables } from "../db/index.js";
import { QueueNames, queues } from "../queue/index.js";
import { workerConnection } from "./connection.js";
import { s3 } from "../lib/s3.js";
import { synthesize } from "../lib/tts.js";
import { htmlToPng, assembleMp4 } from "../lib/render.js";
import { buildBeatHtml } from "../lib/beat-html.js";

interface JobData { beatId: string }

export function startRenderWorker() {
  return new Worker<JobData>(QueueNames.Render, async (job) => {
    const { beatId } = job.data;
    console.log(`[render] start beat=${beatId}`);

    const [jobRow] = await db.insert(tables.jobs).values({
      queue: "render",
      beatId,
      status: "running",
      progressNote: "starting",
      startedAt: new Date(),
    }).returning();
    const jobId = jobRow!.id;

    async function note(text: string) {
      console.log(`[render:${jobId.slice(0, 8)}] ${text}`);
      await db.update(tables.jobs).set({ progressNote: text }).where(eq(tables.jobs.id, jobId));
    }
    async function fail(err: unknown): Promise<never> {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[render:${jobId.slice(0, 8)}] FAILED:`, msg);
      await db.update(tables.jobs).set({
        status: "failed", progressNote: "failed",
        errorMessage: msg.slice(0, 2000), endedAt: new Date(),
      }).where(eq(tables.jobs.id, jobId));
      await db.update(tables.beats).set({
        status: "failed", errorMessage: msg.slice(0, 2000), updatedAt: new Date(),
      }).where(eq(tables.beats.id, beatId));
      throw err;
    }

    try {
      const beat = await db.query.beats.findFirst({ where: eq(tables.beats.id, beatId) });
      if (!beat) return await fail(new Error(`Beat ${beatId} not found`));

      // Fetch lesson title for the HTML header (purely cosmetic)
      const lesson = await db.query.lessons.findFirst({ where: eq(tables.lessons.id, beat.lessonId) });
      const lessonTitle = lesson?.title ?? "";

      await db.update(tables.beats).set({
        stage: "rendering", status: "running", errorMessage: null, updatedAt: new Date(),
      }).where(eq(tables.beats.id, beatId));

      // 1. Build HTML + screenshot
      await note("rendering HTML to PNG");
      const visual = (beat.visualSpec ?? {}) as { background?: string; onScreenText?: string[]; callouts?: string[] };
      const html = buildBeatHtml({
        beatKey: beat.beatKey,
        beatType: beat.beatType,
        lessonTitle,
        onScreenText: visual.onScreenText ?? [],
        callouts: visual.callouts ?? [],
        background: (visual.background as "solid" | "ai_image" | "stock_image") ?? "solid",
      });
      const png = await htmlToPng(html);
      await note(`PNG ${(png.length / 1024).toFixed(0)} KB`);

      // 2. TTS
      const words = beat.script.trim().split(/\s+/).length;
      await note(`synthesising narration (${words} words)`);
      const { audio: mp3, durationSec } = await synthesize(beat.script, { voice: "onyx", speed: 0.95 });
      await note(`audio ${(mp3.length / 1024).toFixed(0)} KB · ${durationSec.toFixed(1)}s`);

      // 3. Upload audio
      const audioKey = `beats/${beatId}/audio.mp3`;
      await s3.putObject(audioKey, mp3, { contentType: "audio/mpeg" });

      // 4. Assemble MP4
      await note(`assembling MP4 (${durationSec.toFixed(1)}s)`);
      const mp4 = await assembleMp4({ framePng: png, audioMp3: mp3, durationSec });
      await note(`MP4 ${(mp4.length / 1024 / 1024).toFixed(2)} MB`);

      // 5. Upload MP4
      const mp4Key = `beats/${beatId}/${beat.beatKey}.mp4`;
      await s3.putObject(mp4Key, mp4, { contentType: "video/mp4" });

      // 6. Update beat
      await db.update(tables.beats).set({
        audioKey,
        mp4Key,
        durationSeconds: Math.round(durationSec),
        stage: "approved", // render is the last per-beat stage; lesson stitch is next
        status: "succeeded",
        updatedAt: new Date(),
      }).where(eq(tables.beats.id, beatId));

      await db.update(tables.jobs).set({
        status: "succeeded",
        progressNote: `done · ${durationSec.toFixed(1)}s · ${(mp4.length / 1024 / 1024).toFixed(1)} MB`,
        endedAt: new Date(),
      }).where(eq(tables.jobs.id, jobId));

      // 7. If all beats in lesson are rendered, queue the stitch.
      const siblings = await db.select().from(tables.beats).where(eq(tables.beats.lessonId, beat.lessonId));
      const allReady = siblings.every((b) =>
        b.stage === "approved" || b.stage === "stitched" || b.stage === "published"
      );
      if (allReady) {
        await queues.stitch.add("stitch-lesson", { lessonId: beat.lessonId });
      }

      console.log(`[render] DONE beat=${beatId} duration=${durationSec.toFixed(1)}s`);
      return { beatId, durationSec, audioKey, mp4Key };
    } catch (err) {
      return await fail(err);
    }
  }, { connection: workerConnection, concurrency: 2 });
}

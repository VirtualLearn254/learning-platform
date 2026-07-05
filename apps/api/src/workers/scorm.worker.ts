/**
 * SCORM build worker — packages the lesson's master MP4 into a
 * SCORM 2004 4th-Edition zip ready for import into Moodle, Cornerstone,
 * Docebo, or any conforming LMS.
 *
 * Flow:
 *   1. Load lesson + beats
 *   2. Download master.mp4 from S3
 *   3. Call packager.build() → returns zip bytes
 *   4. Upload zip to `lessons/<id>/lesson.scorm.zip`
 *   5. Update lesson.scormPackageKey + publishedAt
 *   6. Mark main beats as `published`
 *   7. Notify
 */

import { Worker } from "bullmq";
import { eq, asc } from "drizzle-orm";

import { db, tables } from "../db/index.js";
import { QueueNames } from "../queue/index.js";
import { workerConnection } from "./connection.js";
import { s3 } from "../lib/s3.js";
import { scormPackager, notifications } from "./services.js";

interface JobData { lessonId: string }

export function startScormWorker() {
  return new Worker<JobData>(QueueNames.ScormBuild, async (job) => {
    const { lessonId } = job.data;
    console.log(`[scorm] start lesson=${lessonId}`);

    const [jobRow] = await db.insert(tables.jobs).values({
      queue: "scorm_build",
      lessonId,
      status: "running",
      progressNote: "loading lesson",
      startedAt: new Date(),
    }).returning();
    const jobId = jobRow!.id;

    async function note(text: string) {
      console.log(`[scorm:${jobId.slice(0, 8)}] ${text}`);
      await db.update(tables.jobs).set({ progressNote: text }).where(eq(tables.jobs.id, jobId));
    }
    async function fail(err: unknown): Promise<never> {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[scorm:${jobId.slice(0, 8)}] FAILED:`, msg);
      await db.update(tables.jobs).set({
        status: "failed", progressNote: "failed",
        errorMessage: msg.slice(0, 2000), endedAt: new Date(),
      }).where(eq(tables.jobs.id, jobId));
      throw err;
    }

    try {
      const lesson = await db.query.lessons.findFirst({ where: eq(tables.lessons.id, lessonId) });
      if (!lesson) return await fail(new Error(`Lesson ${lessonId} not found`));
      if (!lesson.masterMp4Key) return await fail(new Error(`Lesson ${lessonId} has no master MP4 — stitch first`));

      const beats = await db.select().from(tables.beats)
        .where(eq(tables.beats.lessonId, lessonId))
        .orderBy(asc(tables.beats.order));

      await note(`downloading master mp4`);
      const master = await s3.getObject(lesson.masterMp4Key);
      const masterBuf = Buffer.from(master.body);

      // Interactive quiz cues: quiz beats pause the player near the END of
      // their segment (the narration poses the question first). Offsets come
      // from cumulative beat durations in stitch order.
      const mainBeats = beats.filter((b) => !b.isAlt);
      const quizzes: Array<{ atSec: number; beatKey: string; quiz: { type: string; question: string; options: Array<{ id: string; text: string; isCorrect?: boolean; feedback?: string }> } }> = [];
      let offset = 0;
      for (const b of mainBeats) {
        const dur = b.durationSeconds ?? 0;
        const quiz = b.quiz as { type?: string; question?: string; options?: Array<{ id: string; text: string; isCorrect?: boolean; feedback?: string }> } | null;
        if (quiz?.question && Array.isArray(quiz.options) && quiz.options.length >= 2) {
          quizzes.push({
            atSec: Math.max(0, offset + dur - 0.4),
            beatKey: b.beatKey,
            quiz: { type: quiz.type ?? "multiple_choice", question: quiz.question, options: quiz.options },
          });
        }
        offset += dur;
      }
      await note(`master ${(masterBuf.length / 1024 / 1024).toFixed(2)} MB · ${quizzes.length} quiz cue(s) · building zip`);

      const built = await scormPackager.build({
        lesson: { id: lesson.id, title: lesson.title, summary: lesson.summary },
        beats: beats as never,
        masterMp4: masterBuf,
        quizzes,
        branding: { organizationName: "Learning Platform" },
        version: "2004_4",
      });

      const zipKey = `lessons/${lessonId}/lesson.scorm.zip`;
      await note(`uploading ${(built.sizeBytes / 1024 / 1024).toFixed(2)} MB zip · sha256=${built.sha256.slice(0, 12)}…`);
      await s3.putObject(zipKey, built.zip, { contentType: "application/zip" });

      await db.update(tables.lessons).set({
        scormPackageKey: zipKey,
        publishedAt: new Date(),
      }).where(eq(tables.lessons.id, lessonId));

      for (const beat of beats.filter((b) => !b.isAlt)) {
        await db.update(tables.beats).set({
          stage: "published", updatedAt: new Date(),
        }).where(eq(tables.beats.id, beat.id));
      }

      await db.update(tables.jobs).set({
        status: "succeeded",
        progressNote: `done · ${(built.sizeBytes / 1024 / 1024).toFixed(2)} MB · sha256=${built.sha256.slice(0, 12)}…`,
        endedAt: new Date(),
      }).where(eq(tables.jobs.id, jobId));

      console.log(`[scorm] DONE lesson=${lessonId} zipKey=${zipKey} size=${built.sizeBytes}`);

      await notifications.dispatch(["in_app", "telegram"], {
        kind: "lesson.published",
        body: `Lesson "${lesson.title}" is published and SCORM-ready.`,
        url: `/lessons/${lessonId}`,
      }).catch((e) => console.warn(`[scorm] notify failed:`, e));

      return { lessonId, scormPackageKey: zipKey, sizeBytes: built.sizeBytes, sha256: built.sha256 };
    } catch (err) {
      return await fail(err);
    }
  }, { connection: workerConnection, concurrency: 2 });
}

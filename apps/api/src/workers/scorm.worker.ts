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
import { buildLessonPdfs } from "../lib/pdf.js";
import { getStylePalette } from "../lib/hf-designer.js";
import { ensureQuizSkin } from "../lib/quiz-skin.js";
import { getAIClient } from "../lib/ai_client.js";
import { scormPackager, notifications } from "./services.js";

type PdfQuiz = { question?: string; options?: Array<{ id: string; text: string; isCorrect?: boolean; feedback?: string }> } | null;

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
      // from cumulative beat durations in stitch order. Each cue carries the
      // beat's style palette so the quiz scene renders in the SAME colors as
      // the video it interrupts — seamless takeover, not a popup.
      const lessonStyle = (lesson.styleHints ?? null) as { style?: string } | null;
      const mainBeats = beats.filter((b) => !b.isAlt);
      // Beat-key → master-video start second, for adaptivity targets.
      const beatStart: Record<string, number> = {};
      {
        let acc = 0;
        for (const b of mainBeats) {
          beatStart[b.beatKey] = acc;
          acc += b.durationSeconds ?? 0;
        }
      }
      type QuizAdaptivity = {
        wrong?: { rewatchBeatKey?: string; seekToSec?: number; message?: string; maxAttempts?: number; allowOptOut?: boolean };
        correct?: { skipToBeatKey?: string; seekToSec?: number; seekLabel?: string };
      };
      const quizzes: Array<{
        atSec: number; beatKey: string;
        quiz: { type: string; question: string; options: Array<{ id: string; text: string; isCorrect?: boolean; feedback?: string }>; correctFeedback?: string; wrongFeedback?: string };
        style: ReturnType<typeof getStylePalette>;
        retry?: { atSec: number; message?: string; maxAttempts: number; allowOptOut: boolean };
        advance?: { atSec: number; label?: string };
      }> = [];
      let offset = 0;
      for (const b of mainBeats) {
        const dur = b.durationSeconds ?? 0;
        const quiz = b.quiz as { type?: string; question?: string; options?: Array<{ id: string; text: string; isCorrect?: boolean; feedback?: string }>; correctFeedback?: string; wrongFeedback?: string; adaptivity?: QuizAdaptivity } | null;
        if (quiz?.question && Array.isArray(quiz.options) && quiz.options.length >= 2) {
          const vis = (b.visualSpec ?? {}) as { style?: string };
          // Adaptivity (LP-12): wrong → rewatch & retry. Default with ZERO
          // authoring: rewind to the start of the quiz's own beat (the
          // narration that poses the question), one retry, opt-out allowed.
          const ad = quiz.adaptivity;
          const retryAt = ad?.wrong?.seekToSec
            ?? (ad?.wrong?.rewatchBeatKey ? beatStart[ad.wrong.rewatchBeatKey] : undefined)
            ?? offset; // own beat start
          const retry = {
            atSec: Math.max(0, retryAt),
            message: ad?.wrong?.message,
            maxAttempts: ad?.wrong?.maxAttempts ?? 1,
            allowOptOut: ad?.wrong?.allowOptOut ?? true,
          };
          const advanceAt = ad?.correct?.seekToSec
            ?? (ad?.correct?.skipToBeatKey ? beatStart[ad.correct.skipToBeatKey] : undefined);
          quizzes.push({
            atSec: Math.max(0, offset + dur - 0.4),
            beatKey: b.beatKey,
            quiz: {
              type: quiz.type ?? "multiple_choice",
              question: quiz.question,
              options: quiz.options,
              correctFeedback: quiz.correctFeedback,
              wrongFeedback: quiz.wrongFeedback,
            },
            style: getStylePalette(vis.style ?? lessonStyle?.style),
            ...(retry.maxAttempts > 0 ? { retry } : {}),
            ...(advanceAt != null ? { advance: { atSec: advanceAt, label: ad?.correct?.seekLabel } } : {}),
          });
        }
        offset += dur;
      }
      // Quiz skin (LP-15): per-lesson presentation generated by the designer
      // AI so quiz scenes align with the beats. Best-effort — lint failure or
      // AI trouble ships the palette default instead.
      let quizSkinCss: string | undefined;
      if (quizzes.length > 0) {
        try {
          await note("generating quiz skin");
          const ai = await getAIClient();
          quizSkinCss = await ensureQuizSkin(ai, lessonId, {
            lessonTitle: lesson.title,
            styleHint: lessonStyle?.style,
          }) ?? undefined;
        } catch (skinErr) {
          console.warn(`[scorm:${jobId.slice(0, 8)}] quiz skin failed (default styling ships):`, skinErr instanceof Error ? skinErr.message : skinErr);
        }
      }

      await note(`master ${(masterBuf.length / 1024 / 1024).toFixed(2)} MB · ${quizzes.length} quiz cue(s)${quizSkinCss ? " · skinned" : ""} · building zip`);

      const built = await scormPackager.build({
        lesson: { id: lesson.id, title: lesson.title, summary: lesson.summary },
        beats: beats as never,
        masterMp4: masterBuf,
        quizzes,
        branding: { organizationName: "Learning Platform" },
        quizSkinCss,
        version: "2004_4",
      });

      const zipKey = `lessons/${lessonId}/lesson.scorm.zip`;
      await note(`uploading ${(built.sizeBytes / 1024 / 1024).toFixed(2)} MB zip · sha256=${built.sha256.slice(0, 12)}…`);
      await s3.putObject(zipKey, built.zip, { contentType: "application/zip" });

      // Shareable interactive preview: the SAME player, hosted unzipped so a
      // plain browser link plays the video with quizzes — no LMS required.
      // The video src points at the existing master object (no duplication);
      // scorm-api.js resolves relative to the preview folder. Without an LMS
      // API present the player runs in standalone mode.
      const previewHtml = built.playerHtml.replace(
        'src="master.mp4"',
        `src="/api/files/${lesson.masterMp4Key}"`,
      );
      await Promise.all([
        s3.putObject(`lessons/${lessonId}/preview/index.html`, Buffer.from(previewHtml, "utf-8"), { contentType: "text/html; charset=utf-8" }),
        s3.putObject(`lessons/${lessonId}/preview/scorm-api.js`, Buffer.from(built.scormApiJs, "utf-8"), { contentType: "application/javascript" }),
      ]);
      await note("interactive preview uploaded");

      // PDF companions: reading companion + instructor summary/answer key.
      // Best-effort — a PDF failure never blocks the SCORM publish.
      try {
        await note("building PDF companions");
        const pdfs = await buildLessonPdfs({
          lessonTitle: lesson.title,
          summary: lesson.summary,
          organizationName: "Learning Platform",
          beats: mainBeats.map((b) => {
            const vis = (b.visualSpec ?? {}) as { onScreenText?: string[]; callouts?: string[] };
            return {
              beatKey: b.beatKey,
              beatType: b.beatType,
              script: b.script,
              onScreenText: vis.onScreenText ?? [],
              callouts: vis.callouts ?? [],
              quiz: b.quiz as PdfQuiz,
            };
          }),
        });
        await Promise.all([
          s3.putObject(`lessons/${lessonId}/content.pdf`, pdfs.content, { contentType: "application/pdf" }),
          s3.putObject(`lessons/${lessonId}/summary.pdf`, pdfs.summary, { contentType: "application/pdf" }),
        ]);
        await note(`PDFs uploaded (${(pdfs.content.length / 1024).toFixed(0)} KB + ${(pdfs.summary.length / 1024).toFixed(0)} KB)`);
      } catch (pdfErr) {
        console.warn(`[scorm:${jobId.slice(0, 8)}] PDF build failed (publish continues):`, pdfErr instanceof Error ? pdfErr.message : pdfErr);
      }

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

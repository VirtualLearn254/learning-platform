/**
 * Render worker — produces the per-beat MP4.
 *
 * Animated pipeline (default) per beat:
 *   1. OpenAI TTS narrates the script → MP3 + duration
 *   2. Designer AI profile authors a HyperFrames composition
 *      (HTML + CSS + GSAP timeline) timed to that duration
 *   3. @hyperframes/producer renders it frame-by-frame → H.264+AAC MP4
 *      (narration muxes in via the composition's <audio> clip)
 *   4. Upload audio + html + mp4 to S3, update beat row
 *
 * Fallback (designer lint failure or HF render crash): the original
 * static-frame path — template HTML → PNG → ffmpeg still-loop.
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
import { synthesize, transcribeWords } from "../lib/tts.js";
import { htmlToPng, assembleMp4 } from "../lib/render.js";
import { buildBeatHtmlHF, type BeatStyle } from "../lib/hf-templates.js";
import { designAnimatedBeat, type DesignBeatInput } from "../lib/hf-designer.js";
import { renderAnimatedMp4 } from "../lib/hf-render.js";
import { verifyComposition } from "../lib/hf-verifier.js";
import { getAIClient } from "../lib/ai_client.js";

interface JobData {
  beatId: string;
  /** Force the static-frame path (skip designer + HF). */
  staticOnly?: boolean;
}

/** Feature flag: animated render on by default; RENDER_MODE=static disables. */
const ANIMATED_ENABLED = (process.env.RENDER_MODE ?? "animated") !== "static";

export function startRenderWorker() {
  return new Worker<JobData>(QueueNames.Render, async (job) => {
    const { beatId, staticOnly } = job.data;
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

      // Lesson title + style hints feed the design step.
      const lesson = await db.query.lessons.findFirst({ where: eq(tables.lessons.id, beat.lessonId) });
      const lessonTitle = lesson?.title ?? "";
      const styleHints = (lesson?.styleHints ?? null) as { style?: string } | null;

      await db.update(tables.beats).set({
        stage: "rendering", status: "running", errorMessage: null, updatedAt: new Date(),
      }).where(eq(tables.beats.id, beatId));

      const visual = (beat.visualSpec ?? {}) as { onScreenText?: string[]; callouts?: string[]; style?: string };

      // 1. TTS first — the designer times everything to the narration.
      const words = beat.script.trim().split(/\s+/).length;
      await note(`synthesising narration (${words} words)`);
      const { audio: mp3, durationSec } = await synthesize(beat.script, { voice: "onyx", speed: 0.95 });
      await note(`audio ${(mp3.length / 1024).toFixed(0)} KB · ${durationSec.toFixed(1)}s`);

      const audioKey = `beats/${beatId}/audio.mp3`;
      await s3.putObject(audioKey, mp3, { contentType: "audio/mpeg" });

      // 2+3. Animated path with graceful fallback to the static frame.
      let mp4: Buffer | null = null;
      let htmlKey: string | null = null;
      let renderMode: "animated" | "static" = "static";

      if (ANIMATED_ENABLED && !staticOnly) {
        try {
          // DB-secrets AI client (anthropic + profile overrides + usage logging)
          // — same client the author/review workers use. The env-only client in
          // services.ts has no anthropic provider and must not be used here.
          const ai = await getAIClient();

          // Phase 2: whisper word timestamps — reveals anchor to spoken words.
          await note("aligning word timestamps (whisper)");
          const wordTimestamps = await transcribeWords(mp3);

          const designInput: DesignBeatInput = {
            beatKey: beat.beatKey,
            beatType: beat.beatType,
            lessonTitle,
            script: beat.script,
            onScreenText: visual.onScreenText ?? [],
            callouts: visual.callouts ?? [],
            audioDurationSec: durationSec,
            styleHint: visual.style ?? styleHints?.style,
            wordTimestamps,
          };
          const design = await designAnimatedBeat(ai, designInput, note);
          let finalHtml = design.html;

          // Phase 3: vision verifier — 3 sampled frames checked for overlap /
          // clipping / contrast before the expensive full render. One repair
          // round on P0; a still-failing repair falls through with a warning
          // (the human reviewer is the next gate).
          try {
            await note("verifying composition frames (vision)");
            const verdict = await verifyComposition(ai, finalHtml, durationSec);
            if (!verdict.pass) {
              const p0s = verdict.issues.filter((i) => i.severity === "P0");
              await note(`verifier found ${p0s.length} P0 issue(s) — repair round`);
              const repaired = await designAnimatedBeat(ai, {
                ...designInput,
                repairNotes: verdict.issues.map((i) => `- [${i.severity}] frame ${i.frame}: ${i.description} → ${i.fix}`).join("\n"),
              }, note);
              const recheck = await verifyComposition(ai, repaired.html, durationSec);
              if (recheck.pass) {
                finalHtml = repaired.html;
                await note("repair verified clean");
              } else {
                // Keep the better of the two: repaired if it reduced P0 count.
                const before = p0s.length;
                const after = recheck.issues.filter((i) => i.severity === "P0").length;
                if (after < before) finalHtml = repaired.html;
                await note(`verifier still sees ${Math.min(before, after)} P0(s) — proceeding, flagged for human review`);
              }
            } else if (verdict.issues.length > 0) {
              await note(`verifier: pass with ${verdict.issues.length} minor note(s)`);
            } else {
              await note("verifier: clean");
            }
          } catch (verr) {
            // Verifier is best-effort — never block the render on its failure.
            console.warn(`[render:${jobId.slice(0, 8)}] verifier errored (skipping):`, verr instanceof Error ? verr.message : verr);
          }

          htmlKey = `beats/${beatId}/composition.html`;
          await s3.putObject(htmlKey, Buffer.from(finalHtml, "utf8"), { contentType: "text/html" });

          await note(`rendering animated composition (${durationSec.toFixed(1)}s @ 30fps)`);
          let lastProgress = 0;
          mp4 = await renderAnimatedMp4({
            html: finalHtml,
            audioMp3: mp3,
            onProgress: (msg) => {
              // Throttle: HF emits many progress lines; persist one every ~5s.
              const now = Date.now();
              if (now - lastProgress > 5000) {
                lastProgress = now;
                note(`hf: ${msg.slice(0, 120)}`).catch(() => {});
              }
            },
          });
          renderMode = "animated";
          await note(`animated MP4 ${(mp4.length / 1024 / 1024).toFixed(2)} MB`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[render:${jobId.slice(0, 8)}] animated path failed, falling back to static:`, msg);
          await note(`animated failed (${msg.slice(0, 100)}) — falling back to static frame`);
          mp4 = null;
        }
      }

      if (!mp4) {
        // Static fallback: template HTML → PNG → still-loop MP4.
        await note("rendering static frame");
        const html = buildBeatHtmlHF({
          beatKey: beat.beatKey,
          beatType: beat.beatType,
          lessonTitle,
          onScreenText: visual.onScreenText ?? [],
          callouts: visual.callouts ?? [],
        }, undefined, visual.style as BeatStyle | undefined);
        const png = await htmlToPng(html);
        await note(`PNG ${(png.length / 1024).toFixed(0)} KB · assembling MP4`);
        mp4 = await assembleMp4({ framePng: png, audioMp3: mp3, durationSec });
        renderMode = "static";
      }

      // 4. Upload MP4 + update beat
      const mp4Key = `beats/${beatId}/${beat.beatKey}.mp4`;
      await s3.putObject(mp4Key, mp4, { contentType: "video/mp4" });

      await db.update(tables.beats).set({
        audioKey,
        mp4Key,
        htmlKey,
        durationSeconds: Math.round(durationSec),
        stage: "approved", // render is the last per-beat stage; lesson stitch is next
        status: "succeeded",
        updatedAt: new Date(),
      }).where(eq(tables.beats.id, beatId));

      await db.update(tables.jobs).set({
        status: "succeeded",
        progressNote: `done (${renderMode}) · ${durationSec.toFixed(1)}s · ${(mp4.length / 1024 / 1024).toFixed(1)} MB`,
        endedAt: new Date(),
      }).where(eq(tables.jobs.id, jobId));

      // 5. If all beats in lesson are rendered, queue the stitch.
      const siblings = await db.select().from(tables.beats).where(eq(tables.beats.lessonId, beat.lessonId));
      const allReady = siblings.every((b) =>
        b.stage === "approved" || b.stage === "stitched" || b.stage === "published"
      );
      if (allReady) {
        await queues.stitch.add("stitch-lesson", { lessonId: beat.lessonId });
      }

      console.log(`[render] DONE beat=${beatId} mode=${renderMode} duration=${durationSec.toFixed(1)}s`);
      return { beatId, durationSec, audioKey, mp4Key, renderMode };
    } catch (err) {
      return await fail(err);
    }
  }, { connection: workerConnection, concurrency: 2 });
}

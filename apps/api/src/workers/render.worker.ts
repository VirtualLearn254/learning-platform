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
import { verifyComposition, captureTimelineFrames, sampleTimes } from "../lib/hf-verifier.js";
import { getAIClient } from "../lib/ai_client.js";
import { ensureFresh, getProfileOverride } from "../lib/profiles_store.js";
import { getRulesBlock } from "../lib/rules.js";
import { ensureDesignBrief } from "../lib/design-brief.js";

interface JobData {
  beatId: string;
  /** Force the static-frame path (skip designer + HF). */
  staticOnly?: boolean;
  /** Reviewer's re-render correction (from the beat-page edit panel). */
  correctionNote?: string;
  /** S3 key of an attached reference/annotated image for the correction. */
  referenceImageKey?: string;
}

/** Feature flag: animated render on by default; RENDER_MODE=static disables. */
const ANIMATED_ENABLED = (process.env.RENDER_MODE ?? "animated") !== "static";

/** Is this a provider-availability failure (account/billing/quota/auth), as
 *  opposed to a content error? Such errors mean the designer is DOWN — we must
 *  not paper over them with a static frame for every beat. Matches the shapes
 *  Fireworks/Anthropic/OpenAI return: HTTP 401/402/403/429, plus the telltale
 *  billing phrases. */
function isProviderUnavailable(msg: string): boolean {
  return /\b(401|402|403|412|429)\b/.test(msg)
    || /suspend|spending limit|spend cap|quota|insufficient|billing|payment required|rate limit|over.?loaded|unauthorized|invalid api key|account is|provider unavailable|silently overspend/i.test(msg);
}

/** Parallel render jobs. 2 is the proven-stable setting for a 6vCPU/12GB box
 *  (4 caused ~9% Chrome crashes on this hardware class). 3 may work because
 *  each job spends 1-2 min in the network-bound design phase — raise via
 *  RENDER_CONCURRENCY and watch the failure rate on /activity. */
const RENDER_CONCURRENCY = Math.max(1, Math.min(6, Number(process.env.RENDER_CONCURRENCY ?? 2) || 2));

export function startRenderWorker() {
  return new Worker<JobData>(QueueNames.Render, async (job) => {
    const { beatId, staticOnly, correctionNote, referenceImageKey } = job.data;
    console.log(`[render] start beat=${beatId}${correctionNote ? " (with correction)" : ""}`);

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

      const visual = (beat.visualSpec ?? {}) as { onScreenText?: string[]; callouts?: string[]; style?: string; devices?: string[] };

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
      let animatedFailReason: string | null = null;

      if (ANIMATED_ENABLED && !staticOnly) {
        try {
          // DB-secrets AI client (anthropic + profile overrides + usage logging)
          // — same client the author/review workers use. The env-only client in
          // services.ts has no anthropic provider and must not be used here.
          const ai = await getAIClient();

          // Phase 2: whisper word timestamps — reveals anchor to spoken words.
          await note("aligning word timestamps (whisper)");
          const wordTimestamps = await transcribeWords(mp3);

          // Compact mode when the designer role runs on a tight output window
          // (deepseek caps ~8-16K; rich compositions need 10-15K on the full
          // contract). Auto-detected from the role's Settings override.
          await ensureFresh();
          const designerOverride = getProfileOverride("designer");
          const compact = designerOverride?.preferredProvider === "deepseek"
            || (designerOverride?.maxTokens != null && designerOverride.maxTokens < 12000);
          if (compact) await note("compact design mode (tight output window)");

          // Institutional memory: operator rules + the lesson-wide design brief.
          const operatorRules = await getRulesBlock("designer");
          const siblingKeys = (await db.select().from(tables.beats).where(eq(tables.beats.lessonId, beat.lessonId))).filter(b=>!b.isAlt).map(b=>b.beatKey);
          const designBrief = await ensureDesignBrief(ai, beat.lessonId, { lessonTitle, styleHint: visual.style ?? styleHints?.style, beatKeys: siblingKeys }) ?? undefined;

          // Reviewer correction (from the beat-page edit panel). A text note
          // goes straight to the designer; an attached reference/annotated
          // image is first turned into a precise instruction by the vision
          // verifier, then merged with the note — so the (text-only) designer
          // gets one clear fix. Best-effort: image failure falls back to text.
          let correction = correctionNote?.trim() || undefined;
          if (referenceImageKey) {
            try {
              await note("interpreting reference image (vision)");
              const img = await s3.getObject(referenceImageKey);
              const mediaType = referenceImageKey.toLowerCase().endsWith(".png") ? "image/png" as const : "image/jpeg" as const;
              const vis = await ai.vision("verifier", {
                meta: { beatId, lessonId: beat.lessonId },
                system: "You convert a reviewer's reference or annotated image (plus an optional note) into ONE precise visual instruction for a motion-graphics designer. Describe only the change to make — position, text, colour, size, what to add/remove. No preamble, one or two sentences.",
                prompt: `Beat "${beat.beatKey}". Reviewer note: ${correctionNote || "(the change is shown in the image)"}. State the exact visual change to apply.`,
                images: [{ base64: Buffer.from(img.body).toString("base64"), mediaType }],
              });
              correction = [correctionNote?.trim(), vis.text.trim()].filter(Boolean).join(" — ");
            } catch (imgErr) {
              console.warn(`[render:${jobId.slice(0, 8)}] reference-image vision failed, using text note only:`, imgErr instanceof Error ? imgErr.message : imgErr);
            }
          }
          if (correction) await note(`applying correction: ${correction.slice(0, 100)}`);

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
            compact,
            meta: { beatId, lessonId: beat.lessonId },
            operatorRules,
            designBrief,
            correction,
            devices: visual.devices,
          };
          const design = await designAnimatedBeat(ai, designInput, note);
          let finalHtml = design.html;

          // Phase 3: vision verifier — 3 sampled frames checked for overlap /
          // clipping / contrast before the expensive full render. Frames are
          // persisted to S3 so the beat page can show the human reviewer the
          // same evidence the AI judged. One repair round on P0; a
          // still-failing repair falls through flagged for human review.
          try {
            await note("verifying composition frames (vision)");
            let frames = await captureTimelineFrames(finalHtml, sampleTimes(durationSec));
            const verdict = await verifyComposition(ai, finalHtml, durationSec, frames, designInput.meta);
            if (!verdict.pass) {
              const p0s = verdict.issues.filter((i) => i.severity === "P0");
              await note(`verifier found ${p0s.length} P0 issue(s) — repair round`);
              const repaired = await designAnimatedBeat(ai, {
                ...designInput,
                repairNotes: verdict.issues.map((i) => `- [${i.severity}] frame ${i.frame}: ${i.description} → ${i.fix}`).join("\n"),
              }, note);
              const repairedFrames = await captureTimelineFrames(repaired.html, sampleTimes(durationSec));
              const recheck = await verifyComposition(ai, repaired.html, durationSec, repairedFrames, designInput.meta);
              if (recheck.pass) {
                finalHtml = repaired.html;
                frames = repairedFrames;
                await note("repair verified clean");
              } else {
                // Keep the better of the two: repaired if it reduced P0 count.
                const before = p0s.length;
                const after = recheck.issues.filter((i) => i.severity === "P0").length;
                if (after < before) { finalHtml = repaired.html; frames = repairedFrames; }
                await note(`verifier still sees ${Math.min(before, after)} P0(s) — proceeding, flagged for human review`);
              }
            } else if (verdict.issues.length > 0) {
              await note(`verifier: pass with ${verdict.issues.length} minor note(s)`);
            } else {
              await note("verifier: clean");
            }
            // Persist whichever frames match the final composition.
            await Promise.all(frames.map((f, i) =>
              s3.putObject(`beats/${beatId}/verify-${i + 1}.png`, f, { contentType: "image/png" }),
            ));
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
          // A PROVIDER-LEVEL failure (account suspended, spend cap, quota, rate
          // limit, auth) means the designer is unavailable — NOT that this beat
          // is unrenderable. Falling back to a static frame here would silently
          // mass-degrade every beat to a plain slide while the provider is down
          // (this is exactly what drained Fireworks unnoticed). Fail LOUD so the
          // render is retried/surfaced and no degraded beat is shipped. Content
          // errors (bad HTML, verify failures) still fall back to static below.
          if (isProviderUnavailable(msg)) {
            await note(`designer provider unavailable — refusing to ship a degraded static beat: ${msg.slice(0, 120)}`);
            throw new Error(`designer provider unavailable (no silent static fallback): ${msg.slice(0, 200)}`);
          }
          console.warn(`[render:${jobId.slice(0, 8)}] animated path failed (content), falling back to static:`, msg);
          animatedFailReason = msg.slice(0, 300);
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

      // 4. Upload MP4 + update beat. Keys are versioned per render:
      //  - old renders stay in S3 for side-by-side comparison in the UI
      //  - browsers can never serve a stale video from cache (same-URL
      //    overwrite was the cause of a "12s then jump to end" ghost bug)
      const mp4Key = `beats/${beatId}/renders/${Date.now()}-${renderMode}.mp4`;
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
        // Preserve WHY the animated path fell back — the progress note gets
        // overwritten as the job proceeds, and we keep losing the cause.
        errorMessage: animatedFailReason ? `animated fallback: ${animatedFailReason}` : null,
        endedAt: new Date(),
      }).where(eq(tables.jobs.id, jobId));

      // 5. If all beats in lesson are actually RENDERED, queue the stitch.
      // Gate on mp4Key (real render output), NOT stage: on autopilot,
      // ai-review sets every beat to "approved" the moment it passes review
      // — before rendering — so a stage-based check fires the instant the
      // FIRST beat renders and publishes a hook-only master. mp4Key is only
      // set here, when a render truly completes, so the last render to finish
      // triggers the stitch exactly once.
      const siblings = await db.select().from(tables.beats).where(eq(tables.beats.lessonId, beat.lessonId));
      const allReady = siblings.every((b) => b.isAlt || !!b.mp4Key);
      // An alt (branch) beat finishing must not re-stitch — it isn't in the
      // master. Its delivery path is the SCORM repackage (LP-18).
      if (allReady && !beat.isAlt) {
        await queues.stitch.add("stitch-lesson", { lessonId: beat.lessonId });
      }

      console.log(`[render] DONE beat=${beatId} mode=${renderMode} duration=${durationSec.toFixed(1)}s`);
      return { beatId, durationSec, audioKey, mp4Key, renderMode };
    } catch (err) {
      return await fail(err);
    }
  }, {
    connection: workerConnection,
    concurrency: RENDER_CONCURRENCY,
    // A render takes minutes; give the lock ample headroom so a busy worker
    // isn't mistaken for stalled, and let BullMQ re-queue an orphaned render
    // (deploy/kill mid-render) several times before giving up — the default
    // maxStalledCount:1 permanently FAILS a job orphaned by two deploys,
    // which wedges the course.
    lockDuration: 180_000,
    maxStalledCount: 5,
  });
}

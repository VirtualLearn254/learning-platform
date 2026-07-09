import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq, and, inArray, sql } from "drizzle-orm";

import { z } from "zod";

import { ProvideBeatFeedbackSchema, VisualSpecSchema, QuizSpecSchema, type BeatStage } from "@lp/shared";

const UpdateBeatSchema = z.object({
  script: z.string().optional(),
  visualSpec: VisualSpecSchema.optional(),
  quiz: QuizSpecSchema.nullable().optional(),
  conceptsTaught: z.array(z.string()).optional(),
  conceptsRequired: z.array(z.string()).optional(),
});

import { db, tables } from "../db/index.js";
import { queues } from "../queue/index.js";
import { breadcrumbsForBeat } from "../lib/breadcrumbs.js";
import { s3 } from "../lib/s3.js";
import { extractKeyframes } from "../lib/render.js";

export const beatsRoute = new Hono()
  .get("/", async (c) => {
    const stageFilter = c.req.query("stage")?.split(",") as BeatStage[] | undefined;
    const lessonId = c.req.query("lessonId");
    const conds = [
      stageFilter ? inArray(tables.beats.stage, stageFilter) : undefined,
      lessonId ? eq(tables.beats.lessonId, lessonId) : undefined,
    ].filter(Boolean);
    const where = conds.length > 0
      ? and(...conds as Parameters<typeof and>)
      : undefined;
    const rows = await db.select().from(tables.beats).where(where);
    return c.json({ beats: rows });
  })
  .get("/:id", async (c) => {
    const id = c.req.param("id");
    const beat = await db.query.beats.findFirst({ where: eq(tables.beats.id, id) });
    if (!beat) return c.json({ error: "not_found" }, 404);
    const breadcrumbs = await breadcrumbsForBeat(id);
    // AI spend attributed to this beat (designer + verifier calls carry meta).
    const [cost] = await db.select({ total: sql<string>`coalesce(sum(${tables.aiUsage.costUsd}), 0)` })
      .from(tables.aiUsage).where(eq(tables.aiUsage.beatId, id));
    return c.json({ beat, breadcrumbs, aiCostUsd: Number(cost?.total ?? 0) });
  })
  .get("/:id/renders", async (c) => {
    /** All rendered MP4 versions for this beat, newest first — powers the
     *  side-by-side render comparison. Keys are versioned per render. */
    const id = c.req.param("id");
    const objects = await s3.listObjects(`beats/${id}/renders/`, 50);
    const renders = objects
      .filter((o) => o.key.endsWith(".mp4"))
      .sort((a, b) => b.key.localeCompare(a.key)) // timestamp prefix → newest first
      .map((o) => {
        const file = o.key.split("/").pop() ?? "";
        const [ts, modeWithExt] = file.split("-");
        return {
          key: o.key,
          renderedAt: Number.isFinite(Number(ts)) ? new Date(Number(ts)).toISOString() : null,
          mode: modeWithExt?.replace(".mp4", "") ?? "unknown",
          sizeBytes: o.size,
        };
      });
    return c.json({ renders });
  })
  .post("/:id/author", async (c) => {
    const id = c.req.param("id");
    const beat = await db.query.beats.findFirst({ where: eq(tables.beats.id, id) });
    if (!beat) return c.json({ error: "not_found" }, 404);
    const job = await queues.author.add("author-beat", { beatId: id, isRevision: false });
    return c.json({ ok: true, jobId: job.id });
  })
  .post("/:id/render", async (c) => {
    const id = c.req.param("id");
    const beat = await db.query.beats.findFirst({ where: eq(tables.beats.id, id) });
    if (!beat) return c.json({ error: "not_found" }, 404);
    // Optional body: a reviewer correction to apply on this re-render.
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const correctionNote = typeof body.correctionNote === "string" ? body.correctionNote.slice(0, 2000) : undefined;
    const referenceImageKey = typeof body.referenceImageKey === "string" ? body.referenceImageKey : undefined;
    const job = await queues.render.add("render-beat", { beatId: id, correctionNote, referenceImageKey });
    return c.json({ ok: true, jobId: job.id });
  })
  .get("/:id/keyframes", async (c) => {
    /** The UNIQUE frames of the beat's video (scene-change detection), cached.
     *  Plus the 3 verify frames. Pure ffmpeg — no AI. */
    const id = c.req.param("id");
    const beat = await db.query.beats.findFirst({ where: eq(tables.beats.id, id) });
    if (!beat) return c.json({ error: "not_found" }, 404);
    const verifyFrames = [1, 2, 3].map((i) => ({ key: `beats/${id}/verify-${i}.png`, label: ["entrance", "hero", "settle"][i - 1]! }));
    if (!beat.mp4Key) return c.json({ frames: [], verifyFrames });
    const KEYFRAMES_VERSION = 2; // bump to invalidate all cached manifests
    const manifestKey = `beats/${id}/keyframes/manifest.json`;
    try {
      const m = JSON.parse(Buffer.from((await s3.getObject(manifestKey)).body).toString("utf8"));
      if (m.version === KEYFRAMES_VERSION && m.sourceMp4Key === beat.mp4Key) return c.json({ frames: m.frames, verifyFrames });
    } catch { /* stale or absent — regenerate */ }
    const mp4 = Buffer.from((await s3.getObject(beat.mp4Key)).body);
    const kf = await extractKeyframes(mp4);
    const frames: Array<{ key: string; timeSec: number }> = [];
    for (let i = 0; i < kf.length; i++) {
      const key = `beats/${id}/keyframes/kf-${String(i).padStart(3, "0")}.jpg`;
      await s3.putObject(key, kf[i]!.jpeg, { contentType: "image/jpeg" });
      frames.push({ key, timeSec: kf[i]!.timeSec });
    }
    await s3.putObject(manifestKey, Buffer.from(JSON.stringify({ version: KEYFRAMES_VERSION, sourceMp4Key: beat.mp4Key, frames })), { contentType: "application/json" });
    return c.json({ frames, verifyFrames });
  })
  .post("/:id/reference-image", async (c) => {
    /** Upload a reviewer's reference/annotated image for a correction. */
    const id = c.req.param("id");
    const beat = await db.query.beats.findFirst({ where: eq(tables.beats.id, id) });
    if (!beat) return c.json({ error: "not_found" }, 404);
    const form = await c.req.parseBody();
    const file = form["file"];
    if (!(file instanceof File)) return c.json({ error: "no file" }, 400);
    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.length > 8 * 1024 * 1024) return c.json({ error: "image too large (max 8MB)" }, 413);
    const isPng = file.type === "image/png" || file.name.toLowerCase().endsWith(".png");
    const key = `beats/${id}/corrections/${Date.now()}.${isPng ? "png" : "jpg"}`;
    await s3.putObject(key, buf, { contentType: isPng ? "image/png" : "image/jpeg" });
    return c.json({ ok: true, key });
  })
  .post("/:id/review", async (c) => {
    /** Re-run the per-beat AI review. */
    const id = c.req.param("id");
    const beat = await db.query.beats.findFirst({ where: eq(tables.beats.id, id) });
    if (!beat) return c.json({ error: "not_found" }, 404);
    const job = await queues.aiReview.add("review-beat", { beatId: id });
    return c.json({ ok: true, jobId: job.id });
  })
  .patch("/:id", zValidator("json", UpdateBeatSchema), async (c) => {
    const id = c.req.param("id");
    const input = c.req.valid("json");
    const [updated] = await db.update(tables.beats)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(tables.beats.id, id))
      .returning();
    if (!updated) return c.json({ error: "not_found" }, 404);
    return c.json({ beat: updated });
  })
  .post("/:id/feedback", zValidator("json", ProvideBeatFeedbackSchema), async (c) => {
    const id = c.req.param("id");
    const input = c.req.valid("json");
    const beat = await db.query.beats.findFirst({ where: eq(tables.beats.id, id) });
    if (!beat) return c.json({ error: "not_found" }, 404);

    await db.insert(tables.beatFeedback).values({
      beatId: id,
      feedback: input.feedback,
      screenshotKeys: input.screenshotKeys ?? [],
      action: input.action,
    });

    // State machine: feedback action determines the next stage.
    let nextStage: BeatStage = beat.stage;
    if (input.action === "approve") {
      nextStage = "approved";
    } else if (input.action === "revise") {
      nextStage = "revising";
      // Enqueue an author re-run with revision context.
      await queues.author.add("revise-beat", { beatId: id, isRevision: true });
    } else if (input.action === "reject") {
      // Reject = back to authoring from scratch.
      nextStage = "authoring";
      await queues.author.add("redo-beat", { beatId: id, isRevision: false });
    }

    await db.update(tables.beats)
      .set({ stage: nextStage, updatedAt: new Date(), revisionCount: beat.revisionCount + (input.action === "revise" ? 1 : 0) })
      .where(eq(tables.beats.id, id));

    return c.json({ ok: true, stage: nextStage });
  });

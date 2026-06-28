import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq, and, inArray } from "drizzle-orm";

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
    return c.json({ beat, breadcrumbs });
  })
  .post("/:id/author", async (c) => {
    const id = c.req.param("id");
    const beat = await db.query.beats.findFirst({ where: eq(tables.beats.id, id) });
    if (!beat) return c.json({ error: "not_found" }, 404);
    const job = await queues.author.add("author-beat", { beatId: id, isRevision: false });
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

import { Hono } from "hono";
import { eq, asc, inArray } from "drizzle-orm";

import { db, tables } from "../db/index.js";
import { queues } from "../queue/index.js";
import { breadcrumbsForLesson } from "../lib/breadcrumbs.js";

export const lessonsRoute = new Hono()
  .get("/:id", async (c) => {
    const id = c.req.param("id");
    const lesson = await db.query.lessons.findFirst({ where: eq(tables.lessons.id, id) });
    if (!lesson) return c.json({ error: "not_found" }, 404);
    const beats = await db.select().from(tables.beats)
      .where(eq(tables.beats.lessonId, id))
      .orderBy(asc(tables.beats.order));
    const breadcrumbs = await breadcrumbsForLesson(id);
    return c.json({ lesson, beats, breadcrumbs });
  })
  .post("/:id/author", async (c) => {
    /**
     * Queue every beat in this lesson for authoring. By default, only beats
     * still in "ingested" stage are queued (so you can re-run safely without
     * clobbering already-authored beats). Pass ?all=true to re-author every
     * beat from scratch.
     */
    const id = c.req.param("id");
    const all = c.req.query("all") === "true";
    const beats = await db.select().from(tables.beats)
      .where(eq(tables.beats.lessonId, id))
      .orderBy(asc(tables.beats.order));
    if (beats.length === 0) return c.json({ ok: false, error: "no beats in lesson" }, 400);

    const targets = all ? beats : beats.filter((b) => b.stage === "ingested" || b.stage === "queued");
    if (targets.length === 0) return c.json({ ok: true, queued: 0, message: "no beats need authoring (pass ?all=true to re-author)" });

    const jobIds: string[] = [];
    for (const beat of targets) {
      const job = await queues.author.add("author-beat", { beatId: beat.id, isRevision: false });
      if (job.id) jobIds.push(job.id);
    }
    return c.json({ ok: true, queued: targets.length, jobIds });
  })
  .post("/:id/render", async (c) => {
    /**
     * Queue every approved-or-earlier beat in this lesson for render.
     * By default, beats already rendered (with mp4Key) are skipped.
     * Pass ?all=true to re-render every beat from scratch.
     */
    const id = c.req.param("id");
    const all = c.req.query("all") === "true";
    const beats = await db.select().from(tables.beats)
      .where(eq(tables.beats.lessonId, id))
      .orderBy(asc(tables.beats.order));
    if (beats.length === 0) return c.json({ ok: false, error: "no beats in lesson" }, 400);

    // Only authored beats are eligible (need script + visualSpec).
    const eligible = beats.filter((b) =>
      b.stage === "ai_review" || b.stage === "human_review" || b.stage === "approved" ||
      b.stage === "rendering" || b.stage === "stitched" || b.stage === "published"
    );
    const targets = all ? eligible : eligible.filter((b) => !b.mp4Key);
    if (targets.length === 0) return c.json({ ok: true, queued: 0, message: "no beats need rendering (pass ?all=true to re-render)" });

    const jobIds: string[] = [];
    for (const beat of targets) {
      const job = await queues.render.add("render-beat", { beatId: beat.id });
      if (job.id) jobIds.push(job.id);
    }
    return c.json({ ok: true, queued: targets.length, jobIds });
  })
  .post("/:id/stitch", async (c) => {
    /** Manually trigger stitch (e.g. after a re-render fixes one beat). */
    const id = c.req.param("id");
    const job = await queues.stitch.add("manual-stitch", { lessonId: id });
    return c.json({ ok: true, jobId: job.id });
  })
  .post("/:id/publish", async (c) => {
    /** Build the SCORM package + PDFs. */
    const id = c.req.param("id");
    const job = await queues.scormBuild.add("manual-publish", { lessonId: id });
    return c.json({ ok: true, jobId: job.id });
  });

import { Hono } from "hono";
import { and, eq, asc, desc, inArray } from "drizzle-orm";

import { db, tables } from "../db/index.js";
import { queues } from "../queue/index.js";
import { breadcrumbsForLesson } from "../lib/breadcrumbs.js";

interface LessonJobSummary {
  id: string;
  queue: string;
  status: string;
  progressNote: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
}

async function latestJobForLesson(lessonId: string, queue: string): Promise<LessonJobSummary | null> {
  const [j] = await db.select().from(tables.jobs)
    .where(and(eq(tables.jobs.lessonId, lessonId), eq(tables.jobs.queue, queue)))
    .orderBy(desc(tables.jobs.createdAt))
    .limit(1);
  if (!j) return null;
  return {
    id: j.id, queue: j.queue, status: j.status,
    progressNote: j.progressNote, errorMessage: j.errorMessage,
    startedAt: j.startedAt?.toISOString() ?? null,
    endedAt: j.endedAt?.toISOString() ?? null,
    createdAt: j.createdAt.toISOString(),
  };
}

export const lessonsRoute = new Hono()
  .get("/:id", async (c) => {
    const id = c.req.param("id");
    const lesson = await db.query.lessons.findFirst({ where: eq(tables.lessons.id, id) });
    if (!lesson) return c.json({ error: "not_found" }, 404);
    const beats = await db.select().from(tables.beats)
      .where(eq(tables.beats.lessonId, id))
      .orderBy(asc(tables.beats.order));
    const breadcrumbs = await breadcrumbsForLesson(id);
    const [stitchJob, scormJob] = await Promise.all([
      latestJobForLesson(id, "stitch"),
      latestJobForLesson(id, "scorm_build"),
    ]);
    return c.json({ lesson, beats, breadcrumbs, stitchJob, scormJob });
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
  .post("/:id/holistic-review", async (c) => {
    /** Queue a cross-beat lesson review. Reads all main beats and asks Claude
     *  holistic profile to flag narrative continuity / repetition / pacing issues. */
    const id = c.req.param("id");
    const lesson = await db.query.lessons.findFirst({ where: eq(tables.lessons.id, id) });
    if (!lesson) return c.json({ error: "not_found" }, 404);
    const job = await queues.holistic.add("holistic-review", { lessonId: id });
    return c.json({ ok: true, jobId: job.id });
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

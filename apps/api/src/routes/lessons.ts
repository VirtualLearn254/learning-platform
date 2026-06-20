import { Hono } from "hono";
import { eq, asc } from "drizzle-orm";

import { db, tables } from "../db/index.js";
import { queues } from "../queue/index.js";

export const lessonsRoute = new Hono()
  .get("/:id", async (c) => {
    const id = c.req.param("id");
    const lesson = await db.query.lessons.findFirst({ where: eq(tables.lessons.id, id) });
    if (!lesson) return c.json({ error: "not_found" }, 404);
    const beats = await db.select().from(tables.beats)
      .where(eq(tables.beats.lessonId, id))
      .orderBy(asc(tables.beats.order));
    return c.json({ lesson, beats });
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

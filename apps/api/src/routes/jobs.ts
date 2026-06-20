import { Hono } from "hono";
import { eq, desc, and } from "drizzle-orm";

import { db, tables } from "../db/index.js";

export const jobsRoute = new Hono()
  .get("/", async (c) => {
    const beatId = c.req.query("beatId");
    const lessonId = c.req.query("lessonId");
    const status = c.req.query("status");
    const where = and(
      ...[
        beatId ? eq(tables.jobs.beatId, beatId) : undefined,
        lessonId ? eq(tables.jobs.lessonId, lessonId) : undefined,
        status ? eq(tables.jobs.status, status) : undefined,
      ].filter(Boolean) as never,
    );
    const rows = await db.select().from(tables.jobs)
      .where(where as never)
      .orderBy(desc(tables.jobs.createdAt))
      .limit(100);
    return c.json({ jobs: rows });
  })
  .get("/:id", async (c) => {
    const id = c.req.param("id");
    const job = await db.query.jobs.findFirst({ where: eq(tables.jobs.id, id) });
    if (!job) return c.json({ error: "not_found" }, 404);
    return c.json({ job });
  });

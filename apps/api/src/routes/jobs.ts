import { Hono } from "hono";
import { eq, desc, and, lt } from "drizzle-orm";

import { db, tables } from "../db/index.js";
import { queues } from "../queue/index.js";

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
  })
  /**
   * Mark stuck "running" jobs as failed and drain the BullMQ queue.
   * Use when a worker crash leaves jobs orphaned. Idempotent + safe.
   * Optional query: ?queue=render to restrict to one queue.
   */
  .post("/cleanup-stuck", async (c) => {
    const queue = c.req.query("queue");
    const olderThanMin = Number(c.req.query("olderThanMin") ?? "2");
    const cutoff = new Date(Date.now() - olderThanMin * 60 * 1000);

    const where = and(
      eq(tables.jobs.status, "running"),
      lt(tables.jobs.startedAt, cutoff),
      ...(queue ? [eq(tables.jobs.queue, queue)] : []),
    );
    const stuck = await db.select().from(tables.jobs).where(where as never);
    if (stuck.length > 0) {
      await db.update(tables.jobs).set({
        status: "failed",
        progressNote: "cleared as stuck",
        errorMessage: "Marked failed by /jobs/cleanup-stuck — worker likely crashed mid-job.",
        endedAt: new Date(),
      }).where(where as never);
      // Reset the affected beats so the user can retry them.
      const beatIds = stuck.map((j) => j.beatId).filter((id): id is string => !!id);
      for (const bid of beatIds) {
        await db.update(tables.beats).set({
          status: "failed",
          stage: "ai_review", // back to last good state before render
          errorMessage: "Worker crashed during render — click Render to retry.",
          updatedAt: new Date(),
        }).where(eq(tables.beats.id, bid));
      }
    }

    // Drain any active jobs in the BullMQ render queue that are now orphans.
    const drainedQueues: string[] = [];
    const queuesToDrain = queue ? [queue] : Object.keys(queues);
    for (const qname of queuesToDrain) {
      const q = (queues as Record<string, { obliterate: (opts: { force: boolean }) => Promise<void> }>)[qname];
      if (!q) continue;
      try {
        await q.obliterate({ force: true });
        drainedQueues.push(qname);
      } catch (err) {
        console.error(`[cleanup-stuck] could not obliterate ${qname}:`, err);
      }
    }

    return c.json({ ok: true, cleared: stuck.length, drainedQueues });
  });

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { sql, eq, and, gte, lte } from "drizzle-orm";

import { db, tables } from "../db/index.js";

const SummaryQuerySchema = z.object({
  courseId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export const analyticsRoute = new Hono()
  .get("/summary", zValidator("query", SummaryQuerySchema), async (c) => {
    const { courseId, from, to } = c.req.valid("query");
    const conds = [
      courseId ? eq(tables.learningEvents.courseId, courseId) : undefined,
      from ? gte(tables.learningEvents.ts, new Date(from)) : undefined,
      to ? lte(tables.learningEvents.ts, new Date(to)) : undefined,
    ].filter(Boolean);
    const where = conds.length > 0 ? and(...conds as Parameters<typeof and>) : undefined;

    const rows = await db.select({
      eventType: tables.learningEvents.eventType,
      count: sql<number>`count(*)::int`,
    }).from(tables.learningEvents).where(where).groupBy(tables.learningEvents.eventType);

    return c.json({
      eventsByType: Object.fromEntries(rows.map((r) => [r.eventType, r.count])),
      totalEvents: rows.reduce((s, r) => s + r.count, 0),
    });
  })
  .get("/beats/replays", async (c) => {
    /**
     * The "most-replayed beats" leaderboard — strong signal of which concepts
     * need clearer teaching. Returns top 20.
     */
    const courseId = c.req.query("courseId");
    const where = courseId
      ? and(eq(tables.learningEvents.courseId, courseId), eq(tables.learningEvents.eventType, "beat_replay"))
      : eq(tables.learningEvents.eventType, "beat_replay");

    const rows = await db.select({
      beatId: tables.learningEvents.beatId,
      replays: sql<number>`count(*)::int`,
    }).from(tables.learningEvents).where(where)
      .groupBy(tables.learningEvents.beatId)
      .orderBy(sql`count(*) desc`)
      .limit(20);
    return c.json({ replays: rows });
  })
  .get("/quizzes/difficulty", async (c) => {
    /** Per-quiz difficulty: wrong-answer rate across all attempts. */
    const courseId = c.req.query("courseId");
    const where = courseId
      ? and(eq(tables.learningEvents.courseId, courseId), eq(tables.learningEvents.eventType, "quiz_answer"))
      : eq(tables.learningEvents.eventType, "quiz_answer");
    const rows = await db.select({
      beatId: tables.learningEvents.beatId,
      total: sql<number>`count(*)::int`,
      wrong: sql<number>`count(*) filter (where (data->>'correct')::boolean = false)::int`,
    }).from(tables.learningEvents).where(where)
      .groupBy(tables.learningEvents.beatId);
    return c.json({
      quizzes: rows.map((r) => ({
        beatId: r.beatId,
        total: r.total,
        wrong: r.wrong,
        wrongRate: r.total > 0 ? r.wrong / r.total : 0,
      })),
    });
  });

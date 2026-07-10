/**
 * Attempts — the standalone results store, read side (LP-16).
 * Ingest is public at POST /xapi/attempts (learners aren't authenticated);
 * these admin/teacher reads sit behind the normal session auth.
 *
 *   GET /lessons             → lessons that have attempts (counts + averages)
 *   GET /?lessonId=          → attempt roster for a lesson, newest first
 *   GET /summary?lessonId=   → per-question item analysis
 */

import { Hono } from "hono";
import { desc, eq, sql } from "drizzle-orm";

import { db, tables } from "../db/index.js";

export const attemptsRoute = new Hono()
  .get("/lessons", async (c) => {
    const rows = await db
      .select({
        lessonId: tables.attempts.lessonId,
        lessonTitle: tables.lessons.title,
        attempts: sql<number>`count(*)::int`,
        learners: sql<number>`count(distinct ${tables.attempts.learnerId})::int`,
        avgScore: sql<number>`round(avg(${tables.attempts.scorePct}))::int`,
        lastAttemptAt: sql<string>`max(${tables.attempts.createdAt})`,
      })
      .from(tables.attempts)
      .innerJoin(tables.lessons, eq(tables.attempts.lessonId, tables.lessons.id))
      .groupBy(tables.attempts.lessonId, tables.lessons.title)
      .orderBy(sql`max(${tables.attempts.createdAt}) desc`);
    return c.json({ lessons: rows });
  })
  .get("/", async (c) => {
    const lessonId = c.req.query("lessonId");
    if (!lessonId) return c.json({ error: "lessonId required" }, 400);
    const rows = await db.select().from(tables.attempts)
      .where(eq(tables.attempts.lessonId, lessonId))
      .orderBy(desc(tables.attempts.createdAt))
      .limit(500);
    return c.json({ attempts: rows });
  })
  .get("/summary", async (c) => {
    /** Item analysis: per question — how many saw it, % correct, and the
     *  most common wrong answers. Computed in JS over the (capped) attempt
     *  rows; fine for classroom-sized cohorts. */
    const lessonId = c.req.query("lessonId");
    if (!lessonId) return c.json({ error: "lessonId required" }, 400);
    const rows = await db.select({ interactions: tables.attempts.interactions, scorePct: tables.attempts.scorePct })
      .from(tables.attempts)
      .where(eq(tables.attempts.lessonId, lessonId))
      .orderBy(desc(tables.attempts.createdAt))
      .limit(1000);

    const byQuestion = new Map<string, {
      id: string; type: string; description: string;
      total: number; correct: number; wrongAnswers: Map<string, number>;
    }>();
    for (const r of rows) {
      for (const i of r.interactions ?? []) {
        let q = byQuestion.get(i.id);
        if (!q) { q = { id: i.id, type: i.type, description: i.description ?? "", total: 0, correct: 0, wrongAnswers: new Map() }; byQuestion.set(i.id, q); }
        q.total++;
        if (i.result === "correct") q.correct++;
        else if (i.learner) q.wrongAnswers.set(i.learner, (q.wrongAnswers.get(i.learner) ?? 0) + 1);
        if (!q.description && i.description) q.description = i.description;
      }
    }
    const questions = [...byQuestion.values()].map((q) => ({
      id: q.id, type: q.type, description: q.description,
      total: q.total,
      correctPct: q.total ? Math.round((q.correct / q.total) * 100) : 0,
      commonWrong: [...q.wrongAnswers.entries()]
        .sort((a, b) => b[1] - a[1]).slice(0, 3)
        .map(([answer, count]) => ({ answer, count })),
    }));
    const scores = rows.map((r) => r.scorePct);
    return c.json({
      attempts: rows.length,
      avgScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
      passRate: scores.length ? Math.round((scores.filter((s) => s >= 60).length / scores.length) * 100) : 0,
      questions,
    });
  });

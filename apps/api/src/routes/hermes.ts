/**
 * Hermes routes — the evolution loop, now implemented locally (the remote-RPC
 * bridge stub is retired).
 *
 *   POST /runs            → start an evolution run (analyzes feedback +
 *                           review issues + render fallbacks, proposes
 *                           pending pipeline rules)
 *   GET  /runs            → run history with status + proposal counts
 *   GET  /memories        → rules Hermes has proposed (pending + adopted)
 *
 * Style-candidate endpoints are kept for UI compatibility but return empty
 * until the style-evolution phase lands.
 */

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { desc, eq, like, sql } from "drizzle-orm";

import { db, tables } from "../db/index.js";
import { runEvolution, listRuns } from "../lib/hermes.js";

export const hermesRoute = new Hono()
  .get("/runs", async (c) => {
    const rows = await listRuns(10);
    return c.json({
      runs: rows.map((r) => ({
        runId: r.id,
        startedAt: r.startedAt.toISOString(),
        completedAt: r.completedAt?.toISOString() ?? null,
        status: r.status,
        beatsReviewed: r.beatsReviewed,
        stylesProposed: r.rulesProposed, // UI field name kept; semantics = proposed rules
        notes: r.notes,
      })),
    });
  })
  .post("/runs", zValidator("json", z.object({ beatLimit: z.number().int().positive().optional() })), async (c) => {
    const { beatLimit } = c.req.valid("json");
    const result = await runEvolution({ beatLimit });
    return c.json(result, 202);
  })
  .get("/evidence", async (c) => {
    // Demonstrations: the rendered beats whose review findings are the raw
    // material Hermes distils into rules. Each row carries the beat's video
    // (mp4Key) so the UI can SHOW the beat that grounds a recommendation.
    const rows = await db
      .select({
        beatId: tables.beats.id,
        beatKey: tables.beats.beatKey,
        beatType: tables.beats.beatType,
        reviewScore: tables.beats.reviewScore,
        reviewIssues: tables.beats.reviewIssues,
        mp4Key: tables.beats.mp4Key,
        reviewedAt: tables.beats.reviewedAt,
        lessonTitle: tables.lessons.title,
        courseTitle: tables.courses.title,
      })
      .from(tables.beats)
      .innerJoin(tables.lessons, eq(tables.beats.lessonId, tables.lessons.id))
      .innerJoin(tables.modules, eq(tables.lessons.moduleId, tables.modules.id))
      .innerJoin(tables.sections, eq(tables.modules.sectionId, tables.sections.id))
      .innerJoin(tables.courses, eq(tables.sections.courseId, tables.courses.id))
      .where(sql`${tables.beats.reviewIssues} is not null`)
      .orderBy(desc(tables.beats.reviewedAt))
      .limit(30);
    return c.json({
      evidence: rows
        .filter((r) => Array.isArray(r.reviewIssues) && r.reviewIssues.length > 0)
        .map((r) => ({
          beatId: r.beatId,
          beatKey: r.beatKey,
          beatType: r.beatType,
          reviewScore: r.reviewScore,
          issues: r.reviewIssues,
          mp4Key: r.mp4Key,
          courseTitle: r.courseTitle,
          lessonTitle: r.lessonTitle,
          reviewedAt: r.reviewedAt?.toISOString() ?? null,
        })),
    });
  })
  .get("/styles/pending", (c) => c.json({ candidates: [] }))
  .post("/styles/:id/approve", (c) => c.json({ ok: false, error: "style evolution not yet implemented" }, 501))
  .post("/styles/:id/reject", (c) => c.json({ ok: false, error: "style evolution not yet implemented" }, 501))
  .get("/memories", async (c) => {
    const rows = await db.select().from(tables.pipelineRules)
      .where(like(tables.pipelineRules.origin, "hermes%"))
      .orderBy(desc(tables.pipelineRules.createdAt)).limit(50);
    return c.json({
      memories: rows.map((r) => ({
        id: r.id, scope: r.scope, rule: r.rule, origin: r.origin,
        status: r.active ? "adopted" : "pending",
        createdAt: r.createdAt.toISOString(),
      })),
    });
  });

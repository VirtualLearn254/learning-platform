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
import { desc, like } from "drizzle-orm";

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

/**
 * Hermes bridge routes — two-way RPC surface.
 *
 * The app uses these endpoints to:
 *   • trigger an evolution run
 *   • list pending style candidates and approve/reject them
 *   • view Hermes' memory log
 *
 * Hermes (running on a different process) calls back into the API via
 * the regular CRUD routes (courses, beats, materials, etc.) to do its work.
 */

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

import { hermes } from "../workers/services.js";

export const hermesRoute = new Hono()
  .get("/runs", async (c) => {
    const runs = await hermes.listEvolutionRuns(10);
    return c.json({ runs });
  })
  .post("/runs", zValidator("json", z.object({ beatLimit: z.number().int().positive().optional() })), async (c) => {
    const { beatLimit } = c.req.valid("json");
    const result = await hermes.triggerEvolutionRun({ beatLimit });
    return c.json(result, 202);
  })
  .get("/styles/pending", async (c) => {
    const candidates = await hermes.listPendingStyleCandidates();
    return c.json({ candidates });
  })
  .post("/styles/:id/approve", async (c) => {
    const id = c.req.param("id");
    const result = await hermes.approveStyle(id);
    return c.json(result);
  })
  .post("/styles/:id/reject", zValidator("json", z.object({ reason: z.string().min(1) })), async (c) => {
    const id = c.req.param("id");
    const { reason } = c.req.valid("json");
    const result = await hermes.rejectStyle(id, reason);
    return c.json(result);
  })
  .get("/memories", async (c) => {
    const memories = await hermes.listMemories(50);
    return c.json({ memories });
  });

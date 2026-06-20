/**
 * xAPI LRS endpoint — receives statements from the SCORM-packaged player
 * running inside Moodle. Implements just enough of xAPI 1.0.3 for our needs:
 * statement POST + (in future) statement GET with filters.
 */

import { Hono } from "hono";
import type { XApiStatement } from "@lp/lrs";

import { lrs } from "../workers/services.js";

export const xapiRoute = new Hono()
  .post("/statements", async (c) => {
    const body = (await c.req.json()) as XApiStatement | XApiStatement[];
    const statements = Array.isArray(body) ? body : [body];
    const results = await Promise.all(statements.map((s) => lrs.record(s)));
    return c.json({
      ok: results.every((r) => r.ok),
      received: results.length,
      ids: results.filter((r) => r.eventId).map((r) => r.eventId),
    });
  });

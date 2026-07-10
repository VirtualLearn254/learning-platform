/**
 * xAPI LRS endpoint — receives statements from the SCORM-packaged player
 * running inside Moodle. Implements just enough of xAPI 1.0.3 for our needs:
 * statement POST + (in future) statement GET with filters.
 */

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import type { XApiStatement } from "@lp/lrs";

import { db, tables } from "../db/index.js";
import { sendLtiGrade } from "../lib/lti.js";
import { lrs } from "../workers/services.js";

/** Attempt ingest payload — sent by the packaged player at completion (LP-16).
 *  Lives under /xapi (the public learner-ingestion prefix) because learners
 *  are not authenticated; everything is size-capped and validated. */
const AttemptSchema = z.object({
  lessonId: z.string().uuid(),
  learnerId: z.string().min(1).max(200),
  learnerName: z.string().max(200).optional(),
  source: z.enum(["scorm", "standalone"]),
  scorePct: z.number().int().min(0).max(100),
  correctCount: z.number().int().min(0).max(500).default(0),
  totalQuestions: z.number().int().min(0).max(500).default(0),
  points: z.number().int().min(0).max(100000).default(0),
  durationSec: z.number().int().min(0).max(86400).optional(),
  interactions: z.array(z.object({
    id: z.string().max(250),
    type: z.string().max(40),
    result: z.string().max(20),
    description: z.string().max(300).optional(),
    learner: z.string().max(300).optional(),
    correct: z.string().max(300).optional(),
  })).max(100).default([]),
});

export const xapiRoute = new Hono()
  .post("/attempts", zValidator("json", AttemptSchema), async (c) => {
    const input = c.req.valid("json");
    // Reject attempts against lessons that don't exist (garbage/probe traffic).
    const lesson = await db.query.lessons.findFirst({ where: eq(tables.lessons.id, input.lessonId) });
    if (!lesson) return c.json({ error: "unknown lesson" }, 404);
    const [row] = await db.insert(tables.attempts).values(input).returning({ id: tables.attempts.id });

    // LTI grade passback: if this learner launched from an LMS, push the
    // score into its gradebook. Best-effort — a passback failure never
    // affects the stored attempt.
    void (async () => {
      try {
        const link = await db.query.ltiLinks.findFirst({
          where: and(eq(tables.ltiLinks.lessonId, input.lessonId), eq(tables.ltiLinks.learnerId, input.learnerId)),
        });
        const key = process.env.LTI_CONSUMER_KEY, secret = process.env.LTI_CONSUMER_SECRET;
        if (!link || !key || !secret) return;
        const res = await sendLtiGrade({
          outcomeUrl: link.outcomeUrl, sourcedid: link.sourcedid,
          score01: Math.max(0, Math.min(1, input.scorePct / 100)),
          consumerKey: key, consumerSecret: secret,
        });
        if (res.ok) {
          await db.update(tables.ltiLinks).set({ lastScorePct: input.scorePct, lastGradeAt: new Date() })
            .where(eq(tables.ltiLinks.id, link.id));
          console.log(`[lti] grade passback ok: lesson=${input.lessonId} learner=${input.learnerId} score=${input.scorePct}%`);
        } else {
          console.warn(`[lti] grade passback failed (${res.status}): ${res.body.slice(0, 150)}`);
        }
      } catch (err) {
        console.warn(`[lti] grade passback error:`, err instanceof Error ? err.message : err);
      }
    })();

    return c.json({ ok: true, attemptId: row!.id }, 201);
  })
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

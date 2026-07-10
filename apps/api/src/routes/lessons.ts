import { Hono } from "hono";
import { and, eq, asc, desc, inArray, sql } from "drizzle-orm";

import { db, tables } from "../db/index.js";
import { queues } from "../queue/index.js";
import { breadcrumbsForLesson } from "../lib/breadcrumbs.js";

interface LessonJobSummary {
  id: string;
  queue: string;
  status: string;
  progressNote: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
}

async function latestJobForLesson(lessonId: string, queue: string): Promise<LessonJobSummary | null> {
  const [j] = await db.select().from(tables.jobs)
    .where(and(eq(tables.jobs.lessonId, lessonId), eq(tables.jobs.queue, queue)))
    .orderBy(desc(tables.jobs.createdAt))
    .limit(1);
  if (!j) return null;
  return {
    id: j.id, queue: j.queue, status: j.status,
    progressNote: j.progressNote, errorMessage: j.errorMessage,
    startedAt: j.startedAt?.toISOString() ?? null,
    endedAt: j.endedAt?.toISOString() ?? null,
    createdAt: j.createdAt.toISOString(),
  };
}

export const lessonsRoute = new Hono()
  .get("/", async (c) => {
    /** Lightweight lesson index — powers the command palette. */
    const rows = await db.select({
      id: tables.lessons.id,
      title: tables.lessons.title,
      publishedAt: tables.lessons.publishedAt,
    }).from(tables.lessons).orderBy(asc(tables.lessons.title)).limit(500);
    return c.json({ lessons: rows });
  })
  .get("/:id", async (c) => {
    const id = c.req.param("id");
    const lesson = await db.query.lessons.findFirst({ where: eq(tables.lessons.id, id) });
    if (!lesson) return c.json({ error: "not_found" }, 404);
    const beats = await db.select().from(tables.beats)
      .where(eq(tables.beats.lessonId, id))
      .orderBy(asc(tables.beats.order));
    const breadcrumbs = await breadcrumbsForLesson(id);
    const [stitchJob, scormJob, cost] = await Promise.all([
      latestJobForLesson(id, "stitch"),
      latestJobForLesson(id, "scorm_build"),
      db.select({ total: sql<string>`coalesce(sum(${tables.aiUsage.costUsd}), 0)` })
        .from(tables.aiUsage).where(eq(tables.aiUsage.lessonId, id)),
    ]);
    return c.json({ lesson, beats, breadcrumbs, stitchJob, scormJob, aiCostUsd: Number(cost[0]?.total ?? 0) });
  })
  .post("/:id/author", async (c) => {
    /**
     * Queue every beat in this lesson for authoring. By default, only beats
     * still in "ingested" stage are queued (so you can re-run safely without
     * clobbering already-authored beats). Pass ?all=true to re-author every
     * beat from scratch.
     */
    const id = c.req.param("id");
    const all = c.req.query("all") === "true";
    const beats = await db.select().from(tables.beats)
      .where(eq(tables.beats.lessonId, id))
      .orderBy(asc(tables.beats.order));
    if (beats.length === 0) return c.json({ ok: false, error: "no beats in lesson" }, 400);

    const targets = all ? beats : beats.filter((b) => b.stage === "ingested" || b.stage === "queued");
    if (targets.length === 0) return c.json({ ok: true, queued: 0, message: "no beats need authoring (pass ?all=true to re-author)" });

    const jobIds: string[] = [];
    for (const beat of targets) {
      const job = await queues.author.add("author-beat", { beatId: beat.id, isRevision: false });
      if (job.id) jobIds.push(job.id);
    }
    return c.json({ ok: true, queued: targets.length, jobIds });
  })
  .post("/:id/holistic-review", async (c) => {
    /** Queue a cross-beat lesson review. Reads all main beats and asks Claude
     *  holistic profile to flag narrative continuity / repetition / pacing issues. */
    const id = c.req.param("id");
    const lesson = await db.query.lessons.findFirst({ where: eq(tables.lessons.id, id) });
    if (!lesson) return c.json({ error: "not_found" }, 404);
    const job = await queues.holistic.add("holistic-review", { lessonId: id });
    return c.json({ ok: true, jobId: job.id });
  })
  .post("/:id/render", async (c) => {
    /**
     * Queue every approved-or-earlier beat in this lesson for render.
     * By default, beats already rendered (with mp4Key) are skipped.
     * Pass ?all=true to re-render every beat from scratch.
     */
    const id = c.req.param("id");
    const all = c.req.query("all") === "true";
    const beats = await db.select().from(tables.beats)
      .where(eq(tables.beats.lessonId, id))
      .orderBy(asc(tables.beats.order));
    if (beats.length === 0) return c.json({ ok: false, error: "no beats in lesson" }, 400);

    // Only authored beats are eligible (need script + visualSpec).
    const eligible = beats.filter((b) =>
      b.stage === "ai_review" || b.stage === "human_review" || b.stage === "approved" ||
      b.stage === "rendering" || b.stage === "stitched" || b.stage === "published"
    );
    const targets = all ? eligible : eligible.filter((b) => !b.mp4Key);
    if (targets.length === 0) return c.json({ ok: true, queued: 0, message: "no beats need rendering (pass ?all=true to re-render)" });

    const jobIds: string[] = [];
    for (const beat of targets) {
      const job = await queues.render.add("render-beat", { beatId: beat.id });
      if (job.id) jobIds.push(job.id);
    }
    return c.json({ ok: true, queued: targets.length, jobIds });
  })
  .post("/:id/branches", async (c) => {
    /**
     * Branching (LP-18): create one remediation ALT beat per quiz that has
     * wrong options. Each alt beat is seeded with a misconception-targeting
     * outline and queued through the NORMAL author → AI-review → render
     * chain (~$0.10/beat); the parent quiz gains `branches` entries so the
     * SCORM packager ships the clip and the player detours into it on a
     * final wrong answer. Idempotent: quizzes whose alt beat already exists
     * are skipped.
     */
    const id = c.req.param("id");
    const lesson = await db.query.lessons.findFirst({ where: eq(tables.lessons.id, id) });
    if (!lesson) return c.json({ error: "not_found" }, 404);
    const beats = await db.select().from(tables.beats)
      .where(eq(tables.beats.lessonId, id))
      .orderBy(asc(tables.beats.order));
    const main = beats.filter((b) => !b.isAlt);
    const existingKeys = new Set(beats.map((b) => b.beatKey));

    type Quiz = {
      type?: string; question?: string;
      options?: Array<{ id: string; text: string; isCorrect?: boolean; feedback?: string }>;
      branches?: Array<{ onOptionId: string; altBeatKey: string; returnToBeatKey: string }>;
    };
    const created: Array<{ beatKey: string; forQuiz: string }> = [];
    for (let i = 0; i < main.length; i++) {
      const b = main[i]!;
      const quiz = b.quiz as Quiz | null;
      if (!quiz?.question || !Array.isArray(quiz.options)) continue;
      // Reflection types have no wrong answer to remediate.
      if (quiz.type === "likert" || quiz.type === "flashcard") continue;
      const wrong = quiz.options.filter((o) => !o.isCorrect);
      const correct = quiz.options.filter((o) => o.isCorrect);
      if (wrong.length === 0 || correct.length === 0) continue;
      const altKey = `${b.beatKey}_expl`;
      if (existingKeys.has(altKey)) continue;

      // Seed outline — the author worker expands this into real narration +
      // visuals, exactly like an ingested beat outline.
      const outline = [
        `Remediation clip: plays ONLY for learners who just answered this check wrong, then the lesson resumes. Do not greet or recap the whole lesson — dive straight into untangling the misconception.`,
        `The question they missed: "${quiz.question}"`,
        `Correct answer: ${correct.map((o) => o.text).join("; ")}`,
        `Wrong options they may have picked: ${wrong.map((o) => o.text + (o.feedback ? ` (why it tempts: ${o.feedback})` : "")).join("; ")}`,
        `Re-explain the underlying idea from a DIFFERENT angle than the original teaching beat: name the likely misconception directly and warmly ("a lot of people pick this because…"), walk through why it fails, and end by affirming what the correct answer captures. 60–100 words of narration.`,
      ].join("\n");

      const [row] = await db.insert(tables.beats).values({
        lessonId: id,
        beatKey: altKey,
        beatType: "concept",
        order: b.order,
        isAlt: true,
        script: outline,
        conceptsTaught: [],
        conceptsRequired: (b.conceptsTaught ?? []) as string[],
      }).returning({ id: tables.beats.id });

      // Wire the parent quiz: every wrong option detours into the alt beat,
      // returning at the next main beat (or resuming in place at the end).
      const returnTo = main[i + 1]?.beatKey ?? "";
      await db.update(tables.beats).set({
        quiz: {
          ...quiz,
          branches: wrong.map((o) => ({ onOptionId: o.id, altBeatKey: altKey, returnToBeatKey: returnTo })),
        },
        updatedAt: new Date(),
      }).where(eq(tables.beats.id, b.id));

      await queues.author.add("author-branch-beat", { beatId: row!.id, isRevision: false });
      created.push({ beatKey: altKey, forQuiz: b.beatKey });
    }
    return c.json({ ok: true, created: created.length, beats: created });
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

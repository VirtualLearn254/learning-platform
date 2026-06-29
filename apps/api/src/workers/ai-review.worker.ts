/**
 * AI review worker — runs an automated quality pass on a freshly authored
 * beat. Calls the Claude `reviewer` profile with the script + visualSpec
 * + lesson context, parses a structured issue list, then routes the beat:
 *
 *   score >= 90, no P0 issues   → human_review (clean, awaiting sign-off)
 *   70-89, or has P1 issues     → human_review (with issues attached)
 *   < 70 or has P0              → revising (auto-loop back to author)
 *
 * Always writes back: beat.reviewScore, beat.reviewIssues, beat.reviewedAt.
 */

import { Worker } from "bullmq";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db, tables, type ReviewIssue } from "../db/index.js";
import { QueueNames, queues } from "../queue/index.js";
import { workerConnection } from "./connection.js";
import { getAIClient } from "../lib/ai_client.js";

const PASS_THRESHOLD = 90;
const REVISE_THRESHOLD = 70;
const MAX_REVISION_LOOPS = 2;

interface JobData { beatId: string }

const ReviewOutput = z.object({
  score: z.number().int().min(0).max(100),
  issues: z.array(z.object({
    severity: z.enum(["P0", "P1", "P2"]),
    category: z.string().min(1).max(40),
    description: z.string().min(5).max(500),
    suggestion: z.string().max(500).optional(),
  })).max(20).default([]),
  verdict: z.enum(["pass", "human_review", "revise"]).optional(),
});

function buildSystemPrompt(): string {
  return `You are reviewing one beat of an educational video lesson. Score and identify issues.

OUTPUT: a JSON object with this exact shape:

{
  "score":   integer 0-100,
  "issues": [
    {
      "severity":    "P0" | "P1" | "P2",
      "category":    short slug (e.g. "pedagogy", "voice", "math", "structure", "factual", "completeness"),
      "description": one sentence stating the issue,
      "suggestion":  optional one-sentence suggestion
    }
  ]
}

SCORING:
- 95-100 = excellent
- 85-94  = solid, minor polish only
- 70-84  = noticeable issues that a human should review
- < 70   = needs revision

SEVERITIES:
- P0 = factual error, broken math, wrong example. Must fix.
- P1 = pedagogy/voice/structure issue (script too short or too punchy, repeats earlier content, wrong tone for beat type).
- P2 = polish (could be sharper).

CHECK SPECIFICALLY:
- Word count: 60-150 narration words is the target.
- Beat-type arc:
    hook = question or surprising fact, no answer reveal
    concept = teaches ONE idea cleanly
    example = walks through a worked example step by step
    check = poses a question without giving the answer
    recap = summarises in 2-3 lines
- Math notation: plain text only ("x squared", "x^2"). Flag any unicode superscripts.
- onScreenText and callouts should reinforce the spoken script, not duplicate it verbatim.

Output ONLY the JSON object. No fences. No commentary.`;
}

function buildUserPrompt(args: {
  courseTitle: string;
  lessonTitle: string;
  beatType: string;
  beatKey: string;
  beatOrder: number;
  beatsInLesson: number;
  script: string;
  onScreenText: string[];
  callouts: string[];
  earlierBeats: Array<{ beatType: string; beatKey: string; script: string }>;
}): string {
  const earlier = args.earlierBeats.length === 0 ? "(none)" : args.earlierBeats.map((b) => `  [${b.beatType}] ${b.beatKey}: ${b.script.slice(0, 200)}`).join("\n");
  return [
    `COURSE: ${args.courseTitle}`,
    `LESSON: ${args.lessonTitle}`,
    `THIS BEAT: ${args.beatKey} (type: ${args.beatType}, position ${args.beatOrder + 1} of ${args.beatsInLesson})`,
    "",
    `SCRIPT (${args.script.trim().split(/\s+/).length} words):`,
    args.script,
    "",
    `ON-SCREEN TEXT: ${JSON.stringify(args.onScreenText)}`,
    `CALLOUTS: ${JSON.stringify(args.callouts)}`,
    "",
    `EARLIER BEATS IN THIS LESSON (for context, do not double-flag duplicates here):`,
    earlier,
  ].join("\n");
}

export function startAIReviewWorker() {
  return new Worker<JobData>(QueueNames.AIReview, async (job) => {
    const { beatId } = job.data;
    console.log(`[ai-review] start beat=${beatId}`);

    const [jobRow] = await db.insert(tables.jobs).values({
      queue: "ai_review",
      beatId,
      status: "running",
      progressNote: "loading beat",
      startedAt: new Date(),
    }).returning();
    const jobId = jobRow!.id;

    async function note(text: string) {
      console.log(`[ai-review:${jobId.slice(0, 8)}] ${text}`);
      await db.update(tables.jobs).set({ progressNote: text }).where(eq(tables.jobs.id, jobId));
    }
    async function fail(err: unknown): Promise<never> {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[ai-review:${jobId.slice(0, 8)}] FAILED:`, msg);
      await db.update(tables.jobs).set({
        status: "failed", progressNote: "failed",
        errorMessage: msg.slice(0, 2000), endedAt: new Date(),
      }).where(eq(tables.jobs.id, jobId));
      throw err;
    }

    try {
      const beat = await db.query.beats.findFirst({ where: eq(tables.beats.id, beatId) });
      if (!beat) return await fail(new Error(`Beat ${beatId} not found`));

      const lesson = await db.query.lessons.findFirst({ where: eq(tables.lessons.id, beat.lessonId) });
      const moduleRow = lesson ? await db.query.modules.findFirst({ where: eq(tables.modules.id, lesson.moduleId) }) : null;
      const section = moduleRow ? await db.query.sections.findFirst({ where: eq(tables.sections.id, moduleRow.sectionId) }) : null;
      const course = section ? await db.query.courses.findFirst({ where: eq(tables.courses.id, section.courseId) }) : null;

      const allLessonBeats = await db.select().from(tables.beats).where(eq(tables.beats.lessonId, beat.lessonId));
      const ordered = allLessonBeats.sort((a, b) => a.order - b.order);
      const earlierBeats = ordered.filter((b) => b.order < beat.order).slice(-4).map((b) => ({ beatType: b.beatType, beatKey: b.beatKey, script: b.script }));

      const visual = (beat.visualSpec ?? {}) as { onScreenText?: string[]; callouts?: string[] };

      await note(`calling Claude reviewer profile`);
      const client = await getAIClient();
      const ai = await client.chat("reviewer", {
        messages: [
          { role: "system", content: buildSystemPrompt() },
          { role: "user", content: buildUserPrompt({
            courseTitle: course?.title ?? "",
            lessonTitle: lesson?.title ?? "",
            beatType: beat.beatType,
            beatKey: beat.beatKey,
            beatOrder: beat.order,
            beatsInLesson: ordered.length,
            script: beat.script,
            onScreenText: visual.onScreenText ?? [],
            callouts: visual.callouts ?? [],
            earlierBeats,
          }) },
        ],
        jsonMode: true,
      });
      await note(`AI returned ${ai.text.length} chars`);

      const review = parseReview(ai.text);
      const hasP0 = review.issues.some((i) => i.severity === "P0");
      const hasP1 = review.issues.some((i) => i.severity === "P1");

      // Decide routing
      let nextStage: "human_review" | "revising" | "approved";
      if (review.score >= PASS_THRESHOLD && !hasP0 && !hasP1) {
        nextStage = "human_review"; // still gate at human even when clean — operator clicks Approve
      } else if (review.score >= REVISE_THRESHOLD && !hasP0) {
        nextStage = "human_review"; // human sees the issues
      } else if (beat.revisionCount < MAX_REVISION_LOOPS) {
        nextStage = "revising"; // auto-loop back to author
      } else {
        nextStage = "human_review"; // bail out of revise loop, hand to human
      }

      await db.update(tables.beats).set({
        stage: nextStage,
        reviewScore: review.score,
        reviewIssues: review.issues,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(tables.beats.id, beatId));

      if (nextStage === "revising") {
        const feedback = review.issues.slice(0, 5).map((i) => `[${i.severity}] ${i.description}${i.suggestion ? ` (suggest: ${i.suggestion})` : ""}`).join("\n");
        await db.insert(tables.beatFeedback).values({
          beatId,
          feedback: `AI reviewer (score ${review.score}/100):\n${feedback}`,
          screenshotKeys: [],
          action: "revise",
        });
        await queues.author.add("re-author-from-review", { beatId, isRevision: true });
      }

      await db.update(tables.jobs).set({
        status: "succeeded",
        progressNote: `done · score ${review.score}/100 · ${review.issues.length} issue(s) · -> ${nextStage}`,
        endedAt: new Date(),
      }).where(eq(tables.jobs.id, jobId));

      console.log(`[ai-review] DONE beat=${beatId} score=${review.score} -> ${nextStage}`);
      return { beatId, score: review.score, nextStage };
    } catch (err) {
      return await fail(err);
    }
  }, { connection: workerConnection, concurrency: 4 });
}

function parseReview(raw: string): { score: number; issues: ReviewIssue[] } {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  let json: unknown;
  try { json = JSON.parse(cleaned); }
  catch (e) { throw new Error(`Reviewer JSON parse failed: ${e instanceof Error ? e.message : e}. Preview: ${cleaned.slice(0, 200)}`); }
  const parsed = ReviewOutput.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Reviewer output failed validation: ${parsed.error.errors.slice(0, 5).map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")}`);
  }
  return { score: parsed.data.score, issues: parsed.data.issues };
}

/**
 * Holistic worker — reviews all beats of a lesson together to catch
 * cross-beat issues a per-beat review can't see: narrative continuity,
 * repeated material, pacing problems, missing concepts.
 *
 * Triggered manually (POST /lessons/:id/holistic-review) or automatically
 * once every beat in a lesson reaches at least ai_review stage.
 *
 * Writes back: lesson.holisticScore, lesson.holisticIssues, holisticReviewedAt.
 */

import { Worker } from "bullmq";
import { eq, asc } from "drizzle-orm";
import { z } from "zod";

import { db, tables, type ReviewIssue } from "../db/index.js";
import { QueueNames } from "../queue/index.js";
import { workerConnection } from "./connection.js";
import { getAIClient } from "../lib/ai_client.js";

interface JobData { lessonId: string }

const HolisticOutput = z.object({
  lessonScore: z.number().int().min(0).max(100),
  issues: z.array(z.object({
    severity: z.enum(["P0", "P1", "P2"]),
    category: z.string().min(1).max(40),
    description: z.string().min(5).max(800),
    suggestion: z.string().max(800).optional(),
    affectedBeats: z.array(z.string()).max(20).default([]),
  })).max(20).default([]),
});

const SYSTEM_PROMPT = `You are reviewing an entire educational video lesson at once to find cross-beat issues that a per-beat review can't see.

OUTPUT: a JSON object with this exact shape:

{
  "lessonScore": integer 0-100,
  "issues": [
    {
      "severity":      "P0" | "P1" | "P2",
      "category":      one of "continuity" | "repetition" | "pacing" | "completeness" | "narrative" | "examples",
      "description":   1-2 sentences stating the cross-beat issue,
      "suggestion":    optional 1-2 sentence fix,
      "affectedBeats": [ "beatKey1", "beatKey2", ... ]  // which beats are involved
    }
  ]
}

CHECK SPECIFICALLY:
- Continuity: does beat N+1 build on beat N? Are there orphan concepts introduced and never used?
- Repetition: do two beats teach the same thing? Is the same example used twice?
- Pacing: is the lesson front-loaded? Is the recap too long? Is the hook too thin?
- Completeness: does every claim in the hook get addressed by the end? Are key terms defined before they're used?
- Narrative: does the lesson tell ONE story or does it fragment into unrelated parts?
- Examples: are examples diverse enough? Do they actually illustrate the concept they sit under?

SEVERITY:
- P0 = the lesson is broken (orphan concept, contradiction, missing the central idea)
- P1 = noticeable cross-beat issue worth fixing
- P2 = polish opportunity

SCORING:
- 95-100 = ready to ship
- 85-94  = ship with minor edits
- 70-84  = needs revision before render
- < 70   = significant rework

Output ONLY the JSON object. No fences. No commentary.`;

function buildUserPrompt(course: string, lesson: string, lessonSummary: string, beats: Array<{ order: number; beatType: string; beatKey: string; script: string }>): string {
  const beatBlock = beats.map((b) => `[${b.order + 1}/${beats.length} · ${b.beatType}] ${b.beatKey}\n${b.script.trim()}`).join("\n\n---\n\n");
  return [
    `COURSE: ${course}`,
    `LESSON: ${lesson}`,
    lessonSummary ? `LESSON SUMMARY: ${lessonSummary}` : "",
    "",
    `ALL ${beats.length} BEATS IN ORDER:`,
    "",
    beatBlock,
  ].filter(Boolean).join("\n");
}

export function startHolisticWorker() {
  return new Worker<JobData>(QueueNames.Holistic, async (job) => {
    const { lessonId } = job.data;
    console.log(`[holistic] start lesson=${lessonId}`);

    const [jobRow] = await db.insert(tables.jobs).values({
      queue: "holistic",
      lessonId,
      status: "running",
      progressNote: "loading lesson context",
      startedAt: new Date(),
    }).returning();
    const jobId = jobRow!.id;

    async function note(text: string) {
      console.log(`[holistic:${jobId.slice(0, 8)}] ${text}`);
      await db.update(tables.jobs).set({ progressNote: text }).where(eq(tables.jobs.id, jobId));
    }
    async function fail(err: unknown): Promise<never> {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[holistic:${jobId.slice(0, 8)}] FAILED:`, msg);
      await db.update(tables.jobs).set({
        status: "failed", progressNote: "failed",
        errorMessage: msg.slice(0, 2000), endedAt: new Date(),
      }).where(eq(tables.jobs.id, jobId));
      throw err;
    }

    try {
      const lesson = await db.query.lessons.findFirst({ where: eq(tables.lessons.id, lessonId) });
      if (!lesson) return await fail(new Error(`Lesson ${lessonId} not found`));

      const moduleRow = await db.query.modules.findFirst({ where: eq(tables.modules.id, lesson.moduleId) });
      const section = moduleRow ? await db.query.sections.findFirst({ where: eq(tables.sections.id, moduleRow.sectionId) }) : null;
      const course = section ? await db.query.courses.findFirst({ where: eq(tables.courses.id, section.courseId) }) : null;

      const beats = await db.select().from(tables.beats)
        .where(eq(tables.beats.lessonId, lessonId))
        .orderBy(asc(tables.beats.order));
      const main = beats.filter((b) => !b.isAlt);
      if (main.length === 0) return await fail(new Error("No main beats found for this lesson"));

      const wordCount = main.reduce((n, b) => n + b.script.trim().split(/\s+/).length, 0);
      await note(`calling Claude holistic profile (${main.length} beats · ${wordCount} words)`);

      const client = await getAIClient();
      const ai = await client.chat("holistic", {
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(
            course?.title ?? "",
            lesson.title,
            lesson.summary ?? "",
            main.map((b) => ({ order: b.order, beatType: b.beatType, beatKey: b.beatKey, script: b.script })),
          ) },
        ],
        jsonMode: true,
      });
      await note(`AI returned ${ai.text.length} chars (in=${ai.usage.inputTokens} out=${ai.usage.outputTokens})`);

      const parsed = parseHolistic(ai.text);

      await db.update(tables.lessons).set({
        holisticScore: parsed.lessonScore,
        holisticIssues: parsed.issues,
        holisticReviewedAt: new Date(),
      }).where(eq(tables.lessons.id, lessonId));

      await db.update(tables.jobs).set({
        status: "succeeded",
        progressNote: `done · score ${parsed.lessonScore}/100 · ${parsed.issues.length} issue(s)`,
        endedAt: new Date(),
      }).where(eq(tables.jobs.id, jobId));

      console.log(`[holistic] DONE lesson=${lessonId} score=${parsed.lessonScore} issues=${parsed.issues.length}`);
      return { lessonId, score: parsed.lessonScore, issues: parsed.issues.length };
    } catch (err) {
      return await fail(err);
    }
  }, { connection: workerConnection, concurrency: 2 });
}

function parseHolistic(raw: string): { lessonScore: number; issues: ReviewIssue[] } {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  let json: unknown;
  try { json = JSON.parse(cleaned); }
  catch (e) { throw new Error(`Holistic JSON parse failed: ${e instanceof Error ? e.message : e}. Preview: ${cleaned.slice(0, 200)}`); }
  const parsed = HolisticOutput.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Holistic output failed validation: ${parsed.error.errors.slice(0, 5).map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")}`);
  }
  return parsed.data;
}

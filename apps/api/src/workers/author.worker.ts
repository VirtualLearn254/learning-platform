/**
 * Author worker — expands an ingested beat outline into the full narration
 * script + visual spec + concept tags. Calls Claude author profile directly
 * (the render-engine stub is bypassed — that's wired in Task 3 alongside the
 * real HTML generation).
 *
 * Writes a row to `jobs` so the UI can show step-by-step progress per beat.
 */

import { Worker } from "bullmq";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db, tables } from "../db/index.js";
import { QueueNames, queues } from "../queue/index.js";
import { workerConnection } from "./connection.js";
import { getAIClient } from "../lib/ai_client.js";

interface JobData { beatId: string; isRevision: boolean }

// ─── Author output schema ───────────────────────────────────────────

const VisualSpecOut = z.object({
  background: z.enum(["solid", "ai_image", "stock_image"]).default("solid"),
  onScreenText: z.array(z.string().max(60)).min(0).max(5).default([]),
  callouts: z.array(z.string().max(40)).min(0).max(3).default([]),
});

const AuthorOutput = z.object({
  script: z.string().min(60).max(1500),
  visualSpec: VisualSpecOut,
  conceptsTaught: z.array(z.string().min(1).max(64)).min(0).max(5).default([]),
  conceptsRequired: z.array(z.string().min(1).max(64)).min(0).max(5).default([]),
});

type AuthorOut = z.infer<typeof AuthorOutput>;

// ─── Prompt ─────────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  return `You are authoring a SINGLE beat — one ~30-second scene in an educational video lesson.

You receive the beat outline, lesson context, and beat position. You produce a full narration script plus a visual spec.

OUTPUT: a single JSON object with this exact shape:

{
  "script":     string (60-150 words of narration-ready spoken text),
  "visualSpec": {
    "background":   "solid" | "ai_image" | "stock_image",
    "onScreenText": [ short phrases displayed during the beat, 2-5 strings of up to 60 chars each ],
    "callouts":     [ key terms to emphasize, 1-3 strings of up to 40 chars each ]
  },
  "conceptsTaught":   [ 1-3 slug identifiers like "linear_eq_definition" ],
  "conceptsRequired": [ optional 0-2 prerequisite slugs from earlier in the lesson ]
}

PEDAGOGY RULES (strict — these are non-negotiable):
- Patient teacher voice, NOT a punchy reel. Read aloud, it should sound like a person explaining at the board.
- Exactly 60-150 words. Aim for ~100 unless the beat is dense.
- 30 seconds at 0.9x speed = ~80 words. Calibrate to that pace.
- Repeat key terms naturally; assume the viewer has not memorised earlier beats.
- Math: plain text ("x squared", "x^2", "square root of 2"). No unicode superscripts.
- Hook beats: open with a question or a surprising fact that motivates the topic.
- Concept beats: teach ONE idea cleanly. Define -> intuition -> mini-example.
- Example beats: walk a worked example step by step, stating numbers explicitly.
- Check beats: pose a single question that tests understanding. Do NOT give the answer.
- Recap beats: summarise the lesson's main ideas in 2-3 lines.

VISUAL SPEC RULES:
- onScreenText: 2-5 short phrases the player displays as text overlays synced to narration.
- callouts: 1-3 KEY terms (single words or short phrases) to emphasize visually.
- background: "solid" by default; "stock_image" if a real-world photo would help; "ai_image" if a custom illustration is needed.

CONCEPT TAGS:
- conceptsTaught: 1-3 slug identifiers (snake_case) for what THIS beat teaches.
- conceptsRequired: 0-2 slugs for what the viewer must already know.

Output ONLY the JSON object. No markdown fences. No prose before or after.`;
}

function buildUserPrompt(args: {
  courseTitle: string;
  sectionTitle: string;
  moduleTitle: string;
  lessonTitle: string;
  lessonSummary: string;
  beatType: string;
  beatKey: string;
  beatOrder: number;
  beatsInLesson: number;
  outline: string;
  earlierBeats: Array<{ beatType: string; beatKey: string; outline: string }>;
  revisionFeedback?: string;
}): string {
  const lines: string[] = [];
  lines.push(`COURSE: ${args.courseTitle}`);
  lines.push(`SECTION: ${args.sectionTitle}`);
  lines.push(`MODULE: ${args.moduleTitle}`);
  lines.push(`LESSON: ${args.lessonTitle}`);
  if (args.lessonSummary) lines.push(`LESSON SUMMARY: ${args.lessonSummary}`);
  lines.push("");
  lines.push(`THIS BEAT: ${args.beatKey} (type: ${args.beatType}, position ${args.beatOrder + 1} of ${args.beatsInLesson})`);
  lines.push(`OUTLINE: ${args.outline}`);
  if (args.earlierBeats.length > 0) {
    lines.push("");
    lines.push("EARLIER BEATS IN THIS LESSON (for context, do not repeat):");
    for (const b of args.earlierBeats) {
      lines.push(`  - [${b.beatType}] ${b.beatKey}: ${b.outline}`);
    }
  }
  if (args.revisionFeedback) {
    lines.push("");
    lines.push(`REVISION REQUESTED — feedback from human reviewer:`);
    lines.push(args.revisionFeedback);
    lines.push("Address this feedback in the new version.");
  }
  return lines.join("\n");
}

// ─── Worker ─────────────────────────────────────────────────────────

export function startAuthorWorker() {
  return new Worker<JobData>(QueueNames.Author, async (job) => {
    const { beatId, isRevision } = job.data;
    console.log(`[author] start beat=${beatId} revision=${isRevision}`);

    // Create a jobs row for live progress visibility.
    const [jobRow] = await db.insert(tables.jobs).values({
      queue: "author",
      beatId,
      status: "running",
      progressNote: "loading context",
      startedAt: new Date(),
    }).returning();
    const jobId = jobRow!.id;

    async function note(text: string) {
      console.log(`[author:${jobId.slice(0, 8)}] ${text}`);
      await db.update(tables.jobs).set({ progressNote: text }).where(eq(tables.jobs.id, jobId));
    }
    async function fail(err: unknown): Promise<never> {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[author:${jobId.slice(0, 8)}] FAILED:`, msg);
      await db.update(tables.jobs).set({
        status: "failed", progressNote: "failed",
        errorMessage: msg.slice(0, 2000), endedAt: new Date(),
      }).where(eq(tables.jobs.id, jobId));
      await db.update(tables.beats).set({
        status: "failed", errorMessage: msg.slice(0, 2000), updatedAt: new Date(),
      }).where(eq(tables.beats.id, beatId));
      throw err;
    }

    try {
      // 1. Load beat + parents
      const beat = await db.query.beats.findFirst({ where: eq(tables.beats.id, beatId) });
      if (!beat) return await fail(new Error(`Beat ${beatId} not found`));

      await db.update(tables.beats).set({
        stage: "authoring", status: "running", errorMessage: null, updatedAt: new Date(),
      }).where(eq(tables.beats.id, beatId));

      const lesson = await db.query.lessons.findFirst({ where: eq(tables.lessons.id, beat.lessonId) });
      if (!lesson) return await fail(new Error(`Lesson ${beat.lessonId} not found`));
      const moduleRow = await db.query.modules.findFirst({ where: eq(tables.modules.id, lesson.moduleId) });
      if (!moduleRow) return await fail(new Error(`Module ${lesson.moduleId} not found`));
      const section = await db.query.sections.findFirst({ where: eq(tables.sections.id, moduleRow.sectionId) });
      if (!section) return await fail(new Error(`Section ${moduleRow.sectionId} not found`));
      const course = await db.query.courses.findFirst({ where: eq(tables.courses.id, section.courseId) });
      if (!course) return await fail(new Error(`Course ${section.courseId} not found`));

      // Pull earlier beats in this lesson (for context — don't repeat material)
      const allLessonBeats = await db.select().from(tables.beats)
        .where(eq(tables.beats.lessonId, beat.lessonId));
      const orderedBeats = allLessonBeats.sort((a, b) => a.order - b.order);
      const earlierBeats = orderedBeats
        .filter((b) => b.order < beat.order)
        .slice(-4)
        .map((b) => ({ beatType: b.beatType, beatKey: b.beatKey, outline: b.script.slice(0, 200) }));

      // Pull latest feedback if revising.
      let revisionFeedback: string | undefined;
      if (isRevision) {
        const fb = await db.query.beatFeedback.findFirst({
          where: eq(tables.beatFeedback.beatId, beatId),
          orderBy: (t, { desc }) => [desc(t.createdAt)],
        });
        if (fb) revisionFeedback = fb.feedback;
      }

      // 2. Build prompt
      await note(`calling Claude author profile`);
      const client = await getAIClient();
      const userPrompt = buildUserPrompt({
        courseTitle: course.title,
        sectionTitle: section.title,
        moduleTitle: moduleRow.title,
        lessonTitle: lesson.title,
        lessonSummary: lesson.summary ?? "",
        beatType: beat.beatType,
        beatKey: beat.beatKey,
        beatOrder: beat.order,
        beatsInLesson: orderedBeats.length,
        outline: beat.script,
        earlierBeats,
        revisionFeedback,
      });

      const ai = await client.chat("author", {
        messages: [
          { role: "system", content: buildSystemPrompt() },
          { role: "user", content: userPrompt },
        ],
        jsonMode: true,
      });
      await note(`AI returned ${ai.text.length} chars (in=${ai.usage.inputTokens} out=${ai.usage.outputTokens})`);

      // 3. Parse + validate
      const out = parseAuthorOutput(ai.text);
      const wordCount = out.script.trim().split(/\s+/).length;
      await note(`authored · ${wordCount} words · ${out.visualSpec.onScreenText.length} on-screen text · ${out.conceptsTaught.length} concept(s)`);

      // 4. Persist + move to ai_review stage
      await db.update(tables.beats).set({
        script: out.script,
        visualSpec: out.visualSpec,
        conceptsTaught: out.conceptsTaught,
        conceptsRequired: out.conceptsRequired,
        stage: "ai_review",
        status: "succeeded",
        revisionCount: isRevision ? beat.revisionCount + 1 : beat.revisionCount,
        errorMessage: null,
        updatedAt: new Date(),
      }).where(eq(tables.beats.id, beatId));

      // Queue the AI review pass (currently a stub — will be wired in a later task).
      await queues.aiReview.add("review-beat", { beatId });

      await db.update(tables.jobs).set({
        status: "succeeded",
        progressNote: `done · ${wordCount} words · ${out.conceptsTaught.length} concept(s)`,
        endedAt: new Date(),
      }).where(eq(tables.jobs.id, jobId));

      console.log(`[author] DONE beat=${beatId} words=${wordCount}`);
      return { beatId, wordCount };
    } catch (err) {
      return await fail(err);
    }
  }, { connection: workerConnection, concurrency: 6 });
}

// ─── Helpers ────────────────────────────────────────────────────────

function parseAuthorOutput(raw: string): AuthorOut {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  let json: unknown;
  try {
    json = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Failed to parse AI JSON: ${err instanceof Error ? err.message : err}. Preview: ${cleaned.slice(0, 400)}`);
  }
  const parsed = AuthorOutput.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Author output failed validation: ${parsed.error.errors.slice(0, 5).map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")}`);
  }
  return parsed.data;
}

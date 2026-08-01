/**
 * Author worker — expands an ingested beat outline into the full narration
 * script + visual spec + concept tags. Calls Claude author profile directly
 * (the render-engine stub is bypassed — that's wired in Task 3 alongside the
 * real HTML generation).
 *
 * Writes a row to `jobs` so the UI can show step-by-step progress per beat.
 */

import { Worker } from "bullmq";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";

import { db, tables } from "../db/index.js";
import { QueueNames, queues } from "../queue/index.js";
import { workerConnection } from "./connection.js";
import { getAIClient } from "../lib/ai_client.js";
import { getRulesBlock } from "../lib/rules.js";
import { deviceCatalogForAuthor, resolveDevices } from "../lib/visual-devices.js";

interface JobData { beatId: string; isRevision: boolean }

// ─── Author output schema ───────────────────────────────────────────

const VisualSpecOut = z.object({
  background: z.enum(["solid", "ai_image", "stock_image"]).default("solid"),
  onScreenText: z.array(z.string().min(1).max(140)).min(0).max(6).default([]),
  callouts: z.array(z.string().min(1).max(80)).min(0).max(4).default([]),
  /** LP-20: device ids from the visual-devices library. Unknown ids are
   *  dropped after validation so a hallucinated name never reaches the
   *  designer. */
  devices: z.array(z.string().min(1).max(40)).min(0).max(3).default([]),
});

/** AI-authorable quiz types — the player engine's catalog MINUS the two
 *  image-dependent types (hotspot, image_choice), which need art the author
 *  can't produce at authoring time. */
const AUTHORABLE_QUIZ_TYPES = [
  "multiple_choice", "true_false", "multi_select", "fill_in",
  "match", "ordering", "sort_into", "word_bank",
  "scenario", "likert", "flashcard", "estimate",
  "memory_pairs", "this_or_that", "word_search", "guess_concept",
] as const;

/** Infer the quiz type a check beat's INGEST outline suggests, so the author
 *  can enforce variety course-wide even before sibling checks are authored
 *  (authoring runs in parallel — an unauthored sibling still has its outline).
 *  Order matters: match the most specific phrasings first. */
function parseQuizTypeHint(script: string): string | null {
  const s = script.toLowerCase();
  const patterns: Array<[RegExp, string]> = [
    [/this[- ]or[- ]that/, "this_or_that"],
    [/multi[- ]?select|select all|select several|which of/, "multi_select"],
    [/true[/ -]?false|true or false/, "true_false"],
    [/order(ing)?|sequence|arrange|steps in order|rank/, "ordering"],
    [/sort[- ]into|classif|categor|bucket/, "sort_into"],
    [/memory[- ]?pair|memory game/, "memory_pairs"],
    [/word[- ]?bank|fill the blank|complete the sentence/, "word_bank"],
    [/word[- ]?search/, "word_search"],
    [/match(ing)?\b/, "match"],
    [/scenario|situation|what would you do|judgment|judgement/, "scenario"],
    [/flashcard|flip card|self[- ]check/, "flashcard"],
    [/estimat|slider|numeric intuition|how many|how much/, "estimate"],
    [/fill[- ]in|type the answer|compute/, "fill_in"],
    [/guess[- ]the[- ]concept|guess concept|identify the term|from clues/, "guess_concept"],
    [/likert|confidence|stance|reflect/, "likert"],
    [/multiple[- ]choice|one right answer|choose the correct/, "multiple_choice"],
  ];
  for (const [re, type] of patterns) if (re.test(s)) return type;
  return null;
}

const QuizOut = z.object({
  type: z.enum(AUTHORABLE_QUIZ_TYPES),
  question: z.string().min(5).max(500),
  bloomLevel: z.enum(["remember", "understand", "apply", "analyze", "evaluate", "create"]).optional(),
  instructions: z.string().max(160).optional(),
  options: z.array(z.object({
    id: z.string(),
    text: z.string().max(300),
    isCorrect: z.boolean().optional(),
    feedback: z.string().max(300).optional(),
    matchTargetId: z.string().optional(),
    numericValue: z.number().optional(),
    numericTolerancePct: z.number().optional(),
  })).min(1).max(14),
  correctFeedback: z.string().max(300).optional(),
  wrongFeedback: z.string().max(300).optional(),
  adaptivity: z.object({
    wrong: z.object({
      rewatchBeatKey: z.string().optional(),
      message: z.string().max(200).optional(),
      maxAttempts: z.number().int().min(0).max(3).optional(),
    }).optional(),
    correct: z.object({
      skipToBeatKey: z.string().optional(),
      seekLabel: z.string().max(40).optional(),
    }).optional(),
  }).optional(),
}).optional();

const AuthorOutput = z.object({
  script: z.string().min(60).max(1500),
  visualSpec: VisualSpecOut,
  quiz: QuizOut,
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
    "onScreenText": [ short phrases displayed during the beat — 2-5 strings, each up to ~120 chars ],
    "callouts":     [ key terms or short phrases to emphasize — 1-3 strings, each up to ~70 chars ],
    "devices":      [ 1-3 visual device ids from the DEVICE CATALOG below — the animated treatments the designer builds from ]
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
- Check beats: pose a single question that tests understanding. Do NOT give the answer in the narration. ALSO include a "quiz" field in your JSON (only for check beats) — see QUIZ AUTHORING below.
- Recap beats: summarise the lesson's main ideas in 2-3 lines.

QUIZ AUTHORING (check beats only — the quiz becomes an interactive pause in the video):

Pick the ONE type that fits what is being tested. The catalog, by cognitive level:
- remember:   "true_false" (a misconception stated as fact), "flashcard" (recall a definition, then self-check), "memory_pairs" (pair terms with meanings)
- understand: "multiple_choice" (one right answer), "word_bank" (complete the principle sentence), "match" (concepts to their rules), "guess_concept" (identify the term from progressive clues)
- apply:      "fill_in" (a COMPUTED answer they type), "estimate" (numeric intuition on a slider), "ordering" (steps of a procedure), "sort_into" (classify items into 2-3 categories), "this_or_that" (rapid-fire classification)
- analyze/evaluate: "scenario" (a situation + what-would-you-do), "multi_select" (select ALL that apply)
- reflection only: "likert" (no wrong answers — confidence/stance)
VARIETY IS MANDATORY (course-wide): the context lists the quiz types ALREADY CLAIMED by other checks across the whole course and the UNUSED types remaining. Pick an UNUSED type. A learner moving through the course must meet a different interaction at each check — never the same form twice while unused types remain. Match the type to the content's cognitive level (below), but among the fitting types always prefer one nobody else has taken. Reuse is a last resort, only when no unused type can honestly test this content.
NEVER use "hotspot" or "image_choice" (they require images you cannot produce).

Schema: {"type": ..., "question": string, "bloomLevel": ..., "options": [...], "correctFeedback"?: string, "wrongFeedback"?: string, "adaptivity"?: {...}}

Per-type option conventions (follow EXACTLY — the player depends on them):
- multiple_choice / scenario: 3-4 options, exactly one isCorrect; EVERY option carries "feedback" — one line explaining WHY it is right, or WHICH real misconception the distractor represents. Distractors = plausible wrong steps from THIS lesson, never noise.
- true_false: 2 options ("True"/"False"), one isCorrect, feedback on both.
- multi_select: 4-6 options, 2+ isCorrect; use quiz-level correctFeedback/wrongFeedback (per-option feedback does not fit set answers).
- fill_in: options are the ACCEPTED ANSWERS (all isCorrect: true) — include spelling/notation variants (e.g. "x^3" and "x3"); for numeric answers set numericValue and numericTolerancePct. Math notation: use ^ for exponents (the player typesets real superscripts).
- match / sort_into: options WITHOUT matchTargetId are the targets (right column / buckets, 2-3 of them); the remaining options each set matchTargetId to their target's id. match: 3 pairs. sort_into: 4-6 items.
- ordering: 3-5 options listed in the CORRECT order (the player shuffles the display).
- word_bank: the question contains ___ gaps (three underscores each); isCorrect options fill the gaps IN ORDER; add 1-2 non-correct distractor words.
- estimate: exactly 3 options — {"id":"min","text":"min","numericValue":N}, {"id":"max","text":"max","numericValue":N}, and the answer {"id":"answer","text":"<the number>","isCorrect":true,"numericValue":N,"numericTolerancePct":5-15}.
- memory_pairs: 3-4 pairs = 6-8 options; each pair's first option sets matchTargetId to its partner's id (partner has no matchTargetId).
- this_or_that: 2 bucket options first (no matchTargetId, e.g. "Phishing"/"Legit"), then 4-6 short statements each with matchTargetId pointing at a bucket.
- word_search: 3-5 options, each a single WORD (A-Z only) with isCorrect: true — key vocabulary from the lesson.
- guess_concept: one isCorrect option = the accepted answer (add spelling-variant options also isCorrect), plus 3-4 NON-correct options that are the CLUES, ordered from vague to nearly-giving-it-away.
- flashcard: 1 option, isCorrect: true — the full answer shown on the card back; its feedback is the one-line takeaway.

ADAPTIVITY (include on every quiz): {"wrong": {"rewatchBeatKey": "<beatKey of the earlier beat that TEACHES the tested concept>", "message": "one line telling them what to look for when rewatching"}}. Pick the beat key from the earlier-beats list. On a wrong answer the player rewinds there, replays it, and re-asks — so the message should direct attention ("Watch how the exponents are subtracted, not divided"). Optionally add {"correct": {"skipToBeatKey": ...}} ONLY when a later beat is pure remediation that a correct answer earns skipping.

VISUAL SPEC RULES:
- onScreenText: 2-5 short phrases the player displays as text overlays synced to narration.
- callouts: 1-3 KEY terms (single words or short phrases) to emphasize visually.
- background: "solid" by default; "stock_image" if a real-world photo would help; "ai_image" if a custom illustration is needed.
- devices: pick 1-3 ids from the DEVICE CATALOG whose teaching purpose matches THIS beat's idea. These are proven animated treatments the designer composes from — choose the device that makes the concept physical, not decorative. Every beat should include "settle-check". Use ONLY ids from the catalog (anything else is discarded). Avoid giving adjacent beats the same dominant device unless the repetition is deliberate continuity (e.g. a running example).

DEVICE CATALOG (id: what it teaches):
${deviceCatalogForAuthor()}

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
  allEarlierBeatKeys: string[];
  usedQuizTypes: string[];
  allQuizTypes: string[];
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
  if (args.beatType === "check") {
    lines.push("");
    lines.push(`REWATCH TARGETS (valid beatKeys for adaptivity.wrong.rewatchBeatKey): ${args.allEarlierBeatKeys.join(", ") || "(none — omit rewatchBeatKey)"}`);
    const unused = args.allQuizTypes.filter((t) => !args.usedQuizTypes.includes(t));
    lines.push(`QUIZ TYPES ALREADY CLAIMED by other checks in THIS COURSE: ${args.usedQuizTypes.join(", ") || "(none yet)"}.`);
    lines.push(`You MUST pick a type NOT in that list — the course needs every check to feel different. Prefer one of the UNUSED types: ${unused.join(", ")}. Only reuse a claimed type if the content genuinely admits no unused type that fits (rare — you have ${unused.length} to choose from).`);
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
      const allEarlier = orderedBeats.filter((b) => b.order < beat.order && !b.isAlt);
      const earlierBeats = allEarlier
        .slice(-4)
        .map((b) => ({ beatType: b.beatType, beatKey: b.beatKey, outline: b.script.slice(0, 200) }));
      // Quiz variety — COURSE-WIDE, not lesson-wide. Each lesson has ~1 check,
      // so a lesson-scoped list is almost always empty and never catches the
      // real failure: two lessons independently picking the same type. Look at
      // every OTHER check in the course; use its authored type if it has one,
      // else the type its ingest outline suggests (siblings author in parallel
      // so many aren't authored yet, but their outlines already imply a type).
      let usedQuizTypes: string[] = [];
      if (beat.beatType === "check") {
        const courseChecks = await db
          .select({ script: tables.beats.script, quiz: tables.beats.quiz })
          .from(tables.beats)
          .innerJoin(tables.lessons, eq(tables.beats.lessonId, tables.lessons.id))
          .innerJoin(tables.modules, eq(tables.lessons.moduleId, tables.modules.id))
          .innerJoin(tables.sections, eq(tables.modules.sectionId, tables.sections.id))
          .where(and(
            eq(tables.sections.courseId, course.id),
            eq(tables.beats.beatType, "check"),
            eq(tables.beats.isAlt, false),
            ne(tables.beats.id, beatId),
          ));
        usedQuizTypes = [...new Set(courseChecks
          .map((b) => (b.quiz as { type?: string } | null)?.type ?? parseQuizTypeHint(b.script))
          .filter((t): t is string => !!t))];
      }

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
        allEarlierBeatKeys: allEarlier.map((b) => b.beatKey),
        usedQuizTypes,
        allQuizTypes: [...AUTHORABLE_QUIZ_TYPES],
        revisionFeedback,
      });

      const ai = await client.chat("author", {
        messages: [
          { role: "system", content: buildSystemPrompt() + await getRulesBlock("author") },
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
        // Sanitize device ids against the library — hallucinated names must
        // never reach the designer as authoritative instructions.
        visualSpec: { ...out.visualSpec, devices: resolveDevices(out.visualSpec.devices).map((d) => d.id) },
        ...(beat.beatType === "check" && out.quiz ? { quiz: out.quiz } : {}),
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
  }, { connection: workerConnection, concurrency: 6, lockDuration: 120_000, maxStalledCount: 5 });
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

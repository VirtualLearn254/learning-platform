/**
 * Ingest worker — consumes an uploaded course material and writes a course
 * outline (sections → modules → lessons → beats) into the DB.
 *
 * Writes a row to `jobs` so the UI can show step-by-step progress and any
 * error message inline. Every step also logs to stdout for SSH-side
 * debugging.
 */

import { Worker } from "bullmq";
import { eq } from "drizzle-orm";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { z } from "zod";

import { db, tables } from "../db/index.js";
import { QueueNames } from "../queue/index.js";
import { workerConnection } from "./connection.js";
import { s3 } from "../lib/s3.js";
import { getAIClient } from "../lib/ai_client.js";

interface JobData { courseId: string; materialId: string }

// ─── Outline schema (what we expect from the AI) ────────────────────

const BeatType = z.enum(["hook", "concept", "example", "check", "recap"]);

const BeatSchema = z.object({
  beatKey: z.string().min(1).max(64),
  beatType: BeatType,
  script: z.string().min(20).max(2500),
});

const LessonSchema = z.object({
  title: z.string().min(1).max(160),
  summary: z.string().max(500).default(""),
  beats: z.array(BeatSchema).min(2).max(20),
});

const ModuleSchema = z.object({
  title: z.string().min(1).max(160),
  lessons: z.array(LessonSchema).min(1).max(20),
});

const SectionSchema = z.object({
  title: z.string().min(1).max(160),
  modules: z.array(ModuleSchema).min(1).max(20),
});

const OutlineSchema = z.object({
  courseTitle: z.string().min(1).max(160),
  courseSummary: z.string().max(500).default(""),
  sections: z.array(SectionSchema).min(1).max(20),
});

type Outline = z.infer<typeof OutlineSchema>;

// ─── Prompt ─────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You convert educational documents into structured course outlines for a video-pedagogy pipeline.

OUTPUT: a single JSON object with this exact shape:

{
  "courseTitle":   string (concise, max 80 chars),
  "courseSummary": string (1-2 sentences),
  "sections": [
    {
      "title": string,
      "modules": [
        {
          "title": string,
          "lessons": [
            {
              "title":   string (one learnable concept),
              "summary": string (1 sentence),
              "beats": [
                {
                  "beatKey":  string (lowercase_with_underscores, unique within lesson),
                  "beatType": "hook" | "concept" | "example" | "check" | "recap",
                  "script":   string (60-150 words of narration-ready spoken text)
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}

RULES:
- 1-5 sections (mirror the document's structure; do not over-fragment)
- 1-3 modules per section
- 2-6 lessons per module
- 6-12 beats per lesson, following the arc: hook (1) -> concept (2-4) -> example (1-2) -> check (1) -> recap (1)
- Each script reads like a patient teacher explaining (not a punchy reel).
- 60-150 words per beat script. Use the document's own examples and vocabulary.
- Write math in plain language ("x squared" or "x^2"), never unicode superscripts that may not render.
- Beat keys are slug-style, descriptive ("linear_eq_definition", "slope_intercept_form").

Output ONLY the JSON object. No markdown fences. No prose before or after.`;

const MAX_TEXT_CHARS = 500_000; // ~125K tokens — safe under Sonnet's 200K ctx with our other tokens

// ─── Worker ─────────────────────────────────────────────────────────

export function startIngestWorker() {
  return new Worker<JobData>(QueueNames.Ingest, async (job) => {
    const { courseId, materialId } = job.data;
    console.log(`[ingest] start material=${materialId} course=${courseId}`);

    // Create a jobs row so the UI can show live status.
    const [jobRow] = await db.insert(tables.jobs).values({
      queue: "ingest",
      materialId,
      status: "running",
      progressNote: "starting",
      startedAt: new Date(),
    }).returning();
    const jobId = jobRow!.id;

    async function note(text: string) {
      console.log(`[ingest:${jobId.slice(0, 8)}] ${text}`);
      await db.update(tables.jobs).set({ progressNote: text }).where(eq(tables.jobs.id, jobId));
    }
    async function fail(err: unknown): Promise<never> {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[ingest:${jobId.slice(0, 8)}] FAILED:`, msg);
      await db.update(tables.jobs).set({
        status: "failed",
        progressNote: "failed",
        errorMessage: msg.slice(0, 2000),
        endedAt: new Date(),
      }).where(eq(tables.jobs.id, jobId));
      throw err;
    }

    try {
      const material = await db.query.materials.findFirst({ where: eq(tables.materials.id, materialId) });
      if (!material) return await fail(new Error(`Material ${materialId} not found`));

      // 1. Extract text (cached on the material row after first ingest)
      let text = material.extractedText ?? "";
      if (!text) {
        await note(`downloading ${material.filename} from storage`);
        const obj = await s3.getObject(material.s3Key);
        const lower = material.filename.toLowerCase();
        if (lower.endsWith(".pdf") || material.mimeType === "application/pdf") {
          await note(`extracting text from PDF (${(obj.size / 1024).toFixed(0)} KB)`);
          const parsed = await pdfParse(Buffer.from(obj.body));
          text = parsed.text;
        } else if (lower.endsWith(".md") || lower.endsWith(".txt") || material.mimeType.startsWith("text/")) {
          text = new TextDecoder().decode(obj.body);
        } else {
          return await fail(new Error(`Unsupported material type: ${material.mimeType} (${material.filename}). PDF / MD / TXT only.`));
        }
        await note(`extracted ${text.length.toLocaleString()} chars · caching`);
        await db.update(tables.materials).set({ extractedText: text }).where(eq(tables.materials.id, materialId));
      }

      if (text.length > MAX_TEXT_CHARS) {
        await note(`truncating ${text.length.toLocaleString()} -> ${MAX_TEXT_CHARS.toLocaleString()} chars`);
        text = text.slice(0, MAX_TEXT_CHARS);
      }
      if (text.trim().length < 200) {
        return await fail(new Error(`Only ${text.trim().length} chars of text extracted — refusing to ingest empty content.`));
      }

      // 2. Call AI
      await note(`calling Claude ingest profile (${text.length.toLocaleString()} input chars)`);
      const client = await getAIClient();
      const ai = await client.chat("ingest", {
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Document filename: ${material.filename}\n\n--- BEGIN DOCUMENT TEXT ---\n${text}\n--- END DOCUMENT TEXT ---` },
        ],
        jsonMode: true,
      });
      await note(`AI returned ${ai.text.length} chars (in=${ai.usage.inputTokens} out=${ai.usage.outputTokens})`);

      // 3. Parse + validate
      await note(`parsing + validating outline`);
      const outline = parseOutline(ai.text);

      // 4. Persist tree (transactional)
      const totals = countTotals(outline);
      await note(`writing ${totals.sections} sections, ${totals.modules} modules, ${totals.lessons} lessons, ${totals.beats} beats`);
      await db.transaction(async (tx) => {
        await tx.update(tables.courses)
          .set({ title: outline.courseTitle, summary: outline.courseSummary, updatedAt: new Date() })
          .where(eq(tables.courses.id, courseId));

        let sectionOrder = 0;
        for (const s of outline.sections) {
          const [section] = await tx.insert(tables.sections).values({
            courseId, title: s.title, order: sectionOrder++,
          }).returning();

          let moduleOrder = 0;
          for (const m of s.modules) {
            const [module] = await tx.insert(tables.modules).values({
              sectionId: section!.id, title: m.title, order: moduleOrder++,
            }).returning();

            let lessonOrder = 0;
            for (const l of m.lessons) {
              const [lesson] = await tx.insert(tables.lessons).values({
                moduleId: module!.id, title: l.title, summary: l.summary, order: lessonOrder++,
              }).returning();

              const beatValues = l.beats.map((b, i) => ({
                lessonId: lesson!.id,
                beatKey: b.beatKey,
                beatType: b.beatType,
                order: i,
                stage: "ingested" as const,
                status: "pending" as const,
                script: b.script,
                conceptsTaught: [] as string[],
                conceptsRequired: [] as string[],
              }));
              if (beatValues.length) await tx.insert(tables.beats).values(beatValues);
            }
          }
        }
      });

      await db.update(tables.materials).set({ ingestedAt: new Date() }).where(eq(tables.materials.id, materialId));

      await db.update(tables.jobs).set({
        status: "succeeded",
        progressNote: `done · ${totals.sections} sections · ${totals.modules} modules · ${totals.lessons} lessons · ${totals.beats} beats`,
        endedAt: new Date(),
      }).where(eq(tables.jobs.id, jobId));

      console.log(`[ingest] DONE material=${materialId} sections=${totals.sections} modules=${totals.modules} lessons=${totals.lessons} beats=${totals.beats}`);
      return totals;
    } catch (err) {
      // Re-throw via fail() so the jobs row is marked failed before BullMQ marks the job as failed too.
      return await fail(err);
    }
  }, { connection: workerConnection, concurrency: 2 });
}

// ─── Helpers ────────────────────────────────────────────────────────

function parseOutline(raw: string): Outline {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  let json: unknown;
  try {
    json = JSON.parse(cleaned);
  } catch (err) {
    const preview = cleaned.slice(0, 400);
    throw new Error(`Failed to parse AI JSON: ${err instanceof Error ? err.message : err}. Preview: ${preview}`);
  }
  const parsed = OutlineSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`AI outline failed validation: ${parsed.error.errors.slice(0, 5).map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")}`);
  }
  return parsed.data;
}

function countTotals(o: Outline) {
  let modules = 0, lessons = 0, beats = 0;
  for (const s of o.sections) {
    modules += s.modules.length;
    for (const m of s.modules) {
      lessons += m.lessons.length;
      for (const l of m.lessons) beats += l.beats.length;
    }
  }
  return { sections: o.sections.length, modules, lessons, beats };
}

/**
 * Lesson-notes worker (LP-19) — the designer AI drafts a rich, branded,
 * print-ready reference document for a lesson, FROM THE SOURCE MATERIAL
 * (materials.extractedText), not the beat narration. It is deliberately
 * broader than the video: definitions, edge cases, analogies and context
 * the narration had no room for. Output is a self-contained HTML document
 * rendered to A4 PDF by the same headless Chromium the other PDFs use,
 * stored at lessons/<id>/notes.pdf, and shipped INSIDE the SCORM zip as
 * lesson notes (see scorm.worker).
 *
 * Triggered automatically after ingest, and on demand via
 * POST /lessons/:id/notes ("Regenerate notes").
 */

import { Worker } from "bullmq";
import { eq, asc, inArray } from "drizzle-orm";

import { db, tables } from "../db/index.js";
import { QueueNames } from "../queue/index.js";
import { workerConnection } from "./connection.js";
import { s3 } from "../lib/s3.js";
import { htmlToPdf } from "../lib/pdf.js";
import { getStylePalette } from "../lib/hf-designer.js";
import { getAIClient } from "../lib/ai_client.js";
import { getRulesBlock } from "../lib/rules.js";

interface JobData { lessonId: string }

/** Source material cap — keeps the prompt inside every provider's window. */
const MATERIAL_CHAR_CAP = 48_000;

const SYSTEM_PROMPT = `You are a senior instructional designer AND print designer producing LESSON NOTES: the complete written reference for one lesson, to be distributed through an LMS alongside the lesson video.

AUTHORITY: the SOURCE MATERIAL is your authority — cover it fully for the topics this lesson owns, INCLUDING important details, definitions, caveats, edge cases and examples that a short video narration would have skipped. This is NOT a transcript and NOT a summary of the video.

AUDIENCE: adult learners (18+). Editorial-explainer register — warm, precise, zero cartoonishness.

CONTENT STRUCTURE (adapt headings to the subject, keep the skeleton):
1. Cover header: lesson title, course title, a one-line promise of what the reader will be able to do.
2. "What you'll learn" — 3-6 concrete objectives.
3. Main body organized by concept: clear hierarchy, generous explanations, at least one ANALOGY per major concept, worked examples with real numbers/scenarios where the subject allows.
4. Key-terms boxes: every term of art gets a plain-language definition where it first appears.
5. "Common pitfalls" — the misconceptions and mistakes practitioners actually make.
6. Quick-reference: a compact table or checklist the learner can return to.
7. FINAL PAGE — "Instructor answer key": each quiz question with the correct answer marked and one sentence on why. Start this section with <div class="page-break"></div> so it prints on its own page.

DESIGN RULES (strict):
- Output ONE complete self-contained HTML document. Inline <style> only. No external fonts, scripts, or images. No <img> with URLs.
- Illustrations: inline SVG only — simple, purposeful diagrams (flows, comparisons, timelines, labeled parts), plus small inline SVG icons for section markers. Illustrate where a picture genuinely clarifies; never decorate for its own sake.
- Print: A4 portrait. Use @page { size: A4; margin: 0; } and give the body padding of roughly 18mm 16mm. Define .page-break { page-break-before: always; }. Avoid elements taller than one page; let text flow.
- Branding: you will be given the lesson's palette (bg/ink/muted/accent/surface). Body text stays near-black on white for print readability; use the palette for the cover band, headings, rules, boxes and SVG accents so the document visibly belongs to the same course as the video.
- Typography: system font stack (e.g. -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif); comfortable line-height (1.55+); real hierarchy (cover > h1 > h2 > boxes); never cram.

Return ONLY the HTML document — no markdown fences, no commentary.`;

export function startNotesWorker() {
  return new Worker<JobData>(QueueNames.Notes, async (job) => {
    const { lessonId } = job.data;
    console.log(`[notes] start lesson=${lessonId}`);

    const [jobRow] = await db.insert(tables.jobs).values({
      queue: "lesson_notes",
      lessonId,
      status: "running",
      progressNote: "loading lesson + source material",
      startedAt: new Date(),
    }).returning();
    const jobId = jobRow!.id;

    async function note(text: string) {
      console.log(`[notes:${jobId.slice(0, 8)}] ${text}`);
      await db.update(tables.jobs).set({ progressNote: text }).where(eq(tables.jobs.id, jobId));
    }
    async function fail(err: unknown): Promise<never> {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[notes:${jobId.slice(0, 8)}] FAILED:`, msg);
      await db.update(tables.jobs).set({
        status: "failed", progressNote: "failed",
        errorMessage: msg.slice(0, 2000), endedAt: new Date(),
      }).where(eq(tables.jobs.id, jobId));
      throw err;
    }

    try {
      const lesson = await db.query.lessons.findFirst({ where: eq(tables.lessons.id, lessonId) });
      if (!lesson) return await fail(new Error(`Lesson ${lessonId} not found`));

      // Lesson → module → section → course (for title + source materials).
      const module = await db.query.modules.findFirst({ where: eq(tables.modules.id, lesson.moduleId) });
      const section = module ? await db.query.sections.findFirst({ where: eq(tables.sections.id, module.sectionId) }) : null;
      const course = section ? await db.query.courses.findFirst({ where: eq(tables.courses.id, section.courseId) }) : null;

      const materials = course
        ? await db.select().from(tables.materials).where(eq(tables.materials.courseId, course.id))
        : [];
      const sourceText = materials.map((m) => m.extractedText ?? "").join("\n\n---\n\n").trim();
      if (!sourceText) return await fail(new Error("No ingested source material found for this lesson's course"));

      const beats = await db.select().from(tables.beats)
        .where(eq(tables.beats.lessonId, lessonId))
        .orderBy(asc(tables.beats.order));
      const main = beats.filter((b) => !b.isAlt);
      const concepts = [...new Set(main.flatMap((b) => (b.conceptsTaught ?? []) as string[]))];
      const quizzes = main
        .map((b) => b.quiz as { question?: string; options?: Array<{ text: string; isCorrect?: boolean; feedback?: string }> } | null)
        .filter((q): q is NonNullable<typeof q> => !!q?.question && Array.isArray(q.options));

      const lessonStyle = (lesson.styleHints ?? null) as { style?: string } | null;
      const palette = getStylePalette(lessonStyle?.style);

      const clipped = sourceText.length > MATERIAL_CHAR_CAP;
      const material = sourceText.slice(0, MATERIAL_CHAR_CAP);
      await note(`drafting notes (${(material.length / 1000).toFixed(0)}k chars of source${clipped ? ", clipped" : ""} · ${quizzes.length} quiz(zes))`);

      const rulesBlock = await getRulesBlock("designer").catch(() => "");
      const userPrompt = [
        `COURSE: ${course?.title ?? "—"}`,
        `LESSON: ${lesson.title}`,
        lesson.summary ? `LESSON SUMMARY: ${lesson.summary}` : "",
        concepts.length ? `CONCEPTS THIS LESSON OWNS (scope the notes to these): ${concepts.join(", ")}` : "",
        `PALETTE (use for branding accents): bg=${palette.bg} ink=${palette.ink} muted=${palette.muted} accent=${palette.accent} surface=${palette.surface}`,
        quizzes.length
          ? `QUIZ QUESTIONS (for the final Instructor answer key page):\n${quizzes.map((q, i) =>
              `${i + 1}. ${q.question}\n${(q.options ?? []).map((o) => `   ${o.isCorrect ? "[correct] " : ""}${o.text}`).join("\n")}`).join("\n")}`
          : "This lesson has no quizzes — omit the answer-key section.",
        `\nSOURCE MATERIAL:\n${material}`,
      ].filter(Boolean).join("\n\n") + (rulesBlock ? `\n\n${rulesBlock}` : "");

      const client = await getAIClient();
      const ai = await client.chat("designer", {
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
      });
      await note(`AI returned ${ai.text.length} chars (in=${ai.usage.inputTokens} out=${ai.usage.outputTokens}) · rendering PDF`);

      let html = ai.text.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/i, "").trim();
      if (!/<html[\s>]/i.test(html)) {
        html = `<!doctype html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`;
      }
      // Self-containment guard: strip any external resource the model snuck in.
      html = html.replace(/<img[^>]+src=["']https?:[^>]*>/gi, "")
        .replace(/<link[^>]+href=["']https?:[^>]*>/gi, "")
        .replace(/<script[^>]*src=["']https?:[^>]*>\s*<\/script>/gi, "");

      const pdf = await htmlToPdf(html);
      const key = `lessons/${lessonId}/notes.pdf`;
      await s3.putObject(key, pdf, { contentType: "application/pdf" });

      await db.update(tables.lessons).set({
        notesPdfKey: key,
        notesGeneratedAt: new Date(),
      }).where(eq(tables.lessons.id, lessonId));

      await db.update(tables.jobs).set({
        status: "succeeded",
        progressNote: `done · ${(pdf.length / 1024).toFixed(0)} KB`,
        endedAt: new Date(),
      }).where(eq(tables.jobs.id, jobId));

      console.log(`[notes] DONE lesson=${lessonId} key=${key} size=${pdf.length}`);
      return { lessonId, notesPdfKey: key, sizeBytes: pdf.length };
    } catch (err) {
      return await fail(err);
    }
  }, { connection: workerConnection, concurrency: 2, lockDuration: 300_000 });
}

/** Queue notes for every lesson of a course that doesn't have them yet —
 *  called by the ingest worker once the lesson tree exists. */
export async function queueMissingNotesForCourse(courseId: string, notesQueue: { add: (name: string, data: { lessonId: string }) => Promise<unknown> }) {
  const sections = await db.select().from(tables.sections).where(eq(tables.sections.courseId, courseId));
  if (sections.length === 0) return 0;
  const modules = await db.select().from(tables.modules)
    .where(inArray(tables.modules.sectionId, sections.map((s) => s.id)));
  if (modules.length === 0) return 0;
  const lessons = await db.select().from(tables.lessons)
    .where(inArray(tables.lessons.moduleId, modules.map((m) => m.id)));
  let queued = 0;
  for (const l of lessons) {
    if (l.notesPdfKey) continue;
    await notesQueue.add("notes-after-ingest", { lessonId: l.id });
    queued++;
  }
  return queued;
}

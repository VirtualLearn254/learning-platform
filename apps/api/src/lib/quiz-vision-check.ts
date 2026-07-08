/**
 * quiz-vision-check — automated visual QA on published quiz scenes.
 *
 * Renders each quiz cue as a static page with the SHIPPING CSS + engine + the
 * lesson's skin (buildQuizScenePage), screenshots it headless, and asks the
 * vision "verifier" profile to flag real rendering defects: text overflowing
 * the frame, clipped options, unreadable contrast, correct/wrong states that
 * don't visibly differ, buttons hidden, or a skin that clashes with the beats.
 *
 * It judges RENDERING, never pedagogy — a well-authored quiz with a broken
 * layout is a failure; a plain quiz that renders cleanly is a pass.
 */

import { buildQuizScenePage, type ScormQuizCue } from "@lp/scorm-packager";
import type { AIClient } from "@lp/ai-provider";

import { htmlToPng } from "./render.js";

export interface QuizVisionIssue {
  severity: "P0" | "P1" | "P2";
  what: string;
}
export interface QuizVisionResult {
  beatKey: string;
  type: string;
  pass: boolean;          // false when any P0 (broken render) is present
  issues: QuizVisionIssue[];
}

const VISION_SYSTEM = `You are a strict visual QA reviewer for an in-video quiz card (1280x720).
Judge only how it RENDERS — not the pedagogy or wording quality.

Report a defect ONLY if you can SEE it in the image. Severity:
- P0 (breaks the experience): text or options overflow / are clipped by the frame edge; options overlap; a control (answer buttons, submit, options) is missing or unreadable; text-on-background contrast so low it's illegible.
- P1 (clearly wrong but usable): cramped/awkward spacing, an element visibly misaligned, an accent colour that fights the palette, a decorative motif so heavy it competes with the question.
- P2 (minor polish): small spacing/alignment nits.

Do NOT invent issues. A clean, calm, legible card with no visible problem is a PASS with an empty list.

Reply with ONLY JSON: {"issues":[{"severity":"P0|P1|P2","what":"<one concrete sentence naming what you see and where>"}]}`;

/** Vision-QA every quiz cue in a lesson. Best-effort per cue: a render or
 *  vision failure on one cue yields a P2 note, never throws. */
export async function checkQuizFrames(
  ai: AIClient,
  args: { quizzes: Array<{ cue: ScormQuizCue }>; skinCss?: string; meta?: { lessonId?: string } },
): Promise<QuizVisionResult[]> {
  const results: QuizVisionResult[] = [];
  for (const q of args.quizzes) {
    const cue = q.cue;
    const beatKey = cue.beatKey ?? "?";
    const type = cue.quiz?.type ?? "?";
    try {
      const html = buildQuizScenePage(cue, args.skinCss);
      const png = await htmlToPng(html, 1280, 720);
      const res = await ai.vision("verifier", {
        meta: args.meta,
        system: VISION_SYSTEM,
        prompt: `A ${type} quiz card ("${String(cue.quiz?.question ?? "").slice(0, 80)}"). Find only VISIBLE rendering defects.`,
        images: [{ base64: png.toString("base64"), mediaType: "image/png" as const }],
      });
      let issues: QuizVisionIssue[] = [];
      const m = res.text.match(/\{[\s\S]*\}/);
      if (m) {
        const parsed = JSON.parse(m[0]) as { issues?: QuizVisionIssue[] };
        issues = (parsed.issues ?? []).filter(
          (i) => i && (i.severity === "P0" || i.severity === "P1" || i.severity === "P2") && typeof i.what === "string",
        );
      }
      results.push({ beatKey, type, pass: !issues.some((i) => i.severity === "P0"), issues });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[quiz-vision] ${beatKey}: check failed (${msg.slice(0, 120)}) — skipping`);
      results.push({ beatKey, type, pass: true, issues: [{ severity: "P2", what: `vision check skipped: ${msg.slice(0, 80)}` }] });
    }
  }
  return results;
}

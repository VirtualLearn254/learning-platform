/**
 * Per-lesson design brief: one cheap AI call generating the lesson's shared
 * visual language, injected into every beat's designer prompt. This is what
 * makes sibling beats look like one production instead of seven independent
 * designs (palette + typography were already locked by the skeleton; the
 * brief locks layout language, decorative motifs, and device choices).
 *
 * Generated lazily on the first beat render of a lesson; stored on
 * lessons.design_brief. Delete the column value to force regeneration.
 */

import { eq } from "drizzle-orm";

import { db, tables } from "../db/index.js";
import type { createAIClient } from "@lp/ai-provider";

type AIClient = ReturnType<typeof createAIClient>;

export async function ensureDesignBrief(
  ai: AIClient,
  lessonId: string,
  opts: { lessonTitle: string; styleHint?: string; beatKeys: string[] },
): Promise<string | null> {
  const lesson = await db.query.lessons.findFirst({ where: eq(tables.lessons.id, lessonId) });
  if (!lesson) return null;
  if (lesson.designBrief) return lesson.designBrief;

  try {
    const res = await ai.chat("utility", {
      messages: [
        { role: "system", content: `You write terse visual-language briefs for animated educational video lessons. The brief locks the SHARED design decisions every beat in the lesson must follow, so sibling beats look like one production. Palette and typography scale are already fixed elsewhere — do NOT specify colors or font sizes. Specify exactly these, one line each:
- eyebrow format (e.g. "NN — SECTION LABEL" with a short accent rule)
- card treatment (radius, border, shadow style)
- decorative motif (ONE recurring background device, e.g. faint oversized glyphs relevant to the topic)
- divider/rule style
- preferred pictorial devices for this subject matter (2-3, e.g. number lines, digit boxes)
- numbering/progress convention across beats
Output only the brief lines, no preamble.` },
        { role: "user", content: `Lesson: "${opts.lessonTitle}" (style: ${opts.styleHint ?? "swiss-grid"}). Beats: ${opts.beatKeys.join(", ")}.` },
      ],
      meta: { lessonId },
    });
    const brief = res.text.trim().slice(0, 2000);
    if (brief.length < 40) return null; // garbage guard
    await db.update(tables.lessons).set({ designBrief: brief }).where(eq(tables.lessons.id, lessonId));
    console.log(`[design-brief] generated for lesson ${lessonId} (${brief.length} chars)`);
    return brief;
  } catch (err) {
    console.warn(`[design-brief] generation failed (beats proceed without):`, err instanceof Error ? err.message : err);
    return null;
  }
}

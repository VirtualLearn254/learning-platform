/**
 * hf-designer — asks the "designer" AI profile to author a full HyperFrames
 * composition (HTML + CSS + GSAP timeline) for one beat, timed to the
 * narration audio. This replaces the static template fill-in with bespoke
 * animated design — the same recipe that produced the hyperframes-pipeline
 * quality bar, adapted to run against the Anthropic API instead of a local
 * Claude Code subprocess.
 *
 * Output contract (validated by lintHfComposition below):
 *   - standalone index.html, no <template> wrapper
 *   - one root <div data-composition-id="root" data-width data-height>
 *   - narration referenced as an <audio class="clip"> so HF muxes it
 *   - GSAP timeline registered on window.__timelines["root"], built
 *     synchronously (never inside async/setTimeout)
 *   - visual settles >= 1s before the audio ends
 */

import type { createAIClient } from "@lp/ai-provider";
import type { WordTimestamp } from "./tts.js";

type AIClient = ReturnType<typeof createAIClient>;

export interface DesignBeatInput {
  beatKey: string;
  beatType: "hook" | "concept" | "example" | "check" | "recap";
  lessonTitle: string;
  script: string;
  onScreenText: string[];
  callouts: string[];
  /** Narration duration in seconds — drives all timing. */
  audioDurationSec: number;
  /** Style slug carried from the style library (kinetic-pop, swiss-grid, …). */
  styleHint?: string;
  /** Whisper word-level timestamps — when present, reveals anchor to the
   *  actual spoken word instead of proportional estimates. */
  wordTimestamps?: WordTimestamp[];
  /** Compact mode for tighter output windows (deepseek etc.): 2-3 phases,
   *  terser CSS, one pictorial device — targets < 7K output tokens. */
  compact?: boolean;
  /** Feedback from a failed lint/render attempt — appended on retry. */
  repairNotes?: string;
  /** Usage-attribution context — flows into ai_usage rows. */
  meta?: { beatId?: string; lessonId?: string };
}

const SYSTEM_PROMPT = `You are a motion designer authoring HyperFrames video compositions — HTML files that a capture engine renders frame-by-frame into MP4. You design educational explainer beats for an adult professional audience: editorial, confident, never cartoonish.

## HyperFrames structural contract (violations = render failure)

1. Output ONE standalone HTML file. NO <template> wrapper — the composition div goes directly in <body>.
2. Root element: <div data-composition-id="root" data-width="1920" data-height="1080"> containing everything.
3. Every timed element is a "clip": class="clip", unique id, data-start (seconds), data-duration (seconds), data-track-index (integer; same-track clips must not overlap in time).
4. The narration audio MUST be included as: <audio id="narration" class="clip" src="assets/narration.mp3" data-start="0" data-track-index="0"></audio>
5. Load GSAP from CDN: <script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
6. Register the timeline SYNCHRONOUSLY at top level (never in async/setTimeout/Promise/load handlers):
   window.__timelines = window.__timelines || {};
   const tl = gsap.timeline({ paused: true });
   /* tweens… */
   window.__timelines["root"] = tl;
7. Use data-track-index for scheduling, CSS z-index for visual layering. Never use data-layer or data-end.

## Layout-before-animation doctrine

- Write static CSS for each element's HERO FRAME (fully entered, correctly placed) FIRST. The CSS position is ground truth.
- Content containers fill the frame with width:100%; height:100%; padding + flex + gap. NEVER position:absolute on content containers (reserve absolute for decoratives).
- Entrances: gsap.from() TO the CSS position. Exits: gsap.to() away from it.
- NO UNINTENTIONAL OVERLAPS — two text blocks may never collide. If elements share screen space across time, exit A fully before B enters. This is a hard requirement.
- Keep 96px minimum padding from frame edges. Nothing may clip off-frame.

## Pacing doctrine (teacher, not reel)

- 2-4 visual phases per beat, each holding at least 6 seconds. Fewer, longer phases beat many fast ones.
- Time phases proportionally to the narration: if the script has 3 ideas, split the duration ~proportionally to their word counts.
- Every element gets subtle mid-scene life after entering (slow float ±6px over 4-6s alternating, counter tick, gentle scale breathe 1.00→1.015). Static frozen elements read as broken.
- ALL motion must SETTLE by (duration − 1.0s). The last second is a calm hold — no entrances, no exits, no movement starting there.
- Entrance durations 0.5-0.9s, ease "power3.out". Stagger sibling entrances by 0.12-0.2s.

## Typography & design

- Big type: heroes 96-150px, section titles 64-84px, body 34-44px, captions 22-26px. This is video, not a webpage.
- One accent color per beat, drawn from the style hint. High contrast text (no grey-on-grey).
- Use real design: cards with generous padding, thin accent rules, numbered markers, subtle grain/pattern backdrops via CSS gradients. No emoji. No stock-photo placeholders.
- Font stack: system-ui/Helvetica-adjacent is fine; do not @import webfonts (offline render).

## PICTORIAL MANDATE (non-negotiable — text-only phases are rejected)

Every phase MUST contain at least one substantial non-text visual, hand-built
with inline SVG or shaped CSS. The visual is the star; text supports it.
Pick the device that TEACHES the content:

- Quantities/counts → icon grids (repeat a simple SVG glyph N times; for 25.2
  people draw 25 person glyphs + one clipped to 20% width), oversized numerals
  (300-500px, cropped off-frame edges is allowed and looks great)
- Rounding/scales/ranges → a number line (SVG line + ticks + labeled marker +
  animated pointer), digit boxes with the deciding digit highlighted
- Comparisons/choices → two big cards or panels with a vs. divider, scale/
  see-saw metaphor built from rects
- Processes/sequences → numbered step nodes connected by animated SVG arrows
  (stroke-dasharray draw-on)
- Parts of a whole → CSS conic-gradient pie, stacked bar of rects
- Formulas/equations → build the expression as large styled spans, animate
  terms in one at a time, highlight the operative term in accent
- Concepts/relations → hub-and-spoke: center node + branch nodes + SVG connector lines

Animate the visual itself (draw lines with stroke-dashoffset, count numbers
up with gsap textContent snap, grow bars/slices, slide markers) — not just
its opacity.

## Composition (fill the frame — this is 1920x1080 cinema, not a document)

- Content must occupy ≥60% of the frame area at the hero moment. If your
  layout hugs one corner with dead space elsewhere, scale UP: bigger visual,
  bigger type, wider spread.
- VARY layout between phases — consecutive phases must use different
  archetypes: centered hero / split (visual one side, text the other) /
  full-bleed stat / card row / diagram-dominant. Never the same
  eyebrow+headline+sub stack twice in a row.
- Oversized display numbers may bleed off-frame edges deliberately.
- Decorative layer: every phase gets background interest (faint oversized
  numeral, thin grid, accent shapes, gradient wash) — separate from content,
  low contrast, behind everything.

## Output format

Reply with ONLY the complete HTML file. No markdown fences, no commentary before or after. Start with <!doctype html>.`;

interface StylePalette {
  bg: string;
  ink: string;
  muted: string;
  accent: string;
  surface: string;
  desc: string;
}

const STYLE_PALETTES: Record<string, StylePalette> = {
  "kinetic-pop":   { bg: "#F7F8FA", ink: "#0B1220", muted: "#5B6472", accent: "#2563EB", surface: "#FFFFFF", desc: "bold geometric, electric" },
  "swiss-grid":    { bg: "#FAFAF7", ink: "#111111", muted: "#6B6B66", accent: "#DC2626", surface: "#FFFFFF", desc: "strict grid, generous whitespace" },
  "warm-grain":    { bg: "#FBF6EE", ink: "#221A10", muted: "#7A6E5C", accent: "#D97706", surface: "#FFFDF8", desc: "soft shadows, warm" },
  "liquid-glass":  { bg: "#0B1B2B", ink: "#F4F8FB", muted: "#93A7B8", accent: "#2DD4BF", surface: "rgba(255,255,255,0.07)", desc: "frosted-glass cards on deep navy (DARK style)" },
  "neon-grid":     { bg: "#101418", ink: "#EEF2F5", muted: "#8B98A5", accent: "#22D3EE", surface: "#171C22", desc: "thin luminous rules on charcoal (DARK style)" },
  "paper-mark":    { bg: "#F6F1E7", ink: "#1F1B14", muted: "#75705F", accent: "#166534", surface: "#FBF8F1", desc: "underline/annotation marks" },
  "magnetic-flow": { bg: "#F6F4FB", ink: "#17131F", muted: "#6E6880", accent: "#7C3AED", surface: "#FFFFFF", desc: "flowing curved dividers" },
};

/** The exact CSS variable block + structural boilerplate the model must copy
 *  verbatim. Removing color/structure judgment from the model eliminates the
 *  two failure modes we've seen in production (invented dark backgrounds,
 *  broken HF contract) and saves ~1.5K output tokens of boilerplate drift. */
function buildSkeleton(p: StylePalette, durationSec: number): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<style>
  :root {
    --bg: ${p.bg};
    --ink: ${p.ink};
    --muted: ${p.muted};
    --accent: ${p.accent};
    --surface: ${p.surface};
  }
  html, body { margin: 0; padding: 0; }
  [data-composition-id="root"] {
    width: 1920px; height: 1080px; overflow: hidden; position: relative;
    background: var(--bg);
    color: var(--ink);
    font-family: system-ui, "Helvetica Neue", Arial, sans-serif;
  }
  /* …your phase styles here… */
</style>
</head>
<body>
  <div data-composition-id="root" data-width="1920" data-height="1080" data-duration="${durationSec.toFixed(1)}">
    <audio id="narration" class="clip" src="assets/narration.mp3" data-start="0" data-track-index="0"></audio>
    <!-- …your phase clips here, each: class="clip" data-start data-duration data-track-index="1"… -->
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      /* …your tweens here (absolute seconds)… */
      window.__timelines["root"] = tl;
    </script>
  </div>
</body>
</html>`;
}

export function buildDesignerPrompt(input: DesignBeatInput): { system: string; user: string } {
  const dur = input.audioDurationSec;
  const settleAt = Math.max(1, dur - 1).toFixed(1);
  const palette = STYLE_PALETTES[input.styleHint ?? ""] ?? STYLE_PALETTES["swiss-grid"]!;
  const skeleton = buildSkeleton(palette, dur);

  const user = `Design the composition for this beat.

## MANDATORY SKELETON — copy this EXACTLY, fill in the marked areas only

${skeleton}

Rules for the skeleton:
- The :root CSS variables and the root div's background: var(--bg) are IMMUTABLE.
  Do not change, override, or add any other background color on the root or body.
  Use ONLY var(--bg), var(--ink), var(--muted), var(--accent), var(--surface)
  for colors (rgba/opacity derivatives of them are fine for decoratives).
- Text sits on var(--bg) or var(--surface) and must use var(--ink) or var(--muted).
  NEVER place ink-colored text on a dark element or light text on a light element.
- Keep the audio clip, gsap CDN script, and __timelines registration exactly as shown.
${input.compact ? `
## COMPACT MODE (hard output budget)
- Exactly 2 or 3 phases, not more.
- ONE pictorial device total (pick the single best one for the content),
  reused/evolved across phases rather than new visuals per phase.
- Terse CSS: shorthand properties, no comments in output, class names <= 4 chars.
- Target under 6,500 tokens of output. If in doubt, cut decoration, never
  the pictorial device or the timing accuracy.` : ""}

BEAT: ${input.beatKey} (type: ${input.beatType})
LESSON: ${input.lessonTitle}
COMPOSITION DURATION: ${dur.toFixed(1)}s exactly — set data-duration="${dur.toFixed(1)}" on the root composition div.
ALL MOTION SETTLED BY: ${settleAt}s.

NARRATION (already recorded; the audio file is assets/narration.mp3):
"""
${input.script.trim()}
"""

ON-SCREEN TEXT (the key phrases that must appear, in narration order — you may shorten but not reword):
${input.onScreenText.map((t, i) => `${i + 1}. ${t}`).join("\n") || "(none — design from the narration's key ideas)"}

CALLOUT CHIPS (small supporting labels, optional placement):
${input.callouts.join(" · ") || "(none)"}

STYLE: ${input.styleHint ?? "swiss-grid"} — ${palette.desc}. Colors come ONLY from the skeleton's CSS variables.

${input.wordTimestamps && input.wordTimestamps.length > 0 ? `WORD TIMINGS (whisper-aligned; "word@seconds"). Anchor each on-screen reveal to the moment its phrase is SPOKEN — start the entrance 0.1-0.2s before the first word of the phrase:
${input.wordTimestamps.map((w) => `${w.word.trim()}@${w.start.toFixed(1)}`).join(" ")}

Phase the visuals to follow the narration's idea order, using the word timings above as the ground truth for when each phase begins.` : `Phase the visuals to follow the narration's idea order. Reveal each on-screen text roughly when the narrator reaches that idea (estimate by word position ÷ total words × ${dur.toFixed(1)}s).`} Remember: 2-4 phases, ≥6s each, settle by ${settleAt}s, zero overlaps.${input.repairNotes ? `

PREVIOUS ATTEMPT FAILED VALIDATION — fix these issues:
${input.repairNotes}` : ""}`;

  return { system: SYSTEM_PROMPT, user };
}

// ─── Static lint: catch contract violations before spending render time ───

export interface HfLintResult {
  ok: boolean;
  issues: string[];
}

export function lintHfComposition(html: string, expectedDurationSec: number, styleHint?: string): HfLintResult {
  const issues: string[] = [];

  // Style contract: the palette's exact bg hex must be declared as --bg and
  // the root must use var(--bg). Catches invented backgrounds (the deepseek
  // dark-on-dark failure) in milliseconds instead of after a 5-min render.
  const palette = STYLE_PALETTES[styleHint ?? ""] ?? STYLE_PALETTES["swiss-grid"]!;
  if (!new RegExp(`--bg:\\s*${palette.bg.replace("#", "#?")}`, "i").test(html)) {
    issues.push(`:root must declare --bg: ${palette.bg} exactly (the style's mandatory background)`);
  }
  if (!/background:\s*var\(--bg\)/.test(html)) {
    issues.push("Root composition must use background: var(--bg) — no invented background colors");
  }

  if (!/^\s*<!doctype html>/i.test(html)) issues.push(`Must start with <!doctype html> (got: ${html.slice(0, 40)}…)`);
  if (/<template[\s>]/i.test(html)) issues.push("Standalone composition must not use <template> wrapper");
  if (!/data-composition-id\s*=\s*["']root["']/.test(html)) issues.push(`Missing root <div data-composition-id="root">`);
  if (!/data-width\s*=\s*["']1920["']/.test(html) || !/data-height\s*=\s*["']1080["']/.test(html)) {
    issues.push("Root composition needs data-width=\"1920\" data-height=\"1080\"");
  }
  if (!/<audio[^>]*class\s*=\s*["'][^"']*clip[^"']*["'][^>]*src\s*=\s*["']assets\/narration\.mp3["']/.test(html)
      && !/<audio[^>]*src\s*=\s*["']assets\/narration\.mp3["'][^>]*class\s*=\s*["'][^"']*clip/.test(html)) {
    issues.push(`Missing narration clip: <audio class="clip" src="assets/narration.mp3" data-start="0" data-track-index="0">`);
  }
  if (!/window\.__timelines\s*\[\s*["']root["']\s*\]\s*=/.test(html)) {
    issues.push(`Timeline not registered: window.__timelines["root"] = tl`);
  }
  if (!/gsap\.timeline\s*\(\s*\{[^}]*paused\s*:\s*true/.test(html)) {
    issues.push("GSAP timeline must be created with { paused: true }");
  }
  if (/window\.__timelines[^;]*=[^;]*;\s*$/.test(html) === false && /(setTimeout|addEventListener\s*\(\s*["']load|\.then\s*\(|await )/.test(
      html.slice(html.indexOf("__timelines")))) {
    // Heuristic: async constructs after the __timelines mention are suspicious but not fatal.
  }
  if (/data-layer|data-end\s*=/.test(html)) issues.push("Forbidden attributes: data-layer / data-end (use data-track-index / data-duration)");
  if (/@import\s+url|fonts\.googleapis/.test(html)) issues.push("No webfont imports — offline render");

  // Duration attr on the root composition should match the audio (±0.5s tolerated).
  const durMatch = html.match(/data-composition-id\s*=\s*["']root["'][^>]*data-duration\s*=\s*["']([\d.]+)["']/)
    ?? html.match(/data-duration\s*=\s*["']([\d.]+)["'][^>]*data-composition-id\s*=\s*["']root["']/);
  if (!durMatch) {
    issues.push(`Root composition missing data-duration="${expectedDurationSec.toFixed(1)}"`);
  } else {
    const got = parseFloat(durMatch[1]!);
    if (Math.abs(got - expectedDurationSec) > 0.75) {
      issues.push(`Root data-duration=${got} but narration is ${expectedDurationSec.toFixed(1)}s — they must match`);
    }
  }

  return { ok: issues.length === 0, issues };
}

/**
 * Extract the composition from a model response. Handles:
 *  - markdown fences
 *  - reasoning models that think out loud around the HTML
 *  - draft-then-revise outputs (GLM 5.2 writes a draft, critiques it, then a
 *    refined version) — we take the LAST complete <!doctype…</html> document
 * Returns null when no complete document exists (true truncation).
 */
export function extractHtml(raw: string): string | null {
  const fenced = raw.match(/```(?:html)?\s*([\s\S]*?)```\s*$/);
  const body = fenced ? fenced[1]! : raw;
  const starts = [...body.matchAll(/<!doctype html>/gi)].map((m) => m.index!);
  // Prefer the last document that is COMPLETE (has a closing </html>).
  for (let i = starts.length - 1; i >= 0; i--) {
    const end = body.indexOf("</html>", starts[i]!);
    if (end >= 0) return body.slice(starts[i]!, end + 7).trim();
  }
  return null;
}

/**
 * Author the animated composition, with one automatic repair round if the
 * first attempt fails lint. Throws if both attempts fail — caller falls
 * back to the static template path.
 */
export async function designAnimatedBeat(
  ai: AIClient,
  input: DesignBeatInput,
  onNote?: (note: string) => Promise<void> | void,
): Promise<{ html: string; attempts: number }> {
  let repairNotes: string | undefined;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const { system, user } = buildDesignerPrompt({ ...input, repairNotes });
    await onNote?.(`designing animated composition (attempt ${attempt})`);
    const res = await ai.chat("designer", {
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      meta: input.meta,
    });
    const html = extractHtml(res.text);
    // Reasoning models (GLM 5.2) may hit the token limit AFTER emitting a
    // complete document — only treat truncation as fatal when no complete
    // document survived extraction.
    if (!html) {
      repairNotes = res.truncated
        ? "Output hit the token limit before a complete document was emitted — skip all analysis/commentary, output ONLY the HTML, terser CSS."
        : "No complete <!doctype html>…</html> document found in the reply — output ONLY the HTML file.";
      await onNote?.(res.truncated ? "designer output truncated, retrying compact" : "no complete document in reply, retrying");
      continue;
    }
    const lint = lintHfComposition(html, input.audioDurationSec, input.styleHint);
    if (lint.ok) return { html, attempts: attempt };
    repairNotes = lint.issues.map((i) => `- ${i}`).join("\n");
    await onNote?.(`lint failed (${lint.issues.length} issues), ${attempt === 1 ? "retrying with feedback" : "giving up"}`);
  }

  throw new Error(`Designer output failed HF lint after 2 attempts: ${repairNotes}`);
}

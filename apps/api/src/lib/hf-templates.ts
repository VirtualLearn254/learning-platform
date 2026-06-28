/**
 * HF-derived static templates. Ports the visual layer from
 * hyperframes-pipeline/templates/index.ts but strips GSAP / audio refs
 * since the render worker captures a single static frame per beat.
 *
 * Five layouts cover the five beat types cleanly. The picked style
 * applies via the body's `data-style` attribute, pulling CSS custom
 * properties from hf-styles.css.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STYLES_PATH = join(__dirname, "..", "assets", "hf-styles.css");

let stylesCache: string | null = null;
function loadStyles(): string {
  if (stylesCache === null) stylesCache = readFileSync(STYLES_PATH, "utf-8");
  return stylesCache;
}

export type BeatLayout = "hook-hero" | "title-body" | "two-column" | "check-question" | "recap-bullets";
export type BeatStyle = "kinetic-pop" | "swiss-grid" | "warm-grain" | "liquid-glass" | "neon-grid" | "paper-mark" | "magnetic-flow";

export interface BeatTemplateInput {
  beatKey: string;
  beatType: "hook" | "concept" | "example" | "check" | "recap";
  lessonTitle: string;
  onScreenText: string[];
  callouts: string[];
}

// Default style + layout per beat-type. Tunable per beat via author worker later.
const TYPE_DEFAULTS: Record<BeatTemplateInput["beatType"], { layout: BeatLayout; style: BeatStyle }> = {
  hook:    { layout: "hook-hero",      style: "kinetic-pop" },
  concept: { layout: "title-body",     style: "swiss-grid" },
  example: { layout: "two-column",     style: "paper-mark" },
  check:   { layout: "check-question", style: "liquid-glass" },
  recap:   { layout: "recap-bullets",  style: "warm-grain" },
};

const TYPE_LABEL: Record<BeatTemplateInput["beatType"], string> = {
  hook: "HOOK", concept: "CONCEPT", example: "EXAMPLE", check: "CHECK YOURSELF", recap: "RECAP",
};

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

/** Wrap a template body in the standard shell with style CSS inlined. */
function shell(input: BeatTemplateInput, style: BeatStyle, body: string): string {
  return `<!doctype html>
<html lang="en" data-style="${esc(style)}">
<head>
<meta charset="UTF-8" />
<style>
${loadStyles()}

/* Page baseline — fixed 1920x1080 stage for Puppeteer screenshot. */
html, body { margin: 0; padding: 0; width: 1920px; height: 1080px; overflow: hidden; }
#root { position: relative; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; padding: 96px; box-sizing: border-box; }
.lesson-meta { position: absolute; top: 56px; left: 96px; font-family: var(--font-accent, var(--font-body)); font-size: var(--size-caption, 20px); color: var(--text-caption); letter-spacing: var(--tracking-label); text-transform: uppercase; }
.beat-id { position: absolute; bottom: 32px; right: 96px; font-family: monospace; font-size: 14px; color: var(--text-caption); opacity: 0.6; }
.accent-bar { width: 96px; height: 6px; background: var(--accent); border-radius: 999px; margin-top: 12px; }
.callouts { position: absolute; bottom: 64px; left: 96px; display: flex; gap: 14px; flex-wrap: wrap; max-width: 70%; }
.callout-chip { padding: 14px 26px; border-radius: 999px; background: var(--surface-bg); border: var(--surface-border); color: var(--accent); font-size: var(--size-caption); font-weight: 600; letter-spacing: 0.02em; font-family: var(--font-body); }
</style>
</head>
<body data-style="${esc(style)}">
  <div id="root">
    <div class="backdrop"></div>
    <div class="backdrop-pattern"></div>
    <div class="backdrop-vignette"></div>
    <div class="lesson-meta">${esc(TYPE_LABEL[input.beatType])} · ${esc(input.lessonTitle)}</div>
    ${body}
    ${input.callouts.length > 0 ? `
      <div class="callouts">
        ${input.callouts.slice(0, 3).map((c) => `<span class="callout-chip">${esc(c)}</span>`).join("\n        ")}
      </div>` : ""}
    <div class="beat-id">${esc(input.beatKey)}</div>
  </div>
</body>
</html>`;
}

// ─── Templates ──────────────────────────────────────────────────────

function hookHero(input: BeatTemplateInput, style: BeatStyle): string {
  const hero = input.onScreenText[0] ?? input.beatKey;
  const sub  = input.onScreenText[1] ?? "";
  return shell(input, style, `
    <div class="stage" style="flex-direction: column; gap: 40px; text-align: center; max-width: 1600px;">
      <div class="display" style="font-size: var(--size-hero); line-height: 1.05; font-weight: var(--weight-display); letter-spacing: var(--tracking-display); color: var(--text-display);">${esc(hero)}</div>
      ${sub ? `<div class="body-text" style="font-size: var(--size-h3); color: var(--text-body); max-width: 1400px; margin: 0 auto;">${esc(sub)}</div>` : ""}
      <div class="accent-bar" style="margin: 24px auto 0;"></div>
    </div>`);
}

function titleBody(input: BeatTemplateInput, style: BeatStyle): string {
  const title = input.onScreenText[0] ?? input.beatKey;
  const bullets = input.onScreenText.slice(1, 5);
  return shell(input, style, `
    <div class="stage" style="flex-direction: column; align-items: flex-start; gap: 40px; max-width: 1700px;">
      <div class="display" style="font-size: var(--size-h1); line-height: 1.05; font-weight: var(--weight-display); letter-spacing: var(--tracking-display); color: var(--text-display);">${esc(title)}</div>
      <div class="accent-bar"></div>
      ${bullets.length > 0 ? `
        <div style="display: flex; flex-direction: column; gap: 24px; margin-top: 16px;">
          ${bullets.map((b) => `<div class="body-text" style="font-size: var(--size-h3); color: var(--text-display); padding-left: 36px; position: relative;">
            <span style="position: absolute; left: 0; top: 0.55em; width: 16px; height: 16px; background: var(--accent); border-radius: 50%; opacity: 0.85;"></span>
            ${esc(b)}
          </div>`).join("\n          ")}
        </div>` : ""}
    </div>`);
}

function twoColumn(input: BeatTemplateInput, style: BeatStyle): string {
  const items = input.onScreenText.slice(0, 4);
  if (items.length === 0) return titleBody(input, style);
  return shell(input, style, `
    <div class="stage" style="flex-direction: column; gap: 48px; width: 100%;">
      <div style="display: grid; grid-template-columns: repeat(${Math.min(2, items.length)}, 1fr); gap: 36px; width: 100%; max-width: 1700px; margin: 0 auto;">
        ${items.map((t) => {
          const [label, ...rest] = t.split(/·\s*/);
          const body = rest.join(" · ") || label;
          const hasBody = rest.length > 0;
          return `<div class="surface" style="padding: 56px 48px; min-height: 280px; display: flex; flex-direction: column; gap: 20px;">
            ${hasBody ? `<div class="display" style="font-size: var(--size-h2); color: var(--accent); font-weight: var(--weight-display); letter-spacing: var(--tracking-display); line-height: 1.1;">${esc(label.trim())}</div>` : ""}
            <div class="body-text" style="font-size: var(--size-h3); color: var(--text-display); line-height: 1.3;">${esc((hasBody ? body : label).trim())}</div>
          </div>`;
        }).join("\n        ")}
      </div>
    </div>`);
}

function checkQuestion(input: BeatTemplateInput, style: BeatStyle): string {
  const question = input.onScreenText[0] ?? "Pause and check your understanding.";
  const sub = input.onScreenText.slice(1, 3);
  return shell(input, style, `
    <div class="stage" style="flex-direction: column; gap: 40px; text-align: center; max-width: 1500px;">
      <div class="eyebrow" style="font-size: var(--size-caption); color: var(--accent); letter-spacing: var(--tracking-label); text-transform: uppercase; font-weight: 700;">Pause &amp; Think</div>
      <div class="display" style="font-size: var(--size-h1); line-height: 1.15; color: var(--text-display); font-weight: var(--weight-display); letter-spacing: var(--tracking-display);">${esc(question)}</div>
      ${sub.length > 0 ? `
        <div style="display: flex; flex-direction: column; gap: 18px; margin-top: 24px;">
          ${sub.map((s) => `<div class="body-text" style="font-size: var(--size-h3); color: var(--text-body); font-style: italic;">${esc(s)}</div>`).join("\n          ")}
        </div>` : ""}
    </div>`);
}

function recapBullets(input: BeatTemplateInput, style: BeatStyle): string {
  const title = "Recap";
  const items = input.onScreenText.slice(0, 5);
  return shell(input, style, `
    <div class="stage" style="flex-direction: column; align-items: flex-start; gap: 36px; max-width: 1700px;">
      <div class="display" style="font-size: var(--size-h1); color: var(--accent); font-weight: var(--weight-display); letter-spacing: var(--tracking-display);">${esc(title)}</div>
      <div class="accent-bar"></div>
      <div style="display: flex; flex-direction: column; gap: 22px; margin-top: 12px;">
        ${items.map((t, i) => `<div style="display: flex; gap: 28px; align-items: flex-start;">
          <span style="font-size: var(--size-h3); color: var(--accent); font-weight: 700; min-width: 56px;">${i + 1}.</span>
          <span class="body-text" style="font-size: var(--size-h3); color: var(--text-display); line-height: 1.3;">${esc(t)}</span>
        </div>`).join("\n        ")}
      </div>
    </div>`);
}

const LAYOUTS: Record<BeatLayout, (i: BeatTemplateInput, s: BeatStyle) => string> = {
  "hook-hero":      hookHero,
  "title-body":     titleBody,
  "two-column":     twoColumn,
  "check-question": checkQuestion,
  "recap-bullets":  recapBullets,
};

/** Build the beat HTML using a layout + style chosen by beat-type. */
export function buildBeatHtmlHF(input: BeatTemplateInput, layoutOverride?: BeatLayout, styleOverride?: BeatStyle): string {
  const defaults = TYPE_DEFAULTS[input.beatType];
  const layout = layoutOverride ?? defaults.layout;
  const style  = styleOverride  ?? defaults.style;
  const fn = LAYOUTS[layout] ?? titleBody;
  return fn(input, style);
}

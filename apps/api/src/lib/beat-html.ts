/**
 * Build the HTML that the headless browser will screenshot to make the
 * beat's hero frame. Intentionally minimal — we can swap in richer
 * templates / per-beat layouts later. Inline CSS so nothing depends on
 * external assets.
 */

export interface BeatHtmlInput {
  beatKey: string;
  beatType: "hook" | "concept" | "example" | "check" | "recap";
  lessonTitle: string;
  onScreenText: string[];
  callouts: string[];
  /** "solid" only for the MVP — image backgrounds come later. */
  background: "solid" | "ai_image" | "stock_image";
}

const ACCENT_BY_TYPE: Record<BeatHtmlInput["beatType"], string> = {
  hook:    "#C76A4A", // warm orange
  concept: "#0E7C66", // teal
  example: "#5A6B8F", // slate blue
  check:   "#A45EA8", // muted purple
  recap:   "#1A1A1F", // ink
};

const TYPE_LABEL: Record<BeatHtmlInput["beatType"], string> = {
  hook: "HOOK", concept: "CONCEPT", example: "EXAMPLE", check: "CHECK YOURSELF", recap: "RECAP",
};

export function buildBeatHtml(input: BeatHtmlInput): string {
  const accent = ACCENT_BY_TYPE[input.beatType];
  const onScreenItems = input.onScreenText.slice(0, 5);
  const calloutItems = input.callouts.slice(0, 3);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${esc(input.beatKey)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 1920px; height: 1080px; overflow: hidden; }
  body {
    background: #FBF8F1;
    color: #1A1A1F;
    font-family: 'Bricolage Grotesque', 'Inter', system-ui, sans-serif;
    padding: 80px;
    display: flex;
    flex-direction: column;
    gap: 40px;
  }
  .eyebrow {
    font-size: 22px;
    font-weight: 600;
    letter-spacing: 0.14em;
    color: ${accent};
  }
  .lesson-title {
    font-size: 32px;
    color: #6B6457;
    font-weight: 500;
  }
  .accent-bar {
    width: 96px;
    height: 6px;
    background: ${accent};
    border-radius: 999px;
    margin-top: 8px;
  }
  .on-screen {
    margin-top: 24px;
    display: flex;
    flex-direction: column;
    gap: 24px;
    max-width: 1500px;
  }
  .on-screen li {
    list-style: none;
    font-size: 44px;
    line-height: 1.3;
    font-weight: 500;
    color: #1A1A1F;
    padding-left: 28px;
    position: relative;
  }
  .on-screen li::before {
    content: "";
    position: absolute;
    left: 0;
    top: 22px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: ${accent};
    opacity: 0.85;
  }
  .callouts {
    margin-top: auto;
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
  }
  .callout {
    background: white;
    border: 2px solid ${accent};
    color: ${accent};
    padding: 14px 24px;
    border-radius: 999px;
    font-size: 24px;
    font-weight: 600;
  }
  .footer {
    font-family: 'JetBrains Mono', monospace;
    font-size: 18px;
    color: #6B6457;
    opacity: 0.7;
    margin-top: 24px;
  }
</style>
</head>
<body>
  <div>
    <div class="eyebrow">${esc(TYPE_LABEL[input.beatType])}</div>
    <div class="lesson-title">${esc(input.lessonTitle)}</div>
    <div class="accent-bar"></div>
  </div>
  ${onScreenItems.length > 0 ? `
    <ul class="on-screen">
      ${onScreenItems.map((s) => `<li>${esc(s)}</li>`).join("\n      ")}
    </ul>
  ` : ""}
  ${calloutItems.length > 0 ? `
    <div class="callouts">
      ${calloutItems.map((s) => `<span class="callout">${esc(s)}</span>`).join("\n      ")}
    </div>
  ` : ""}
  <div class="footer">${esc(input.beatKey)}</div>
</body>
</html>`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" } as Record<string, string>)[ch]!);
}

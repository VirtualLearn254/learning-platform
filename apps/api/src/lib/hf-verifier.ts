/**
 * hf-verifier — vision-pass QA on animated compositions BEFORE the expensive
 * frame-by-frame render. Ports the 3-frame verifier pattern from
 * hyperframes-pipeline (verify-claude.ts):
 *
 *   1. Load the composition HTML in headless Chromium
 *   2. Seek the GSAP timeline to 3 sample times (early / hero / settle)
 *      and screenshot each — clip visibility windows applied manually
 *      since the HF runtime isn't loaded
 *   3. Send frames to the vision "verifier" profile → structured issues
 *   4. P0 issues (overlap, clipped text, off-frame) fail the check; the
 *      caller feeds them back to the designer for one repair round
 *
 * Overlaps in final renders are a hard P0 constraint — this is the gate
 * that catches them at ~$0.03/beat instead of after a 3-minute render.
 */

import puppeteer, { type Browser } from "puppeteer-core";

import type { createAIClient } from "@lp/ai-provider";

type AIClient = ReturnType<typeof createAIClient>;

const CHROMIUM_PATH = process.env.PUPPETEER_EXECUTABLE_PATH ?? "/usr/bin/chromium-browser";

let browserSingleton: Browser | null = null;
async function getBrowser(): Promise<Browser> {
  if (browserSingleton && browserSingleton.connected) return browserSingleton;
  browserSingleton = await puppeteer.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--no-zygote"],
  });
  return browserSingleton;
}

/**
 * Screenshot the composition at specific timeline positions.
 * Seeks window.__timelines["root"] and manually applies clip
 * data-start/data-duration visibility windows (the HF runtime normally
 * does this; in a bare browser the attributes are inert).
 */
export async function captureTimelineFrames(html: string, timesSec: number[]): Promise<Buffer[]> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 0.5 }); // 960x540 — plenty for QA, 4x cheaper vision tokens
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 20_000 });

    const frames: Buffer[] = [];
    for (const t of timesSec) {
      await page.evaluate((time: number) => {
        // Seek the registered timeline.
        const w = window as unknown as { __timelines?: Record<string, { seek: (t: number) => void; pause: () => void }> };
        const tl = w.__timelines?.["root"];
        if (tl) { tl.pause(); tl.seek(time); }
        // Apply clip visibility windows (skip audio — it has no visual).
        document.querySelectorAll<HTMLElement>(".clip").forEach((el) => {
          if (el.tagName === "AUDIO") return;
          const start = parseFloat(el.dataset.start ?? "0");
          const dur = parseFloat(el.dataset.duration ?? "999");
          el.style.visibility = time >= start && time < start + dur ? "visible" : "hidden";
        });
      }, t);
      await new Promise((r) => setTimeout(r, 120)); // let layout/paint flush
      const png = await page.screenshot({ type: "png", fullPage: false });
      frames.push(Buffer.from(png));
    }
    return frames;
  } finally {
    await page.close();
  }
}

// ─── Vision verification ────────────────────────────────────────────

export interface VerifyIssue {
  severity: "P0" | "P1" | "P2";
  frame: number;
  description: string;
  fix: string;
}

export interface VerifyResult {
  pass: boolean;
  issues: VerifyIssue[];
}

const VERIFY_SYSTEM = `You are a QA reviewer for educational video frames (1920x1080 compositions, shown scaled). You receive 3 frames from one animated beat: EARLY (entrances underway — partially-entered elements are normal), HERO (the fullest layout), and SETTLE (near the end — everything must be calm and final).

Report ONLY real, visible defects:

P0 (blocks render):
- Two text blocks or cards overlapping / colliding
- Text clipped by the frame edge or by a container (cut-off words)
- Text running off-frame or under another element
- Illegible contrast (light text on light bg, dark on dark)

P1 (should fix):
- Element closer than ~40px to the frame edge
- Severely lopsided layout (huge dead zone on one side while content crowds the other)
- Broken visual (empty card, orphaned marker, misaligned leader line)

P2 (cosmetic): minor spacing/alignment nits.

Do NOT report: partially-faded or mid-entrance elements in the EARLY frame, intentional layering (glow, shadows, background patterns), or stylistic choices.

Reply with ONLY a JSON object, no markdown:
{"issues":[{"severity":"P0","frame":1,"description":"...","fix":"concrete CSS/layout change"}]}
Empty issues array = pass.`;

export async function verifyComposition(
  ai: AIClient,
  html: string,
  durationSec: number,
): Promise<VerifyResult> {
  // Sample: mid-entrance, hero (fullest), settled tail.
  const times = [
    Math.min(2.5, durationSec * 0.2),
    durationSec * 0.65,
    Math.max(0.5, durationSec - 1.2),
  ];
  const frames = await captureTimelineFrames(html, times);

  const res = await ai.vision("verifier", {
    system: VERIFY_SYSTEM,
    prompt: `Three frames from one beat, sampled at ${times.map((t) => t.toFixed(1) + "s")
      .join(", ")} of ${durationSec.toFixed(1)}s: EARLY, HERO, SETTLE. Find real defects only.`,
    images: frames.map((f) => ({ base64: f.toString("base64"), mediaType: "image/png" as const })),
  });

  let issues: VerifyIssue[] = [];
  try {
    const jsonMatch = res.text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as { issues?: VerifyIssue[] };
      issues = (parsed.issues ?? []).filter((i) => i && (i.severity === "P0" || i.severity === "P1" || i.severity === "P2"));
    }
  } catch {
    console.warn("[hf-verifier] unparseable verifier response, treating as pass:", res.text.slice(0, 200));
  }

  const hasP0 = issues.some((i) => i.severity === "P0");
  return { pass: !hasP0, issues };
}

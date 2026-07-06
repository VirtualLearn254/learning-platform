/**
 * Visual smoke test for the seamless quiz scene: builds a real SCORM package
 * around a real master MP4, opens it in headless Chrome, seeks past the quiz
 * cue so the scene takes over the frame, and screenshots the result — one
 * image per style palette so you can eyeball palette continuity.
 *
 * Run: npx tsx apps/api/scripts/preview-quiz-scene.ts <path-to-master.mp4>
 * Output: apps/api/scripts/quiz-preview-<style>.png
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import JSZip from "jszip";
import puppeteer from "puppeteer-core";
import { createScormPackager } from "@lp/scorm-packager";

const HERE = dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

const PALETTES: Record<string, { bg: string; ink: string; muted: string; accent: string; surface: string }> = {
  "swiss-grid":   { bg: "#FAFAF7", ink: "#111111", muted: "#6B6B66", accent: "#DC2626", surface: "#FFFFFF" },
  "liquid-glass": { bg: "#0B1B2B", ink: "#F4F8FB", muted: "#93A7B8", accent: "#2DD4BF", surface: "rgba(255,255,255,0.07)" },
};

const QUIZ = {
  type: "multiple_choice",
  question: "Simplify (x^3 · y^-2)^2 ÷ (x^4 · y^5), leaving positive exponents only.",
  options: [
    { id: "a", text: "x^2 / y^9", isCorrect: true, feedback: "Correct: square gives x^6·y^-4, then subtract exponents." },
    { id: "b", text: "x^2 · y^9", feedback: "The y exponent is -9 — negative exponents belong in the denominator." },
    { id: "c", text: "x^5 / y", feedback: "Power to a power MULTIPLIES exponents: (x^3)^2 = x^6, not x^9." },
    { id: "d", text: "x^6 / y^9", feedback: "You squared correctly but forgot to divide the x terms." },
  ],
};

async function main() {
  const mp4Path = process.argv[2];
  if (!mp4Path) throw new Error("usage: preview-quiz-scene.ts <master.mp4>");
  const masterMp4 = readFileSync(resolve(mp4Path));
  const packager = createScormPackager();

  for (const [styleName, style] of Object.entries(PALETTES)) {
    const built = await packager.build({
      lesson: { id: "00000000-0000-0000-0000-000000000000", title: "Six Laws of Exponents — quiz scene preview" },
      masterMp4,
      quizzes: [{ atSec: 2, beatKey: "exponent_check", quiz: QUIZ, style }],
      version: "2004_4",
    });

    const dir = join(HERE, `.quiz-preview-${styleName}`);
    mkdirSync(dir, { recursive: true });
    const zip = await JSZip.loadAsync(built.zip);
    for (const name of ["index.html", "scorm-api.js", "master.mp4"]) {
      writeFileSync(join(dir, name), await zip.file(name)!.async("nodebuffer"));
    }

    const browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: true,
      args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio", "--window-size=1440,810"],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1440, height: 810 });
      await page.goto(pathToFileURL(join(dir, "index.html")).href, { waitUntil: "load" });
      // Let the video start, then seek right up to the cue so timeupdate trips it.
      await page.waitForFunction("document.getElementById('v').readyState >= 2", { timeout: 15_000 });
      await page.evaluate("document.getElementById('v').currentTime = 1.9");
      await page.waitForSelector(".quiz-scene.visible", { timeout: 10_000 });
      await new Promise((r) => setTimeout(r, 1400)); // staggered entrances settle
      await page.screenshot({ path: join(HERE, `quiz-preview-${styleName}.png`) as `${string}.png` });
      // Answer wrong → verify reveal + feedback state renders, screenshot that too.
      await page.evaluate("document.querySelectorAll('.qz-opt')[2].click()");
      await new Promise((r) => setTimeout(r, 500));
      await page.screenshot({ path: join(HERE, `quiz-preview-${styleName}-answered.png`) as `${string}.png` });
      console.log(`[preview] ${styleName}: quiz-preview-${styleName}.png + -answered.png`);
    } finally {
      await browser.close();
    }
  }
}

main().catch((e) => { console.error("FAILED:", e); process.exit(1); });

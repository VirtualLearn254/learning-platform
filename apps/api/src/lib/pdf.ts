/**
 * PDF companions, rendered from branded HTML via the same headless Chromium
 * the render pipeline uses (page.pdf() — no extra dependencies).
 *
 *   content — the reading companion: full narration per beat, on-screen
 *             phrases, key terms. What a learner reads on the train.
 *   summary — 1-2 page recap: lesson summary, key concepts, the quiz
 *             questions WITH answers marked (instructor answer key).
 */

import puppeteer, { type Browser } from "puppeteer-core";

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

export interface PdfBeat {
  beatKey: string;
  beatType: string;
  script: string;
  onScreenText: string[];
  callouts: string[];
  quiz?: {
    question?: string;
    options?: Array<{ id: string; text: string; isCorrect?: boolean; feedback?: string }>;
  } | null;
}

export interface PdfLessonInput {
  lessonTitle: string;
  courseTitle?: string;
  summary?: string | null;
  beats: PdfBeat[];
  organizationName?: string;
}

const BASE_CSS = `
  * { box-sizing: border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #1a1a1a; margin: 0; font-size: 12.5pt; line-height: 1.55; }
  .page { padding: 48px 56px; }
  h1 { font-family: Helvetica, Arial, sans-serif; font-size: 24pt; margin: 0 0 4px; letter-spacing: -0.01em; }
  h2 { font-family: Helvetica, Arial, sans-serif; font-size: 13pt; margin: 28px 0 8px; text-transform: uppercase; letter-spacing: 0.06em; color: #0E7C66; }
  .meta { font-family: Helvetica, Arial, sans-serif; font-size: 9.5pt; color: #777; margin-bottom: 24px; }
  .rule { height: 3px; width: 64px; background: #0E7C66; border-radius: 2px; margin: 10px 0 24px; }
  .beat { page-break-inside: avoid; margin-bottom: 18px; }
  .beat-head { font-family: Helvetica, Arial, sans-serif; font-size: 9pt; color: #0E7C66; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px; }
  .phrases { font-family: Helvetica, Arial, sans-serif; font-size: 10pt; color: #555; margin-top: 6px; }
  .phrases span { display: inline-block; background: #f1f5f3; border-radius: 4px; padding: 2px 8px; margin: 2px 4px 2px 0; }
  .quiz { border: 1px solid #ddd; border-radius: 8px; padding: 14px 16px; margin-top: 8px; page-break-inside: avoid; }
  .quiz .q { font-weight: bold; margin-bottom: 8px; }
  .quiz .opt { margin: 3px 0; padding-left: 4px; }
  .quiz .correct { color: #0E7C66; font-weight: bold; }
  .quiz .fb { font-size: 10pt; color: #666; font-style: italic; }
  .footer { font-family: Helvetica, Arial, sans-serif; font-size: 8.5pt; color: #999; margin-top: 32px; border-top: 1px solid #eee; padding-top: 10px; }
`;

function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
}

function contentHtml(input: PdfLessonInput): string {
  const beats = input.beats.map((b) => `
    <div class="beat">
      <div class="beat-head">${esc(b.beatKey)} · ${esc(b.beatType)}</div>
      <p>${esc(b.script)}</p>
      ${b.onScreenText.length ? `<div class="phrases">${b.onScreenText.map((t) => `<span>${esc(t)}</span>`).join("")}</div>` : ""}
    </div>`).join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}</style></head><body><div class="page">
    <h1>${esc(input.lessonTitle)}</h1>
    <div class="meta">${esc(input.courseTitle ?? "")} · Reading companion</div>
    <div class="rule"></div>
    ${input.summary ? `<p><em>${esc(input.summary)}</em></p>` : ""}
    ${beats}
    <div class="footer">${esc(input.organizationName ?? "Learning Platform")} · generated companion document</div>
  </div></body></html>`;
}

function summaryHtml(input: PdfLessonInput): string {
  const keyTerms = [...new Set(input.beats.flatMap((b) => b.callouts))].slice(0, 12);
  const quizzes = input.beats.filter((b) => b.quiz?.question && b.quiz.options?.length);
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}</style></head><body><div class="page">
    <h1>${esc(input.lessonTitle)}</h1>
    <div class="meta">${esc(input.courseTitle ?? "")} · Summary &amp; answer key</div>
    <div class="rule"></div>
    ${input.summary ? `<p>${esc(input.summary)}</p>` : ""}
    ${keyTerms.length ? `<h2>Key terms</h2><div class="phrases">${keyTerms.map((t) => `<span>${esc(t)}</span>`).join("")}</div>` : ""}
    ${quizzes.length ? `<h2>Checks — answer key</h2>` : ""}
    ${quizzes.map((b) => `
      <div class="quiz">
        <div class="q">${esc(b.quiz!.question!)}</div>
        ${(b.quiz!.options ?? []).map((o) => `
          <div class="opt ${o.isCorrect ? "correct" : ""}">${o.isCorrect ? "✓ " : "· "}${esc(o.text)}
            ${o.feedback ? `<span class="fb"> — ${esc(o.feedback)}</span>` : ""}
          </div>`).join("")}
      </div>`).join("\n")}
    <div class="footer">${esc(input.organizationName ?? "Learning Platform")} · instructor copy — contains answers</div>
  </div></body></html>`;
}

export async function htmlToPdf(html: string): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 20_000 });
    const pdf = await page.pdf({ format: "A4", printBackground: true, margin: { top: "0", bottom: "0", left: "0", right: "0" } });
    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
}

export async function buildLessonPdfs(input: PdfLessonInput): Promise<{ content: Buffer; summary: Buffer }> {
  const [content, summary] = await Promise.all([
    htmlToPdf(contentHtml(input)),
    htmlToPdf(summaryHtml(input)),
  ]);
  return { content, summary };
}

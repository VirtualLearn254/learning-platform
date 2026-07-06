/**
 * Generates the standalone quiz style gallery — one HTML file, no video,
 * every quiz style clickable in every palette. Uses the exact CSS + engine
 * the SCORM player ships, so what you approve here is what learners see.
 *
 * Run:    npx tsx apps/api/scripts/build-quiz-gallery.ts
 * Output: apps/api/scripts/quiz-style-gallery.html  (open in a browser)
 */

import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildQuizStyleGallery } from "@lp/scorm-packager";

const HERE = dirname(fileURLToPath(import.meta.url));

// A mock phishing email drawn as SVG — the hotspot demo's question canvas.
// The suspicious sender domain is the correct region.
const PHISHING_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="560" viewBox="0 0 900 560">
  <rect width="900" height="560" fill="#ffffff"/>
  <rect width="900" height="64" fill="#f3f4f6"/>
  <text x="28" y="40" font-family="Segoe UI, Arial" font-size="20" font-weight="700" fill="#111827">Action required: your account will be suspended</text>
  <text x="28" y="100" font-family="Segoe UI, Arial" font-size="15" fill="#6b7280">From:</text>
  <text x="88" y="100" font-family="Segoe UI, Arial" font-size="15" font-weight="600" fill="#111827">IT Service Desk</text>
  <text x="230" y="100" font-family="Consolas, monospace" font-size="15" fill="#374151">&lt;support@micros0ft-helpdesk.ru&gt;</text>
  <text x="28" y="130" font-family="Segoe UI, Arial" font-size="15" fill="#6b7280">To:</text>
  <text x="88" y="130" font-family="Segoe UI, Arial" font-size="15" fill="#374151">you@company.com</text>
  <line x1="28" y1="152" x2="872" y2="152" stroke="#e5e7eb" stroke-width="2"/>
  <text x="28" y="196" font-family="Segoe UI, Arial" font-size="16" fill="#1f2937">Dear employee,</text>
  <text x="28" y="232" font-family="Segoe UI, Arial" font-size="16" fill="#1f2937">We detected unusual sign-in activity. Your mailbox will be suspended in</text>
  <text x="28" y="258" font-family="Segoe UI, Arial" font-size="16" fill="#1f2937">24 hours unless you verify your credentials immediately.</text>
  <rect x="28" y="292" width="220" height="48" rx="8" fill="#2563eb"/>
  <text x="66" y="322" font-family="Segoe UI, Arial" font-size="16" font-weight="700" fill="#ffffff">Verify account now</text>
  <text x="28" y="384" font-family="Segoe UI, Arial" font-size="16" fill="#1f2937">Failure to comply will result in permanent data loss.</text>
  <text x="28" y="440" font-family="Segoe UI, Arial" font-size="16" fill="#1f2937">Regards,</text>
  <text x="28" y="466" font-family="Segoe UI, Arial" font-size="16" fill="#1f2937">IT Service Desk</text>
  <text x="28" y="530" font-family="Segoe UI, Arial" font-size="12" fill="#9ca3af">This message was sent from an external sender. Report suspicious mail to security@company.com</text>
</svg>`;
const PHISHING_IMG = "data:image/svg+xml," + encodeURIComponent(PHISHING_SVG);

const DEMOS = [
  {
    label: "multiple choice",
    cue: {
      atSec: 0, beatKey: "demo_mc",
      quiz: {
        type: "multiple_choice",
        question: "Simplify (x^3 · y^-2)^2 ÷ (x^4 · y^5), leaving positive exponents only.",
        options: [
          { id: "a", text: "x^2 / y^9", isCorrect: true, feedback: "Correct: square gives x^6·y^-4, then subtract exponents." },
          { id: "b", text: "x^2 · y^9", feedback: "The y exponent is -9 — negative exponents belong in the denominator." },
          { id: "c", text: "x^5 / y", feedback: "Power to a power MULTIPLIES exponents: (x^3)^2 = x^6, not x^9." },
          { id: "d", text: "x^6 / y^9", feedback: "You squared correctly but forgot to divide the x terms." },
        ],
      },
    },
  },
  {
    label: "true / false",
    cue: {
      atSec: 0, beatKey: "demo_tf",
      quiz: {
        type: "true_false",
        question: "x^0 = 1 for every nonzero value of x.",
        options: [
          { id: "t", text: "True", isCorrect: true, feedback: "Correct — the zero-exponent law." },
          { id: "f", text: "False", feedback: "The zero-exponent law says x^0 = 1 whenever x ≠ 0 — try x^3 ÷ x^3." },
        ],
      },
    },
  },
  {
    label: "multi select",
    cue: {
      atSec: 0, beatKey: "demo_ms",
      quiz: {
        type: "multi_select",
        question: "Which of these expressions simplify to x^6?",
        options: [
          { id: "a", text: "(x^2)^3", isCorrect: true },
          { id: "b", text: "x^2 · x^4", isCorrect: true },
          { id: "c", text: "x^2 + x^4" },
          { id: "d", text: "x^12 / x^2" },
        ],
        correctFeedback: "Right — power-of-power multiplies (2×3) and the product law adds (2+4).",
        wrongFeedback: "Careful: addition doesn't combine exponents, and x^12 / x^2 = x^10.",
      },
    },
  },
  {
    label: "fill in (text)",
    cue: {
      atSec: 0, beatKey: "demo_fi",
      quiz: {
        type: "fill_in",
        question: "Simplify x^7 ÷ x^4 and type the result.",
        options: [
          { id: "a", text: "x^3", isCorrect: true, feedback: "Correct — quotient law: subtract the exponents, 7 − 4 = 3." },
          { id: "b", text: "x3", isCorrect: true, feedback: "Correct — quotient law: subtract the exponents, 7 − 4 = 3." },
        ],
        wrongFeedback: "Quotient law: same base, SUBTRACT the exponents — 7 − 4 = 3.",
      },
    },
  },
  {
    label: "fill in (numeric)",
    cue: {
      atSec: 0, beatKey: "demo_fi_num",
      quiz: {
        type: "fill_in",
        question: "What is 2^5?",
        options: [
          { id: "a", text: "32", isCorrect: true, numericValue: 32, feedback: "Correct — 2·2·2·2·2 = 32." },
        ],
        wrongFeedback: "Doubling five times from 1: 2, 4, 8, 16, 32.",
      },
    },
  },
  {
    label: "hotspot",
    cue: {
      atSec: 0, beatKey: "demo_hs",
      quiz: {
        type: "hotspot",
        question: "Click the strongest phishing indicator in this email.",
        image: PHISHING_IMG,
        options: [
          {
            id: "sender", text: "Sender domain", isCorrect: true,
            region: { x: 24, y: 15, w: 40, h: 6.5 },
            feedback: "Exactly — 'micros0ft-helpdesk.ru' is a spoofed domain: a zero for an o, and .ru for a corporate IT desk.",
          },
          {
            id: "button", text: "CTA button",
            region: { x: 2, y: 51, w: 26, h: 10 },
            feedback: "The urgent button is suspicious, but buttons appear in legitimate mail too — the sender domain is the giveaway.",
          },
        ],
        wrongFeedback: "Look at the sender address — 'micros0ft-helpdesk.ru' is a spoofed domain (zero for o, .ru TLD).",
      },
    },
  },
];

const html = buildQuizStyleGallery(DEMOS);
const out = join(HERE, "quiz-style-gallery.html");
writeFileSync(out, html, "utf-8");
console.log(`[gallery] wrote ${out} (${(html.length / 1024).toFixed(0)} KB) — open it in a browser`);

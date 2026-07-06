/**
 * Generates the standalone quiz style gallery — one HTML file, no video,
 * every quiz style clickable in every palette. Uses the exact CSS + engine
 * the SCORM player ships, so what you approve here is what learners see.
 *
 * Run:    npx tsx apps/api/scripts/build-quiz-gallery.ts
 * Output: apps/api/scripts/quiz-style-gallery.html  (open in a browser)
 *
 * QUIZ SKIN iteration loop (LP-15): drop CSS into
 * apps/api/scripts/quiz-skin-draft.css and rebuild — the gallery renders
 * with the skin applied (after passing lintQuizSkin), exactly as the SCORM
 * player would ship it.
 */

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildQuizStyleGallery, lintQuizSkin } from "@lp/scorm-packager";

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
      // LP-12 adaptivity demo: wrong → "Rewatch & try again" (simulated
      // re-present in the gallery; rewinds the video in real lessons).
      retry: { atSec: 0, message: "Not quite — rewatch how the square distributes over the product, then try again.", maxAttempts: 1, allowOptOut: true },
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

// Small SVG curve cards for image_choice ("which graph shows…").
function curveSvg(path: string, stroke = "#2563eb"): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="140" viewBox="0 0 240 140">
    <rect width="240" height="140" fill="#ffffff"/>
    <line x1="24" y1="116" x2="224" y2="116" stroke="#d1d5db" stroke-width="2"/>
    <line x1="24" y1="116" x2="24" y2="16" stroke="#d1d5db" stroke-width="2"/>
    <path d="${path}" fill="none" stroke="${stroke}" stroke-width="4" stroke-linecap="round"/>
  </svg>`;
  return "data:image/svg+xml," + encodeURIComponent(svg);
}

DEMOS.push(
  {
    label: "match",
    cue: {
      atSec: 0, beatKey: "demo_match",
      quiz: {
        type: "match",
        question: "Match each exponent law to its rule.",
        options: [
          // lefts (carry matchTargetId) …
          { id: "l1", text: "Product law", matchTargetId: "r1" },
          { id: "l2", text: "Quotient law", matchTargetId: "r2" },
          { id: "l3", text: "Power of a power", matchTargetId: "r3" },
          // …rights (the targets)
          { id: "r1", text: "x^a · x^b = x^(a+b)" },
          { id: "r2", text: "x^a ÷ x^b = x^(a-b)" },
          { id: "r3", text: "(x^a)^b = x^(ab)" },
        ],
        correctFeedback: "All three laws matched to their rules.",
        wrongFeedback: "Check the red pairs — add for products, subtract for quotients, multiply for powers of powers.",
      },
    },
  },
  {
    label: "ordering",
    cue: {
      atSec: 0, beatKey: "demo_ord",
      quiz: {
        type: "ordering",
        question: "Put the steps for simplifying (x^3 · y^-2)^2 ÷ x^4 in order.",
        options: [
          { id: "s1", text: "Apply the square to each factor" },
          { id: "s2", text: "Multiply the inner exponents by 2" },
          { id: "s3", text: "Subtract exponents of like bases" },
          { id: "s4", text: "Rewrite negatives as positive exponents" },
        ],
        correctFeedback: "That's the exact pipeline: distribute, multiply, subtract, tidy.",
      },
    },
  },
  {
    label: "sort into",
    cue: {
      atSec: 0, beatKey: "demo_sort",
      quiz: {
        type: "sort_into",
        question: "Sort each account into the correct side of the balance sheet.",
        options: [
          // buckets (no matchTargetId) …
          { id: "assets", text: "Assets" },
          { id: "liab", text: "Liabilities" },
          // …items point at a bucket
          { id: "i1", text: "Cash", matchTargetId: "assets" },
          { id: "i2", text: "Bank loan", matchTargetId: "liab" },
          { id: "i3", text: "Inventory", matchTargetId: "assets" },
          { id: "i4", text: "Accounts payable", matchTargetId: "liab" },
          { id: "i5", text: "Equipment", matchTargetId: "assets" },
        ],
        correctFeedback: "Perfect — resources you own vs. amounts you owe.",
        wrongFeedback: "The red chips are on the wrong side: assets are what you OWN, liabilities what you OWE.",
      },
    },
  },
  {
    label: "word bank",
    cue: {
      atSec: 0, beatKey: "demo_wb",
      quiz: {
        type: "word_bank",
        question: "When dividing powers with the same base, ___ the exponents; when raising a power to a power, ___ them.",
        options: [
          { id: "w1", text: "subtract", isCorrect: true },
          { id: "w2", text: "multiply", isCorrect: true },
          { id: "w3", text: "add" },
          { id: "w4", text: "divide" },
        ],
        correctFeedback: "Both gaps right — subtract for quotients, multiply for powers of powers.",
      },
    },
  },
  {
    label: "scenario",
    cue: {
      atSec: 0, beatKey: "demo_sc",
      quiz: {
        type: "scenario",
        question: "An email from \"IT Service Desk\" says your mailbox will be suspended in 24 hours unless you verify your credentials at the link provided. It's 4:55pm on a Friday and you're about to leave. What do you do?",
        options: [
          { id: "a", text: "Report it with the phishing button and leave", isCorrect: true, feedback: "Right — urgency + credential requests = classic phishing. Reporting protects colleagues too." },
          { id: "b", text: "Click the link quickly to keep your mailbox", feedback: "That urgency is engineered exactly so you act before thinking — never verify credentials from an email link." },
          { id: "c", text: "Forward it to a teammate to ask if it's real", feedback: "Well-meant, but that spreads the malicious link. Use the report button — that's what it's for." },
        ],
      },
    },
  },
  {
    label: "likert",
    cue: {
      atSec: 0, beatKey: "demo_lk",
      quiz: {
        type: "likert",
        question: "How confident do you feel applying the six exponent laws on your own?",
        options: [
          { id: "1", text: "Not yet", feedback: "Honest — consider rewatching the worked example before the final check." },
          { id: "2", text: "Getting there", feedback: "Good — the practice check coming up will firm it up." },
          { id: "3", text: "Fairly confident", feedback: "Great — the final challenge should confirm it." },
          { id: "4", text: "Could teach it", feedback: "Excellent — see if you can beat the final check without pausing." },
        ],
      },
    },
  },
  {
    label: "flashcard",
    cue: {
      atSec: 0, beatKey: "demo_fc",
      quiz: {
        type: "flashcard",
        question: "What does the quotient law of exponents say?",
        options: [
          { id: "a", text: "x^a ÷ x^b = x^(a-b) — same base, subtract the exponents.", isCorrect: true, feedback: "The one everyone flips: subtract, don't divide, the exponents." },
        ],
      },
    },
  },
  {
    label: "image choice",
    cue: {
      atSec: 0, beatKey: "demo_img",
      quiz: {
        type: "image_choice",
        question: "Which graph shows exponential growth?",
        options: [
          { id: "a", text: "Curve A", image: curveSvg("M 24 116 L 224 26"), feedback: "That's linear — constant slope, adds the same amount each step." },
          { id: "b", text: "Curve B", image: curveSvg("M 24 112 C 100 108, 170 90, 224 20"), isCorrect: true, feedback: "Yes — slow start, then the doubling takes over. Growth proportional to current value." },
          { id: "c", text: "Curve C", image: curveSvg("M 24 110 C 70 40, 140 28, 224 24"), feedback: "That's logarithmic — fast start that flattens out, the opposite shape." },
          { id: "d", text: "Curve D", image: curveSvg("M 24 30 C 90 100, 160 100, 224 110"), feedback: "That's decay — it's heading down." },
        ],
      },
    },
  },
  {
    label: "memory pairs",
    cue: {
      atSec: 0, beatKey: "demo_mem",
      quiz: {
        type: "memory_pairs",
        question: "Flip the cards and pair each law with its rule.",
        options: [
          { id: "p1", text: "Product law", matchTargetId: "p1r" },
          { id: "p1r", text: "x^a · x^b = x^(a+b)" },
          { id: "p2", text: "Quotient law", matchTargetId: "p2r" },
          { id: "p2r", text: "x^a ÷ x^b = x^(a-b)" },
          { id: "p3", text: "Zero exponent", matchTargetId: "p3r" },
          { id: "p3r", text: "x^0 = 1" },
          { id: "p4", text: "Negative exponent", matchTargetId: "p4r" },
          { id: "p4r", text: "x^-n = 1/x^n" },
        ],
        correctFeedback: "Sharp memory",
        wrongFeedback: "Pairs found",
      },
    },
  },
  {
    label: "this or that",
    cue: {
      atSec: 0, beatKey: "demo_tot",
      quiz: {
        type: "this_or_that",
        question: "Phishing or legit? Classify each email trait.",
        options: [
          { id: "phish", text: "Phishing" },
          { id: "legit", text: "Legit" },
          { id: "t1", text: "\"Verify your password within 24 hours or lose access\"", matchTargetId: "phish" },
          { id: "t2", text: "Sender domain is micros0ft-helpdesk.ru", matchTargetId: "phish" },
          { id: "t3", text: "Reply-to matches your company's domain exactly", matchTargetId: "legit" },
          { id: "t4", text: "Generic greeting: \"Dear employee\"", matchTargetId: "phish" },
          { id: "t5", text: "References a ticket number you actually opened", matchTargetId: "legit" },
        ],
        correctFeedback: "Perfect radar",
        wrongFeedback: "Review the red dots",
      },
    },
  },
  {
    label: "word search",
    cue: {
      atSec: 0, beatKey: "demo_ws",
      quiz: {
        type: "word_search",
        question: "Find the four exponent-law terms hidden in the grid.",
        options: [
          { id: "w1", text: "POWER", isCorrect: true },
          { id: "w2", text: "BASE", isCorrect: true },
          { id: "w3", text: "PRODUCT", isCorrect: true },
          { id: "w4", text: "QUOTIENT", isCorrect: true },
        ],
        correctFeedback: "All four terms found",
      },
    },
  },
  {
    label: "guess the concept",
    cue: {
      atSec: 0, beatKey: "demo_gc",
      quiz: {
        type: "guess_concept",
        question: "Guess the cybersecurity term from the clues.",
        options: [
          { id: "a1", text: "phishing", isCorrect: true, feedback: "Exactly — engineered urgency, spoofed identity, credential theft." },
          { id: "h1", text: "I arrive uninvited, wearing a trusted brand's clothes." },
          { id: "h2", text: "I always claim it's urgent — 24 hours, or else." },
          { id: "h3", text: "My links never quite match the domain they claim to be." },
          { id: "h4", text: "One employee's click is all I need to get inside." },
        ],
        wrongFeedback: "It's phishing — the impersonation + urgency + credential-request trio.",
      },
    },
  },
  {
    label: "estimate",
    cue: {
      atSec: 0, beatKey: "demo_est",
      quiz: {
        type: "estimate",
        question: "Slide to your estimate: what is 2^10?",
        options: [
          { id: "min", text: "min", numericValue: 0 },
          { id: "max", text: "max", numericValue: 2000 },
          { id: "answer", text: "1024", isCorrect: true, numericValue: 1024, numericTolerancePct: 8, feedback: "2^10 = 1,024 — the famous 'kilo' of computing." },
        ],
        wrongFeedback: "2^10 = 1,024. Ten doublings from 1 grow much faster than intuition expects.",
      },
    },
  },
);

let skinCss: string | undefined;
const skinPath = join(HERE, "quiz-skin-draft.css");
if (existsSync(skinPath)) {
  const draft = readFileSync(skinPath, "utf-8");
  const lint = lintQuizSkin(draft);
  if (lint.ok) {
    skinCss = draft;
    console.log(`[gallery] quiz skin applied from quiz-skin-draft.css (${(draft.length / 1024).toFixed(1)} KB)`);
  } else {
    console.warn(`[gallery] quiz-skin-draft.css FAILED lint — building without it:\n  - ${lint.errors.join("\n  - ")}`);
  }
}

const html = buildQuizStyleGallery(DEMOS, skinCss);
const out = join(HERE, "quiz-style-gallery.html");
writeFileSync(out, html, "utf-8");
console.log(`[gallery] wrote ${out} (${(html.length / 1024).toFixed(0)} KB) — open it in a browser`);

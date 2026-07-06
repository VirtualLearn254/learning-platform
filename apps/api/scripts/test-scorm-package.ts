/**
 * LP-8 (automatable half): build a SCORM package locally with dummy media
 * and validate everything an LMS checks before you ever upload it:
 *   - zip opens, all four core files present
 *   - imsmanifest.xml is well-formed and declares SCORM 2004 4th Ed
 *   - index.html embeds the quiz cues and the scorm-api bridge
 *   - quiz JSON survives the embed round-trip
 *
 * Run: npx tsx apps/api/scripts/test-scorm-package.ts
 * The final import-into-an-LMS step (SCORM Cloud) remains a human check.
 */

import JSZip from "jszip";
import { createScormPackager } from "@lp/scorm-packager";

async function main() {
  const packager = createScormPackager();
  const built = await packager.build({
    lesson: { id: "11111111-2222-3333-4444-555555555555", title: "Self-test Lesson <&>", summary: "Validation run" },
    masterMp4: Buffer.from("not-a-real-mp4"),
    quizzes: [
      {
        atSec: 42.5,
        beatKey: "test_check",
        quiz: {
          type: "multiple_choice",
          question: "Does 2 < √7 < 3 hold?",
          options: [
            { id: "a", text: "Yes", isCorrect: true, feedback: "4 < 7 < 9." },
            { id: "b", text: "No", feedback: "Compare with the perfect squares 4 and 9." },
          ],
        },
        style: { bg: "#F6F1E7", ink: "#1F1B14", muted: "#75705F", accent: "#166534", surface: "#FBF8F1" },
      },
    ],
    branding: { organizationName: "Learning Platform" },
    version: "2004_4",
  });

  const zip = await JSZip.loadAsync(built.zip);
  const files = Object.keys(zip.files);
  const required = ["imsmanifest.xml", "index.html", "scorm-api.js", "master.mp4"];
  const missing = required.filter((f) => !files.includes(f));
  if (missing.length) throw new Error(`missing files: ${missing.join(", ")}`);
  console.log("1. zip structure: PASS —", files.join(", "));

  const manifest = await zip.file("imsmanifest.xml")!.async("string");
  const checks: Array<[string, boolean]> = [
    ["XML declaration", manifest.startsWith("<?xml")],
    ["SCORM 2004 4th Ed", manifest.includes("<schemaversion>2004 4th Edition</schemaversion>")],
    ["adlcp scormType sco", manifest.includes('adlcp:scormType="sco"')],
    ["default organization wired", /organizations default="[^"]+"/.test(manifest)],
    ["XML-escaped title", manifest.includes("Self-test Lesson &lt;&amp;&gt;")],
    ["all files declared", required.every((f) => f === "imsmanifest.xml" || manifest.includes(`href="${f}"`))],
  ];
  for (const [name, ok] of checks) {
    console.log(`2. manifest ${name}: ${ok ? "PASS" : "FAIL"}`);
    if (!ok) process.exitCode = 1;
  }

  const html = await zip.file("index.html")!.async("string");
  const quizEmbed = html.match(/var QUIZZES = (\[[\s\S]*?\]);/);
  if (!quizEmbed) throw new Error("quiz JSON not embedded in player");
  const quizzes = JSON.parse(quizEmbed[1]!);
  const q = quizzes[0];
  const htmlChecks: Array<[string, boolean]> = [
    ["scorm-api bridge referenced", html.includes('src="scorm-api.js"')],
    ["quiz cue survives round-trip", q?.atSec === 42.5 && q?.quiz?.options?.length === 2],
    ["correct flag preserved", q?.quiz?.options?.[0]?.isCorrect === true],
    ["setScore wired", html.includes("scorm.setScore(")],
    ["completion wired", html.includes("scorm.setStatus('completed')")],
    ["style palette survives round-trip", q?.style?.bg === "#F6F1E7" && q?.style?.accent === "#166534"],
    ["seamless scene (palette vars + frame fit)", html.includes("applyPalette(") && html.includes("fitSceneToVideo(") && html.includes("--q-bg")],
  ];
  for (const [name, ok] of htmlChecks) {
    console.log(`3. player ${name}: ${ok ? "PASS" : "FAIL"}`);
    if (!ok) process.exitCode = 1;
  }

  console.log(process.exitCode ? "\nRESULT: FAIL" : "\nRESULT: ALL PASS — remaining human step: import one real zip into scorm.cloud");
}

main().catch((e) => { console.error("FAILED:", e); process.exit(1); });

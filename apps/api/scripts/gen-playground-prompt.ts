/**
 * Generate the EXACT designer prompt the render worker would send for a
 * beat, so it can be pasted into any model playground (Fireworks, OpenAI,
 * etc.) for pre-deployment quality testing.
 *
 * Usage: npx tsx apps/api/scripts/gen-playground-prompt.ts <beat-data.json>
 * Writes: playground-system.txt + playground-user.txt next to this script.
 *
 * The output HTML from the playground can then be tested end-to-end with
 * test-playground-output.ts (lint + local render to MP4).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { buildDesignerPrompt } from "../src/lib/hf-designer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const dataPath = process.argv[2] ?? join(__dirname, "beat-data.json");
const beat = JSON.parse(readFileSync(dataPath, "utf8")) as {
  beatKey: string;
  beatType: "hook" | "concept" | "example" | "check" | "recap";
  script: string;
  visualSpec: { onScreenText?: string[]; callouts?: string[]; style?: string } | null;
  durationSeconds: number;
};

const { system, user } = buildDesignerPrompt({
  beatKey: beat.beatKey,
  beatType: beat.beatType,
  lessonTitle: "Rounding Off & Surds",
  script: beat.script,
  onScreenText: beat.visualSpec?.onScreenText ?? [],
  callouts: beat.visualSpec?.callouts ?? [],
  audioDurationSec: beat.durationSeconds,
  styleHint: beat.visualSpec?.style,
  // No word timestamps in playground mode — proportional estimation branch.
});

writeFileSync(join(__dirname, "playground-system.txt"), system, "utf8");
writeFileSync(join(__dirname, "playground-user.txt"), user, "utf8");
console.log(`system prompt: ${system.length} chars → playground-system.txt`);
console.log(`user prompt:   ${user.length} chars → playground-user.txt`);

/**
 * Validate + render a composition HTML produced in a model playground.
 * Runs the same lint gate as production, then renders locally to MP4
 * (silent tone stands in for narration) and extracts 3 judgment frames.
 *
 * Usage:
 *   npx tsx apps/api/scripts/test-playground-output.ts <output.html> <durationSec> [styleHint]
 *
 * Requires ffmpeg on PATH (or FFMPEG_DIR env pointing at a dir with ffmpeg).
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { lintHfComposition } from "../src/lib/hf-designer.js";
import { renderAnimatedMp4 } from "../src/lib/hf-render.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const htmlPath = process.argv[2];
const durationSec = parseFloat(process.argv[3] ?? "");
const styleHint = process.argv[4];
if (!htmlPath || !isFinite(durationSec)) {
  console.error("Usage: npx tsx test-playground-output.ts <output.html> <durationSec> [styleHint]");
  process.exit(1);
}

// Strip markdown fences if the playground output includes them.
let html = readFileSync(htmlPath, "utf8");
const fenced = html.match(/```(?:html)?\s*([\s\S]*?)```/);
if (fenced) html = fenced[1]!;
const docIdx = Math.max(html.indexOf("<!doctype"), html.indexOf("<!DOCTYPE"));
if (docIdx > 0) html = html.slice(docIdx);

async function main() {
  // 1. Production lint gate
  const lint = lintHfComposition(html, durationSec, styleHint);
  if (!lint.ok) {
    console.log(`LINT: FAIL (${lint.issues.length} issues)`);
    for (const i of lint.issues) console.log(`  - ${i}`);
    console.log("\nA production render would trigger the repair round with these notes.");
    process.exit(2);
  }
  console.log("LINT: PASS");

  // 2. Local render with tone stand-in audio
  const ffmpeg = process.env.FFMPEG_DIR ? join(process.env.FFMPEG_DIR, "ffmpeg") : "ffmpeg";
  const dir = await mkdtemp(join(tmpdir(), "pg-test-"));
  const mp3Path = join(dir, "narration.mp3");
  const ff = spawnSync(ffmpeg, [
    "-y", "-f", "lavfi", "-i", `sine=frequency=440:duration=${durationSec}`,
    "-af", "volume=0.05", "-b:a", "128k", mp3Path,
  ], { encoding: "utf8" });
  if (ff.status !== 0) { console.error("ffmpeg tone failed:", ff.stderr?.slice(-300)); process.exit(1); }

  console.log(`rendering ${durationSec.toFixed(1)}s @ 30fps (this takes a few minutes)…`);
  const t0 = Date.now();
  const mp4 = await renderAnimatedMp4({
    html,
    audioMp3: await readFile(mp3Path),
    onProgress: (m) => { if (m.includes("frame") || m.includes("Encoding")) process.stdout.write(`\r${m.slice(0, 60)}   `); },
  });
  console.log(`\nrendered in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  const outMp4 = join(__dirname, "playground-out.mp4");
  writeFileSync(outMp4, mp4);

  // 3. Extract judgment frames: early / hero / settle
  const times = [Math.min(2.5, durationSec * 0.2), durationSec * 0.65, Math.max(0.5, durationSec - 1.2)];
  for (let i = 0; i < times.length; i++) {
    spawnSync(ffmpeg, ["-y", "-ss", String(times[i]), "-i", outMp4, "-frames:v", "1",
      join(__dirname, `playground-frame-${i + 1}.png`)], { encoding: "utf8" });
  }
  console.log(`DONE → ${outMp4} (${(mp4.length / 1024 / 1024).toFixed(2)} MB) + playground-frame-{1,2,3}.png`);

  await rm(dir, { recursive: true, force: true }).catch(() => {});
}

main().catch((e) => { console.error("FAILED:", e); process.exit(1); });

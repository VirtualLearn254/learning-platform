/**
 * Spike: prove @hyperframes/producer renders an animated composition to MP4
 * inside the learning-platform toolchain. Uses a hand-authored composition
 * that follows the exact contract hf-designer.ts teaches the AI, plus a
 * silent MP3 (ffmpeg-generated) standing in for narration.
 *
 * Run: npx tsx apps/api/scripts/spike-hf-render.ts
 * Output: apps/api/scripts/spike-out.mp4 (12s, animated)
 */

import { spawnSync } from "node:child_process";
import { writeFile, readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { renderAnimatedMp4 } from "../src/lib/hf-render.js";
import { lintHfComposition } from "../src/lib/hf-designer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DUR = 12;

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<style>
  html, body { margin: 0; padding: 0; }
  [data-composition-id="root"] {
    width: 1920px; height: 1080px; overflow: hidden; position: relative;
    background: linear-gradient(160deg, #FAFAF7 0%, #F1F0EA 100%);
    font-family: system-ui, "Helvetica Neue", Arial, sans-serif;
    color: #111111;
  }
  .scene-content {
    width: 100%; height: 100%; box-sizing: border-box;
    padding: 140px 160px;
    display: flex; flex-direction: column; justify-content: center; gap: 36px;
  }
  .eyebrow { font-size: 26px; letter-spacing: 0.18em; text-transform: uppercase; color: #DC2626; font-weight: 700; }
  .hero { font-size: 118px; font-weight: 800; line-height: 1.04; letter-spacing: -0.02em; max-width: 1500px; }
  .rule { width: 120px; height: 8px; background: #DC2626; border-radius: 999px; }
  .cards { display: flex; gap: 32px; margin-top: 24px; }
  .card {
    flex: 1; background: #FFFFFF; border: 1px solid #E5E2D9; border-radius: 18px;
    padding: 44px 40px; box-shadow: 0 10px 30px rgba(17,17,17,0.06);
  }
  .card .num { font-size: 30px; font-weight: 800; color: #DC2626; margin-bottom: 14px; }
  .card .txt { font-size: 36px; font-weight: 600; line-height: 1.25; }
</style>
</head>
<body>
  <div data-composition-id="root" data-width="1920" data-height="1080" data-duration="${DUR}">
    <audio id="narration" class="clip" src="assets/narration.mp3" data-start="0" data-track-index="0"></audio>
    <div id="scene" class="clip" data-start="0" data-duration="${DUR}" data-track-index="1">
      <div class="scene-content">
        <div class="eyebrow" id="eyebrow">Spike · Animated Render</div>
        <div class="hero" id="hero">The render engine is alive.</div>
        <div class="rule" id="rule"></div>
        <div class="cards" id="cards">
          <div class="card c1"><div class="num">01</div><div class="txt">Entrances stagger in</div></div>
          <div class="card c2"><div class="num">02</div><div class="txt">Mid-scene life breathes</div></div>
          <div class="card c3"><div class="num">03</div><div class="txt">Everything settles</div></div>
        </div>
      </div>
    </div>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      tl.from("#eyebrow", { y: 30, opacity: 0, duration: 0.6, ease: "power3.out" }, 0.3);
      tl.from("#hero",    { y: 60, opacity: 0, duration: 0.8, ease: "power3.out" }, 0.55);
      tl.from("#rule",    { scaleX: 0, transformOrigin: "left center", duration: 0.6, ease: "power3.out" }, 1.1);
      tl.from(".card",    { y: 48, opacity: 0, duration: 0.7, ease: "power3.out", stagger: 0.18 }, 1.5);
      // mid-scene life: gentle float, settles before the final second
      tl.to(".card", { y: -6, duration: 2.4, ease: "sine.inOut", yoyo: true, repeat: 2, stagger: 0.3 }, 3.0);
      tl.to("#hero", { scale: 1.012, transformOrigin: "left center", duration: 3.2, ease: "sine.inOut", yoyo: true, repeat: 1 }, 3.0);
      window.__timelines["root"] = tl;
    </script>
  </div>
</body>
</html>`;

async function main() {
  // 0. Lint the spike composition with the same gate the AI output faces.
  const lint = lintHfComposition(HTML, DUR);
  console.log("[spike] lint:", lint.ok ? "PASS" : `FAIL\n${lint.issues.join("\n")}`);
  if (!lint.ok) process.exit(1);

  // 1. Generate a 12s tone MP3 as stand-in narration (silence trips -shortest heuristics).
  const dir = await mkdtemp(join(tmpdir(), "spike-"));
  const mp3Path = join(dir, "narration.mp3");
  const ff = spawnSync("ffmpeg", [
    "-y", "-f", "lavfi", "-i", `sine=frequency=440:duration=${DUR}`,
    "-af", "volume=0.05", "-b:a", "128k", mp3Path,
  ], { encoding: "utf8" });
  if (ff.status !== 0) {
    console.error("[spike] ffmpeg failed:", ff.stderr?.slice(-400));
    process.exit(1);
  }
  const mp3 = await readFile(mp3Path);
  console.log(`[spike] narration stand-in: ${(mp3.length / 1024).toFixed(0)} KB`);

  // 2. Render.
  const t0 = Date.now();
  const mp4 = await renderAnimatedMp4({
    html: HTML,
    audioMp3: mp3,
    onProgress: (m) => console.log(`[spike] hf: ${m}`),
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  const outPath = join(__dirname, "spike-out.mp4");
  await writeFile(outPath, mp4);
  console.log(`[spike] DONE in ${secs}s → ${outPath} (${(mp4.length / 1024 / 1024).toFixed(2)} MB)`);

  await rm(dir, { recursive: true, force: true }).catch(() => {});
}

main().catch((e) => { console.error("[spike] FAILED:", e); process.exit(1); });

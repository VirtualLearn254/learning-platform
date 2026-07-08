/**
 * Render a single beat to MP4 in three steps:
 *   1. Puppeteer screenshots the beat HTML → 1920x1080 PNG
 *   2. The MP3 audio (already TTS'd) sets the video duration
 *   3. ffmpeg loops the static PNG for that duration and muxes the audio in
 *
 * Output is a standard H.264 + AAC MP4, browser-playable, ~1-3 MB for
 * a 30-second clip. Good enough for first review — richer animation
 * comes when we wire in the hyperframes-pipeline templates.
 */

import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import puppeteer, { type Browser } from "puppeteer-core";

const CHROMIUM_PATH = process.env.PUPPETEER_EXECUTABLE_PATH ?? "/usr/bin/chromium-browser";

let browserSingleton: Browser | null = null;
async function getBrowser(): Promise<Browser> {
  if (browserSingleton && browserSingleton.connected) return browserSingleton;
  browserSingleton = await puppeteer.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage", // /dev/shm is tiny in docker
      "--disable-gpu",
      "--no-zygote",
    ],
  });
  return browserSingleton;
}

export async function htmlToPng(html: string, width = 1920, height = 1080): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 15_000 });
    const png = await page.screenshot({ type: "png", fullPage: false, clip: { x: 0, y: 0, width, height } });
    return Buffer.from(png);
  } finally {
    await page.close();
  }
}

export interface AssembleMp4Input {
  framePng: Buffer;
  audioMp3: Buffer;
  durationSec: number;
}

/** Mux a static PNG (as a 30fps loop) and an MP3 into one H.264+AAC MP4. */
export async function assembleMp4(input: AssembleMp4Input): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "render-"));
  const framePath = join(dir, "frame.png");
  const audioPath = join(dir, "audio.mp3");
  const outPath   = join(dir, "out.mp4");
  try {
    await writeFile(framePath, input.framePng);
    await writeFile(audioPath, input.audioMp3);

    await runFfmpeg([
      "-y",
      "-loop", "1",
      "-framerate", "30",
      "-i", framePath,
      "-i", audioPath,
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-tune", "stillimage",
      "-c:a", "aac",
      "-b:a", "160k",
      "-shortest",
      "-movflags", "+faststart",
      "-t", String(Math.max(1, input.durationSec)),
      outPath,
    ]);

    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", args);
    let err = "";
    ff.stderr.on("data", (b) => { err += b.toString(); });
    ff.on("close", (code) => {
      if (code === 0) return resolve();
      // Surface the ACTUAL failure line, not the encoder-stats tail: ffmpeg
      // prints per-stream stats last, so slice(-N) hides the real error.
      const errLines = err.split("\n").filter((l) =>
        /error|invalid|failed|could not|no such|unable|does not/i.test(l),
      ).slice(-6).join("\n");
      reject(new Error(`ffmpeg exited ${code}: ${errLines || err.slice(-400)}`));
    });
    ff.on("error", reject);
  });
}

/**
 * Concat multiple MP4s into one master with optional inter-beat pauses.
 * Re-encodes to ensure consistent codecs across all inputs (the cheap
 * stream-copy concat fails when inputs differ in subtle parameters).
 *
 * Caller passes the raw MP4 buffers in playback order. Returns the
 * concatenated MP4 bytes + total duration.
 */
export async function concatMp4s(
  inputs: Buffer[],
  opts: { pauseSec?: number } = {},
): Promise<{ mp4: Buffer; durationSec: number }> {
  if (inputs.length === 0) throw new Error("concatMp4s: no inputs");
  if (inputs.length === 1) {
    const dur = await probeDurationFromBuffer(inputs[0]!);
    return { mp4: inputs[0]!, durationSec: dur };
  }
  const dir = await mkdtemp(join(tmpdir(), "stitch-"));
  const outPath = join(dir, "master.mp4");
  try {
    const paths: string[] = [];
    for (let i = 0; i < inputs.length; i++) {
      const p = join(dir, `seg-${String(i).padStart(3, "0")}.mp4`);
      await writeFile(p, inputs[i]!);
      paths.push(p);
    }

    // Concat FILTER, not demuxer. The demuxer requires every input to share
    // codec params/timebase and fails at mux time on subtle mismatches
    // (per-beat renders can differ slightly in fps/SAR/audio params). The
    // filter re-normalizes each stream to identical params FIRST, then joins
    // — robust against heterogeneous inputs.
    const norm: string[] = [];
    const labels: string[] = [];
    for (let i = 0; i < inputs.length; i++) {
      norm.push(
        `[${i}:v]scale=1920:1080:force_original_aspect_ratio=decrease,` +
        `pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v${i}]`,
      );
      // aresample fills gaps / fixes drift; uniform 48k stereo fltp.
      norm.push(`[${i}:a]aresample=async=1,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a${i}]`);
      labels.push(`[v${i}][a${i}]`);
    }
    const filter = norm.join(";") + ";" +
      labels.join("") + `concat=n=${inputs.length}:v=1:a=1[v][a]`;

    await runFfmpeg([
      "-y",
      ...paths.flatMap((p) => ["-i", p]),
      "-filter_complex", filter,
      "-map", "[v]", "-map", "[a]",
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-preset", "veryfast",
      "-crf", "22",
      "-c:a", "aac",
      "-b:a", "160k",
      "-movflags", "+faststart",
      outPath,
    ]);

    const mp4 = await readFile(outPath);
    const durationSec = await probeDurationFromBuffer(mp4);
    return { mp4, durationSec };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Run ffprobe on a buffer (via temp file — stdin pipe causes EPIPE). */
async function probeDurationFromBuffer(buf: Buffer): Promise<number> {
  const dir = await mkdtemp(join(tmpdir(), "probe-"));
  const path = join(dir, "in.mp4");
  try {
    await writeFile(path, buf);
    return await new Promise((resolve, reject) => {
      const ff = spawn("ffprobe", [
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        path,
      ]);
      let out = "";
      let err = "";
      ff.stdout.on("data", (b) => { out += b.toString(); });
      ff.stderr.on("data", (b) => { err += b.toString(); });
      ff.on("close", (code) => {
        if (code !== 0) return reject(new Error(`ffprobe exited ${code}: ${err.slice(0, 200)}`));
        const n = parseFloat(out.trim());
        if (!isFinite(n)) return reject(new Error(`ffprobe non-number: ${out}`));
        resolve(n);
      });
      ff.on("error", reject);
    });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

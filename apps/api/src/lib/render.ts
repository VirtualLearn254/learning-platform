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
      reject(new Error(`ffmpeg exited ${code}: ${err.slice(-500)}`));
    });
    ff.on("error", reject);
  });
}

/**
 * hf-render — renders an animated HyperFrames composition to MP4 via
 * @hyperframes/producer. Mirrors hyperframes-pipeline/pipeline/render.ts:
 * materialize a project dir (index.html + meta.json + hyperframes.json +
 * assets/narration.mp3), run executeRenderJob, read back the MP4.
 *
 * The producer drives headless Chromium frame-by-frame, so audio in the
 * composition (<audio class="clip">) is muxed into the output — no separate
 * ffmpeg pass needed.
 *
 * Runtime requirements (already in the Docker image): chromium at
 * $PUPPETEER_EXECUTABLE_PATH, ffmpeg on PATH.
 */

import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createRenderJob, executeRenderJob } from "@hyperframes/producer";

export interface RenderAnimatedInput {
  /** Complete standalone HF composition HTML. */
  html: string;
  /** Narration MP3 bytes — written to assets/narration.mp3 in the project dir. */
  audioMp3: Buffer;
  /** Progress callback for job notes. */
  onProgress?: (msg: string) => void;
}

export async function renderAnimatedMp4(input: RenderAnimatedInput): Promise<Buffer> {
  const projectDir = await mkdtemp(join(tmpdir(), "hf-beat-"));
  const outputPath = join(projectDir, "out.mp4");
  try {
    await mkdir(join(projectDir, "assets"), { recursive: true });
    await writeFile(join(projectDir, "index.html"), input.html, "utf8");
    await writeFile(join(projectDir, "assets", "narration.mp3"), input.audioMp3);
    await writeFile(
      join(projectDir, "meta.json"),
      JSON.stringify({ id: "beat", name: "beat", createdAt: new Date().toISOString() }, null, 2),
      "utf8",
    );
    await writeFile(
      join(projectDir, "hyperframes.json"),
      JSON.stringify({
        $schema: "https://hyperframes.heygen.com/schema/hyperframes.json",
        paths: { blocks: "compositions", components: "compositions/components", assets: "assets" },
      }, null, 2),
      "utf8",
    );

    const job = createRenderJob({
      fps: { num: 30, den: 1 },
      quality: "high",
      format: "mp4",
    });

    await executeRenderJob(job, projectDir, outputPath, (_j: unknown, msg?: string) => {
      if (msg) input.onProgress?.(msg);
    });

    return await readFile(outputPath);
  } finally {
    await rm(projectDir, { recursive: true, force: true }).catch(() => {});
  }
}

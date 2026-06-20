/**
 * @lp/render-engine — the abstraction over the existing hyperframes-pipeline.
 *
 * Architectural seam: today these functions return stubbed placeholder data so
 * the rest of the app can be built. When we're ready to connect, each method
 * gets a real implementation that spawns the existing pipeline workers.
 *
 * The functions are intentionally side-effect-light: they receive structured
 * input, return structured output, and write artifacts to S3 keys passed in.
 * No state is held inside this package — the API/workers own state.
 */

import type { Beat, VisualSpec, QuizSpec, VoicePreference } from "@lp/shared";
import type { AIClient } from "@lp/ai-provider";

export interface AuthorBeatInput {
  beatKey: string;
  beatType: Beat["beatType"];
  script: string;
  visualSpec: VisualSpec | null;
  quiz: QuizSpec | null;
  styleHints: string[] | null;
  /** Concepts already taught earlier in the course — used to insert callback markers. */
  earlierConcepts: Array<{ concept: string; beatKey: string; timestampSec: number }>;
  /** Optional revision context: a beat being re-authored after feedback. */
  revisionContext?: {
    previousHtml: string;
    feedback: string;
    screenshotKeys: string[];
  };
}

export interface AuthorBeatOutput {
  /** Generated HTML payload. */
  html: string;
  /** Map of additional asset keys the beat needs (background images, etc.). */
  assets: Record<string, string>;
  /** Tokens used (for cost attribution). */
  usage: { inputTokens: number; outputTokens: number };
  /** Detected concepts this beat teaches — added to the concept graph. */
  conceptsTaught: string[];
}

export interface RenderBeatInput {
  beatKey: string;
  html: string;
  audioKey: string;
  /** Output S3 key for the rendered MP4. */
  outputKey: string;
}

export interface RenderBeatOutput {
  mp4Key: string;
  durationSeconds: number;
}

export interface TtsInput {
  text: string;
  voice: VoicePreference;
  /** S3 key the audio should be written to. */
  outputKey: string;
}

export interface TtsOutput {
  audioKey: string;
  durationSeconds: number;
  /** Whisper-aligned word timestamps. */
  wordTimestamps: Array<{ word: string; start: number; end: number }>;
}

export interface StitchLessonInput {
  lessonId: string;
  /** Per-beat MP4 keys in playback order (alt beats excluded). */
  beatMp4Keys: string[];
  /** S3 key for the master MP4. */
  outputKey: string;
  /** Inter-beat pause in seconds. */
  pauseSeconds?: number;
}

export interface StitchLessonOutput {
  masterMp4Key: string;
  durationSeconds: number;
}

export interface ReviewBeatInput {
  beatKey: string;
  html: string;
  script: string;
  beatDurationSeconds: number;
}

export interface ReviewIssue {
  severity: "P0" | "P1" | "P2";
  type: string;
  description: string;
  hint?: string;
}

export interface ReviewBeatOutput {
  ok: boolean;
  score: number; // 0-100
  issues: ReviewIssue[];
  suggestions: string[];
}

export interface VerifyVisualInput {
  beatKey: string;
  html: string;
  /** Base64 PNG of a hero frame from the rendered beat. */
  framePng: string;
}

export interface VerifyVisualOutput {
  ok: boolean;
  issues: ReviewIssue[];
  /** If the verifier produced an edited HTML, this is the edit. */
  editedHtml?: string;
}

/**
 * The render-engine surface. Created once per worker, passes an AIClient
 * in so model choice + provider routing is controlled by the caller.
 */
export interface RenderEngine {
  authorBeat(input: AuthorBeatInput): Promise<AuthorBeatOutput>;
  reviewBeat(input: ReviewBeatInput): Promise<ReviewBeatOutput>;
  verifyVisual(input: VerifyVisualInput): Promise<VerifyVisualOutput>;
  tts(input: TtsInput): Promise<TtsOutput>;
  renderBeat(input: RenderBeatInput): Promise<RenderBeatOutput>;
  stitchLesson(input: StitchLessonInput): Promise<StitchLessonOutput>;
}

export function createRenderEngine(_ai: AIClient): RenderEngine {
  /** Placeholder implementation. Each method returns a structurally-valid
   *  stub so the rest of the system can run end-to-end. The real
   *  implementation replaces each method by porting the corresponding
   *  hyperframes-pipeline module. */
  return {
    async authorBeat(input) {
      return {
        html: `<!doctype html><html><head><title>${input.beatKey}</title></head><body><h1>Placeholder beat: ${input.beatKey}</h1><p>${input.script.slice(0, 200)}…</p></body></html>`,
        assets: {},
        usage: { inputTokens: 0, outputTokens: 0 },
        conceptsTaught: [],
      };
    },
    async reviewBeat(_input) {
      return { ok: true, score: 95, issues: [], suggestions: [] };
    },
    async verifyVisual(_input) {
      return { ok: true, issues: [] };
    },
    async tts(input) {
      return {
        audioKey: input.outputKey,
        durationSeconds: 30,
        wordTimestamps: input.text.split(/\s+/).map((w, i) => ({
          word: w, start: i * 0.4, end: (i + 1) * 0.4,
        })),
      };
    },
    async renderBeat(input) {
      return { mp4Key: input.outputKey, durationSeconds: 30 };
    },
    async stitchLesson(input) {
      const pause = input.pauseSeconds ?? 1.5;
      return {
        masterMp4Key: input.outputKey,
        durationSeconds: input.beatMp4Keys.length * 30 + (input.beatMp4Keys.length - 1) * pause,
      };
    },
  };
}

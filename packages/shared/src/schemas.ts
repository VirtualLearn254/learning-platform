import { z } from "zod";

export const BeatStageSchema = z.enum([
  "queued", "ingested", "authoring", "ai_review", "human_review",
  "revising", "rendering", "approved", "stitched", "published",
]);

export const BeatStatusSchema = z.enum(["pending", "running", "succeeded", "failed"]);

export const BeatTypeSchema = z.enum(["hook", "concept", "example", "check", "recap"]);

export const BloomLevelSchema = z.enum([
  "remember", "understand", "apply", "analyze", "evaluate", "create",
]);

export const QuizTypeSchema = z.enum([
  "multiple_choice", "match", "fill_in", "scenario", "likert",
  "true_false", "multi_select", "hotspot",
  "ordering", "sort_into", "word_bank", "image_choice", "estimate", "flashcard",
  "memory_pairs", "this_or_that", "word_search", "guess_concept",
]);

export const QuizOptionSchema = z.object({
  id: z.string(),
  text: z.string(),
  isCorrect: z.boolean().optional(),
  feedback: z.string().optional(),
  matchTargetId: z.string().optional(),
  numericValue: z.number().optional(),
  numericTolerancePct: z.number().optional(),
  /** hotspot: clickable region in percent of the quiz image. */
  region: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).optional(),
  /** image_choice: the option's picture (URL or data URI). */
  image: z.string().optional(),
});

export const QuizBranchSchema = z.object({
  onOptionId: z.string(),
  altBeatKey: z.string(),
  returnToBeatKey: z.string(),
});

/** H5P-style adaptivity: what happens after an answer. Targets are beat
 *  keys (resolved to master-video seconds at publish) or raw seconds. */
export const QuizAdaptivitySchema = z.object({
  wrong: z.object({
    /** Rewind target for "rewatch & retry" — defaults to the quiz's own beat. */
    rewatchBeatKey: z.string().optional(),
    seekToSec: z.number().optional(),
    /** Shown instead of per-option feedback while retries remain. */
    message: z.string().optional(),
    /** Retries allowed before the answer is revealed. Default 1. */
    maxAttempts: z.number().int().min(0).max(5).optional(),
    /** Learner may continue without retrying. Default true. */
    allowOptOut: z.boolean().optional(),
  }).optional(),
  correct: z.object({
    /** Optional skip-ahead past remedial content. */
    skipToBeatKey: z.string().optional(),
    seekToSec: z.number().optional(),
    seekLabel: z.string().optional(),
  }).optional(),
}).optional();

export const QuizSpecSchema = z.object({
  type: QuizTypeSchema,
  question: z.string(),
  eyebrow: z.string().optional(),
  /** Overrides the type's default one-line usage hint. */
  instructions: z.string().optional(),
  adaptivity: QuizAdaptivitySchema,
  bloomLevel: BloomLevelSchema.optional(),
  /** hotspot: the image that is the question canvas (URL or data URI). */
  image: z.string().optional(),
  options: z.array(QuizOptionSchema),
  correctFeedback: z.string().optional(),
  wrongFeedback: z.string().optional(),
  branches: z.array(QuizBranchSchema).optional(),
});

export const VisualSpecSchema = z.object({
  template: z.string().optional(),
  style: z.string().optional(),
  background: z.enum(["solid", "ai_image", "ai_video", "stock_image", "stock_video"]).optional(),
  onScreenText: z.array(z.string()).optional(),
  callouts: z.array(z.string()).optional(),
  /** Named visual devices (LP-20) from the visual-devices library. */
  devices: z.array(z.string()).optional(),
});

export const CreateCourseSchema = z.object({
  title: z.string().min(1).max(200),
  summary: z.string().max(2000).optional(),
});

export const UploadMaterialSchema = z.object({
  courseId: z.string().uuid(),
  filename: z.string(),
  mimeType: z.string(),
  /** Size in bytes; clients pass this so we can validate against limits before upload. */
  size: z.number().int().positive(),
});

export const ProvideBeatFeedbackSchema = z.object({
  feedback: z.string().min(1).max(4000),
  /** Optional annotated screenshot keys (already uploaded via /upload). */
  screenshotKeys: z.array(z.string()).optional(),
  /** What action to take after feedback: revise (loop), reject, or accept-as-is. */
  action: z.enum(["revise", "reject", "approve"]),
});

export const LearningEventSchema = z.object({
  eventType: z.enum([
    "video_play", "video_pause", "video_seek", "video_complete",
    "beat_replay", "callback_press",
    "quiz_show", "quiz_answer", "quiz_complete",
  ]),
  courseId: z.string().uuid(),
  beatId: z.string().uuid().optional(),
  data: z.record(z.unknown()).default({}),
  timestamp: z.string().datetime().optional(),
});

export type CreateCourseInput = z.infer<typeof CreateCourseSchema>;
export type UploadMaterialInput = z.infer<typeof UploadMaterialSchema>;
export type ProvideBeatFeedbackInput = z.infer<typeof ProvideBeatFeedbackSchema>;
export type LearningEventInput = z.infer<typeof LearningEventSchema>;

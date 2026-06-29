/**
 * Shared types — used by both apps/web and apps/api so request/response shapes
 * stay in sync without manual duplication. Companion schemas in ./schemas.ts
 * provide runtime validation.
 */

export type BloomLevel = "remember" | "understand" | "apply" | "analyze" | "evaluate" | "create";

export type QuizType = "multiple_choice" | "match" | "fill_in" | "scenario" | "likert";

export type BeatType = "hook" | "concept" | "example" | "check" | "recap";

/** The lifecycle stages a beat moves through in the Kanban board. */
export type BeatStage =
  | "queued"
  | "ingested"        // Course material parsed; beat outline written
  | "authoring"       // AI is generating the HTML/CSS/JS
  | "ai_review"       // Automated review pass
  | "human_review"    // Awaiting human approval
  | "revising"        // Feedback loop: AI is editing
  | "rendering"       // HF render is producing the MP4
  | "approved"        // Beat is ready for stitching
  | "stitched"        // Included in master MP4
  | "published";      // Available in SCORM package

export type BeatStatus = "pending" | "running" | "succeeded" | "failed";

export interface Course {
  id: string;
  title: string;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Section {
  id: string;
  courseId: string;
  title: string;
  order: number;
}

export interface Module {
  id: string;
  sectionId: string;
  title: string;
  order: number;
}

export interface Lesson {
  id: string;
  moduleId: string;
  title: string;
  summary: string | null;
  order: number;
  voicePreference: VoicePreference | null;
  styleHints: string[] | null;
  masterMp4Key: string | null;
  scormPackageKey: string | null;
  publishedAt: string | null;
  holisticScore: number | null;
  holisticIssues: ReviewIssue[] | null;
  holisticReviewedAt: string | null;
}

export interface Beat {
  id: string;
  lessonId: string;
  beatKey: string;       // stable slug, e.g. "cmc1_hook"
  beatType: BeatType;
  order: number;
  stage: BeatStage;
  status: BeatStatus;
  script: string;
  visualSpec: VisualSpec | null;
  quiz: QuizSpec | null;
  isAlt: boolean;        // alt beat for scenario branching
  conceptsTaught: string[];
  conceptsRequired: string[];
  htmlKey: string | null;
  audioKey: string | null;
  mp4Key: string | null;
  durationSeconds: number | null;
  revisionCount: number;
  errorMessage: string | null;
  reviewScore: number | null;
  reviewIssues: ReviewIssue[] | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewIssue {
  severity: "P0" | "P1" | "P2";
  category: string;
  description: string;
  suggestion?: string;
  affectedBeats?: string[];
}

export interface VoicePreference {
  language: string;
  voice: string;
  speed: number;
}

export interface VisualSpec {
  template?: string;
  style?: string;
  background?: "solid" | "ai_image" | "ai_video" | "stock_image" | "stock_video";
  onScreenText?: string[];
  callouts?: string[];
}

export interface QuizSpec {
  type: QuizType;
  question: string;
  eyebrow?: string;
  bloomLevel?: BloomLevel;
  options: QuizOption[];
  correctFeedback?: string;
  wrongFeedback?: string;
  branches?: QuizBranch[];
}

export interface QuizOption {
  id: string;
  text: string;
  isCorrect?: boolean;
  feedback?: string;
  matchTargetId?: string;
  numericValue?: number;
  numericTolerancePct?: number;
}

export interface QuizBranch {
  onOptionId: string;
  altBeatKey: string;
  returnToBeatKey: string;
}

/** Event emitted by the player; consumed by the learning_events table. */
export interface LearningEvent {
  eventType:
    | "video_play" | "video_pause" | "video_seek" | "video_complete"
    | "beat_replay" | "callback_press"
    | "quiz_show" | "quiz_answer" | "quiz_complete";
  courseId: string;
  beatId?: string;
  data: Record<string, unknown>;
  timestamp: string;
}

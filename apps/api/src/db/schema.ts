/**
 * Drizzle schema — the source of truth for the relational shape.
 * `drizzle-kit push` syncs this to Postgres without writing manual migrations.
 *
 * Course → Section → Module → Lesson → Beat
 * Quiz beats embed quiz JSON inline (no separate table). Learning events get
 * their own append-only table; analytics queries read from it.
 */

import { sql } from "drizzle-orm";
import {
  pgTable, uuid, text, integer, boolean, jsonb, timestamp, bigserial,
  pgEnum, index, primaryKey, numeric,
} from "drizzle-orm/pg-core";

export const beatStageEnum = pgEnum("beat_stage", [
  "queued", "ingested", "authoring", "ai_review", "human_review",
  "revising", "rendering", "approved", "stitched", "published",
]);

export const beatStatusEnum = pgEnum("beat_status", [
  "pending", "running", "succeeded", "failed",
]);

export const beatTypeEnum = pgEnum("beat_type", [
  "hook", "concept", "example", "check", "recap",
]);

// ─── Courses → Sections → Modules → Lessons → Beats ─────────────────

export const courses = pgTable("courses", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  summary: text("summary"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const sections = pgTable("sections", {
  id: uuid("id").primaryKey().defaultRandom(),
  courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  order: integer("order").notNull(),
}, (t) => ({
  courseIdx: index("sections_course_idx").on(t.courseId),
}));

export const modules = pgTable("modules", {
  id: uuid("id").primaryKey().defaultRandom(),
  sectionId: uuid("section_id").notNull().references(() => sections.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  order: integer("order").notNull(),
}, (t) => ({
  sectionIdx: index("modules_section_idx").on(t.sectionId),
}));

export const lessons = pgTable("lessons", {
  id: uuid("id").primaryKey().defaultRandom(),
  moduleId: uuid("module_id").notNull().references(() => modules.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  summary: text("summary"),
  order: integer("order").notNull(),
  voicePreference: jsonb("voice_preference"),
  styleHints: jsonb("style_hints"),
  masterMp4Key: text("master_mp4_key"),
  /** S3 key for the SCORM zip once published. */
  scormPackageKey: text("scorm_package_key"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  /** Latest holistic-review score (0-100) for the lesson as a whole. */
  holisticScore: integer("holistic_score"),
  /** Latest holistic-review cross-beat issues. */
  holisticIssues: jsonb("holistic_issues").$type<ReviewIssue[]>(),
  /** Timestamp of the latest holistic review. */
  holisticReviewedAt: timestamp("holistic_reviewed_at", { withTimezone: true }),
}, (t) => ({
  moduleIdx: index("lessons_module_idx").on(t.moduleId),
}));

export const beats = pgTable("beats", {
  id: uuid("id").primaryKey().defaultRandom(),
  lessonId: uuid("lesson_id").notNull().references(() => lessons.id, { onDelete: "cascade" }),
  /** Stable per-lesson key like "cmc1_hook" — used in S3 paths + manifests. */
  beatKey: text("beat_key").notNull(),
  beatType: beatTypeEnum("beat_type").notNull(),
  order: integer("order").notNull(),
  stage: beatStageEnum("stage").default("queued").notNull(),
  status: beatStatusEnum("status").default("pending").notNull(),
  script: text("script").notNull(),
  visualSpec: jsonb("visual_spec"),
  quiz: jsonb("quiz"),
  isAlt: boolean("is_alt").default(false).notNull(),
  conceptsTaught: jsonb("concepts_taught").$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
  conceptsRequired: jsonb("concepts_required").$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
  /** S3 keys, not local paths. */
  htmlKey: text("html_key"),
  audioKey: text("audio_key"),
  mp4Key: text("mp4_key"),
  durationSeconds: integer("duration_seconds"),
  /** Number of revision rounds this beat has been through. */
  revisionCount: integer("revision_count").default(0).notNull(),
  errorMessage: text("error_message"),
  /** Latest AI reviewer score (0-100) — null if not yet reviewed. */
  reviewScore: integer("review_score"),
  /** Structured issue list from the AI reviewer (latest run). */
  reviewIssues: jsonb("review_issues").$type<ReviewIssue[]>(),
  /** Timestamp of the latest AI review pass. */
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  lessonIdx: index("beats_lesson_idx").on(t.lessonId),
  stageIdx: index("beats_stage_idx").on(t.stage),
  orderIdx: index("beats_order_idx").on(t.lessonId, t.order),
}));

export interface ReviewIssue {
  severity: "P0" | "P1" | "P2";
  category: string;
  description: string;
  suggestion?: string;
  /** For holistic issues, which beat keys are involved. */
  affectedBeats?: string[];
}

// ─── Uploaded course material ───────────────────────────────────────

export const materials = pgTable("materials", {
  id: uuid("id").primaryKey().defaultRandom(),
  courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  s3Key: text("s3_key").notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).defaultNow().notNull(),
  /** Once ingestion runs, the parsed text is cached here for fast re-ingest. */
  extractedText: text("extracted_text"),
  ingestedAt: timestamp("ingested_at", { withTimezone: true }),
}, (t) => ({
  courseIdx: index("materials_course_idx").on(t.courseId),
}));

// ─── Beat human-review feedback ─────────────────────────────────────

export const beatFeedback = pgTable("beat_feedback", {
  id: uuid("id").primaryKey().defaultRandom(),
  beatId: uuid("beat_id").notNull().references(() => beats.id, { onDelete: "cascade" }),
  feedback: text("feedback").notNull(),
  screenshotKeys: jsonb("screenshot_keys").$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
  action: text("action").notNull(), // "revise" | "reject" | "approve"
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  beatIdx: index("beat_feedback_beat_idx").on(t.beatId),
}));

// ─── Job tracking (mirrors BullMQ but persisted for UI) ─────────────

export const jobs = pgTable("jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  queue: text("queue").notNull(),
  beatId: uuid("beat_id").references(() => beats.id, { onDelete: "cascade" }),
  lessonId: uuid("lesson_id").references(() => lessons.id, { onDelete: "cascade" }),
  /** For ingest jobs: which material is being processed. */
  materialId: uuid("material_id").references(() => materials.id, { onDelete: "cascade" }),
  status: text("status").notNull(), // queued | running | succeeded | failed
  attempts: integer("attempts").default(0).notNull(),
  /** Free-text human-readable progress note that workers update as they go. */
  progressNote: text("progress_note"),
  /** When the worker picked it up, finished, etc. */
  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  /** ETA estimate in seconds — workers update this with their median runtime. */
  etaSeconds: integer("eta_seconds"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  beatIdx: index("jobs_beat_idx").on(t.beatId),
  materialIdx: index("jobs_material_idx").on(t.materialId),
  queueStatusIdx: index("jobs_queue_status_idx").on(t.queue, t.status),
}));

// ─── Learning events (analytics) ────────────────────────────────────

export const learningEvents = pgTable("learning_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  courseId: uuid("course_id").notNull(),
  beatId: uuid("beat_id"),
  /** Anonymous learner identifier from the player. UUID for now. */
  learnerId: uuid("learner_id"),
  eventType: text("event_type").notNull(),
  data: jsonb("data").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
  ts: timestamp("ts", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  courseTsIdx: index("le_course_ts_idx").on(t.courseId, t.ts),
  beatTsIdx: index("le_beat_ts_idx").on(t.beatId, t.ts),
}));

// ─── AI profile overrides (UI-editable model/provider per role) ─────

/**
 * Per-profile overrides on top of the TS defaults in
 * packages/ai-provider/src/profiles.ts. If a row exists, it wins.
 * If a column is null, the TS default still applies for that field.
 */
export const aiProfileOverrides = pgTable("ai_profile_overrides", {
  /** e.g. "author", "reviewer". Matches profiles.ts keys. */
  profileId: text("profile_id").primaryKey(),
  preferredProvider: text("preferred_provider"),
  modelId: text("model_id"),
  /** Postgres numeric stays as string in JS for precision. */
  temperature: numeric("temperature"),
  maxTokens: integer("max_tokens"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─── AI usage log (every chat/vision call) ──────────────────────────

/**
 * Append-only log of every AI call routed through @lp/ai-provider.
 * Cost is computed at log time from the price catalog so future price
 * changes don't retroactively change historical numbers.
 */
export const aiUsage = pgTable("ai_usage", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  ts: timestamp("ts", { withTimezone: true }).defaultNow().notNull(),
  profileId: text("profile_id").notNull(),
  providerId: text("provider_id").notNull(),
  modelId: text("model_id").notNull(),
  inputTokens: integer("input_tokens").default(0).notNull(),
  outputTokens: integer("output_tokens").default(0).notNull(),
  /** Total $ for this call (input + output). Decimal stored as string. */
  costUsd: numeric("cost_usd", { precision: 14, scale: 8 }).default("0").notNull(),
  durationMs: integer("duration_ms").default(0).notNull(),
  /** Optional beat / lesson attribution if the caller passed them. */
  beatId: uuid("beat_id"),
  lessonId: uuid("lesson_id"),
  status: text("status").notNull(), // "ok" | "error"
  errorMessage: text("error_message"),
}, (t) => ({
  tsIdx: index("ai_usage_ts_idx").on(t.ts),
  profileTsIdx: index("ai_usage_profile_ts_idx").on(t.profileId, t.ts),
  providerTsIdx: index("ai_usage_provider_ts_idx").on(t.providerId, t.ts),
}));

// ─── App secrets (UI-managed, encrypted at rest) ────────────────────

/**
 * App-managed secrets (API keys, etc.) edited from the Settings UI.
 * Encrypted with AES-256-GCM using the master key in env LP_SECRETS_KEY.
 * The plaintext NEVER hits the DB. lastFour is shown in the UI so the
 * operator can recognize which key is stored without leaking it.
 */
export const appSecrets = pgTable("app_secrets", {
  /** Stable id, e.g. "anthropic_api_key", "openai_api_key". */
  name: text("name").primaryKey(),
  ciphertextB64: text("ciphertext_b64").notNull(),
  ivB64: text("iv_b64").notNull(),
  authTagB64: text("auth_tag_b64").notNull(),
  /** Last 4 chars of the plaintext, kept so the UI can show "●●●●1234". */
  lastFour: text("last_four").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─── Style library (Hermes feeds this; P3) ──────────────────────────

export const styles = pgTable("styles", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  /** Maps to a CSS package / HF template id. */
  templateId: text("template_id").notNull(),
  /** Free-text tags so the author can ask for "soft + editorial + warm". */
  tags: jsonb("tags").$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
  /** Approved by a human for use in production. */
  approved: boolean("approved").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

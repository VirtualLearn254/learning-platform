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
  pgEnum, index, primaryKey,
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
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  lessonIdx: index("beats_lesson_idx").on(t.lessonId),
  stageIdx: index("beats_stage_idx").on(t.stage),
  orderIdx: index("beats_order_idx").on(t.lessonId, t.order),
}));

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
  status: text("status").notNull(), // queued | running | succeeded | failed
  attempts: integer("attempts").default(0).notNull(),
  /** When the worker picked it up, finished, etc. */
  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  /** ETA estimate in seconds — workers update this with their median runtime. */
  etaSeconds: integer("eta_seconds"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  beatIdx: index("jobs_beat_idx").on(t.beatId),
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

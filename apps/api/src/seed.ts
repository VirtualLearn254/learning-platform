/**
 * Seed script. Populates the DB with one example course so the UI is
 * useful immediately after `db:push`. Run with:
 *   npm run db:seed
 *
 * Idempotent: skips if a course with the same title already exists.
 */

import "dotenv/config";
import { eq } from "drizzle-orm";

import { db, tables } from "./db/index.js";

async function main() {
  const seedTitle = "Demo: Three Ways To Learn Faster";
  const existing = await db.query.courses.findFirst({ where: eq(tables.courses.title, seedTitle) });
  if (existing) {
    console.log(`[seed] '${seedTitle}' already exists (${existing.id}) — skipping`);
    process.exit(0);
  }

  const [course] = await db.insert(tables.courses).values({
    title: seedTitle,
    summary: "A walking-through example so the dashboard isn't empty. Three lessons across one section, one module.",
  }).returning();
  console.log(`[seed] course ${course!.id}`);

  const [section] = await db.insert(tables.sections).values({
    courseId: course!.id, title: "Foundations", order: 0,
  }).returning();

  const [moduleRow] = await db.insert(tables.modules).values({
    sectionId: section!.id, title: "Learning to learn", order: 0,
  }).returning();

  const lessons = [
    { title: "The forgetting curve", order: 0 },
    { title: "Spaced repetition in practice", order: 1 },
    { title: "Active recall vs re-reading", order: 2 },
  ];
  const insertedLessons = await db.insert(tables.lessons).values(
    lessons.map((l) => ({ ...l, moduleId: moduleRow!.id })),
  ).returning();
  console.log(`[seed] ${insertedLessons.length} lessons`);

  const stages = ["queued", "ingested", "authoring", "ai_review", "human_review", "approved", "stitched", "published"] as const;
  const allBeats = insertedLessons.flatMap((lesson, lIdx) => [
    { lessonId: lesson.id, beatKey: "hook",    beatType: "hook"    as const, order: 0, stage: stages[(lIdx + 0) % stages.length]!, script: "Hook script for " + lesson.title },
    { lessonId: lesson.id, beatKey: "concept", beatType: "concept" as const, order: 1, stage: stages[(lIdx + 1) % stages.length]!, script: "Concept script for " + lesson.title },
    { lessonId: lesson.id, beatKey: "example", beatType: "example" as const, order: 2, stage: stages[(lIdx + 2) % stages.length]!, script: "Example script for " + lesson.title },
    { lessonId: lesson.id, beatKey: "check",   beatType: "check"   as const, order: 3, stage: "human_review" as const,             script: "Quiz beat for " + lesson.title },
    { lessonId: lesson.id, beatKey: "recap",   beatType: "recap"   as const, order: 4, stage: stages[(lIdx + 3) % stages.length]!, script: "Recap for " + lesson.title },
  ]);
  await db.insert(tables.beats).values(allBeats);
  console.log(`[seed] ${allBeats.length} beats across ${insertedLessons.length} lessons`);

  console.log("[seed] done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});

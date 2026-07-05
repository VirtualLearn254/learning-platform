/**
 * Hierarchy walk helpers: Course → Section → Module → Lesson → Beat.
 * Used by workers that need course-level flags (autopilot) from a beat
 * or lesson id.
 */

import { eq } from "drizzle-orm";

import { db, tables } from "../db/index.js";

export async function courseForLesson(lessonId: string) {
  const lesson = await db.query.lessons.findFirst({ where: eq(tables.lessons.id, lessonId) });
  if (!lesson) return null;
  const mod = await db.query.modules.findFirst({ where: eq(tables.modules.id, lesson.moduleId) });
  if (!mod) return null;
  const section = await db.query.sections.findFirst({ where: eq(tables.sections.id, mod.sectionId) });
  if (!section) return null;
  return db.query.courses.findFirst({ where: eq(tables.courses.id, section.courseId) }) ?? null;
}

export async function courseForBeat(beatId: string) {
  const beat = await db.query.beats.findFirst({ where: eq(tables.beats.id, beatId) });
  if (!beat) return null;
  return courseForLesson(beat.lessonId);
}

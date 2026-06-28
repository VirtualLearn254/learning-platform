/**
 * Build the parent chain for a lesson or beat so the UI can render a
 * breadcrumb without making multiple roundtrips.
 *
 * Shape: Courses › <course> › <section> › <module> › <lesson> [› <beat>]
 *
 * Each crumb returns { kind, id, title, href? }. href is computed by the
 * client so we don't hardcode route shapes here.
 */

import { eq } from "drizzle-orm";

import { db, tables } from "../db/index.js";

export interface Breadcrumb {
  kind: "courses-root" | "course" | "section" | "module" | "lesson" | "beat";
  id: string | null;
  title: string;
}

export async function breadcrumbsForLesson(lessonId: string): Promise<Breadcrumb[]> {
  const lesson = await db.query.lessons.findFirst({ where: eq(tables.lessons.id, lessonId) });
  if (!lesson) return [];
  const moduleRow = await db.query.modules.findFirst({ where: eq(tables.modules.id, lesson.moduleId) });
  if (!moduleRow) return [];
  const section = await db.query.sections.findFirst({ where: eq(tables.sections.id, moduleRow.sectionId) });
  if (!section) return [];
  const course = await db.query.courses.findFirst({ where: eq(tables.courses.id, section.courseId) });
  if (!course) return [];
  return [
    { kind: "courses-root", id: null,       title: "Courses" },
    { kind: "course",       id: course.id,  title: course.title },
    { kind: "section",      id: section.id, title: section.title },
    { kind: "module",       id: moduleRow.id, title: moduleRow.title },
    { kind: "lesson",       id: lesson.id,  title: lesson.title },
  ];
}

export async function breadcrumbsForBeat(beatId: string): Promise<Breadcrumb[]> {
  const beat = await db.query.beats.findFirst({ where: eq(tables.beats.id, beatId) });
  if (!beat) return [];
  const lessonCrumbs = await breadcrumbsForLesson(beat.lessonId);
  if (lessonCrumbs.length === 0) return [];
  return [...lessonCrumbs, { kind: "beat", id: beat.id, title: beat.beatKey }];
}

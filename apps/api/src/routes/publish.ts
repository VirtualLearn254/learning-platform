/**
 * Publish/export API — the machine-readable catalog of PUBLISHED content,
 * for LMS integrations and automations that pull SCORM packages.
 *
 *   GET /courses           → published catalog: courses → lessons with stable
 *                            scormUrl (zip download) + playUrl (hosted player)
 *   GET /lessons/:id       → one lesson's publish record
 *
 * Authed like the rest of the admin API (Authorization: Bearer <session
 * token> works for automations). The zip/player URLs themselves are served
 * from the public /files route so an LMS can fetch them without auth.
 */

import { Hono } from "hono";
import { eq, isNotNull } from "drizzle-orm";

import { db, tables } from "../db/index.js";

function base(): string {
  return (process.env.PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
}
function lessonUrls(lessonId: string) {
  return {
    scormUrl: `${base()}/api/files/${encodeURIComponent(`lessons/${lessonId}/lesson.scorm.zip`)}`,
    playUrl: `${base()}/api/files/lessons/${lessonId}/preview/index.html`,
    ltiLaunchUrl: `${base()}/api/lti/launch?lesson=${lessonId}`,
  };
}

export const publishRoute = new Hono()
  .get("/courses", async (c) => {
    const lessons = await db.select({
      id: tables.lessons.id, title: tables.lessons.title, summary: tables.lessons.summary,
      publishedAt: tables.lessons.publishedAt, moduleId: tables.lessons.moduleId,
    }).from(tables.lessons).where(isNotNull(tables.lessons.publishedAt));
    if (lessons.length === 0) return c.json({ courses: [] });

    const modules = await db.select().from(tables.modules);
    const sections = await db.select().from(tables.sections);
    const courses = await db.select().from(tables.courses);
    const sectionByModule = new Map(modules.map((m) => [m.id, m.sectionId]));
    const courseBySection = new Map(sections.map((s) => [s.id, s.courseId]));

    const byCourse = new Map<string, Array<(typeof lessons)[number]>>();
    for (const l of lessons) {
      const courseId = courseBySection.get(sectionByModule.get(l.moduleId) ?? "") ?? null;
      if (!courseId) continue;
      if (!byCourse.has(courseId)) byCourse.set(courseId, []);
      byCourse.get(courseId)!.push(l);
    }
    return c.json({
      courses: [...byCourse.entries()].map(([courseId, ls]) => {
        const course = courses.find((x) => x.id === courseId);
        return {
          id: courseId,
          title: course?.title ?? "",
          summary: course?.summary ?? "",
          lessons: ls.map((l) => ({
            id: l.id, title: l.title, summary: l.summary,
            publishedAt: l.publishedAt?.toISOString() ?? null,
            ...lessonUrls(l.id),
          })),
        };
      }),
    });
  })
  .get("/lessons/:id", async (c) => {
    const id = c.req.param("id");
    const lesson = await db.query.lessons.findFirst({ where: eq(tables.lessons.id, id) });
    if (!lesson || !lesson.publishedAt) return c.json({ error: "not published" }, 404);
    return c.json({
      lesson: {
        id: lesson.id, title: lesson.title, summary: lesson.summary,
        publishedAt: lesson.publishedAt.toISOString(),
        ...lessonUrls(lesson.id),
      },
    });
  });

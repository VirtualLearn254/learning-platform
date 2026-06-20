import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq, desc } from "drizzle-orm";

import { CreateCourseSchema } from "@lp/shared";

import { db, tables } from "../db/index.js";

export const coursesRoute = new Hono()
  .get("/", async (c) => {
    const rows = await db.select().from(tables.courses).orderBy(desc(tables.courses.updatedAt));
    return c.json({ courses: rows });
  })
  .post("/", zValidator("json", CreateCourseSchema), async (c) => {
    const input = c.req.valid("json");
    const [inserted] = await db.insert(tables.courses).values({
      title: input.title,
      summary: input.summary ?? null,
    }).returning();
    return c.json({ course: inserted }, 201);
  })
  .get("/:id", async (c) => {
    const id = c.req.param("id");
    const course = await db.query.courses.findFirst({ where: eq(tables.courses.id, id) });
    if (!course) return c.json({ error: "not_found" }, 404);
    return c.json({ course });
  })
  .get("/:id/tree", async (c) => {
    /**
     * The Kanban / course-overview screen needs the full tree:
     * course → sections → modules → lessons → beats.
     */
    const id = c.req.param("id");
    const course = await db.query.courses.findFirst({ where: eq(tables.courses.id, id) });
    if (!course) return c.json({ error: "not_found" }, 404);

    const sectionRows = await db.select().from(tables.sections).where(eq(tables.sections.courseId, id));
    const moduleRows = sectionRows.length
      ? await db.select().from(tables.modules)
      : [];
    const lessonRows = moduleRows.length
      ? await db.select().from(tables.lessons)
      : [];
    const beatRows = lessonRows.length
      ? await db.select().from(tables.beats)
      : [];

    const beatsByLesson = new Map<string, typeof beatRows>();
    for (const b of beatRows) {
      if (!beatsByLesson.has(b.lessonId)) beatsByLesson.set(b.lessonId, []);
      beatsByLesson.get(b.lessonId)!.push(b);
    }
    const lessonsByModule = new Map<string, Array<typeof lessonRows[number] & { beats: typeof beatRows }>>();
    for (const l of lessonRows) {
      if (!lessonsByModule.has(l.moduleId)) lessonsByModule.set(l.moduleId, []);
      lessonsByModule.get(l.moduleId)!.push({ ...l, beats: beatsByLesson.get(l.id) ?? [] });
    }
    const modulesBySection = new Map<string, Array<typeof moduleRows[number] & { lessons: ReturnType<typeof Array.prototype.values> }>>();
    for (const m of moduleRows) {
      if (!modulesBySection.has(m.sectionId)) modulesBySection.set(m.sectionId, []);
      modulesBySection.get(m.sectionId)!.push({ ...m, lessons: lessonsByModule.get(m.id) ?? [] as never });
    }
    const tree = {
      ...course,
      sections: sectionRows.map((s) => ({ ...s, modules: modulesBySection.get(s.id) ?? [] })),
    };
    return c.json({ tree });
  });

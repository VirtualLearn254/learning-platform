import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq, desc, inArray } from "drizzle-orm";

import { CreateCourseSchema } from "@lp/shared";

import { db, tables } from "../db/index.js";
import { queues } from "../queue/index.js";

/** All beat rows belonging to a course (via section → module → lesson). */
async function beatsForCourse(courseId: string) {
  const sectionRows = await db.select().from(tables.sections).where(eq(tables.sections.courseId, courseId));
  if (!sectionRows.length) return [];
  const moduleRows = await db.select().from(tables.modules)
    .where(inArray(tables.modules.sectionId, sectionRows.map((s) => s.id)));
  if (!moduleRows.length) return [];
  const lessonRows = await db.select().from(tables.lessons)
    .where(inArray(tables.lessons.moduleId, moduleRows.map((m) => m.id)));
  if (!lessonRows.length) return [];
  return db.select().from(tables.beats)
    .where(inArray(tables.beats.lessonId, lessonRows.map((l) => l.id)));
}

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
  .post("/:id/run", async (c) => {
    /**
     * Conductor: run the whole course through the pipeline. Sets autopilot
     * (AI-review pass → render, stitch → SCORM publish, no human gates) and
     * kicks every beat forward from wherever it currently is:
     *   ingested/queued        → author
     *   ai_review/human_review → render (if no mp4 yet)
     *   approved without mp4   → render
     * Everything downstream chains automatically via the workers.
     */
    const id = c.req.param("id");
    const course = await db.query.courses.findFirst({ where: eq(tables.courses.id, id) });
    if (!course) return c.json({ error: "not_found" }, 404);

    await db.update(tables.courses).set({ autopilot: true, updatedAt: new Date() })
      .where(eq(tables.courses.id, id));

    const beats = await beatsForCourse(id);
    let authorQueued = 0;
    let renderQueued = 0;
    for (const b of beats.filter((b) => !b.isAlt)) {
      if (b.stage === "ingested" || b.stage === "queued") {
        await queues.author.add("conductor-author", { beatId: b.id, isRevision: false });
        authorQueued++;
      } else if ((b.stage === "ai_review" || b.stage === "human_review" || b.stage === "approved") && !b.mp4Key) {
        await queues.render.add("conductor-render", { beatId: b.id });
        renderQueued++;
      }
    }
    return c.json({ ok: true, autopilot: true, authorQueued, renderQueued, totalBeats: beats.length });
  })
  .post("/:id/stop", async (c) => {
    /** Turn off autopilot. In-flight jobs finish; nothing new auto-chains. */
    const id = c.req.param("id");
    const course = await db.query.courses.findFirst({ where: eq(tables.courses.id, id) });
    if (!course) return c.json({ error: "not_found" }, 404);
    await db.update(tables.courses).set({ autopilot: false, updatedAt: new Date() })
      .where(eq(tables.courses.id, id));
    return c.json({ ok: true, autopilot: false });
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
    type LessonWithBeats = NonNullable<ReturnType<typeof lessonsByModule.get>>;
    const modulesBySection = new Map<string, Array<typeof moduleRows[number] & { lessons: LessonWithBeats }>>();
    for (const m of moduleRows) {
      if (!modulesBySection.has(m.sectionId)) modulesBySection.set(m.sectionId, []);
      modulesBySection.get(m.sectionId)!.push({ ...m, lessons: lessonsByModule.get(m.id) ?? [] });
    }
    const tree = {
      ...course,
      sections: sectionRows.map((s) => ({ ...s, modules: modulesBySection.get(s.id) ?? [] })),
    };
    return c.json({ tree });
  });

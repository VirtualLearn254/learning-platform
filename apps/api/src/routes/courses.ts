import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq, desc, inArray } from "drizzle-orm";

import { CreateCourseSchema } from "@lp/shared";

import { db, tables } from "../db/index.js";
import { queues } from "../queue/index.js";
import { s3 } from "../lib/s3.js";

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
      if (b.stage === "ingested" || b.stage === "queued" || b.stage === "authoring" || b.stage === "revising") {
        // ingested/queued: never authored. authoring/revising: orphaned
        // mid-author by a crash/deploy — re-queue so it isn't stuck.
        await queues.author.add("conductor-author", { beatId: b.id, isRevision: b.stage === "revising" });
        authorQueued++;
      } else if ((b.stage === "ai_review" || b.stage === "human_review" || b.stage === "approved" || b.stage === "rendering") && !b.mp4Key) {
        // ...including "rendering": a beat orphaned MID-render has that stage
        // and no mp4 yet — the old condition skipped it, wedging the course.
        await queues.render.add("conductor-render", { beatId: b.id });
        renderQueued++;
      }
    }
    return c.json({ ok: true, autopilot: true, authorQueued, renderQueued, totalBeats: beats.length });
  })
  .post("/:id/rerender", async (c) => {
    /**
     * SURGICAL re-render — re-queue render for a TARGETED subset of a course's
     * beats, never the whole thing. Avoids the "re-ran the whole course to fix
     * a few beats" trap that drains the designer provider.
     *   ?filter=static  (default) — beats whose current render is a static
     *                    fallback (degraded) OR that have no render yet
     *   ?filter=missing — only beats with no render
     *   ?filter=all     — every main beat (use sparingly)
     *   ?beatKeys=a,b,c — restrict to these beat keys (most surgical)
     * Downstream stitch + publish auto-chain per lesson as renders complete.
     */
    const id = c.req.param("id");
    const course = await db.query.courses.findFirst({ where: eq(tables.courses.id, id) });
    if (!course) return c.json({ error: "not_found" }, 404);

    const filter = (c.req.query("filter") ?? "static") as "static" | "missing" | "all";
    const onlyKeys = (c.req.query("beatKeys") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

    const beats = await beatsForCourse(id);
    const targeted: string[] = [];
    for (const b of beats.filter((b) => !b.isAlt)) {
      if (onlyKeys.length && !onlyKeys.includes(b.beatKey)) continue;
      const missing = !b.mp4Key;
      const isStaticFallback = !!b.mp4Key && b.mp4Key.endsWith("-static.mp4");
      const take = filter === "all" ? true : filter === "missing" ? missing : (missing || isStaticFallback);
      if (!take) continue;
      await queues.render.add("surgical-render", { beatId: b.id });
      targeted.push(b.beatKey);
    }
    return c.json({ ok: true, filter, beatKeys: onlyKeys.length ? onlyKeys : undefined, queued: targeted.length, beats: targeted });
  })
  .post("/:id/restore-animated", async (c) => {
    /**
     * FREE restore — for every beat whose CURRENT render is a static fallback
     * (degraded when the designer provider was down), repoint its mp4Key to the
     * most recent ANIMATED render still in S3 history, then re-stitch the
     * affected lessons. Recovers the animation with ZERO provider calls.
     * ?dryRun=1 reports what would change without mutating (use to see scope).
     */
    const id = c.req.param("id");
    const course = await db.query.courses.findFirst({ where: eq(tables.courses.id, id) });
    if (!course) return c.json({ error: "not_found" }, 404);
    const dryRun = c.req.query("dryRun") === "1" || c.req.query("dryRun") === "true";

    const beats = (await beatsForCourse(id)).filter((b) => !b.isAlt);
    const restored: Array<{ beatKey: string; from: string; to: string }> = [];
    const noHistory: string[] = [];
    const lessonsTouched = new Set<string>();

    for (const b of beats) {
      if (!b.mp4Key || !b.mp4Key.endsWith("-static.mp4")) continue; // only degraded beats
      const versions = (await s3.listObjects(`beats/${b.id}/renders/`, 50))
        .filter((o) => o.key.endsWith("-animated.mp4"))
        .sort((a, z) => z.key.localeCompare(a.key)); // newest timestamp first
      const animated = versions[0];
      if (!animated) { noHistory.push(b.beatKey); continue; }
      restored.push({ beatKey: b.beatKey, from: b.mp4Key, to: animated.key });
      lessonsTouched.add(b.lessonId);
      if (!dryRun) {
        await db.update(tables.beats).set({ mp4Key: animated.key, updatedAt: new Date() })
          .where(eq(tables.beats.id, b.id));
      }
    }

    if (!dryRun) {
      for (const lessonId of lessonsTouched) {
        await queues.stitch.add("restore-stitch", { lessonId });
      }
    }

    return c.json({
      ok: true,
      dryRun,
      restoredCount: restored.length,
      lessonsRestitched: dryRun ? 0 : lessonsTouched.size,
      restored,
      noAnimatedHistory: noHistory,
      note: dryRun
        ? "dry run — nothing changed"
        : `Repointed ${restored.length} beat(s) to animated history; re-stitching ${lessonsTouched.size} lesson(s)${course.autopilot ? " (autopilot will republish)" : " (publish manually — autopilot off)"}.`,
    });
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

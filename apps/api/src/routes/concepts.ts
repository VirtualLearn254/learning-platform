import { Hono } from "hono";
import { eq, inArray } from "drizzle-orm";

import { db, tables } from "../db/index.js";

export const conceptsRoute = new Hono()
  .get("/by-course/:courseId", async (c) => {
    const courseId = c.req.param("courseId");
    const sections = await db.select().from(tables.sections).where(eq(tables.sections.courseId, courseId));
    const moduleRows = sections.length
      ? await db.select().from(tables.modules).where(inArray(tables.modules.sectionId, sections.map((s) => s.id)))
      : [];
    const lessons = moduleRows.length
      ? await db.select().from(tables.lessons).where(inArray(tables.lessons.moduleId, moduleRows.map((m) => m.id)))
      : [];
    const beats = lessons.length
      ? await db.select().from(tables.beats).where(inArray(tables.beats.lessonId, lessons.map((l) => l.id)))
      : [];

    const taughtMap = new Map<string, string[]>(); // concept → beat keys
    const requiredMap = new Map<string, string[]>(); // concept → beat keys
    for (const b of beats) {
      for (const c2 of b.conceptsTaught) {
        if (!taughtMap.has(c2)) taughtMap.set(c2, []);
        taughtMap.get(c2)!.push(b.beatKey);
      }
      for (const c2 of b.conceptsRequired) {
        if (!requiredMap.has(c2)) requiredMap.set(c2, []);
        requiredMap.get(c2)!.push(b.beatKey);
      }
    }
    const concepts = [...new Set([...taughtMap.keys(), ...requiredMap.keys()])].map((concept) => ({
      concept,
      taughtBy: taughtMap.get(concept) ?? [],
      requiredBy: requiredMap.get(concept) ?? [],
    }));
    return c.json({ concepts });
  });

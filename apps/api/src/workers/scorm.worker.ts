/**
 * SCORM build worker — packages the lesson into a SCORM 2004 zip ready for
 * Moodle import. Also kicks off PDF generation.
 */

import { Worker } from "bullmq";
import { eq, asc } from "drizzle-orm";

import { db, tables } from "../db/index.js";
import { QueueNames } from "../queue/index.js";
import { workerConnection } from "./connection.js";
import { scormPackager, pdfGenerator, notifications } from "./services.js";

interface JobData { lessonId: string }

export function startScormWorker() {
  return new Worker<JobData>(QueueNames.ScormBuild, async (job) => {
    const { lessonId } = job.data;
    const lesson = await db.query.lessons.findFirst({ where: eq(tables.lessons.id, lessonId) });
    if (!lesson || !lesson.masterMp4Key) throw new Error(`Lesson ${lessonId} not ready for SCORM`);

    const beats = await db.select().from(tables.beats)
      .where(eq(tables.beats.lessonId, lessonId))
      .orderBy(asc(tables.beats.order));

    const altBeats = beats.filter((b) => b.isAlt).map((b) => ({ beatKey: b.beatKey, mp4Key: b.mp4Key! }));

    const scormResult = await scormPackager.build({
      lesson: lesson as never,
      beats: beats as never,
      masterMp4Key: lesson.masterMp4Key,
      altBeats,
      outputKey: `lessons/${lessonId}/lesson.scorm.zip`,
      branding: { organizationName: "learning-platform" },
    });

    // PDFs in parallel — they don't block SCORM publish.
    await Promise.all([
      pdfGenerator.build({
        flavor: "content",
        lesson: lesson as never,
        beats: beats as never,
        branding: { organizationName: "learning-platform", primaryColor: "#0E7C66" },
        outputKey: `lessons/${lessonId}/content.pdf`,
      }),
      pdfGenerator.build({
        flavor: "summary",
        lesson: lesson as never,
        beats: beats as never,
        branding: { organizationName: "learning-platform", primaryColor: "#0E7C66" },
        outputKey: `lessons/${lessonId}/summary.pdf`,
      }),
    ]);

    await db.update(tables.lessons).set({
      scormPackageKey: scormResult.scormZipKey,
      publishedAt: new Date(),
    }).where(eq(tables.lessons.id, lessonId));

    // Mark all main beats as published.
    for (const beat of beats.filter((b) => !b.isAlt)) {
      await db.update(tables.beats).set({ stage: "published" }).where(eq(tables.beats.id, beat.id));
    }

    await notifications.dispatch(["in_app", "telegram"], {
      kind: "lesson.published",
      body: `Lesson "${lesson.title}" is published and SCORM-ready.`,
      url: `/lessons/${lessonId}`,
    });
  }, { connection: workerConnection, concurrency: 2 });
}

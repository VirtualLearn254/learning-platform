/**
 * Ingest worker — consumes uploaded course material and produces a course
 * outline: sections → modules → lessons → beat outlines. Heavy AI lift.
 *
 * State transitions: course material `uploaded` → ingest job emitted → beats
 * created in stage `ingested`. The author worker picks them up from there.
 */

import { Worker } from "bullmq";
import { eq } from "drizzle-orm";

import { db, tables } from "../db/index.js";
import { QueueNames, queues } from "../queue/index.js";
import { workerConnection } from "./connection.js";

interface JobData { courseId: string; materialId: string }

export function startIngestWorker() {
  return new Worker<JobData>(QueueNames.Ingest, async (job) => {
    const { courseId, materialId } = job.data;

    const material = await db.query.materials.findFirst({ where: eq(tables.materials.id, materialId) });
    if (!material) throw new Error(`Material ${materialId} not found`);

    // TODO: extract text from material via PDF/DOCX parser; here we'd call
    // `pdf-parse` or `mammoth` for DOCX. For now we treat the cached
    // extractedText as the input.
    const text = material.extractedText ?? "";

    // TODO: call ai.chat("ingest", ...) with a structured-output prompt that
    // returns a JSON tree: sections → modules → lessons → beats.

    // Placeholder: create one section + module + lesson + 3 beats per material
    // so the rest of the pipeline can be exercised even before AI is wired in.
    const [section] = await db.insert(tables.sections).values({
      courseId, title: "Section 1", order: 0,
    }).returning();
    const [moduleRow] = await db.insert(tables.modules).values({
      sectionId: section!.id, title: "Module 1", order: 0,
    }).returning();
    const [lesson] = await db.insert(tables.lessons).values({
      moduleId: moduleRow!.id, title: material.filename, order: 0,
    }).returning();

    const beatRows = await db.insert(tables.beats).values([
      { lessonId: lesson!.id, beatKey: "hook",  beatType: "hook",    order: 0, stage: "ingested", script: text.slice(0, 800),     conceptsTaught: [], conceptsRequired: [] },
      { lessonId: lesson!.id, beatKey: "concept1", beatType: "concept", order: 1, stage: "ingested", script: text.slice(800, 1800),  conceptsTaught: [], conceptsRequired: [] },
      { lessonId: lesson!.id, beatKey: "recap", beatType: "recap",   order: 2, stage: "ingested", script: text.slice(1800, 2600), conceptsTaught: [], conceptsRequired: [] },
    ]).returning();

    await db.update(tables.materials).set({ ingestedAt: new Date() }).where(eq(tables.materials.id, materialId));

    // Move each beat into the authoring queue.
    for (const beat of beatRows) {
      await queues.author.add("author-beat", { beatId: beat.id, isRevision: false });
      await db.update(tables.beats).set({ stage: "authoring", status: "pending" }).where(eq(tables.beats.id, beat.id));
    }
  }, { connection: workerConnection, concurrency: 2 });
}

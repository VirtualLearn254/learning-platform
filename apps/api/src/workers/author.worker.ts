/**
 * Author worker — generates a beat's HTML payload via the render-engine.
 * On success, moves the beat into ai_review.
 */

import { Worker } from "bullmq";
import { eq } from "drizzle-orm";

import { db, tables } from "../db/index.js";
import { QueueNames, queues } from "../queue/index.js";
import { workerConnection } from "./connection.js";
import { renderEngine } from "./services.js";

interface JobData { beatId: string; isRevision: boolean }

export function startAuthorWorker() {
  return new Worker<JobData>(QueueNames.Author, async (job) => {
    const { beatId, isRevision } = job.data;
    const beat = await db.query.beats.findFirst({ where: eq(tables.beats.id, beatId) });
    if (!beat) throw new Error(`Beat ${beatId} not found`);

    await db.update(tables.beats).set({ status: "running" }).where(eq(tables.beats.id, beatId));

    // Pull latest feedback if revising.
    let revisionContext;
    if (isRevision) {
      const latestFeedback = await db.query.beatFeedback.findFirst({
        where: eq(tables.beatFeedback.beatId, beatId),
        orderBy: (t, { desc }) => [desc(t.createdAt)],
      });
      if (latestFeedback) {
        revisionContext = {
          previousHtml: "",  // would be fetched from S3 by html_key
          feedback: latestFeedback.feedback,
          screenshotKeys: latestFeedback.screenshotKeys,
        };
      }
    }

    const result = await renderEngine.authorBeat({
      beatKey: beat.beatKey,
      beatType: beat.beatType,
      script: beat.script,
      visualSpec: beat.visualSpec as never,
      quiz: beat.quiz as never,
      styleHints: null,
      earlierConcepts: [],
      revisionContext,
    });

    // Write HTML to S3 (placeholder key for now).
    const htmlKey = `beats/${beatId}/index.html`;

    await db.update(tables.beats).set({
      htmlKey,
      stage: "ai_review",
      status: "succeeded",
      conceptsTaught: result.conceptsTaught,
      updatedAt: new Date(),
    }).where(eq(tables.beats.id, beatId));

    await queues.aiReview.add("review-beat", { beatId });
  }, { connection: workerConnection, concurrency: 8 });
}

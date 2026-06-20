/**
 * AI review worker — runs an automated quality check on the authored HTML.
 * If the score passes a threshold, moves the beat into human_review;
 * otherwise loops back to authoring with the issues as feedback.
 */

import { Worker } from "bullmq";
import { eq } from "drizzle-orm";

import { db, tables } from "../db/index.js";
import { QueueNames, queues } from "../queue/index.js";
import { workerConnection } from "./connection.js";
import { renderEngine, notifications } from "./services.js";

const PASS_THRESHOLD = 80;

interface JobData { beatId: string }

export function startAIReviewWorker() {
  return new Worker<JobData>(QueueNames.AIReview, async (job) => {
    const { beatId } = job.data;
    const beat = await db.query.beats.findFirst({ where: eq(tables.beats.id, beatId) });
    if (!beat) throw new Error(`Beat ${beatId} not found`);

    const review = await renderEngine.reviewBeat({
      beatKey: beat.beatKey,
      html: "",  // would fetch from S3 by htmlKey
      script: beat.script,
      beatDurationSeconds: beat.durationSeconds ?? 30,
    });

    if (review.score >= PASS_THRESHOLD) {
      await db.update(tables.beats).set({ stage: "human_review", updatedAt: new Date() }).where(eq(tables.beats.id, beatId));
      // Notify human reviewer.
      await notifications.dispatch(["in_app", "telegram"], {
        kind: "beat.needs_review",
        body: `Beat ${beat.beatKey} is ready for review (score ${review.score}/100).`,
        url: `/beats/${beatId}`,
        data: { beatId, score: review.score },
      });
    } else {
      await db.update(tables.beats).set({
        stage: "revising",
        revisionCount: beat.revisionCount + 1,
        errorMessage: `AI review failed: ${review.issues.slice(0, 3).map((i) => i.description).join("; ")}`,
        updatedAt: new Date(),
      }).where(eq(tables.beats.id, beatId));
      await queues.author.add("re-author", { beatId, isRevision: true });
    }
  }, { connection: workerConnection, concurrency: 4 });
}
